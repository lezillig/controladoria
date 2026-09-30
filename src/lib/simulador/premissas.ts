import { CATEGORIA_DO_TIPO, tipoDe, type CategoriaVeiculo, type PerfilVeiculo, type Premissas, type TipoVeiculo, type VarianteVeiculo } from "./tipos";
import { calcularEncargos, ENCARGOS_PADRAO } from "./maoDeObra";
import { CHAVE_PRECO_ENERGIA, CONSUMO_ELETRICO_PADRAO, energiaDoPerfil, energiaDoTexto, PRECO_ENERGIA_PADRAO } from "./energia";
import type { BaseVigente } from "./baseDeCustos";
import { normalizarPct, todosOsNumeros } from "./catalogo";
import { ADICIONAL_NOTURNO_PADRAO, CSLL_LOCACAO_PADRAO, IRPJ_LOCACAO_PADRAO } from "./motor";

// AS PREMISSAS — descrição, padrão e montagem a partir da base de custos.
//
// Uma simulação nova parte da BASE VIGENTE (os números reais da Azul, vindos
// do Gabarito) e, onde a base ainda não tem o dado, do PADRÃO — marcado como
// estimativa. Cada premissa carrega a origem, e a tela mostra qual número é
// dado da empresa e qual é chute. Depois disso a pessoa ajusta o que o estudo
// pede (utilização, km morto, base local, telemetria do edital) e a versão
// salva congela tudo.

export type TipoCampo = "moeda" | "pct" | "numero" | "bool" | "modo" | "metodoDepreciacao";

export type CampoPremissa = {
  caminho: string; // "grupo.campo"
  grupo: "contrato" | "pessoal" | "veiculo" | "variaveis" | "indiretos" | "preco";
  rotulo: string;
  unidade: string;
  tipo: TipoCampo;
  ajuda?: string;
};

export const ROTULO_GRUPO: Record<CampoPremissa["grupo"], string> = {
  contrato: "Contrato e operação",
  pessoal: "Mão de obra",
  veiculo: "Veículo (custo fixo mensal por veículo)",
  variaveis: "Custos variáveis (por km rodado)",
  indiretos: "Indiretos",
  preco: "Tributos, financeiro e lucro",
};

const c = (caminho: string, rotulo: string, unidade: string, tipo: TipoCampo, ajuda?: string): CampoPremissa => ({
  caminho,
  grupo: caminho.split(".")[0] as CampoPremissa["grupo"],
  rotulo,
  unidade,
  tipo,
  ajuda,
});

