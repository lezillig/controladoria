import type { OmieTitulo } from "@prisma/client";
import { cteAutorizado } from "@/lib/omie/mapping";
import { LINHAS_DRE, subtotaisDoDre } from "./dre";
import { casarCtesComTitulos } from "./cte";
import { emAberto, saldoAberto, titulosAtivos } from "./agents/comum";
import { entraNoResultado } from "./intercompany";
import { dataDeCompetencia } from "./competencia";
import { dentro, diasEntre, fimDoMes, inicioDoDia, inicioDoMes, type Periodo } from "./periodos";
import type { ContextoAuditoria } from "./types";

// O MÊS SE FORMANDO — ver o resultado enquanto ainda dá para agir, e não só
// no fechamento. Quatro leituras, todas sobre o que o sistema já carrega:
//
//   1. PRONTIDÃO DO FECHAMENTO: quanto do mês já está pronto para fechar
//      (classificado, conciliado, com documento fiscal, CT-e casado).
//   2. VENDEU MAIS E GANHOU MENOS: receita do último mês fechado no nível dos
//      três anteriores ou acima, e margem abaixo — o alarme que o faturamento
//      sozinho não dá.
//   3. COBRANÇA DO DIA: o que vence nos próximos dias e o que venceu há pouco,
//      por cliente — cobrar enquanto dá tempo, em vez de ver no aging.
//   4. PREVISÃO DE FECHAMENTO: o resultado provável do mês em curso, com o
//      que já foi lançado e o que costuma entrar e sair.

// ---------------------------------------------------------------------------
// Tipos mínimos do DRE (o de montarDreNoBanco e o dos doze meses)
// ---------------------------------------------------------------------------

type LinhaDoDre = {
  chave: string;
  tipo: "GRUPO" | "SUBTOTAL";
  valorCents: number;
  // As categorias da linha (o DRE da tela as traz): é por elas que se mede o
  // quanto está classificado.
  itens?: { categoriaCodigo: string; valorCents: number; confirmada: boolean }[];
};
export type DreDoMes = { linhas: LinhaDoDre[]; naoConfirmadoCents: number; semCategoriaCents: number };
// Valor de cada linha do DRE por mês (módulo nas despesas), meses fechados do
// mais antigo ao mais recente — o formato de carregarDreDosMeses.
export type SerieDoDre = { meses: string[]; linhasDre: Record<string, number[]> };

const GRUPOS = LINHAS_DRE.filter((l) => l.tipo === "GRUPO").map((l) => l.chave as string);
const ROTULO = new Map(LINHAS_DRE.map((l) => [l.chave as string, l.rotulo.replace(/^\(-\) |^\(\+\) |^= /, "")]));
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const rotuloDoMes = (chave: string) => {
  const [ano, mes] = chave.split("-");
  return `${MESES[Number(mes) - 1]}/${ano.slice(2)}`;
};

// ---------------------------------------------------------------------------
// 1. Prontidão do fechamento
// ---------------------------------------------------------------------------

export type ItemDoFechamento = {
  chave: "CLASSIFICACAO" | "CONCILIACAO" | "DOCUMENTO_FISCAL" | "CTE";
  rotulo: string;
  // 0 a 1; null quando não há base (nada a conferir naquele item).
  pronto: number | null;
  // O que falta, em palavras, e o valor envolvido.
  falta: string;
  faltaCents: number;
  onde: string;
};

export type ProntidaoDoFechamento = {
  periodo: Periodo;
  // "fechando" nos dez primeiros dias do mês seguinte; "em curso" depois.
  momento: "FECHANDO" | "EM_CURSO";
  pronto: number | null;
  itens: ItemDoFechamento[];
};

