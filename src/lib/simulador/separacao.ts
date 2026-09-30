import { calcularEncargos, ENCARGOS_PADRAO } from "./maoDeObra";
import { fatorHoraNoturna } from "./motor";
import type { ComposicaoItem, EntradaSimulacao, Premissas } from "./tipos";

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
// `memo` diz de onde vem o número; `sub` abre o componente nas suas parcelas
// (que somam o componente).
export type Componente = { rotulo: string; valor: number; memo?: string; sub?: Componente[] };

export type Separacao = {
  partes: Parte[];
  // O que compõe cada parte, na ordem da composição. Somado à linha de
  // administração e contingência, fecha o `comIndiretos` da parte.
  componentes: Record<ChaveParte, Componente[]>;
  indiretosPct: number;
  administracaoPct: number;
  contingenciaPct: number;
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

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const qtd = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

// DE ONDE VÊM OS SALÁRIOS — a mesma conta de calcularRota() no motor, aberta
// por parcela: salário de cada tipo × motoristas, horas extras médias, fator
// de jornada noturna, horas extras e noturnas em horas e monitoras. Valores
// mensais.
function parcelasDosSalarios(entrada: Pick<EntradaSimulacao, "itens" | "rotas" | "premissas">, codigos: Set<string>): Componente[] {
  const p = entrada.premissas;
  const pe = p.pessoal;
  const porSalario = new Map<string, { salario: number; motoristas: number; tipo: string }>();
  let horaExtraMedia = 0, noturnoFator = 0, emHoras = 0, monitoras = 0;
  for (const r of entrada.rotas) {
    const item = entrada.itens.find((i) => i.codigo === r.item);
    if (!item || !codigos.has(item.codigo) || item.comMotorista === false) continue;
    const perfil = r.perfilVeiculo ? p.perfis?.find((x) => x.codigo === r.perfilVeiculo) : undefined;
    const salario = perfil?.motorista.salario ?? pe.salarioMotorista;
    const tipo = perfil?.descricao ?? "padrão do estudo";
    const chave = `${salario}|${tipo}`;
    const atual = porSalario.get(chave) ?? { salario, motoristas: 0, tipo };
    atual.motoristas += r.motoristas;
    porSalario.set(chave, atual);
    const fn = r.noturno ? pe.fatorJornadaNoturna : 1;
    horaExtraMedia += r.motoristas * salario * pe.horaExtraPct;
    noturnoFator += r.motoristas * salario * (1 + pe.horaExtraPct) * (fn - 1);
    const valorHora = pe.divisorHorasMes > 0 ? salario / pe.divisorHorasMes : 0;
    emHoras += r.motoristas * valorHora * (pe.horasExtras50Mes * 1.5 + pe.horasExtras100Mes * 2 + pe.horasNoturnasMes * fatorHoraNoturna(p));
    monitoras += r.monitoras;
  }
  const parcelas: Componente[] = [...porSalario.values()].map((x) => ({
    rotulo: `Salário do motorista — ${x.tipo}`,
    valor: x.motoristas * x.salario,
    memo: `${qtd(x.motoristas)} motorista${x.motoristas === 1 ? "" : "s"} × ${brl(x.salario)}`,
  }));
  if (horaExtraMedia) parcelas.push({ rotulo: "Horas extras médias", valor: horaExtraMedia, memo: `${pct(pe.horaExtraPct)} do salário` });
  if (noturnoFator) parcelas.push({ rotulo: "Jornada noturna (fator)", valor: noturnoFator, memo: `× ${qtd(pe.fatorJornadaNoturna)} nas rotas noturnas` });
  if (emHoras) parcelas.push({ rotulo: "Horas extras e noturnas em horas", valor: emHoras, memo: `salário ÷ ${qtd(pe.divisorHorasMes)} h × horas informadas` });
  if (monitoras) parcelas.push({ rotulo: "Salário das monitoras", valor: monitoras * pe.salarioMonitora, memo: `${qtd(monitoras)} × ${brl(pe.salarioMonitora)}` });
  return parcelas;
}

// DE ONDE VÊM OS ENCARGOS — quando o % do estudo é o do cálculo padrão
// (GEIPOT, grupos A a D), abre por grupo; senão, só o %.
function parcelasDosEncargos(p: Premissas, salarios: number): Componente[] | undefined {
  const padrao = calcularEncargos(ENCARGOS_PADRAO);
  if (Math.abs(p.pessoal.encargosPct - padrao.total) > 0.00005) return undefined;
  // O estudo guarda o % arredondado em 4 casas: os grupos se ajustam a ele
  // para somarem exatamente a linha de encargos.
  const ajuste = p.pessoal.encargosPct / padrao.total;
  return padrao.grupos.map((g) => ({
    rotulo: `${g.grupo} — ${g.rotulo}`,
    valor: salarios * g.total * ajuste,
    memo: `${pct(g.total)}: ${g.itens.map((i) => `${i.rotulo} ${pct(i.pct)}`).join(" · ")}`,
  }));
}

// Separa um ou mais itens (somados). Sem itens, tudo zero. Com a entrada, os
// salários e os encargos saem abertos em parcelas.
export function separarMaoDeObraEVeiculo(
  itens: ComposicaoItem[],
  p: Premissas,
  entrada?: Pick<EntradaSimulacao, "itens" | "rotas" | "premissas">
): Separacao {
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
      {
        ...mensal("Salários (com horas extras e adicional noturno)", (i) => i.salarios),
        sub: entrada ? parcelasDosSalarios(entrada, new Set(itens.map((i) => i.item))).map((c) => ({ ...c, valor: c.valor * meses })) : undefined,
      },
      {
        ...mensal("Encargos sociais", (i) => i.encargos),
        memo: `${pct(p.pessoal.encargosPct)} dos salários`,
        sub: parcelasDosEncargos(p, soma((i) => i.salarios) * meses),
      },
      {
        ...mensal("Benefícios, uniforme e exames", (i) => i.beneficios),
        memo: `${qtd(pessoas)} pessoa${pessoas === 1 ? "" : "s"} × (${brl(p.pessoal.beneficiosPorFuncionario)} de benefícios + ${brl(p.pessoal.uniformeEpiPorFuncionario)} de uniforme, EPI e exames)`,
      },
      { ...mensal("Supervisão local", (i) => i.supervisao), memo: `${brl(p.pessoal.supervisaoMes)} por mês no contrato, rateado pelo km` },
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
    administracaoPct: p.indiretos.administracaoPct,
    contingenciaPct: p.indiretos.contingenciaPct,
    maoDeObra: partes[0],
    veiculo,
    pessoas,
    custoTotal,
    faturamento,
    kmUtil,
    veiculoMes,
  };
}