export const CAMPOS_PREMISSAS: CampoPremissa[] = [
  c("contrato.modo", "Apuração", "", "modo", "MENSAL: contrato por demanda, km/mês × utilização. PERIODO: escolar, km do período e custo fixo por N meses."),
  c("contrato.mesesCustoFixo", "Meses de custo fixo por apuração", "meses", "numero", "1 no mensal; 12 no escolar anual (a equipe custa também nas férias)."),
  c("contrato.vigenciaMeses", "Vigência", "meses", "numero"),
  c("contrato.utilizacao", "Utilização do km de referência", "%", "pct", "Fração do km máximo que será de fato paga. 100% quando o km é fixo."),
  c("contrato.kmMortoPct", "Km improdutivo", "% do km pago", "pct", "Garagem ↔ ponto inicial, retornos vazios."),
  c("contrato.reservaTecnicaPct", "Reserva técnica de frota", "% da frota", "pct"),
  c("contrato.implantacaoTotal", "Implantação / montagem de base", "R$ (uma vez)", "moeda", "Amortizada na vigência e rateada entre os itens pelo km."),
  c("pessoal.salarioMotorista", "Salário base — motorista", "R$/mês", "moeda"),
  c("pessoal.salarioMonitora", "Salário base — monitor(a)", "R$/mês", "moeda"),
  c("pessoal.horaExtraPct", "Horas extras médias", "% do salário", "pct"),
  c("pessoal.encargosPct", "Encargos e provisões", "% do salário", "pct"),
  c("pessoal.fatorJornadaNoturna", "Fator de jornada noturna", "×", "numero", "Multiplica o salário do motorista nas rotas marcadas como noturnas — cobre jornada estendida e noturno de forma agregada. As horas noturnas em horas valem para todas as rotas: não cubra o mesmo adicional pelos dois."),
  c("pessoal.divisorHorasMes", "Divisor de horas do mês", "h", "numero", "Base do valor da hora: salário ÷ divisor (220 na jornada de 44 h)."),
  c("pessoal.horasExtras50Mes", "Horas extras a 50%", "h/mês por motorista", "numero"),
  c("pessoal.horasExtras100Mes", "Horas extras a 100%", "h/mês por motorista", "numero"),
  c("pessoal.horasNoturnasMes", "Horas noturnas na jornada (22h–5h)", "h/mês por motorista", "numero", "Horas de relógio da jornada normal entre 22h e 5h. O salário já as paga: entra só o adicional noturno, com a hora reduzida de 52′30″ — (1 + adicional) × 60 ÷ 52,5 − 1 do valor da hora (37,1% com 20%). Hora noturna ALÉM da jornada é hora extra."),
  c("pessoal.adicionalNoturnoPct", "Adicional noturno", "% da hora", "pct", "CLT, art. 73: ao menos 20%. Há CCT com 25% (RP/Franca). Não use junto com o fator de jornada noturna para cobrir o mesmo adicional nas mesmas rotas."),
  c("pessoal.beneficiosPorFuncionario", "Benefícios (VR/VA, cesta, VT, plano, seguro)", "R$/mês por pessoa", "moeda"),
  c("pessoal.uniformeEpiPorFuncionario", "Uniforme, EPI, exames e cursos", "R$/mês por pessoa", "moeda"),
  c("pessoal.supervisaoMes", "Preposto / supervisão local", "R$/mês (total)", "moeda", "Rateado entre os itens pelo km."),
  c("veiculo.valor", "Valor do veículo", "R$", "moeda", "FIPE ou valor contábil."),
  c("veiculo.depreciacaoAa", "Depreciação", "% a.a.", "pct"),
  c("veiculo.custoCapitalAa", "Custo de capital / financiamento", "% a.a.", "pct"),
  c("veiculo.seguroMes", "Seguro (casco + RCF)", "R$/mês", "moeda"),
  c("veiculo.ipvaLicenciamentoAno", "IPVA + licenciamento", "R$/ano", "moeda"),
  c("veiculo.laudoVistoriaAno", "Laudos, vistorias, licenças de operação", "R$/ano", "moeda"),
  c("veiculo.rastreadorMes", "Rastreador", "R$/mês", "moeda"),
  c("veiculo.telemetriaExtraMes", "Telemetria exigida pelo contrato", "R$/mês", "moeda"),
  c("veiculo.controleEmbarqueMes", "Controle de embarque", "R$/mês", "moeda"),
  c("veiculo.higienizacaoMes", "Higienização", "R$/mês", "moeda", "Só sobre a frota operacional."),
  c("veiculo.acessibilidadeMes", "Acessibilidade / identificação visual", "R$/mês", "moeda", "Só sobre a frota operacional."),
  c("veiculo.garagemMes", "Garagem / base local", "R$/mês por veículo", "moeda"),
  c("veiculo.garagemComReserva", "Garagem cobra também a reserva", "", "bool"),
  c("veiculo.adaptacaoValor", "Adaptações (elevador, ar, divisória)", "R$ por veículo", "moeda"),
  c("veiculo.adaptacaoMesesDepreciacao", "Prazo de depreciação das adaptações", "meses", "numero"),
  c("veiculo.manutencaoFixaPctMes", "Manutenção fixa", "% do valor ao mês", "pct", "Método de locação; soma-se à manutenção por km."),
  c("veiculo.metodoDepreciacao", "Método de depreciação", "", "metodoDepreciacao", "Percentual ao ano sobre o valor; linear com valor residual; ou soma dos dígitos (Cole, método GEIPOT), que deprecia mais nos primeiros anos."),
  c("veiculo.vidaUtilAnos", "Vida útil", "anos", "numero", "Linear e soma dos dígitos."),
  c("veiculo.valorResidualPct", "Valor residual ao fim da vida útil", "% do valor", "pct"),
  c("veiculo.idadeInicialAnos", "Idade do veículo no início do contrato", "anos", "numero", "Com o valor de aquisição do veículo novo em 'Valor do veículo'."),
  c("veiculo.capitalComposto", "Capital composto (financiado + próprio)", "", "bool", "Com ele, o custo do capital é a média ponderada da taxa do financiamento e do custo de oportunidade do capital próprio."),
  c("veiculo.fracaoFinanciada", "Fração financiada", "% do valor", "pct"),
  c("veiculo.taxaFinanciamentoAa", "Taxa do financiamento (CDC, leasing, FINAME)", "% a.a.", "pct"),
  c("veiculo.custoCapitalProprioAa", "Custo de oportunidade do capital próprio", "% a.a.", "pct", "O que o dinheiro renderia fora da frota — CDI, Selic ou a taxa mínima de atratividade da empresa."),
  c("veiculo.remuneracaoSobreValorMedio", "Remunerar só o valor não depreciado", "", "bool", "Como o GEIPOT: o capital rende sobre o valor médio do veículo no contrato, e não sobre o valor cheio."),
  c("variaveis.dieselLitro", "Combustível / energia", "R$ por litro (ou kWh no elétrico)", "moeda"),
  c("variaveis.consumoAsfaltoKmL", "Consumo em asfalto", "km por litro (ou kWh)", "numero"),
  c("variaveis.consumoTerraKmL", "Consumo em terra", "km por litro (ou kWh)", "numero"),
  c("variaveis.arlaKm", "ARLA 32", "R$/km", "moeda"),
  c("variaveis.oleoLavagemKm", "Óleo, filtros, lavagem", "R$/km", "moeda"),
  c("variaveis.pneusAsfaltoKm", "Pneus — asfalto", "R$/km", "moeda"),
  c("variaveis.pneusTerraKm", "Pneus — terra", "R$/km", "moeda"),
  c("variaveis.manutencaoAsfaltoKm", "Manutenção — asfalto", "R$/km", "moeda"),
  c("variaveis.manutencaoTerraKm", "Manutenção — terra", "R$/km", "moeda"),
  c("indiretos.administracaoPct", "Administração central", "% do custo direto", "pct"),
  c("indiretos.contingenciaPct", "Contingência / risco", "% do custo direto", "pct"),
  c("preco.lucroAlvoPct", "Lucro líquido alvo", "% do preço", "pct"),
  c("preco.pis", "PIS", "% do faturamento", "pct"),
  c("preco.cofins", "COFINS", "% do faturamento", "pct"),
  c("preco.irpj", "IRPJ", "% do faturamento", "pct", "Presumido do transporte de passageiros: 15% sobre a presunção de 16% = 2,4% (+ adicional de 10% sobre o lucro presumido acima de R$ 20 mil/mês). 8% de presunção é só de cargas."),
  c("preco.csll", "CSLL", "% do faturamento", "pct", "Presumido: 9% sobre a presunção de 12% = 1,08%."),
  c("preco.iss", "ISS (transporte municipal)", "% do faturamento municipal", "pct", "Não incide nos itens sem motorista: locação de bem móvel não é serviço (Súmula Vinculante 31)."),
  c("preco.icms", "ICMS (transporte intermunicipal)", "% do faturamento intermunicipal", "pct", "Não incide nos itens sem motorista (locação, não transporte)."),
  c("preco.irpjLocacao", "IRPJ — locação sem motorista (Presumido)", "% do faturamento", "pct", "Locação de bens móveis presume 32%: 15% × 32% = 4,8% da receita (+ adicional de 10% acima de R$ 20 mil/mês de lucro presumido). Só nos itens sem motorista e só no Presumido; no Real, vale o IR sobre o lucro."),
  c("preco.csllLocacao", "CSLL — locação sem motorista (Presumido)", "% do faturamento", "pct", "9% × 32% = 2,88% da receita. Só nos itens sem motorista e só no Presumido."),
  c("preco.custoCapitalGiroAm", "Custo do capital de giro", "% a.m.", "pct"),
  c("preco.prazoRecebimentoDias", "Prazo de recebimento", "dias", "numero"),
  c("preco.despesasSobrePrecoPct", "Despesas sobre o preço (adm. do contrato, comissão)", "% do preço", "pct"),
  c("preco.irpjCsllSobreLucroPct", "IRPJ + CSLL sobre o lucro (Lucro Real)", "% do lucro", "pct", "No Lucro Real: 34% (15% + 10% adicional + 9%), sobre o lucro fiscal — o lucro antes do IR somado à remuneração do capital próprio e à contingência, que o fisco não deduz. No Presumido, zero — e IRPJ/CSLL entram acima como % do faturamento."),
  c("preco.creditoPisCofinsPct", "Crédito de PIS/COFINS não cumulativo", "% dos custos com crédito", "pct", "Transporte de passageiros (fretamento incluído) fica no PIS/COFINS cumulativo de 3,65% SEM crédito mesmo no Lucro Real (SC Cosit 50/2026). Só a locação sem motorista no Real é não cumulativa: 9,25% com crédito sobre combustível, peças, pneus, depreciação e garagem."),
];

