import { prisma } from "@/lib/prisma";
import { tabela } from "@/lib/esquemaDoBanco";
import { competenciaSql } from "./competencia";
import { CATEGORIA_SQL as CATEGORIA, filtroConexaoTitulo, naJanela, type EscopoSql } from "./escopoSql";
import {
  analisarEstrategiaDeSeries,
  janelaDeAnalise,
  type AnaliseDeCusto,
  type SeriesDeCusto,
} from "./estrategiaCusto";
import { proporLinha } from "./dre";

// AS SÉRIES DE CUSTO, SOMADAS NO BANCO.
//
// Gêmeo da colheita em memória de `estrategiaCusto.ts`. A análise — Pareto,
// acoplamento à receita, fila de prioridade — é a mesma função nos dois
// caminhos; o que muda é de onde vêm os doze meses de custo por categoria.
//
// Os dois existem porque atendem lados opostos: o agente de oportunidades roda
// dentro do ciclo, sobre o contexto que já está na memória, e pagar duas
// consultas ali seria desperdício; a tela de Custos e DRE não tem contexto
// nenhum para reaproveitar, e carregar treze meses de títulos só para somá-los
// por mês era a maior parte da espera para trocar de menu.
//
// O mês sai da própria coluna (`to_char`), o que pressupõe data de calendário
// gravada à meia-noite do fuso do servidor — a mesma premissa de `fmtData` e a
// razão do comentário sobre fuso em escopoSql.ts.
//
// Equivalência verificada em `scripts/teste-dre-banco.ts`.

type LinhaSerie = { categoria: string; mes: string; cents: bigint };
type LinhaReceita = { categoria: string; mes: string; cents: bigint };

export async function seriesMensaisNoBanco(escopo: EscopoSql, dataReferencia: Date): Promise<SeriesDeCusto> {
  const { primeiroMes, meses, fim } = janelaDeAnalise(dataReferencia);

  // A JANELA TERMINA NO ÚLTIMO MÊS FECHADO, como na colheita em memória: o mês
  // em curso, pela metade, distorcia a comparação de metades.
  const [custos, receitas] = await Promise.all([
    prisma.$queryRaw<LinhaSerie[]>`
      SELECT ${CATEGORIA} AS categoria,
             to_char(${competenciaSql("t")}, 'YYYY-MM') AS mes,
             COALESCE(SUM(t."valorDocumentoCents"), 0)::bigint AS cents
        FROM ${tabela("OmieTitulo")} t
       WHERE t."companyId" = ${escopo.companyId}
         AND t.cancelado = false
         AND t.natureza = 'PAGAR'
         AND ${competenciaSql("t")} >= ${primeiroMes}
         AND ${competenciaSql("t")} <= ${fim}
         ${filtroConexaoTitulo(escopo.conexaoId)}
         ${naJanela(escopo.janela)}
       GROUP BY 1, 2
    `,
    prisma.$queryRaw<LinhaReceita[]>`
      SELECT ${CATEGORIA} AS categoria,
             to_char(${competenciaSql("t")}, 'YYYY-MM') AS mes,
             COALESCE(SUM(t."valorDocumentoCents"), 0)::bigint AS cents
        FROM ${tabela("OmieTitulo")} t
       WHERE t."companyId" = ${escopo.companyId}
         AND t.cancelado = false
         AND t.natureza = 'RECEBER'
         AND ${competenciaSql("t")} >= ${primeiroMes}
         AND ${competenciaSql("t")} <= ${fim}
         ${filtroConexaoTitulo(escopo.conexaoId)}
         ${naJanela(escopo.janela)}
       GROUP BY 1, 2
    `,
  ]);

  const porCategoria = new Map<string, Map<string, number>>();
  for (const l of custos) {
    const serie = porCategoria.get(l.categoria) ?? new Map<string, number>();
    serie.set(l.mes, (serie.get(l.mes) ?? 0) + Number(l.cents));
    porCategoria.set(l.categoria, serie);
  }

  const receitaPorCategoria = new Map<string, Map<string, number>>();
  for (const l of receitas) {
    const serie = receitaPorCategoria.get(l.categoria) ?? new Map<string, number>();
    serie.set(l.mes, (serie.get(l.mes) ?? 0) + Number(l.cents));
    receitaPorCategoria.set(l.categoria, serie);
  }

  return { meses, porCategoria, receitaPorCategoria };
}

// A LINHA DO DRE DE CADA CATEGORIA: a confirmada ou proposta por uma pessoa
// (DreClassificacao) e, na falta, a proposta automática a partir do cadastro
// — a mesma regra da tela de Custos. É o que tira financiamento, tributo e
// receita da fila de corte.
export async function linhaPorCategoriaDoBanco(escopo: Pick<EscopoSql, "companyId" | "conexaoId">): Promise<Map<string, string>> {
  const [guardadas, categorias] = await Promise.all([
    prisma.dreClassificacao.findMany({ where: { companyId: escopo.companyId }, select: { categoriaCodigo: true, linha: true } }),
    prisma.omieCategoria.findMany({
      where: { companyId: escopo.companyId, ...(escopo.conexaoId ? { conexaoId: escopo.conexaoId } : {}) },
      select: { codigo: true, descricao: true, natureza: true, contaReceita: true, contaDespesa: true },
    }),
  ]);
  const mapa = new Map<string, string>();
  for (const c of categorias) mapa.set(c.codigo, proporLinha(c));
  for (const g of guardadas) mapa.set(g.categoriaCodigo, g.linha);
  return mapa;
}

export async function analisarEstrategiaNoBanco(escopo: EscopoSql, dataReferencia: Date): Promise<AnaliseDeCusto> {
  const [series, categorias, linhas] = await Promise.all([
    seriesMensaisNoBanco(escopo, dataReferencia),
    prisma.omieCategoria.findMany({
      where: { companyId: escopo.companyId, ...(escopo.conexaoId ? { conexaoId: escopo.conexaoId } : {}) },
      select: { codigo: true, descricao: true },
    }),
    linhaPorCategoriaDoBanco(escopo),
  ]);
  return analisarEstrategiaDeSeries(series, new Map(categorias.map((c) => [c.codigo, c.descricao])), linhas);
}
