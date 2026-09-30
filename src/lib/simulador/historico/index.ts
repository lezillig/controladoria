import type { EntradaSimulacao, Item, Premissas, Rota } from "../tipos";
import premissasHolambra from "./premissas_holambra_pe036_2026.json";
import premissasSjp from "./premissas_sjpinhais_pe089_2026.json";
import regrasSjp from "./regras_edital_sjpinhais_pe089_2026.json";

// O HISTÓRICO QUE VEIO DAS PLANILHAS — Holambra PE 036/2026 e São José dos
// Pinhais PE 089/2026 — convertido para a entrada do motor.
//
// As premissas são lidas dos arquivos de sementes do pacote de migração
// (docs/simulador_custos_handoff/seeds/), pelo RÓTULO de cada linha, e não
// copiadas à mão: se alguém corrigir um número na semente, a simulação
// histórica muda junto. A leitura registra que rótulos foram consumidos; o
// teste confere que todo número da semente foi usado ou declarado derivado —
// premissa que some em silêncio é o defeito que este arquivo existe para
// impedir.
//
// As rotas não estão nas sementes (estão nos scripts geradores e nos casos de
// teste); ficam aqui, com a origem de cada número ao lado.

export const FONTE_HISTORICO = "estimativa de mercado set/2026";

type LinhaSemente = { item: string; valor: unknown; unidade: string | null; nota: string | null };
type Semente = { secao: string; itens: LinhaSemente[] }[];

export type LeitorDeSemente = {
  numero: (inicioDoRotulo: string) => number;
  texto: (inicioDoRotulo: string) => string | null;
  consumidos: Set<string>;
  todas: LinhaSemente[];
};

export function leitorDeSemente(semente: Semente): LeitorDeSemente {
  const todas = semente.flatMap((s) => s.itens);
  const consumidos = new Set<string>();
  const achar = (inicio: string) => {
    const achadas = todas.filter((l) => l.item.startsWith(inicio));
    if (achadas.length !== 1) throw new Error(`Semente: o rótulo "${inicio}" casou ${achadas.length} linhas.`);
    consumidos.add(achadas[0].item);
    return achadas[0];
  };
  return {
    numero: (inicio) => {
      const v = achar(inicio).valor;
      if (typeof v !== "number") throw new Error(`Semente: "${inicio}" não é número.`);
      return v;
    },
    texto: (inicio) => {
      const v = achar(inicio).valor;
      return typeof v === "string" ? v : null;
    },
    consumidos,
    todas,
  };
}

// O que as planilhas de referência não tinham — ver os modelos de concorrentes
// em docs/simulador_custos/DECISOES.md — entra zerado, e a conta fica a delas.
// Sem horas noturnas, o adicional noturno não entra na conta; fica o da CLT.
const SEM_HORAS_EXTRAS = { divisorHorasMes: 220, horasExtras50Mes: 0, horasExtras100Mes: 0, horasNoturnasMes: 0, adicionalNoturnoPct: 0.2 };
const SEM_ADAPTACAO = {
  adaptacaoValor: 0,
  adaptacaoMesesDepreciacao: 0,
  manutencaoFixaPctMes: 0,
  // Depreciação por percentual sobre o valor, capital a taxa única: o método
  // das duas planilhas.
  metodoDepreciacao: "PERCENTUAL" as const,
  vidaUtilAnos: 0,
  valorResidualPct: 0,
  idadeInicialAnos: 0,
  capitalComposto: false,
  fracaoFinanciada: 0,
  taxaFinanciamentoAa: 0,
  custoCapitalProprioAa: 0,
  remuneracaoSobreValorMedio: false,
};
const PRESUMIDO = { irpjCsllSobreLucroPct: 0, creditoPisCofinsPct: 0 };

export type SimulacaoHistorica = {
  edital: {
    numero: string;
    orgao: string;
    municipio: string;
    uf: string;
    modalidade: string;
    plataforma: string | null;
    dataSessao: string; // AAAA-MM-DD
    objeto: string;
    tipoServico: "ESCOLAR" | "FRETAMENTO" | "FRETAMENTO_EVENTUAL" | "SAUDE" | "LOCACAO_CM" | "LOCACAO_SM";
    unidadePreco: "KM";
    vigenciaMeses: number;
    srp: boolean;
    prazoPagamentoDias: number | null;
    dataOrcamento: string | null;
    indiceReajuste: string | null;
    valorTotalMaximo: number | null;
  };
  entrada: EntradaSimulacao;
  regras: { tema: string; texto: string; impacto: string; campo: string | null }[];
  observacoes: string;
  leitor: LeitorDeSemente;
};

