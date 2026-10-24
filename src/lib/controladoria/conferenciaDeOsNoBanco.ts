import { prisma } from "@/lib/prisma";
import { tabela } from "@/lib/esquemaDoBanco";
import { competenciaSql, semProvisaoFuturaSql } from "./competencia";
import { categoriaSql, filtroConexaoTitulo } from "./escopoSql";
import { categoriasDoEscopo, movimentoPorCategoria } from "./dreNoBanco";
import { linhaDaCategoria } from "./dre";
import { classificacoesDoDre } from "./projecaoNoBanco";
import { conferirOs, type GrupoOs, type PagarSemProjeto } from "./conferenciaDeOs";

// A colheita da conferência de OS: os títulos do período (competência, sem
// cancelados, sem as operações entre as empresas na visão do grupo), somados
// por empresa, natureza, projeto e número da OS.

// O custo que deveria estar numa OS: o das linhas de operação do DRE (e o das
// genéricas, onde a categoria ainda não foi classificada). Pessoal, estrutura,
// financeiro e tributos não são de uma viagem.
const LINHAS_DE_CUSTO_DA_OS = new Set(["CUSTO_SERVICO", "DESPESA_VEICULOS", "DESPESA_SERVICOS_TERCEIROS", "DESPESA_GERAL", "DESPESA_COMERCIAL"]);

type Linha = { conexaoId: string; natureza: string; projeto: string | null; os: string | null; titulos: bigint; cents: bigint; ultima: Date | null; parceiros: string[] | null };
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
             COUNT(*)::bigint AS titulos, COALESCE(SUM(t."valorDocumentoCents"), 0)::bigint AS cents,
             MAX(${competenciaSql("t")}) AS ultima,
             (array_agg(DISTINCT t."parceiroNome") FILTER (WHERE t."parceiroNome" IS NOT NULL))[1:6] AS parceiros
        FROM ${tabela("OmieTitulo")} t
       WHERE t."companyId" = ${companyId}
         AND t.cancelado = false
         AND ${semProvisaoFuturaSql("t")}
         AND ${competenciaSql("t")} >= ${desde}
         AND ${competenciaSql("t")} <= ${ate}
         ${filtro}
       GROUP BY 1, 2, 3, 4`,
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
       WHERE t."companyId" = ${companyId}
         AND t.cancelado = false
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
