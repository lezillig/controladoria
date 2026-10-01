import { financeiroPct, IRPJ_LOCACAO_PADRAO, CSLL_LOCACAO_PADRAO } from "./motor";
import type { EntradaSimulacao, Premissas, ResultadoSimulacao } from "./tipos";

// A REFORMA TRIBUTÁRIA ANO A ANO (EC 132/2023, LC 214/2025).
//
// O estudo calcula com os tributos de hoje. Aqui, o mesmo custo passa por
// cada ano do contrato com os tributos daquele ano — e, depois do fim do
// contrato, pelos anos que faltam até 2033, como renovação nas mesmas
// condições (12 meses por ano):
//   - 2026: PIS/COFINS como hoje; CBS 0,9% e IBS 0,1% de teste, compensáveis
//     (carga adicional zero — só destaque na nota);
//   - 2027 e 2028: PIS/COFINS extintos; CBS cheia menos 0,1 p.p. e IBS 0,1%;
//   - 2029 a 2032: ISS e ICMS a 90%, 80%, 70% e 60%; IBS a 10%, 20%, 30% e
//     40% da alíquota de referência;
//   - 2033: ISS e ICMS extintos, IBS cheio.
// CBS e IBS são cobrados POR FORA (somados ao preço, destacados na nota) e
// não cumulativos: o que se paga nas compras volta como crédito. A folha não
// dá crédito. IRPJ/CSLL continuam (no Presumido, sobre a receita sem CBS/IBS).
//
// Simplificações, ditas na tela: o preço dos insumos fica o de hoje, já com
// a CBS/IBS dentro (o crédito é t ÷ (1 + t) do valor); a administração
// central não muda; o crédito na compra do veículo, quando ligado, reduz o
// valor do veículo em t ÷ (1 + t) — e com ele a depreciação e o capital.
//
// As alíquotas de referência são ESTIMATIVAS (o Senado ainda as fixa):
// premissas editáveis, com padrão CBS 8,8% e IBS 17,7%.

export const CBS_REFERENCIA_PADRAO = 0.088;
export const IBS_REFERENCIA_PADRAO = 0.177;

export type AnoTransicao = {
  ano: number;
  pisCofins: boolean;
  cbs: number;
  ibs: number;
  // Fração do ISS e do ICMS de hoje que ainda se cobra.
  fatorIssIcms: number;
  // 2026: CBS/IBS de teste, compensados — destacados, sem custo.
  teste: boolean;
};

export function tabelaDeTransicao(p: Premissas): AnoTransicao[] {
  const reducao = p.preco.reducaoIbsCbsPct ?? 0;
  const cbs = (p.preco.cbsReferencia ?? CBS_REFERENCIA_PADRAO) * (1 - reducao);
  const ibs = (p.preco.ibsReferencia ?? IBS_REFERENCIA_PADRAO) * (1 - reducao);
  return [
    { ano: 2026, pisCofins: true, cbs: 0.009, ibs: 0.001, fatorIssIcms: 1, teste: true },
    { ano: 2027, pisCofins: false, cbs: Math.max(0, cbs - 0.001), ibs: 0.001, fatorIssIcms: 1, teste: false },
    { ano: 2028, pisCofins: false, cbs: Math.max(0, cbs - 0.001), ibs: 0.001, fatorIssIcms: 1, teste: false },
    { ano: 2029, pisCofins: false, cbs, ibs: ibs * 0.1, fatorIssIcms: 0.9, teste: false },
    { ano: 2030, pisCofins: false, cbs, ibs: ibs * 0.2, fatorIssIcms: 0.8, teste: false },
    { ano: 2031, pisCofins: false, cbs, ibs: ibs * 0.3, fatorIssIcms: 0.7, teste: false },
    { ano: 2032, pisCofins: false, cbs, ibs: ibs * 0.4, fatorIssIcms: 0.6, teste: false },
    { ano: 2033, pisCofins: false, cbs, ibs, fatorIssIcms: 0, teste: false },
  ];
}

// O ano da tabela: antes de 2026, como 2026 (tributos de hoje); depois de
// 2033, como 2033.
export function anoDaTransicao(tabela: AnoTransicao[], ano: number): AnoTransicao {
  return tabela.find((t) => t.ano === Math.min(2033, Math.max(2026, ano)))!;
}

export type Linha = { rotulo: string; aliquota: number | null; valor: number; memo?: string };

