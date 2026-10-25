// O CAIXA MÊS A MÊS — a conta do passo a passo clássico, sem banco:
//
//   saldo inicial (o final do mês anterior)
//   + entradas (realizado, pelo extrato), comparadas ao previsto (títulos a
//     receber que venciam no mês)
//   − saídas por tipo (variáveis, pessoal, fixos, impostos, financeiras,
//     financiamentos, sócios), comparadas ao previsto (títulos a pagar)
//   = geração de caixa;  saldo final = inicial + geração → inicial do seguinte.
//
// E os indicadores da comparação mensal: variação contra o mês anterior
// (horizontal), margem de caixa (geração ÷ entradas) e previsto × realizado.
//
// TRANSFERÊNCIA ENTRE CONTAS fica em linha própria: numa conta só é dinheiro
// que entrou ou saiu de verdade; somando todas as contas da empresa, uma
// transferência sai de uma e entra na outra e se anula — mas infla entradas e
// saídas se misturada aos recebimentos e pagamentos.

export const GRUPOS_DE_ENTRADA = ["Recebimentos de clientes", "Receitas financeiras", "Empréstimos e aportes", "Transferências entre contas", "Outras entradas"] as const;
export const GRUPOS_DE_SAIDA = [
  "Custos variáveis (operação)",
  "Pessoal",
  "Custos fixos (estrutura e administração)",
  "Impostos",
  "Financeiras e tarifas",
  "Financiamentos e investimentos",
  "Sócios (pró-labore e lucros)",
  "Transferências entre contas",
  "Sem categoria",
] as const;
export type GrupoEntrada = (typeof GRUPOS_DE_ENTRADA)[number];
export type GrupoSaida = (typeof GRUPOS_DE_SAIDA)[number];

// A linha do DRE da categoria decide o grupo do fluxo.
export function grupoDoFluxo(linha: string | null, entrada: boolean, transferencia: boolean): GrupoEntrada | GrupoSaida {
  if (transferencia) return "Transferências entre contas";
  if (entrada) {
    if (linha === "RECEITA_BRUTA" || linha === "OUTRAS_RECEITAS") return "Recebimentos de clientes";
    if (linha === "RECEITA_FINANCEIRA") return "Receitas financeiras";
    if (linha === "FINANCIAMENTO_INVESTIMENTO") return "Empréstimos e aportes";
    return "Outras entradas";
  }
  switch (linha) {
    case "CUSTO_SERVICO":
    case "DESPESA_VEICULOS":
    case "DESPESA_SERVICOS_TERCEIROS":
    case "DESPESA_COMERCIAL":
      return "Custos variáveis (operação)";
    case "DESPESA_SALARIOS":
    case "DESPESA_SALARIOS_CORPORATIVO":
      return "Pessoal";
    case "DESPESA_ESTRUTURA":
    case "DESPESA_INFORMATICA":
    case "DESPESA_ADMINISTRATIVA":
    case "DESPESA_GERAL":
      return "Custos fixos (estrutura e administração)";
    case "DEDUCOES":
    case "TRIBUTO_SOBRE_LUCRO":
      return "Impostos";
    case "DESPESA_FINANCEIRA":
      return "Financeiras e tarifas";
    case "FINANCIAMENTO_INVESTIMENTO":
      return "Financiamentos e investimentos";
    case "DESPESA_SOCIOS":
    case "DISTRIBUICAO_LUCROS":
      return "Sócios (pró-labore e lucros)";
    default:
      return "Sem categoria";
  }
}

export type SomaDoMes = { mes: string; grupo: string; entrada: boolean; cents: number };
export type PrevistoDoMes = { mes: string; natureza: "PAGAR" | "RECEBER"; cents: number };

export type MesDeCaixa = {
  mes: string;
  saldoInicialCents: number;
  entradasCents: number;
  entradasPorGrupo: Record<string, number>;
  saidasCents: number;
  saidasPorGrupo: Record<string, number>;
  geracaoCents: number;
  saldoFinalCents: number;
  previstoReceberCents: number;
  previstoPagarCents: number;
  // Indicadores.
  margemCaixa: number | null;
  variacaoEntradas: number | null;
  variacaoSaidas: number | null;
  // Recebido de clientes ÷ previsto a receber; pago (sem transferências) ÷ previsto a pagar.
  realizadoReceber: number | null;
  realizadoPagar: number | null;
};

const meses = (desde: string, ate: string) => {
  const r: string[] = [];
  let [a, m] = desde.split("-").map(Number);
  const [aFim, mFim] = ate.split("-").map(Number);
  while (a < aFim || (a === aFim && m <= mFim)) {
    r.push(`${a}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      a++;
    }
  }
  return r;
};

export function caixaMesAMes(params: { somas: SomaDoMes[]; previsto: PrevistoDoMes[]; saldoInicialCents: number; desde: string; ate: string }): MesDeCaixa[] {
  let saldo = params.saldoInicialCents;
  let anterior: MesDeCaixa | null = null;
  const resultado: MesDeCaixa[] = [];
  const variacao = (a: number, b: number | undefined) => (b === undefined || b === 0 ? null : (a - b) / Math.abs(b));
  for (const mes of meses(params.desde, params.ate)) {
    const doMes = params.somas.filter((s) => s.mes === mes);
    const entradasPorGrupo: Record<string, number> = {};
    const saidasPorGrupo: Record<string, number> = {};
    for (const s of doMes) {
      if (s.entrada) entradasPorGrupo[s.grupo] = (entradasPorGrupo[s.grupo] ?? 0) + s.cents;
      else saidasPorGrupo[s.grupo] = (saidasPorGrupo[s.grupo] ?? 0) - s.cents;
    }
    const entradasCents = Object.values(entradasPorGrupo).reduce((a, v) => a + v, 0);
    const saidasCents = Object.values(saidasPorGrupo).reduce((a, v) => a + v, 0);
    const geracaoCents = entradasCents - saidasCents;
    const previstoReceberCents = params.previsto.filter((p) => p.mes === mes && p.natureza === "RECEBER").reduce((a, p) => a + p.cents, 0);
    const previstoPagarCents = params.previsto.filter((p) => p.mes === mes && p.natureza === "PAGAR").reduce((a, p) => a + p.cents, 0);
    const recebidoClientes = entradasPorGrupo["Recebimentos de clientes"] ?? 0;
    const pagoSemTransferencia = saidasCents - (saidasPorGrupo["Transferências entre contas"] ?? 0);
    const m: MesDeCaixa = {
      mes,
      saldoInicialCents: saldo,
      entradasCents,
      entradasPorGrupo,
      saidasCents,
      saidasPorGrupo,
      geracaoCents,
      saldoFinalCents: saldo + geracaoCents,
      previstoReceberCents,
      previstoPagarCents,
      margemCaixa: entradasCents > 0 ? geracaoCents / entradasCents : null,
      variacaoEntradas: variacao(entradasCents, anterior?.entradasCents),
      variacaoSaidas: variacao(saidasCents, anterior?.saidasCents),
      realizadoReceber: previstoReceberCents > 0 ? recebidoClientes / previstoReceberCents : null,
      realizadoPagar: previstoPagarCents > 0 ? pagoSemTransferencia / previstoPagarCents : null,
    };
    resultado.push(m);
    saldo = m.saldoFinalCents;
    anterior = m;
  }
  return resultado;
}
