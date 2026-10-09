import { horasNoturnasDoHorario } from "./horario";
import { fatorManutencaoPorIdade, fracaoForaDaGarantia } from "./idadeManutencao";
import type {
  Cenarios,
  ComposicaoItem,
  EntradaSimulacao,
  IndicadoresUnidade,
  Item,
  LinhaCenario,
  Premissas,
  ResultadoLote,
  ResultadoSimulacao,
  Rota,
  UnidadePreco,
} from "./tipos";

// O MOTOR DO SIMULADOR DE CUSTOS — genérico, para qualquer operação.
//
// Recebe premissas (quanto custa cada coisa), itens e rotas (o que a operação
// pede) e devolve custo, preço, margem e cenários. Serve a licitação, contrato
// privado, renovação e orçamento interno: o motor não sabe de onde vieram os
// números.
//
// Fórmulas de base: as das planilhas de referência de Holambra PE 036/2026 e
// São José dos Pinhais PE 089/2026 (docs/simulador_custos_handoff/), que os
// testes reproduzem com tolerância de R$ 0,01 no preço e 0,1% nos totais
// (scripts/teste-simulador.ts). Sobre elas, o que os modelos de concorrentes
// mostraram que faltava (docs/simulador_custos/DECISOES.md):
//   - preço por veículo-mês, diária, hora ou tarifa em duas partes, além do km;
//   - adaptações do veículo com depreciação própria e manutenção fixa em % do
//     valor do veículo;
//   - implantação/montagem de base amortizada na vigência;
//   - horas extras e adicional noturno em horas (salário ÷ 220 × fator);
//   - despesas cobradas sobre o preço (adm. do contrato, encargos financeiros).
// Todas nascem zeradas: com elas em zero, a conta é a das planilhas. E, da
// revisão de precificação (DECISOES.md, seção 6), o que as planilhas não
// exercitam: os tributos da locação no item sem motorista e, no Lucro Real, o
// IR sobre o lucro fiscal (sem deduzir capital próprio nem contingência).
//
// Função pura. Guardar a entrada é guardar a conta inteira.
//
// Onde as duas planilhas de referência divergem, o motor segue a planilha e
// deixa a escolha explícita:
//   - garagem com ou sem reserva técnica → Premissas.veiculo.garagemComReserva;
//   - pedágio: na composição entra o valor mensal da rota (plano operacional),
//     nos cenários entra proporcional à utilização — como na aba Cenários de SJP.

// v2: adicional noturno sem a hora-base, tributos da locação sem motorista e
// base do IR no Lucro Real (docs/simulador_custos/DECISOES.md, seção 6).
// v3: vale-refeição por dia trabalhado (seção 7.1.2).
export const VERSAO_MOTOR = "2026.10-v3";
// Teto de dias de vale-refeição por pessoa no mês: a escala 6x1 da referência
// da convenção. Operação de 30 dias tem folguista; cada pessoa trabalha ~26.
export const DIAS_VR_MAXIMO = 26;
export const UTILIZACOES_PADRAO = [0.6, 0.7, 0.8, 0.85, 0.9, 1];

// ROUNDUP(x; 2) do Excel: para cima, afastando do zero. O `toPrecision(12)`
// absorve o ruído de ponto flutuante — 7,74 × 100 dá 774,0000000000001 e
// subiria para 7,75 sem ele, onde o Excel mostra 7,74.
export function arredondarParaCima(valor: number, casas = 2): number {
  const fator = 10 ** casas;
  const escalado = Number((Math.abs(valor) * fator).toPrecision(12));
  return (Math.sign(valor) * Math.ceil(escalado)) / fator;
}

const dividir = (a: number, b: number) => (b === 0 ? 0 : a / b);

// Padrões das premissas que as versões salvas antes delas não têm.
export const ADICIONAL_NOTURNO_PADRAO = 0.2;
// IRPJ com o adicional de 10% (base presumida acima de R$ 20 mil/mês), como
// o do transporte (16% × 25% = 4%): 25% × 32% de presunção.
export const IRPJ_LOCACAO_PADRAO = 0.08;
export const CSLL_LOCACAO_PADRAO = 0.0288; // 9% × 32%
export const INFLACAO_PADRAO = 0.045; // Focus, out/2026
export const PRAZO_PAGAMENTO_CUSTOS_PADRAO = 25; // dias
export const DSR_SOBRE_HORA_EXTRA_PADRAO = 0.1667; // ~4,33 domingos ÷ 26 dias úteis

// Custo a mais de cada hora de relógio noturna que já está na jornada: o
// salário paga a hora-base; a hora noturna reduzida (52′30″) faz a hora de
// relógio valer 60 ÷ 52,5 horas, todas com o adicional. Com 20%:
// 1,2 × 60 ÷ 52,5 − 1 = 0,3714 do valor da hora — e não 1,2, que pagaria a
// hora-base duas vezes.
export function fatorHoraNoturna(p: Premissas): number {
  return (1 + (p.pessoal.adicionalNoturnoPct ?? ADICIONAL_NOTURNO_PADRAO)) * (60 / 52.5) - 1;
}

