import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tabela } from "@/lib/esquemaDoBanco";
import { categoriasEmColisao, chaveDaCategoria } from "./chaveCategoria";
import { linhaDaCategoria } from "./dre";
import { categoriasDoEscopo, movimentoPorCategoria } from "./dreNoBanco";
import { classificacoesDoDre } from "./projecaoNoBanco";
import { caixaMesAMes, grupoDoFluxo, type PrevistoDoMes, type SomaDoMes } from "./caixaMensal";

// A COLHEITA DO CAIXA MÊS A MÊS — somas no banco, a conta em caixaMensal.ts.
//
// REALIZADO é o extrato (OmieMovimento): o dinheiro que passou pela conta. A
// categoria de cada linha é a da própria linha ou, sem ela, a do título que a
// linha baixou — pela baixa (lancamentoCCCodigo) ou pelo lançamento
// relacionado. O grupo do fluxo sai da linha do DRE da categoria, com as
// mesmas classificações da tela de Custos e DRE.
//
// TRANSFERÊNCIA ENTRE CONTAS: linha sem categoria cujo par — valor oposto, até
// um dia de diferença, outra conta da empresa — também não tem categoria, ou
// linha sem categoria e sem título que se diz transferência no texto.
//
// PREVISTO é o que vencia no mês: os títulos (não cancelados) pelo vencimento,
// a receber e a pagar. Com uma conta escolhida, só os títulos dessa conta.

export type EscopoCaixa = { companyId: string; conexaoId: string | null; contaCodigo: string | null };

const mesDe = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

type LinhaSoma = { mes: string; empresa: string; categoria: string | null; entrada: boolean; transferencia: boolean; cents: bigint };
type LinhaPrevisto = { mes: string; natureza: "PAGAR" | "RECEBER"; cents: bigint };

