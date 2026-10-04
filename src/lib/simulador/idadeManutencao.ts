import type { Premissas } from "./tipos";

// MANUTENÇÃO PELA IDADE DO VEÍCULO.
//
// O custo de peças e reparos cresce com a idade do veículo. A curva é a do
// método ANTP/NTU (Método de cálculo de custos de ônibus urbano, 2017):
// peças e acessórios por ano, em % do preço do veículo novo, por faixa de
// idade — 6% (0–2 anos), 7% (2–4), 8% (4–6), 9% (6–8), 10% (8–10) e 12%
// (acima de 10). O veículo de 8–10 anos gasta 1,67× o de 0–2; acima de 10,
// o dobro. Os estudos dos EUA (Argonne/DOE, 2021) dão a mesma forma para
// carros e vans; por isso a curva vale para todos os tipos.
//
// A manutenção por km (asfalto e terra) e a manutenção fixa (% do valor) do
// tipo de veículo valem para um veículo da IDADE DE REFERÊNCIA. O estudo
// aplica o fator da idade real: a média, nos anos do contrato, do coeficiente
// da idade do veículo no meio de cada ano (ele envelhece durante o contrato),
// dividida pelo coeficiente da idade de referência. Sem idade de referência
// (versões salvas antes da curva), o fator é 1.

export const CURVA_MANUTENCAO: { ate: number; pct: number }[] = [
  { ate: 2, pct: 0.06 },
  { ate: 4, pct: 0.07 },
  { ate: 6, pct: 0.08 },
  { ate: 8, pct: 0.09 },
  { ate: 10, pct: 0.1 },
  { ate: Infinity, pct: 0.12 },
];

export function coeficienteDaIdade(idade: number): number {
  return (CURVA_MANUTENCAO.find((f) => Math.max(0, idade) < f.ate) ?? CURVA_MANUTENCAO[CURVA_MANUTENCAO.length - 1]).pct;
}

export function anosDoContrato(vigenciaMeses: number): number {
  return Math.max(1, Math.ceil(vigenciaMeses / 12));
}

export function fatorManutencaoPorIdade(
  veiculo: Pick<Premissas["veiculo"], "idadeInicialAnos" | "idadeReferenciaManutencao">,
  vigenciaMeses: number
): number {
  const referencia = veiculo.idadeReferenciaManutencao;
  if (referencia === null || referencia === undefined || !Number.isFinite(referencia)) return 1;
  const anos = anosDoContrato(vigenciaMeses);
  let soma = 0;
  for (let k = 1; k <= anos; k++) soma += coeficienteDaIdade((veiculo.idadeInicialAnos ?? 0) + k - 0.5);
  return soma / anos / coeficienteDaIdade(referencia + 0.5);
}

// Ano do veículo ↔ idade no início do contrato.
export const idadeDoAno = (anoVeiculo: number, anoInicio: number) => Math.max(0, anoInicio - anoVeiculo);
export const anoDaIdade = (idade: number, anoInicio: number) => anoInicio - Math.round(idade);
