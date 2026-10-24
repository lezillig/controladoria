import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tabela, tipoDoBanco } from "@/lib/esquemaDoBanco";
import { competenciaSql, semProvisaoFuturaSql } from "./competencia";
import { categoriaSql, filtroConexaoTitulo } from "./escopoSql";
import { categoriasDoEscopo, movimentoPorCategoria } from "./dreNoBanco";
import { linhaDaCategoria } from "./dre";
import { classificacoesDoDre } from "./projecaoNoBanco";
import { CATEGORIA_FORA_DA_OS, chaveDoProjeto, conferirOs, type GrupoOs, type PagarSemProjeto } from "./conferenciaDeOs";

// A colheita da conferência de OS: os títulos do período (competência, sem
// cancelados, sem as operações entre as empresas na visão do grupo), somados
// por empresa, natureza, projeto e número da OS.

// O custo que deveria estar numa OS: o das linhas de operação do DRE (e o das
// genéricas, onde a categoria ainda não foi classificada). Pessoal, estrutura,
// financeiro e tributos não são de uma viagem.
const LINHAS_DE_CUSTO_DA_OS = new Set(["CUSTO_SERVICO", "DESPESA_VEICULOS", "DESPESA_SERVICOS_TERCEIROS", "DESPESA_GERAL", "DESPESA_COMERCIAL"]);

type Linha = { conexaoId: string; natureza: string; projeto: string | null; os: string | null; categoria: string | null; titulos: bigint; cents: bigint; ultima: Date | null; parceiros: string[] | null };
type LinhaCategoria = { conexaoId: string; categoria: string; cents: bigint; retencao: bigint };
type LinhaDup = { conexaoId: string; natureza: string; parceiro: string | null; documento: string; valor: bigint; vezes: bigint; projetos: string[] };
type LinhaSem = { conexaoId: string; categoria: string; descricao: string | null; parceiro: string | null; titulos: bigint; cents: bigint; ultima: Date | null };

