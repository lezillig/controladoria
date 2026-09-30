import type { EntradaSimulacao, Item } from "./tipos";

// ITENS DO ESTUDO: código livre para um item novo e a duplicação de um item
// com as rotas dele — orçamentos com itens parecidos (4 lotes de van, cada um
// com a sua rota) se montam copiando o primeiro e ajustando o que muda.

export function codigoLivre(itens: Pick<Item, "codigo">[]): string {
  let n = itens.length + 1;
  while (itens.some((i) => i.codigo === String(n))) n++;
  return String(n);
}

// A cópia entra logo depois do original, com as rotas dele apontando para o
// código novo (depois da última rota do original, para ficarem agrupadas).
export function duplicarItem(e: EntradaSimulacao, k: number): string | null {
  const original = e.itens[k];
  if (!original) return null;
  const codigo = codigoLivre(e.itens);
  e.itens.splice(k + 1, 0, { ...structuredClone(original), codigo, descricao: `${original.descricao} (cópia)` });
  const copias = e.rotas.filter((r) => r.item === original.codigo).map((r) => ({ ...structuredClone(r), item: codigo }));
  const ultima = e.rotas.findLastIndex((r) => r.item === original.codigo);
  e.rotas.splice(ultima === -1 ? e.rotas.length : ultima + 1, 0, ...copias);
  return codigo;
}
