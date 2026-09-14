import type { OmieBaixa, OmieTitulo } from "@prisma/client";
import { HORIZONTES_DIAS } from "./agents/fluxoCaixa";
import { chaveParceiro, mediana } from "./agents/comum";
import { diasEntre, somarDias } from "./periodos";
import type { ContextoAuditoria } from "./types";

// PREVISÃO DE CAIXA POR CONTRATO (cliente).
//
// A projeção do fluxo de caixa é CONTRATUAL: assume que cada recebível entra
// no vencimento. Nenhum cliente paga assim. A prefeitura paga com sessenta
// dias de atraso todo mês; o cliente corporativo paga no dia; um terceiro
// não paga há dois anos. Somar os três pelo vencimento produz um número que
// não descreve nenhum deles.
//
// Aqui cada cliente é lido pelo próprio histórico: quanto tempo depois do
// vencimento ele costuma pagar (mediana das baixas dele), e com que
// frequência paga no prazo. A data prevista de cada título em aberto é o
// vencimento mais esse atraso típico. E o título vencido ALÉM do padrão do
// cliente — que já passou da data em que ele costuma pagar — não entra na
// previsão: entra numa coluna própria, "incerto", porque é o dinheiro que
// precisa de cobrança, não de espera.
//
// Duas leituras lado a lado, contratual e realista, e a diferença entre elas
// é o tamanho do otimismo embutido na primeira.

// Menos baixas que isto e o cliente não tem padrão próprio: usa-se o do
// conjunto, e a tela diz que usou.
export const MINIMO_DE_AMOSTRA = 3;
// Uma baixa mais de um ano depois do vencimento não é "atraso típico", é
// exceção (acordo, judicial); acima disto o valor é cortado para não puxar a
// mediana de quem paga com trinta dias para cento e oitenta.
const ATRASO_MAXIMO_DIAS = 365;
// Pagou até este número de dias depois do vencimento = pontual. Dois dias
// cobrem compensação bancária e fim de semana.
const TOLERANCIA_PONTUAL_DIAS = 2;

export type TituloParaPrevisao = Pick<
  OmieTitulo,
  | "id" | "natureza" | "dataVencimento" | "parceiroCodigo" | "parceiroNome" | "parceiroDocumento" | "conexaoApelido"
  | "saldoCents" | "valorDocumentoCents" | "valorPagoCents" | "liquidado" | "cancelado"
>;
export type BaixaParaPrevisao = Pick<OmieBaixa, "tituloId" | "dataBaixa" | "valorCents">;

export type ComportamentoCliente = {
  chave: string;
  nome: string;
  amostra: number;
  atrasoMedianoDias: number;
  // Nulo quando o padrão veio do resumo mensal (que guarda a soma dos dias,
  // não baixa a baixa) — a média de atraso existe, a pontualidade não.
  pontualidadePercent: number | null;
  origem: "baixas" | "historico";
};

// O que o resumo mensal (HistoricoMensal) sabe de um cliente: quantas baixas
// e a soma de (dia da baixa − dia do vencimento) em até 24 meses. Média, não
// mediana — o resumo guarda a soma, e é o que há.
export type HistoricoDeCliente = { nome: string | null; baixas: number; diasSoma: number };

const emAberto = (t: TituloParaPrevisao) => !t.liquidado && !t.cancelado;
const saldoAberto = (t: TituloParaPrevisao) => t.saldoCents ?? Math.max(0, t.valorDocumentoCents - t.valorPagoCents);
const nomeDe = (t: TituloParaPrevisao) => t.parceiroNome?.trim() || "(cliente não identificado)";