export async function caixaMensalNoBanco(params: EscopoCaixa & { desde: Date; ate: Date }) {
  const { companyId, conexaoId, contaCodigo, desde, ate } = params;
  const doMovimento = Prisma.sql`${conexaoId ? Prisma.sql`AND m."conexaoId" = ${conexaoId}` : Prisma.empty} ${contaCodigo ? Prisma.sql`AND m."contaCorrenteCodigo" = ${contaCodigo}` : Prisma.empty}`;
  const doTitulo = Prisma.sql`${conexaoId ? Prisma.sql`AND t."conexaoId" = ${conexaoId}` : Prisma.empty} ${contaCodigo ? Prisma.sql`AND t."contaCorrenteCodigo" = ${contaCodigo}` : Prisma.empty}`;
  const janela = { desde: new Date(desde.getTime() - 400 * 86_400_000), ate };

  const [somas, previsto, antes, contas, classificacoes, todasCategorias, categorias, movimento] = await Promise.all([
    // Sem subconsulta correlacionada: os candidatos a transferência (linhas sem
    // categoria no período) são casados entre si de uma vez, por hash no valor.
    // A versão linha a linha estourava o tempo da página com o extrato real.
    // A baixa entra por DISTINCT ON: um lançamento que baixou vários títulos
    // (pagamento em lote) não pode multiplicar a linha do extrato.
    prisma.$queryRaw<LinhaSoma[]>`
      WITH cand AS (
        SELECT o.id, o.data, o."valorCents", o."conexaoId", o."contaCorrenteCodigo"
          FROM ${tabela("OmieMovimento")} o
         WHERE o."companyId" = ${companyId}
           AND o."categoriaCodigo" IS NULL
           AND o.data >= ${desde}::timestamp - INTERVAL '1 day' AND o.data <= ${ate}::timestamp + INTERVAL '1 day'
      ),
      pares AS (
        SELECT DISTINCT a.id
          FROM cand a
          JOIN cand o ON o."valorCents" = -a."valorCents"
                     AND o.data BETWEEN a.data - INTERVAL '1 day' AND a.data + INTERVAL '1 day'
                     AND (o."conexaoId" <> a."conexaoId" OR o."contaCorrenteCodigo" <> a."contaCorrenteCodigo")
      ),
      baixas AS (
        SELECT DISTINCT ON (b."conexaoId", b."lancamentoCCCodigo") b."conexaoId", b."lancamentoCCCodigo", b."tituloId"
          FROM ${tabela("OmieBaixa")} b
         WHERE b."companyId" = ${companyId} AND b."lancamentoCCCodigo" IS NOT NULL
         ORDER BY b."conexaoId", b."lancamentoCCCodigo", b."dataBaixa" DESC
      ),
      linhas AS (
        SELECT m.data, m."valorCents", m."conexaoApelido",
               COALESCE(m."categoriaCodigo", tb."categoriaCodigo", tt."categoriaCodigo") AS categoria,
               (tb.id IS NOT NULL OR tt.id IS NOT NULL) AS com_titulo,
               (p.id IS NOT NULL) AS tem_par,
               CONCAT_WS(' ', m.tipo, m.observacao, m."parceiroNome") AS texto
          FROM ${tabela("OmieMovimento")} m
          LEFT JOIN baixas b ON b."conexaoId" = m."conexaoId" AND b."lancamentoCCCodigo" = m."codigoLancamento"
          LEFT JOIN ${tabela("OmieTitulo")} tb ON tb.id = b."tituloId"
          LEFT JOIN ${tabela("OmieTitulo")} tt ON b."tituloId" IS NULL AND m."tituloCodigo" IS NOT NULL AND tt."conexaoId" = m."conexaoId" AND tt."codigoLancamento" = m."tituloCodigo"
          LEFT JOIN pares p ON p.id = m.id
         WHERE m."companyId" = ${companyId}
           AND m.data >= ${desde} AND m.data <= ${ate}
           ${doMovimento}
      )
      SELECT to_char(l.data, 'YYYY-MM') AS mes,
             l."conexaoApelido" AS empresa,
             l.categoria,
             (l."valorCents" > 0) AS entrada,
             (l.categoria IS NULL AND (l.tem_par OR (NOT l.com_titulo AND l.texto ~* 'transf'))) AS transferencia,
             SUM(l."valorCents")::bigint AS cents
        FROM linhas l
       GROUP BY 1, 2, 3, 4, 5`,
    prisma.$queryRaw<LinhaPrevisto[]>`
      SELECT to_char(t."dataVencimento", 'YYYY-MM') AS mes, t.natureza::text AS natureza, SUM(t."valorDocumentoCents")::bigint AS cents
        FROM ${tabela("OmieTitulo")} t
       WHERE t."companyId" = ${companyId}
         AND t.cancelado = false
         AND t."dataVencimento" >= ${desde} AND t."dataVencimento" <= ${ate}
         ${doTitulo}
       GROUP BY 1, 2`,
    prisma.omieMovimento.aggregate({
      where: { companyId, data: { lt: desde }, ...(conexaoId ? { conexaoId } : {}), ...(contaCodigo ? { contaCorrenteCodigo: contaCodigo } : {}) },
      _sum: { valorCents: true },
    }),
    prisma.omieContaCorrente.findMany({
      where: { companyId, ...(conexaoId ? { conexaoId } : {}), ...(contaCodigo ? { codigo: contaCodigo } : {}) },
      select: { saldoInicialCents: true },
    }),
    classificacoesDoDre(companyId),
    prisma.omieCategoria.findMany({ where: { companyId }, select: { codigo: true, descricao: true } }),
    categoriasDoEscopo({ companyId, conexaoId, janela }),
    movimentoPorCategoria({ companyId, conexaoId, janela }),
  ]);

  const colisoes = categoriasEmColisao(todasCategorias);
  const linhaDe = new Map<string, string>();
  const linha = (chave: string) => {
    let l = linhaDe.get(chave);
    if (l === undefined) {
      l = linhaDaCategoria(chave, classificacoes, categorias, movimento);
      linhaDe.set(chave, l);
    }
    return l;
  };
  const somasDoMes: SomaDoMes[] = somas.map((s) => ({
    mes: s.mes,
    entrada: s.entrada,
    cents: Number(s.cents),
    grupo: grupoDoFluxo(s.categoria ? linha(chaveDaCategoria(s.categoria, s.empresa, colisoes)) : null, s.entrada, s.transferencia),
  }));
  const previstoDoMes: PrevistoDoMes[] = previsto.map((p) => ({ mes: p.mes, natureza: p.natureza, cents: Number(p.cents) }));
  const saldoInicialCents = contas.reduce((a, c) => a + c.saldoInicialCents, 0) + (antes._sum.valorCents ?? 0);

  return {
    saldoInicialCents,
    meses: caixaMesAMes({ somas: somasDoMes, previsto: previstoDoMes, saldoInicialCents, desde: mesDe(desde), ate: mesDe(ate) }),
  };
}
