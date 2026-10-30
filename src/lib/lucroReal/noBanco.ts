import { prisma } from "@/lib/prisma";
import { tabela } from "@/lib/esquemaDoBanco";
import { competenciaSql } from "../controladoria/competencia";
import { intercompanyEliminado, montarDreNoBanco, parcelaCorporativaPorCategoria } from "../controladoria/dreNoBanco";
import { categoriaSql, ehIntercompanySql } from "../controladoria/escopoSql";
import type { Periodo } from "../controladoria/periodos";
import { lerAdaptacoes, lerHorasDeOperacao, lerPatrimonioDaFrota } from "../gestao/leitura";
import { tipoDaCategoria } from "./catalogo";
import { lerTjlp, type Tjlp } from "./tjlp";
import type { DocumentacaoAgregada, InsumosLucroReal, ItemApuracao, MovimentoSemCausa, TituloComPendencia } from "./apuracao";

// A COLHEITA DA APURAÇÃO DO LUCRO REAL — a conta está em apuracao.ts.
//
// SÓ A AZUL, COM AS PESSOAS DA MCZ. A folha da MCZ passa para a Azul em 2027,
// e é como a Azul vai apurar: o DRE é o do grupo (o que uma paga à outra se
// elimina, como na tela de Custos e DRE), e da MCZ fica só o custo de pessoas —
// a linha de pessoas do corporativo inteira, e a parte da MCZ nas categorias de
// salário, encargos e benefícios classificadas em outras linhas. O resto da MCZ
// (o DAS do Simples, a estrutura dela) sai, na proporção em cada categoria.
//
// Doze meses fechados, por competência — o regime do Lucro Real.

const TIPOS_DE_PESSOAS = new Set(["SALARIOS_ENCARGOS", "BENEFICIOS", "PLR", "PRO_LABORE"]);