export function lerCaminho(p: Premissas, caminho: string): unknown {
  const [g, k] = caminho.split(".");
  return (p as unknown as Record<string, Record<string, unknown>>)[g][k];
}

export function escreverCaminho(p: Premissas, caminho: string, valor: unknown): void {
  const [g, k] = caminho.split(".");
  (p as unknown as Record<string, Record<string, unknown>>)[g][k] = valor;
}

// O PADRÃO — os exemplos do próprio Gabarito (coluna "Exemplo" e linha 6),
// para uma van em fretamento contínuo. É estimativa e aparece como tal.
export const FONTE_PADRAO = "padrão do simulador (exemplos do Gabarito — estimativa)";

export const PREMISSAS_PADRAO: Premissas = {
  contrato: { modo: "MENSAL", mesesCustoFixo: 1, vigenciaMeses: 12, utilizacao: 0.85, kmMortoPct: 0.12, reservaTecnicaPct: 0.1, implantacaoTotal: 0 },
  pessoal: {
    salarioMotorista: 3450,
    salarioMonitora: 1900,
    horaExtraPct: 0.14,
    // Os grupos A a D da calculadora (maoDeObra.ts) no modo em que as férias
    // ficam no fator de utilização — o 1,2 motorista por veículo dos tipos
    // padrão já cobre folgas e férias. Os 68% antigos somavam as férias de
    // novo (~5,5 p.p. em dobro).
    encargosPct: Number(calcularEncargos(ENCARGOS_PADRAO).total.toFixed(4)),
    fatorJornadaNoturna: 1,
    divisorHorasMes: 220,
    horasExtras50Mes: 0,
    horasExtras100Mes: 0,
    horasNoturnasMes: 0,
    adicionalNoturnoPct: ADICIONAL_NOTURNO_PADRAO,
    beneficiosPorFuncionario: 1072,
    uniformeEpiPorFuncionario: 100,
    supervisaoMes: 0,
  },
  veiculo: {
    valor: 285000,
    // (1 − 10% de revenda) ÷ 6 anos até a venda = 15% a.a.
    depreciacaoAa: (1 - 0.1) / 6,
    custoCapitalAa: 0.18,
    seguroMes: 650,
    ipvaLicenciamentoAno: 3900,
    laudoVistoriaAno: 1800,
    rastreadorMes: 95,
    telemetriaExtraMes: 0,
    controleEmbarqueMes: 0,
    higienizacaoMes: 0,
    acessibilidadeMes: 0,
    garagemMes: 0,
    garagemComReserva: true,
    adaptacaoValor: 0,
    adaptacaoMesesDepreciacao: 60,
    manutencaoFixaPctMes: 0,
    metodoDepreciacao: "PERCENTUAL",
    vidaUtilAnos: 8,
    valorResidualPct: 0.2,
    idadeInicialAnos: 0,
    capitalComposto: false,
    fracaoFinanciada: 0.8,
    taxaFinanciamentoAa: 0.18,
    custoCapitalProprioAa: 0.12,
    remuneracaoSobreValorMedio: false,
  },
  variaveis: {
    dieselLitro: 6.15,
    consumoAsfaltoKmL: 8.7,
    consumoTerraKmL: 7.2,
    arlaKm: 0.03,
    oleoLavagemKm: 0.06,
    pneusAsfaltoKm: 0.115,
    pneusTerraKm: 0.16,
    manutencaoAsfaltoKm: 0.42,
    manutencaoTerraKm: 0.59,
  },
  indiretos: { administracaoPct: 0.07, contingenciaPct: 0.03 },
  preco: {
    lucroAlvoPct: 0.12,
    pis: 0.0065,
    cofins: 0.03,
    // Lucro Presumido do TRANSPORTE DE PASSAGEIROS: presunção de 16% para o
    // IRPJ (8% é só de cargas) e 12% para a CSLL. O IRPJ inclui o ADICIONAL
    // de 10% (lucro presumido acima de R$ 20 mil/mês, receita acima de
    // ~R$ 125 mil/mês — toda empresa que disputa estes contratos): 16% × 25%
    // = 4% da receita na margem. CSLL: 12% × 9% = 1,08%. Ver PESQUISA.md, 5.
    irpj: 0.04,
    csll: 0.0108,
    iss: 0.05,
    icms: 0.12,
    custoCapitalGiroAm: 0.018,
    prazoRecebimentoDias: 55,
    despesasSobrePrecoPct: 0,
    irpjCsllSobreLucroPct: 0,
    creditoPisCofinsPct: 0,
    irpjLocacao: IRPJ_LOCACAO_PADRAO,
    csllLocacao: CSLL_LOCACAO_PADRAO,
  },
};