// O mês que está sendo fechado: nos dez primeiros dias, o anterior; depois, o
// próprio mês (acompanhado desde já, para o dia 30 não ter surpresa).
export function mesDoFechamento(dataReferencia: Date): { periodo: Periodo; momento: ProntidaoDoFechamento["momento"] } {
  const d = inicioDoDia(dataReferencia);
  const inicio = d.getDate() <= 10 ? new Date(d.getFullYear(), d.getMonth() - 1, 1) : inicioDoMes(d);
  const rotulo = `${MESES[inicio.getMonth()]}/${String(inicio.getFullYear()).slice(2)}`;
  return { periodo: { inicio, fim: fimDoMes(inicio), rotulo }, momento: d.getDate() <= 10 ? "FECHANDO" : "EM_CURSO" };
}

// Tipo de documento que é nota ou conhecimento de transporte.
const DOCUMENTO_FISCAL = /^(NFS|NFSE|NFS-E|NF|NFE|NF-E|CTE|CT-E|CTRC)$/i;
const temDocumentoFiscal = (t: Pick<OmieTitulo, "tipoDocumento" | "numeroDocumento" | "chaveNfe">) =>
  Boolean(t.chaveNfe) || (DOCUMENTO_FISCAL.test((t.tipoDocumento ?? "").trim()) && /\d/.test(t.numeroDocumento ?? ""));

export function prontidaoDoFechamento(ctx: ContextoAuditoria, dreDoMes: DreDoMes, periodo: Periodo, momento: ProntidaoDoFechamento["momento"]): ProntidaoDoFechamento {
  const itens: ItemDoFechamento[] = [];

  // Classificação: movimento do mês em categoria que alguém confirmou, pelas
  // categorias de cada linha (o total da linha compensa receita e despesa
  // dentro dela e não serve de base). A retenção na fonte é um agregado
  // calculado, não categoria. Sem as categorias, pelo total das linhas.
  const grupos = dreDoMes.linhas.filter((l) => l.tipo === "GRUPO");
  const comItens = grupos.some((l) => l.itens !== undefined);
  const itensDoMes = grupos.flatMap((l) => l.itens ?? []).filter((i) => i.categoriaCodigo !== "RETENCAO_NA_FONTE");
  const movimento =
    (comItens ? itensDoMes.reduce((a, i) => a + Math.abs(i.valorCents), 0) : grupos.reduce((a, l) => a + Math.abs(l.valorCents), 0)) + Math.abs(dreDoMes.semCategoriaCents);
  const semClassificar =
    (comItens ? itensDoMes.filter((i) => !i.confirmada).reduce((a, i) => a + Math.abs(i.valorCents), 0) : Math.abs(dreDoMes.naoConfirmadoCents)) + Math.abs(dreDoMes.semCategoriaCents);
  itens.push({
    chave: "CLASSIFICACAO",
    rotulo: "Categorias classificadas no DRE",
    pronto: movimento > 0 ? Math.max(0, 1 - semClassificar / movimento) : null,
    falta: semClassificar > 0 ? "movimento em categoria não confirmada ou sem categoria" : "tudo classificado",
    faltaCents: semClassificar,
    onde: "/custos",
  });

  // Conciliação: linhas do extrato do mês marcadas como conciliadas.
  const movimentos = ctx.movimentos.filter((m) => dentro(m.data, periodo) && (!ctx.conexaoId || m.conexaoId === ctx.conexaoId));
  const pendentes = movimentos.filter((m) => !m.conciliado);
  itens.push({
    chave: "CONCILIACAO",
    rotulo: "Extrato bancário conciliado",
    pronto: movimentos.length > 0 ? 1 - pendentes.length / movimentos.length : null,
    falta: pendentes.length > 0 ? `${pendentes.length} ${pendentes.length === 1 ? "lançamento" : "lançamentos"} do extrato sem conciliar` : "extrato conciliado",
    faltaCents: pendentes.reduce((a, m) => a + Math.abs(m.valorCents), 0),
    onde: "/conciliacao",
  });

  // Documento fiscal: título a receber do mês com nota ou CT-e informado.
  const entra = entraNoResultado(ctx);
  const receber = titulosAtivos(ctx, "RECEBER").filter((t) => entra(t) && dentro(dataDeCompetencia(t), periodo));
  const semDocumento = receber.filter((t) => !temDocumentoFiscal(t));
  const totalReceber = receber.reduce((a, t) => a + t.valorDocumentoCents, 0);
  const semDocumentoCents = semDocumento.reduce((a, t) => a + t.valorDocumentoCents, 0);
  itens.push({
    chave: "DOCUMENTO_FISCAL",
    rotulo: "Receita com nota ou CT-e",
    pronto: totalReceber > 0 ? 1 - semDocumentoCents / totalReceber : null,
    falta: semDocumento.length > 0 ? `${semDocumento.length} ${semDocumento.length === 1 ? "título a receber" : "títulos a receber"} sem número de nota ou CT-e` : "toda receita com documento",
    faltaCents: semDocumentoCents,
    onde: "/titulos",
  });

  // CT-e: conhecimentos autorizados do mês que casam com um título a receber.
  const ctes = (ctx.ctes ?? []).filter((c) => !c.cancelado && cteAutorizado(c.status) && c.dataEmissao && dentro(c.dataEmissao, periodo) && (!ctx.conexaoId || c.conexaoId === ctx.conexaoId));
  if (ctes.length > 0) {
    const casados = casarCtesComTitulos(
      ctes.map((c) => ({ id: c.id, chave: c.chave, numero: c.numero, data: c.dataEmissao!, valorCents: c.valorCents })),
      titulosAtivos(ctx, "RECEBER").map((t) => ({ id: t.id, chaveNfe: t.chaveNfe, numero: t.numeroDocumento, data: dataDeCompetencia(t), valorCents: t.valorDocumentoCents, tipo: t.tipoDocumento }))
    );
    const soltos = ctes.filter((c) => !casados.has(c.id));
    itens.push({
      chave: "CTE",
      rotulo: "CT-e com título a receber",
      pronto: 1 - soltos.length / ctes.length,
      falta: soltos.length > 0 ? `${soltos.length} CT-e ${soltos.length === 1 ? "autorizado" : "autorizados"} sem título a receber` : "todo CT-e com título",
      faltaCents: soltos.reduce((a, c) => a + c.valorCents, 0),
      onde: "/cte",
    });
  }

  const comBase = itens.filter((i) => i.pronto !== null);
  const pronto = comBase.length > 0 ? comBase.reduce((a, i) => a + (i.pronto ?? 0), 0) / comBase.length : null;
  return { periodo, momento, pronto, itens };
}

