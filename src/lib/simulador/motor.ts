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
// Todas nascem zeradas: com elas em zero, a conta é a das planilhas.
//
// Função pura. Guardar a entrada é guardar a conta inteira.
//
// Onde as duas planilhas de referência divergem, o motor segue a planilha e
// deixa a escolha explícita:
//   - garagem com ou sem reserva técnica → Premissas.veiculo.garagemComReserva;
//   - pedágio: na composição entra o valor mensal da rota (plano operacional),
//     nos cenários entra proporcional à utilização — como na aba Cenários de SJP.

export const VERSAO_MOTOR = "2026.09-v1";
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

export function tributosDoItem(p: Premissas, shareIntermunicipal: number): number {
  const federais = p.preco.pis + p.preco.cofins + p.preco.irpj + p.preco.csll;
  return federais + p.preco.iss * (1 - shareIntermunicipal) + p.preco.icms * shareIntermunicipal;
}

export function financeiroPct(p: Premissas): number {
  return (p.preco.custoCapitalGiroAm * p.preco.prazoRecebimentoDias) / 30;
}

// Dias de operação da rota numa apuração. MENSAL: os dias/mês informados (ou
// km ÷ km/dia). PERIODO: os dias do período (km do período ÷ km/dia).
function diasNaApuracao(p: Premissas, r: Rota): number {
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
export function custoDeCapital(v: Premissas["veiculo"], vigenciaMeses: number): {
  taxaCapitalAa: number;
  depreciacaoAnual: number;
  valorMedio: number;
  remuneracaoAnual: number;
} {
  const taxaCapitalAa = v.capitalComposto
    ? v.fracaoFinanciada * v.taxaFinanciamentoAa + (1 - v.fracaoFinanciada) * v.custoCapitalProprioAa
    : v.custoCapitalAa;
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
    const acumuladaAntes = (k: number) => {
      if (v.metodoDepreciacao === "PERCENTUAL") return v.valor * v.depreciacaoAa * (k - 1);
      const n = Math.max(1, Math.round(v.vidaUtilAnos));
      const depreciavel = v.valor * (1 - v.valorResidualPct);
      const somaDigitos = (n * (n + 1)) / 2;
      let acc = 0;
      for (let j = 1; j < k; j++) acc += j > n ? 0 : v.metodoDepreciacao === "LINEAR" ? depreciavel / n : (depreciavel * (n - j + 1)) / somaDigitos;
      return acc;
    };
    const meios = anos.map((k, i) => Math.max(v.valor * (v.metodoDepreciacao === "PERCENTUAL" ? 0 : v.valorResidualPct), v.valor - acumuladaAntes(k) - porAno[i] / 2));
    valorMedio = meios.reduce((a, x) => a + x, 0) / meios.length;
  }
  return { taxaCapitalAa, depreciacaoAnual, valorMedio, remuneracaoAnual: valorMedio * taxaCapitalAa };
}