// REAL: medido nos custos da própria empresa (DRE da Omie, cartão de frota,
// cadastro da gestão) — ver custosReais.ts. Difere de BASE, que é o número
// que alguém escreveu no Gabarito: REAL é o que o caixa e o cartão registraram.
// A `fonte` diz qual indicador e o `detalhe`, a conta com os números.
export type OrigemPremissa = { origem: "BASE" | "PADRAO" | "AJUSTE" | "HISTORICO" | "REAL"; fonte: string; detalhe?: string };
export type MapaOrigem = Record<string, OrigemPremissa>;

export type EscolhasDaBase = {
  veiculoId?: string | null;
  motoristaId?: string | null;
  monitoraId?: string | null;
  // Prazo de recebimento: órgão público ou empresa.
  clientePublico: boolean;
  // Contrato escolar: meses de custo fixo e monitoras vêm das regras escolares.
  escolar: boolean;
  // Operação longe da sede: garagem e preposto locais da base.
  baseLocal: boolean;
};

// MONTAR AS PREMISSAS A PARTIR DA BASE VIGENTE.
//
// Cada premissa que a base cobre vem dela, com a fonte do registro; a que não
// cobre fica com o padrão. Nada é inventado a partir de nada: se o Gabarito
// não tem consumo em terra, o consumo em terra é o padrão, e a tela diz isso.
export function premissasDaBase(base: BaseVigente | null, escolhas: EscolhasDaBase, padrao: Premissas = PREMISSAS_PADRAO): { premissas: Premissas; origem: MapaOrigem } {
  const premissas: Premissas = structuredClone(padrao);
  const origem: MapaOrigem = {};
  for (const campo of CAMPOS_PREMISSAS) origem[campo.caminho] = { origem: "PADRAO", fonte: FONTE_PADRAO };
  if (!base) return { premissas, origem };

  const definir = (caminho: string, valor: number | boolean | null | undefined, fonte: string, detalhe?: string) => {
    if (valor === null || valor === undefined || (typeof valor === "number" && !Number.isFinite(valor))) return;
    escreverCaminho(premissas, caminho, valor);
    origem[caminho] = { origem: "BASE", fonte, detalhe };
  };
  const param = (chave: string) => base.parametros.get(chave);
  const numeroDe = (chave: string) => param(chave)?.valor ?? null;
  const fonteDe = (chave: string) => param(chave)?.fonte ?? "base de custos";
  const deParam = (caminho: string, chave: string, transformar: (n: number) => number = (n) => n) => {
    const v = numeroDe(chave);
    if (v !== null) definir(caminho, transformar(v), fonteDe(chave), chave);
  };

  // Regras da Azul, jornada, insumos, tributos e financeiro.
  deParam("contrato.kmMortoPct", "km_morto_pct");
  deParam("contrato.utilizacao", "utilizacao_srp");
  if (escolhas.escolar) {
    deParam("contrato.mesesCustoFixo", "meses_custo_fixo_escolar");
  }
  deParam("indiretos.contingenciaPct", "contingencia_pct");
  deParam("preco.lucroAlvoPct", "margem_alvo");
  deParam("pessoal.adicionalNoturnoPct", "noturno_pct");
  deParam("variaveis.dieselLitro", "diesel_rs_l");
  deParam("variaveis.oleoLavagemKm", "oleo_rs_km");
  deParam("preco.pis", "pis");
  deParam("preco.cofins", "cofins");
  deParam("preco.irpj", "irpj");
  deParam("preco.csll", "csll");
  deParam("preco.iss", "iss_sp");
  deParam("preco.icms", "icms_sp");
  deParam("preco.custoCapitalGiroAm", "capital_giro_am");
  // Garantia contratual (art. 96 da Lei 14.133): custo proporcional ao valor
  // do contrato, então entra como despesa sobre o preço.
  deParam("preco.despesasSobrePrecoPct", "seguro_garantia_pct");
  deParam("preco.prazoRecebimentoDias", escolhas.clientePublico ? "prazo_prefeituras" : "prazo_empresas");
  if (escolhas.baseLocal) deParam("pessoal.supervisaoMes", "preposto_mes");

  // Administração central: o rateio REAL (indiretos ÷ faturamento médio)
  // quando a base tem os números; senão, o percentual padrão das regras.
  const indiretos = ["folha_adm", "contabilidade", "sistemas", "sede_garagem_sp", "oficina", "gerais"].map(numeroDe);
  const faturamento = numeroDe("faturamento_medio");
  if (faturamento && faturamento > 0 && indiretos.some((v) => v !== null)) {
    const total = indiretos.reduce<number>((a, v) => a + (v ?? 0), 0);
    // O rateio sai sobre o FATURAMENTO, mas o motor aplica a administração
    // sobre o CUSTO DIRETO. Com preço P = D·(1 + x)/d (d = divisor do preço:
    // 1 − lucro − tributos − giro − despesas), querer x·D = a·P dá
    // x = a/(d − a). Sem a conversão, 7% da receita virava 7% do custo.
    const a = total / faturamento;
    const pr = premissas.preco;
    const d = 1 - pr.lucroAlvoPct - pr.pis - pr.cofins - pr.irpj - pr.csll - Math.max(pr.iss, pr.icms) - (pr.custoCapitalGiroAm * pr.prazoRecebimentoDias) / 30 - pr.despesasSobrePrecoPct;
    const x = d > a ? a / (d - a) : a;
    definir("indiretos.administracaoPct", x, fonteDe("faturamento_medio"), `indiretos da aba 4 ÷ faturamento médio = ${(a * 100).toFixed(2)}% da receita, convertido para ${(x * 100).toFixed(2)}% do custo direto`);
  } else deParam("indiretos.administracaoPct", "adm_pct");

  // ARLA: "R$ 4,20; 4,5%" → R$/l × % do diesel ÷ km/l, quando há consumo.
  const arla = param("arla")?.texto;
  if (arla) {
    const [preco, pct] = todosOsNumeros(arla);
    if (preco && pct) {
      const consumo = premissas.variaveis.consumoAsfaltoKmL;
      definir("variaveis.arlaKm", (preco * normalizarPct(pct)) / consumo, fonteDe("arla"), `${arla} ÷ ${consumo} km/l`);
    }
  }

  // Reserva técnica: "10% / 10% / 15%" (van / micro / ônibus) → pela do tipo.
  const veiculo = base.veiculos.find((v) => v.id === escolhas.veiculoId) ?? null;
  const reservas = param("reserva_tecnica")?.texto;
  if (reservas && veiculo) {
    const [van, micro, onibus] = todosOsNumeros(reservas).map(normalizarPct);
    const tipo = String(veiculo.tipo ?? "").toLowerCase();
    const escolhida = tipo.includes("van") ? van : tipo.includes("micro") ? micro : tipo.includes("ônibus") || tipo.includes("onibus") ? onibus : undefined;
    if (escolhida !== undefined) definir("contrato.reservaTecnicaPct", escolhida, fonteDe("reserva_tecnica"), `${reservas} → ${veiculo.tipo}`);
  }

  // Veículo escolhido (aba 1).
  if (veiculo) {
    const f = `${veiculo.fonte} — ${veiculo.tipo} ${veiculo.modelo}`;
    const n = (k: string) => (typeof veiculo[k] === "number" ? (veiculo[k] as number) : null);
    definir("veiculo.valor", n("valorFipe") ?? n("valorCompra"), f);
    definir("veiculo.custoCapitalAa", n("taxaAa"), f);
    // Depreciação econômica: perde (1 − revenda) do valor até a idade de venda.
    const ano = n("ano");
    const idadeVenda = n("idadeVenda");
    const revenda = n("revendaPctFipe");
    if (idadeVenda && revenda !== null) {
      const idadeAtual = ano ? Math.max(0, base.em.getFullYear() - ano) : 0;
      const anosRestantes = Math.max(1, idadeVenda - idadeAtual);
      definir("veiculo.depreciacaoAa", (1 - revenda) / anosRestantes, f, `(1 − ${revenda}) ÷ ${anosRestantes} anos até a venda`);
    }
    definir("veiculo.seguroMes", n("seguroAnual") === null ? null : n("seguroAnual")! / 12, f);
    definir("veiculo.ipvaLicenciamentoAno", n("ipvaLicenciamentoAnual"), f);
    definir("veiculo.laudoVistoriaAno", n("licencasAnual"), f);
    definir("veiculo.rastreadorMes", n("rastreadorMensal"), f);
    definir("variaveis.consumoAsfaltoKmL", n("consumoKmL"), f);
    definir("variaveis.manutencaoAsfaltoKm", n("manutencaoKm"), f);
    const qtde = n("pneusQtde");
    const preco = n("pneuPreco");
    const vida = n("pneuVidaKm");
    if (qtde && preco && vida) definir("variaveis.pneusAsfaltoKm", (qtde * preco) / vida, f, `${qtde} × ${preco} ÷ ${vida} km`);
    definir("contrato.reservaTecnicaPct", n("reservaTecnicaPct"), f);
  }

  // Funções (aba 2).
  const funcao = (id?: string | null) => base.funcoes.find((x) => x.id === id) ?? null;
  const motorista = funcao(escolhas.motoristaId);
  if (motorista) {
    const f = `${motorista.fonte} — ${motorista.funcao}${motorista.regiao ? ` (${motorista.regiao})` : ""}`;
    const n = (k: string) => (typeof motorista[k] === "number" ? (motorista[k] as number) : 0);
    if (typeof motorista.salarioBase === "number") definir("pessoal.salarioMotorista", n("salarioBase") + n("adicionaisFixos"), f);
    if (typeof motorista.hePct === "number") definir("pessoal.horaExtraPct", n("hePct"), f);
    if (typeof motorista.encargosPct === "number") definir("pessoal.encargosPct", n("encargosPct"), f);
    definir("pessoal.beneficiosPorFuncionario", n("vrVa") + n("cesta") + n("valeTransporte") + n("planoSaude") + n("seguroVida"), f, "VR/VA + cesta + VT + plano + seguro de vida");
    definir("pessoal.uniformeEpiPorFuncionario", n("uniformeEpi") + n("examesCursos"), f, "uniforme/EPI + exames e cursos");
  }
  const monitora = funcao(escolhas.monitoraId);
  if (monitora && typeof monitora.salarioBase === "number") {
    definir("pessoal.salarioMonitora", monitora.salarioBase + (typeof monitora.adicionaisFixos === "number" ? monitora.adicionaisFixos : 0), `${monitora.fonte} — ${monitora.funcao}`);
  }

  return { premissas, origem };
}

