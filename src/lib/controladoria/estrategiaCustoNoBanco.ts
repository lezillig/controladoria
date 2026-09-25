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
type LinhaReceita = { mes: string; cents: bigint };

export async function seriesMensaisNoBanco(escopo: EscopoSql, dataReferencia: Date): Promise<SeriesDeCusto> {
  const { primeiroMes, meses } = janelaDeAnalise(dataReferencia);

  // O ÚLTIMO MÊS VAI SÓ ATÉ O DIA DA REFERÊNCIA, como no original: a série
  // termina onde a leitura termina, e não no fim do mês corrente.
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
         AND ${competenciaSql("t")} <= ${dataReferencia}
         ${filtroConexaoTitulo(escopo.conexaoId)}
         ${naJanela(escopo.janela)}
       GROUP BY 1, 2
    `,
    prisma.$queryRaw<LinhaReceita[]>`
      SELECT to_char(${competenciaSql("t")}, 'YYYY-MM') AS mes,
             COALESCE(SUM(t."valorDocumentoCents"), 0)::bigint AS cents
        FROM ${tabela("OmieTitulo")} t
       WHERE t."companyId" = ${escopo.companyId}
         AND t.cancelado = false
         AND t.natureza = 'RECEBER'
         AND ${competenciaSql("t")} >= ${primeiroMes}
         AND ${competenciaSql("t")} <= ${dataReferencia}
         ${filtroConexaoTitulo(escopo.conexaoId)}
         ${naJanela(escopo.janela)}
       GROUP BY 1
    `,
  ]);

  const porCategoria = new Map<string, Map<string, number>>();
  for (const l of custos) {
    const serie = porCategoria.get(l.categoria) ?? new Map<string, number>();
    serie.set(l.mes, (serie.get(l.mes) ?? 0) + Number(l.cents));
    porCategoria.set(l.categoria, serie);
  }

  const receitaPorMes = new Map(receitas.map((l) => [l.mes, Number(l.cents)]));

  return { meses, porCategoria, receitaPorMes };
}

export async function analisarEstrategiaNoBanco(escopo: EscopoSql, dataReferencia: Date): Promise<AnaliseDeCusto> {
  const [series, categorias] = await Promise.all([
    seriesMensaisNoBanco(escopo, dataReferencia),
    prisma.omieCategoria.findMany({
      where: { companyId: escopo.companyId, ...(escopo.conexaoId ? { conexaoId: escopo.conexaoId } : {}) },
      select: { codigo: true, descricao: true },
    }),
  ]);
  return analisarEstrategiaDeSeries(series, new Map(categorias.map((c) => [c.codigo, c.descricao])));
}
