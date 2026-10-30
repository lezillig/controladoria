import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { tabela } from "@/lib/esquemaDoBanco";
import { contratosComSituacao, type ContratoComSituacao } from "@/lib/frota/contratosDaGestao";

// A INTEGRAÇÃO COM A GESTÃO — o que a controladoria sabe pela Omie e a gestão
// precisa para fechar os processos dela:
//
//   GET  /api/integracao/financiamentos?empresa=…  cada contrato da gestão
//        conferido nas contas a pagar: pagas, em atraso, não lançadas, saldo,
//        e se a última parcela já foi paga (a gestão encerra o contrato e pede
//        a baixa do gravame);
//   POST /api/integracao/multas  { empresa, multas: [{ ait, dataInfracao }], desde? }
//        o título da Omie de cada AIT (pago? quando? quanto?) e, com `desde`,
//        os títulos de multa sem AIT conhecido (pago sem multa cadastrada).
//
// Quem chama apresenta o INTEGRACAO_TOKEN (o mesmo valor nos dois projetos da
// Vercel) no cabeçalho Authorization. Só leitura: nada aqui grava.

export function integracaoAutorizada(req: Request): boolean | "nao-configurada" {
  const token = process.env.INTEGRACAO_TOKEN?.trim();
  if (!token) return "nao-configurada";
  const a = Buffer.from(req.headers.get("authorization") ?? "");
  const b = Buffer.from(`Bearer ${token}`);
  // Tempo constante: `===` vaza, pelo tempo de resposta, o prefixo correto.
  return a.length === b.length && timingSafeEqual(a, b);
}

const dia = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export type SituacaoParaGestao = {
  id: string;
  parcelasLigadas: number;
  pagas: number | null;
  origemPagas: string;
  restantes: number | null;
  proximoVencimento: string | null;
  saldoCents: number | null;
  ultimoPagamento: string | null;
  atrasadas: { quantidade: number; valorCents: number };
  aVencerNaOmie: { quantidade: number; valorCents: number };
  naoLancadas: number;
  // A última parcela consta paga na Omie e o contrato segue aberto na gestão.
  quitadoNaOmie: boolean;
};

export function situacaoParaGestao(c: ContratoComSituacao): SituacaoParaGestao {
  const s = c.situacao;
  return {
    id: c.id,
    parcelasLigadas: c.pagamentosOmie.length,
    pagas: s.pagas,
    origemPagas: s.origemPagas,
    restantes: s.restantes,
    proximoVencimento: dia(s.proximoVencimento),
    saldoCents: s.saldoCents,
    ultimoPagamento: dia(s.ultimoPagamento),
    atrasadas: s.atrasadas,
    aVencerNaOmie: s.aVencerNaOmie,
    naoLancadas: s.naoLancadas,
    quitadoNaOmie: c.ativo && s.quitado && s.origemPagas === "omie",
  };
}

export async function financiamentosParaGestao(companyId: string, hoje = new Date()) {
  const { contratos, gestaoDisponivel } = await contratosComSituacao(companyId, hoje);
  return { geradoEm: hoje.toISOString(), gestaoDisponivel, contratos: contratos.map(situacaoParaGestao) };
}

// ---- Multas ----

export const CATEGORIA_MULTA = /MULTA|INFRA[CÇ][AÃ]O DE TR[AÂ]NSITO/i;

type TituloOmie = {
  id: string;
  conexaoApelido: string;
  numeroDocumento: string | null;
  observacao: string | null;
  dataVencimento: Date;
  valorDocumentoCents: number;
  valorPagoCents: number;
  liquidado: boolean;
  dataUltimaBaixa: Date | null;
};

export type PagamentoDeMulta = {
  ait: string;
  tituloId: string;
  empresa: string;
  numeroDocumento: string | null;
  vencimento: string;
  valorDocumentoCents: number;
  valorPagoCents: number;
  pago: boolean;
  dataPagamento: string | null;
};

const pago = (t: { liquidado: boolean; valorPagoCents: number; valorDocumentoCents: number }) => t.liquidado || (t.valorPagoCents > 0 && t.valorPagoCents >= t.valorDocumentoCents - 100);

// O AIT como a gestão o guarda vs. como o financeiro digita no título:
// maiúsculas, sem espaço nem traço.
export const normalizarAit = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

