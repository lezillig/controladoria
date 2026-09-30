import { simular } from "./motor";
import { escreverCaminho, lerCaminho, type MapaOrigem } from "./premissas";
import type { EntradaSimulacao, Premissas, ResultadoSimulacao, UnidadePreco } from "./tipos";

// O PAINEL DE DECISÃO — o que a simulação diz a quem decide o lance.
//
// A composição de custo responde "quanto custa". Quem decide precisa de outra
// coisa: posso lançar? até onde posso descer? o que derruba este número? Este
// módulo responde as três, a partir da mesma função pura do motor — a faixa de
// lance é o motor rodado com outras margens, a sensibilidade é o motor rodado
// com cada premissa 10% pior. Nada aqui é estimado por fora da conta.
//
// As REGRAS DA AZUL (margem mínima e alvo) vêm da base de custos (aba 8 do
// Gabarito); sem elas, a margem mínima padrão é metade do alvo — e o painel
// diz que está usando o padrão.

export type Veredicto = "LANCAR" | "LANCAR_COM_RESSALVA" | "NAO_LANCAR";

export type Alerta = { nivel: "CRITICO" | "ATENCAO" | "INFO"; titulo: string; detalhe: string };

export type FaixaDeLance = {
  unidade: UnidadePreco;
  // Preço sem lucro nenhum: abaixo dele, cada unidade vendida dá prejuízo.
  piso: number;
  // Preço na margem mínima aceitável da empresa.
  margemMinima: number;
  // Preço na margem alvo — o de abertura.
  alvo: number;
  // Preço máximo do edital, quando houver e a unidade for km.
  teto: number | null;
  // Espaço de negociação entre o alvo e a margem mínima, na unidade.
  espacoNegociacao: number;
};

export type Sensibilidade = {
  caminho: string;
  rotulo: string;
  // Efeito no lucro da apuração de a premissa ficar 10% PIOR.
  efeitoLucro: number;
  // Em pontos de margem.
  efeitoMargem: number;
};

export type PainelDecisao = {
  veredicto: Veredicto;
  resumo: string;
  margem: number | null;
  margemMinima: number;
  margemAlvo: number;
  regrasDaBase: boolean;
  faixa: FaixaDeLance;
  // Utilização prevista menos a de equilíbrio (quando o equilíbrio é mínimo):
  // quanto o km pago pode cair antes do prejuízo.
  folgaUtilizacao: number | null;
  sensibilidade: Sensibilidade[];
  premissasEstimadas: { total: number; estimadas: number; principais: string[] };
  alertas: Alerta[];
};

// Premissas cuja piora de 10% é medida. "Pior" é para cima nos custos e para
// baixo no consumo e na utilização.
const SENSIVEIS: { caminho: string; rotulo: string; sentido: 1 | -1 }[] = [
  { caminho: "variaveis.dieselLitro", rotulo: "Preço do combustível", sentido: 1 },
  { caminho: "variaveis.consumoAsfaltoKmL", rotulo: "Consumo (km/l)", sentido: -1 },
  { caminho: "pessoal.salarioMotorista", rotulo: "Salário do motorista", sentido: 1 },
  { caminho: "pessoal.encargosPct", rotulo: "Encargos sociais", sentido: 1 },
  { caminho: "veiculo.valor", rotulo: "Valor do veículo", sentido: 1 },
  { caminho: "variaveis.manutencaoAsfaltoKm", rotulo: "Manutenção por km", sentido: 1 },
  { caminho: "contrato.kmMortoPct", rotulo: "Km improdutivo", sentido: 1 },
  { caminho: "contrato.utilizacao", rotulo: "Utilização do km", sentido: -1 },
];