// ---------------------------------------------------------------------------
// 2. Vendeu mais e ganhou menos
// ---------------------------------------------------------------------------

export type MargemEmQueda = {
  mes: string;
  receitaCents: number;
  receitaMediaCents: number;
  margem: number;
  margemMedia: number;
  // As linhas que mais cresceram em % da receita líquida.
  culpados: { chave: string; rotulo: string; pctAgora: number; pctAntes: number }[];
};

// Receita líquida do último mês fechado ≥ 98% da média dos três anteriores
// (vendeu igual ou mais) e margem líquida pelo menos 2 p.p. abaixo da média
// deles. Sem três meses com receita antes, não há comparação.
export const QUEDA_MINIMA_DE_MARGEM = 0.02;

export function margemEmQueda(serie: SerieDoDre): MargemEmQueda | null {
  const n = serie.meses.length;
  if (n < 4) return null;
  const v = (chave: string, i: number) => serie.linhasDre[chave]?.[i] ?? 0;
  const receita = (i: number) => v("RECEITA_LIQUIDA", i);
  const margem = (i: number) => (receita(i) > 0 ? v("RESULTADO_LIQUIDO", i) / receita(i) : null);
  const ultimo = n - 1;
  const anteriores = [n - 4, n - 3, n - 2];
  if (receita(ultimo) <= 0 || anteriores.some((i) => receita(i) <= 0)) return null;
  const receitaMedia = anteriores.reduce((a, i) => a + receita(i), 0) / 3;
  const margemMedia = anteriores.reduce((a, i) => a + (margem(i) ?? 0), 0) / 3;
  const margemAgora = margem(ultimo)!;
  if (receita(ultimo) < receitaMedia * 0.98 || margemAgora > margemMedia - QUEDA_MINIMA_DE_MARGEM) return null;

  const pct = (chave: string, i: number) => Math.abs(v(chave, i)) / receita(i);
  const culpados = GRUPOS.filter((c) => (LINHAS_DRE.find((l) => l.chave === c)?.sinal ?? -1) < 0 && c !== "DEDUCOES" && c !== "DISTRIBUICAO_LUCROS")
    .map((c) => ({ chave: c, rotulo: ROTULO.get(c) ?? c, pctAgora: pct(c, ultimo), pctAntes: anteriores.reduce((a, i) => a + pct(c, i), 0) / 3 }))
    .filter((c) => c.pctAgora - c.pctAntes > 0.005)
    .sort((a, b) => b.pctAgora - b.pctAntes - (a.pctAgora - a.pctAntes))
    .slice(0, 3);
  return { mes: serie.meses[ultimo], receitaCents: receita(ultimo), receitaMediaCents: receitaMedia, margem: margemAgora, margemMedia, culpados };
}