// Tributos sobre o faturamento de um item. O item com motorista é serviço de
// transporte: ISS no municipal, ICMS no intermunicipal. O sem motorista é
// locação de bem móvel: não é serviço (Súmula Vinculante 31, sem ISS) nem
// transporte (sem ICMS), e no Presumido presume 32% para IRPJ e CSLL.
export function tributosDoItem(p: Premissas, item: Pick<Item, "shareIntermunicipal" | "comMotorista">): number {
  const { preco } = p;
  if (item.comMotorista === false) {
    const presumido = preco.irpjCsllSobreLucroPct === 0;
    const irpj = presumido ? (preco.irpjLocacao ?? IRPJ_LOCACAO_PADRAO) : preco.irpj;
    const csll = presumido ? (preco.csllLocacao ?? CSLL_LOCACAO_PADRAO) : preco.csll;
    return preco.pis + preco.cofins + irpj + csll;
  }
  const federais = preco.pis + preco.cofins + preco.irpj + preco.csll;
  return federais + preco.iss * (1 - item.shareIntermunicipal) + preco.icms * item.shareIntermunicipal;
}

// Quanto do IR sobre o lucro o preço precisa cobrir por real não dedutível:
// ir ÷ (1 − ir). Zero no Presumido.
function acrescimoIrPorNaoDedutivel(ir: number): number {
  return dividir(ir, 1 - ir);
}

// Base do IR/CSLL sobre o lucro no Lucro Real: o lucro antes do IR somado ao
// que o custo tem e o fisco não deduz. Sem base positiva, não há IR.
function baseIr(lucroAntesIr: number, naoDedutiveis: number): number {
  return Math.max(0, lucroAntesIr + naoDedutiveis);
}

// O giro financia o intervalo entre pagar os custos e receber o preço: só a
// diferença dos prazos custa juros.
export function financeiroPct(p: Premissas): number {
  return (p.preco.custoCapitalGiroAm * Math.max(0, p.preco.prazoRecebimentoDias - (p.preco.prazoPagamentoCustosDias ?? 0))) / 30;
}

// Dias de operação da rota numa apuração. MENSAL: os dias/mês informados (ou
// km ÷ km/dia). PERIODO: os dias do período (km do período ÷ km/dia).
export function diasNaApuracao(p: Premissas, r: Rota): number {
  const pelaDistancia = r.kmDia > 0 ? r.kmReferencia / r.kmDia : 0;
  if (p.contrato.modo === "MENSAL") return r.diasMes ?? pelaDistancia;
  return pelaDistancia || (r.diasMes ?? 0) * p.contrato.mesesCustoFixo;
}

// DEPRECIAÇÃO E REMUNERAÇÃO DO CAPITAL, por veículo e por ano.
//
// Os anos considerados são os de vida que o contrato ocupa: da idade inicial
// até a idade ao fim da vigência. No LINEAR e na SOMA_DIGITOS (Cole, GEIPOT),
// a depreciação do contrato é a média desses anos — um veículo de 6 anos com
// vida útil de 7 deprecia só mais um ano e depois fica em zero.
//
// A parte PRÓPRIA da taxa é o custo de oportunidade do capital da empresa —
// custo econômico, mas não despesa: no Lucro Real não sai da base do IR. Os
// juros da parte financiada são despesa e saem. Sem capital composto, a taxa
// única é tratada como toda própria (é o caso de quem compra à vista).
export function custoDeCapital(v: Premissas["veiculo"], vigenciaMeses: number, inflacaoAa = 0): {
  taxaCapitalAa: number;
  taxaCapitalProprioAa: number;
  depreciacaoAnual: number;
  valorMedio: number;
  remuneracaoAnual: number;
  remuneracaoPropriaAnual: number;
} {
  // Taxa real: o reajuste anual por índice já devolve a inflação.
  const real = (t: number) => (inflacaoAa ? (1 + t) / (1 + inflacaoAa) - 1 : t);
  const taxaCapitalProprioAa = v.capitalComposto ? (1 - v.fracaoFinanciada) * real(v.custoCapitalProprioAa) : real(v.custoCapitalAa);
  const taxaCapitalAa = v.capitalComposto ? v.fracaoFinanciada * real(v.taxaFinanciamentoAa) + taxaCapitalProprioAa : real(v.custoCapitalAa);
  const anosContrato = Math.max(1, Math.ceil(vigenciaMeses / 12));
  const anos = Array.from({ length: anosContrato }, (_, i) => Math.floor(v.idadeInicialAnos) + i + 1);

  let porAno: number[];
  if (v.metodoDepreciacao === "PERCENTUAL") {
    porAno = anos.map(() => v.valor * v.depreciacaoAa);
  } else {
    const n = Math.max(1, Math.round(v.vidaUtilAnos));
    const depreciavel = v.valor * (1 - v.valorResidualPct);
    const somaDigitos = (n * (n + 1)) / 2;
    const fracao = (k: number) => (k > n ? 0 : v.metodoDepreciacao === "LINEAR" ? 1 / n : (n - k + 1) / somaDigitos);
    porAno = anos.map((k) => depreciavel * fracao(k));
  }
  const depreciacaoAnual = porAno.reduce((a, d) => a + d, 0) / porAno.length;

  // Valor não depreciado no meio de cada ano do contrato, em média.
  let valorMedio = v.valor;
  if (v.remuneracaoSobreValorMedio) {
    // No PERCENTUAL o valor é o de hoje (FIPE na idade atual): só os anos já
    // corridos do contrato saem dele. Nos outros, o valor é o do 0 km e sai a
    // depreciação de toda a vida já vivida.
    const acumuladaAntes = (k: number, i: number) => {
      if (v.metodoDepreciacao === "PERCENTUAL") return v.valor * v.depreciacaoAa * i;
      const n = Math.max(1, Math.round(v.vidaUtilAnos));
      const depreciavel = v.valor * (1 - v.valorResidualPct);
      const somaDigitos = (n * (n + 1)) / 2;
      let acc = 0;
      for (let j = 1; j < k; j++) acc += j > n ? 0 : v.metodoDepreciacao === "LINEAR" ? depreciavel / n : (depreciavel * (n - j + 1)) / somaDigitos;
      return acc;
    };
    const meios = anos.map((k, i) => Math.max(v.valor * (v.metodoDepreciacao === "PERCENTUAL" ? 0 : v.valorResidualPct), v.valor - acumuladaAntes(k, i) - porAno[i] / 2));
    valorMedio = meios.reduce((a, x) => a + x, 0) / meios.length;
  }
  return {
    taxaCapitalAa,
    taxaCapitalProprioAa,
    depreciacaoAnual,
    valorMedio,
    remuneracaoAnual: valorMedio * taxaCapitalAa,
    remuneracaoPropriaAnual: valorMedio * taxaCapitalProprioAa,
  };
}

