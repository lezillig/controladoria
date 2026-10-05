import { Prisma, type BalancoPatrimonial } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tabela } from "@/lib/esquemaDoBanco";
import { competenciaSql } from "./competencia";
import { categoriaSql, filtroConexaoTitulo } from "./escopoSql";
import { categoriasDoEscopo, movimentoPorCategoria } from "./dreNoBanco";
import { linhaDaCategoria } from "./dre";
import { baseHistoricaNoBanco, classificacoesDoDre, escopoTexto, type EscopoProjecao } from "./projecaoNoBanco";
import {
  calcularIndicadores,
  competenciaDoBalanco,
  janelaDe12,
  prazoPonderado,
  type BalancoIndicadores,
  type Competencia,
  type Indicador,
  type Recebiveis,
  type SerieDre,
} from "./indicadores";

// A COLHEITA DO PAINEL DE INDICADORES. O DRE vem da mesma série da projeção
// (que é a do DRE anual da tela de Custos e DRE); os recebíveis, de somas no
// banco sobre os títulos, com a receita bruta decidida pela MESMA regra de
// categoria do DRE (linhaDaCategoria) — o "maior cliente" é parte da receita
// que a tela de Custos mostra, e não de outra.

const reaisEmCents = (v: { toNumber(): number } | null) => (v === null ? null : Math.round(v.toNumber() * 100));

export function balancoParaIndicadores(b: BalancoPatrimonial): BalancoIndicadores {
  return {
    dataBase: b.dataBase,
    caixaCents: reaisEmCents(b.caixa)!,
    contasReceberCents: reaisEmCents(b.contasReceber)!,
    ativoCirculanteCents: reaisEmCents(b.ativoCirculante)!,
    imobilizadoLiquidoCents: reaisEmCents(b.imobilizadoLiquido)!,
    ativoTotalCents: reaisEmCents(b.ativoTotal)!,
    fornecedoresCents: reaisEmCents(b.fornecedores)!,
    passivoCirculanteCents: reaisEmCents(b.passivoCirculante)!,
    dividaCurtoPrazoCents: reaisEmCents(b.dividaCurtoPrazo)!,
    dividaLongoPrazoCents: reaisEmCents(b.dividaLongoPrazo)!,
    patrimonioLiquidoCents: reaisEmCents(b.patrimonioLiquido)!,
    depreciacaoAnoCents: reaisEmCents(b.depreciacaoAno),
    lucroLiquidoAnoCents: reaisEmCents(b.lucroLiquidoAno),
    custoCapitalAa: b.custoCapitalAa.toNumber(),
    frotaVeiculos: b.frotaVeiculos,
    kmAno: b.kmAno === null ? null : b.kmAno.toNumber(),
  };
}

const inicioDa = (c: Competencia) => {
  const [a, m] = c.split("-").map(Number);
  return new Date(a, m - 1, 1, 0, 0, 0, 0);
};
const fimDa = (c: Competencia) => {
  const [a, m] = c.split("-").map(Number);
  return new Date(a, m, 0, 23, 59, 59, 999);
};

type LinhaCliente = { categoria: string; cliente: string; cents: bigint; pagos: bigint | null; ponderado: number | null };
type LinhaVencido = { categoria: string; cents: bigint };
type LinhaPmp = { pagos: bigint | null; ponderado: number | null };

