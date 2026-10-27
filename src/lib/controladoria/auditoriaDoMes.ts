import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tabela } from "@/lib/esquemaDoBanco";
import { LINHAS_DRE, linhaDaCategoria } from "./dre";
import { categoriasDoEscopo, movimentoPorCategoria } from "./dreNoBanco";
import { classificacoesDoDre } from "./projecaoNoBanco";
import { categoriaSql, filtroConexaoTitulo } from "./escopoSql";
import { competenciaSql } from "./competencia";

// AUDITORIA DO DRE DE UM MÊS — "estão entrando todas as despesas?".
//
// O DRE é por COMPETÊNCIA (competencia.ts): despesa no mês do VENCIMENTO,
// receita no da emissão da nota. Um mês que parece vazio tem três explicações,
// e esta auditoria separa cada uma, linha a linha do DRE:
//
//   1. O TÍTULO ESTÁ AQUI, MAS EM OUTRO MÊS: pagamento atrasado de um mês
//      anterior ou adiantado do seguinte — "pago no mês, contado em outro".
//   2. O TÍTULO AINDA NÃO FOI LANÇADO NA OMIE: a folha e as notas de fim de mês
//      entram depois. Aparece comparando com o que os meses anteriores já
//      tinham registrado no mesmo dia (data de registro na Omie).
//   3. O TÍTULO ESTÁ NA OMIE E NÃO CHEGOU AQUI (falha de sincronização):
//      aparece na contagem contra a Omie, feita na hora (contagemNaOmie).

export type LinhaDaAuditoria = {
  chave: string;
  rotulo: string;
  natureza: "PAGAR" | "RECEBER";
  competenciaCents: number;
  vencimentoCents: number;
  pagoCents: number;
  // Pago no mês, de título com competência em outro mês.
  pagoForaCents: number;
  categorias: { categoria: string; competenciaCents: number; vencimentoCents: number; pagoCents: number; pagoForaCents: number }[];
};

export type PagoForaDoMes = {
  parceiro: string | null;
  categoria: string | null;
  linha: string;
  documento: string | null;
  parcela: string | null;
  emissao: Date | null;
  vencimento: Date;
  pagoEm: Date;
  pagoCents: number;
  competencia: string;
};

export type Maturidade = { mes: string; ateODiaCents: number; totalCents: number; percentual: number | null };

type Soma = { categoria: string; natureza: string; comp: bigint | null; venc: bigint | null };
type SomaPago = { categoria: string; natureza: string; pago: bigint | null; fora: bigint | null };

const ROTULO = new Map(LINHAS_DRE.map((l) => [l.chave as string, l.rotulo.replace(/^\(\W\)\s*|^=\s*/, "")]));
const ORDEM = new Map(LINHAS_DRE.map((l, i) => [l.chave as string, i]));
const mesDe = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