// Validação mínima antes de rodar: o que o motor não consegue dividir.
export function problemasNasPremissas(p: Premissas): string[] {
  const problemas: string[] = [];
  // O divisor como o motor o usa: o lucro alvo entra como α ÷ (1 − IR sobre o
  // lucro). Com α sozinho, o Lucro Real passava aqui com divisor negativo no
  // motor e o preço saía negativo (−R$ 253,67/km em SJP com Real e lucro alvo
  // de 60%).
  const pr = p.preco;
  const ir = pr.irpjCsllSobreLucroPct;
  if (ir < 0 || ir >= 1) problemas.push("IRPJ + CSLL sobre o lucro precisa ficar entre 0% e 100%.");
  const lucroNoDivisor = ir >= 0 && ir < 1 ? pr.lucroAlvoPct / (1 - ir) : pr.lucroAlvoPct;
  const divisor = 1 - lucroNoDivisor - pr.pis - pr.cofins - pr.irpj - pr.csll - Math.max(pr.iss, pr.icms) - (pr.custoCapitalGiroAm * pr.prazoRecebimentoDias) / 30 - pr.despesasSobrePrecoPct;
  if (divisor <= 0.05) problemas.push("Lucro, tributos e despesas sobre o preço somam 95% ou mais — o preço não fecha.");
  if (p.variaveis.consumoAsfaltoKmL <= 0) problemas.push("Consumo em asfalto precisa ser maior que zero.");
  // Os tipos de veículo têm consumo próprio: zero ali não quebrava a conta
  // (o motor divide com proteção) — zerava o combustível das rotas do tipo.
  const semConsumo = (p.perfis ?? []).find((x) => !(x.variaveis.consumoAsfaltoKmL > 0));
  if (semConsumo) problemas.push(`Consumo em asfalto do tipo "${semConsumo.descricao}" precisa ser maior que zero.`);
  if (p.contrato.utilizacao <= 0 || p.contrato.utilizacao > 1.5) problemas.push("Utilização fora da faixa (0 a 150%).");
  if (p.contrato.mesesCustoFixo <= 0) problemas.push("Meses de custo fixo precisa ser ao menos 1.");
  if (p.contrato.vigenciaMeses <= 0) problemas.push("Vigência precisa ser ao menos 1 mês.");
  return problemas;
}

