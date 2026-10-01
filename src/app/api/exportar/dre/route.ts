import { SEM_CATEGORIA, categoriasEmColisao, categoriasPorChave, classificacaoDaChave } from "@/lib/controladoria/chaveCategoria";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { garantirConfig } from "@/lib/controladoria/contexto";
import { LINHA_PESSOAS_CORPORATIVO, LINHAS_DRE, ROTULO_LINHA } from "@/lib/controladoria/dre";
import { montarDreNoBanco, recorteMensalDoDre, titulosDaConferencia } from "@/lib/controladoria/dreNoBanco";
import { cabecalhoDeContexto, montarCsv, nomeDoArquivo } from "@/lib/controladoria/exportarCsv";
import { fmtData } from "@/lib/controladoria/format";
import { rotuloMes } from "@/lib/controladoria/periodos";
import { resolverEscopo, resolverPeriodo, resolverRegime } from "@/app/(app)/_dados";
import { exigirPermissao } from "@/app/(app)/_dados";

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
  const session = await exigirPermissao("custos");

  const escopo = await resolverEscopo(session.companyId, req.nextUrl.searchParams.get("empresa") ?? undefined);
  const periodo = resolverPeriodo(req.nextUrl.searchParams.get("competencia") ?? undefined);
  const regime = resolverRegime(req.nextUrl.searchParams.get("regime") ?? undefined);
  const competencia = rotuloMes(periodo.dataReferencia);

  // O MESMO RECORTE E A MESMA COLHEITA DA TELA (ver `recorteMensalDoDre`).
  // Esta rota carregava o contexto a partir do dia 1º do mês e comparava o mês
  // inteiro com o anterior inteiro: o "mês anterior" perdia os títulos já
  // liquidados, o caixa perdia pagamento de título emitido antes do mês, e a
  // planilha que existe para conferir a tela mostrava outro DRE.
  const recorte = recorteMensalDoDre({
    companyId: session.companyId,
    conexaoId: escopo.conexaoId,
    dataReferencia: periodo.dataReferencia,
  });

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
  const quemClassificouPorCodigo = new Map(guardadas.map((c) => [c.categoriaCodigo, c.userNome]));
  const quemClassificou = { get: (chave: string) => classificacaoDaChave(quemClassificouPorCodigo, chave) };

  // `garantirConfig`, como a tela (via escopoDaPagina): a leitura das
  // retenções tem que ser a mesma nos dois lados.
  const config = await garantirConfig(session.companyId);
  const dre = await montarDreNoBanco(recorte.escopo, recorte.periodo, recorte.periodoAnterior, classificacoes, {
    somarRetencoes: config.retencoesNasDeducoes,
    regime,
    incluirTitulos: false,
  });
  // As colunas "Omie:" do cadastro, no mesmo recorte de empresa da colheita.
  // Pela chave da categoria (chaveCategoria.ts), como o DRE.
  const todasAsCategorias = await prisma.omieCategoria.findMany({
    where: { companyId: session.companyId },
    select: { codigo: true, descricao: true, conexaoId: true, conexaoApelido: true, codigoDre: true, tipoCategoria: true, contaReceita: true, contaDespesa: true },
  });
  const categorias = categoriasPorChave(
    escopo.conexaoId ? todasAsCategorias.filter((c) => c.conexaoId === escopo.conexaoId) : todasAsCategorias,
    categoriasEmColisao(todasAsCategorias)
  );
  const { janelas } = recorte;

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
        // O mês parcial é dito, como a tela diz: um arquivo que circula com
        // "setembro" no nome e metade de setembro dentro é lido como queda.
        (janelas.mesParcial
          ? `Mês até ${fmtData(recorte.periodo.fim)}, comparado ao mês anterior fechado (${recorte.periodoAnterior.rotulo}) e ao mesmo mês do ano anterior fechado — o mesmo recorte da tela. `
          : "") +
        "Ordem das linhas conforme o art. 187 da Lei 6.404/76. " +
        "As colunas 'Omie:' são o que o cadastro de categorias da Omie informa — é contra elas que se confere. " +
        (config.retencoesNasDeducoes
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
    // A LINHA DE PESSOAS DA OUTRA EMPRESA, vazia, não entra — como na tela.
    // Numa empresa só, a folha dela está numa das duas linhas (operação ou
    // corporativo); a outra seria uma linha de zeros.
    if (
      (def.chave === "DESPESA_SALARIOS" || def.chave === LINHA_PESSOAS_CORPORATIVO) &&
      calculada.valorCents === 0 &&
      calculada.valorAnteriorCents === 0 &&
      calculada.itens.length === 0
    ) {
      continue;
    }

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

  // TODOS OS TÍTULOS DO MÊS, na ordem da demonstração. A tela mostra os vinte
  // maiores de cada categoria e manda para cá o resto; é esta lista que se
  // cruza com a exportação da Omie no fechamento (ver titulosDaConferencia).
  const titulos = await titulosDaConferencia(recorte.escopo, recorte.periodo, regime);
  const linhaDaCategoria = new Map<string, { ordem: number; rotulo: string; descricao: string }[]>();
  LINHAS_DRE.forEach((def, ordemDaLinha) => {
    for (const item of dre.linhas.find((l) => l.chave === def.chave)?.itens ?? []) {
      const lista = linhaDaCategoria.get(item.categoriaCodigo) ?? [];
      lista.push({ ordem: ordemDaLinha, rotulo: ROTULO_LINHA[def.chave] ?? def.chave, descricao: item.descricao });
      linhaDaCategoria.set(item.categoriaCodigo, lista);
    }
  });
  const rotuloCorporativo = ROTULO_LINHA[LINHA_PESSOAS_CORPORATIVO];
  const linhaDoTitulo = (t: (typeof titulos)[number]) => {
    const opcoes = linhaDaCategoria.get(t.categoria) ?? [];
    // A mesma categoria pode estar nas duas linhas de pessoas (operação e
    // corporativo): o título vai à do seu papel.
    return opcoes.find((o) => (o.rotulo === rotuloCorporativo) === t.corporativo) ?? opcoes[0];
  };
  const comLinha = titulos
    .map((t) => ({ t, linha: linhaDoTitulo(t) }))
    .sort((a, b) => (a.linha?.ordem ?? 999) - (b.linha?.ordem ?? 999));
  linhas.push([]);
  linhas.push([
    "",
    regime === "caixa" ? "TÍTULOS DO MÊS — cada pagamento ou recebimento, pela data da baixa" : "TÍTULOS DO MÊS — todos os documentos, pela data de emissão",
  ]);
  linhas.push([
    "Linha do DRE",
    "Categoria (código)",
    "Categoria (descrição)",
    "Empresa",
    "Cliente / fornecedor",
    "CNPJ/CPF",
    "Documento",
    "Parcela",
    "Tipo de documento",
    regime === "caixa" ? "Data da baixa" : "Data de emissão",
    "Vencimento",
    regime === "caixa" ? "Valor da baixa (R$)" : "Valor do documento (R$)",
    "Status na Omie",
    "Código do lançamento na Omie",
  ]);
  for (const { t, linha } of comLinha) {
    linhas.push([
      linha?.rotulo ?? (t.categoria === SEM_CATEGORIA ? "FORA DA DEMONSTRAÇÃO (sem categoria)" : "FORA DA DEMONSTRAÇÃO"),
      t.categoria === SEM_CATEGORIA ? "" : t.categoria,
      linha?.descricao ?? categorias.get(t.categoria)?.descricao ?? "",
      t.empresa,
      t.parceiro,
      t.parceiroDocumento ?? "",
      t.documento ?? "",
      t.parcela ?? "",
      t.tipoDocumento ?? "",
      fmtData(t.data),
      fmtData(t.vencimento),
      t.valorCents / 100,
      t.status,
      t.codigoLancamento,
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