export async function auditoriaDoMes(params: { companyId: string; conexaoId: string | null; ano: number; mes: number; diaDeCorte: number }) {
  const { companyId, conexaoId, ano, mes } = params;
  const inicio = new Date(Date.UTC(ano, mes - 1, 1));
  const fim = new Date(Date.UTC(ano, mes, 0, 23, 59, 59, 999));
  const filtro = filtroConexaoTitulo(conexaoId, companyId);
  const janela = { desde: new Date(Date.UTC(ano - 1, mes - 1, 1)), ate: fim };

  const [somas, pagos, lista, classificacoes, categorias, movimento, maturidade] = await Promise.all([
    prisma.$queryRaw<Soma[]>`
      SELECT ${categoriaSql()} AS categoria, t.natureza::text AS natureza,
             SUM(t."valorDocumentoCents") FILTER (WHERE ${competenciaSql("t")} BETWEEN ${inicio} AND ${fim})::bigint AS comp,
             SUM(t."valorDocumentoCents") FILTER (WHERE t."dataVencimento" BETWEEN ${inicio} AND ${fim})::bigint AS venc
        FROM ${tabela("OmieTitulo")} t
       WHERE t."companyId" = ${companyId} AND t.cancelado = false
         AND (${competenciaSql("t")} BETWEEN ${inicio} AND ${fim} OR t."dataVencimento" BETWEEN ${inicio} AND ${fim})
         ${filtro}
       GROUP BY 1, 2`,
    prisma.$queryRaw<SomaPago[]>`
      SELECT ${categoriaSql()} AS categoria, t.natureza::text AS natureza,
             SUM(b."valorCents")::bigint AS pago,
             SUM(b."valorCents") FILTER (WHERE ${competenciaSql("t")} NOT BETWEEN ${inicio} AND ${fim})::bigint AS fora
        FROM ${tabela("OmieBaixa")} b
        JOIN ${tabela("OmieTitulo")} t ON t.id = b."tituloId"
       WHERE b."companyId" = ${companyId} AND t.cancelado = false
         AND b."dataBaixa" BETWEEN ${inicio} AND ${fim}
         ${filtro}
       GROUP BY 1, 2`,
    prisma.$queryRaw<{ parceiro: string | null; categoria: string | null; chave: string; documento: string | null; parcela: string | null; emissao: Date | null; vencimento: Date; pago_em: Date; pago: bigint; comp: Date }[]>`
      SELECT t."parceiroNome" AS parceiro, t."categoriaDescricao" AS categoria, ${categoriaSql()} AS chave,
             t."numeroDocumento" AS documento, t."numeroParcela" AS parcela, t."dataEmissao" AS emissao, t."dataVencimento" AS vencimento,
             MAX(b."dataBaixa") AS pago_em, SUM(b."valorCents")::bigint AS pago, ${competenciaSql("t")} AS comp
        FROM ${tabela("OmieBaixa")} b
        JOIN ${tabela("OmieTitulo")} t ON t.id = b."tituloId"
       WHERE b."companyId" = ${companyId} AND t.cancelado = false AND t.natureza = 'PAGAR'
         AND b."dataBaixa" BETWEEN ${inicio} AND ${fim}
         AND ${competenciaSql("t")} NOT BETWEEN ${inicio} AND ${fim}
         ${filtro}
       GROUP BY t.id
       ORDER BY SUM(b."valorCents") DESC
       LIMIT 300`,
    classificacoesDoDre(companyId),
    categoriasDoEscopo({ companyId, conexaoId, janela }),
    movimentoPorCategoria({ companyId, conexaoId, janela }),
    maturidadeDasDespesas({ companyId, conexaoId, ano, mes, dia: params.diaDeCorte }),
  ]);

  const linhaDe = (categoria: string, natureza: string) =>
    categoria === "SEM_CATEGORIA" ? (natureza === "RECEBER" ? "RECEITA_BRUTA" : "DESPESA_GERAL") : linhaDaCategoria(categoria, classificacoes, categorias, movimento);
  const nomeCategoria = (k: string) => categorias.get(k)?.descricao ?? (k === "SEM_CATEGORIA" ? "Sem categoria" : k);

  const linhas = new Map<string, LinhaDaAuditoria>();
  const pegar = (categoria: string, natureza: string) => {
    const chave = linhaDe(categoria, natureza);
    const k = `${chave}|${natureza}`;
    let l = linhas.get(k);
    if (!l) {
      l = { chave, rotulo: ROTULO.get(chave) ?? chave, natureza: natureza as "PAGAR" | "RECEBER", competenciaCents: 0, vencimentoCents: 0, pagoCents: 0, pagoForaCents: 0, categorias: [] };
      linhas.set(k, l);
    }
    let c = l.categorias.find((x) => x.categoria === nomeCategoria(categoria));
    if (!c) {
      c = { categoria: nomeCategoria(categoria), competenciaCents: 0, vencimentoCents: 0, pagoCents: 0, pagoForaCents: 0 };
      l.categorias.push(c);
    }
    return { l, c };
  };
  for (const s of somas) {
    const { l, c } = pegar(s.categoria, s.natureza);
    l.competenciaCents += Number(s.comp ?? 0);
    l.vencimentoCents += Number(s.venc ?? 0);
    c.competenciaCents += Number(s.comp ?? 0);
    c.vencimentoCents += Number(s.venc ?? 0);
  }
  for (const p of pagos) {
    const { l, c } = pegar(p.categoria, p.natureza);
    l.pagoCents += Number(p.pago ?? 0);
    l.pagoForaCents += Number(p.fora ?? 0);
    c.pagoCents += Number(p.pago ?? 0);
    c.pagoForaCents += Number(p.fora ?? 0);
  }
  for (const l of linhas.values()) l.categorias.sort((a, b) => Math.max(b.competenciaCents, b.pagoCents, b.vencimentoCents) - Math.max(a.competenciaCents, a.pagoCents, a.vencimentoCents));

  return {
    linhas: [...linhas.values()].sort((a, b) => (ORDEM.get(a.chave) ?? 99) - (ORDEM.get(b.chave) ?? 99) || a.natureza.localeCompare(b.natureza)),
    pagosForaDoMes: lista.map(
      (x): PagoForaDoMes => ({
        parceiro: x.parceiro,
        categoria: x.categoria,
        linha: ROTULO.get(linhaDe(x.chave, "PAGAR")) ?? "",
        documento: x.documento,
        parcela: x.parcela,
        emissao: x.emissao,
        vencimento: x.vencimento,
        pagoEm: x.pago_em,
        pagoCents: Number(x.pago),
        competencia: mesDe(x.comp),
      })
    ),
    maturidade,
  };
}