// PERFIS PADRÃO POR TIPO DE VEÍCULO — o ponto de partida quando a base de
// custos ainda não tem o modelo. ESTIMATIVAS de mercado (set/2026), marcadas
// como tal; a van usa os exemplos do Gabarito, os demais seguem a mesma lógica
// e as planilhas de referência (ônibus de Holambra). Salário por categoria de
// CNH: carro (B), van e micro (D), ônibus (D, faixa de ônibus da convenção).
function perfil(
  codigo: string,
  tipo: TipoVeiculo,
  descricao: string,
  lotacao: number,
  cnh: string,
  salario: number,
  motoristasPorVeiculo: number,
  v: Partial<Premissas["veiculo"]>,
  x: Partial<Premissas["variaveis"]>
): PerfilVeiculo {
  return {
    codigo,
    tipo,
    descricao,
    lotacao,
    categoriaCnh: cnh,
    motorista: { salario, motoristasPorVeiculo },
    veiculo: { ...PREMISSAS_PADRAO.veiculo, ...v },
    variaveis: { ...PREMISSAS_PADRAO.variaveis, ...x },
  };
}

const PERFIS_BASE: PerfilVeiculo[] = [
  perfil("CARRO", "CARRO", "Carro executivo (sedã/SUV)", 4, "B", 2400, 1.2,
    { valor: 140000, seguroMes: 350, ipvaLicenciamentoAno: 5200, laudoVistoriaAno: 300, rastreadorMes: 80 },
    { dieselLitro: 6.3, consumoAsfaltoKmL: 11, consumoTerraKmL: 9, arlaKm: 0, pneusAsfaltoKm: 0.05, pneusTerraKm: 0.07, manutencaoAsfaltoKm: 0.18, manutencaoTerraKm: 0.25 }),
  perfil("VAN", "VAN", "Van 15–19 lugares", 19, "D", 2950, 1.2, {}, {}),
  perfil("MICRO", "MICRO", "Micro-ônibus 25–33 lugares", 30, "D", 3150, 1.2,
    { valor: 420000, seguroMes: 850, ipvaLicenciamentoAno: 4500, laudoVistoriaAno: 1800, rastreadorMes: 95 },
    { consumoAsfaltoKmL: 4.7, consumoTerraKmL: 3.9, arlaKm: 0.05, pneusAsfaltoKm: 0.18, pneusTerraKm: 0.25, manutencaoAsfaltoKm: 0.7, manutencaoTerraKm: 1.0 }),
  perfil("ONIBUS", "ONIBUS", "Ônibus 44–59 lugares (usado, ~8 anos)", 50, "D", 3200, 1.2,
    { valor: 280000, depreciacaoAa: 0.12, custoCapitalAa: 0.14, seguroMes: 1100, ipvaLicenciamentoAno: 4200, laudoVistoriaAno: 900, rastreadorMes: 90 },
    { dieselLitro: 6.2, consumoAsfaltoKmL: 2.9, consumoTerraKmL: 2.4, arlaKm: 0.07, oleoLavagemKm: 0.09, pneusAsfaltoKm: 0.24, pneusTerraKm: 0.34, manutencaoAsfaltoKm: 0.95, manutencaoTerraKm: 1.35 }),
]

