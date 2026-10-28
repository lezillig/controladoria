import { prisma } from "@/lib/prisma";

// CONFERÊNCIA COM A OMIE, TÍTULO A TÍTULO — "entrou tudo?".
//
// Para um mês, uma empresa e uma natureza, busca NA HORA, na Omie, todos os
// títulos pelo critério que o DRE usa e compara um a um com o que o sistema
// tem gravado:
//
//   competência — a pagar pelo VENCIMENTO, a receber pela EMISSÃO da nota
//                 (competencia.ts);
//   caixa       — pelas BAIXAS com data no mês (pagamento/recebimento).
//
// Diferenças, cada uma com a sua causa provável:
//   falta no sistema ...... está na Omie e não aqui (sincronização não trouxe);
//   sobra no sistema ...... está aqui e a Omie não devolveu (excluído na Omie,
//                           data mudada lá, ou título duplicado aqui);
//   valor diferente ....... alterado na Omie depois da última leitura;
//   data diferente ........ idem, com a data que decide o mês;
//   cancelado diferente ... cancelado de um lado e vivo do outro.
//
// A comparação é pelo código do lançamento na Omie (nCodTitulo), o mesmo que o
// sistema grava. Sem banco nem Omie aqui dentro: `compararComOmie` é pura.

export type Criterio = "competencia" | "caixa";
export type Natureza = "PAGAR" | "RECEBER";

export type TituloComparavel = {
  codigo: string;
  parceiro: string | null;
  documento: string | null;
  parcela: string | null;
  categoria: string | null;
  emissao: Date | null;
  vencimento: Date;
  valorCents: number;
  cancelado: boolean;
  // Caixa: soma das baixas com data no mês, e a última delas.
  baixadoNoMesCents: number;
  ultimaBaixaNoMes: Date | null;
};

export type Diferenca = {
  tipo: "falta" | "sobra" | "valor" | "data" | "cancelado";
  codigo: string;
  parceiro: string | null;
  documento: string | null;
  parcela: string | null;
  categoria: string | null;
  omie: string;
  sistema: string;
  impactoCents: number;
};

export type ResultadoConferencia = {
  totalOmieCents: number;
  totalSistemaCents: number;
  titulosOmie: number;
  titulosSistema: number;
  iguais: number;
  diferencas: Diferenca[];
};

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10).split("-").reverse().join("/") : "—");
const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// O valor que conta no critério: competência = valor do título (não
// cancelado); caixa = o que foi baixado no mês.
const valorNoCriterio = (t: TituloComparavel, criterio: Criterio) => (t.cancelado ? 0 : criterio === "caixa" ? t.baixadoNoMesCents : t.valorCents);

export function compararComOmie(params: {
  omie: TituloComparavel[];
  sistema: TituloComparavel[];
  // Todos os títulos do sistema com os códigos da Omie, mesmo fora do mês:
  // separa "falta" (não existe aqui) de "data diferente" (existe, em outro mês).
  sistemaPorCodigo: Map<string, TituloComparavel>;
  criterio: Criterio;
  natureza: Natureza;
}): ResultadoConferencia {
  const { criterio, natureza } = params;
  const doMes = new Map(params.sistema.map((t) => [t.codigo, t]));
  const daOmie = new Map(params.omie.map((t) => [t.codigo, t]));
  const diferencas: Diferenca[] = [];
  let iguais = 0;
  const base = (t: TituloComparavel) => ({ codigo: t.codigo, parceiro: t.parceiro, documento: t.documento, parcela: t.parcela, categoria: t.categoria });
  const dataQueDecide = (t: TituloComparavel) => (criterio === "caixa" ? t.ultimaBaixaNoMes : natureza === "PAGAR" ? t.vencimento : (t.emissao ?? t.vencimento));

  for (const o of params.omie) {
    const s = doMes.get(o.codigo);
    const vo = valorNoCriterio(o, criterio);
    if (!s) {
      if (vo === 0) {
        iguais++;
        continue;
      }
      const emOutroMes = params.sistemaPorCodigo.get(o.codigo);
      diferencas.push({
        ...base(o),
        tipo: emOutroMes ? "data" : "falta",
        omie: `${brl(vo)} · ${criterio === "caixa" ? `baixa ${iso(o.ultimaBaixaNoMes)}` : `${natureza === "PAGAR" ? "venc." : "emissão"} ${iso(dataQueDecide(o))}`}`,
        sistema: emOutroMes
          ? `${emOutroMes.cancelado ? "cancelado · " : ""}${criterio === "caixa" ? `baixas no mês ${brl(emOutroMes.baixadoNoMesCents)}` : `${natureza === "PAGAR" ? "venc." : "emissão"} ${iso(dataQueDecide(emOutroMes))}`}`
          : "não existe no sistema",
        impactoCents: vo,
      });
      continue;
    }
    const vs = valorNoCriterio(s, criterio);
    if (o.cancelado !== s.cancelado) {
      diferencas.push({ ...base(o), tipo: "cancelado", omie: o.cancelado ? "cancelado" : `vivo ${brl(o.valorCents)}`, sistema: s.cancelado ? "cancelado" : `vivo ${brl(s.valorCents)}`, impactoCents: vo - vs });
    } else if (vo !== vs) {
      diferencas.push({ ...base(o), tipo: "valor", omie: brl(vo), sistema: brl(vs), impactoCents: vo - vs });
    } else iguais++;
  }
  for (const s of params.sistema) {
    if (daOmie.has(s.codigo)) continue;
    const vs = valorNoCriterio(s, criterio);
    if (vs === 0) continue;
    diferencas.push({
      ...base(s),
      tipo: "sobra",
      omie: "a Omie não devolveu neste mês",
      sistema: `${brl(vs)} · ${criterio === "caixa" ? `baixa ${iso(s.ultimaBaixaNoMes)}` : `${natureza === "PAGAR" ? "venc." : "emissão"} ${iso(dataQueDecide(s))}`}`,
      impactoCents: -vs,
    });
  }
  diferencas.sort((a, b) => Math.abs(b.impactoCents) - Math.abs(a.impactoCents));
  return {
    totalOmieCents: params.omie.reduce((s, t) => s + valorNoCriterio(t, criterio), 0),
    totalSistemaCents: params.sistema.reduce((s, t) => s + valorNoCriterio(t, criterio), 0),
    titulosOmie: params.omie.filter((t) => valorNoCriterio(t, criterio) !== 0).length,
    titulosSistema: params.sistema.filter((t) => valorNoCriterio(t, criterio) !== 0).length,
    iguais,
    diferencas,
  };
}

