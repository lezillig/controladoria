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

export type Natureza = "folha" | "combustivel" | "manutencao" | "veiculo" | "pedagio" | "indiretos" | "outros";

// Abaixo disto, um desvio é ruído de um mês atípico, não premissa errada.
export const MESES_MINIMOS_PARA_SUGERIR = 3;

export const ROTULO_NATUREZA: Record<Natureza, string> = {
  folha: "Folha (salários, encargos, benefícios, supervisão)",
  combustivel: "Combustível e ARLA",
  manutencao: "Manutenção, pneus e óleo",
  veiculo: "Veículo (capital, seguro, IPVA, telemetria, garagem)",
  pedagio: "Pedágio",
  indiretos: "Indiretos",
  outros: "Outros custos diretos (frota de terceiros, custo do contrato)",
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
  // Nos meses com faturamento e custo lançados: (faturamento − custo) ÷
  // faturamento, somas sobre somas.
  margemRealizada: number | null;
  margemPrevista: number | null;
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
    outros: { variavel: 0, fixo: 0 },
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

  // MÊS A MÊS: cada mês com custo lançado é comparado com o previsto no km
  // DAQUELE mês (sem km no mês, o km médio realizado), e o desvio é razão de
  // somas — médias sobre conjuntos de meses diferentes misturavam o km de uns
  // com o custo de outros.
  const fatorDoMes = (r: RealizadoMes) => (typeof r.kmRealizado === "number" && kmPrevistoMes > 0 ? r.kmRealizado / kmPrevistoMes : fatorKm);
  const linhas: LinhaCalibracao[] = (Object.keys(ROTULO_NATUREZA) as Natureza[]).map((natureza) => {
    const { variavel, fixo } = previsto[natureza];
    const comCusto = realizados.filter((r) => typeof r.custos[natureza] === "number");
    const somaReal = comCusto.reduce((a, r) => a + (r.custos[natureza] as number), 0);
    const somaPrevista = comCusto.reduce((a, r) => a + variavel * fatorDoMes(r) + fixo, 0);
    const n = comCusto.length;
    const realizadoMedio = n > 0 ? somaReal / n : null;
    const previstoAjustado = n > 0 ? somaPrevista / n : variavel * fatorKm + fixo;
    const desvio = realizadoMedio === null ? null : realizadoMedio - previstoAjustado;
    return {
      natureza,
      previstoMes: variavel + fixo,
      previstoAjustado,
      realizadoMedio,
      desvio,
      desvioPct: desvio === null || previstoAjustado === 0 ? null : desvio / previstoAjustado,
      meses: n,
    };
  });

  const sugestoes: string[] = [];
  const pct = (x: number) => `${x > 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
  const reais = (x: number) => x.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  const outros = linhas.find((l) => l.natureza === "outros");
  if (outros?.realizadoMedio)
    sugestoes.push(`Outros custos diretos de ${reais(outros.realizadoMedio)}/mês que o estudo não previa (frota de terceiros, custo do contrato): incluir no próximo estudo ou rever o que foi lançado.`);
  const curtas = linhas.filter((l) => l.meses > 0 && l.meses < MESES_MINIMOS_PARA_SUGERIR && l.desvioPct !== null && Math.abs(l.desvioPct) >= 0.05);
  if (curtas.length > 0)
    sugestoes.push(`Com menos de ${MESES_MINIMOS_PARA_SUGERIR} meses lançados, os desvios de ${curtas.map((l) => ROTULO_NATUREZA[l.natureza].split(" (")[0].toLowerCase()).join(", ")} ainda podem ser de um mês atípico: aguardar antes de mudar premissas.`);
  for (const l of linhas) {
    if (l.desvioPct === null || Math.abs(l.desvioPct) < 0.05 || l.meses < MESES_MINIMOS_PARA_SUGERIR) continue;
    if (l.natureza === "combustivel")
      sugestoes.push(`Combustível por km ${pct(l.desvioPct)} do previsto: revisar consumo (km/l) ou preço do litro — o consumo implícito é ${pct(-l.desvioPct / (1 + l.desvioPct))} do premissado.`);
    if (l.natureza === "manutencao") sugestoes.push(`Manutenção e pneus por km ${pct(l.desvioPct)}: ajustar R$/km de manutenção e pneus na base.`);
    if (l.natureza === "folha") sugestoes.push(`Folha ${pct(l.desvioPct)}: conferir horas extras, motoristas por veículo e encargos efetivos.`);
    if (l.natureza === "veiculo") sugestoes.push(`Custo fixo do veículo ${pct(l.desvioPct)}: conferir seguro, IPVA, parcela/capital e garagem.`);
    if (l.natureza === "pedagio") sugestoes.push(`Pedágio ${pct(l.desvioPct)}: revisar passagens por mês e tarifas.`);
    if (l.natureza === "indiretos") sugestoes.push(`Indiretos ${pct(l.desvioPct)}: rever o percentual de administração e contingência.`);
  }
  const mesesComKm = realizados.filter((r) => typeof r.kmRealizado === "number").length;
  if (kmRealizadoMedio !== null && kmPrevistoMes > 0 && Math.abs(fatorKm - 1) >= 0.05 && mesesComKm >= MESES_MINIMOS_PARA_SUGERIR)
    sugestoes.push(`Km realizado ${pct(fatorKm - 1)} do previsto: ajustar a utilização (${(fatorKm * 100).toFixed(0)}% da prevista) ou o km morto.`);

  return {
    meses: realizados.map((r) => r.competencia).sort(),
    kmPrevistoMes,
    kmRealizadoMedio,
    utilizacaoReal: kmRealizadoMedio !== null && resultado.totais.kmReferencia > 0 ? kmRealizadoMedio / (resultado.totais.kmReferencia / mesesPorApuracao) : null,
    faturamentoPrevistoMes,
    faturamentoRealizadoMedio: media(realizados.map((r) => r.faturamento)),
    margemRealizada: margemRealizada(realizados),
    margemPrevista: resultado.totais.faturamento > 0 ? (resultado.totais.faturamento - resultado.totais.custoTotal) / resultado.totais.faturamento : null,
    linhas,
    sugestoes,
  };
}

// A margem dos meses que têm faturamento e ao menos um custo lançado: somas
// sobre somas. Custo de natureza não lançada no mês fica fora — por isso a
// margem só é dita quando os meses têm folha e veículo, o grosso do custo.
function margemRealizada(realizados: RealizadoMes[]): number | null {
  const completos = realizados.filter((r) => typeof r.faturamento === "number" && r.faturamento > 0 && typeof r.custos.folha === "number" && typeof r.custos.veiculo === "number");
  if (completos.length === 0) return null;
  const fat = completos.reduce((a, r) => a + (r.faturamento as number), 0);
  const custo = completos.reduce((a, r) => a + Object.values(r.custos).reduce<number>((b, v) => b + (typeof v === "number" ? v : 0), 0), 0);
  return (fat - custo) / fat;
}
