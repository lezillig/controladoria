import type {
  Cenarios,
  ComposicaoItem,
  EntradaSimulacao,
  LinhaCenario,
  Premissas,
  ResultadoLote,
  ResultadoSimulacao,
  Rota,
} from "./tipos";

// O MOTOR DO SIMULADOR DE CUSTOS.
//
// As fórmulas são as das planilhas de referência (Holambra PE 036/2026 e São
// José dos Pinhais PE 089/2026), célula a célula — ver
// docs/simulador_custos_handoff/docs/ESPECIFICACAO_MODULO_SIMULADOR_CUSTOS.md,
// seção 3, e os scripts geradores em docs/simulador_custos_handoff/scripts/.
// Os testes (scripts/teste-simulador.ts) reproduzem os resultados esperados
// das duas com tolerância de R$ 0,01 no preço/km e 0,1% nos totais.
//
// Função pura: recebe premissas, itens e rotas e devolve o resultado. Nenhuma
// consulta, nenhum relógio. É o que permite guardar a entrada como snapshot e
// refazer a conta daqui a um ano com o mesmo número.
//
// Onde as duas planilhas divergem entre si, o motor segue a planilha e deixa a
// escolha como premissa ou como comentário:
//   - garagem com ou sem reserva técnica → Premissas.veiculo.garagemComReserva;
//   - pedágio: na composição entra o valor mensal da rota (plano operacional),
//     nos cenários entra proporcional à utilização — como na aba Cenários de SJP.

export const UTILIZACOES_PADRAO = [0.6, 0.7, 0.8, 0.85, 0.9, 1];

// ROUNDUP(x; 2) do Excel: arredonda para cima, afastando do zero. O
// `toPrecision(12)` absorve o ruído de ponto flutuante — 7,74 × 100 dá
// 774,0000000000001 e subiria para 7,75 sem ele, onde o Excel mostra 7,74.
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

type PorRota = {
  kmReferencia: number;
  kmUtil: number;
  kmRodado: number;
  salarios: number;
  encargos: number;
  beneficios: number;
  capital: number;
  seguro: number;
  ipvaLicenciamento: number;
  telemetria: number;
  higieneAcessibilidade: number;
  garagem: number;
  diesel: number;
  arla: number;
  oleoLavagem: number;
  pneus: number;
  manutencao: number;
  pedagio: number;
};

// A CONTA DE UMA ROTA. Mão de obra e veículo são mensais; os variáveis já
// saem na apuração (o km de referência da rota já é o do mês ou do período).
function calcularRota(p: Premissas, r: Rota): PorRota {
  const { contrato, pessoal, veiculo, variaveis } = p;

  const kmUtil = r.kmReferencia * contrato.utilizacao;
  const kmRodado = kmUtil * (1 + contrato.kmMortoPct);
  const pctTerra = r.kmDia > 0 ? r.kmTerraDia / r.kmDia : 0;
  const pctAsfalto = 1 - pctTerra;

  // Mão de obra — o fator noturno incide só sobre o motorista.
  const fatorNoturno = r.noturno ? pessoal.fatorJornadaNoturna : 1;
  const salarios =
    r.motoristas * pessoal.salarioMotorista * (1 + pessoal.horaExtraPct) * fatorNoturno + r.monitoras * pessoal.salarioMonitora;
  const encargos = salarios * pessoal.encargosPct;
  const beneficios = (r.motoristas + r.monitoras) * (pessoal.beneficiosPorFuncionario + pessoal.uniformeEpiPorFuncionario);

  // Veículo — o custo de ter o veículo recai também sobre a reserva técnica;
  // higienização e acessibilidade, só sobre o que roda.
  const comReserva = r.veiculos * (1 + contrato.reservaTecnicaPct);
  const capital = (comReserva * veiculo.valor * (veiculo.depreciacaoAa + veiculo.custoCapitalAa)) / 12;
  const seguro = comReserva * veiculo.seguroMes;
  const ipvaLicenciamento = (comReserva * (veiculo.ipvaLicenciamentoAno + veiculo.laudoVistoriaAno)) / 12;
  const telemetria = comReserva * (veiculo.rastreadorMes + veiculo.telemetriaExtraMes + veiculo.controleEmbarqueMes);
  const higieneAcessibilidade = r.veiculos * (veiculo.higienizacaoMes + veiculo.acessibilidadeMes);
  const garagem = (veiculo.garagemComReserva ? comReserva : r.veiculos) * veiculo.garagemMes;

  // Variáveis por km rodado, ponderados entre asfalto e terra.
  const dieselKm =
    variaveis.dieselLitro * (pctAsfalto / variaveis.consumoAsfaltoKmL + (pctTerra > 0 ? pctTerra / variaveis.consumoTerraKmL : 0));
  const pneusKm = pctAsfalto * variaveis.pneusAsfaltoKm + pctTerra * variaveis.pneusTerraKm;
  const manutencaoKm = pctAsfalto * variaveis.manutencaoAsfaltoKm + pctTerra * variaveis.manutencaoTerraKm;

  return {
    kmReferencia: r.kmReferencia,
    kmUtil,
    kmRodado,
    salarios,
    encargos,
    beneficios,
    capital,
    seguro,
    ipvaLicenciamento,
    telemetria,
    higieneAcessibilidade,
    garagem,
    diesel: dieselKm * kmRodado,
    arla: variaveis.arlaKm * kmRodado,
    oleoLavagem: variaveis.oleoLavagemKm * kmRodado,
    pneus: pneusKm * kmRodado,
    manutencao: manutencaoKm * kmRodado,
    pedagio: r.passagensPedagioMes * r.tarifaPedagio,
  };
}