type PorRota = {
  kmReferencia: number;
  kmUtil: number;
  kmRodado: number;
  salarios: number;
  encargos: number;
  beneficios: number;
  valeRefeicao: number;
  depreciacao: number;
  remuneracaoCapital: number;
  remuneracaoCapitalProprio: number;
  seguro: number;
  ipvaLicenciamento: number;
  telemetria: number;
  higieneAcessibilidade: number;
  garagem: number;
  adaptacao: number;
  adaptacaoDepreciacao: number;
  manutencaoFixa: number;
  diesel: number;
  arla: number;
  oleoLavagem: number;
  pneus: number;
  manutencao: number;
  pedagio: number;
  diarias: number;
  motoristas: number;
  monitoras: number;
  horas: number | null;
};

// A CONTA DE UMA ROTA. Mão de obra e veículo são mensais; os variáveis já
// saem na apuração (o km de referência da rota já é o do mês ou do período).
function calcularRota(p: Premissas, r: Rota, item: Item): PorRota {
  const { contrato, pessoal } = p;
  // O perfil de veículo da rota (van, micro, ônibus…) ou o padrão.
  const perfil = r.perfilVeiculo ? p.perfis?.find((x) => x.codigo === r.perfilVeiculo) : undefined;
  const veiculo = perfil?.veiculo ?? p.veiculo;
  const variaveis = perfil?.variaveis ?? p.variaveis;
  const comMotorista = item.comMotorista !== false;
  const combustivelDaContratada = item.combustivelPorContaDoCliente !== true;
  const motoristas = comMotorista ? r.motoristas : 0;
  const monitoras = comMotorista ? r.monitoras : 0;

  const kmUtil = r.kmReferencia * contrato.utilizacao;
  const kmRodado = kmUtil * (1 + contrato.kmMortoPct);
  const pctTerra = r.kmDia > 0 ? r.kmTerraDia / r.kmDia : 0;
  const pctAsfalto = 1 - pctTerra;

  // Mão de obra — o fator noturno incide só sobre o salário do motorista; as
  // horas extras e noturnas em horas, por motorista, a salário ÷ divisor. A
  // hora extra é hora a mais, paga inteira; a noturna já está no salário, e
  // só o adicional (com a hora reduzida) é custo novo — ver fatorHoraNoturna.
  const fatorNoturno = r.noturno ? pessoal.fatorJornadaNoturna : 1;
  // O salário do motorista é o do tipo de veículo da rota, quando há perfil.
  const salarioMotorista = perfil?.motorista.salario ?? pessoal.salarioMotorista;
  const valorHora = pessoal.divisorHorasMes > 0 ? salarioMotorista / pessoal.divisorHorasMes : 0;
  const dias = diasNaApuracao(p, r);
  const diasNoMes = contrato.modo === "MENSAL" ? dias : dividir(dias, contrato.mesesCustoFixo);
  // A hora extra habitual reflete no descanso semanal remunerado.
  const comDsr = 1 + (pessoal.dsrSobreHoraExtraPct ?? 0);
  // HORAS NOTURNAS: com o horário da rota, as horas entre 22h e 5h saem dele —
  // por veículo, em todos os dias de operação, quem quer que esteja no volante
  // — e substituem as horas noturnas por motorista das premissas nessa rota.
  const noturnasPorDia = horasNoturnasDoHorario(r.horarioInicio, r.horarioFim);
  const horasNoturnasPorMotorista = noturnasPorDia === null ? pessoal.horasNoturnasMes : 0;
  const adicionaisEmHoras =
    valorHora * ((pessoal.horasExtras50Mes * 1.5 + pessoal.horasExtras100Mes * 2) * comDsr + horasNoturnasPorMotorista * fatorHoraNoturna(p));
  const noturnoDoHorario = motoristas > 0 && noturnasPorDia ? r.veiculos * noturnasPorDia * diasNoMes * valorHora * fatorHoraNoturna(p) : 0;
  const salarios =
    motoristas * (salarioMotorista * (1 + pessoal.horaExtraPct * comDsr) * fatorNoturno + adicionaisEmHoras) +
    noturnoDoHorario +
    monitoras * pessoal.salarioMonitora;
  const encargos = salarios * pessoal.encargosPct;
  // Vale-refeição: por dia trabalhado, nos dias de operação da rota no mês
  // (5x2 ≈ 22), até o teto da escala 6x1 — para quem está no posto. Os
  // motoristas a mais do fator do tipo de veículo (1,2) cobrem folgas, faltas
  // e férias: o ausente não recebe VR, e o dia é um só. Postos = motoristas ÷
  // fator, e nunca menos que um por veículo e turno (quem informou 1
  // motorista para 1 van tem 1 posto) — dupla pegada (2,4) dá 2.
  const fator = perfil?.motorista.motoristasPorVeiculo ?? 0;
  const postosDeMotorista = fator > 1 ? Math.max(Math.min(motoristas, r.veiculos * (r.turnos ?? 1)), motoristas / fator) : motoristas;
  const valeRefeicao = (postosDeMotorista + monitoras) * (pessoal.valeRefeicaoDia ?? 0) * Math.min(DIAS_VR_MAXIMO, diasNoMes);
  const beneficios = (motoristas + monitoras) * (pessoal.beneficiosPorFuncionario + pessoal.uniformeEpiPorFuncionario) + valeRefeicao;

  // Veículo — ter o veículo custa também para a reserva técnica;
  // higienização e acessibilidade, só para o que roda.
  const comReserva = r.veiculos * (1 + contrato.reservaTecnicaPct);
  const cap = custoDeCapital(veiculo, contrato.vigenciaMeses, contrato.inflacaoAa ?? 0);
  const depreciacao = (comReserva * cap.depreciacaoAnual) / 12;
  const remuneracaoCapital = (comReserva * cap.remuneracaoAnual) / 12;
  // A parte própria do capital do veículo e das adaptações (estas rendem à
  // mesma taxa, sobre o valor cheio): o que o Lucro Real não deduz.
  const remuneracaoCapitalProprio = (comReserva * (cap.remuneracaoPropriaAnual + veiculo.adaptacaoValor * cap.taxaCapitalProprioAa)) / 12;
  const seguro = comReserva * veiculo.seguroMes;
  const ipvaLicenciamento = (comReserva * (veiculo.ipvaLicenciamentoAno + veiculo.laudoVistoriaAno)) / 12;
  const telemetria = comReserva * (veiculo.rastreadorMes + veiculo.telemetriaExtraMes + veiculo.controleEmbarqueMes);
  const higieneAcessibilidade = r.veiculos * (veiculo.higienizacaoMes + veiculo.acessibilidadeMes);
  const garagem = (veiculo.garagemComReserva ? comReserva : r.veiculos) * veiculo.garagemMes;
  const adaptacaoDepreciacao = comReserva * veiculo.adaptacaoValor * dividir(1, veiculo.adaptacaoMesesDepreciacao);
  const adaptacao = adaptacaoDepreciacao + (comReserva * veiculo.adaptacaoValor * cap.taxaCapitalAa) / 12;
  // Manutenção corrigida pela idade do veículo nos anos do contrato (curva
  // ANTP, idadeManutencao.ts): vale para a fixa e para a por km.
  const fatorIdade = fatorManutencaoPorIdade(veiculo, contrato.vigenciaMeses);
  const manutencaoFixa = comReserva * veiculo.valor * veiculo.manutencaoFixaPctMes * fatorIdade;

  // Variáveis por km rodado, ponderados entre asfalto e terra.
  const dieselKm =
    variaveis.dieselLitro * (dividir(pctAsfalto, variaveis.consumoAsfaltoKmL) + (pctTerra > 0 ? dividir(pctTerra, variaveis.consumoTerraKmL) : 0));
  const pneusKm = pctAsfalto * variaveis.pneusAsfaltoKm + pctTerra * variaveis.pneusTerraKm;
  // Corretiva: só nos meses do contrato fora da garantia (o km/mês de cada
  // veículo da rota estima quando a garantia por km acaba), também pela idade.
  const kmPorMes = dividir(contrato.modo === "MENSAL" ? kmRodado : dividir(kmRodado, contrato.mesesCustoFixo), r.veiculos);
  const corretivaKm = (variaveis.corretivaKm ?? 0) * fatorIdade * fracaoForaDaGarantia(veiculo, contrato.vigenciaMeses, kmPorMes);
  const manutencaoKm = (pctAsfalto * variaveis.manutencaoAsfaltoKm + pctTerra * variaveis.manutencaoTerraKm) * fatorIdade + corretivaKm;

  return {
    kmReferencia: r.kmReferencia,
    kmUtil,
    kmRodado,
    salarios,
    encargos,
    beneficios,
    valeRefeicao,
    depreciacao,
    remuneracaoCapital,
    remuneracaoCapitalProprio,
    seguro,
    ipvaLicenciamento,
    telemetria,
    higieneAcessibilidade,
    garagem,
    adaptacao,
    adaptacaoDepreciacao,
    manutencaoFixa,
    diesel: combustivelDaContratada ? dieselKm * kmRodado : 0,
    arla: combustivelDaContratada ? variaveis.arlaKm * kmRodado : 0,
    oleoLavagem: variaveis.oleoLavagemKm * kmRodado,
    pneus: pneusKm * kmRodado,
    manutencao: manutencaoKm * kmRodado,
    pedagio: r.passagensPedagioMes * r.tarifaPedagio,
    diarias: r.veiculos * dias,
    motoristas,
    monitoras,
    horas: r.horasDia ? r.veiculos * dias * r.horasDia : null,
  };
}

