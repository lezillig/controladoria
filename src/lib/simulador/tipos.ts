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

export type MetodoDepreciacao = "PERCENTUAL" | "LINEAR" | "SOMA_DIGITOS";

export type CriterioJulgamento = "ITEM" | "LOTE";

// A unidade em que o contrato paga. Muda o que acontece quando a utilização
// cai: por KM, o faturamento cai junto com o km; por VEICULO_MES, DIARIA ou
// HORA, o faturamento fica e só o custo variável muda.
// BINOMIA é a tarifa em duas partes: um valor fixo por veículo-mês, que cobre
// o custo fixo, e um valor por km, que cobre o variável.
export type UnidadePreco = "KM" | "VEICULO_MES" | "DIARIA" | "HORA" | "BINOMIA";

export const ROTULO_UNIDADE: Record<UnidadePreco, string> = {
  KM: "R$/km",
  VEICULO_MES: "R$/veículo-mês",
  DIARIA: "R$/diária",
  HORA: "R$/hora",
  BINOMIA: "R$/veículo-mês + R$/km",
};

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
    // Implantação/montagem de base (custo único), amortizada na vigência e
    // rateada entre os itens pelo km útil.
    implantacaoTotal: number;
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
    // Adicionais em HORAS por motorista por mês, pagos a salário ÷ divisor ×
    // fator (1,5; 2,0; 1,2) — alternativa ao percentual de HE. Somam-se a ele.
    divisorHorasMes: number;
    horasExtras50Mes: number;
    horasExtras100Mes: number;
    horasNoturnasMes: number;
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
    // Adaptações por veículo (elevador, ar, divisória, adesivagem): valor
    // depreciado em `adaptacaoMesesDepreciacao` meses, com custo de capital.
    adaptacaoValor: number;
    adaptacaoMesesDepreciacao: number;
    // Manutenção como fração mensal do valor do veículo — o método de locação.
    // Soma-se à manutenção por km; use um dos dois, ou os dois com critério.
    manutencaoFixaPctMes: number;
    // DEPRECIAÇÃO. PERCENTUAL: `depreciacaoAa` sobre o valor (o das planilhas
    // de referência). LINEAR: (valor − residual) ÷ vida útil. SOMA_DIGITOS: o
    // método de Cole do GEIPOT, que deprecia mais nos primeiros anos. Nos dois
    // últimos, o valor é o de aquisição do veículo novo, e a depreciação é a
    // média anual dos anos de vida que o contrato ocupa a partir da idade.
    metodoDepreciacao: MetodoDepreciacao;
    vidaUtilAnos: number;
    valorResidualPct: number;
    idadeInicialAnos: number;
    // CAPITAL. Com `capitalComposto`, o custo do capital é a média entre a
    // taxa do financiamento (fração financiada) e o custo de oportunidade do
    // capital próprio (o resto); sem ele, vale `custoCapitalAa`.
    capitalComposto: boolean;
    fracaoFinanciada: number;
    taxaFinanciamentoAa: number;
    custoCapitalProprioAa: number;
    // Remunerar o capital só sobre o valor ainda não depreciado (média do
    // período do contrato), como o GEIPOT, em vez do valor integral.
    remuneracaoSobreValorMedio: boolean;
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
    // Despesas cobradas como fração do PREÇO (administração do contrato,
    // encargos financeiros, comissão): entram no divisor, como os tributos.
    despesasSobrePrecoPct: number;
    // LUCRO REAL. IRPJ + CSLL sobre o LUCRO (0,34 com o adicional), em vez de
    // `irpj`/`csll` sobre a receita (Presumido). E o crédito de PIS/COFINS não
    // cumulativo (0,0925) sobre os custos que dão crédito: combustível, ARLA,
    // óleo, pneus, manutenção, depreciação e garagem. No Presumido, os dois
    // ficam em zero e `irpj`/`csll` levam a alíquota efetiva sobre a receita.
    irpjCsllSobreLucroPct: number;
    creditoPisCofinsPct: number;
  };
  // Perfis de veículo além do padrão (`veiculo` + `variaveis`): van, micro,
  // ônibus, carro executivo. Cada rota aponta o seu em `Rota.perfilVeiculo`.
  perfis?: PerfilVeiculo[];
};

export type PerfilVeiculo = {
  codigo: string;
  descricao: string;
  veiculo: Premissas["veiculo"];
  variaveis: Premissas["variaveis"];
};