// O padrão de cada cliente, tirado das baixas dos títulos a receber dele:
// atraso (dias entre vencimento e baixa) por baixa, mediana por cliente.
//
// DOIS ANOS DE MEMÓRIA. As baixas do contexto cobrem o ano corrente; em
// janeiro isso é um mês, e quase nenhum cliente tem três baixas — todos
// caíam no "padrão geral". O resumo mensal guarda 24 meses por cliente, e
// entra como segunda fonte: quando as baixas do ano não bastam, vale a média
// dos dois anos. As baixas do ano continuam preferidas quando existem, porque
// são o comportamento mais recente e a mediana resiste a exceções.
export function comportamentoPorCliente(
  titulos: TituloParaPrevisao[],
  baixas: BaixaParaPrevisao[],
  historico: Map<string, HistoricoDeCliente> = new Map()
): Map<string, ComportamentoCliente> {
  const tituloPorId = new Map(titulos.filter((t) => t.natureza === "RECEBER").map((t) => [t.id, t]));
  const atrasosPorCliente = new Map<string, { nome: string; atrasos: number[] }>();

  for (const b of baixas) {
    const t = tituloPorId.get(b.tituloId);
    if (!t || b.valorCents === 0) continue;
    const atraso = Math.min(ATRASO_MAXIMO_DIAS, diasEntre(t.dataVencimento, b.dataBaixa));
    const chave = chaveParceiro(t);
    const atual = atrasosPorCliente.get(chave) ?? { nome: nomeDe(t), atrasos: [] };
    atual.atrasos.push(atraso);
    atrasosPorCliente.set(chave, atual);
  }

  const resultado = new Map<string, ComportamentoCliente>();
  for (const [chave, { nome, atrasos }] of atrasosPorCliente) {
    resultado.set(chave, {
      chave,
      nome,
      amostra: atrasos.length,
      atrasoMedianoDias: mediana(atrasos),
      pontualidadePercent: (atrasos.filter((a) => a <= TOLERANCIA_PONTUAL_DIAS).length / atrasos.length) * 100,
      origem: "baixas",
    });
  }

  for (const [chave, h] of historico) {
    const atual = resultado.get(chave);
    if (atual && atual.amostra >= MINIMO_DE_AMOSTRA) continue;
    if (h.baixas < MINIMO_DE_AMOSTRA) continue;
    const media = Math.min(ATRASO_MAXIMO_DIAS, Math.round(h.diasSoma / h.baixas));
    resultado.set(chave, {
      chave,
      nome: atual?.nome ?? h.nome?.trim() ?? "(cliente não identificado)",
      amostra: h.baixas,
      atrasoMedianoDias: media,
      pontualidadePercent: null,
      origem: "historico",
    });
  }
  return resultado;
}

// O atraso típico do conjunto, para cliente sem amostra própria: mediana dos
// atrasos medianos, ponderando cada cliente uma vez — um cliente com mil
// baixas não pode decidir sozinho o padrão dos outros.
export function atrasoGlobal(comportamentos: Map<string, ComportamentoCliente>): number {
  const valores = [...comportamentos.values()].filter((c) => c.amostra >= MINIMO_DE_AMOSTRA).map((c) => c.atrasoMedianoDias);
  return valores.length > 0 ? Math.max(0, mediana(valores)) : 0;
}

export type TituloPrevisto = {
  titulo: TituloParaPrevisao;
  saldoCents: number;
  // Quando o cliente costuma pagar este título. Null = incerto: já passou da
  // data em que ele costumaria ter pago.
  dataPrevista: Date | null;
  atrasoUsadoDias: number;
  padraoProprio: boolean;
};

export function preverTitulo(
  t: TituloParaPrevisao,
  comportamentos: Map<string, ComportamentoCliente>,
  atrasoPadraoDias: number,
  referencia: Date
): TituloPrevisto {
  const c = comportamentos.get(chaveParceiro(t));
  const padraoProprio = c !== undefined && c.amostra >= MINIMO_DE_AMOSTRA;
  const atraso = Math.max(0, padraoProprio ? c.atrasoMedianoDias : atrasoPadraoDias);
  const prevista = somarDias(t.dataVencimento, atraso);
  // Amanhã é o primeiro dia em que dinheiro pode entrar. Título que, pelo
  // padrão do cliente, já deveria ter sido pago e não foi é INCERTO — e é
  // justamente o que a tela precisa apontar.
  const amanha = somarDias(referencia, 1);
  const dataPrevista = prevista >= amanha ? prevista : null;
  return { titulo: t, saldoCents: saldoAberto(t), dataPrevista, atrasoUsadoDias: atraso, padraoProprio };
}