const reais = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pctTexto = (v: number, casas = 1) => `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;

function comPremissa(entrada: EntradaSimulacao, mudar: (p: Premissas) => void): EntradaSimulacao {
  const premissas = structuredClone(entrada.premissas);
  mudar(premissas);
  return { ...entrada, premissas };
}

// Piora uma premissa no padrão E nos perfis de veículo que a repetem — senão
// "diesel 10% mais caro" não mexeria nas rotas de ônibus, que têm perfil.
export function piorar(p: Premissas, caminho: string, fator: number) {
  const atual = lerCaminho(p, caminho) as number;
  escreverCaminho(p, caminho, atual * fator);
  const [grupo, campo] = caminho.split(".");
  for (const perfil of p.perfis ?? []) {
    if (grupo === "veiculo") (perfil.veiculo as Record<string, unknown>)[campo] = (perfil.veiculo[campo as keyof Premissas["veiculo"]] as number) * fator;
    if (grupo === "variaveis") (perfil.variaveis as Record<string, unknown>)[campo] = (perfil.variaveis[campo as keyof Premissas["variaveis"]] as number) * fator;
    if (caminho === "pessoal.salarioMotorista") perfil.motorista.salario *= fator;
  }
}

// Preço proposto na unidade do contrato, para o conjunto (lote) ou a média
// ponderada dos itens.
export function precoDoConjunto(r: ResultadoSimulacao): number {
  if (r.lote) return r.lote.precoPropostaUnidade;
  const quantidade = r.itens.reduce((a, i) => a + i.quantidadeUnidade, 0);
  return quantidade > 0 ? r.itens.reduce((a, i) => a + i.precoUnidade * i.quantidadeUnidade, 0) / quantidade : 0;
}

export function montarPainel(
  entrada: EntradaSimulacao,
  resultado: ResultadoSimulacao,
  opcoes: { margemMinima?: number | null; margemAlvo?: number | null; origem?: MapaOrigem | null; inicioContrato?: Date } = {}
): PainelDecisao {
  const alvo = opcoes.margemAlvo ?? entrada.premissas.preco.lucroAlvoPct;
  const regrasDaBase = opcoes.margemMinima !== undefined && opcoes.margemMinima !== null;
  const minima = regrasDaBase ? (opcoes.margemMinima as number) : alvo / 2;
  const unidade = resultado.unidade;
  const alertas: Alerta[] = [];

  // FAIXA DE LANCE: o motor com lucro zero, com a margem mínima e com o alvo.
  const comLucro = (m: number) => simular(comPremissa(entrada, (p) => (p.preco.lucroAlvoPct = m)));
  const piso = precoDoConjunto(comLucro(0));
  const precoMinima = precoDoConjunto(comLucro(minima));
  const precoAlvo = precoDoConjunto(alvo === entrada.premissas.preco.lucroAlvoPct ? resultado : comLucro(alvo));
  const tetos = resultado.itens.map((i) => i.precoMaximoKm).filter((t): t is number => t !== null);
  const teto = unidade === "KM" && tetos.length > 0 ? Math.min(...tetos) : null;

  const margem = resultado.lote ? resultado.lote.margemAoPrecoProposta : resultado.totais.margem;

  // SENSIBILIDADE: cada premissa 10% pior, uma de cada vez, AO MESMO PREÇO —
  // a pergunta é quanto se perde se a premissa errar depois do lance.
  const lucroBase = resultado.lote ? resultado.lote.lucroAoPrecoProposta : resultado.totais.lucro;
  const precoFixo = precoDoConjunto(resultado);
  const lucroAoPreco = (e: EntradaSimulacao) =>
    simular({ ...e, precoTesteKm: precoFixo, utilizacoesCenario: [e.premissas.contrato.utilizacao] }).cenarios.linhas[0];
  const base = lucroAoPreco(entrada);
  const sensibilidade: Sensibilidade[] = [];
  for (const s of SENSIVEIS) {
    const atual = lerCaminho(entrada.premissas, s.caminho);
    if (typeof atual !== "number" || atual === 0) continue;
    const fator = 1 + 0.1 * s.sentido;
    const mudada = lucroAoPreco(comPremissa(entrada, (p) => piorar(p, s.caminho, fator)));
    sensibilidade.push({
      caminho: s.caminho,
      rotulo: s.rotulo,
      efeitoLucro: mudada.lucro - base.lucro,
      efeitoMargem: (mudada.margem ?? 0) - (base.margem ?? 0),
    });
  }
  sensibilidade.sort((a, b) => a.efeitoLucro - b.efeitoLucro);

  // UTILIZAÇÃO: com preço por km o equilíbrio é um piso de utilização.
  const eq = resultado.cenarios.pontoEquilibrio;
  const u = entrada.premissas.contrato.utilizacao;
  const folgaUtilizacao = eq !== null && resultado.cenarios.tipoEquilibrio === "MINIMA" ? u - eq : null;

  // PREMISSAS ESTIMADAS: o que ainda não é dado da empresa.
  const origem = opcoes.origem ?? {};
  const entradasOrigem = Object.entries(origem);
  const estimadas = entradasOrigem.filter(([, o]) => o.origem === "PADRAO" || o.origem === "HISTORICO");
  const pesoSensivel = new Set(sensibilidade.slice(0, 4).map((s) => s.caminho));
  const principaisEstimadas = estimadas.filter(([c]) => pesoSensivel.has(c)).map(([c]) => SENSIVEIS.find((s) => s.caminho === c)?.rotulo ?? c);

  // ALERTAS
  if (margem !== null && margem < 0) alertas.push({ nivel: "CRITICO", titulo: "Prejuízo no preço proposto", detalhe: `Margem de ${pctTexto(margem)} na utilização prevista.` });
  else if (margem !== null && margem < minima)
    alertas.push({ nivel: "CRITICO", titulo: "Margem abaixo da mínima", detalhe: `${pctTexto(margem)} contra a mínima de ${pctTexto(minima)}.` });
  for (const i of resultado.itens.filter((x) => x.acimaDoTeto))
    alertas.push({
      nivel: resultado.lote ? "ATENCAO" : "CRITICO",
      titulo: `Item ${i.item} acima do preço máximo`,
      detalhe: `${reais(i.precoKm)}/km isolado contra teto de ${reais(i.precoMaximoKm ?? 0)}/km${resultado.lote ? " — o lote compensa, mas o item sozinho seria desclassificado" : ""}.`,
    });
  if (teto !== null && precoMinima > teto)
    alertas.push({ nivel: "CRITICO", titulo: "Teto abaixo do preço de margem mínima", detalhe: `Para a margem mínima seria preciso ${reais(precoMinima)}; o teto é ${reais(teto)}.` });
  if (folgaUtilizacao !== null && folgaUtilizacao < 0.1)
    alertas.push({
      nivel: folgaUtilizacao < 0 ? "CRITICO" : "ATENCAO",
      titulo: "Pouca folga de utilização",
      detalhe: `O equilíbrio está em ${pctTexto(eq ?? 0, 0)} do km; a utilização prevista é ${pctTexto(u, 0)}. Uma queda de ${Math.max(0, Math.round(folgaUtilizacao * 100))} pontos zera o lucro.`,
    });
  if (resultado.cenarios.tipoEquilibrio === "MAXIMA" && eq !== null && eq < 1.2)
    alertas.push({ nivel: "ATENCAO", titulo: "Km acima do previsto vira prejuízo", detalhe: `Com preço fixo por ${unidade === "HORA" ? "hora" : unidade === "DIARIA" ? "diária" : "veículo"}, acima de ${pctTexto(eq, 0)} do km de referência o lucro some. Prever franquia de km e km excedente.` });
  if (principaisEstimadas.length > 0)
    alertas.push({
      nivel: "ATENCAO",
      titulo: "Premissas decisivas ainda estimadas",
      detalhe: `${principaisEstimadas.join(", ")} estão entre as que mais mexem no resultado e não vêm de dado da empresa. Conferir antes de lançar.`,
    });
  const pr = entrada.premissas.preco;
  if (pr.irpjCsllSobreLucroPct === 0 && pr.irpj > 0 && pr.irpj < 0.024 - 1e-9)
    alertas.push({
      nivel: "ATENCAO",
      titulo: "IRPJ na base presumida de cargas",
      detalhe: `IRPJ de ${pctTexto(pr.irpj, 2)} da receita corresponde à presunção de 8%, que é de transporte de cargas. Transporte de passageiros presume 16%: 2,4% da receita (+ adicional). O preço está subestimado em cerca de ${pctTexto(0.024 - pr.irpj, 2)} da receita.`,
    });
  // DEPRECIAÇÃO BAIXA para van e micro: vida útil real de 5 anos; abaixo de
  // 8% a.a. pelo método percentual o veículo não se paga no contrato.
  const depreciacaoBaixa = [
    ...(entrada.premissas.perfis ?? []).filter(
      (x) => (x.tipo === "VAN" || x.tipo === "MICRO") && (x.veiculo.metodoDepreciacao ?? entrada.premissas.veiculo.metodoDepreciacao) === "PERCENTUAL" && x.veiculo.depreciacaoAa < 0.08
    ),
  ];
  if (depreciacaoBaixa.length > 0)
    alertas.push({
      nivel: "ATENCAO",
      titulo: "Depreciação baixa para van ou micro",
      detalhe: `${depreciacaoBaixa.map((x) => `${x.descricao} (${pctTexto(x.veiculo.depreciacaoAa)} a.a.)`).join(", ")}: van e micro rodam cerca de 5 anos; abaixo de 8% a.a. o preço não repõe o veículo.`,
    });
  // ARLA: 3 a 5% do consumo de diesel; acima de 6% do custo de combustível é
  // premissa inflada ou digitada na unidade errada.
  const custoDiesel = resultado.itens.reduce((a, i) => a + i.diesel, 0);
  const custoArla = resultado.itens.reduce((a, i) => a + i.arla, 0);
  if (custoDiesel > 0 && custoArla / custoDiesel > 0.06)
    alertas.push({ nivel: "INFO", titulo: "ARLA acima do usual", detalhe: `ARLA é ${pctTexto(custoArla / custoDiesel)} do custo de combustível; o usual é de 3% a 5% do consumo de diesel.` });
  // REFORMA TRIBUTÁRIA (LC 214/2025): a partir de 2027 a CBS substitui PIS e
  // COFINS, cobrada por fora do preço; de 2029 a 2032 ISS e ICMS diminuem com a
  // entrada do IBS. Contrato que atravessa 2027 precisa de cláusula de
  // reequilíbrio pela mudança tributária.
  const inicio = opcoes.inicioContrato ?? new Date();
  const fim = new Date(inicio.getFullYear(), inicio.getMonth() + entrada.premissas.contrato.vigenciaMeses, 1);
  if (fim > new Date(2027, 0, 1))
    alertas.push({
      nivel: "INFO",
      titulo: "Contrato atravessa a reforma tributária",
      detalhe: "A partir de 2027 a CBS substitui PIS/COFINS e é cobrada por fora do preço; de 2029 a 2032 ISS e ICMS caem com a entrada do IBS. Os tributos desta simulação são os de hoje: preveja cláusula de reequilíbrio pela mudança tributária (LC 214/2025).",
    });
  if (!regrasDaBase) alertas.push({ nivel: "INFO", titulo: "Margem mínima padrão", detalhe: "A base de custos não tem as regras da Azul; margem mínima considerada = metade do alvo." });
  const pior = sensibilidade[0];
  if (pior && lucroBase !== 0 && Math.abs(pior.efeitoLucro) > Math.abs(lucroBase) * 0.5)
    alertas.push({ nivel: "ATENCAO", titulo: `Resultado frágil a ${pior.rotulo.toLowerCase()}`, detalhe: `10% pior leva metade ou mais do lucro.` });

  const criticos = alertas.filter((a) => a.nivel === "CRITICO").length;
  const atencao = alertas.filter((a) => a.nivel === "ATENCAO").length;
  const veredicto: Veredicto = criticos > 0 ? "NAO_LANCAR" : atencao > 0 ? "LANCAR_COM_RESSALVA" : "LANCAR";
  const resumo =
    veredicto === "NAO_LANCAR"
      ? "Não lançar como está: " + alertas.filter((a) => a.nivel === "CRITICO").map((a) => a.titulo.toLowerCase()).join("; ") + "."
      : veredicto === "LANCAR_COM_RESSALVA"
        ? "Lançar com ressalva: " + alertas.filter((a) => a.nivel === "ATENCAO").map((a) => a.titulo.toLowerCase()).join("; ") + "."
        : "Lançar: margem acima da mínima, sem item acima do teto e com folga de utilização.";

  return {
    veredicto,
    resumo,
    margem,
    margemMinima: minima,
    margemAlvo: alvo,
    regrasDaBase,
    faixa: { unidade, piso, margemMinima: precoMinima, alvo: precoAlvo, teto, espacoNegociacao: precoAlvo - precoMinima },
    folgaUtilizacao,
    sensibilidade,
    premissasEstimadas: { total: entradasOrigem.length, estimadas: estimadas.length, principais: principaisEstimadas },
    alertas,
  };
}