// ---------------------------------------------------------------- Holambra

// As 9 linhas do Anexo II do PE 036/2026 (scripts/gerar_planilha_holambra.py,
// lista `linhas`; os mesmos números em testes/casos_de_teste_esperados.json).
const LINHAS_HOLAMBRA: [number, number, number, number, string, "S" | "N", number, number, number, string, number][] = [
  // linha, km total, km/dia, km terra/dia, períodos, noturno, ônibus, motoristas, monitoras, vencimento, preço ref.
  [1, 27160, 135.8, 44.1, "Matutino, Vespertino e Noturno", "S", 1, 1, 1, "10/12/2026", 23.54],
  [2, 21760, 108.8, 14.72, "Matutino e Vespertino", "N", 1, 1, 0, "10/12/2026", 23.55],
  [3, 17520, 87.6, 33.08, "Matutino e Vespertino (2 itin.)", "N", 2, 2, 2, "24/04/2027", 25.66],
  [4, 29120, 145.6, 30.64, "Matutino, Vespertino e Noturno", "S", 1, 1, 1, "10/12/2026", 27.6],
  [5, 20160, 100.8, 18.56, "Matutino e Vespertino", "N", 1, 1, 1, "10/12/2026", 25.5],
  [6, 32920, 164.6, 49.02, "Matutino, Vespertino e Noturno", "S", 1, 1, 1, "10/12/2026", 26.36],
  [7, 16720, 83.6, 44.32, "Matutino e Vespertino", "N", 1, 1, 1, "10/12/2026", 25.49],
  [8, 14880, 74.4, 23.74, "Matutino e Vespertino", "N", 1, 1, 1, "24/04/2027", 27.8],
  [9, 11120, 55.6, 0, "Matutino e Vespertino", "N", 1, 1, 1, "24/04/2027", 28.9],
];

