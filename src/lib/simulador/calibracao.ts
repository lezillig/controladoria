import type { ResultadoSimulacao } from "./tipos";

// REALIZADO × PREVISTO — a calibração do simulador.
//
// Um estudo que vira contrato passa a ter realizado: km da telemetria (Ituran),
// faturamento e custo por natureza da controladoria. Comparar com o que a
// simulação previa é o que ensina onde as premissas erram — km morto, consumo,
// horas extras, manutenção — e é o que torna o próximo orçamento mais justo.
//
// O previsto de cada natureza sai da composição da versão lançada, convertido
// para o mês (no escolar, a apuração é o período; divide-se pelos meses de
// custo fixo) e para o km realizado quando a natureza é variável: combustível
// previsto num mês em que se rodou 20% mais é 20% maior, e o desvio que
// interessa é o do custo POR KM.

export type Natureza = "folha" | "combustivel" | "manutencao" | "veiculo" | "pedagio" | "indiretos";

export const ROTULO_NATUREZA: Record<Natureza, string> = {
  folha: "Folha (salários, encargos, benefícios, supervisão)",
  combustivel: "Combustível e ARLA",
  manutencao: "Manutenção, pneus e óleo",
  veiculo: "Veículo (capital, seguro, IPVA, telemetria, garagem)",
  pedagio: "Pedágio",
  indiretos: "Indiretos",
};

export type RealizadoMes = {
  competencia: string;
  kmRealizado: number | null;
  faturamento: number | null;
  custos: Partial<Record<Natureza, number | null>>;
};

export type LinhaCalibracao = {
  natureza: Natureza;
  previstoMes: number;
  // Previsto ajustado ao km realizado (só naturezas variáveis).
  previstoAjustado: number;
  realizadoMedio: number | null;
  desvio: number | null;
  desvioPct: number | null;
  meses: number;
};

export type Calibracao = {
  meses: string[];
  kmPrevistoMes: number;
  kmRealizadoMedio: number | null;
  utilizacaoReal: number | null;
  faturamentoPrevistoMes: number;
  faturamentoRealizadoMedio: number | null;
  linhas: LinhaCalibracao[];
  sugestoes: string[];
};

// Previsto de cada natureza no mês, separado na parte que acompanha o km e na
// que não acompanha. Só a primeira é ajustada ao km realizado: a manutenção
// fixa (% do valor do veículo ao mês) entra na natureza "manutenção", mas não
// cresce porque se rodou mais — escalá-la com o km inventava desvio.
function previstoPorNatureza(r: ResultadoSimulacao, mesesPorApuracao: number): Record<Natureza, { variavel: number; fixo: number }> {
  const s = (f: (i: ResultadoSimulacao["itens"][number]) => number) => r.itens.reduce((a, i) => a + f(i), 0);
  // Mão de obra e veículo já são mensais na composição; os variáveis e os
  // indiretos estão na apuração.
  return {
    folha: { variavel: 0, fixo: s((i) => i.maoDeObraMes) },
    combustivel: { variavel: s((i) => i.diesel + i.arla) / mesesPorApuracao, fixo: 0 },
    manutencao: { variavel: s((i) => i.manutencao + i.pneus + i.oleoLavagem) / mesesPorApuracao, fixo: s((i) => i.manutencaoFixa) },
    veiculo: { variavel: 0, fixo: s((i) => i.veiculoMes - i.manutencaoFixa + i.implantacaoMes) },
    pedagio: { variavel: s((i) => i.pedagio) / mesesPorApuracao, fixo: 0 },
    indiretos: { variavel: 0, fixo: s((i) => i.indiretos) / mesesPorApuracao },
  };
}

