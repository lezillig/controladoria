import { prisma } from "@/lib/prisma";
import { aptidaoNaData, CARGOS_DA_ESCALA, type Aptidao } from "./documentos";
import { feriasNoDia, resumoDeFerias, type ResumoFerias } from "./ferias";

// OS MOTORISTAS (e monitores) LIDOS DO BANCO, com a aptidão de hoje e o
// resumo das férias. A tela e o agente diário leem por aqui.

// O começo do controle de férias da empresa: o primeiro registro de férias
// que o sistema tem. Antes dele não há como saber o que foi gozado.
export async function controleDeFeriasDesde(companyId: string): Promise<Date | null> {
  const r = await prisma.pesFerias.aggregate({ where: { companyId }, _min: { inicio: true } });
  return r._min.inicio;
}

export async function listarMotoristas(companyId: string, hoje: Date, filtro: { ids?: string[]; comInativos?: boolean } = {}) {
  const [pessoas, controleDesde] = await Promise.all([
    prisma.cadPessoa.findMany({
      where: { companyId, cargo: { in: CARGOS_DA_ESCALA }, ...(filtro.comInativos ? {} : { ativo: true }), ...(filtro.ids ? { id: { in: filtro.ids } } : {}) },
      include: { documentos: true, ferias: { orderBy: { inicio: "asc" } } },
      orderBy: { nome: "asc" },
    }),
    controleDeFeriasDesde(companyId),
  ]);
  return {
    controleDesde,
    linhas: pessoas.map((p) => ({
      ...p,
      aptidao: aptidaoNaData(p, p.documentos, feriasNoDia(p.ferias, hoje), hoje) as Aptidao,
      resumoFerias: resumoDeFerias(p.dataAdmissao, p.ferias, hoje, controleDesde) as ResumoFerias,
    })),
  };
}
export type LinhaMotorista = Awaited<ReturnType<typeof listarMotoristas>>["linhas"][number];