// ---------------------------------------------------------------------------
// 3. Cobrança do dia
// ---------------------------------------------------------------------------

export type FaixaDeCobranca = "VENCE_EM_BREVE" | "VENCE_HOJE" | "VENCEU_ONTEM" | "ATRASO_2_7" | "ATRASO_8_30";
export const ROTULO_FAIXA: Record<FaixaDeCobranca, string> = {
  VENCE_EM_BREVE: "Vence nos próximos 3 dias",
  VENCE_HOJE: "Vence hoje",
  VENCEU_ONTEM: "Venceu ontem",
  ATRASO_2_7: "Vencido há 2 a 7 dias",
  ATRASO_8_30: "Vencido há 8 a 30 dias",
};
const ORDEM_FAIXA: FaixaDeCobranca[] = ["VENCE_HOJE", "VENCEU_ONTEM", "ATRASO_2_7", "ATRASO_8_30", "VENCE_EM_BREVE"];

export type ClienteACobrar = {
  faixa: FaixaDeCobranca;
  cliente: string;
  email: string | null;
  empresa: string;
  titulos: { numero: string | null; vencimento: Date; saldoCents: number; dias: number }[];
  totalCents: number;
};

function faixaDe(diasDeAtraso: number): FaixaDeCobranca | null {
  if (diasDeAtraso >= -3 && diasDeAtraso <= -1) return "VENCE_EM_BREVE";
  if (diasDeAtraso === 0) return "VENCE_HOJE";
  if (diasDeAtraso === 1) return "VENCEU_ONTEM";
  if (diasDeAtraso >= 2 && diasDeAtraso <= 7) return "ATRASO_2_7";
  if (diasDeAtraso >= 8 && diasDeAtraso <= 30) return "ATRASO_8_30";
  return null;
}