function somaCampo(linhas: PorRota[], campo: Exclude<keyof PorRota, "horas">): number {
  return linhas.reduce((a, l) => a + l[campo], 0);
}

// A quantidade que o contrato paga, em cada unidade.
function quantidadeNaUnidade(i: IndicadoresUnidade, unidade: UnidadePreco): number {
  switch (unidade) {
    case "KM":
    case "BINOMIA":
      return i.km.quantidade;
    case "VEICULO_MES":
      return i.veiculoMes.quantidade;
    case "DIARIA":
      return i.diaria.quantidade;
    case "HORA":
      return i.hora?.quantidade ?? 0;
  }
}

export function simular(entrada: EntradaSimulacao): ResultadoSimulacao {
  const { premissas: p, itens, rotas, criterio } = entrada;
  const unidade: UnidadePreco = entrada.unidadePreco ?? "KM";
  const fin = financeiroPct(p);
  const sobrePreco = p.preco.despesasSobrePrecoPct;
  const indiretosPct = p.indiretos.administracaoPct + p.indiretos.contingenciaPct;
  const meses = p.contrato.mesesCustoFixo;

  const kmUtilTotal = rotas.reduce((a, r) => a + r.kmReferencia * p.contrato.utilizacao, 0);
  // A supervisão é de quem tem equipe: rateada só entre os itens com motorista.
  const codigosComEquipe = new Set(itens.filter((i) => i.comMotorista !== false).map((i) => i.codigo));
  const kmUtilComEquipe = rotas.filter((r) => codigosComEquipe.has(r.item)).reduce((a, r) => a + r.kmReferencia * p.contrato.utilizacao, 0);
  const irSobreLucro = p.preco.irpjCsllSobreLucroPct;
  const implantacaoMesTotal = dividir(p.contrato.implantacaoTotal, p.contrato.vigenciaMeses);

  const composicao: ComposicaoItem[] = itens.map((item) => {
    const rotasDoItem = rotas.filter((r) => r.item === item.codigo);
    const calc = rotasDoItem.map((r) => calcularRota(p, r, item));
    const s = (c: Exclude<keyof PorRota, "horas">) => somaCampo(calc, c);

    const kmUtil = s("kmUtil");
    const veiculos = rotasDoItem.reduce((a, r) => a + r.veiculos, 0);
    const motoristas = s("motoristas");
    const monitoras = s("monitoras");
    const participacaoKm = dividir(kmUtil, kmUtilTotal);

    // Supervisão local e implantação: custos do contrato, rateados pelo km.
    const supervisao = codigosComEquipe.has(item.codigo) ? p.pessoal.supervisaoMes * dividir(kmUtil, kmUtilComEquipe) : 0;
    const salarios = s("salarios");
    const encargos = s("encargos");
    const beneficios = s("beneficios");
    const maoDeObraMes = salarios + encargos + beneficios + supervisao;

    const depreciacao = s("depreciacao");
    const remuneracaoCapital = s("remuneracaoCapital");
    const capital = depreciacao + remuneracaoCapital;
    const seguro = s("seguro");
    const ipvaLicenciamento = s("ipvaLicenciamento");
    const telemetria = s("telemetria");
    const higieneAcessibilidade = s("higieneAcessibilidade");
    const garagem = s("garagem");
    const adaptacao = s("adaptacao");
    const manutencaoFixa = s("manutencaoFixa");
    const veiculoMes = capital + seguro + ipvaLicenciamento + telemetria + higieneAcessibilidade + garagem + adaptacao + manutencaoFixa;
    const implantacaoMes = implantacaoMesTotal * participacaoKm;

    const custoFixo = (maoDeObraMes + veiculoMes + implantacaoMes) * meses;
    const diesel = s("diesel");
    const arla = s("arla");
    const oleoLavagem = s("oleoLavagem");
    const pneus = s("pneus");
    const manutencao = s("manutencao");
    const pedagio = s("pedagio");
    const variaveis = diesel + arla + oleoLavagem + pneus + manutencao + pedagio;

    const custoDireto = custoFixo + variaveis;
    const indiretos = custoDireto * indiretosPct;
    const custoTotal = custoDireto + indiretos;
    const custoKm = dividir(custoTotal, kmUtil);

    // LUCRO REAL: o crédito de PIS/COFINS sobre os custos que dão crédito
    // abate o custo que o preço precisa cobrir. No Presumido, crédito zero.
    const fixoComCredito = (depreciacao + s("adaptacaoDepreciacao") + manutencaoFixa + garagem) * meses;
    const variavelComCredito = diesel + arla + oleoLavagem + pneus + manutencao;
    const custoComCredito = fixoComCredito + variavelComCredito;
    const creditoPisCofins = custoComCredito * p.preco.creditoPisCofinsPct;
    const custoLiquido = custoTotal - creditoPisCofins;

    const tributosPct = tributosDoItem(p, item);
    const liquido = 1 - tributosPct - fin - sobrePreco;

    // LUCRO REAL — A BASE DO IR. O custo inclui duas coisas que o fisco não
    // deduz: a remuneração do capital próprio (custo de oportunidade, não
    // despesa) e a contingência (provisão; só vira despesa se o risco
    // acontecer — tratá-la como não dedutível é o lado prudente). A base é
    // lucro antes do IR + N, com N = capital próprio + contingência.
    const remuneracaoCapitalProprio = s("remuneracaoCapitalProprio");
    const contingenciaFixa = custoFixo * p.indiretos.contingenciaPct;
    const contingenciaVariavel = variaveis * p.indiretos.contingenciaPct;
    const naoDedutiveisFixos = remuneracaoCapitalProprio * meses + contingenciaFixa;
    const naoDedutiveis = naoDedutiveisFixos + contingenciaVariavel;

    // O PREÇO PARA O LUCRO ALVO. Com L = receita líquida, C = custo líquido,
    // ir = alíquota e α = lucro alvo, o lucro depois do IR ao preço P é
    //   (P·L − C) − ir·(P·L − C + N) = α·P
    //   ⇒ P = (C + N·ir ÷ (1 − ir)) ÷ (L − α ÷ (1 − ir)).
    // O divisor é o de antes; o custo a cobrir ganha o IR sobre N. No
    // Presumido (ir = 0) volta a C ÷ (L − α). No preço alvo a base é
    // (α·P + N) ÷ (1 − ir) > 0: o IR de fato incide, como a conta supõe.
    const divisor = liquido - dividir(p.preco.lucroAlvoPct, 1 - irSobreLucro);
    const acrescimoIr = acrescimoIrPorNaoDedutivel(irSobreLucro);
    const custoParaPreco = custoLiquido + naoDedutiveis * acrescimoIr;
    const precoPara = (custoUnitario: number, quantidade: number) => (quantidade > 0 ? arredondarParaCima(custoUnitario / divisor, 2) : 0);

    const horasRotas = calc.map((c) => c.horas);
    const quantidadeHoras = horasRotas.length > 0 && horasRotas.every((h) => h !== null) ? horasRotas.reduce((a, h) => a + (h ?? 0), 0) : null;
    const quantidades = {
      km: kmUtil,
      veiculoMes: veiculos * meses,
      diaria: s("diarias"),
    };
    const indicador = (quantidade: number) => {
      const custo = dividir(custoTotal, quantidade);
      return { quantidade, custo, preco: precoPara(dividir(custoParaPreco, quantidade), quantidade) };
    };
    const indicadores: IndicadoresUnidade = {
      km: indicador(quantidades.km),
      veiculoMes: indicador(quantidades.veiculoMes),
      diaria: indicador(quantidades.diaria),
      hora: quantidadeHoras === null ? null : indicador(quantidadeHoras),
      // Tarifa em duas partes: o fixo (com sua parte dos indiretos e dos não
      // dedutíveis) por veículo-mês, o variável (idem) por km útil.
      binomia: {
        fixoVeiculoMes:
          quantidades.veiculoMes > 0
            ? arredondarParaCima(
                (custoFixo * (1 + indiretosPct) - fixoComCredito * p.preco.creditoPisCofinsPct + naoDedutiveisFixos * acrescimoIr) / divisor / quantidades.veiculoMes,
                2
              )
            : 0,
        variavelKm:
          kmUtil > 0
            ? arredondarParaCima((variaveis * (1 + indiretosPct) - variavelComCredito * p.preco.creditoPisCofinsPct + contingenciaVariavel * acrescimoIr) / divisor / kmUtil, 2)
            : 0,
      },
    };

    const quantidadeUnidade = quantidadeNaUnidade(indicadores, unidade);
    const faturamento =
      unidade === "BINOMIA"
        ? indicadores.binomia.fixoVeiculoMes * quantidades.veiculoMes + indicadores.binomia.variavelKm * kmUtil
        : unidade === "KM"
          ? indicadores.km.preco * kmUtil
          : (unidade === "VEICULO_MES" ? indicadores.veiculoMes.preco : unidade === "DIARIA" ? indicadores.diaria.preco : (indicadores.hora?.preco ?? 0)) *
            quantidadeUnidade;
    const precoUnidade =
      unidade === "BINOMIA" ? indicadores.binomia.variavelKm : unidade === "KM" ? indicadores.km.preco : dividir(faturamento, quantidadeUnidade);
    // O preço por km: o proposto quando a unidade é km; o equivalente, fora dela.
    const precoKm = unidade === "KM" ? indicadores.km.preco : dividir(faturamento, kmUtil);
    // Lucro zero DEPOIS do IR: P·L − C = N·ir ÷ (1 − ir) — o mesmo custo a
    // cobrir do preço alvo, com α = 0.
    const precoMinimoKm = dividir(dividir(custoParaPreco, kmUtil), liquido);
    const lucroAntesIr = faturamento * liquido - custoLiquido;
    const irpjCsllSobreLucro = irSobreLucro > 0 ? baseIr(lucroAntesIr, naoDedutiveis) * irSobreLucro : 0;
    const lucro = lucroAntesIr - irpjCsllSobreLucro;
    const precoMaximoKm = item.precoMaximoKm ?? null;

    return {
      item: item.codigo,
      descricao: item.descricao,
      kmReferencia: s("kmReferencia"),
      kmUtil,
      kmRodado: s("kmRodado"),
      veiculos,
      veiculosComReserva: veiculos * (1 + p.contrato.reservaTecnicaPct),
      motoristas,
      monitoras,
      salarios,
      encargos,
      beneficios,
      valeRefeicao: s("valeRefeicao"),
      supervisao,
      maoDeObraMes,
      depreciacao,
      remuneracaoCapital,
      capital,
      seguro,
      ipvaLicenciamento,
      telemetria,
      higieneAcessibilidade,
      garagem,
      adaptacao,
      manutencaoFixa,
      veiculoMes,
      implantacaoMes,
      custoFixo,
      diesel,
      arla,
      oleoLavagem,
      pneus,
      manutencao,
      pedagio,
      variaveis,
      custoDireto,
      indiretos,
      custoTotal,
      custoComCredito,
      creditoPisCofins,
      custoKm,
      custoFixoKm: dividir(custoFixo, kmUtil),
      // A planilha põe os indiretos junto do variável nesta decomposição.
      custoVariavelKm: dividir(variaveis + indiretos, kmUtil),
      tributosPct,
      financeiroPct: fin,
      lucroAlvoPct: p.preco.lucroAlvoPct,
      precoKm,
      precoMinimoKm,
      faturamento,
      lucroAntesIr,
      remuneracaoCapitalProprio,
      naoDedutiveis,
      irpjCsllSobreLucro,
      lucro,
      margem: faturamento > 0 ? lucro / faturamento : null,
      precoMaximoKm,
      precoReferenciaKm: item.precoReferenciaKm ?? null,
      // O teto do edital é por km; fora do km, compara-se o equivalente.
      acimaDoTeto: precoMaximoKm !== null && precoKm > precoMaximoKm,
      unidade,
      quantidadeUnidade,
      precoUnidade,
      indicadores,
    };
  });

  const soma = (c: keyof ComposicaoItem) => composicao.reduce((a, i) => a + (i[c] as number), 0);
  const faturamentoTotal = soma("faturamento");
  const lucroTotal = soma("lucro");
  // Tributos do conjunto ponderados pelo faturamento de cada item.
  const tributosPonderados = dividir(
    composicao.reduce((a, i) => a + i.tributosPct * i.faturamento, 0),
    faturamentoTotal
  );

  const totais = {
    kmReferencia: soma("kmReferencia"),
    kmUtil: soma("kmUtil"),
    veiculos: soma("veiculos"),
    veiculosComReserva: soma("veiculosComReserva"),
    motoristas: soma("motoristas"),
    monitoras: soma("monitoras"),
    custoTotal: soma("custoTotal"),
    faturamento: faturamentoTotal,
    lucro: lucroTotal,
    margem: faturamentoTotal > 0 ? lucroTotal / faturamentoTotal : null,
  };
  const quantidadeTotal = soma("quantidadeUnidade");
  const liquidoConjunto = 1 - tributosPonderados - fin - sobrePreco;

  let lote: ResultadoLote | null = null;
  if (criterio === "LOTE") {
    const precoKm = dividir(faturamentoTotal, totais.kmUtil);
    const precoProposta = arredondarParaCima(precoKm, 2);
    // Na unidade do contrato: a média ponderada pela quantidade da unidade.
    // Na binômia, a parcela por km — a fixa segue a média por veículo-mês.
    const precoUnidade =
      unidade === "BINOMIA"
        ? dividir(composicao.reduce((a, i) => a + i.indicadores.binomia.variavelKm * i.kmUtil, 0), totais.kmUtil)
        : dividir(faturamentoTotal, quantidadeTotal);
    const precoPropostaUnidade = unidade === "KM" ? precoProposta : arredondarParaCima(precoUnidade, 2);
    const faturamentoAoPrecoProposta =
      unidade === "KM"
        ? precoProposta * totais.kmUtil
        : unidade === "BINOMIA"
          ? faturamentoTotal
          : precoPropostaUnidade * quantidadeTotal;
    const lairProposta = faturamentoAoPrecoProposta * liquidoConjunto - (totais.custoTotal - soma("creditoPisCofins"));
    const lucroAoPrecoProposta = lairProposta - baseIr(lairProposta, soma("naoDedutiveis")) * irSobreLucro;
    lote = {
      kmUtil: totais.kmUtil,
      custoTotal: totais.custoTotal,
      custoKm: dividir(totais.custoTotal, totais.kmUtil),
      precoKm,
      precoProposta,
      unidade,
      precoUnidade,
      precoPropostaUnidade,
      tributosPct: tributosPonderados,
      faturamento: faturamentoTotal,
      lucro: lucroTotal,
      faturamentoAoPrecoProposta,
      lucroAoPrecoProposta,
      margemAoPrecoProposta: faturamentoAoPrecoProposta > 0 ? lucroAoPrecoProposta / faturamentoAoPrecoProposta : null,
      itensAcimaDoTeto: composicao.filter((i) => i.acimaDoTeto).map((i) => i.item),
    };
  }

  const precoPadrao = lote
    ? lote.precoPropostaUnidade
    : unidade === "BINOMIA"
      ? arredondarParaCima(dividir(composicao.reduce((a, i) => a + i.indicadores.binomia.variavelKm * i.kmUtil, 0), totais.kmUtil), 2)
      : arredondarParaCima(dividir(faturamentoTotal, quantidadeTotal), 2);
  const cenarios = calcularCenarios(
    p,
    unidade,
    composicao,
    totais.veiculos,
    tributosPonderados,
    entrada.precoTesteKm ?? precoPadrao,
    entrada.utilizacoesCenario ?? UTILIZACOES_PADRAO
  );

  return { modo: p.contrato.modo, criterio, unidade, itens: composicao, totais, lote, cenarios };
}

