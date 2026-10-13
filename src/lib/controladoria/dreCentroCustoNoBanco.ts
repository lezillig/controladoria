import { prisma } from "@/lib/prisma";
import { tabela } from "@/lib/esquemaDoBanco";
import { competenciaSql, semProvisaoFuturaSql } from "./competencia";
import { categoriaSql, filtroConexaoTitulo, naJanela } from "./escopoSql";
import { categoriasDoEscopo, movimentoPorCategoria, recorteMensalDoDre } from "./dreNoBanco";
import { linhaDaCategoria } from "./dre";
import { partesDaChave } from "./chaveCategoria";
import { classificacoesDoDre } from "./projecaoNoBanco";
import { montarDreCentroCusto, type GrupoDeTitulos, type QuadroDoDre, type Rateio } from "./dreCentroCusto";

// A COLHEITA DO DRE POR CENTRO DE CUSTO: o mesmo recorte do DRE mensal da tela
// de Custos (recorteMensalDoDre — mês da competência até a data de referência,
// treze meses de janela, as operações entre as empresas eliminadas na visão do
// grupo), somado por origem em vez de só por categoria.

type LinhaGrupo = {
  conexaoId: string;
  categoria: string;
  natureza: string;
  departamento: string | null;
  projeto: string | null;
  parceiro: string | null;
  parceiroNome: string | null;
  cents: bigint;
  retencao: bigint;
  titulos: bigint;
};

const inicioDoMes = (d: Date) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1));