export function calibrar(resultado: ResultadoSimulacao, mesesCustoFixo: number, realizados: RealizadoMes[]): Calibracao {
  const mesesPorApuracao = resultado.modo === "MENSAL" ? 1 : Math.max(1, mesesCustoFixo);
  const previsto = previstoPorNatureza(resultado, mesesPorApuracao);
  const kmPrevistoMes = resultado.totais.kmUtil / mesesPorApuracao;
  // No lote, o contrato fatura ao preço único da proposta — é com ele que o
  // faturamento realizado se compara, não com a soma dos preços por item.
  const faturamentoPrevistoMes = (resultado.lote ? resultado.lote.faturamentoAoPrecoProposta : resultado.totais.faturamento) / mesesPorApuracao;
  const media = (xs: (number | null | undefined)[]) => {
    const v = xs.filter((x): x is number => typeof x === "number");
    return v.length > 0 ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const kmRealizadoMedio = media(realizados.map((r) => r.kmRealizado));
  const fatorKm = kmRealizadoMedio !== null && kmPrevistoMes > 0 ? kmRealizadoMedio / kmPrevistoMes : 1;

  const linhas: LinhaCalibracao[] = (Object.keys(ROTULO_NATUREZA) as Natureza[]).map((natureza) => {
    const valores = realizados.map((r) => r.custos[natureza]);
    const realizadoMedio = media(valores);
    const { variavel, fixo } = previsto[natureza];
    const previstoAjustado = variavel * fatorKm + fixo;
    const desvio = realizadoMedio === null ? null : realizadoMedio - previstoAjustado;
    return {
      natureza,
      previstoMes: variavel + fixo,
      previstoAjustado,
      realizadoMedio,
      desvio,
      desvioPct: desvio === null || previstoAjustado === 0 ? null : desvio / previstoAjustado,
      meses: valores.filter((v) => typeof v === "number").length,
    };
  });

  const sugestoes: string[] = [];
  const pct = (x: number) => `${x > 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
  for (const l of linhas) {
    if (l.desvioPct === null || Math.abs(l.desvioPct) < 0.05) continue;
    if (l.natureza === "combustivel")
      sugestoes.push(`Combustível por km ${pct(l.desvioPct)} do previsto: revisar consumo (km/l) ou preço do litro — o consumo implícito é ${pct(-l.desvioPct / (1 + l.desvioPct))} do premissado.`);
    if (l.natureza === "manutencao") sugestoes.push(`Manutenção e pneus por km ${pct(l.desvioPct)}: ajustar R$/km de manutenção e pneus na base.`);
    if (l.natureza === "folha") sugestoes.push(`Folha ${pct(l.desvioPct)}: conferir horas extras, motoristas por veículo e encargos efetivos.`);
    if (l.natureza === "veiculo") sugestoes.push(`Custo fixo do veículo ${pct(l.desvioPct)}: conferir seguro, IPVA, parcela/capital e garagem.`);
    if (l.natureza === "pedagio") sugestoes.push(`Pedágio ${pct(l.desvioPct)}: revisar passagens por mês e tarifas.`);
    if (l.natureza === "indiretos") sugestoes.push(`Indiretos ${pct(l.desvioPct)}: rever o percentual de administração e contingência.`);
  }
  if (kmRealizadoMedio !== null && kmPrevistoMes > 0 && Math.abs(fatorKm - 1) >= 0.05)
    sugestoes.push(`Km realizado ${pct(fatorKm - 1)} do previsto: ajustar a utilização (${(fatorKm * 100).toFixed(0)}% da prevista) ou o km morto.`);

  return {
    meses: realizados.map((r) => r.competencia).sort(),
    kmPrevistoMes,
    kmRealizadoMedio,
    utilizacaoReal: kmRealizadoMedio !== null && resultado.totais.kmReferencia > 0 ? kmRealizadoMedio / (resultado.totais.kmReferencia / mesesPorApuracao) : null,
    faturamentoPrevistoMes,
    faturamentoRealizadoMedio: media(realizados.map((r) => r.faturamento)),
    linhas,
    sugestoes,
  };
}
