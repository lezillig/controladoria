// O QUE MUDOU, em uma linha: campo a campo, o antes → o depois, como a trilha
// gravou (registrarAlteracao). Para a tela de trilha ler sem abrir JSON.

const curto = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "vazio";
  if (typeof v === "string") return v.length > 40 ? `${v.slice(0, 40)}…` : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const t = JSON.stringify(v);
  return t.length > 40 ? `${t.slice(0, 40)}…` : t;
};

export function resumoDaMudanca(antes: unknown, depois: unknown, maximo = 6): string[] {
  const a = antes && typeof antes === "object" && !Array.isArray(antes) ? (antes as Record<string, unknown>) : {};
  const d = depois && typeof depois === "object" && !Array.isArray(depois) ? (depois as Record<string, unknown>) : {};
  const campos = [...new Set([...Object.keys(a), ...Object.keys(d)])];
  const linhas = campos
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(d[k]))
    .map((k) => (k in a && k in d ? `${k}: ${curto(a[k])} → ${curto(d[k])}` : k in d ? `${k}: ${curto(d[k])}` : `${k}: ${curto(a[k])} (removido)`));
  return linhas.length > maximo ? [...linhas.slice(0, maximo), `e mais ${linhas.length - maximo} campo(s)`] : linhas;
}