export function historicoHolambra(): SimulacaoHistorica {
  const s = leitorDeSemente(premissasHolambra as Semente);
  const dias = s.numero("Dias letivos");
  const premissas: Premissas = {
    contrato: {
      modo: "PERIODO",
      mesesCustoFixo: s.numero("Meses de custo fixo"),
      vigenciaMeses: 12,
      utilizacao: 1,
      kmMortoPct: s.numero("Km morto"),
      reservaTecnicaPct: s.numero("Reserva técnica"),
      implantacaoTotal: 0,
    },
    pessoal: {
      salarioMotorista: s.numero("Salário base — motorista"),
      salarioMonitora: s.numero("Salário base — monitora"),
      horaExtraPct: 0,
      encargosPct: s.numero("Encargos e provisões"),
      fatorJornadaNoturna: s.numero("Fator jornada estendida"),
      beneficiosPorFuncionario: s.numero("Benefícios"),
      uniformeEpiPorFuncionario: s.numero("Uniforme / EPI"),
      supervisaoMes: 0,
      ...SEM_HORAS_EXTRAS,
    },
    veiculo: {
      valor: s.numero("Valor do ônibus"),
      depreciacaoAa: s.numero("Depreciação anual"),
      custoCapitalAa: s.numero("Custo de capital"),
      seguroMes: s.numero("Seguro RC"),
      ipvaLicenciamentoAno: s.numero("IPVA"),
      laudoVistoriaAno: s.numero("Inspeção escolar"),
      rastreadorMes: s.numero("Rastreamento"),
      telemetriaExtraMes: 0,
      controleEmbarqueMes: 0,
      higienizacaoMes: 0,
      acessibilidadeMes: 0,
      garagemMes: s.numero("Garagem"),
      garagemComReserva: false,
      ...SEM_ADAPTACAO,
    },
    variaveis: {
      dieselLitro: s.numero("Diesel S10"),
      consumoAsfaltoKmL: s.numero("Consumo em ASFALTO"),
      consumoTerraKmL: s.numero("Consumo em TERRA"),
      arlaKm: s.numero("ARLA 32"),
      oleoLavagemKm: s.numero("Lubrificantes"),
      pneusAsfaltoKm: s.numero("Pneus (novos"),
      pneusTerraKm: s.numero("Pneus — terra"),
      manutencaoAsfaltoKm: s.numero("Manutenção (peças"),
      manutencaoTerraKm: s.numero("Manutenção — terra"),
    },
    indiretos: { administracaoPct: s.numero("Administração central"), contingenciaPct: 0 },
    preco: {
      lucroAlvoPct: s.numero("Lucro desejado"),
      pis: s.numero("PIS"),
      cofins: s.numero("COFINS"),
      irpj: s.numero("IRPJ"),
      csll: s.numero("CSLL"),
      iss: s.numero("ISS"),
      icms: 0,
      custoCapitalGiroAm: 0,
      prazoRecebimentoDias: 30,
      despesasSobrePrecoPct: 0,
      ...PRESUMIDO,
    },
  };
  // Derivado, não premissa: a planilha soma os cinco tributos numa fórmula.
  s.consumidos.add("Total de tributos sobre faturamento");

  const itens: Item[] = LINHAS_HOLAMBRA.map(([n, , kmDia, , periodos, , onibus, mot, mon, venc, ref]) => ({
    codigo: String(n),
    descricao:
      `LINHA ${String(n).padStart(2, "0")} – ${periodos} – ${String(kmDia).replace(".", ",")} km/dia – ` +
      `${onibus} veículo(s) mín. 59 lugares – ${mot} motorista(s)${mon ? `, ${mon} monitora(s)` : ""} – seg. a sex. – venc. ${venc}`,
    shareIntermunicipal: 0,
    precoMaximoKm: null,
    precoReferenciaKm: ref,
  }));
  const rotas: Rota[] = LINHAS_HOLAMBRA.map(([n, kmTotal, kmDia, terra, periodos, noturno, onibus, mot, mon]) => ({
    item: String(n),
    nome: `Linha ${String(n).padStart(2, "0")}`,
    kmReferencia: kmTotal,
    kmDia,
    kmTerraDia: terra,
    diasMes: null,
    veiculos: onibus,
    motoristas: mot,
    monitoras: mon,
    noturno: noturno === "S",
    passagensPedagioMes: 0,
    tarifaPedagio: 0,
    viagensDia: null,
    periodos,
  }));
  // O km total do edital é km/dia × dias letivos em todas as linhas — a
  // conferência que a própria semente descreve.
  for (const r of rotas) if (Math.abs(r.kmDia * dias - r.kmReferencia) > 0.5) throw new Error(`Holambra: ${r.nome} não fecha km/dia × ${dias}.`);

  return {
    edital: {
      numero: "PE 036/2026",
      orgao: "Prefeitura Municipal da Estância Turística de Holambra",
      municipio: "Holambra",
      uf: "SP",
      modalidade: "Pregão eletrônico",
      plataforma: null,
      dataSessao: "2026-09-28",
      objeto:
        "Transporte escolar para zona rural e urbana dos alunos do Município de Holambra, com ônibus (mín. 59 lugares), 9 linhas, 200 dias letivos.",
      tipoServico: "ESCOLAR",
      unidadePreco: "KM",
      vigenciaMeses: 12,
      srp: false,
      prazoPagamentoDias: 30,
      dataOrcamento: null,
      indiceReajuste: null,
      valorTotalMaximo: null,
    },
    entrada: { premissas, itens, rotas, criterio: "ITEM" },
    regras: [],
    observacoes:
      "Importado da planilha Planilha_Custos_PE036-2026_Holambra_AzulMob.xlsx. Premissas de mercado (SP, set/2026). " +
      "Decisão registrada: linhas 03 e 09 ficam acima do preço de referência por custo fixo diluído em poucos km.",
    leitor: s,
  };
}

// ---------------------------------------------------------------- São José dos Pinhais

