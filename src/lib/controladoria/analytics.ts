import { variacaoPercent } from "./format";
import { resumoDoPeriodoNoBanco } from "./resumoNoBanco";
import { dentro, montarJanelas, type JanelasRelatorio, type Periodo } from "./periodos";
import { agrupar, emAberto, saldoAberto, somar, titulosAtivos } from "./agents/comum";
import { saldoAtualCents } from "./agents/conciliacao";
import { calcularCiclo, projetarFluxoCaixa } from "./agents/fluxoCaixa";
import { resumoAging } from "./agents/contasReceber";
import type { ContextoAuditoria } from "./types";

// ANÁLISE FINANCEIRA — os numeros do painel e do relatorio.
//
// Regime: COMPETENCIA para resultado (o custo pertence ao mes em que foi
// incorrido) e CAIXA para fluxo (o que efetivamente entrou e saiu). Os dois
// convivem no mesmo relatorio de proposito, e sempre rotulados: sao perguntas
// diferentes ("a operacao deu lucro no mes?" x "sobrou dinheiro na conta?") e
// misturar as duas e o erro mais comum de relatorio gerencial em PME — o mes
// fecha "no azul" no resultado e no vermelho no banco.

export type ResumoPeriodo = {
  rotulo: string;
  // Competencia (pela data de vencimento do titulo).
  receitaCents: number;
  despesaCents: number;
  resultadoCents: number;
  margemPercent: number | null;
  // Caixa (pela data da baixa).
  recebidoCents: number;
  pagoCents: number;
  fluxoLiquidoCents: number;
  // Perdas financeiras do periodo — o numero que o usuario pediu para
  // enxergar todo dia.
  jurosCents: number;
  multaCents: number;
  tarifaCents: number;
  descontoCents: number;
  perdaTotalCents: number;
  titulosPagar: number;
  titulosReceber: number;
};

export function resumoDoPeriodo(ctx: ContextoAuditoria, periodo: Periodo): ResumoPeriodo {
  const pagar = titulosAtivos(ctx, "PAGAR").filter((t) => dentro(t.dataVencimento, periodo));
  const receber = titulosAtivos(ctx, "RECEBER").filter((t) => dentro(t.dataVencimento, periodo));

  const receita = somar(receber, (t) => t.valorDocumentoCents);
  const despesa = somar(pagar, (t) => t.valorDocumentoCents);
  const resultado = receita - despesa;

  const baixasDoPeriodo = ctx.baixas.filter((b) => dentro(b.dataBaixa, periodo));
  const tituloPorId = new Map(ctx.titulos.map((t) => [t.id, t]));
  const baixasPagar = baixasDoPeriodo.filter((b) => tituloPorId.get(b.tituloId)?.natureza === "PAGAR");
  const baixasReceber = baixasDoPeriodo.filter((b) => tituloPorId.get(b.tituloId)?.natureza === "RECEBER");

  const juros = somar(baixasPagar, (b) => b.jurosCents);
  const multa = somar(baixasPagar, (b) => b.multaCents);
  const tarifa = somar(baixasDoPeriodo, (b) => b.tarifaCents);
  // Desconto CONCEDIDO (no recebimento) e perda; desconto OBTIDO (no
  // pagamento) e ganho — somar os dois no mesmo campo esconderia os dois.
  const descontoConcedido = somar(baixasReceber, (b) => b.descontoCents);

  const pago = somar(baixasPagar, (b) => Math.abs(b.valorCents));
  const recebido = somar(baixasReceber, (b) => Math.abs(b.valorCents));

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
    titulosPagar: pagar.length,
    titulosReceber: receber.length,
  };
}

export type ComparativoRelatorio = {
  janelas: JanelasRelatorio;
  dia: ResumoPeriodo;
  mesAtual: ResumoPeriodo;
  mesAnterior: ResumoPeriodo;
  ano: ResumoPeriodo;
  anoAnterior: ResumoPeriodo;
  mesmoMesAnoAnterior: ResumoPeriodo;
  variacoes: {
    receitaMesVsAnterior: number | null;
    despesaMesVsAnterior: number | null;
    receitaAnoVsAnterior: number | null;
    despesaAnoVsAnterior: number | null;
    receitaMesVsMesmoMesAnoAnterior: number | null;
    resultadoAnoVsAnterior: number | null;
  };
  // Verdadeiro quando a base nao cobre o ano anterior: o relatorio precisa
  // dizer "sem base comparativa" em vez de mostrar uma queda de 100% que so
  // existe porque o dado nao foi carregado.
  semBaseAnoAnterior: boolean;
};