type PorRota = {
  kmReferencia: number;
  kmUtil: number;
  kmRodado: number;
  salarios: number;
  encargos: number;
  beneficios: number;
  depreciacao: number;
  remuneracaoCapital: number;
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
  // horas extras e noturnas em horas, por motorista, a salário ÷ divisor.
  const fatorNoturno = r.noturno ? pessoal.fatorJornadaNoturna : 1;
  // O salário do motorista é o do tipo de veículo da rota, quando há perfil.
  const salarioMotorista = perfil?.motorista.salario ?? pessoal.salarioMotorista;
  const valorHora = pessoal.divisorHorasMes > 0 ? salarioMotorista / pessoal.divisorHorasMes : 0;
  const adicionaisEmHoras =
    valorHora * (pessoal.horasExtras50Mes * 1.5 + pessoal.horasExtras100Mes * 2 + pessoal.horasNoturnasMes * 1.2);
  const salarios =
    motoristas * (salarioMotorista * (1 + pessoal.horaExtraPct) * fatorNoturno + adicionaisEmHoras) +
    monitoras * pessoal.salarioMonitora;
  const encargos = salarios * pessoal.encargosPct;
  const beneficios = (motoristas + monitoras) * (pessoal.beneficiosPorFuncionario + pessoal.uniformeEpiPorFuncionario);

  // Veículo — ter o veículo custa também para a reserva técnica;
  // higienização e acessibilidade, só para o que roda.
  const comReserva = r.veiculos * (1 + contrato.reservaTecnicaPct);
  const cap = custoDeCapital(veiculo, contrato.vigenciaMeses);
  const depreciacao = (comReserva * cap.depreciacaoAnual) / 12;
  const remuneracaoCapital = (comReserva * cap.remuneracaoAnual) / 12;
  const seguro = comReserva * veiculo.seguroMes;
  const ipvaLicenciamento = (comReserva * (veiculo.ipvaLicenciamentoAno + veiculo.laudoVistoriaAno)) / 12;
  const telemetria = comReserva * (veiculo.rastreadorMes + veiculo.telemetriaExtraMes + veiculo.controleEmbarqueMes);
  const higieneAcessibilidade = r.veiculos * (veiculo.higienizacaoMes + veiculo.acessibilidadeMes);
  const garagem = (veiculo.garagemComReserva ? comReserva : r.veiculos) * veiculo.garagemMes;
  const adaptacaoDepreciacao = comReserva * veiculo.adaptacaoValor * dividir(1, veiculo.adaptacaoMesesDepreciacao);
  const adaptacao = adaptacaoDepreciacao + (comReserva * veiculo.adaptacaoValor * cap.taxaCapitalAa) / 12;
  const manutencaoFixa = comReserva * veiculo.valor * veiculo.manutencaoFixaPctMes;

  // Variáveis por km rodado, ponderados entre asfalto e terra.
  const dieselKm =
    variaveis.dieselLitro * (dividir(pctAsfalto, variaveis.consumoAsfaltoKmL) + (pctTerra > 0 ? dividir(pctTerra, variaveis.consumoTerraKmL) : 0));
  const pneusKm = pctAsfalto * variaveis.pneusAsfaltoKm + pctTerra * variaveis.pneusTerraKm;
  const manutencaoKm = pctAsfalto * variaveis.manutencaoAsfaltoKm + pctTerra * variaveis.manutencaoTerraKm;

  const dias = diasNaApuracao(p, r);
  return {
    kmReferencia: r.kmReferencia,
    kmUtil,
    kmRodado,
    salarios,
    encargos,
    beneficios,
    depreciacao,
    remuneracaoCapital,
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

    const tributosPct = tributosDoItem(p, item.shareIntermunicipal);
    const liquido = 1 - tributosPct - fin - sobrePreco;
    // Lucro líquido alvo depois do IR/CSLL sobre o lucro: o lucro antes do IR
    // precisa ser alvo ÷ (1 − alíquota). No Presumido a alíquota é zero.
    const divisor = liquido - dividir(p.preco.lucroAlvoPct, 1 - irSobreLucro);
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
      return { quantidade, custo, preco: precoPara(dividir(custoLiquido, quantidade), quantidade) };
    };
    const indicadores: IndicadoresUnidade = {
      km: indicador(quantidades.km),
      veiculoMes: indicador(quantidades.veiculoMes),
      diaria: indicador(quantidades.diaria),
      hora: quantidadeHoras === null ? null : indicador(quantidadeHoras),
      // Tarifa em duas partes: o fixo (com sua parte dos indiretos) por
      // veículo-mês, o variável (idem) por km útil.
      binomia: {
        fixoVeiculoMes:
          quantidades.veiculoMes > 0
            ? arredondarParaCima((custoFixo * (1 + indiretosPct) - fixoComCredito * p.preco.creditoPisCofinsPct) / divisor / quantidades.veiculoMes, 2)
            : 0,
        variavelKm: kmUtil > 0 ? arredondarParaCima((variaveis * (1 + indiretosPct) - variavelComCredito * p.preco.creditoPisCofinsPct) / divisor / kmUtil, 2) : 0,
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
    const precoMinimoKm = dividir(dividir(custoLiquido, kmUtil), liquido);
    const lucroAntesIr = faturamento * liquido - custoLiquido;
    const irpjCsllSobreLucro = lucroAntesIr > 0 ? lucroAntesIr * irSobreLucro : 0;
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
    const lucroAoPrecoProposta = lairProposta > 0 ? lairProposta * (1 - irSobreLucro) : lairProposta;
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
    const custoTotal = (fixo + variavelKmRodado * kmUtil * (1 + p.contrato.kmMortoPct) + pedagio * u) * (1 + indiretosPct);
    const custoLiquido = custoTotal - creditoFixo - creditoPorKmRodado * kmUtil * (1 + p.contrato.kmMortoPct);
    const custoKm = dividir(custoTotal, kmUtil);
    const custoLiquidoKm = dividir(custoLiquido, kmUtil);
    const faturamento = faturamentoFixo + faturamentoPorUtilizacao * u;
    const lucroAntesIr = faturamento * liquido - custoLiquido;
    const lucro = lucroAntesIr > 0 ? lucroAntesIr * (1 - ir) : lucroAntesIr;
    return {
      utilizacao: u,
      kmUtil,
      custoTotal,
      custoKm,
      precoLucroAlvoKm: kmUtil > 0 ? arredondarParaCima(custoLiquidoKm / divisorAlvo, 2) : 0,
      precoLucroZeroKm: dividir(custoLiquidoKm, liquido),
      faturamento,
      lucro,
      margem: faturamento > 0 ? lucro / faturamento : null,
      lucroAno: lucro * fatorAno,
      lucroVeiculoMes: dividir(lucro, veiculosOperacionais * mesesPorApuracao),
    };
  });

  // Lucro antes do IR (u) = a + b·u, com a = fatFixo·L − fixo·(1+i) + crédito
  // fixo e b = fatPorU·L − (v·K·(1+m) + ped)·(1+i) + crédito variável·K·(1+m).
  // O equilíbrio (lucro zero, antes ou depois do IR) é u = −a/b.
  const a = faturamentoFixo * liquido - fixo * (1 + indiretosPct) + creditoFixo;
  const b =
    faturamentoPorUtilizacao * liquido -
    (variavelKmRodado * kmReferencia * (1 + p.contrato.kmMortoPct) + pedagio) * (1 + indiretosPct) +
    creditoPorKmRodado * kmReferencia * (1 + p.contrato.kmMortoPct);
  const u = b !== 0 ? -a / b : null;
  const pontoEquilibrio = u !== null && u > 0 && Number.isFinite(u) ? u : null;

  return {
    precoTesteKm: precoTeste,
    unidade,
    tributosPct,
    financeiroPct: fin,
    linhas,
    pontoEquilibrio,
    tipoEquilibrio: b > 0 ? "MINIMA" : "MAXIMA",
  };
}