// As 7 rotas do TR 225/2026 item 12.5 (scripts/gerar_planilha_sjp.py, lista
// `rotas`): item, nome, km/mês máximo, tipo (hd = hemodiálise, sv = servidores),
// vans, viagens/dia.
const ROTAS_SJP: [string, string, number, "hd" | "sv", number, number][] = [
  ["1", "Hemodiálise — ROTA NORTE", 7800, "hd", 1, 6],
  ["1", "Hemodiálise — ROTA SUL", 7800, "hd", 1, 6],
  ["1", "Hemodiálise — ROTA CENTRO", 7800, "hd", 1, 6],
  ["1", "Hemodiálise — ROTA SUDESTE", 7800, "hd", 1, 6],
  ["2", "Servidores — ROTA 01 (UBS Campina do Taquaral, Cachoeira, Agaraú, Cotia, Marcelino)", 1800, "sv", 1, 1],
  ["2", "Servidores — ROTA 02 (UBS Malhada, Córrego Fundo)", 2000, "sv", 1, 1],
  ["2", "Servidores — ROTA 03 (UBS Faxina, Contenda, Campo Largo da Roseira)", 1800, "sv", 1, 1],
];
const PRECO_MAXIMO_SJP = 11.11;

export function historicoSaoJoseDosPinhais(): SimulacaoHistorica {
  const s = leitorDeSemente(premissasSjp as Semente);
  const premissas: Premissas = {
    contrato: {
      modo: "MENSAL",
      mesesCustoFixo: 1,
      vigenciaMeses: s.numero("Vigência considerada"),
      utilizacao: s.numero("Utilização esperada"),
      kmMortoPct: s.numero("Km improdutivo"),
      reservaTecnicaPct: s.numero("Reserva técnica"),
      implantacaoTotal: 0,
    },
    pessoal: {
      salarioMotorista: s.numero("Salário base — motorista"),
      salarioMonitora: 0,
      horaExtraPct: s.numero("Horas extras"),
      encargosPct: s.numero("Encargos e provisões"),
      fatorJornadaNoturna: 1,
      beneficiosPorFuncionario: s.numero("Benefícios"),
      uniformeEpiPorFuncionario: s.numero("Uniforme, crachá"),
      supervisaoMes: s.numero("Preposto"),
      ...SEM_HORAS_EXTRAS,
    },
    veiculo: {
      valor: s.numero("Valor da van"),
      depreciacaoAa: s.numero("Depreciação anual"),
      custoCapitalAa: s.numero("Custo de capital"),
      seguroMes: s.numero("Seguro casco"),
      ipvaLicenciamentoAno: s.numero("IPVA"),
      laudoVistoriaAno: s.numero("Laudo técnico"),
      rastreadorMes: 0,
      telemetriaExtraMes: s.numero("Telemetria HÍBRIDA"),
      controleEmbarqueMes: s.numero("Sistema de controle de embarque"),
      higienizacaoMes: s.numero("Higienização"),
      acessibilidadeMes: s.numero("Acessibilidade"),
      garagemMes: s.numero("Garagem"),
      garagemComReserva: true,
      ...SEM_ADAPTACAO,
    },
    variaveis: {
      dieselLitro: s.numero("Diesel S10"),
      // Uma só consumo e um só custo de pneus e manutenção: não há terra em SJP.
      consumoAsfaltoKmL: s.numero("Consumo médio da van"),
      consumoTerraKmL: 0,
      arlaKm: s.numero("ARLA 32"),
      oleoLavagemKm: s.numero("Lavagem externa"),
      pneusAsfaltoKm: s.numero("Pneus (215"),
      pneusTerraKm: 0,
      manutencaoAsfaltoKm: s.numero("Manutenção preventiva"),
      manutencaoTerraKm: 0,
    },
    indiretos: { administracaoPct: s.numero("Administração central"), contingenciaPct: s.numero("Contingência") },
    preco: {
      lucroAlvoPct: s.numero("Lucro líquido desejado"),
      pis: s.numero("PIS"),
      cofins: s.numero("COFINS"),
      irpj: s.numero("IRPJ"),
      csll: s.numero("CSLL"),
      iss: s.numero("ISS"),
      icms: s.numero("ICMS"),
      custoCapitalGiroAm: s.numero("Custo do capital de giro"),
      prazoRecebimentoDias: s.numero("Prazo de pagamento"),
      despesasSobrePrecoPct: 0,
      ...PRESUMIDO,
    },
  };
  const diasHd = s.numero("Dias de operação/mês — Item 01");
  const diasSv = s.numero("Dias de operação/mês — Item 02");
  const motoristasPorVanHd = s.numero("Motoristas por van — Item 01");
  const motoristasPorVanSv = s.numero("Motoristas por van — Item 02");
  const tarifa277 = s.numero("Pedágio BR-277");
  const tarifa376 = s.numero("Pedágio BR-376");
  s.numero("Pedágio BR-116"); // tarifa zero: nenhuma rota cruza a praça
  const shareCampoLargo = s.numero("% das viagens do Item 01");
  const passagensPorViagem = s.numero("Passagens de pedágio por viagem");
  const shareIntermunicipal = s.numero("% do faturamento do Item 01");
  // Derivados: a planilha calcula estes a partir das linhas acima.
  for (const d of [
    "Tributos totais — faturamento municipal",
    "Tributos totais — faturamento intermunicipal",
    "Tributos médios — Item 01",
    "Tributos médios — Item 02",
    "Custo financeiro sobre faturamento",
  ])
    s.consumidos.add(d);

  const itens: Item[] = [
    {
      codigo: "1",
      descricao: "Serviço de transporte de pacientes – diálise (rotas Norte, Sul, Centro e Sudeste — 7.800 km/mês cada)",
      shareIntermunicipal,
      precoMaximoKm: PRECO_MAXIMO_SJP,
      precoReferenciaKm: null,
    },
    {
      codigo: "2",
      descricao: "Serviço de transporte com van – servidores (rotas 01, 02 e 03 — UBS rurais)",
      shareIntermunicipal: 0,
      precoMaximoKm: PRECO_MAXIMO_SJP,
      precoReferenciaKm: null,
    },
  ];
  const rotas: Rota[] = ROTAS_SJP.map(([item, nome, km, tipo, vans, viagens]) => {
    const dias = tipo === "hd" ? diasHd : diasSv;
    return {
      item,
      nome,
      kmReferencia: km,
      kmDia: km / dias,
      kmTerraDia: 0,
      diasMes: dias,
      veiculos: vans,
      motoristas: vans * (tipo === "hd" ? motoristasPorVanHd : motoristasPorVanSv),
      monitoras: 0,
      noturno: false,
      // Hemodiálise: parte das viagens vai a Campo Largo (BR-277), ida e volta.
      // Servidores: duas passagens por dia na BR-376, hoje a tarifa zero.
      passagensPedagioMes: tipo === "hd" ? viagens * dias * shareCampoLargo * passagensPorViagem : dias * 2,
      tarifaPedagio: tipo === "hd" ? tarifa277 : tarifa376,
      viagensDia: viagens,
      periodos: tipo === "hd" ? "3 turnos 06h–19h, seg. a sáb." : "07h–17h, seg. a sex.",
    };
  });

  return {
    edital: {
      numero: "PE 089/2026-SERMALI",
      orgao: "Prefeitura Municipal de São José dos Pinhais",
      municipio: "São José dos Pinhais",
      uf: "PR",
      modalidade: "Pregão eletrônico (SRP)",
      plataforma: "Comprasgov (UASG 987885)",
      dataSessao: "2026-09-28",
      objeto: "Transporte de pacientes SUS (hemodiálise) e de servidores em vans ≥15 lugares — lote único com 2 itens.",
      tipoServico: "SAUDE",
      unidadePreco: "KM",
      vigenciaMeses: 12,
      srp: true,
      prazoPagamentoDias: 30,
      dataOrcamento: "2026-06-22",
      indiceReajuste: "IPCA",
      valorTotalMaximo: 4906176,
    },
    entrada: { premissas, itens, rotas, criterio: "LOTE", precoTesteKm: 9.89 },
    regras: (regrasSjp as { tema: string; regra: string; impacto: string; campo: string }[]).map((r) => ({
      tema: r.tema,
      texto: r.regra,
      impacto: r.impacto,
      campo: r.campo === "—" ? null : r.campo,
    })),
    observacoes:
      "Importado da planilha Planilha_Custos_PE089-2026_SJPinhais_Transporte_SUS_AzulMob.xlsx. Premissas de mercado (Curitiba/RMC, set/2026). " +
      "Decisões registradas: Item 2 isolado a R$ 18/km (acima do teto de R$ 11,11); o lote fecha a R$ 9,31 (lucro 9%) e a R$ 9,89 rende 13,7% a 85% de utilização, com equilíbrio em ~68%.",
    leitor: s,
  };
}

export function simulacoesHistoricas(): SimulacaoHistorica[] {
  return [historicoHolambra(), historicoSaoJoseDosPinhais()];
}
