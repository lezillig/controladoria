// OS TIPOS DO SIMULADOR DE CUSTOS.
//
// Uma simulação é inteiramente descrita por três coisas: as PREMISSAS (quanto
// custa cada coisa), as ROTAS com seus ITENS (o que o edital pede) e a forma de
// julgamento. O motor (motor.ts) recebe as três e devolve o resultado; nada
// mais entra na conta. É isso que torna a simulação reexecutável: guardar as
// três no snapshot é guardar a conta inteira.
//
// Todos os valores são NÚMEROS em reais e frações (0,70 = 70%). Centavos
// inteiros, como no resto do sistema, não servem aqui: premissa de R$ 0,07 por
// km e preço de R$ 9,3028 por km precisam das casas que as planilhas usam.

// MENSAL: contrato por demanda (SRP, fretamento contínuo) — o km de referência
// é o km/mês máximo do edital e a apuração é mensal, na utilização esperada.
// PERIODO: contrato escolar — o km de referência é o do período letivo
// (km/dia × dias) e o custo fixo é contado por `mesesCustoFixo` meses, porque
// a equipe e o veículo custam também nas férias.
export type ModoApuracao = "MENSAL" | "PERIODO";

export type CriterioJulgamento = "ITEM" | "LOTE";

export type Premissas = {
  contrato: {
    modo: ModoApuracao;
    // Meses de custo fixo em UMA apuração: 1 no MENSAL, 12 no escolar anual.
    mesesCustoFixo: number;
    // Meses de vigência, para anualizar o resultado mensal.
    vigenciaMeses: number;
    // Fração do km de referência efetivamente paga (SRP/demanda). 1 no escolar.
    utilizacao: number;
    // Km improdutivo sobre o km pago (garagem ↔ ponto inicial, retorno vazio).
    kmMortoPct: number;
    // Veículos reserva sobre a frota operacional.
    reservaTecnicaPct: number;
  };
  pessoal: {
    salarioMotorista: number;
    salarioMonitora: number;
    horaExtraPct: number;
    encargosPct: number;
    // Multiplica o salário do motorista nas rotas com período noturno.
    fatorJornadaNoturna: number;
    beneficiosPorFuncionario: number;
    uniformeEpiPorFuncionario: number;
    // Preposto/supervisão local — total mensal, rateado entre os itens pelo km.
    supervisaoMes: number;
  };
  veiculo: {
    valor: number;
    depreciacaoAa: number;
    custoCapitalAa: number;
    seguroMes: number;
    ipvaLicenciamentoAno: number;
    laudoVistoriaAno: number;
    rastreadorMes: number;
    telemetriaExtraMes: number;
    controleEmbarqueMes: number;
    higienizacaoMes: number;
    acessibilidadeMes: number;
    garagemMes: number;
    // A planilha de Holambra aplica a garagem só à frota operacional; a de SJP,
    // à frota com reserva. As duas leituras são defensáveis (a garagem cobra
    // por vaga, e a van reserva ocupa vaga), e a escolha fica explícita aqui.
    garagemComReserva: boolean;
  };
  variaveis: {
    dieselLitro: number;
    consumoAsfaltoKmL: number;
    consumoTerraKmL: number;
    arlaKm: number;
    oleoLavagemKm: number;
    pneusAsfaltoKm: number;
    pneusTerraKm: number;
    manutencaoAsfaltoKm: number;
    manutencaoTerraKm: number;
  };
  indiretos: {
    administracaoPct: number;
    contingenciaPct: number;
  };
  preco: {
    lucroAlvoPct: number;
    pis: number;
    cofins: number;
    irpj: number;
    csll: number;
    // ISS sobre o faturamento municipal; ICMS sobre o intermunicipal. A parcela
    // intermunicipal é de cada ITEM (Item.shareIntermunicipal).
    iss: number;
    icms: number;
    custoCapitalGiroAm: number;
    prazoRecebimentoDias: number;
  };
};

export type Item = {
  codigo: string;
  descricao: string;
  // Fração do faturamento do item que é transporte intermunicipal (ICMS).
  shareIntermunicipal: number;
  precoMaximoKm?: number | null;
  precoReferenciaKm?: number | null;
};

