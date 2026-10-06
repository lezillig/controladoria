// PAINEL DE INDICADORES — retorno sobre o capital e operação.
//
// Duas fontes. O DRE GERENCIAL dos últimos 12 meses fechados sai do sistema,
// pela mesma conta da tela de Custos e DRE (a série vem de
// montarDreAnualNoBanco): margens, peso de cada custo na receita, cobertura
// das parcelas, retiradas dos sócios. O BALANÇO vem da contabilidade e é
// digitado na tela, um por data-base: capital investido, dívida, caixa, PL —
// sem ele não existe ROIC, ROE, EVA nem alavancagem.
//
// O DRE GERENCIAL NÃO TEM DEPRECIAÇÃO: o veículo aparece como parcela de
// financiamento ou consórcio, abaixo do resultado antes dos investimentos.
// Por isso o "EBIT" da tela é, para os indicadores, um EBITDA — e o NOPAT
// desconta a depreciação do balanço (ou, sem ela, uma estimativa de 12% do
// imobilizado ao ano, dita como estimativa) e o IRPJ/CSLL do próprio DRE.
// As retiradas dos sócios ficam como despesa (conservador: parte delas é
// pró-labore); o payout mostra quanto do resultado elas levam.
//
// Puro: recebe os números prontos e devolve a lista para a tela. Os
// parâmetros de farol são referências de mercado (relatório "Rentabilidade em
// planilhas de fretamento" e covenants bancários usuais), não metas da
// empresa — as metas da empresa ficam no BSC.

export type Farol = "VERDE" | "AMARELO" | "VERMELHO" | "SEM_DADO" | "INFO";
export type Formato = "PCT" | "PP" | "VEZES" | "DIAS" | "MOEDA" | "NUMERO" | "MOEDA_KM";

export type GrupoIndicador = "RETORNO" | "DIVIDA" | "MARGENS" | "CLIENTES" | "FROTA";

export const GRUPOS_INDICADORES: { chave: GrupoIndicador; titulo: string; descricao: string }[] = [
  {
    chave: "RETORNO",
    titulo: "Retorno sobre o capital",
    descricao: "Quanto o dinheiro posto no negócio (dos sócios e dos bancos) rende por ano. Precisa do balanço.",
  },
  {
    chave: "DIVIDA",
    titulo: "Dívida e liquidez",
    descricao: "Se a operação paga as parcelas e os juros com folga, e quantos anos de geração de caixa a dívida representa.",
  },
  {
    chave: "MARGENS",
    titulo: "Margens e peso dos custos",
    descricao: "DRE gerencial dos 12 meses fechados, sobre a receita líquida.",
  },
  {
    chave: "CLIENTES",
    titulo: "Clientes e capital de giro",
    descricao: "Dependência de poucos clientes, prazo de recebimento e atraso — receita bruta dos 12 meses, pelos títulos a receber.",
  },
  {
    chave: "FROTA",
    titulo: "Frota",
    descricao: "Receita e custo por veículo e por km. Usa a frota e o km informados com o balanço.",
  },
];

export type Indicador = {
  chave: string;
  grupo: GrupoIndicador;
  rotulo: string;
  valor: number | null;
  formato: Formato;
  farol: Farol;
  // Faixa de referência, em texto, para a tela.
  referencia: string;
  // Como foi calculado, com os números que entraram.
  formula: string;
};

// ----------------------------------------------------------------- entradas

export type Competencia = string; // "AAAA-MM"

// A série do DRE por linha, em centavos e em módulo (como a demonstração
// mostra), por competência.
export type SerieDre = Map<string, Map<Competencia, number>>;

export type BalancoIndicadores = {
  dataBase: Date;
  caixaCents: number;
  contasReceberCents: number;
  ativoCirculanteCents: number;
  imobilizadoLiquidoCents: number;
  ativoTotalCents: number;
  fornecedoresCents: number;
  passivoCirculanteCents: number;
  dividaCurtoPrazoCents: number;
  dividaLongoPrazoCents: number;
  patrimonioLiquidoCents: number;
  // Lucros deliberados e não pagos: capital dos sócios ainda no negócio.
  dividendosAPagarCents: number;
  depreciacaoAnoCents: number | null;
  lucroLiquidoAnoCents: number | null;
  // DRE contábil dos 12 meses até a data-base (opcionais).
  receitaLiquidaAnoCents: number | null;
  ebitAnoCents: number | null;
  irCsllAnoCents: number | null;
  // Fração ao ano (0,18 = 18%).
  custoCapitalAa: number;
  frotaVeiculos: number | null;
  kmAno: number | null;
};