// O comparativo é a ÚNICA parte que olha para além da janela do contexto.
//
// "Acumulado do ano anterior" pode estar a vinte meses da data de referência,
// e era só por causa dele que o contexto precisava carregar a base inteira —
// 46 mil títulos e 45 mil baixas, mais de trinta megabytes por chamada, o
// suficiente para a fase de auditoria estourar os 60 segundos da função.
//
// Somando no banco, as seis janelas custam algumas dezenas de linhas de
// resultado. E o contexto pôde encolher para o que os agentes de fato leem
// (ver `janelaDeAuditoria`), que é onde estava o ganho.
//
// `resumoDoPeriodoNoBanco` é gêmeo verificado de `resumoDoPeriodo`: há um
// teste diferencial que roda as duas sobre os mesmos dados e exige resultado
// idêntico, campo a campo.
export async function montarComparativo(ctx: ContextoAuditoria): Promise<ComparativoRelatorio> {
  const janelas = montarJanelas(ctx.dataReferencia);
  const escopo = { companyId: ctx.companyId, conexaoId: ctx.conexaoId };

  const [dia, mesAtual, mesAnterior, ano, anoAnterior, mesmoMesAnoAnterior] = await Promise.all([
    resumoDoPeriodoNoBanco({ ...escopo, periodo: janelas.dia }),
    resumoDoPeriodoNoBanco({ ...escopo, periodo: janelas.mesAtual }),
    resumoDoPeriodoNoBanco({ ...escopo, periodo: janelas.mesAnterior }),
    resumoDoPeriodoNoBanco({ ...escopo, periodo: janelas.ano }),
    resumoDoPeriodoNoBanco({ ...escopo, periodo: janelas.anoAnterior }),
    resumoDoPeriodoNoBanco({ ...escopo, periodo: janelas.mesmoMesAnoAnterior }),
  ]);

  const semBaseAnoAnterior = ctx.config.dataInicioBase > janelas.anoAnterior.inicio;

  return {
    janelas,
    dia,
    mesAtual,
    mesAnterior,
    ano,
    anoAnterior,
    mesmoMesAnoAnterior,
    variacoes: {
      receitaMesVsAnterior: variacaoPercent(mesAtual.receitaCents, mesAnterior.receitaCents),
      despesaMesVsAnterior: variacaoPercent(mesAtual.despesaCents, mesAnterior.despesaCents),
      receitaAnoVsAnterior: semBaseAnoAnterior ? null : variacaoPercent(ano.receitaCents, anoAnterior.receitaCents),
      despesaAnoVsAnterior: semBaseAnoAnterior ? null : variacaoPercent(ano.despesaCents, anoAnterior.despesaCents),
      receitaMesVsMesmoMesAnoAnterior: semBaseAnoAnterior
        ? null
        : variacaoPercent(mesAtual.receitaCents, mesmoMesAnoAnterior.receitaCents),
      resultadoAnoVsAnterior: semBaseAnoAnterior
        ? null
        : variacaoPercent(ano.resultadoCents, anoAnterior.resultadoCents),
    },
    semBaseAnoAnterior,
  };
}

// ---------- DRE gerencial ----------
// Por CATEGORIA da Omie, que e o plano de contas real da empresa — nao por um
// plano de contas paralelo inventado aqui. Categoria sem classificacao vira
// uma linha propria e visivel ("Sem categoria"), nunca e distribuida nas
// outras: dinheiro nao classificado tem que incomodar, nao se diluir.

export type LinhaDre = {
  codigo: string;
  descricao: string;
  natureza: "RECEITA" | "DESPESA";
  valorCents: number;
  participacaoPercent: number;
  valorAnteriorCents: number;
  variacaoPercent: number | null;
};