export function dozeMesesFechados(hoje: Date): Periodo {
  const inicio = new Date(hoje.getFullYear(), hoje.getMonth() - 12, 1);
  const fim = new Date(hoje.getFullYear(), hoje.getMonth(), 0, 23, 59, 59, 999);
  const mmaa = (d: Date) => `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  return { inicio, fim, rotulo: `${mmaa(inicio)} a ${mmaa(fim)}` };
}

const ANO = 365 * 86_400_000;

// Depreciação no período, a uma taxa anual, de um bem comprado em `compra`
// pelo custo dado: só os dias em que ele já existia e ainda não estava
// inteiramente depreciado (cinco anos a 20%, quatro a 25%).
export function depreciacaoNoPeriodo(custoCents: number, compra: Date, taxa: number, periodo: Periodo): number {
  const fimDaVida = new Date(compra);
  fimDaVida.setFullYear(fimDaVida.getFullYear() + Math.round(1 / taxa));
  const de = Math.max(compra.getTime(), periodo.inicio.getTime());
  // O fim do período é 23:59:59,999 do último dia: o dia inteiro conta.
  const ate = Math.min(fimDaVida.getTime(), periodo.fim.getTime() + 1);
  if (ate <= de) return 0;
  return Math.round(custoCents * taxa * Math.min(1, (ate - de) / ANO));
}

export async function insumosDoLucroReal(params: {
  companyId: string;
  empresa: { id: string; apelido: string };
  corporativa: { id: string; apelido: string } | null;
  periodo: Periodo;
  hoje: Date;
  // O que alguém digitou na tela vale por cima do balanço e da TJLP do Banco Central.
  jcpManual: { plCents: number | null; tjlp: number | null };
}): Promise<InsumosLucroReal> {
  const { companyId, empresa, corporativa, periodo, hoje } = params;
  const escopo = { companyId, conexaoId: null, janela: { desde: periodo.inicio, ate: null } };
  // O DRE pede o período anterior; aqui ele não é usado, e um dia basta.
  const anterior: Periodo = { inicio: periodo.inicio, fim: periodo.inicio, rotulo: "" };
  const doTitulo = (alias = "t") => ehIntercompanySql(companyId, alias);
  const seisMeses = new Date(hoje.getFullYear(), hoje.getMonth() - 6, hoje.getDate());
  const umAno = new Date(hoje.getFullYear() - 1, hoje.getMonth(), hoje.getDate());

  const [guardadas, parcelas, eliminado, documentacao, pendentes, semCausa, vencidos, patrimonio, adaptacoes, horas, balancos, tjlp] = await Promise.all([
    prisma.dreClassificacao.findMany({ where: { companyId }, select: { categoriaCodigo: true, linha: true, subgrupo: true, origem: true } }),
    parcelaCorporativaPorCategoria(escopo, periodo),
    intercompanyEliminado(escopo, periodo, "competencia"),
    prisma.$queryRaw<{ chave: string; descricao: string | null; pj: boolean; pf: boolean; sem_doc: boolean; sem_benef: boolean; sem_ret: boolean; cents: bigint; n: bigint }[]>`
      SELECT ${categoriaSql()} AS chave,
             MAX(t."categoriaDescricao") AS descricao,
             (length(d.doc) = 14) AS pj,
             (length(d.doc) = 11) AS pf,
             (COALESCE(btrim(t."numeroDocumento"), '') = '') AS sem_doc,
             (d.doc = '') AS sem_benef,
             (t."retencaoIrCents" = 0 AND t."retencaoInssCents" = 0) AS sem_ret,
             SUM(t."valorDocumentoCents")::bigint AS cents,
             COUNT(*)::bigint AS n
        FROM ${tabela("OmieTitulo")} t
        CROSS JOIN LATERAL (SELECT regexp_replace(COALESCE(t."parceiroDocumento", ''), '[^0-9]', '', 'g') AS doc) d
       WHERE t."companyId" = ${companyId}
         AND t."conexaoId" = ${empresa.id}
         AND t.natureza = 'PAGAR'
         AND t.cancelado = false
         AND ${competenciaSql("t")} >= ${periodo.inicio}
         AND ${competenciaSql("t")} <= ${periodo.fim}
         AND NOT ${doTitulo()}
       GROUP BY 1, 3, 4, 5, 6, 7`,
    prisma.$queryRaw<(Omit<TituloComPendencia, "valorCents" | "retencaoCents"> & { valorCents: number; retencaoCents: number })[]>`
      SELECT t.id, ${competenciaSql("t")} AS data, t."parceiroNome" AS parceiro, t."parceiroDocumento" AS documento,
             ${categoriaSql()} AS chave, COALESCE(t."categoriaDescricao", '') AS descricao, t."numeroDocumento" AS "numeroDocumento",
             t."valorDocumentoCents" AS "valorCents", (t."retencaoIrCents" + t."retencaoInssCents") AS "retencaoCents"
        FROM ${tabela("OmieTitulo")} t
        CROSS JOIN LATERAL (SELECT regexp_replace(COALESCE(t."parceiroDocumento", ''), '[^0-9]', '', 'g') AS doc) d
       WHERE t."companyId" = ${companyId}
         AND t."conexaoId" = ${empresa.id}
         AND t.natureza = 'PAGAR'
         AND t.cancelado = false
         AND ${competenciaSql("t")} >= ${periodo.inicio}
         AND ${competenciaSql("t")} <= ${periodo.fim}
         AND NOT ${doTitulo()}
         AND (COALESCE(btrim(t."numeroDocumento"), '') = '' OR d.doc = '' OR (length(d.doc) = 11 AND t."retencaoIrCents" = 0 AND t."retencaoInssCents" = 0))
       ORDER BY t."valorDocumentoCents" DESC
       LIMIT 3000`,
    // Saída do extrato sem título, sem categoria e sem par em outra conta (não
    // é transferência) — e que não se diz tarifa, juros, aplicação.
    prisma.$queryRaw<{ data: Date; valorCents: number; texto: string; n: bigint; total: bigint }[]>`
      WITH base AS (
        SELECT m.id, m.data, m."valorCents", m."conexaoId", m."contaCorrenteCodigo", m."categoriaCodigo", m."tituloCodigo",
               CONCAT_WS(' ', m.tipo, m.observacao, m."parceiroNome") AS texto
          FROM ${tabela("OmieMovimento")} m
         WHERE m."companyId" = ${companyId}
           AND m.data >= ${periodo.inicio}::timestamp - INTERVAL '1 day' AND m.data <= ${periodo.fim}::timestamp + INTERVAL '1 day'
      ),
      pares AS (
        SELECT DISTINCT a.id
          FROM base a
          JOIN base o ON o."valorCents" = -a."valorCents"
                     AND o.data BETWEEN a.data - INTERVAL '1 day' AND a.data + INTERVAL '1 day'
                     AND (o."conexaoId" <> a."conexaoId" OR o."contaCorrenteCodigo" <> a."contaCorrenteCodigo")
         WHERE a."valorCents" < 0
      )
      SELECT l.data, l."valorCents", l.texto, COUNT(*) OVER ()::bigint AS n, SUM(l."valorCents") OVER ()::bigint AS total
        FROM base l
        LEFT JOIN pares p ON p.id = l.id
       WHERE l."conexaoId" = ${empresa.id}
         AND l."valorCents" < 0
         AND l.data >= ${periodo.inicio} AND l.data <= ${periodo.fim}
         AND l."categoriaCodigo" IS NULL AND l."tituloCodigo" IS NULL AND p.id IS NULL
         AND l.texto !~* 'transf|aplica|resgat|tarifa|\\miof\\M|juros'
       ORDER BY l."valorCents" ASC
       LIMIT 15`,
    prisma.$queryRaw<{ c1: bigint | null; n1: bigint; c2: bigint | null; n2: bigint; c3: bigint | null; n3: bigint }[]>`
      SELECT SUM(saldo) FILTER (WHERE saldo <= 1500000 AND venc < ${seisMeses})::bigint AS c1,
             COUNT(*) FILTER (WHERE saldo <= 1500000 AND venc < ${seisMeses})::bigint AS n1,
             SUM(saldo) FILTER (WHERE saldo > 1500000 AND saldo <= 10000000 AND venc < ${umAno})::bigint AS c2,
             COUNT(*) FILTER (WHERE saldo > 1500000 AND saldo <= 10000000 AND venc < ${umAno})::bigint AS n2,
             SUM(saldo) FILTER (WHERE saldo > 10000000 AND venc < ${umAno})::bigint AS c3,
             COUNT(*) FILTER (WHERE saldo > 10000000 AND venc < ${umAno})::bigint AS n3
        FROM (
          SELECT GREATEST(COALESCE(t."saldoCents", t."valorDocumentoCents" - t."valorPagoCents"), 0) AS saldo, t."dataVencimento" AS venc
            FROM ${tabela("OmieTitulo")} t
           WHERE t."companyId" = ${companyId}
             AND t."conexaoId" = ${empresa.id}
             AND t.natureza = 'RECEBER'
             AND t.cancelado = false
             AND t.liquidado = false
             AND NOT ${doTitulo()}
        ) x
       WHERE saldo > 0`,
    lerPatrimonioDaFrota(companyId),
    lerAdaptacoes(companyId),
    lerHorasDeOperacao(companyId, new Date(hoje.getTime() - 90 * 86_400_000)),
    // O balanço lançado em Indicadores: o da empresa, ou o do grupo na falta dele.
    prisma.balancoPatrimonial.findMany({
      where: { companyId, escopo: { in: [empresa.id, "GRUPO"] } },
      orderBy: { dataBase: "desc" },
      select: { escopo: true, dataBase: true, patrimonioLiquido: true },
    }),
    params.jcpManual.tjlp ? Promise.resolve(null) : lerTjlp(periodo, hoje),
  ]);

  const classificacoes = new Map(guardadas.map((c) => [c.categoriaCodigo, { linha: c.linha, subgrupo: c.subgrupo, confirmada: c.origem === "CONFIRMADA" }]));
  const dre = await montarDreNoBanco(escopo, periodo, anterior, classificacoes, { regime: "competencia", somarRetencoes: false });

  const itens: ItemApuracao[] = [];
  let corporativaForaCents = 0;
  for (const linha of dre.linhas) {
    if (linha.tipo !== "GRUPO") continue;
    for (const i of linha.itens) {
      if (i.valorCents === 0) continue;
      const base = { chave: i.categoriaCodigo, descricao: i.descricao, linha: linha.chave, ehReceita: i.ehReceita };
      // As duas linhas de pessoas já vêm separadas por empresa pelo DRE.
      if (linha.chave === "DESPESA_SALARIOS_CORPORATIVO") {
        itens.push({ ...base, valorCents: i.valorCents, origem: "PESSOAS_CORPORATIVA" });
        continue;
      }
      const p = parcelas.get(i.categoriaCodigo);
      const parte = linha.chave !== "DESPESA_SALARIOS" && p && p.totalCents !== 0 ? p.corpCents / p.totalCents : 0;
      if (parte <= 0) {
        itens.push({ ...base, valorCents: i.valorCents, origem: "EMPRESA" });
        continue;
      }
      const daCorporativa = Math.round(i.valorCents * parte);
      if (i.valorCents - daCorporativa !== 0) itens.push({ ...base, valorCents: i.valorCents - daCorporativa, origem: "EMPRESA" });
      if (TIPOS_DE_PESSOAS.has(tipoDaCategoria(i.descricao, linha.chave).codigo)) itens.push({ ...base, valorCents: daCorporativa, origem: "PESSOAS_CORPORATIVA" });
      else corporativaForaCents += Math.abs(daCorporativa);
    }
  }

  const descricaoDe = new Map(itens.map((i) => [i.chave, i.descricao]));
  const docs: DocumentacaoAgregada[] = documentacao.map((d) => ({
    chave: d.chave,
    descricao: descricaoDe.get(d.chave) ?? d.descricao ?? d.chave,
    pj: d.pj,
    pf: d.pf,
    semDocumentoFiscal: d.sem_doc,
    semBeneficiario: d.sem_benef,
    semRetencao: d.sem_ret,
    cents: Number(d.cents),
    quantidade: Number(d.n),
  }));
  const titulosComPendencia: TituloComPendencia[] = pendentes.map((t) => ({
    ...t,
    descricao: descricaoDe.get(t.chave) ?? (t.descricao || t.chave),
    valorCents: Number(t.valorCents),
    retencaoCents: Number(t.retencaoCents),
  }));
  const maiores: MovimentoSemCausa[] = semCausa.map((m) => ({ data: m.data, valorCents: Math.abs(Number(m.valorCents)), texto: m.texto }));
  const v = vencidos[0];

  // A frota da gestão é da operação (a Azul). Veículo vendido fica fora.
  const ativos = patrimonio.veiculos.filter((x) => !x.dataVenda && x.status !== "INATIVO");
  const comValor = ativos.filter((x) => x.valorCompraCents && x.dataCompra);
  const custo = (x: (typeof comValor)[number]) => (x.valorCompraCents ?? 0) + (adaptacoes.get(x.id) ?? 0);
  const frota =
    ativos.length > 0
      ? {
          veiculos: comValor.length,
          semValor: ativos.length - comValor.length,
          custoCents: comValor.reduce((a, x) => a + custo(x), 0),
          depreciacao20Cents: comValor.reduce((a, x) => a + depreciacaoNoPeriodo(custo(x), new Date(x.dataCompra!), 0.2, periodo), 0),
          depreciacao25Cents: comValor.reduce((a, x) => a + depreciacaoNoPeriodo(custo(x), new Date(x.dataCompra!), 0.25, periodo), 0),
        }
      : null;

  return {
    empresa: empresa.apelido,
    corporativa: corporativa?.apelido ?? null,
    itens,
    corporativaForaCents,
    intercompanyEliminado: { receitaCents: eliminado.receitaCents, despesaCents: eliminado.despesaCents },
    documentacao: docs,
    titulosComPendencia,
    extratoSemCausa: { cents: Math.abs(Number(semCausa[0]?.total ?? 0)), quantidade: Number(semCausa[0]?.n ?? 0), maiores },
    recebiveisVencidos: {
      ate15mil: { cents: Number(v?.c1 ?? 0), quantidade: Number(v?.n1 ?? 0) },
      de15a100mil: { cents: Number(v?.c2 ?? 0), quantidade: Number(v?.n2 ?? 0) },
      acima100mil: { cents: Number(v?.c3 ?? 0), quantidade: Number(v?.n3 ?? 0) },
    },
    frota,
    horas,
    jcp: jcpDoPeriodo(params.jcpManual, balancos.find((b) => b.escopo === empresa.id) ?? balancos[0] ?? null, empresa.apelido, tjlp),
  };
}

const dataCurta = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;

export function jcpDoPeriodo(
  manual: { plCents: number | null; tjlp: number | null },
  balanco: { escopo: string; dataBase: Date; patrimonioLiquido: { toString(): string } } | null,
  empresa: string,
  tjlp: Tjlp | null
): InsumosLucroReal["jcp"] {
  const plDoBalanco = balanco ? Math.round(Number(balanco.patrimonioLiquido.toString()) * 100) : null;
  const plCents = manual.plCents ?? (plDoBalanco && plDoBalanco > 0 ? plDoBalanco : null);
  return {
    plCents,
    tjlp: manual.tjlp ?? tjlp?.mediaAa ?? null,
    fontePl: manual.plCents
      ? "PL digitado na tela"
      : plCents && balanco
        ? `PL do balanço de ${dataCurta(balanco.dataBase)} lançado em Indicadores${balanco.escopo === "GRUPO" ? ` — o do grupo, falta o da ${empresa}` : ""}`
        : null,
    fonteTjlp: manual.tjlp
      ? "TJLP digitada na tela"
      : tjlp
        ? `TJLP média dos ${tjlp.meses} meses, Banco Central (a mesma do BNDES); hoje em ${(tjlp.atualAa * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}% a.a.`
        : null,
  };
}
