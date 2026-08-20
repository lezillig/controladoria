export type SortDir = "asc" | "desc";

// Monta a URL de um cabeçalho ordenavel preservando os demais parametros ja
// presentes na pagina (filtros, semana/mes, etc.), so atualizando sort/dir.
export function buildSortHref(
  basePath: string,
  currentParams: Record<string, string | undefined>,
  field: string,
  dir: SortDir
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(currentParams)) {
    if (value) params.set(key, value);
  }
  params.set("sort", field);
  params.set("dir", dir);
  return `${basePath}?${params.toString()}`;
}

// Direcao que o clique deve aplicar: alterna se a coluna clicada ja e a
// ativa, senao comeca em asc.
export function nextSortDir(currentSort: string | undefined, currentDir: string | undefined, field: string): SortDir {
  if (currentSort === field && currentDir === "asc") return "desc";
  return "asc";
}