export function dreGerencial(ctx: ContextoAuditoria, periodo: Periodo, periodoAnterior: Periodo): LinhaDre[] {
  const descricaoPorCodigo = new Map(ctx.categorias.map((c) => [c.codigo, c.descricao]));

  const montar = (p: Periodo, natureza: "PAGAR" | "RECEBER") =>
    agrupar(
      titulosAtivos(ctx, natureza).filter((t) => dentro(t.dataVencimento, p)),
      (t) => t.categoriaCodigo ?? "SEM_CATEGORIA"
    );

  const linhas: LinhaDre[] = [];

  for (const [natureza, tipo] of [
    ["RECEBER", "RECEITA"],
    ["PAGAR", "DESPESA"],
  ] as const) {
    const atual = montar(periodo, natureza);
    const anterior = montar(periodoAnterior, natureza);
    const total = somar([...atual.values()].flat(), (t) => t.valorDocumentoCents);

    for (const [codigo, titulos] of atual) {
      const valor = somar(titulos, (t) => t.valorDocumentoCents);
      const valorAnterior = somar(anterior.get(codigo) ?? [], (t) => t.valorDocumentoCents);
      linhas.push({
        codigo,
        descricao: codigo === "SEM_CATEGORIA" ? "Sem categoria" : descricaoPorCodigo.get(codigo) ?? `Categoria ${codigo}`,
        natureza: tipo,
        valorCents: valor,
        participacaoPercent: total > 0 ? (valor / total) * 100 : 0,
        valorAnteriorCents: valorAnterior,
        variacaoPercent: variacaoPercent(valor, valorAnterior),
      });
    }
  }

  return linhas.sort((a, b) => {
    if (a.natureza !== b.natureza) return a.natureza === "RECEITA" ? -1 : 1;
    return b.valorCents - a.valorCents;
  });
}

// ---------- Rankings ----------

export type LinhaRanking = { codigo: string; nome: string; valorCents: number; quantidade: number };

export function ranking(
  ctx: ContextoAuditoria,
  periodo: Periodo,
  natureza: "PAGAR" | "RECEBER",
  limite = 10
): LinhaRanking[] {
  const titulos = titulosAtivos(ctx, natureza).filter((t) => dentro(t.dataVencimento, periodo));
  const nomePorCodigo = new Map(ctx.parceiros.map((p) => [p.codigoOmie, p.nome]));

  return [...agrupar(titulos, (t) => t.parceiroCodigo ?? t.parceiroNome ?? "?")]
    .map(([codigo, grupo]) => ({
      codigo,
      nome: nomePorCodigo.get(codigo) ?? grupo[0].parceiroNome ?? "(não identificado)",
      valorCents: somar(grupo, (t) => t.valorDocumentoCents),
      quantidade: grupo.length,
    }))
    .sort((a, b) => b.valorCents - a.valorCents)
    .slice(0, limite);
}

// ---------- Panorama consolidado ----------
// Um objeto so, montado uma vez, consumido pelo painel, pelo e-mail e pela
// camada de IA. Existe para garantir que os tres contem a MESMA historia: se
// cada um recalculasse por conta, um numero divergente entre a tela e o
// e-mail seria questao de tempo — e bastaria uma divergencia para o usuario
// parar de confiar no modulo inteiro.

export type PanoramaFinanceiro = {
  comparativo: ComparativoRelatorio;
  saldoAtualCents: number;
  aPagarEmAbertoCents: number;
  aReceberEmAbertoCents: number;
  vencidoPagarCents: number;
  vencidoReceberCents: number;
  agingReceber: ReturnType<typeof resumoAging>;
  agingPagar: ReturnType<typeof resumoAging>;
  ciclo: ReturnType<typeof calcularCiclo>;
  projecao: ReturnType<typeof projetarFluxoCaixa>;
  dre: LinhaDre[];
  topFornecedores: LinhaRanking[];
  topClientes: LinhaRanking[];
};

export async function montarPanorama(ctx: ContextoAuditoria): Promise<PanoramaFinanceiro> {
  const comparativo = await montarComparativo(ctx);
  const pagarAberto = titulosAtivos(ctx, "PAGAR").filter(emAberto);
  const receberAberto = titulosAtivos(ctx, "RECEBER").filter(emAberto);

  return {
    comparativo,
    saldoAtualCents: saldoAtualCents(ctx),
    aPagarEmAbertoCents: somar(pagarAberto, saldoAberto),
    aReceberEmAbertoCents: somar(receberAberto, saldoAberto),
    vencidoPagarCents: somar(
      pagarAberto.filter((t) => t.dataVencimento < ctx.dataReferencia),
      saldoAberto
    ),
    vencidoReceberCents: somar(
      receberAberto.filter((t) => t.dataVencimento < ctx.dataReferencia),
      saldoAberto
    ),
    agingReceber: resumoAging(ctx, "RECEBER"),
    agingPagar: resumoAging(ctx, "PAGAR"),
    ciclo: calcularCiclo(ctx),
    projecao: projetarFluxoCaixa(ctx),
    dre: dreGerencial(ctx, comparativo.janelas.mesAtual, comparativo.janelas.mesAnterior),
    topFornecedores: ranking(ctx, comparativo.janelas.mesAtual, "PAGAR"),
    topClientes: ranking(ctx, comparativo.janelas.mesAtual, "RECEBER"),
  };
}