export async function dreCentroCustoNoBanco(params: { companyId: string; conexaoId: string | null; dataReferencia: Date; rateio: Rateio; somarRetencoes: boolean }) {
  const { companyId, conexaoId, dataReferencia } = params;
  const recorte = recorteMensalDoDre({ companyId, conexaoId, dataReferencia });
  const { escopo, periodo } = recorte;

  const [linhas, movimento, categorias, classificacoes, conexoes, centros, vinculos, departamentos, projetos] = await Promise.all([
    prisma.$queryRaw<LinhaGrupo[]>`
      SELECT t."conexaoId" AS "conexaoId",
             ${categoriaSql()} AS categoria,
             t.natureza::text AS natureza,
             NULLIF(t."departamentoCodigo", '') AS departamento,
             NULLIF(t."projetoCodigo", '') AS projeto,
             COALESCE(NULLIF(regexp_replace(COALESCE(t."parceiroDocumento", ''), '[^0-9]', '', 'g'), ''), NULLIF(btrim(t."parceiroNome"), '')) AS parceiro,
             MAX(t."parceiroNome") AS "parceiroNome",
             COALESCE(SUM(t."valorDocumentoCents"), 0)::bigint AS cents,
             COALESCE(SUM(CASE WHEN t.natureza = 'RECEBER'
                 THEN t."retencaoIssCents" + t."retencaoPisCents" + t."retencaoCofinsCents"
                    + t."retencaoCsllCents" + t."retencaoIrCents" + t."retencaoInssCents" ELSE 0 END), 0)::bigint AS retencao,
             COUNT(*)::bigint AS titulos
        FROM ${tabela("OmieTitulo")} t
       WHERE t."companyId" = ${companyId}
         AND t.cancelado = false
         AND ${semProvisaoFuturaSql("t")}
         AND ${competenciaSql("t")} >= ${periodo.inicio}
         AND ${competenciaSql("t")} <= ${periodo.fim}
         ${filtroConexaoTitulo(conexaoId, companyId)}
         ${naJanela(escopo.janela)}
       GROUP BY 1, 2, 3, 4, 5, 6
    `,
    movimentoPorCategoria(escopo),
    categoriasDoEscopo(escopo),
    classificacoesDoDre(companyId),
    prisma.omieConexao.findMany({ where: { companyId }, select: { id: true, apelido: true, papelNoGrupo: true } }),
    prisma.centroCusto.findMany({ where: { companyId, ...(conexaoId ? { conexaoId } : {}) }, orderBy: [{ conexaoId: "asc" }, { descricao: "asc" }] }),
    prisma.centroCustoVinculo.findMany({ where: { companyId, ...(conexaoId ? { conexaoId } : {}) } }),
    prisma.omieDepartamento.findMany({ where: { companyId }, select: { conexaoId: true, codigo: true, descricao: true } }),
    prisma.omieProjeto.findMany({ where: { companyId }, select: { conexaoId: true, codigo: true, nome: true } }),
  ]);

  const apelido = new Map(conexoes.map((c) => [c.id, c.apelido]));
  const corporativas = new Set(conexoes.filter((c) => c.papelNoGrupo === "CORPORATIVO").map((c) => c.id));

  // O QUADRO DE CADA EMPRESA: o do mês; sem ele, o mais recente antes; sem
  // nenhum antes, o primeiro depois. Quadro de outro mês vira aviso.
  const competencia = inicioDoMes(periodo.inicio);
  const todosQuadros = await prisma.folhaQuadro.findMany({
    where: { companyId, ...(conexaoId ? { conexaoId } : {}) },
    select: { id: true, conexaoId: true, competencia: true, pessoas: true },
    orderBy: { competencia: "desc" },
  });
  const escolhidos = new Map<string, (typeof todosQuadros)[number]>();
  for (const cx of new Set(todosQuadros.map((q) => q.conexaoId))) {
    const daEmpresa = todosQuadros.filter((q) => q.conexaoId === cx);
    escolhidos.set(cx, daEmpresa.find((q) => q.competencia <= competencia) ?? daEmpresa[daEmpresa.length - 1]);
  }
  const ids = [...escolhidos.values()].map((q) => q.id);
  const porCentro = ids.length
    ? await prisma.folhaPessoa.groupBy({ by: ["quadroId", "centroCustoCodigo"], where: { quadroId: { in: ids } }, _count: { _all: true }, _sum: { salarioCents: true } })
    : [];
  const servicos = ids.length
    ? await prisma.folhaPessoa.groupBy({ by: ["quadroId", "centroCustoCodigo", "servico"], where: { quadroId: { in: ids }, servico: { not: null } } })
    : [];
  const centroPorCodigo = new Map(centros.map((c) => [`${c.conexaoId}|${c.codigo}`, c.id]));
  const conexaoDoQuadro = new Map([...escolhidos.values()].map((q) => [q.id, q.conexaoId]));
  const quadros: QuadroDoDre[] = [...escolhidos.values()].map((q) => ({ conexaoId: q.conexaoId, competencia: q.competencia, porCentro: new Map() }));
  const quadroDe = new Map(quadros.map((q) => [q.conexaoId, q]));
  for (const p of porCentro) {
    const cx = conexaoDoQuadro.get(p.quadroId)!;
    const id = centroPorCodigo.get(`${cx}|${p.centroCustoCodigo}`);
    if (id) quadroDe.get(cx)!.porCentro.set(id, { pessoas: p._count._all, salarioCents: p._sum.salarioCents ?? 0 });
  }
  const servicosPorCentro = new Map<string, string[]>();
  for (const s of servicos) {
    const id = centroPorCodigo.get(`${conexaoDoQuadro.get(s.quadroId)}|${s.centroCustoCodigo}`);
    if (id && s.servico) servicosPorCentro.set(id, [...(servicosPorCentro.get(id) ?? []), s.servico]);
  }

  const grupos: GrupoDeTitulos[] = linhas.map((l) => ({
    conexaoId: l.conexaoId,
    categoria: l.categoria,
    natureza: l.natureza,
    departamento: l.departamento,
    projeto: l.projeto,
    parceiro: l.parceiro,
    parceiroNome: l.parceiroNome,
    cents: Number(l.cents),
    retencaoCents: Number(l.retencao),
    titulos: Number(l.titulos),
  }));

  const descricaoDaCategoria = (codigo: string) => {
    const empresa = partesDaChave(codigo).empresa;
    return `${categorias.get(codigo)?.descricao ?? `Categoria ${partesDaChave(codigo).codigo}`}${empresa ? ` · ${empresa}` : ""}`;
  };
  const resultado = montarDreCentroCusto(
    {
      grupos,
      linhaDaCategoria: (c) => linhaDaCategoria(c, classificacoes, categorias, movimento),
      ehReceita: (c) => (movimento.get(c)?.receberCents ?? 0) > (movimento.get(c)?.pagarCents ?? 0),
      descricaoDaCategoria,
      conexoesCorporativas: corporativas,
      centros: centros.map((c) => ({ id: c.id, conexaoId: c.conexaoId, codigo: c.codigo, descricao: c.descricao, tipo: c.tipo, empresa: apelido.get(c.conexaoId) ?? "?" })),
      vinculos,
      quadros,
      rateio: params.rateio,
      somarRetencoes: params.somarRetencoes,
      nomes: {
        departamentos: new Map(departamentos.map((d) => [`${d.conexaoId}|${d.codigo}`, d.descricao])),
        projetos: new Map(projetos.map((p) => [`${p.conexaoId}|${p.codigo}`, p.nome])),
      },
    },
    servicosPorCentro
  );

  for (const q of escolhidos.values())
    if (q.competencia.getTime() !== competencia.getTime())
      resultado.avisos.push(
        `O quadro de pessoal da ${apelido.get(q.conexaoId) ?? "empresa"} usado é o de ${q.competencia.toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" })} — não há lista importada para o mês do relatório.`
      );

  return { resultado, periodo, competencia, quadros: [...escolhidos.values()], vinculos, apelido };
}