// QUANTO DAS DESPESAS DO MÊS JÁ ESTAVA LANÇADO NO MESMO DIA, nos meses
// anteriores: soma dos títulos a pagar de competência do mês com data de
// registro na Omie até o dia de corte, contra o total que o mês acabou tendo.
// Se outubro, no dia 27, tem 40% do que setembro fechou e setembro no dia 27
// também tinha 40%, é calendário; se setembro tinha 90%, falta lançamento.
async function maturidadeDasDespesas(params: { companyId: string; conexaoId: string | null; ano: number; mes: number; dia: number }): Promise<Maturidade[]> {
  const meses = [0, 1, 2, 3].map((k) => {
    const d = new Date(Date.UTC(params.ano, params.mes - 1 - k, 1));
    return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1 };
  });
  const filtro = filtroConexaoTitulo(params.conexaoId, params.companyId);
  return Promise.all(
    meses.map(async (m) => {
      const inicio = new Date(Date.UTC(m.ano, m.mes - 1, 1));
      const fim = new Date(Date.UTC(m.ano, m.mes, 0, 23, 59, 59, 999));
      const ultimoDia = new Date(Date.UTC(m.ano, m.mes, 0)).getUTCDate();
      const corte = new Date(Date.UTC(m.ano, m.mes - 1, Math.min(params.dia, ultimoDia), 23, 59, 59, 999));
      const [r] = await prisma.$queryRaw<{ total: bigint | null; ate: bigint | null }[]>`
        SELECT SUM(t."valorDocumentoCents")::bigint AS total,
               SUM(t."valorDocumentoCents") FILTER (WHERE COALESCE(t."dataRegistro", t."dataEmissao") <= ${corte})::bigint AS ate
          FROM ${tabela("OmieTitulo")} t
         WHERE t."companyId" = ${params.companyId} AND t.cancelado = false AND t.natureza = 'PAGAR'
           AND ${competenciaSql("t")} BETWEEN ${inicio} AND ${fim}
           ${filtro}`;
      const total = Number(r?.total ?? 0);
      const ate = Number(r?.ate ?? 0);
      return { mes: `${m.ano}-${String(m.mes).padStart(2, "0")}`, ateODiaCents: ate, totalCents: total, percentual: total > 0 ? ate / total : null };
    })
  );
}

// A CONTAGEM CONTRA A OMIE, na hora: quantos títulos a Omie tem com emissão e
// com vencimento no mês, e quantos o sistema tem com o mesmo critério
// (cancelados inclusive, como a Omie conta). Diferença = sincronização que não
// trouxe tudo.
export async function contagemNaOmie(params: { companyId: string; ano: number; mes: number }) {
  const { omieCall, OMIE_ENDPOINTS, extrairTotalRegistros } = await import("@/lib/omie/client");
  const { formatarDataOmie } = await import("@/lib/omie/mapping");
  const inicio = new Date(params.ano, params.mes - 1, 1);
  const fim = new Date(params.ano, params.mes, 0);
  const de = formatarDataOmie(inicio);
  const ate = formatarDataOmie(fim);
  const inicioUtc = new Date(Date.UTC(params.ano, params.mes - 1, 1));
  const fimUtc = new Date(Date.UTC(params.ano, params.mes, 0, 23, 59, 59, 999));
  const conexoes = await prisma.omieConexao.findMany({ where: { companyId: params.companyId, ativa: true }, orderBy: { ordem: "asc" }, select: { id: true, apelido: true, credencialRef: true } });
  const linhas: { empresa: string; natureza: "PAGAR" | "RECEBER"; criterio: "emissão" | "vencimento"; omie: number | null; sistema: number; erro: string | null }[] = [];
  for (const cx of conexoes) {
    for (const natureza of ["PAGAR", "RECEBER"] as const) {
      for (const criterio of ["emissão", "vencimento"] as const) {
        const filtroOmie = criterio === "emissão" ? { dDtEmisDe: de, dDtEmisAte: ate } : { dDtVencDe: de, dDtVencAte: ate };
        let omie: number | null = null;
        let erro: string | null = null;
        try {
          const r = await omieCall(OMIE_ENDPOINTS.titulos, { nPagina: 1, nRegPorPagina: 1, cNatureza: natureza === "PAGAR" ? "P" : "R", ...filtroOmie }, { credencialRef: cx.credencialRef, toleraVazio: true, deadline: Date.now() + 20_000 });
          omie = extrairTotalRegistros(r as Record<string, unknown>);
        } catch (e) {
          erro = e instanceof Error ? e.message.slice(0, 160) : "erro";
          if (/vazio|n[aã]o existem registros/i.test(erro)) {
            omie = 0;
            erro = null;
          }
        }
        const campo = criterio === "emissão" ? "dataEmissao" : "dataVencimento";
        const sistema = await prisma.omieTitulo.count({ where: { conexaoId: cx.id, natureza, [campo]: { gte: inicioUtc, lte: fimUtc } } });
        linhas.push({ empresa: cx.apelido, natureza, criterio, omie, sistema, erro });
      }
    }
  }
  return linhas;
}
