// A CHAVE DA CATEGORIA NO DRE — empresa + código quando o código se repete.
//
// Cada conta Omie (Azul, MCZ) tem o seu plano de categorias, e os códigos se
// repetem entre elas. Quando o mesmo código tem NOMES DIFERENTES nas duas
// contas, são duas categorias diferentes: o título da Bessa, pago pela Azul na
// categoria "Comissão", aparecia no DRE do grupo dentro de "Combustível",
// porque na MCZ aquele código é Combustível e a soma era só pelo código.
//
// A chave resolve isso sem mexer no que não colide:
//   - código que não se repete, ou se repete com o MESMO nome: a chave é o
//     próprio código (nada muda, nem as classificações);
//   - código repetido com nomes diferentes: a chave é "código@EMPRESA"
//     ("2.01.05@AZUL"), uma categoria por empresa, com nome e classificação
//     próprios.
// A colisão é apurada sobre TODAS as categorias da empresa, e não só as da
// visão filtrada: a chave de um título não pode mudar porque alguém filtrou a
// tela por empresa — a classificação gravada na chave deixaria de valer.
//
// A classificação da chave composta, enquanto ninguém a separar, é a do código
// puro (a que já estava gravada): nada volta ao palpite automático.
//
// O SQL equivalente está em escopoSql.ts (categoriaSql) — os dois mudam juntos.

export const SEPARADOR_EMPRESA = "@";
export const SEM_CATEGORIA = "SEM_CATEGORIA";

const normalizar = (t: string) => t.trim().toLowerCase();

export type CategoriaParaChave = { codigo: string; descricao: string; conexaoApelido: string };

// Os códigos que se repetem entre empresas com nomes diferentes.
export function categoriasEmColisao(categorias: Pick<CategoriaParaChave, "codigo" | "descricao">[]): Set<string> {
  const nomes = new Map<string, Set<string>>();
  for (const c of categorias) {
    const s = nomes.get(c.codigo) ?? new Set<string>();
    s.add(normalizar(c.descricao));
    nomes.set(c.codigo, s);
  }
  return new Set([...nomes].filter(([, s]) => s.size > 1).map(([codigo]) => codigo));
}

export function chaveDaCategoria(codigo: string | null | undefined, empresa: string, colisoes: ReadonlySet<string>): string {
  if (!codigo) return SEM_CATEGORIA;
  return colisoes.has(codigo) ? `${codigo}${SEPARADOR_EMPRESA}${empresa}` : codigo;
}

// "2.01.05@AZUL" → { codigo: "2.01.05", empresa: "AZUL" }; "2.01.05" → empresa nula.
export function partesDaChave(chave: string): { codigo: string; empresa: string | null } {
  const i = chave.lastIndexOf(SEPARADOR_EMPRESA);
  return i > 0 ? { codigo: chave.slice(0, i), empresa: chave.slice(i + 1) } : { codigo: chave, empresa: null };
}

// O mapa de categorias pela chave: na colisão, uma entrada por empresa.
export function categoriasPorChave<C extends CategoriaParaChave>(categorias: C[], colisoes: ReadonlySet<string>): Map<string, C> {
  return new Map(categorias.map((c) => [chaveDaCategoria(c.codigo, c.conexaoApelido, colisoes), c]));
}

// A classificação da chave: a própria, ou a do código puro (a de antes da
// separação).
export function classificacaoDaChave<T>(classificacoes: ReadonlyMap<string, T>, chave: string): T | undefined {
  return classificacoes.get(chave) ?? classificacoes.get(partesDaChave(chave).codigo);
}

// O nome da categoria pela chave: na composta, com a empresa ("Comissão · AZUL").
export function descricaoDaChave(chave: string, descricao: string | null | undefined): string {
  const { codigo, empresa } = partesDaChave(chave);
  return `${descricao ?? `Categoria ${codigo}`}${empresa ? ` · ${empresa}` : ""}`;
}

// Nome por chave, para as telas que listam categorias (estratégia de custo).
export function descricoesPorChave(categorias: CategoriaParaChave[], colisoes: ReadonlySet<string>): Map<string, string> {
  return new Map([...categoriasPorChave(categorias, colisoes)].map(([chave, c]) => [chave, descricaoDaChave(chave, c.descricao)]));
}

// Os códigos em colisão com o nome em cada empresa, para o aviso da tela.
export function descreverColisoes(categorias: CategoriaParaChave[], colisoes: ReadonlySet<string>): { codigo: string; nomes: { empresa: string; descricao: string }[] }[] {
  return [...colisoes].sort().map((codigo) => ({
    codigo,
    nomes: categorias
      .filter((c) => c.codigo === codigo)
      .map((c) => ({ empresa: c.conexaoApelido, descricao: c.descricao }))
      .sort((a, b) => a.empresa.localeCompare(b.empresa)),
  }));
}
