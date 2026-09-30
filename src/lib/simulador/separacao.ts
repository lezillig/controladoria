import type { ComposicaoItem, Premissas } from "./tipos";

// MÃO DE OBRA × VEÍCULO — a mesma composição do motor, lida em duas contas.
//
// Serve para responder "quanto do preço é gente e quanto é carro": para quem
// contrata locação com motorista e quer os dois preços em separado, para
// comparar com o preço de mercado da locação pura e para saber o que muda
// quando o cliente fornece o motorista ou o veículo.
//
// - Mão de obra: salários, encargos, benefícios e supervisão (motoristas e
//   monitoras).
// - Veículo, custo fixo: capital (depreciação e remuneração), seguro, IPVA,
//   telemetria, higienização, garagem, adaptações e manutenção fixa — com a
//   reserva técnica.
// - Veículo, custo variável: combustível, ARLA, óleo, pneus, manutenção por km
//   e pedágio — acompanham o km rodado.
// - Implantação: custo do contrato, amortizado; fica à parte.
//
// Administração e contingência são % do custo direto: cada parte leva a sua
// fração. O crédito de PIS/COFINS (Lucro Real) sai só de custos do veículo
// (depreciação, manutenção, garagem, combustível, pneus…), e abate só do
// veículo. O preço de cada parte é o faturamento rateado pelo custo líquido de
// cada uma — uma leitura do preço calculado, não um segundo preço.

export type ChaveParte = "maoDeObra" | "veiculoFixo" | "veiculoVariavel" | "implantacao";

export type Parte = {
  chave: ChaveParte;
  rotulo: string;
  // Custo direto na apuração e com a parte dela de administração e contingência.
  direto: number;
  comIndiretos: number;
  // Com indiretos, menos o crédito de PIS/COFINS da parte.
  liquido: number;
  // Fração do custo total (com indiretos).
  participacao: number;
  porKm: number;
  porVeiculoMes: number;
  // O faturamento rateado pelo custo líquido.
  preco: number;
  precoPorVeiculoMes: number;
  precoPorKm: number;
};

// Um componente de uma parte, no custo direto da apuração (sem indiretos).
export type Componente = { rotulo: string; valor: number };

export type Separacao = {
  partes: Parte[];
  // O que compõe cada parte, na ordem da composição. Somado à linha de
  // administração e contingência, fecha o `comIndiretos` da parte.
  componentes: Record<ChaveParte, Componente[]>;
  indiretosPct: number;
  maoDeObra: Parte;
  // Fixo + variável.
  veiculo: Parte;
  // Motoristas e monitoras (sem a supervisão, que é rateada).
  pessoas: number;
  custoTotal: number;
  faturamento: number;
  kmUtil: number;
  veiculoMes: number;
};

const ROTULOS: Record<ChaveParte, string> = {
  maoDeObra: "Mão de obra",
  veiculoFixo: "Veículo — custo fixo",
  veiculoVariavel: "Veículo — custo variável",
  implantacao: "Implantação",
};

const dividir = (a: number, b: number) => (b === 0 ? 0 : a / b);