// CENÁRIOS DE UTILIZAÇÃO — a aba Cenários de SJP, generalizada.
//
// O custo fixo não muda com o km; o variável acompanha o km rodado; o pedágio
// acompanha a utilização. O faturamento depende da unidade: por km, cai com o
// km; por veículo-mês, diária ou hora, fica; na binômia, a parte fixa fica e a
// por km cai.
function calcularCenarios(
  p: Premissas,
  unidade: UnidadePreco,
  composicao: ComposicaoItem[],
  veiculosOperacionais: number,
  tributosPct: number,
  precoTeste: number,
  utilizacoes: number[]
): Cenarios {
  const fin = financeiroPct(p);
  const indiretosPct = p.indiretos.administracaoPct + p.indiretos.contingenciaPct;
  const kmReferencia = composicao.reduce((a, i) => a + i.kmReferencia, 0);
  const fixo = composicao.reduce((a, i) => a + i.custoFixo, 0);
  const pedagio = composicao.reduce((a, i) => a + i.pedagio, 0);
  const kmRodado = composicao.reduce((a, i) => a + i.kmRodado, 0);
  const variavelSemPedagio = composicao.reduce((a, i) => a + i.variaveis - i.pedagio, 0);
  const variavelKmRodado = dividir(variavelSemPedagio, kmRodado);
  const liquido = 1 - tributosPct - fin - p.preco.despesasSobrePrecoPct;
  const ir = p.preco.irpjCsllSobreLucroPct;
  const divisorAlvo = liquido - dividir(p.preco.lucroAlvoPct, 1 - ir);
  // Lucro Real: não dedutíveis — o capital próprio não muda com o km; a
  // contingência acompanha o custo direto de cada utilização.
  const acrescimoIr = acrescimoIrPorNaoDedutivel(ir);
  const contingenciaPct = p.indiretos.contingenciaPct;
  const capitalProprio = composicao.reduce((a, i) => a + i.remuneracaoCapitalProprio, 0) * p.contrato.mesesCustoFixo;
  // Lucro Real: o crédito de PIS/COFINS — a parte fixa não muda com o km; a
  // variável acompanha o km rodado, como o custo que a gera.
  const credito = p.preco.creditoPisCofinsPct;
  const creditoVariavel = composicao.reduce((a, i) => a + i.diesel + i.arla + i.oleoLavagem + i.pneus + i.manutencao, 0);
  const creditoFixo = (composicao.reduce((a, i) => a + i.custoComCredito, 0) - creditoVariavel) * credito;
  const creditoPorKmRodado = dividir(creditoVariavel, kmRodado) * credito;
  // Anualização: no MENSAL, × vigência; no PERIODO a apuração já é o período.
  const fatorAno = p.contrato.modo === "MENSAL" ? p.contrato.vigenciaMeses : 1;
  const mesesPorApuracao = p.contrato.modo === "MENSAL" ? 1 : p.contrato.mesesCustoFixo;

  // Faturamento(u) = fixoReceita + porUtilizacao × u. A utilização escala o
  // km de referência, que é a base da utilização 1.
  const quantidadeFixa = composicao.reduce((a, i) => a + i.quantidadeUnidade, 0);
  const faturamentoFixo =
    unidade === "KM" ? 0 : unidade === "BINOMIA" ? composicao.reduce((a, i) => a + i.indicadores.binomia.fixoVeiculoMes * i.indicadores.veiculoMes.quantidade, 0) : precoTeste * quantidadeFixa;
  const faturamentoPorUtilizacao = unidade === "KM" || unidade === "BINOMIA" ? precoTeste * kmReferencia : 0;

  const linhas: LinhaCenario[] = utilizacoes.map((u) => {
    const kmUtil = kmReferencia * u;
    const custoDireto = fixo + variavelKmRodado * kmUtil * (1 + p.contrato.kmMortoPct) + pedagio * u;
    const custoTotal = custoDireto * (1 + indiretosPct);
    const custoLiquido = custoTotal - creditoFixo - creditoPorKmRodado * kmUtil * (1 + p.contrato.kmMortoPct);
    const naoDedutiveis = capitalProprio + custoDireto * contingenciaPct;
    const custoKm = dividir(custoTotal, kmUtil);
    // O custo que o preço cobre inclui o IR sobre os não dedutíveis — ver simular().
    const custoParaPrecoKm = dividir(custoLiquido + naoDedutiveis * acrescimoIr, kmUtil);
    const faturamento = faturamentoFixo + faturamentoPorUtilizacao * u;
    const lucroAntesIr = faturamento * liquido - custoLiquido;
    const lucro = lucroAntesIr - baseIr(lucroAntesIr, naoDedutiveis) * ir;
    return {
      utilizacao: u,
      kmUtil,
      custoTotal,
      custoKm,
      precoLucroAlvoKm: kmUtil > 0 ? arredondarParaCima(custoParaPrecoKm / divisorAlvo, 2) : 0,
      precoLucroZeroKm: dividir(custoParaPrecoKm, liquido),
      faturamento,
      lucro,
      margem: faturamento > 0 ? lucro / faturamento : null,
      lucroAno: lucro * fatorAno,
      lucroVeiculoMes: dividir(lucro, veiculosOperacionais * mesesPorApuracao),
    };
  });

  // Lucro antes do IR (u) = a + b·u, com a = fatFixo·L − fixo·(1+i) + crédito
  // fixo e b = fatPorU·L − (v·K·(1+m) + ped)·(1+i) + crédito variável·K·(1+m).
  // Não dedutíveis N(u) = n0 + n1·u, com n0 = capital próprio + fixo·cont e
  // n1 = (v·K·(1+m) + ped)·cont. Onde a base do IR é positiva, o lucro depois
  // do IR é (a + b·u)·(1 − ir) − ir·(n0 + n1·u) = a' + b'·u; o lucro zero
  // cai sempre nesse trecho (lá a base é N ÷ (1 − ir) ≥ 0), e o equilíbrio é
  // u = −a'/b'. No Presumido, a' = a e b' = b.
  const variavelPorU = (variavelKmRodado * kmReferencia * (1 + p.contrato.kmMortoPct) + pedagio) * (1 + indiretosPct);
  const a = faturamentoFixo * liquido - fixo * (1 + indiretosPct) + creditoFixo;
  const b = faturamentoPorUtilizacao * liquido - variavelPorU + creditoPorKmRodado * kmReferencia * (1 + p.contrato.kmMortoPct);
  const n0 = capitalProprio + fixo * contingenciaPct;
  const n1 = (variavelKmRodado * kmReferencia * (1 + p.contrato.kmMortoPct) + pedagio) * contingenciaPct;
  const aLiquido = ir > 0 ? a * (1 - ir) - ir * n0 : a;
  const bLiquido = ir > 0 ? b * (1 - ir) - ir * n1 : b;
  const u = bLiquido !== 0 ? -aLiquido / bLiquido : null;
  const pontoEquilibrio = u !== null && u > 0 && Number.isFinite(u) ? u : null;

  return {
    precoTesteKm: precoTeste,
    unidade,
    tributosPct,
    financeiroPct: fin,
    linhas,
    pontoEquilibrio,
    tipoEquilibrio: bLiquido > 0 ? "MINIMA" : "MAXIMA",
  };
}
