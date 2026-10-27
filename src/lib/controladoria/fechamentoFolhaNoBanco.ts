import { prisma } from "@/lib/prisma";
import { chaveCompetencia, montarChecklist, somarMeses, type Competencia, type Marca, type TituloDaFolha } from "./fechamentoFolha";

// A COLHEITA DO FECHAMENTO DA FOLHA: as marcas do checklist, os títulos a
// pagar da Omie que comprovam os pagamentos (do dia 1 do mês da folha ao fim
// do mês seguinte) e o quadro de pessoal importado — que marca sozinho o item
// dos relatórios.

export async function checklistDaFolha(params: { companyId: string; competencia: Competencia; hoje: Date }) {
  const { companyId, competencia: c, hoje } = params;
  const chave = chaveCompetencia(c);
  const de = new Date(Date.UTC(c.ano, c.mes - 1, 1));
  const ate = new Date(Date.UTC(c.ano, c.mes + 1, 0, 23, 59, 59));
  const conexoes = await prisma.omieConexao.findMany({ where: { companyId, ativa: true }, orderBy: { ordem: "asc" }, select: { id: true, apelido: true } });
  const ids = conexoes.map((x) => x.id);
  const [marcas, titulos, quadros] = await Promise.all([
    prisma.folhaFechamentoMarca.findMany({ where: { companyId, competencia: chave } }),
    prisma.omieTitulo.findMany({
      where: {
        companyId,
        conexaoId: { in: ids },
        natureza: "PAGAR",
        cancelado: false,
        OR: [{ dataVencimento: { gte: de, lte: ate } }, { dataUltimaBaixa: { gte: de, lte: ate } }],
      },
      select: { conexaoId: true, categoriaDescricao: true, parceiroNome: true, valorDocumentoCents: true, dataVencimento: true, liquidado: true, dataUltimaBaixa: true },
    }),
    prisma.folhaQuadro.findMany({ where: { companyId, competencia: de }, select: { conexaoId: true, importadoEm: true, importadoPorNome: true, pessoas: true } }),
  ]);

  const empresas = conexoes.map((cx) => {
    const m = new Map<string, Marca>(marcas.filter((x) => x.conexaoId === cx.id).map((x) => [x.chave, { feitoEm: x.feitoEm, feitoPor: x.feitoPor, observacao: x.observacao }]));
    const q = quadros.find((x) => x.conexaoId === cx.id);
    if (q && !m.has("RELATORIOS")) m.set("RELATORIOS", { feitoEm: q.importadoEm, feitoPor: q.importadoPorNome ?? "importação do quadro", observacao: `Quadro com ${q.pessoas} pessoa(s) importado` });
    const t: TituloDaFolha[] = titulos
      .filter((x) => x.conexaoId === cx.id)
      .map((x) => ({ categoria: x.categoriaDescricao, parceiro: x.parceiroNome, valorCents: x.valorDocumentoCents, vencimento: x.dataVencimento, liquidado: x.liquidado, pagoEm: x.dataUltimaBaixa }));
    return { conexaoId: cx.id, titulos: t, marcas: m };
  });
  return { conexoes, linhas: montarChecklist({ competencia: c, empresas, hoje }) };
}

// OS ALERTAS: o que está atrasado ou vence em até 2 dias, na competência
// corrente e nas duas anteriores (os encargos de uma folha vencem no mês
// seguinte, e o atraso de ontem não pode sumir porque o mês virou).
//
// Só alerta prazo a partir da entrada do checklist no sistema: o que venceu
// antes disso ninguém tinha onde marcar, e o painel amanheceria com dezenas de
// "atrasados" que não são atraso de ninguém. Na tela do checklist eles
// aparecem normalmente, para serem marcados.
export const ALERTAS_DESDE = new Date(Date.UTC(2026, 9, 27));

export async function alertasDaFolha(companyId: string, hoje = new Date()) {
  const atual: Competencia = { ano: hoje.getUTCFullYear(), mes: hoje.getUTCMonth() + 1 };
  const alertas: { competencia: Competencia; titulo: string; empresa: string; status: "atrasado" | "vence-logo"; prazo: Date }[] = [];
  for (const c of [somarMeses(atual, -2), somarMeses(atual, -1), atual]) {
    const { conexoes, linhas } = await checklistDaFolha({ companyId, competencia: c, hoje });
    const apelido = new Map(conexoes.map((x) => [x.id, x.apelido]));
    for (const l of linhas)
      for (const e of l.porEmpresa)
        if ((e.status === "atrasado" || e.status === "vence-logo") && l.prazo.ate && l.prazo.ate >= ALERTAS_DESDE)
          alertas.push({ competencia: c, titulo: l.titulo, empresa: apelido.get(e.conexaoId) ?? "?", status: e.status, prazo: l.prazo.ate });
  }
  return alertas;
}