export type AnoReforma = {
  ano: number;
  meses: number;
  // Ano depois do fim do contrato, projetado como renovação nas mesmas
  // condições (12 meses): mostra o reequilíbrio até o fim da transição.
  projecao: boolean;
  transicao: AnoTransicao;
  // Valores do ANO (mês médio × meses do contrato no ano).
  custo: number;
  credito: number;
  creditos: Linha[];
  custoLiquido: number;
  // Tributos por dentro do preço (% da receita sem CBS/IBS).
  tributosDentroPct: number;
  // B — o preço que mantém o lucro alvo.
  receita: number;
  tributos: Linha[];
  cbs: number;
  ibs: number;
  nota: number;
  lucro: number;
  margem: number | null;
  // Nota do ano ÷ nota de hoje − 1: o reequilíbrio a pedir.
  reequilibrio: number | null;
  // Tudo o que vai a tributo (dentro + CBS/IBS − crédito) ÷ nota.
  carga: number | null;
  // A — o cliente segue pagando a nota de hoje: CBS/IBS saem de dentro dela.
  semReequilibrio: { receita: number; cbs: number; ibs: number; lucro: number; margem: number | null };
};

export type ReformaDoEstudo = {
  inicio: { ano: number; mes: number };
  vigenciaMeses: number;
  hoje: { notaMes: number; margem: number | null; custoMes: number };
  anos: AnoReforma[];
  // Os anos da transição depois do contrato (até 2033), se renovado.
  alemDoContrato: AnoReforma[];
  tabela: AnoTransicao[];
  // A pior margem sem reequilíbrio e o reequilíbrio acumulado até o último ano.
  piorSemReequilibrio: { ano: number; margem: number | null } | null;
  reequilibrioFinal: number | null;
  atravessa: boolean;
};

const dividir = (a: number, b: number) => (b === 0 ? 0 : a / b);

// Sem início informado: o mês seguinte ao de hoje, "2026-11".
export function proximoMes(hoje = new Date()): string {
  const p = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1);
  return `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, "0")}`;
}

// "2027-03" → { ano: 2027, mes: 3 }. Inválido → null.
export function lerInicio(texto: string | null | undefined): { ano: number; mes: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(texto ?? "");
  if (!m) return null;
  const mes = Number(m[2]);
  return mes >= 1 && mes <= 12 ? { ano: Number(m[1]), mes } : null;
}

// Meses do contrato em cada ano civil.
export function mesesPorAno(inicio: { ano: number; mes: number }, vigenciaMeses: number): Map<number, number> {
  const r = new Map<number, number>();
  for (let k = 0; k < Math.max(1, Math.round(vigenciaMeses)); k++) {
    const ano = inicio.ano + Math.floor((inicio.mes - 1 + k) / 12);
    r.set(ano, (r.get(ano) ?? 0) + 1);
  }
  return r;
}

