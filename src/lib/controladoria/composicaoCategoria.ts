import { prisma } from "@/lib/prisma";
import { tabela } from "@/lib/esquemaDoBanco";
import { competenciaSql, semProvisaoFuturaSql } from "./competencia";
import { categoriaSql, filtroConexaoTitulo, naJanela, type EscopoSql } from "./escopoSql";
import type { Periodo } from "./periodos";

// O QUE HÁ DENTRO DE UMA CATEGORIA — para decidir a reclassificação olhando
// os lançamentos, e não só o nome. "Cartão de Crédito" e "Compra de Serviços"
// são nomes que não dizem nada; os favorecidos e as observações dos títulos
// dizem. Mesmo recorte do DRE (competência, sem provisões futuras, sem
// cancelados, sem operação entre as empresas do grupo).

export const FORNECEDORES_NA_COMPOSICAO = 10;
export const TITULOS_NA_COMPOSICAO = 10;

export type ComposicaoCategoria = {
  fornecedores: { nome: string; documento: string | null; cents: number; titulos: number }[];
  // O que ficou fora dos dez maiores favorecidos.
  demais: { fornecedores: number; cents: number } | null;
  titulos: { data: string; fornecedor: string; numero: string | null; empresa: string; cents: number; observacao: string | null }[];
  totalTitulos: number;
};

type LinhaFornecedor = { categoria: string; nome: string; documento: string | null; cents: bigint; titulos: bigint; pos: bigint; nfornecedores: bigint; totalcents: bigint };
type LinhaTitulo = { categoria: string; data: Date; fornecedor: string; numero: string | null; empresa: string; cents: number; observacao: string | null; pos: bigint; total: bigint };

export async function composicaoDasCategorias(escopo: EscopoSql, periodo: Periodo, categorias: string[]): Promise<Record<string, ComposicaoCategoria>> {
  const saida: Record<string, ComposicaoCategoria> = {};
  if (categorias.length === 0) return saida;
  // Em sequência, não em paralelo: o pool de conexões do pooler de produção
  // já se esgotou com consultas demais ao mesmo tempo.
  const fornecedores = await prisma.$queryRaw<LinhaFornecedor[]>`
    SELECT * FROM (
      SELECT categoria, nome, documento, cents, titulos,
             ROW_NUMBER() OVER (PARTITION BY categoria ORDER BY ABS(cents) DESC, nome) AS pos,
             COUNT(*) OVER (PARTITION BY categoria)::bigint AS nfornecedores,
             SUM(cents) OVER (PARTITION BY categoria)::bigint AS totalcents
        FROM (
          SELECT ${categoriaSql()} AS categoria,
                 COALESCE(NULLIF(t."parceiroNome", ''), '(sem favorecido)') AS nome,
                 MAX(t."parceiroDocumento") AS documento,
                 SUM(t."valorDocumentoCents")::bigint AS cents,
                 COUNT(*)::bigint AS titulos
            FROM ${tabela("OmieTitulo")} t
           WHERE t."companyId" = ${escopo.companyId}
             AND t.cancelado = false
             AND ${semProvisaoFuturaSql("t")}
             AND ${competenciaSql("t")} >= ${periodo.inicio}
             AND ${competenciaSql("t")} <= ${periodo.fim}
             AND ${categoriaSql()} = ANY(${categorias}::text[])
             ${filtroConexaoTitulo(escopo.conexaoId, escopo.companyId)}
             ${naJanela(escopo.janela)}
           GROUP BY 1, 2
        ) f
    ) x
    WHERE x.pos <= ${FORNECEDORES_NA_COMPOSICAO + 1}`;

  const titulos = await prisma.$queryRaw<LinhaTitulo[]>`
    SELECT * FROM (
      SELECT ${categoriaSql()} AS categoria,
             ${competenciaSql("t")} AS data,
             COALESCE(NULLIF(t."parceiroNome", ''), '(sem favorecido)') AS fornecedor,
             t."numeroDocumento" AS numero,
             t."conexaoApelido" AS empresa,
             t."valorDocumentoCents" AS cents,
             NULLIF(btrim(t.observacao), '') AS observacao,
             ROW_NUMBER() OVER (PARTITION BY ${categoriaSql()} ORDER BY ABS(t."valorDocumentoCents") DESC, t.id) AS pos,
             COUNT(*) OVER (PARTITION BY ${categoriaSql()})::bigint AS total
        FROM ${tabela("OmieTitulo")} t
       WHERE t."companyId" = ${escopo.companyId}
         AND t.cancelado = false
         AND ${semProvisaoFuturaSql("t")}
         AND ${competenciaSql("t")} >= ${periodo.inicio}
         AND ${competenciaSql("t")} <= ${periodo.fim}
         AND ${categoriaSql()} = ANY(${categorias}::text[])
         ${filtroConexaoTitulo(escopo.conexaoId, escopo.companyId)}
         ${naJanela(escopo.janela)}
    ) x
    WHERE x.pos <= ${TITULOS_NA_COMPOSICAO}`;

  const de = (c: string) => (saida[c] ??= { fornecedores: [], demais: null, titulos: [], totalTitulos: 0 });
  // Os dez maiores favorecidos; o 11º só serve para saber que há mais — o
  // resto vem do total da categoria.
  const somaDosDez = new Map<string, number>();
  for (const l of fornecedores) {
    const c = de(l.categoria);
    if (Number(l.pos) <= FORNECEDORES_NA_COMPOSICAO) {
      c.fornecedores.push({ nome: l.nome, documento: l.documento, cents: Number(l.cents), titulos: Number(l.titulos) });
      somaDosDez.set(l.categoria, (somaDosDez.get(l.categoria) ?? 0) + Number(l.cents));
    }
  }
  for (const l of titulos) {
    const c = de(l.categoria);
    c.titulos.push({
      data: l.data.toISOString().slice(0, 10),
      fornecedor: l.fornecedor,
      numero: l.numero,
      empresa: l.empresa,
      cents: l.cents,
      observacao: l.observacao,
    });
    c.totalTitulos = Number(l.total);
  }
  // O que passa dos dez: o total da categoria menos a soma dos dez.
  for (const l of fornecedores) {
    const resto = Number(l.nfornecedores) - FORNECEDORES_NA_COMPOSICAO;
    if (resto > 0) saida[l.categoria].demais = { fornecedores: resto, cents: Number(l.totalcents) - (somaDosDez.get(l.categoria) ?? 0) };
  }
  return saida;
}