// Carro roda a gasolina; van, micro e ônibus, a diesel. Elétrico se escolhe
// no tipo de veículo do estudo (aba Veículos) ou pela frota da base.
for (const p of PERFIS_BASE) p.energia = p.tipo === "CARRO" ? "GASOLINA" : "DIESEL";

// ADAPTADOS (acessibilidade): o veículo da categoria com elevador ou rampa,
// ancoragem de cadeira de rodas e cinto de 4 pontos (NBR 14022), depreciados
// na vigência como adaptação; manutenção e certificação do equipamento por
// mês; menos lugares, porque cada cadeira ocupa o espaço de 3 a 4 bancos.
// UNIDADES MÓVEIS: o veículo implementado como consultório, posto de
// atendimento ou laboratório. A implementação (carroceria, climatização,
// gerador, mobiliário) entra como adaptação; limpeza técnica e manutenção dos
// sistemas por mês. Não leva passageiros; acima de 3,5 t a CNH é C.
// Todos ESTIMATIVAS de mercado (set/2026) — ajuste em Custos base.
function variante(
  categoria: CategoriaVeiculo,
  tipo: TipoVeiculo,
  descricao: string,
  lotacao: number | null,
  cnh: string,
  v: Partial<Premissas["veiculo"]>,
  x: Partial<Premissas["variaveis"]> = {}
): PerfilVeiculo {
  const base = PERFIS_BASE.find((p) => p.tipo === categoria)!;
  return {
    ...structuredClone(base),
    codigo: tipo,
    tipo,
    descricao,
    lotacao,
    categoriaCnh: cnh,
    veiculo: { ...base.veiculo, adaptacaoMesesDepreciacao: 60, ...v },
    variaveis: { ...base.variaveis, ...x },
  };
}

export const PERFIS_PADRAO: PerfilVeiculo[] = [
  ...PERFIS_BASE,
  variante("CARRO", "CARRO_ADAPTADO", "Carro adaptado (rampa, 1 cadeira de rodas)", 3, "B", { valor: 150000, adaptacaoValor: 40000, acessibilidadeMes: 150 }),
  variante("VAN", "VAN_ADAPTADA", "Van adaptada (elevador, 2 cadeiras de rodas)", 12, "D", { adaptacaoValor: 60000, acessibilidadeMes: 300 }),
  variante("MICRO", "MICRO_ADAPTADO", "Micro-ônibus adaptado (elevador)", 24, "D", { adaptacaoValor: 70000, acessibilidadeMes: 350 }),
  variante("ONIBUS", "ONIBUS_ADAPTADO", "Ônibus adaptado (elevador)", 44, "D", { adaptacaoValor: 80000, acessibilidadeMes: 400 }),
  variante("VAN", "VAN_UNIDADE_MOVEL", "Van unidade móvel (consultório/atendimento)", null, "B", { adaptacaoValor: 180000, higienizacaoMes: 450, manutencaoFixaPctMes: 0.002 }, { consumoAsfaltoKmL: 7.5 }),
  variante("MICRO", "MICRO_UNIDADE_MOVEL", "Micro-ônibus unidade móvel (consultório/atendimento)", null, "C", { adaptacaoValor: 300000, higienizacaoMes: 600, manutencaoFixaPctMes: 0.002 }, { consumoAsfaltoKmL: 4.2 }),
  variante("ONIBUS", "ONIBUS_UNIDADE_MOVEL", "Ônibus unidade móvel (consultório/atendimento)", null, "C", { adaptacaoValor: 500000, higienizacaoMes: 800, manutencaoFixaPctMes: 0.002 }, { consumoAsfaltoKmL: 2.6 }),
];