export function reformaAnoAAno(
  entrada: EntradaSimulacao,
  resultado: ResultadoSimulacao,
  opcoes: { inicio: { ano: number; mes: number }; creditoVeiculo?: boolean }
): ReformaDoEstudo {
  const p = entrada.premissas;
  const pr = p.preco;
  const m = p.contrato.modo === "MENSAL" ? 1 : Math.max(1, p.contrato.mesesCustoFixo);
  const tabela = tabelaDeTransicao(p);
  const soma = (f: (i: ResultadoSimulacao["itens"][number]) => number) => resultado.itens.reduce((a, i) => a + f(i), 0);

  // Por MÊS médio (a apuração ÷ meses da apuração).
  const faturamentoMes = soma((i) => i.faturamento) / m;
  const custoMes = soma((i) => i.custoTotal) / m;
  const creditoHojeMes = soma((i) => i.creditoPisCofins) / m;
  const naoDedutiveisMes = soma((i) => i.naoDedutiveis) / m;
  // Insumos que dão crédito, por mês: os variáveis já estão na apuração; os
  // fixos do veículo são mensais.
  const variavel = (f: (i: ResultadoSimulacao["itens"][number]) => number) => soma(f) / m;
  const insumos: { rotulo: string; valor: number }[] = [
    { rotulo: "Combustível / energia", valor: variavel((i) => i.diesel) },
    { rotulo: "ARLA", valor: variavel((i) => i.arla) },
    { rotulo: "Óleo e lavagem", valor: variavel((i) => i.oleoLavagem) },
    { rotulo: "Pneus", valor: variavel((i) => i.pneus) },
    { rotulo: "Manutenção por km", valor: variavel((i) => i.manutencao) },
    { rotulo: "Pedágio", valor: variavel((i) => i.pedagio) },
    { rotulo: "Manutenção fixa", valor: soma((i) => i.manutencaoFixa) },
    { rotulo: "Garagem / base local", valor: soma((i) => i.garagem) },
    { rotulo: "Telemetria e controle de embarque", valor: soma((i) => i.telemetria) },
    { rotulo: "Higienização e acessibilidade", valor: soma((i) => i.higieneAcessibilidade) },
  ];
  if (opcoes.creditoVeiculo)
    insumos.push({ rotulo: "Veículo (compra com crédito: depreciação, capital e adaptações)", valor: soma((i) => i.depreciacao + i.remuneracaoCapital + i.adaptacao) });

  // Os tributos por dentro de hoje, ponderados pelo faturamento de cada item:
  // IRPJ/CSLL (da locação no item sem motorista), ISS e ICMS pela parcela
  // intermunicipal. PIS/COFINS entram só enquanto existem.
  const pesos = resultado.itens.map((c) => {
    const item = entrada.itens.find((i) => i.codigo === c.item);
    const locacao = item?.comMotorista === false;
    const presumido = pr.irpjCsllSobreLucroPct === 0;
    const share = item?.shareIntermunicipal ?? 0;
    return {
      peso: dividir(c.faturamento, soma((i) => i.faturamento)) || dividir(1, resultado.itens.length),
      irpj: locacao && presumido ? (pr.irpjLocacao ?? IRPJ_LOCACAO_PADRAO) : pr.irpj,
      csll: locacao && presumido ? (pr.csllLocacao ?? CSLL_LOCACAO_PADRAO) : pr.csll,
      iss: locacao ? 0 : pr.iss * (1 - share),
      icms: locacao ? 0 : pr.icms * share,
    };
  });
  const media = (k: "irpj" | "csll" | "iss" | "icms") => pesos.reduce((a, x) => a + x.peso * x[k], 0);
  const pis = pr.pis, cofins = pr.cofins;
  const irpj = media("irpj"), csll = media("csll"), iss = media("iss"), icms = media("icms");
  const fin = financeiroPct(p);
  const sobrePreco = pr.despesasSobrePrecoPct;
  const ir = pr.irpjCsllSobreLucroPct;
  const alvo = pr.lucroAlvoPct;
  const lucroDepoisIr = (receita: number, liquido: number, custo: number) => {
    const antes = receita * liquido - custo;
    return antes - (ir > 0 ? Math.max(0, antes + naoDedutiveisMes) * ir : 0);
  };

  const calcularAno = (ano: number, meses: number, projecao: boolean): AnoReforma => {
    const t = anoDaTransicao(tabela, ano);
    const novo = !t.pisCofins; // CBS/IBS de verdade (não o teste de 2026)
    const aliquota = novo ? t.cbs + t.ibs : 0;
    // Crédito: no regime novo, t ÷ (1 + t) dos insumos; antes dele, o
    // crédito de PIS/COFINS de hoje (Lucro Real), se houver.
    const creditos: Linha[] = novo
      ? insumos.filter((x) => x.valor > 0).map((x) => ({ rotulo: x.rotulo, aliquota: aliquota / (1 + aliquota), valor: x.valor * (aliquota / (1 + aliquota)) * meses }))
      : creditoHojeMes > 0
        ? [{ rotulo: "Crédito de PIS/COFINS de hoje (Lucro Real)", aliquota: pr.creditoPisCofinsPct, valor: creditoHojeMes * meses }]
        : [];
    const creditoMes = creditos.reduce((a, c) => a + c.valor, 0) / meses;
    const custoLiquidoMes = custoMes - creditoMes;

    const dentro: { rotulo: string; aliquota: number }[] = [
      ...(t.pisCofins ? [{ rotulo: "PIS", aliquota: pis }, { rotulo: "COFINS", aliquota: cofins }] : []),
      { rotulo: ir > 0 ? "IRPJ (sobre o lucro, fora daqui)" : "IRPJ", aliquota: irpj },
      { rotulo: ir > 0 ? "CSLL (sobre o lucro, fora daqui)" : "CSLL", aliquota: csll },
      { rotulo: t.fatorIssIcms < 1 ? `ISS (${Math.round(t.fatorIssIcms * 100)}% do de hoje)` : "ISS", aliquota: iss * t.fatorIssIcms },
      { rotulo: t.fatorIssIcms < 1 ? `ICMS (${Math.round(t.fatorIssIcms * 100)}% do de hoje)` : "ICMS", aliquota: icms * t.fatorIssIcms },
    ].filter((x) => x.aliquota > 0);
    const dentroPct = dentro.reduce((a, x) => a + x.aliquota, 0);
    const liquido = 1 - dentroPct - fin - sobrePreco;

    // B: o preço (sem CBS/IBS) que dá o lucro alvo — a conta do motor.
    const divisor = liquido - dividir(alvo, 1 - ir);
    const receitaMes = divisor > 0 ? (custoLiquidoMes + naoDedutiveisMes * dividir(ir, 1 - ir)) / divisor : 0;
    const cbsMes = novo ? receitaMes * t.cbs : 0;
    const ibsMes = novo ? receitaMes * t.ibs : 0;
    const notaMes = receitaMes + cbsMes + ibsMes;
    const lucroMes = lucroDepoisIr(receitaMes, liquido, custoLiquidoMes);

    // A: a nota de hoje, com CBS/IBS saindo de dentro dela.
    const receitaA = faturamentoMes / (1 + aliquota);
    const lucroA = lucroDepoisIr(receitaA, liquido, custoLiquidoMes);

    const tributos: Linha[] = [
      ...dentro.map((x) => ({ rotulo: x.rotulo, aliquota: x.aliquota, valor: receitaMes * x.aliquota * meses })),
      ...(t.teste
        ? [{ rotulo: "CBS 0,9% + IBS 0,1% de teste", aliquota: 0.01, valor: 0, memo: "destacados na nota e compensados — sem custo" }]
        : [
            { rotulo: "CBS (por fora)", aliquota: t.cbs, valor: cbsMes * meses },
            { rotulo: "IBS (por fora)", aliquota: t.ibs, valor: ibsMes * meses },
          ]),
    ];
    const tributoMes = receitaMes * dentroPct + cbsMes + ibsMes - creditoMes;
    return {
      ano,
      meses,
      projecao,
      transicao: t,
      custo: custoMes * meses,
      credito: creditoMes * meses,
      creditos,
      custoLiquido: custoLiquidoMes * meses,
      tributosDentroPct: dentroPct,
      receita: receitaMes * meses,
      tributos,
      cbs: cbsMes * meses,
      ibs: ibsMes * meses,
      nota: notaMes * meses,
      lucro: lucroMes * meses,
      margem: receitaMes > 0 ? lucroMes / receitaMes : null,
      reequilibrio: faturamentoMes > 0 ? notaMes / faturamentoMes - 1 : null,
      carga: notaMes > 0 ? tributoMes / notaMes : null,
      semReequilibrio: {
        receita: receitaA * meses,
        cbs: receitaA * (novo ? t.cbs : 0) * meses,
        ibs: receitaA * (novo ? t.ibs : 0) * meses,
        lucro: lucroA * meses,
        margem: receitaA > 0 ? lucroA / receitaA : null,
      },
    };
  };

  const porAno = mesesPorAno(opcoes.inicio, p.contrato.vigenciaMeses);
  const anos = [...porAno].map(([ano, meses]) => calcularAno(ano, meses, false));
  const ultimoAno = Math.max(...porAno.keys());
  const ANO_FINAL = tabela[tabela.length - 1].ano;
  const alemDoContrato: AnoReforma[] = [];
  for (let ano = ultimoAno + 1; ano <= ANO_FINAL; ano++) alemDoContrato.push(calcularAno(ano, 12, true));

  const comMargem = anos.filter((a) => a.semReequilibrio.margem !== null);
  const pior = comMargem.length ? comMargem.reduce((a, b) => ((b.semReequilibrio.margem ?? 0) < (a.semReequilibrio.margem ?? 0) ? b : a)) : null;
  const ultimo = anos[anos.length - 1];
  return {
    inicio: opcoes.inicio,
    vigenciaMeses: p.contrato.vigenciaMeses,
    hoje: { notaMes: faturamentoMes, margem: resultado.totais.margem, custoMes: custoMes - creditoHojeMes },
    anos,
    alemDoContrato,
    tabela,
    piorSemReequilibrio: pior ? { ano: pior.ano, margem: pior.semReequilibrio.margem } : null,
    reequilibrioFinal: ultimo?.reequilibrio ?? null,
    atravessa: anos.some((a) => a.ano >= 2027),
  };
}