export async function conferenciaDeOsNoBanco(params: { companyId: string; conexaoId: string | null; desde: Date; ate: Date }) {
  const { companyId, conexaoId, desde, ate } = params;
  const filtro = filtroConexaoTitulo(conexaoId, companyId);
  const [linhas, semProjeto, conferidos, projetos, conexoes, classificacoes, porCategoria, duplicadas, config] = await Promise.all([
    prisma.$queryRaw<Linha[]>`
      SELECT t."conexaoId" AS "conexaoId", t.natureza::text AS natureza,
             NULLIF(t."projetoCodigo", '') AS projeto, NULLIF(t."ordemServicoNumero", '') AS os,
             COALESCE(t."categoriaDescricao", c.descricao, t."categoriaCodigo") AS categoria,
             COUNT(*)::bigint AS titulos, COALESCE(SUM(t."valorDocumentoCents"), 0)::bigint AS cents,
             MAX(${competenciaSql("t")}) AS ultima,
             (array_agg(DISTINCT t."parceiroNome") FILTER (WHERE t."parceiroNome" IS NOT NULL))[1:6] AS parceiros
        FROM ${tabela("OmieTitulo")} t
        LEFT JOIN ${tabela("OmieCategoria")} c ON c."conexaoId" = t."conexaoId" AND c.codigo = t."categoriaCodigo"
       WHERE t."companyId" = ${companyId}
         AND t.cancelado = false
         AND ${semProvisaoFuturaSql("t")}
         AND ${competenciaSql("t")} >= ${desde}
         AND ${competenciaSql("t")} <= ${ate}
         ${filtro}
       GROUP BY 1, 2, 3, 4, 5`,
    prisma.$queryRaw<LinhaSem[]>`
      SELECT t."conexaoId" AS "conexaoId", ${categoriaSql()} AS categoria, MAX(t."categoriaDescricao") AS descricao,
             t."parceiroNome" AS parceiro, COUNT(*)::bigint AS titulos,
             COALESCE(SUM(t."valorDocumentoCents"), 0)::bigint AS cents, MAX(${competenciaSql("t")}) AS ultima
        FROM ${tabela("OmieTitulo")} t
       WHERE t."companyId" = ${companyId}
         AND t.cancelado = false
         AND t.natureza = 'PAGAR'
         AND NULLIF(t."projetoCodigo", '') IS NULL
         AND ${semProvisaoFuturaSql("t")}
         AND ${competenciaSql("t")} >= ${desde}
         AND ${competenciaSql("t")} <= ${ate}
         ${filtro}
       GROUP BY 1, 2, 4`,
    prisma.$queryRaw<{ total: bigint; conferidos: bigint }[]>`
      SELECT COUNT(*)::bigint AS total, COUNT(*) FILTER (WHERE t."projetoConferidoEm" IS NOT NULL)::bigint AS conferidos
        FROM ${tabela("OmieTitulo")} t
       WHERE t."companyId" = ${companyId}
         AND t.cancelado = false
         AND t.natureza = 'PAGAR'
         AND ${competenciaSql("t")} >= ${desde}
         AND ${competenciaSql("t")} <= ${ate}
         ${filtro}`,
    prisma.omieProjeto.findMany({ where: { companyId }, select: { conexaoId: true, codigo: true, nome: true } }),
    prisma.omieConexao.findMany({ where: { companyId }, select: { id: true, apelido: true } }),
    classificacoesDoDre(companyId),
    // Para a taxa efetiva de tributos sobre a receita de cada empresa.
    prisma.$queryRaw<LinhaCategoria[]>`
      SELECT t."conexaoId" AS "conexaoId", ${categoriaSql()} AS categoria,
             COALESCE(SUM(t."valorDocumentoCents"), 0)::bigint AS cents,
             COALESCE(SUM(CASE WHEN t.natureza = 'RECEBER' THEN t."retencaoIssCents" + t."retencaoPisCents" + t."retencaoCofinsCents" + t."retencaoCsllCents" + t."retencaoIrCents" + t."retencaoInssCents" ELSE 0 END), 0)::bigint AS retencao
        FROM ${tabela("OmieTitulo")} t
       WHERE t."companyId" = ${companyId}
         AND t.cancelado = false
         AND ${semProvisaoFuturaSql("t")}
         AND ${competenciaSql("t")} >= ${desde}
         AND ${competenciaSql("t")} <= ${ate}
         ${filtro}
       GROUP BY 1, 2`,
    // O MESMO DOCUMENTO DUAS VEZES: mesmo parceiro, mesmo número, mesma
    // parcela e mesmo valor, em títulos de OS — pagamento ou cobrança em dobro.
    prisma.$queryRaw<LinhaDup[]>`
      SELECT t."conexaoId" AS "conexaoId", t.natureza::text AS natureza, MAX(t."parceiroNome") AS parceiro,
             t."numeroDocumento" AS documento, t."valorDocumentoCents"::bigint AS valor, COUNT(*)::bigint AS vezes,
             array_agg(DISTINCT t."projetoCodigo") AS projetos
        FROM ${tabela("OmieTitulo")} t
        LEFT JOIN ${tabela("OmieCategoria")} c ON c."conexaoId" = t."conexaoId" AND c.codigo = t."categoriaCodigo"
       WHERE t."companyId" = ${companyId}
         AND t.cancelado = false
         AND COALESCE(t."categoriaDescricao", c.descricao, '') !~* ${CATEGORIA_FORA_DA_OS.source}
         AND NULLIF(t."projetoCodigo", '') IS NOT NULL
         AND NULLIF(btrim(t."numeroDocumento"), '') IS NOT NULL
         AND ${competenciaSql("t")} >= ${desde}
         AND ${competenciaSql("t")} <= ${ate}
         ${filtro}
       GROUP BY t."conexaoId", t.natureza, COALESCE(t."parceiroDocumento", t."parceiroNome"), t."numeroDocumento", COALESCE(t."numeroParcela", ''), t."valorDocumentoCents"
      HAVING COUNT(*) > 1`,
    prisma.controladoriaConfig.findUnique({ where: { companyId }, select: { retencoesNasDeducoes: true } }),
  ]);

  // A linha do DRE de cada categoria, para separar o custo de operação (que
  // deveria ter OS) do resto (aluguel, contador, imposto).
  const escopo = { companyId, conexaoId, janela: { desde: new Date(ate.getFullYear() - 1, ate.getMonth(), 1), ate: null } };
  const [categorias, movimento] = await Promise.all([categoriasDoEscopo(escopo), movimentoPorCategoria(escopo)]);
  const pagarSemProjeto: PagarSemProjeto[] = semProjeto
    .filter((l) => LINHAS_DE_CUSTO_DA_OS.has(linhaDaCategoria(l.categoria, classificacoes, categorias, movimento)))
    .filter((l) => !CATEGORIA_FORA_DA_OS.test(categorias.get(l.categoria)?.descricao ?? l.descricao ?? ""))
    .map((l) => ({
      conexaoId: l.conexaoId,
      parceiro: l.parceiro ?? "(sem fornecedor)",
      categoria: categorias.get(l.categoria)?.descricao ?? l.descricao ?? l.categoria,
      titulos: Number(l.titulos),
      cents: Number(l.cents),
      ultimaCompetencia: l.ultima,
    }));

  // A TAXA EFETIVA DE TRIBUTOS SOBRE A RECEITA de cada empresa no período:
  // deduções do DRE ÷ receita bruta, com as retenções quando a configuração as
  // soma às deduções. Limitada a 30%: acima disso é lançamento fora do lugar.
  const deducoes = new Map<string, number>();
  const bruta = new Map<string, number>();
  for (const l of porCategoria) {
    const linha = linhaDaCategoria(l.categoria, classificacoes, categorias, movimento);
    if (linha === "DEDUCOES") deducoes.set(l.conexaoId, (deducoes.get(l.conexaoId) ?? 0) + Math.abs(Number(l.cents)));
    if (linha === "RECEITA_BRUTA") {
      bruta.set(l.conexaoId, (bruta.get(l.conexaoId) ?? 0) + Number(l.cents));
      if (config?.retencoesNasDeducoes) deducoes.set(l.conexaoId, (deducoes.get(l.conexaoId) ?? 0) + Number(l.retencao));
    }
  }
  const taxaImpostos = new Map([...bruta.entries()].filter(([, v]) => v > 0).map(([cx, v]) => [cx, Math.min(0.3, (deducoes.get(cx) ?? 0) / v)]));
  const nomeDoProjeto = new Map(projetos.map((p) => [`${p.conexaoId}|${p.codigo}`, p.nome]));
  const apelido = new Map(conexoes.map((c) => [c.id, c.apelido]));

  const grupos: GrupoOs[] = linhas.map((l) => ({
    conexaoId: l.conexaoId,
    natureza: l.natureza === "RECEBER" ? "RECEBER" : "PAGAR",
    projeto: l.projeto,
    categoria: l.categoria,
    os: l.os,
    titulos: Number(l.titulos),
    cents: Number(l.cents),
    ultimaCompetencia: l.ultima,
    parceiros: l.parceiros ?? [],
  }));
  const resultado = conferirOs({
    grupos,
    pagarSemProjeto,
    nomeDoProjeto,
    empresa: apelido,
    taxaImpostos,
    duplicidades: duplicadas.map((d) => ({
      natureza: d.natureza === "RECEBER" ? "a receber" : "a pagar",
      empresa: apelido.get(d.conexaoId) ?? "?",
      parceiro: d.parceiro ?? "?",
      documento: d.documento,
      valorCents: Number(d.valor),
      vezes: Number(d.vezes),
      projetos: d.projetos.map((p) => nomeDoProjeto.get(`${d.conexaoId}|${p}`) ?? p),
    })),
  });
  const c = conferidos[0];
  return { ...resultado, taxaImpostos, pagarConferidos: { total: Number(c?.total ?? 0), conferidos: Number(c?.conferidos ?? 0) }, empresa: apelido };
}

