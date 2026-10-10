// A DISPUTA (o resultado da licitação, empresa a empresa) — o que a tela e o
// servidor dividem. Sem banco: vai para o navegador.

export const SITUACOES_PARTICIPANTE = ["VENCEDORA", "CLASSIFICADA", "DESCLASSIFICADA", "INABILITADA", "DESISTENTE"] as const;
export type SituacaoParticipante = (typeof SITUACOES_PARTICIPANTE)[number];
export const ROTULO_SITUACAO_PARTICIPANTE: Record<SituacaoParticipante, string> = {
  VENCEDORA: "Vencedora",
  CLASSIFICADA: "Classificada",
  DESCLASSIFICADA: "Desclassificada",
  INABILITADA: "Inabilitada",
  DESISTENTE: "Desistente",
};

// Diferença de um preço sobre outro (0,05 = 5% acima). Nulo sem os dois.
export function diferenca(preco: number | null | undefined, referencia: number | null | undefined): number | null {
  return preco && referencia && referencia > 0 ? preco / referencia - 1 : null;
}