// Separa um ou mais itens (somados). Sem itens, tudo zero.
export function separarMaoDeObraEVeiculo(itens: ComposicaoItem[], p: Premissas): Separacao {
  const meses = p.contrato.mesesCustoFixo;
  const indiretosPct = p.indiretos.administracaoPct + p.indiretos.contingenciaPct;
  const soma = (f: (i: ComposicaoItem) => number) => itens.reduce((a, i) => a + f(i), 0);

  const diretos: Record<ChaveParte, number> = {
    maoDeObra: soma((i) => i.maoDeObraMes) * meses,
    veiculoFixo: soma((i) => i.veiculoMes) * meses,
    veiculoVariavel: soma((i) => i.variaveis),
    implantacao: soma((i) => i.implantacaoMes) * meses,
  };
  // O crédito separado em fixo e variável, como o motor o apura.
  const pctCredito = p.preco.creditoPisCofinsPct;
  const creditoVariavel = soma((i) => i.diesel + i.arla + i.oleoLavagem + i.pneus + i.manutencao) * pctCredito;
  const creditos: Record<ChaveParte, number> = {
    maoDeObra: 0,
    veiculoFixo: soma((i) => i.creditoPisCofins) - creditoVariavel,
    veiculoVariavel: creditoVariavel,
    implantacao: 0,
  };

  const custoTotal = soma((i) => i.custoTotal);
  const faturamento = soma((i) => i.faturamento);
  const kmUtil = soma((i) => i.kmUtil);
  const veiculoMes = soma((i) => i.veiculos) * meses;
  const liquidoTotal = custoTotal - soma((i) => i.creditoPisCofins);

  const parte = (chave: ChaveParte, direto: number, credito: number, rotulo = ROTULOS[chave]): Parte => {
    const comIndiretos = direto * (1 + indiretosPct);
    const liquido = comIndiretos - credito;
    const preco = faturamento * dividir(liquido, liquidoTotal);
    return {
      chave,
      rotulo,
      direto,
      comIndiretos,
      liquido,
      participacao: dividir(comIndiretos, custoTotal),
      porKm: dividir(comIndiretos, kmUtil),
      porVeiculoMes: dividir(comIndiretos, veiculoMes),
      preco,
      precoPorVeiculoMes: dividir(preco, veiculoMes),
      precoPorKm: dividir(preco, kmUtil),
    };
  };

  const chaves: ChaveParte[] = ["maoDeObra", "veiculoFixo", "veiculoVariavel", "implantacao"];
  const partes = chaves.map((c) => parte(c, diretos[c], creditos[c]));
  const veiculo = parte("veiculoFixo", diretos.veiculoFixo + diretos.veiculoVariavel, creditos.veiculoFixo + creditos.veiculoVariavel, "Veículo");
  const pessoas = soma((i) => i.motoristas + i.monitoras);

  const mensal = (rotulo: string, f: (i: ComposicaoItem) => number): Componente => ({ rotulo, valor: soma(f) * meses });
  const variavel = (rotulo: string, f: (i: ComposicaoItem) => number): Componente => ({ rotulo, valor: soma(f) });
  const componentes: Record<ChaveParte, Componente[]> = {
    maoDeObra: [
      mensal("Salários (com horas extras e adicional noturno)", (i) => i.salarios),
      mensal("Encargos sociais", (i) => i.encargos),
      mensal("Benefícios, uniforme e exames", (i) => i.beneficios),
      mensal("Supervisão local", (i) => i.supervisao),
    ],
    veiculoFixo: [
      mensal("Depreciação", (i) => i.depreciacao),
      mensal("Remuneração do capital", (i) => i.remuneracaoCapital),
      mensal("Seguro", (i) => i.seguro),
      mensal("IPVA, licenciamento e laudos", (i) => i.ipvaLicenciamento),
      mensal("Telemetria e controle de embarque", (i) => i.telemetria),
      mensal("Higienização e acessibilidade", (i) => i.higieneAcessibilidade),
      mensal("Garagem / base local", (i) => i.garagem),
      mensal("Adaptações", (i) => i.adaptacao),
      mensal("Manutenção fixa", (i) => i.manutencaoFixa),
    ],
    veiculoVariavel: [
      variavel("Combustível / energia", (i) => i.diesel),
      variavel("ARLA", (i) => i.arla),
      variavel("Óleo e lavagem", (i) => i.oleoLavagem),
      variavel("Pneus", (i) => i.pneus),
      variavel("Manutenção por km", (i) => i.manutencao),
      variavel("Pedágio", (i) => i.pedagio),
    ],
    implantacao: [mensal("Implantação amortizada", (i) => i.implantacaoMes)],
  };

  return {
    partes,
    componentes,
    indiretosPct,
    maoDeObra: partes[0],
    veiculo,
    pessoas,
    custoTotal,
    faturamento,
    kmUtil,
    veiculoMes,
  };
}