// "Hoje" é o dia seguinte à referência (D-1): o relatório sai de manhã sobre
// ontem, e a cobrança é de hoje. Por cliente e faixa (a faixa do título mais
// atrasado do cliente), sem operação entre as empresas do grupo.
export function cobrancaDoDia(ctx: ContextoAuditoria): ClienteACobrar[] {
  const hoje = new Date(inicioDoDia(ctx.dataReferencia).getTime() + 86_400_000);
  const entra = entraNoResultado(ctx);
  const emails = new Map(ctx.parceiros.map((p) => [`${p.conexaoId}:${p.codigoOmie}`, p.email]));
  const porCliente = new Map<string, ClienteACobrar>();
  for (const t of titulosAtivos(ctx, "RECEBER")) {
    if (!emAberto(t) || !entra(t)) continue;
    const dias = diasEntre(t.dataVencimento, hoje);
    const faixa = faixaDe(dias);
    if (!faixa) continue;
    const cliente = t.parceiroNome?.trim() || "(cliente não identificado)";
    const chave = `${t.conexaoId}:${t.parceiroCodigo ?? cliente}`;
    const atual = porCliente.get(chave) ?? {
      faixa,
      cliente,
      email: t.parceiroCodigo ? (emails.get(`${t.conexaoId}:${t.parceiroCodigo}`) ?? null) : null,
      empresa: t.conexaoApelido,
      titulos: [],
      totalCents: 0,
    };
    atual.titulos.push({ numero: t.numeroDocumento, vencimento: t.dataVencimento, saldoCents: saldoAberto(t), dias });
    atual.totalCents += saldoAberto(t);
    // A faixa do cliente é a do título mais atrasado.
    atual.faixa = faixaDe(Math.max(...atual.titulos.map((x) => x.dias)))!;
    porCliente.set(chave, atual);
  }
  return [...porCliente.values()]
    .map((c) => ({ ...c, titulos: c.titulos.sort((a, b) => b.dias - a.dias) }))
    .sort((a, b) => ORDEM_FAIXA.indexOf(a.faixa) - ORDEM_FAIXA.indexOf(b.faixa) || b.totalCents - a.totalCents);
}

// ---------------------------------------------------------------------------
// 4. Previsão de fechamento do mês em curso
// ---------------------------------------------------------------------------

export type PrevisaoDoMes = {
  mes: string;
  diaDoMes: number;
  diasNoMes: number;
  receitaLiquidaCents: number;
  resultadoCents: number;
  margem: number | null;
  // O que já está lançado com competência no mês (até o fim dele).
  resultadoLancadoCents: number;
  // Média do resultado dos três últimos meses fechados, para comparar.
  resultadoMedioCents: number | null;
  // As linhas em que a previsão supera o lançado: o que ainda deve entrar ou sair.
  aindaPorVir: { chave: string; rotulo: string; lancadoCents: number; previstoCents: number }[];
};

// Cada linha do DRE fecha no MAIOR entre o que já está lançado no mês e a
// média dos três últimos meses fechados: despesa recorrente que ainda não foi
// lançada entra pela média; receita já faturada acima da média vale o
// faturado. É conservador para despesa e para receita que já passou da média.
// Os subtotais saem das linhas pela mesma conta do DRE.
export function previsaoDoMes(lancadoNoMes: DreDoMes, serie: SerieDoDre, dataReferencia: Date): PrevisaoDoMes | null {
  const n = serie.meses.length;
  const ultimos = [n - 3, n - 2, n - 1].filter((i) => i >= 0 && (serie.linhasDre.RECEITA_BRUTA?.[i] ?? 0) > 0);
  const lancado = new Map(lancadoNoMes.linhas.filter((l) => l.tipo === "GRUPO").map((l) => [l.chave, Math.abs(l.valorCents)]));
  const media = (chave: string) => (ultimos.length === 0 ? 0 : ultimos.reduce((a, i) => a + Math.abs(serie.linhasDre[chave]?.[i] ?? 0), 0) / ultimos.length);
  const previsto = new Map(GRUPOS.map((c) => [c, Math.max(lancado.get(c) ?? 0, media(c))]));
  const sub = subtotaisDoDre((c) => previsto.get(c) ?? 0);
  const subLancado = subtotaisDoDre((c) => lancado.get(c) ?? 0);
  if (sub.RECEITA_LIQUIDA <= 0 && subLancado.RECEITA_LIQUIDA <= 0) return null;
  const d = inicioDoDia(dataReferencia);
  const resultadoMedio = ultimos.length > 0 ? ultimos.reduce((a, i) => a + (serie.linhasDre.RESULTADO_LIQUIDO?.[i] ?? 0), 0) / ultimos.length : null;
  return {
    mes: `${MESES[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`,
    diaDoMes: d.getDate(),
    diasNoMes: fimDoMes(d).getDate(),
    receitaLiquidaCents: Math.round(sub.RECEITA_LIQUIDA),
    resultadoCents: Math.round(sub.RESULTADO_LIQUIDO),
    margem: sub.RECEITA_LIQUIDA > 0 ? sub.RESULTADO_LIQUIDO / sub.RECEITA_LIQUIDA : null,
    resultadoLancadoCents: Math.round(subLancado.RESULTADO_LIQUIDO),
    resultadoMedioCents: resultadoMedio === null ? null : Math.round(resultadoMedio),
    aindaPorVir: GRUPOS.map((c) => ({ chave: c, rotulo: ROTULO.get(c) ?? c, lancadoCents: lancado.get(c) ?? 0, previstoCents: Math.round(previsto.get(c) ?? 0) }))
      .filter((l) => l.previstoCents - l.lancadoCents > 100_00)
      .sort((a, b) => b.previstoCents - b.lancadoCents - (a.previstoCents - a.lancadoCents))
      .slice(0, 5),
  };
}