// O texto da cláusula de reequilíbrio, com os números do estudo.
export function clausulaDeReequilibrio(r: ReformaDoEstudo): string {
  const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);
  const anos = r.anos.filter((a) => a.ano >= 2027 && a.reequilibrio !== null);
  const lista = anos.map((a) => `${a.ano}: ${a.reequilibrio! >= 0 ? "+" : ""}${pct(a.reequilibrio)}`).join("; ");
  return (
    "CLÁUSULA — REEQUILÍBRIO PELA REFORMA TRIBUTÁRIA. Os preços desta proposta foram formados com os tributos vigentes na data da proposta " +
    "(PIS, COFINS, ISS/ICMS, IRPJ e CSLL). A instituição da CBS e do IBS e a redução gradual do ISS e do ICMS (Emenda Constitucional 132/2023 e " +
    "Lei Complementar 214/2025) alteram a carga tributária do contrato. A CBS e o IBS serão acrescidos ao preço e destacados no documento fiscal, e os " +
    "preços serão revistos a cada alteração de alíquota ou de regra de transição, para manter o equilíbrio econômico-financeiro da proposta" +
    (lista ? ` (estimativa do efeito sobre o valor total do documento fiscal, com as alíquotas de referência estimadas hoje — ${lista}).` : ".")
  );
}