export function tipoDoTexto(texto: string | null | undefined): TipoVeiculo | null {
  const t = (texto ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const categoria: CategoriaVeiculo | null = /micro/.test(t)
    ? "MICRO"
    : /onibus|rodoviario|urbano/.test(t)
      ? "ONIBUS"
      : /\bvan\b|minivan|sprinter|master|ducato/.test(t)
        ? "VAN"
        : /carro|executivo|leve|sedan|suv/.test(t)
          ? "CARRO"
          : null;
  if (!categoria) return null;
  const varianteDoTexto: VarianteVeiculo = /unid(ade)?\.? ?movel|clinica movel|consultorio movel/.test(t)
    ? "UNIDADE_MOVEL"
    : /adaptad|acessivel|\bpcd\b|elevador|cadeirante/.test(t)
      ? "ADAPTADO"
      : "PADRAO";
  return tipoDe(categoria, varianteDoTexto);
}

// PERFIS A PARTIR DA BASE: um perfil por modelo de veículo cadastrado (aba 1),
// com o salário da função de motorista do mesmo tipo (aba 2, "Motorista van",
// "Motorista ônibus"…) e os motoristas por veículo das regras de jornada. O
// que a base não tem vem do perfil padrão do tipo.
export function perfisDaBase(base: BaseVigente | null): PerfilVeiculo[] {
  if (!base || base.veiculos.length === 0) return PERFIS_PADRAO.map((p) => structuredClone(p));
  const n = (r: Record<string, unknown>, k: string) => (typeof r[k] === "number" ? (r[k] as number) : null);
  const motoristasPorVeiculo = base.parametros.get("mot_fretamento_2p")?.valor ?? null;
  return base.veiculos.map((v, i) => {
    const tipo = tipoDoTexto(String(v.tipo ?? "")) ?? "VAN";
    const padrao = PERFIS_PADRAO.find((p) => p.tipo === tipo)!;
    const energia = energiaDoTexto(String(v.combustivel ?? "")) ?? energiaDoPerfil(padrao);
    // Salário: a função do mesmo tipo ("Motorista de van adaptada"); sem ela,
    // a da mesma categoria ("Motorista de van").
    const motoristas = base.funcoes.filter((f) => /motorista/i.test(String(f.funcao ?? "")));
    const funcao =
      motoristas.find((f) => tipoDoTexto(String(f.funcao)) === tipo) ??
      motoristas.find((f) => {
        const t = tipoDoTexto(String(f.funcao));
        return t !== null && CATEGORIA_DO_TIPO[t] === CATEGORIA_DO_TIPO[tipo];
      });
    const salario = funcao && typeof funcao.salarioBase === "number" ? funcao.salarioBase + (n(funcao, "adicionaisFixos") ?? 0) : padrao.motorista.salario;
    const vidaVenda = n(v, "idadeVenda");
    const revenda = n(v, "revendaPctFipe");
    const ano = n(v, "ano");
    const idade = ano ? Math.max(0, base.em.getFullYear() - ano) : 0;
    const qtde = n(v, "pneusQtde");
    const preco = n(v, "pneuPreco");
    const vidaPneu = n(v, "pneuVidaKm");
    return {
      codigo: `BASE-${i + 1}`,
      tipo,
      descricao: `${v.tipo ?? ""} ${v.modelo ?? ""}`.trim(),
      lotacao: n(v, "lotacao"),
      categoriaCnh: padrao.categoriaCnh ?? (tipo === "CARRO" ? "B" : "D"),
      motorista: { salario, motoristasPorVeiculo: motoristasPorVeiculo ?? padrao.motorista.motoristasPorVeiculo },
      veiculo: {
        ...padrao.veiculo,
        valor: n(v, "valorFipe") ?? n(v, "valorCompra") ?? padrao.veiculo.valor,
        custoCapitalAa: n(v, "taxaAa") ?? padrao.veiculo.custoCapitalAa,
        depreciacaoAa: vidaVenda && revenda !== null ? (1 - revenda) / Math.max(1, vidaVenda - idade) : padrao.veiculo.depreciacaoAa,
        seguroMes: n(v, "seguroAnual") !== null ? n(v, "seguroAnual")! / 12 : padrao.veiculo.seguroMes,
        ipvaLicenciamentoAno: n(v, "ipvaLicenciamentoAnual") ?? padrao.veiculo.ipvaLicenciamentoAno,
        laudoVistoriaAno: n(v, "licencasAnual") ?? padrao.veiculo.laudoVistoriaAno,
        rastreadorMes: n(v, "rastreadorMensal") ?? padrao.veiculo.rastreadorMes,
      },
      energia,
      variaveis: {
        ...padrao.variaveis,
        // Preço da energia do modelo (diesel, gasolina, etanol ou kWh), da
        // base quando houver; ARLA só no diesel.
        dieselLitro: base.parametros.get(CHAVE_PRECO_ENERGIA[energia])?.valor ?? (energia === energiaDoPerfil(padrao) ? padrao.variaveis.dieselLitro : PRECO_ENERGIA_PADRAO[energia]),
        arlaKm: energia === "DIESEL" ? padrao.variaveis.arlaKm : 0,
        consumoAsfaltoKmL: n(v, "consumoKmL") ?? (energia === "ELETRICO" && energiaDoPerfil(padrao) !== "ELETRICO" ? CONSUMO_ELETRICO_PADRAO[CATEGORIA_DO_TIPO[tipo]] : padrao.variaveis.consumoAsfaltoKmL),
        manutencaoAsfaltoKm: n(v, "manutencaoKm") ?? padrao.variaveis.manutencaoAsfaltoKm,
        pneusAsfaltoKm: qtde && preco && vidaPneu ? (qtde * preco) / vidaPneu : padrao.variaveis.pneusAsfaltoKm,
      },
    };
  });
}