export type Item = {
  codigo: string;
  descricao: string;
  // Fração do faturamento do item que é transporte intermunicipal (ICMS).
  shareIntermunicipal: number;
  precoMaximoKm?: number | null;
  precoReferenciaKm?: number | null;
  // Locação sem motorista: o item não carrega motorista, monitor(a) nem
  // supervisão. Padrão: com motorista.
  comMotorista?: boolean;
  // Combustível (e ARLA) por conta do contratante: sai do custo do item.
  combustivelPorContaDoCliente?: boolean;
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
  // Horas de operação por dia por veículo — só para o preço por hora.
  horasDia?: number | null;
  // Código de um perfil em Premissas.perfis; sem ele, o veículo padrão.
  perfilVeiculo?: string | null;
  viagensDia?: number | null;
  periodos?: string | null;
};

export type EntradaSimulacao = {
  premissas: Premissas;
  itens: Item[];
  rotas: Rota[];
  criterio: CriterioJulgamento;
  // Unidade do preço proposto. Padrão: KM.
  unidadePreco?: UnidadePreco;
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
  // Veículo (mensal). capital = depreciação + remuneração do capital.
  depreciacao: number;
  remuneracaoCapital: number;
  capital: number;
  seguro: number;
  ipvaLicenciamento: number;
  telemetria: number;
  higieneAcessibilidade: number;
  garagem: number;
  adaptacao: number;
  manutencaoFixa: number;
  veiculoMes: number;
  // Implantação amortizada (mensal).
  implantacaoMes: number;
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
  // Lucro Real: custos que dão crédito de PIS/COFINS e o crédito apurado.
  custoComCredito: number;
  creditoPisCofins: number;
  custoKm: number;
  custoFixoKm: number;
  custoVariavelKm: number;
  tributosPct: number;
  financeiroPct: number;
  lucroAlvoPct: number;
  precoKm: number;
  precoMinimoKm: number;
  faturamento: number;
  // Lucro antes de IRPJ/CSLL sobre o lucro (igual a `lucro` no Presumido).
  lucroAntesIr: number;
  irpjCsllSobreLucro: number;
  lucro: number;
  margem: number | null;
  precoMaximoKm: number | null;
  precoReferenciaKm: number | null;
  acimaDoTeto: boolean;
  // O mesmo custo e preço nas outras unidades. Quantidades na apuração.
  unidade: UnidadePreco;
  quantidadeUnidade: number;
  precoUnidade: number;
  indicadores: IndicadoresUnidade;
};

export type IndicadoresUnidade = {
  veiculoMes: { quantidade: number; custo: number; preco: number };
  diaria: { quantidade: number; custo: number; preco: number };
  // Null quando alguma rota do item não informa horas por dia.
  hora: { quantidade: number; custo: number; preco: number } | null;
  km: { quantidade: number; custo: number; preco: number };
  // Tarifa em duas partes: fixo por veículo-mês + variável por km útil.
  binomia: { fixoVeiculoMes: number; variavelKm: number };
};

export type ResultadoLote = {
  kmUtil: number;
  custoTotal: number;
  custoKm: number;
  // Média dos preços dos itens ponderada pelo km — o diagnóstico da planilha.
  precoKm: number;
  // O preço único do lançamento: a média arredondada para cima em 2 casas.
  precoProposta: number;
  // Na unidade do contrato (igual aos dois acima quando a unidade é KM).
  unidade: UnidadePreco;
  precoUnidade: number;
  precoPropostaUnidade: number;
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
  // Preço de teste, na unidade do contrato (na binômia, a parcela por km).
  precoTesteKm: number;
  unidade: UnidadePreco;
  tributosPct: number;
  financeiroPct: number;
  linhas: LinhaCenario[];
  // Utilização em que o lucro ao preço de teste é zero; null se nunca empata.
  pontoEquilibrio: number | null;
  // MINIMA: abaixo dela há prejuízo (preço por km — o faturamento cai com o
  // km). MAXIMA: acima dela há prejuízo (preço fixo por veículo, diária ou
  // hora — o faturamento fica e o custo variável cresce com o km).
  tipoEquilibrio: "MINIMA" | "MAXIMA";
};

export type ResultadoSimulacao = {
  modo: ModoApuracao;
  criterio: CriterioJulgamento;
  unidade: UnidadePreco;
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