export type PrevisaoCliente = {
  chave: string;
  nome: string;
  empresa: string;
  emAbertoCents: number;
  vencidoCents: number;
  // Vencido além do padrão do cliente: não entra na previsão, precisa de cobrança.
  incertoCents: number;
  titulosEmAberto: number;
  atrasoMedianoDias: number | null;
  pontualidadePercent: number | null;
  amostra: number;
  // De onde veio o padrão: baixas do ano, resumo mensal de 24 meses, ou
  // nenhum (padrão geral).
  origem: "baixas" | "historico" | null;
  // Previsto por horizonte (dias → centavos), pela data prevista.
  previstoPorHorizonte: Record<number, number>;
};

export type PontoRealista = {
  dias: number;
  contratualCents: number;
  realistaCents: number;
};

export type PrevisaoDeCaixa = {
  clientes: PrevisaoCliente[];
  porHorizonte: PontoRealista[];
  atrasoPadraoDias: number;
  incertoTotalCents: number;
  clientesSemPadrao: number;
};

export function preverRecebimentos(params: {
  titulos: TituloParaPrevisao[];
  baixas: BaixaParaPrevisao[];
  referencia: Date;
  horizontes?: readonly number[];
  historico?: Map<string, HistoricoDeCliente>;
}): PrevisaoDeCaixa {
  const horizontes = params.horizontes ?? HORIZONTES_DIAS;
  const comportamentos = comportamentoPorCliente(params.titulos, params.baixas, params.historico);
  const atrasoPadraoDias = atrasoGlobal(comportamentos);

  const abertos = params.titulos.filter((t) => t.natureza === "RECEBER" && emAberto(t) && saldoAberto(t) > 0);
  const previstos = abertos.map((t) => preverTitulo(t, comportamentos, atrasoPadraoDias, params.referencia));

  const porCliente = new Map<string, PrevisaoCliente>();
  for (const p of previstos) {
    const t = p.titulo;
    const chave = chaveParceiro(t);
    const c = comportamentos.get(chave);
    const linha = porCliente.get(chave) ?? {
      chave,
      nome: nomeDe(t),
      empresa: t.conexaoApelido,
      emAbertoCents: 0,
      vencidoCents: 0,
      incertoCents: 0,
      titulosEmAberto: 0,
      atrasoMedianoDias: p.padraoProprio && c ? c.atrasoMedianoDias : null,
      pontualidadePercent: p.padraoProprio && c ? c.pontualidadePercent : null,
      amostra: c?.amostra ?? 0,
      origem: p.padraoProprio && c ? c.origem : null,
      previstoPorHorizonte: Object.fromEntries(horizontes.map((h) => [h, 0])),
    };
    linha.emAbertoCents += p.saldoCents;
    linha.titulosEmAberto += 1;
    if (t.dataVencimento < params.referencia) linha.vencidoCents += p.saldoCents;
    if (p.dataPrevista === null) {
      linha.incertoCents += p.saldoCents;
    } else {
      for (const h of horizontes) {
        if (p.dataPrevista <= somarDias(params.referencia, h)) linha.previstoPorHorizonte[h] += p.saldoCents;
      }
    }
    porCliente.set(chave, linha);
  }

  const clientes = [...porCliente.values()].sort((a, b) => b.emAbertoCents - a.emAbertoCents);

  const porHorizonte = horizontes.map((dias) => {
    const limite = somarDias(params.referencia, dias);
    // Contratual: a mesma regra da projeção existente — vence até a data e
    // ainda não venceu antes da referência.
    const contratual = abertos
      .filter((t) => t.dataVencimento <= limite && t.dataVencimento >= params.referencia)
      .reduce((acc, t) => acc + saldoAberto(t), 0);
    const realista = clientes.reduce((acc, c) => acc + c.previstoPorHorizonte[dias], 0);
    return { dias, contratualCents: contratual, realistaCents: realista };
  });

  return {
    clientes,
    porHorizonte,
    atrasoPadraoDias,
    incertoTotalCents: clientes.reduce((acc, c) => acc + c.incertoCents, 0),
    clientesSemPadrao: clientes.filter((c) => c.atrasoMedianoDias === null).length,
  };
}

export function preverRecebimentosDoContexto(
  ctx: ContextoAuditoria,
  historico?: Map<string, HistoricoDeCliente>
): PrevisaoDeCaixa {
  return preverRecebimentos({ titulos: ctx.titulos, baixas: ctx.baixas, referencia: ctx.dataReferencia, historico });
}