// ---- A colheita: Omie na hora, sistema no banco ----

const POR_PAGINA = 200;

export async function conferirComOmie(params: { companyId: string; conexaoId: string; natureza: Natureza; criterio: Criterio; ano: number; mes: number; prazo: number }) {
  const { omieCall, OMIE_ENDPOINTS, OMIE_PACE_MS, extrairTotalPaginas } = await import("@/lib/omie/client");
  const { extrairItens } = await import("@/lib/omie/client");
  const { formatarDataOmie, normalizarTitulo } = await import("@/lib/omie/mapping");
  const { natureza, criterio, ano, mes } = params;
  const conexao = await prisma.omieConexao.findFirst({ where: { id: params.conexaoId, companyId: params.companyId }, select: { id: true, apelido: true, credencialRef: true } });
  if (!conexao) throw new Error("Empresa não encontrada.");

  const inicio = new Date(Date.UTC(ano, mes - 1, 1));
  const fim = new Date(Date.UTC(ano, mes, 0, 23, 59, 59, 999));
  const dentro = (d: Date | null) => !!d && d >= inicio && d <= fim;
  const de = formatarDataOmie(new Date(ano, mes - 1, 1));
  const ate = formatarDataOmie(new Date(ano, mes, 0));
  const filtro =
    criterio === "caixa" ? { dDtPagtoDe: de, dDtPagtoAte: ate } : natureza === "PAGAR" ? { dDtVencDe: de, dDtVencAte: ate } : { dDtEmisDe: de, dDtEmisAte: ate };

  // OMIE: todas as páginas.
  const omie: TituloComparavel[] = [];
  let pagina = 1;
  let paginas = 1;
  let incompleto = false;
  do {
    if (Date.now() > params.prazo) {
      incompleto = true;
      break;
    }
    const r = await omieCall(
      OMIE_ENDPOINTS.titulos,
      { nPagina: pagina, nRegPorPagina: POR_PAGINA, cNatureza: natureza === "PAGAR" ? "P" : "R", ...filtro },
      { credencialRef: conexao.credencialRef, toleraVazio: true, deadline: params.prazo + 10_000 }
    );
    if (!r) break;
    paginas = Math.max(1, extrairTotalPaginas(r as Record<string, unknown>));
    for (const bruto of extrairItens(r, OMIE_ENDPOINTS.titulos)) {
      const t = normalizarTitulo(bruto as Record<string, unknown>, natureza);
      if (!t) continue;
      const noMes = t.baixas.filter((b) => dentro(b.dataBaixa));
      omie.push({
        codigo: t.codigoLancamento,
        parceiro: t.parceiroNome,
        documento: t.numeroDocumento,
        parcela: t.numeroParcela,
        categoria: t.categoriaDescricao,
        emissao: t.dataEmissao,
        vencimento: t.dataVencimento,
        valorCents: t.valorDocumentoCents,
        cancelado: t.cancelado,
        baixadoNoMesCents: noMes.reduce((s, b) => s + Math.abs(b.valorCents), 0),
        ultimaBaixaNoMes: noMes.reduce<Date | null>((m, b) => (!m || b.dataBaixa > m ? b.dataBaixa : m), null),
      });
    }
    pagina++;
    await new Promise((ok) => setTimeout(ok, OMIE_PACE_MS));
  } while (pagina <= paginas);

  // SISTEMA: o mesmo critério.
  const selecao = {
    codigoLancamento: true, parceiroNome: true, numeroDocumento: true, numeroParcela: true, categoriaDescricao: true,
    dataEmissao: true, dataVencimento: true, valorDocumentoCents: true, cancelado: true,
    baixas: { select: { dataBaixa: true, valorCents: true } },
  } as const;
  const ondeMes =
    criterio === "caixa"
      ? { baixas: { some: { dataBaixa: { gte: inicio, lte: fim } } } }
      : natureza === "PAGAR"
        ? { dataVencimento: { gte: inicio, lte: fim } }
        : { OR: [{ dataEmissao: { gte: inicio, lte: fim } }, { dataEmissao: null, dataVencimento: { gte: inicio, lte: fim } }] };
  type Linha = Awaited<ReturnType<typeof prisma.omieTitulo.findMany<{ select: typeof selecao }>>>[number];
  const comoComparavel = (t: Linha): TituloComparavel => {
    const noMes = t.baixas.filter((b) => dentro(b.dataBaixa));
    return {
      codigo: t.codigoLancamento,
      parceiro: t.parceiroNome,
      documento: t.numeroDocumento,
      parcela: t.numeroParcela,
      categoria: t.categoriaDescricao,
      emissao: t.dataEmissao,
      vencimento: t.dataVencimento,
      valorCents: t.valorDocumentoCents,
      cancelado: t.cancelado,
      baixadoNoMesCents: noMes.reduce((s, b) => s + Math.abs(b.valorCents), 0),
      ultimaBaixaNoMes: noMes.reduce<Date | null>((m, b) => (!m || b.dataBaixa > m ? b.dataBaixa : m), null),
    };
  };
  const [sistema, outros] = await Promise.all([
    prisma.omieTitulo.findMany({ where: { conexaoId: conexao.id, natureza, ...ondeMes }, select: selecao }),
    prisma.omieTitulo.findMany({ where: { conexaoId: conexao.id, natureza, codigoLancamento: { in: omie.map((t) => t.codigo) } }, select: selecao }),
  ]);

  const resultado = compararComOmie({
    omie,
    sistema: sistema.map(comoComparavel),
    sistemaPorCodigo: new Map(outros.map((t) => [t.codigoLancamento, comoComparavel(t)])),
    criterio,
    natureza,
  });
  return { empresa: conexao.apelido, paginas, incompleto, ...resultado };
}