export type Recebiveis = {
  // Receita bruta dos 12 meses por cliente, em centavos.
  receitaPorClienteCents: number[];
  // Prazo médio ponderado pelo valor, da emissão à baixa (títulos pagos).
  pmrDias: number | null;
  pmpDias: number | null;
  // Saldo a receber de receita vencido há mais de 30 dias.
  vencidoMais30Cents: number;
};

export type EntradaIndicadores = {
  dre: SerieDre;
  // Os 12 meses fechados mais recentes (ou menos, se a base é mais curta), em ordem.
  competencias: Competencia[];
  // Os 12 meses que terminam na data-base do balanço — o DRE do mesmo período
  // do balanço. Nulo quando a base do sistema não cobre esse período.
  competenciasDoBalanco: Competencia[] | null;
  balanco: BalancoIndicadores | null;
  balancoAnterior: BalancoIndicadores | null;
  recebiveis: Recebiveis | null;
};

// ----------------------------------------------------------------- utilidades

export const DEPRECIACAO_ESTIMADA_AA = 0.12;

export function competenciaDe(d: Date): Competencia {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function somarMeses(c: Competencia, n: number): Competencia {
  const [a, m] = c.split("-").map(Number);
  const total = a * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

// Os 12 meses que terminam em `ultima`, se todos estão na base.
export function janelaDe12(ultima: Competencia, disponiveis: Competencia[]): Competencia[] | null {
  const tem = new Set(disponiveis);
  const janela = Array.from({ length: 12 }, (_, i) => somarMeses(ultima, i - 11));
  return janela.every((c) => tem.has(c)) ? janela : null;
}

// O mês fechado do balanço: data-base no último dia do mês é o próprio mês;
// no meio do mês, o anterior (o mês da data-base não fechou).
export function competenciaDoBalanco(dataBase: Date): Competencia {
  const amanha = new Date(Date.UTC(dataBase.getUTCFullYear(), dataBase.getUTCMonth(), dataBase.getUTCDate() + 1));
  const c = competenciaDe(dataBase);
  return amanha.getUTCMonth() !== dataBase.getUTCMonth() ? c : somarMeses(c, -1);
}

function soma(dre: SerieDre, chave: string, competencias: Competencia[]): number {
  const serie = dre.get(chave);
  if (!serie) return 0;
  return competencias.reduce((a, c) => a + (serie.get(c) ?? 0), 0);
}

// Os subtotais do DRE (a mesma conta de subtotaisDoDre) por janela.
export function dreDaJanela(dre: SerieDre, competencias: Competencia[]) {
  const g = (chave: string) => soma(dre, chave, competencias);
  const receitaBruta = g("RECEITA_BRUTA");
  const receitaLiquida = receitaBruta - g("DEDUCOES");
  const pessoas = g("DESPESA_SALARIOS") + g("DESPESA_SALARIOS_CORPORATIVO");
  const despesasOperacionais =
    g("CUSTO_SERVICO") +
    g("DESPESA_VEICULOS") +
    g("DESPESA_SERVICOS_TERCEIROS") +
    pessoas +
    g("DESPESA_SOCIOS") +
    g("DESPESA_ESTRUTURA") +
    g("DESPESA_INFORMATICA") +
    g("DESPESA_COMERCIAL") +
    g("DESPESA_ADMINISTRATIVA") +
    g("DESPESA_GERAL");
  const ebitda = receitaLiquida + g("OUTRAS_RECEITAS") - despesasOperacionais;
  const lair = ebitda + g("RECEITA_FINANCEIRA") - g("DESPESA_FINANCEIRA");
  const resultado = lair - g("FINANCIAMENTO_INVESTIMENTO") - g("TRIBUTO_SOBRE_LUCRO");
  return {
    meses: competencias.length,
    receitaBruta,
    receitaLiquida,
    pessoas,
    veiculos: g("DESPESA_VEICULOS"),
    terceiros: g("DESPESA_SERVICOS_TERCEIROS"),
    // Retiradas: o pró-labore (acima do resultado) e a distribuição (abaixo).
    socios: g("DESPESA_SOCIOS") + g("DISTRIBUICAO_LUCROS"),
    proLabore: g("DESPESA_SOCIOS"),
    despesasOperacionais,
    ebitda,
    despesaFinanceira: g("DESPESA_FINANCEIRA"),
    parcelas: g("FINANCIAMENTO_INVESTIMENTO"),
    tributoLucro: g("TRIBUTO_SOBRE_LUCRO"),
    resultado,
  };
}

// Resultado de cada mês, para contar os meses no vermelho.
export function resultadoPorMes(dre: SerieDre, competencias: Competencia[]): { competencia: Competencia; receitaLiquida: number; ebitda: number; resultado: number }[] {
  return competencias.map((c) => {
    const d = dreDaJanela(dre, [c]);
    return { competencia: c, receitaLiquida: d.receitaLiquida, ebitda: d.ebitda, resultado: d.resultado };
  });
}

const pct = (parte: number, todo: number) => (todo > 0 ? (parte / todo) * 100 : null);
const div = (a: number, b: number) => (b !== 0 ? a / b : null);

// Farol por faixas: `verde` e `amarelo` são os limites; `maiorMelhor` diz o lado.
export function farolPorFaixa(valor: number | null, verde: number, amarelo: number, maiorMelhor: boolean): Farol {
  if (valor === null || !Number.isFinite(valor)) return "SEM_DADO";
  if (maiorMelhor) return valor >= verde ? "VERDE" : valor >= amarelo ? "AMARELO" : "VERMELHO";
  return valor <= verde ? "VERDE" : valor <= amarelo ? "AMARELO" : "VERMELHO";
}

const reais = (cents: number) =>
  `R$ ${(cents / 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
const p1 = (v: number | null) => (v === null ? "—" : `${v.toFixed(1).replace(".", ",")}%`);

// Média de dois saldos (início e fim do período), ou o saldo do fim.
const media = (fim: number, inicio: number | null) => (inicio === null ? fim : (fim + inicio) / 2);

// ----------------------------------------------------------------- cálculo

export function calcularIndicadores(e: EntradaIndicadores): Indicador[] {
  const lista: Indicador[] = [];
  const add = (i: Indicador) => lista.push(i);
  const d = dreDaJanela(e.dre, e.competencias);
  const anualizar = d.meses > 0 ? 12 / d.meses : 0;
  const rotuloJanela = e.competencias.length > 0 ? `${e.competencias[0]} a ${e.competencias[e.competencias.length - 1]}` : "sem meses";

  // ------------------------------------------------ RETORNO (balanço)
  const b = e.balanco;
  const a = e.balancoAnterior;
  const semBalanco = "Informe o balanço para calcular.";
  if (b) {
    const dB = e.competenciasDoBalanco ? dreDaJanela(e.dre, e.competenciasDoBalanco) : d;
    const anualB = dB.meses > 0 ? 12 / dB.meses : 0;
    const janelaB = e.competenciasDoBalanco
      ? `DRE de ${e.competenciasDoBalanco[0]} a ${e.competenciasDoBalanco[11]}`
      : `DRE de ${rotuloJanela} (a base não cobre os 12 meses até a data-base)`;
    const divida = b.dividaCurtoPrazoCents + b.dividaLongoPrazoCents;
    // PATRIMÔNIO ECONÔMICO: o PL mais os lucros deliberados e ainda não
    // pagos. A deliberação tira o lucro do PL e o põe no passivo sem mexer
    // no caixa; até ser pago, é dinheiro dos sócios financiando a operação.
    // Sem isso, o ROE e o ROIC do ano da deliberação disparam — o da Azul
    // em 2025 iria de ~60% para mais de 200%.
    const plEconomico = (x: BalancoIndicadores) => x.patrimonioLiquidoCents + x.dividendosAPagarCents;
    const capital = (x: BalancoIndicadores) => x.dividaCurtoPrazoCents + x.dividaLongoPrazoCents + plEconomico(x) - x.caixaCents;
    const capitalMedio = media(capital(b), a ? capital(a) : null);
    const plMedio = media(plEconomico(b), a ? plEconomico(a) : null);
    const ativoMedio = media(b.ativoTotalCents, a ? a.ativoTotalCents : null);
    const depreciacaoEstimada = b.depreciacaoAnoCents === null;
    const depreciacao = b.depreciacaoAnoCents ?? Math.round(b.imobilizadoLiquidoCents * DEPRECIACAO_ESTIMADA_AA);
    const ebitdaB = dB.ebitda * anualB;
    const nopat = ebitdaB - depreciacao - dB.tributoLucro * anualB;
    const roic = pct(nopat, capitalMedio);
    const wacc = b.custoCapitalAa * 100;
    const medias = a ? "média do balanço anterior e deste" : "só este balanço (cadastre o anterior para usar a média)";

    add({
      chave: "ROIC",
      grupo: "RETORNO",
      rotulo: "ROIC — retorno sobre o capital investido",
      valor: roic,
      formato: "PCT",
      farol: roic === null ? "SEM_DADO" : farolPorFaixa(roic, wacc, wacc - 3, true),
      referencia: `Verde acima do custo do capital (${p1(wacc)}); amarelo até 3 p.p. abaixo. Fretamento bem gerido: 12% a 20%.`,
      formula: `NOPAT ${reais(nopat)} ÷ capital investido ${reais(capitalMedio)} (${medias}). NOPAT = EBITDA gerencial ${reais(ebitdaB)} − depreciação ${reais(depreciacao)}${depreciacaoEstimada ? " (estimada em 12% do imobilizado — informe a do DRE contábil)" : ""} − IRPJ/CSLL do DRE gerencial ${reais(dB.tributoLucro * anualB)}. Capital investido = dívida + PL + lucros a pagar aos sócios − caixa. ${janelaB}.`,
    });

    if (b.ebitAnoCents !== null) {
      const nopatContabil = b.ebitAnoCents - (b.irCsllAnoCents ?? 0);
      const roicContabil = pct(nopatContabil, capitalMedio);
      add({
        chave: "ROIC_CONTABIL",
        grupo: "RETORNO",
        rotulo: "ROIC contábil",
        valor: roicContabil,
        formato: "PCT",
        farol: roicContabil === null ? "SEM_DADO" : farolPorFaixa(roicContabil, wacc, wacc - 3, true),
        referencia: "O mesmo retorno com o resultado do DRE contábil — o número que banco e investidor leem.",
        formula: `(EBIT contábil ${reais(b.ebitAnoCents)} − IRPJ/CSLL ${reais(b.irCsllAnoCents ?? 0)}${b.irCsllAnoCents === null ? " (não informado)" : ""}) ÷ capital investido ${reais(capitalMedio)}.`,
      });
      if (b.receitaLiquidaAnoCents !== null && b.receitaLiquidaAnoCents > 0 && dB.receitaLiquida > 0) {
        const margemContabil = ((b.ebitAnoCents + depreciacao) / b.receitaLiquidaAnoCents) * 100;
        const margemGerencial = (dB.ebitda / dB.receitaLiquida) * 100;
        const diferenca = margemContabil - margemGerencial;
        add({
          chave: "CONCILIACAO",
          grupo: "RETORNO",
          rotulo: "Margem EBITDA: contábil − gerencial",
          valor: diferenca,
          formato: "PP",
          farol: farolPorFaixa(Math.abs(diferenca), 3, 7, false),
          referencia:
            "As duas leituras do mesmo ano deveriam ficar perto. Verde até 3 p.p.; amarelo até 7. Diferença grande é custo lançado no ativo (adiantamentos, consórcios), receita fora do mês ou classificação diferente — concilie com a contabilidade antes de usar qualquer um dos dois para preço.",
          formula: `Contábil: (EBIT ${reais(b.ebitAnoCents)} + depreciação ${reais(depreciacao)}) ÷ receita líquida ${reais(b.receitaLiquidaAnoCents)} = ${p1(margemContabil)}. Gerencial: ${p1(margemGerencial)} (${janelaB}). O gerencial trata as retiradas dos sócios como despesa e põe as vendas de veículos em outras receitas.`,
        });
      }
    }

    const eva = nopat - b.custoCapitalAa * capitalMedio;
    add({
      chave: "EVA",
      grupo: "RETORNO",
      rotulo: "EVA — lucro econômico no ano",
      valor: eva,
      formato: "MOEDA",
      farol: capitalMedio > 0 ? (eva >= 0 ? "VERDE" : "VERMELHO") : "SEM_DADO",
      referencia: "Positivo: o negócio paga o custo de todo o capital e ainda cria valor. Negativo: os sócios ganhariam mais aplicando o dinheiro no custo do capital.",
      formula: `NOPAT ${reais(nopat)} − ${p1(wacc)} × capital investido ${reais(capitalMedio)}.`,
    });

    const roe = b.lucroLiquidoAnoCents === null ? null : pct(b.lucroLiquidoAnoCents, plMedio);
    add({
      chave: "ROE",
      grupo: "RETORNO",
      rotulo: "ROE — retorno sobre o patrimônio",
      valor: roe,
      formato: "PCT",
      farol: farolPorFaixa(roe, 15, 10, true),
      referencia: "Verde ≥ 15% a.a.; amarelo 10% a 15%. Abaixo de 10%, o CDI rende mais que o capital dos sócios no negócio.",
      formula:
        b.lucroLiquidoAnoCents === null
          ? "Informe o lucro líquido contábil dos 12 meses até a data-base."
          : `Lucro líquido contábil ${reais(b.lucroLiquidoAnoCents)} ÷ PL econômico ${reais(plMedio)} (PL + lucros a pagar aos sócios; ${medias}).`,
    });

    const roa = b.lucroLiquidoAnoCents === null ? null : pct(b.lucroLiquidoAnoCents, ativoMedio);
    add({
      chave: "ROA",
      grupo: "RETORNO",
      rotulo: "ROA — retorno sobre o ativo",
      valor: roa,
      formato: "PCT",
      farol: farolPorFaixa(roa, 6, 3, true),
      referencia: "Verde ≥ 6% a.a.; amarelo 3% a 6%. Empresa de frota própria tem ativo pesado: ROA baixo é comum, mas abaixo de 3% a frota não se paga.",
      formula:
        b.lucroLiquidoAnoCents === null
          ? "Informe o lucro líquido contábil dos 12 meses até a data-base."
          : `Lucro líquido contábil ${reais(b.lucroLiquidoAnoCents)} ÷ ativo total ${reais(ativoMedio)} (${medias}).`,
    });

    const giro = div(dB.receitaLiquida * anualB, ativoMedio);
    add({
      chave: "GIRO_ATIVO",
      grupo: "RETORNO",
      rotulo: "Giro do ativo",
      valor: giro,
      formato: "VEZES",
      farol: farolPorFaixa(giro, 1.2, 0.8, true),
      referencia: "Quantas vezes a receita do ano cobre o ativo. Verde ≥ 1,2×; amarelo 0,8× a 1,2×. Frota parada ou veículo caro para o contrato derruba o giro.",
      formula: `Receita líquida ${reais(dB.receitaLiquida * anualB)} ÷ ativo total ${reais(ativoMedio)}.`,
    });

    const dividaLiquida = divida - b.caixaCents;
    const alavancagem = ebitdaB > 0 ? dividaLiquida / ebitdaB : null;
    add({
      chave: "DL_EBITDA",
      grupo: "DIVIDA",
      rotulo: "Dívida líquida ÷ EBITDA",
      valor: alavancagem,
      formato: "VEZES",
      farol: ebitdaB <= 0 ? "VERMELHO" : farolPorFaixa(alavancagem, 2.5, 3.5, false),
      referencia: "Anos de geração de caixa para quitar a dívida. Verde ≤ 2,5×; amarelo até 3,5× (o limite usual dos bancos para frota).",
      formula: `(Dívida ${reais(divida)} − caixa ${reais(b.caixaCents)}) ÷ EBITDA ${reais(ebitdaB)}.`,
    });

    const liquidez = div(b.ativoCirculanteCents, b.passivoCirculanteCents);
    add({
      chave: "LIQUIDEZ",
      grupo: "DIVIDA",
      rotulo: "Liquidez corrente",
      valor: liquidez,
      formato: "VEZES",
      farol: farolPorFaixa(liquidez, 1.2, 1.0, true),
      referencia: "Ativo circulante ÷ passivo circulante. Verde ≥ 1,2×; amarelo 1,0× a 1,2×. Abaixo de 1, as contas de 12 meses superam o que vira dinheiro no mesmo prazo.",
      formula: `${reais(b.ativoCirculanteCents)} ÷ ${reais(b.passivoCirculanteCents)}.`,
    });

    const endividamento = plEconomico(b) > 0 ? divida / plEconomico(b) : null;
    add({
      chave: "DIVIDA_PL",
      grupo: "DIVIDA",
      rotulo: "Dívida ÷ patrimônio líquido",
      valor: endividamento,
      formato: "VEZES",
      farol: plEconomico(b) <= 0 ? "VERMELHO" : farolPorFaixa(endividamento, 1.5, 2.5, false),
      referencia: "Quanto de dívida bancária para cada real dos sócios. Verde ≤ 1,5×; amarelo até 2,5×.",
      formula: `Dívida de curto e longo prazo ${reais(divida)} ÷ PL econômico ${reais(plEconomico(b))} (PL ${reais(b.patrimonioLiquidoCents)} + lucros a pagar aos sócios ${reais(b.dividendosAPagarCents)}).`,
    });
  } else {
    for (const [chave, rotulo, grupo] of [
      ["ROIC", "ROIC — retorno sobre o capital investido", "RETORNO"],
      ["EVA", "EVA — lucro econômico no ano", "RETORNO"],
      ["ROE", "ROE — retorno sobre o patrimônio", "RETORNO"],
      ["ROA", "ROA — retorno sobre o ativo", "RETORNO"],
      ["DL_EBITDA", "Dívida líquida ÷ EBITDA", "DIVIDA"],
      ["LIQUIDEZ", "Liquidez corrente", "DIVIDA"],
    ] as const) {
      add({ chave, grupo, rotulo, valor: null, formato: chave === "EVA" ? "MOEDA" : chave.startsWith("RO") ? "PCT" : "VEZES", farol: "SEM_DADO", referencia: "", formula: semBalanco });
    }
  }

  // ------------------------------------------------ DÍVIDA (DRE)
  const servico = d.despesaFinanceira + d.parcelas;
  const cobertura = servico > 0 ? d.ebitda / servico : null;
  add({
    chave: "COBERTURA",
    grupo: "DIVIDA",
    rotulo: "Cobertura do serviço da dívida",
    valor: cobertura,
    formato: "VEZES",
    farol: farolPorFaixa(cobertura, 1.3, 1.1, true),
    referencia: "EBITDA ÷ (juros + parcelas de financiamento, consórcio e empréstimo). Verde ≥ 1,3× (o mínimo que os bancos pedem); amarelo 1,1× a 1,3×.",
    formula: `EBITDA ${reais(d.ebitda)} ÷ (despesas financeiras ${reais(d.despesaFinanceira)} + parcelas ${reais(d.parcelas)}). ${rotuloJanela}.`,
  });
  const financeiras = pct(d.despesaFinanceira, d.receitaLiquida);
  add({
    chave: "FINANCEIRAS",
    grupo: "DIVIDA",
    rotulo: "Despesas financeiras ÷ receita",
    valor: financeiras,
    formato: "PCT",
    farol: farolPorFaixa(financeiras, 2, 4, false),
    referencia: "Juros, tarifas, IOF e encargos. Verde ≤ 2%; amarelo até 4%. Juros de atraso e de cartão entram aqui e são os mais baratos de cortar.",
    formula: `${reais(d.despesaFinanceira)} ÷ receita líquida ${reais(d.receitaLiquida)}.`,
  });

  // ------------------------------------------------ MARGENS
  add({
    chave: "RECEITA_12M",
    grupo: "MARGENS",
    rotulo: d.meses === 12 ? "Receita bruta — 12 meses" : `Receita bruta — ${d.meses} meses`,
    valor: d.receitaBruta,
    formato: "MOEDA",
    farol: "INFO",
    referencia: "",
    formula: `${rotuloJanela}. Receita líquida ${reais(d.receitaLiquida)}.`,
  });
  const margemEbitda = pct(d.ebitda, d.receitaLiquida);
  add({
    chave: "MARGEM_EBITDA",
    grupo: "MARGENS",
    rotulo: "Margem EBITDA gerencial",
    valor: margemEbitda,
    formato: "PCT",
    farol: farolPorFaixa(margemEbitda, 20, 15, true),
    referencia: "Resultado antes do financeiro e das parcelas da frota. Verde ≥ 20%; amarelo 15% a 20%. Com frota própria financiada, abaixo de 15% a operação não paga os veículos.",
    formula: `EBITDA ${reais(d.ebitda)} ÷ receita líquida ${reais(d.receitaLiquida)}.`,
  });
  const ros = pct(d.resultado, d.receitaLiquida);
  add({
    chave: "ROS",
    grupo: "MARGENS",
    rotulo: "ROS — margem líquida gerencial",
    valor: ros,
    formato: "PCT",
    farol: farolPorFaixa(ros, 5, 2, true),
    referencia: "O que sobra de cada real faturado depois de tudo, inclusive parcelas da frota. Verde ≥ 5%; amarelo 2% a 5%.",
    formula: `Resultado ${reais(d.resultado)} ÷ receita líquida ${reais(d.receitaLiquida)}.`,
  });
  const pessoas = pct(d.pessoas, d.receitaLiquida);
  add({
    chave: "PESSOAS",
    grupo: "MARGENS",
    rotulo: "Pessoas ÷ receita",
    valor: pessoas,
    formato: "PCT",
    farol: farolPorFaixa(pessoas, 45, 50, false),
    referencia: "Folha, encargos e benefícios da operação e do corporativo. Verde ≤ 45%; amarelo até 50%.",
    formula: `${reais(d.pessoas)} ÷ ${reais(d.receitaLiquida)}.`,
  });
  const veiculos = pct(d.veiculos, d.receitaLiquida);
  add({
    chave: "VEICULOS",
    grupo: "MARGENS",
    rotulo: "Veículos ÷ receita",
    valor: veiculos,
    formato: "PCT",
    farol: farolPorFaixa(veiculos, 30, 35, false),
    referencia: "Combustível, manutenção, pneus, seguro e IPVA. Verde ≤ 30%; amarelo até 35%.",
    formula: `${reais(d.veiculos)} ÷ ${reais(d.receitaLiquida)}.`,
  });
  const parcelas = pct(d.parcelas, d.receitaLiquida);
  add({
    chave: "PARCELAS",
    grupo: "MARGENS",
    rotulo: "Parcelas da frota ÷ receita",
    valor: parcelas,
    formato: "PCT",
    farol: farolPorFaixa(parcelas, 15, 20, false),
    referencia: "Financiamentos, consórcios e empréstimos. Verde ≤ 15%; amarelo até 20%. Acima disso, renovar frota tira o caixa da operação.",
    formula: `${reais(d.parcelas)} ÷ ${reais(d.receitaLiquida)}.`,
  });
  const terceiros = pct(d.terceiros, d.receitaLiquida);
  add({
    chave: "TERCEIROS",
    grupo: "MARGENS",
    rotulo: "Serviços de terceiros ÷ receita",
    valor: terceiros,
    formato: "PCT",
    farol: "INFO",
    referencia: "Agregados e subcontratação. Não tem faixa certa: compare com a margem dos contratos que eles atendem.",
    formula: `${reais(d.terceiros)} ÷ ${reais(d.receitaLiquida)}.`,
  });
  // A distribuição já está abaixo do resultado; o pró-labore, acima.
  const geradoAntesDosSocios = d.resultado + d.proLabore;
  const payout = geradoAntesDosSocios > 0 ? (d.socios / geradoAntesDosSocios) * 100 : d.socios > 0 ? Infinity : null;
  add({
    chave: "PAYOUT",
    grupo: "MARGENS",
    rotulo: "Retiradas dos sócios ÷ resultado gerado",
    valor: payout === Infinity ? null : payout,
    formato: "PCT",
    farol: payout === Infinity ? "VERMELHO" : farolPorFaixa(payout, 60, 100, false),
    referencia: "Quanto do resultado antes das retiradas os sócios levaram. Verde ≤ 60% (sobra para reinvestir na frota); amarelo até 100%; acima, a retirada consome caixa ou dívida.",
    formula:
      payout === Infinity
        ? `Retiradas ${reais(d.socios)} com resultado antes delas negativo (${reais(geradoAntesDosSocios)}).`
        : `Retiradas e pró-labore ${reais(d.socios)} ÷ (resultado ${reais(d.resultado)} + pró-labore ${reais(d.proLabore)}).`,
  });
  const meses = resultadoPorMes(e.dre, e.competencias);
  const negativos = meses.filter((m) => m.resultado < 0).length;
  add({
    chave: "MESES_NEGATIVOS",
    grupo: "MARGENS",
    rotulo: "Meses com resultado negativo",
    valor: meses.length > 0 ? negativos : null,
    formato: "NUMERO",
    farol: meses.length > 0 ? farolPorFaixa(negativos, 1, 3, false) : "SEM_DADO",
    referencia: "Nos últimos 12 meses. Verde até 1; amarelo 2 a 3. No escolar, janeiro e fevereiro sem receita pedem provisão nos meses de aula.",
    formula: meses.filter((m) => m.resultado < 0).map((m) => `${m.competencia}: ${reais(m.resultado)}`).join("; ") || "Nenhum.",
  });

  // ------------------------------------------------ CLIENTES
  const r = e.recebiveis;
  if (r) {
    const clientes = [...r.receitaPorClienteCents].sort((x, y) => y - x);
    const total = clientes.reduce((x, v) => x + v, 0);
    const top1 = pct(clientes[0] ?? 0, total);
    const top3 = pct(clientes.slice(0, 3).reduce((x, v) => x + v, 0), total);
    add({
      chave: "TOP1",
      grupo: "CLIENTES",
      rotulo: "Maior cliente ÷ receita",
      valor: top1,
      formato: "PCT",
      farol: farolPorFaixa(top1, 20, 35, false),
      referencia: "Verde ≤ 20%; amarelo até 35%. Acima, perder um contrato tira a empresa do azul.",
      formula: `${reais(clientes[0] ?? 0)} de ${reais(total)} faturados a ${clientes.length} clientes.`,
    });
    add({
      chave: "TOP3",
      grupo: "CLIENTES",
      rotulo: "Três maiores clientes ÷ receita",
      valor: top3,
      formato: "PCT",
      farol: farolPorFaixa(top3, 50, 70, false),
      referencia: "Verde ≤ 50%; amarelo até 70%.",
      formula: `${reais(clientes.slice(0, 3).reduce((x, v) => x + v, 0))} de ${reais(total)}.`,
    });
    add({
      chave: "PMR",
      grupo: "CLIENTES",
      rotulo: "Prazo médio de recebimento",
      valor: r.pmrDias,
      formato: "DIAS",
      farol: farolPorFaixa(r.pmrDias, 45, 60, false),
      referencia: "Da emissão ao recebimento, ponderado pelo valor. Verde ≤ 45 dias; amarelo até 60.",
      formula: "Títulos de receita dos 12 meses já recebidos.",
    });
    add({
      chave: "PMP",
      grupo: "CLIENTES",
      rotulo: "Prazo médio de pagamento",
      valor: r.pmpDias,
      formato: "DIAS",
      farol: "INFO",
      referencia: "Da emissão ao pagamento, ponderado pelo valor. Quanto mais perto do PMR, menos capital de giro a operação consome.",
      formula: "Títulos a pagar dos 12 meses já pagos.",
    });
    const ciclo = r.pmrDias !== null && r.pmpDias !== null ? r.pmrDias - r.pmpDias : null;
    add({
      chave: "CICLO",
      grupo: "CLIENTES",
      rotulo: "Ciclo financeiro",
      valor: ciclo,
      formato: "DIAS",
      farol: farolPorFaixa(ciclo, 15, 30, false),
      referencia: "PMR − PMP: dias em que a empresa financia a operação com caixa próprio. Verde ≤ 15; amarelo até 30.",
      formula: ciclo === null ? "Sem prazo de recebimento ou de pagamento." : `${Math.round(r.pmrDias!)} − ${Math.round(r.pmpDias!)} dias.`,
    });
    const receitaMes = d.meses > 0 ? d.receitaBruta / d.meses : 0;
    const inadimplencia = pct(r.vencidoMais30Cents, receitaMes);
    add({
      chave: "INADIMPLENCIA",
      grupo: "CLIENTES",
      rotulo: "Vencido há mais de 30 dias ÷ receita do mês",
      valor: inadimplencia,
      formato: "PCT",
      farol: farolPorFaixa(inadimplencia, 5, 15, false),
      referencia: "Saldo de receita vencido há mais de 30 dias sobre a receita bruta média de um mês. Verde ≤ 5%; amarelo até 15%.",
      formula: `${reais(r.vencidoMais30Cents)} ÷ ${reais(receitaMes)}.`,
    });
  }

  // ------------------------------------------------ FROTA
  const frota = b?.frotaVeiculos ?? null;
  const km = b?.kmAno ?? null;
  if (frota && frota > 0) {
    add({
      chave: "RECEITA_VEICULO",
      grupo: "FROTA",
      rotulo: "Receita por veículo por mês",
      valor: (d.receitaBruta * anualizar) / 12 / frota,
      formato: "MOEDA",
      farol: "INFO",
      referencia: "Compare com o preço mensal dos estudos do simulador para o mesmo tipo de veículo.",
      formula: `Receita bruta mensal ${reais((d.receitaBruta * anualizar) / 12)} ÷ ${frota} veículos.`,
    });
    const capitalPorVeiculo = b!.imobilizadoLiquidoCents / frota;
    add({
      chave: "IMOBILIZADO_VEICULO",
      grupo: "FROTA",
      rotulo: "Imobilizado por veículo",
      valor: capitalPorVeiculo,
      formato: "MOEDA",
      farol: "INFO",
      referencia: "Valor contábil médio da frota. Cai com a idade; se cai e a manutenção sobe, é hora de renovar.",
      formula: `Imobilizado líquido ${reais(b!.imobilizadoLiquidoCents)} ÷ ${frota} veículos.`,
    });
  }
  if (km && km > 0) {
    const custoKm = (d.despesasOperacionais * anualizar) / km;
    const receitaKm = (d.receitaLiquida * anualizar) / km;
    add({
      chave: "RECEITA_KM",
      grupo: "FROTA",
      rotulo: "Receita líquida por km",
      valor: receitaKm,
      formato: "MOEDA_KM",
      farol: "INFO",
      referencia: "",
      formula: `${reais(d.receitaLiquida * anualizar)} ÷ ${Math.round(km).toLocaleString("pt-BR")} km no ano.`,
    });
    add({
      chave: "CUSTO_KM",
      grupo: "FROTA",
      rotulo: "Custo operacional por km",
      valor: custoKm,
      formato: "MOEDA_KM",
      farol: receitaKm > 0 ? farolPorFaixa(custoKm / receitaKm, 0.8, 0.85, false) : "SEM_DADO",
      referencia: "Todos os custos e despesas operacionais (sem financeiro e sem parcelas) por km. Verde até 80% da receita por km; amarelo até 85%.",
      formula: `${reais(d.despesasOperacionais * anualizar)} ÷ ${Math.round(km).toLocaleString("pt-BR")} km.`,
    });
    if (frota && frota > 0) {
      add({
        chave: "KM_VEICULO",
        grupo: "FROTA",
        rotulo: "Km por veículo por mês",
        valor: km / 12 / frota,
        formato: "NUMERO",
        farol: "INFO",
        referencia: "Uso da frota. Veículo rodando pouco carrega o custo fixo inteiro em poucos km.",
        formula: `${Math.round(km).toLocaleString("pt-BR")} km ÷ 12 ÷ ${frota} veículos.`,
      });
    }
  }

  return lista;
}

// Prazo médio ponderado: Σ(valor × dias) ÷ Σ valor.
export function prazoPonderado(somaPonderada: number, somaValores: number): number | null {
  return somaValores > 0 ? somaPonderada / somaValores : null;
}
