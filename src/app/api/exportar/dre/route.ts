import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { carregarContexto } from "@/lib/controladoria/contexto";
import { LINHAS_DRE, montarDre, ROTULO_LINHA } from "@/lib/controladoria/dre";
import { cabecalhoDeContexto, montarCsv, nomeDoArquivo } from "@/lib/controladoria/exportarCsv";
import { mesCompleto, rotuloMes } from "@/lib/controladoria/periodos";
import { resolverEscopo, resolverPeriodo, resolverRegime } from "@/app/(app)/_dados";

// PLANILHA DE CONFERÊNCIA DA CLASSIFICAÇÃO DO DRE.
//
// "Gerar essa tabela, com o valor do mês, para eu conferir se está certa a
// classificação." Conferir classificação é trabalho de lista: percorre-se de
// cima a baixo, marca-se o que está errado, corrige-se depois. Numa tela isso
// se perde no meio do caminho.
//
// A planilha traz LADO A LADO a linha em que a categoria caiu e os quatro
// campos que a Omie informa sobre ela — `codigo_dre`, `tipo_categoria`,
// `conta_receita`, `conta_despesa`. É essa comparação que permite julgar: se a
// Omie diz "conta de despesa" e a categoria está em receita bruta, o erro
// salta. Sem os campos da Omie ao lado, conferir seria confiar na memória de
// quem cadastrou.
//
// A ORDEM é a da demonstração, não a alfabética nem a de valor. Quem confere
// um DRE lê na ordem em que ele fecha — receita bruta, deduções, receita
// líquida — e uma planilha ordenada de outro jeito obriga a remontar a
// estrutura de cabeça a cada linha.

export async function GET(req: NextRequest) {
  const session = await requireRole("ADMIN", "GESTOR", "CONTROLADORIA");

  const escopo = await resolverEscopo(session.companyId, req.nextUrl.searchParams.get("empresa") ?? undefined);
  const periodo = resolverPeriodo(req.nextUrl.searchParams.get("competencia") ?? undefined);
  const regime = resolverRegime(req.nextUrl.searchParams.get("regime") ?? undefined);
  const mes = mesCompleto(periodo.dataReferencia);
  const competencia = rotuloMes(periodo.dataReferencia);

  // O mesmo contexto e a mesma função da tela. Uma consulta paralela daria uma
  // planilha que diverge do que está no ar — e as duas circulariam.
  const ctx = await carregarContexto(session.companyId, periodo.dataReferencia, escopo.conexaoId ?? undefined, {
    desde: mes.inicio,
  });

  const mesAnterior = mesCompleto(new Date(mes.inicio.getFullYear(), mes.inicio.getMonth() - 1, 1));

  const guardadas = await prisma.dreClassificacao.findMany({
    where: { companyId: session.companyId },
    select: { categoriaCodigo: true, linha: true, subgrupo: true, origem: true, userNome: true },
  });
  const classificacoes = new Map(
    guardadas.map((c) => [
      c.categoriaCodigo,
      { linha: c.linha, subgrupo: c.subgrupo, confirmada: c.origem === "CONFIRMADA" },
    ])
  );
  const quemClassificou = new Map(guardadas.map((c) => [c.categoriaCodigo, c.userNome]));

  const config = await prisma.controladoriaConfig.findUnique({
    where: { companyId: session.companyId },
    select: { retencoesNasDeducoes: true },
  });
  const dre = montarDre(ctx, mes, mesAnterior, classificacoes, config?.retencoesNasDeducoes ?? true, regime);
  const categorias = new Map(ctx.categorias.map((c) => [c.codigo, c]));

  const empresa = escopo.apelido
    ? escopo.apelido
    : (await prisma.omieConexao.count({ where: { companyId: session.companyId, ativa: true } })) > 1
      ? "Grupo (todas)"
      : "Grupo";

  const sn = (v: boolean) => (v ? "S" : "N");

  const linhas: (string | number | null)[][] = [
    ...cabecalhoDeContexto({
      titulo: "Conferência da classificação do DRE",
      empresa,
      competencia,
      criterio:
        (regime === "caixa"
          ? "Regime de CAIXA: o que foi pago ou recebido no mês, pela data da baixa. "
          : "Regime de COMPETÊNCIA, pela data de emissão do documento. ") +
        "Ordem das linhas conforme o art. 187 da Lei 6.404/76. " +
        "As colunas 'Omie:' são o que o cadastro de categorias da Omie informa — é contra elas que se confere. " +
        (config?.retencoesNasDeducoes ?? true
          ? "Os tributos retidos na fonte pelos clientes ESTÃO somados às deduções, como item próprio."
          : "Os tributos retidos na fonte pelos clientes NÃO estão somados às deduções."),
      geradoEm: new Date(),
    }),
    [],
    [
      "Ordem",
      "Linha do DRE",
      "Subgrupo",
      "Categoria (código)",
      "Categoria (descrição)",
      "Omie: codigo_dre",
      "Omie: tipo_categoria",
      "Omie: conta_receita",
      "Omie: conta_despesa",
      "Valor do mês (R$)",
      "Mês anterior (R$)",
      "Classificação",
      "Quem classificou",
    ],
  ];

  let ordem = 0;
  for (const def of LINHAS_DRE) {
    const calculada = dre.linhas.find((l) => l.chave === def.chave);
    if (!calculada) continue;

    // O SUBTOTAL APARECE NA PLANILHA, e não só os itens. É ele que permite
    // conferir se a soma das categorias bate com a linha — que é metade do
    // trabalho de conferência, e a metade que uma lista de itens soltos não
    // deixa fazer.
    ordem += 1;
    linhas.push([
      ordem,
      def.rotulo,
      def.tipo === "SUBTOTAL" ? "(subtotal calculado)" : "",
      "",
      "",
      "",
      "",
      "",
      "",
      calculada.valorCents / 100,
      calculada.valorAnteriorCents / 100,
      "",
      "",
    ]);

    for (const item of calculada.itens) {
      const cat = categorias.get(item.categoriaCodigo);
      ordem += 1;
      linhas.push([
        ordem,
        `    ${ROTULO_LINHA[def.chave] ?? def.chave}`,
        item.subgrupo ?? "",
        item.categoriaCodigo,
        item.descricao,
        cat?.codigoDre ?? "",
        cat?.tipoCategoria ?? "",
        cat ? sn(cat.contaReceita) : "",
        cat ? sn(cat.contaDespesa) : "",
        item.valorCents / 100,
        item.valorAnteriorCents / 100,
        item.confirmada ? "CONFIRMADA" : "proposta automática",
        quemClassificou.get(item.categoriaCodigo) ?? "",
      ]);
    }
  }

  // O que ficou FORA da demonstração, ao final e nomeado. Somar em silêncio
  // seria a única forma de a planilha fechar e mentir.
  if (dre.semCategoriaCents !== 0) {
    linhas.push([]);
    linhas.push([
      "",
      "FORA DA DEMONSTRAÇÃO — títulos sem categoria na Omie",
      "",
      "",
      "O conserto destes é na Omie: sem categoria, não há linha do DRE a que pertençam.",
      "",
      "",
      "",
      "",
      dre.semCategoriaCents / 100,
      "",
      "",
      "",
    ]);
  }

  const csv = montarCsv(linhas);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nomeDoArquivo("dre-classificacao", empresa, competencia)}"`,
      "Cache-Control": "no-store",
    },
  });
}