// O mês inteiro de competência da referência (para o "lançado no mês").
export function mesInteiroDa(dataReferencia: Date): Periodo {
  const inicio = inicioDoMes(inicioDoDia(dataReferencia));
  return { inicio, fim: fimDoMes(inicio), rotulo: `${MESES[inicio.getMonth()]}/${String(inicio.getFullYear()).slice(2)}` };
}

// ---------------------------------------------------------------------------
// As quatro leituras juntas, do banco — para o painel e o relatório diário
// ---------------------------------------------------------------------------

export type MesEmFormacao = {
  fechamento: ProntidaoDoFechamento;
  margem: MargemEmQueda | null;
  cobranca: ClienteACobrar[];
  previsao: PrevisaoDoMes | null;
};

// O DRE vem de montarDreNoBanco (mês do fechamento e mês da referência) e a
// série dos doze meses fechados, de carregarDreDosMeses — as mesmas contas da
// tela de Custos e DRE, no recorte do contexto (grupo ou uma empresa).
export async function montarMesEmFormacao(ctx: ContextoAuditoria): Promise<MesEmFormacao> {
  const [{ classificacoesDoDre }, { montarDreNoBanco }, { carregarDreDosMeses }] = await Promise.all([
    import("./projecaoNoBanco"),
    import("./dreNoBanco"),
    import("@/lib/simulador/custosReais"),
  ]);
  const ref = ctx.dataReferencia;
  const classificacoes = await classificacoesDoDre(ctx.companyId);
  const escopo = { companyId: ctx.companyId, conexaoId: ctx.conexaoId, janela: { desde: new Date(ref.getFullYear() - 1, ref.getMonth() - 1, 1), ate: null } };
  const opcoes = { somarRetencoes: ctx.config.retencoesNasDeducoes ?? false, regime: "competencia" as const };
  const { periodo, momento } = mesDoFechamento(ref);
  const anteriorDe = (p: Periodo): Periodo => {
    const inicio = new Date(p.inicio.getFullYear(), p.inicio.getMonth() - 1, 1);
    return { inicio, fim: fimDoMes(inicio), rotulo: "" };
  };
  const mesDaRef = mesInteiroDa(ref);
  const [dreFechamento, dreDoMes, serie] = await Promise.all([
    montarDreNoBanco(escopo, periodo, anteriorDe(periodo), classificacoes, opcoes),
    montarDreNoBanco(escopo, mesDaRef, anteriorDe(mesDaRef), classificacoes, opcoes),
    carregarDreDosMeses(ctx.companyId, ctx.conexaoId, ref),
  ]);
  return {
    fechamento: prontidaoDoFechamento(ctx, dreFechamento, periodo, momento),
    margem: margemEmQueda(serie),
    cobranca: cobrancaDoDia(ctx),
    // Mês que acabou de fechar (referência no último dia) não tem o que prever.
    previsao: ref.getDate() === fimDoMes(ref).getDate() ? null : previsaoDoMes(dreDoMes, serie, ref),
  };
}