// As quatro leituras (a pagar e a receber, por competência e por caixa) de
// cada empresa, uma de cada vez, até o prazo da página.
export async function conferirTudoComOmie(params: { companyId: string; conexoes: { id: string; apelido: string }[]; ano: number; mes: number; segundos?: number }) {
  const prazo = Date.now() + (params.segundos ?? 240) * 1000;
  const r: (Awaited<ReturnType<typeof conferirComOmie>> & { natureza: Natureza; criterio: Criterio; erro?: string })[] = [];
  for (const cx of params.conexoes)
    for (const natureza of ["PAGAR", "RECEBER"] as const)
      for (const criterio of ["competencia", "caixa"] as const) {
        if (Date.now() > prazo) {
          r.push({ empresa: cx.apelido, natureza, criterio, paginas: 0, incompleto: true, totalOmieCents: 0, totalSistemaCents: 0, titulosOmie: 0, titulosSistema: 0, iguais: 0, diferencas: [], erro: "sem tempo — confira esta empresa sozinha" });
          continue;
        }
        try {
          r.push({ ...(await conferirComOmie({ companyId: params.companyId, conexaoId: cx.id, natureza, criterio, ano: params.ano, mes: params.mes, prazo })), natureza, criterio });
        } catch (e) {
          r.push({ empresa: cx.apelido, natureza, criterio, paginas: 0, incompleto: true, totalOmieCents: 0, totalSistemaCents: 0, titulosOmie: 0, titulosSistema: 0, iguais: 0, diferencas: [], erro: e instanceof Error ? e.message.slice(0, 200) : "erro" });
        }
      }
  return r;
}