function somaCampo(linhas: PorRota[], campo: keyof PorRota): number {
  return linhas.reduce((a, l) => a + l[campo], 0);
}

export function simular(entrada: EntradaSimulacao): ResultadoSimulacao {
  const { premissas: p, itens, rotas, criterio } = entrada;
  const fin = financeiroPct(p);
  const indiretosPct = p.indiretos.administracaoPct + p.indiretos.contingenciaPct;
  const meses = p.contrato.mesesCustoFixo;

  const porItem = itens.map((item) => ({ item, rotas: rotas.filter((r) => r.item === item.codigo) }));
  const kmUtilTotal = rotas.reduce((a, r) => a + r.kmReferencia * p.contrato.utilizacao, 0);

  const composicao: ComposicaoItem[] = porItem.map(({ item, rotas: rotasDoItem }) => {
    const calc = rotasDoItem.map((r) => calcularRota(p, r));
    const s = (c: keyof PorRota) => somaCampo(calc, c);

    const kmUtil = s("kmUtil");
    const veiculos = rotasDoItem.reduce((a, r) => a + r.veiculos, 0);
    const motoristas = rotasDoItem.reduce((a, r) => a + r.motoristas, 0);
    const monitoras = rotasDoItem.reduce((a, r) => a + r.monitoras, 0);

    // Supervisão local rateada pelo km útil do item sobre o do edital.
    const supervisao = p.pessoal.supervisaoMes * dividir(kmUtil, kmUtilTotal);
    const salarios = s("salarios");
    const encargos = s("encargos");
    const beneficios = s("beneficios");
    const maoDeObraMes = salarios + encargos + beneficios + supervisao;

    const capital = s("capital");
    const seguro = s("seguro");
    const ipvaLicenciamento = s("ipvaLicenciamento");
    const telemetria = s("telemetria");
    const higieneAcessibilidade = s("higieneAcessibilidade");
    const garagem = s("garagem");
    const veiculoMes = capital + seguro + ipvaLicenciamento + telemetria + higieneAcessibilidade + garagem;

    const custoFixo = (maoDeObraMes + veiculoMes) * meses;
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

    const tributosPct = tributosDoItem(p, item.shareIntermunicipal);
    const divisor = 1 - p.preco.lucroAlvoPct - tributosPct - fin;
    const precoKm = kmUtil > 0 ? arredondarParaCima(custoKm / divisor, 2) : 0;
    const precoMinimoKm = dividir(custoKm, 1 - tributosPct - fin);
    const faturamento = precoKm * kmUtil;
    const lucro = faturamento * (1 - tributosPct - fin) - custoTotal;
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
      capital,
      seguro,
      ipvaLicenciamento,
      telemetria,
      higieneAcessibilidade,
      garagem,
      veiculoMes,
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
      lucro,
      margem: faturamento > 0 ? lucro / faturamento : null,
      precoMaximoKm,
      precoReferenciaKm: item.precoReferenciaKm ?? null,
      acimaDoTeto: precoMaximoKm !== null && precoKm > precoMaximoKm,
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

  let lote: ResultadoLote | null = null;
  if (criterio === "LOTE") {
    const precoKm = dividir(faturamentoTotal, totais.kmUtil);
    const precoProposta = arredondarParaCima(precoKm, 2);
    const faturamentoAoPrecoProposta = precoProposta * totais.kmUtil;
    const lucroAoPrecoProposta = faturamentoAoPrecoProposta * (1 - tributosPonderados - fin) - totais.custoTotal;
    lote = {
      kmUtil: totais.kmUtil,
      custoTotal: totais.custoTotal,
      custoKm: dividir(totais.custoTotal, totais.kmUtil),
      precoKm,
      precoProposta,
      tributosPct: tributosPonderados,
      faturamento: faturamentoTotal,
      lucro: lucroTotal,
      faturamentoAoPrecoProposta,
      lucroAoPrecoProposta,
      margemAoPrecoProposta: faturamentoAoPrecoProposta > 0 ? lucroAoPrecoProposta / faturamentoAoPrecoProposta : null,
      itensAcimaDoTeto: composicao.filter((i) => i.acimaDoTeto).map((i) => i.item),
    };
  }

  const precoPadrao = lote ? lote.precoProposta : arredondarParaCima(dividir(faturamentoTotal, totais.kmUtil), 2);
  const cenarios = calcularCenarios(
    p,
    composicao,
    totais.veiculos,
    tributosPonderados,
    entrada.precoTesteKm ?? precoPadrao,
    entrada.utilizacoesCenario ?? UTILIZACOES_PADRAO
  );

  return { modo: p.contrato.modo, criterio, itens: composicao, totais, lote, cenarios };
}

// CENÁRIOS DE UTILIZAÇÃO — a aba Cenários de SJP, generalizada.
//
// O custo fixo não muda com o km pago; o variável acompanha o km rodado; o
// pedágio acompanha a utilização. A tabela mostra, para cada utilização do km
// de referência, o custo, o preço necessário para o lucro alvo, o piso de lucro
// zero e o lucro obtido ao preço de teste.
function calcularCenarios(
  p: Premissas,
  composicao: ComposicaoItem[],
  veiculosOperacionais: number,
  tributosPct: number,
  precoTesteKm: number,
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
  const liquido = 1 - tributosPct - fin;
  // Anualização: no MENSAL, × vigência; no PERIODO a apuração já é o período.
  const fatorAno = p.contrato.modo === "MENSAL" ? p.contrato.vigenciaMeses : 1;
  const mesesPorApuracao = p.contrato.modo === "MENSAL" ? 1 : p.contrato.mesesCustoFixo;

  const linhas: LinhaCenario[] = utilizacoes.map((u) => {
    const kmUtil = kmReferencia * u;
    const custoTotal = (fixo + variavelKmRodado * kmUtil * (1 + p.contrato.kmMortoPct) + pedagio * u) * (1 + indiretosPct);
    const custoKm = dividir(custoTotal, kmUtil);
    const faturamento = precoTesteKm * kmUtil;
    const lucro = faturamento * liquido - custoTotal;
    return {
      utilizacao: u,
      kmUtil,
      custoTotal,
      custoKm,
      precoLucroAlvoKm: kmUtil > 0 ? arredondarParaCima(custoKm / (1 - p.preco.lucroAlvoPct - tributosPct - fin), 2) : 0,
      precoLucroZeroKm: dividir(custoKm, liquido),
      faturamento,
      lucro,
      margem: faturamento > 0 ? lucro / faturamento : null,
      lucroAno: lucro * fatorAno,
      lucroVeiculoMes: dividir(lucro, veiculosOperacionais * mesesPorApuracao),
    };
  });

  // Lucro(u) = u·[p·K·(1−t−f) − (v·K·(1+m) + ped)·(1+i)] − fixo·(1+i). Linear
  // em u: o equilíbrio é o u que zera a expressão.
  const inclinacao =
    precoTesteKm * kmReferencia * liquido - (variavelKmRodado * kmReferencia * (1 + p.contrato.kmMortoPct) + pedagio) * (1 + indiretosPct);
  const pontoEquilibrio = inclinacao > 0 ? (fixo * (1 + indiretosPct)) / inclinacao : null;

  return { precoTesteKm, tributosPct, financeiroPct: fin, linhas, pontoEquilibrio };
}