export type Rota = {
  item: string; // Item.codigo
  nome: string;
  // MENSAL: km/mês máximo do edital. PERIODO: km do período (km/dia × dias).
  kmReferencia: number;
  kmDia: number;
  kmTerraDia: number;
  diasMes?: number | null;
  veiculos: number;
  // Quantidades ABSOLUTAS na rota — 1,8 motorista numa van de hemodiálise é
  // um número legítimo (dois motoristas, folgas compensadas pela reserva).
  motoristas: number;
  monitoras: number;
  noturno: boolean;
  passagensPedagioMes: number;
  tarifaPedagio: number;
  viagensDia?: number | null;
  periodos?: string | null;
};

export type EntradaSimulacao = {
  premissas: Premissas;
  itens: Item[];
  rotas: Rota[];
  criterio: CriterioJulgamento;
  // Preço de lance para a tabela de cenários. Sem ele, o preço da proposta.
  precoTesteKm?: number | null;
  utilizacoesCenario?: number[];
};

export type ComposicaoItem = {
  item: string;
  descricao: string;
  kmReferencia: number;
  kmUtil: number;
  kmRodado: number;
  veiculos: number;
  veiculosComReserva: number;
  motoristas: number;
  monitoras: number;
  // Mão de obra (mensal)
  salarios: number;
  encargos: number;
  beneficios: number;
  supervisao: number;
  maoDeObraMes: number;
  // Veículo (mensal)
  capital: number;
  seguro: number;
  ipvaLicenciamento: number;
  telemetria: number;
  higieneAcessibilidade: number;
  garagem: number;
  veiculoMes: number;
  // Na apuração (mês ou período)
  custoFixo: number;
  diesel: number;
  arla: number;
  oleoLavagem: number;
  pneus: number;
  manutencao: number;
  pedagio: number;
  variaveis: number;
  custoDireto: number;
  indiretos: number;
  custoTotal: number;
  custoKm: number;
  custoFixoKm: number;
  custoVariavelKm: number;
  tributosPct: number;
  financeiroPct: number;
  lucroAlvoPct: number;
  precoKm: number;
  precoMinimoKm: number;
  faturamento: number;
  lucro: number;
  margem: number | null;
  precoMaximoKm: number | null;
  precoReferenciaKm: number | null;
  acimaDoTeto: boolean;
};

export type ResultadoLote = {
  kmUtil: number;
  custoTotal: number;
  custoKm: number;
  // Média dos preços dos itens ponderada pelo km — o diagnóstico da planilha.
  precoKm: number;
  // O preço único do lançamento: a média arredondada para cima em 2 casas.
  precoProposta: number;
  tributosPct: number;
  faturamento: number;
  lucro: number;
  // O que o lote rende de fato ao preço único da proposta.
  faturamentoAoPrecoProposta: number;
  lucroAoPrecoProposta: number;
  margemAoPrecoProposta: number | null;
  itensAcimaDoTeto: string[];
};

export type LinhaCenario = {
  utilizacao: number;
  kmUtil: number;
  custoTotal: number;
  custoKm: number;
  precoLucroAlvoKm: number;
  precoLucroZeroKm: number;
  faturamento: number;
  lucro: number;
  margem: number | null;
  lucroAno: number;
  lucroVeiculoMes: number;
};

export type Cenarios = {
  precoTesteKm: number;
  tributosPct: number;
  financeiroPct: number;
  linhas: LinhaCenario[];
  // Utilização em que o lucro ao preço de teste é zero; null se nunca empata.
  pontoEquilibrio: number | null;
};

export type ResultadoSimulacao = {
  modo: ModoApuracao;
  criterio: CriterioJulgamento;
  itens: ComposicaoItem[];
  totais: {
    kmReferencia: number;
    kmUtil: number;
    veiculos: number;
    veiculosComReserva: number;
    motoristas: number;
    monitoras: number;
    custoTotal: number;
    faturamento: number;
    lucro: number;
    margem: number | null;
  };
  lote: ResultadoLote | null;
  cenarios: Cenarios;
};
