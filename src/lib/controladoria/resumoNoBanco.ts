import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tabela } from "@/lib/esquemaDoBanco";
import type { ResumoPeriodo } from "./analytics";
import type { Periodo } from "./periodos";
import { competenciaSql } from "./competencia";

// RESUMO DE UM PERÍODO, SOMADO NO BANCO.
//
// Gêmeo exato de `resumoDoPeriodo` do analytics, que faz a mesma conta em
// memória sobre o contexto de auditoria já carregado. Os dois existem porque
// atendem a necessidades opostas:
//
//   - Os AGENTES precisam das linhas. "Fornecedor cujo CPF é de um motorista
//     da folha" não sai de uma soma; sai de comparar registro com registro.
//   - As COMPARAÇÕES LONGAS do painel e do relatório — mês anterior, acumulado
//     do ano, mesmo mês do ano passado — só precisam de totais. E é justamente
//     essa parte que obriga o contexto a carregar vinte meses de títulos: o
//     acumulado do ano anterior pode estar a vinte meses da data de
//     referência.
//
// Separar os dois é o que permite encolher a janela do contexto sem perder
// comparação nenhuma. E encolher deixou de ser opcional: com 46 mil títulos e
// 45 mil baixas na base, a fase de auditoria do ciclo diário passou a estourar
// os 60 segundos da função e o ciclo parou de fechar.
//
// A REGRA DE CÁLCULO É COPIADA LINHA A LINHA do original, e há um teste
// diferencial que roda as duas sobre os mesmos dados e exige resultado
// idêntico. Um gêmeo que diverge é pior que não ter gêmeo: passaria a
// contradizer o relatório sem ninguém perceber.

type LinhaTitulos = { natureza: string; valor: bigint; quantidade: bigint };
type LinhaBaixas = {
  natureza: string | null;
  valor: bigint;
  juros: bigint;
  multa: bigint;
  tarifa: bigint;
  desconto: bigint;
};

export async function resumoDoPeriodoNoBanco(params: {
  companyId: string;
  conexaoId?: string | null;
  periodo: Periodo;
}): Promise<ResumoPeriodo> {
  const { companyId, conexaoId, periodo } = params;

  // Fragmento parametrizado, nunca interpolação de texto: o id vem da
  // querystring, e concatenar valor de requisição dentro de SQL é como se
  // escreve uma injeção.
  const filtroTitulo = conexaoId ? Prisma.sql`AND t."conexaoId" = ${conexaoId}` : Prisma.empty;
  const filtroBaixa = conexaoId ? Prisma.sql`AND b."conexaoId" = ${conexaoId}` : Prisma.empty;

  const [titulos, baixas] = await Promise.all([
    prisma.$queryRaw<LinhaTitulos[]>`
      SELECT t.natureza::text AS natureza,
             COALESCE(SUM(t."valorDocumentoCents"), 0)::bigint AS valor,
             COUNT(*)::bigint AS quantidade
        FROM ${tabela("OmieTitulo")} t
       WHERE t."companyId" = ${companyId}
         AND t.cancelado = false
         AND ${competenciaSql("t")} >= ${periodo.inicio}
         AND ${competenciaSql("t")} <= ${periodo.fim}
         ${filtroTitulo}
       GROUP BY 1
    `,
    // LEFT JOIN, e não JOIN: a tarifa é somada sobre TODAS as baixas do
    // período, inclusive as de título que o filtro de natureza não alcança —
    // é assim no original, e a tarifa bancária existe independentemente de o
    // título ser a pagar ou a receber.
    prisma.$queryRaw<LinhaBaixas[]>`
      SELECT t.natureza::text AS natureza,
             COALESCE(SUM(ABS(b."valorCents")), 0)::bigint AS valor,
             COALESCE(SUM(b."jurosCents"), 0)::bigint AS juros,
             COALESCE(SUM(b."multaCents"), 0)::bigint AS multa,
             COALESCE(SUM(b."tarifaCents"), 0)::bigint AS tarifa,
             COALESCE(SUM(b."descontoCents"), 0)::bigint AS desconto
        FROM ${tabela("OmieBaixa")} b
        LEFT JOIN ${tabela("OmieTitulo")} t ON t.id = b."tituloId"
       WHERE b."companyId" = ${companyId}
         AND b."dataBaixa" >= ${periodo.inicio}
         AND b."dataBaixa" <= ${periodo.fim}
         ${filtroBaixa}
       GROUP BY 1
    `,
  ]);

  const porNatureza = (linhas: { natureza: string | null }[], natureza: string) =>
    linhas.find((l) => l.natureza === natureza);

  const receber = porNatureza(titulos, "RECEBER") as LinhaTitulos | undefined;
  const pagar = porNatureza(titulos, "PAGAR") as LinhaTitulos | undefined;

  const receita = Number(receber?.valor ?? 0);
  const despesa = Number(pagar?.valor ?? 0);
  const resultado = receita - despesa;

  const baixasPagar = porNatureza(baixas, "PAGAR") as LinhaBaixas | undefined;
  const baixasReceber = porNatureza(baixas, "RECEBER") as LinhaBaixas | undefined;

  // Juros e multa vêm do PAGAMENTO (perda de quem pagou atrasado); desconto
  // vem do RECEBIMENTO (desconto concedido é perda, desconto obtido é ganho —
  // somar os dois no mesmo campo esconderia os dois); tarifa vem de todas as
  // baixas do período.
  const juros = Number(baixasPagar?.juros ?? 0);
  const multa = Number(baixasPagar?.multa ?? 0);
  const tarifa = baixas.reduce((acc, l) => acc + Number(l.tarifa), 0);
  const descontoConcedido = Number(baixasReceber?.desconto ?? 0);

  const pago = Number(baixasPagar?.valor ?? 0);
  const recebido = Number(baixasReceber?.valor ?? 0);

  return {
    rotulo: periodo.rotulo,
    receitaCents: receita,
    despesaCents: despesa,
    resultadoCents: resultado,
    margemPercent: receita > 0 ? (resultado / receita) * 100 : null,
    recebidoCents: recebido,
    pagoCents: pago,
    fluxoLiquidoCents: recebido - pago,
    jurosCents: juros,
    multaCents: multa,
    tarifaCents: tarifa,
    descontoCents: descontoConcedido,
    perdaTotalCents: juros + multa + tarifa + descontoConcedido,
    titulosPagar: Number(pagar?.quantidade ?? 0),
    titulosReceber: Number(receber?.quantidade ?? 0),
  };
}