// O DRILL-DOWN: os títulos por trás de uma linha da conferência — os de uma OS
// (pelo nome do projeto, nas duas empresas) ou os sem projeto de um lado. O
// mesmo recorte da conferência (competência, sem cancelados, sem as operações
// entre as empresas na visão do grupo).
export type TituloDaOs = {
  id: string;
  empresa: string;
  natureza: string;
  projeto: string | null;
  os: string | null;
  competencia: Date | null;
  vencimento: Date | null;
  parceiro: string | null;
  categoria: string | null;
  documento: string | null;
  parcela: string | null;
  valorCents: number;
  pagoCents: number;
  status: string | null;
};

export const TITULOS_NO_DETALHE = 400;

export async function titulosDaConferencia(params: {
  companyId: string;
  conexaoId: string | null;
  desde: Date;
  ate: Date;
  // O nome do projeto (OS) ou, sem ele, os títulos SEM projeto da natureza.
  projetoNome?: string;
  semProjeto?: "PAGAR" | "RECEBER";
  fornecedor?: string;
}): Promise<{ titulos: TituloDaOs[]; total: number }> {
  const { companyId, conexaoId, desde, ate } = params;
  let codigos: { conexaoId: string; codigo: string }[] = [];
  if (params.projetoNome) {
    const alvo = params.projetoNome.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
    const todos = await prisma.omieProjeto.findMany({ where: { companyId }, select: { conexaoId: true, codigo: true, nome: true } });
    codigos = todos.filter((p) => p.nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim() === alvo);
    // Projeto que não está no cadastro: o nome é o próprio código.
    if (codigos.length === 0) codigos = [{ conexaoId: "", codigo: params.projetoNome }];
  }
  const projetoSql = params.projetoNome
    ? Prisma.sql`AND (${Prisma.join(codigos.map((c) => (c.conexaoId ? Prisma.sql`(t."conexaoId" = ${c.conexaoId} AND t."projetoCodigo" = ${c.codigo})` : Prisma.sql`t."projetoCodigo" = ${c.codigo}`)), " OR ")})`
    : Prisma.sql`AND NULLIF(t."projetoCodigo", '') IS NULL AND t.natureza = ${params.semProjeto ?? "PAGAR"}::${tipoDoBanco("OmieNaturezaTitulo")}`;
  const fornecedorSql = params.fornecedor ? Prisma.sql`AND t."parceiroNome" = ${params.fornecedor}` : Prisma.empty;
  const linhas = await prisma.$queryRaw<(Omit<TituloDaOs, "valorCents" | "pagoCents"> & { valorCents: bigint; pagoCents: bigint | null; total: bigint })[]>`
    SELECT t.id, t."conexaoApelido" AS empresa, t.natureza::text AS natureza,
           COALESCE(p.nome, t."projetoCodigo") AS projeto, t."ordemServicoNumero" AS os,
           ${competenciaSql("t")} AS competencia, t."dataVencimento" AS vencimento, t."parceiroNome" AS parceiro,
           COALESCE(t."categoriaDescricao", c.descricao, t."categoriaCodigo") AS categoria,
           t."numeroDocumento" AS documento, t."numeroParcela" AS parcela,
           t."valorDocumentoCents"::bigint AS "valorCents", t."valorPagoCents"::bigint AS "pagoCents", t.status,
           COUNT(*) OVER ()::bigint AS total
      FROM ${tabela("OmieTitulo")} t
      LEFT JOIN ${tabela("OmieCategoria")} c ON c."conexaoId" = t."conexaoId" AND c.codigo = t."categoriaCodigo"
      LEFT JOIN ${tabela("OmieProjeto")} p ON p."conexaoId" = t."conexaoId" AND p.codigo = t."projetoCodigo"
     WHERE t."companyId" = ${companyId}
       AND t.cancelado = false
       AND ${semProvisaoFuturaSql("t")}
       AND ${competenciaSql("t")} >= ${desde}
       AND ${competenciaSql("t")} <= ${ate}
       ${filtroConexaoTitulo(conexaoId, companyId)}
       ${projetoSql}
       ${fornecedorSql}
     ORDER BY t.natureza, ${competenciaSql("t")}, t."valorDocumentoCents" DESC
     LIMIT ${TITULOS_NO_DETALHE}`;
  return {
    total: Number(linhas[0]?.total ?? 0),
    titulos: linhas.map(({ total, valorCents, pagoCents, ...t }) => {
      void total;
      return { ...t, valorCents: Number(valorCents), pagoCents: Number(pagoCents ?? 0) };
    }),
  };
}