export async function recebiveisNoBanco(escopo: EscopoProjecao, competencias: Competencia[], hoje = new Date()): Promise<Recebiveis | null> {
  if (competencias.length === 0) return null;
  const inicio = inicioDa(competencias[0]);
  const fim = fimDa(competencias[competencias.length - 1]);
  const corte = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 30);
  const filtro = filtroConexaoTitulo(escopo.conexaoId, escopo.companyId);
  const dias = (coluna: string) =>
    // Dias da competência (emissão, ou vencimento sem emissão) à última baixa.
    `GREATEST(0, EXTRACT(EPOCH FROM (t."${coluna}" - COALESCE(t."dataEmissao", t."dataVencimento"))) / 86400.0)`;
  const escopoDre = { companyId: escopo.companyId, conexaoId: escopo.conexaoId, janela: { desde: inicio, ate: null } };

  // EM SEQUÊNCIA, como na tela de Resultado mês a mês: consultas em paralelo
  // demais esgotam o pool de conexões do Prisma no pooler de produção. O
  // cliente é a RAIZ do CNPJ: as filiais de um mesmo cliente são uma
  // dependência só.
  const porCliente = await prisma.$queryRaw<LinhaCliente[]>`
      SELECT ${categoriaSql()} AS categoria,
             COALESCE(CASE WHEN char_length(t."parceiroDocumento") = 14 THEN LEFT(t."parceiroDocumento", 8) ELSE NULLIF(t."parceiroDocumento", '') END,
                      t."parceiroCodigo", t."parceiroNome", '?') AS cliente,
             COALESCE(SUM(t."valorDocumentoCents"), 0)::bigint AS cents,
             SUM(t."valorDocumentoCents") FILTER (WHERE t.liquidado AND t."dataUltimaBaixa" IS NOT NULL)::bigint AS pagos,
             SUM(t."valorDocumentoCents"::float8 * ${Prisma.raw(dias("dataUltimaBaixa"))})
               FILTER (WHERE t.liquidado AND t."dataUltimaBaixa" IS NOT NULL)::float8 AS ponderado
        FROM ${tabela("OmieTitulo")} t
       WHERE t."companyId" = ${escopo.companyId}
         AND t.natureza = 'RECEBER'
         AND t.cancelado = false
         AND ${competenciaSql("t")} >= ${inicio}
         AND ${competenciaSql("t")} <= ${fim}
         ${filtro}
       GROUP BY 1, 2`;
  const vencidos = await prisma.$queryRaw<LinhaVencido[]>`
      SELECT ${categoriaSql()} AS categoria,
             COALESCE(SUM(COALESCE(t."saldoCents", t."valorDocumentoCents" - t."valorPagoCents")), 0)::bigint AS cents
        FROM ${tabela("OmieTitulo")} t
       WHERE t."companyId" = ${escopo.companyId}
         AND t.natureza = 'RECEBER'
         AND t.cancelado = false
         AND t.liquidado = false
         AND t."dataVencimento" < ${corte}
         ${filtro}
       GROUP BY 1`;
  const [pmp] = await prisma.$queryRaw<LinhaPmp[]>`
      SELECT SUM(t."valorDocumentoCents")::bigint AS pagos,
             SUM(t."valorDocumentoCents"::float8 * ${Prisma.raw(dias("dataUltimaBaixa"))})::float8 AS ponderado
        FROM ${tabela("OmieTitulo")} t
       WHERE t."companyId" = ${escopo.companyId}
         AND t.natureza = 'PAGAR'
         AND t.cancelado = false
         AND t.liquidado = true
         AND t."dataUltimaBaixa" IS NOT NULL
         AND ${competenciaSql("t")} >= ${inicio}
         AND ${competenciaSql("t")} <= ${fim}
         ${filtro}`;
  const classificacoes = await classificacoesDoDre(escopo.companyId);
  const categorias = await categoriasDoEscopo(escopoDre);
  const movimento = await movimentoPorCategoria(escopoDre);

  const ehReceita = new Map<string, boolean>();
  const receita = (categoria: string) => {
    if (categoria === "SEM_CATEGORIA") return false;
    let r = ehReceita.get(categoria);
    if (r === undefined) {
      r = linhaDaCategoria(categoria, classificacoes, categorias, movimento) === "RECEITA_BRUTA";
      ehReceita.set(categoria, r);
    }
    return r;
  };

  const clientes = new Map<string, number>();
  let pagos = 0;
  let ponderado = 0;
  for (const l of porCliente) {
    if (!receita(l.categoria)) continue;
    clientes.set(l.cliente, (clientes.get(l.cliente) ?? 0) + Number(l.cents));
    pagos += Number(l.pagos ?? 0);
    ponderado += Number(l.ponderado ?? 0);
  }

  return {
    receitaPorClienteCents: [...clientes.values()].filter((v) => v > 0),
    pmrDias: prazoPonderado(ponderado, pagos),
    pmpDias: prazoPonderado(Number(pmp?.ponderado ?? 0), Number(pmp?.pagos ?? 0)),
    vencidoMais30Cents: vencidos.filter((v) => receita(v.categoria)).reduce((a, v) => a + Number(v.cents), 0),
  };
}

export type PainelIndicadores = {
  indicadores: Indicador[];
  competencias: Competencia[];
  competenciasDoBalanco: Competencia[] | null;
  balanco: BalancoPatrimonial | null;
  balancoAnterior: BalancoPatrimonial | null;
  balancos: BalancoPatrimonial[];
  dre: SerieDre;
};

export async function painelDeIndicadores(escopo: EscopoProjecao, dataReferencia: Date): Promise<PainelIndicadores> {
  const [base, balancos] = await Promise.all([
    baseHistoricaNoBanco(escopo, dataReferencia),
    prisma.balancoPatrimonial.findMany({
      where: { companyId: escopo.companyId, escopo: escopoTexto(escopo.conexaoId) },
      orderBy: { dataBase: "desc" },
    }),
  ]);
  const competencias = base.competencias.slice(-12);
  const dre: SerieDre = new Map([...base.porLinha].map(([chave, serie]) => [chave as string, serie]));

  // O balanço mais recente e o anterior a ele (para as médias), se este
  // estiver até 15 meses antes — um balanço de três anos atrás não é o
  // "início do período" de nada.
  const balanco = balancos[0] ?? null;
  const anterior =
    balanco && balancos[1] && balanco.dataBase.getTime() - balancos[1].dataBase.getTime() <= 460 * 86_400_000 ? balancos[1] : null;
  const competenciasDoBalanco = balanco ? janelaDe12(competenciaDoBalanco(balanco.dataBase), base.competencias) : null;

  const recebiveis = await recebiveisNoBanco(escopo, competencias);

  return {
    indicadores: calcularIndicadores({
      dre,
      competencias,
      competenciasDoBalanco,
      balanco: balanco ? balancoParaIndicadores(balanco) : null,
      balancoAnterior: anterior ? balancoParaIndicadores(anterior) : null,
      recebiveis,
    }),
    competencias,
    competenciasDoBalanco,
    balanco,
    balancoAnterior: anterior,
    balancos,
    dre,
  };
}