// Puro: para cada AIT, o título que o cita no documento ou na observação —
// o pago primeiro, depois o mais recente.
export function casarTitulosComAits(titulos: TituloOmie[], aits: string[]): PagamentoDeMulta[] {
  const textos = titulos.map((t) => ({ t, texto: normalizarAit(`${t.numeroDocumento ?? ""} ${t.observacao ?? ""}`) }));
  const r: PagamentoDeMulta[] = [];
  for (const ait of aits) {
    const achados = textos.filter((x) => x.texto.includes(ait)).map((x) => x.t);
    if (!achados.length) continue;
    const t = achados.sort((a, b) => Number(pago(b)) - Number(pago(a)) || b.dataVencimento.getTime() - a.dataVencimento.getTime())[0];
    r.push({
      ait,
      tituloId: t.id,
      empresa: t.conexaoApelido,
      numeroDocumento: t.numeroDocumento,
      vencimento: dia(t.dataVencimento)!,
      valorDocumentoCents: t.valorDocumentoCents,
      valorPagoCents: t.valorPagoCents,
      pago: pago(t),
      dataPagamento: pago(t) ? dia(t.dataUltimaBaixa) : null,
    });
  }
  return r;
}

export type MultaPedida = { ait: string; dataInfracao: Date };
const SELECAO = { id: true, conexaoApelido: true, numeroDocumento: true, observacao: true, dataVencimento: true, valorDocumentoCents: true, valorPagoCents: true, liquidado: true, dataUltimaBaixa: true, categoriaDescricao: true, parceiroNome: true } as const;

export async function multasParaGestao(companyId: string, multas: MultaPedida[], desde: Date | null) {
  const pedidas = multas.map((m) => ({ ...m, ait: normalizarAit(m.ait) })).filter((m) => m.ait.length >= 6);
  const pagamentos: PagamentoDeMulta[] = [];
  for (let i = 0; i < pedidas.length; i += 40) {
    const lote = pedidas.slice(i, i + 40);
    // O título vem depois da infração: o filtro por data poupa a busca.
    const inicio = new Date(Math.min(...lote.map((m) => m.dataInfracao.getTime())) - 30 * 86_400_000);
    // O financeiro digita o AIT como vem no boleto ("1DK-231.2751"): a busca
    // compara sem pontuação nem espaço, dos dois lados.
    const padroes = lote.map((m) => `%${m.ait}%`);
    const achados = await prisma.$queryRaw<{ id: string }[]>`
      SELECT t.id FROM ${tabela("OmieTitulo")} t
       WHERE t."companyId" = ${companyId} AND t.natureza = 'PAGAR' AND NOT t.cancelado AND t."dataVencimento" >= ${inicio}
         AND regexp_replace(upper(coalesce(t."numeroDocumento", '') || ' ' || coalesce(t.observacao, '')), '[^A-Z0-9]', '', 'g') LIKE ANY (${padroes})`;
    if (!achados.length) continue;
    const titulos = await prisma.omieTitulo.findMany({ where: { id: { in: achados.map((x) => x.id) } }, select: SELECAO });
    pagamentos.push(...casarTitulosComAits(titulos, lote.map((m) => m.ait)));
  }
  // Pago e sem multa: título de multa na Omie que não cita nenhum AIT pedido.
  let semMulta: Omit<PagamentoDeMulta, "ait">[] | null = null;
  if (desde) {
    const ligados = new Set(pagamentos.map((p) => p.tituloId));
    const aits = pedidas.map((m) => m.ait);
    const titulos = await prisma.omieTitulo.findMany({
      where: { companyId, natureza: "PAGAR", cancelado: false, dataVencimento: { gte: desde }, categoriaDescricao: { contains: "MULTA", mode: "insensitive" } },
      select: SELECAO,
      orderBy: { dataVencimento: "desc" },
      take: 500,
    });
    semMulta = titulos
      .filter((t) => CATEGORIA_MULTA.test(t.categoriaDescricao ?? "") && !ligados.has(t.id))
      .filter((t) => {
        const texto = normalizarAit(`${t.numeroDocumento ?? ""} ${t.observacao ?? ""}`);
        return !aits.some((a) => texto.includes(a));
      })
      .map((t) => ({ tituloId: t.id, empresa: t.conexaoApelido, numeroDocumento: t.numeroDocumento, vencimento: dia(t.dataVencimento)!, valorDocumentoCents: t.valorDocumentoCents, valorPagoCents: t.valorPagoCents, pago: pago(t), dataPagamento: pago(t) ? dia(t.dataUltimaBaixa) : null }));
  }
  return { geradoEm: new Date().toISOString(), pagamentos, semMulta };
}
