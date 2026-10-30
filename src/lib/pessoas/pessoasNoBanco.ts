import { prisma } from "@/lib/prisma";
import { aptidaoNaData, CARGOS_DA_ESCALA, type Aptidao } from "./documentos";
import { feriasNoDia, resumoDeFerias, type ResumoFerias } from "./ferias";
import { AVISO_PONTOS, LIMITE_PONTOS_EAR, pontosEm12Meses } from "@/lib/frota/multas";

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
      include: {
        documentos: true,
        ferias: { orderBy: { inicio: "asc" } },
        multas: { where: { dataInfracao: { gte: new Date(hoje.getTime() - 366 * 86_400_000) } }, select: { id: true, ait: true, placa: true, especificacao: true, condutorPessoaId: true, dataInfracao: true, pontos: true, situacao: true, responsavel: true, ehNic: true, valorCents: true }, orderBy: { dataInfracao: "desc" } },
      },
      orderBy: { nome: "asc" },
    }),
    controleDeFeriasDesde(companyId),
  ]);
  return {
    controleDesde,
    linhas: pessoas.map((p) => {
      const aptidao = aptidaoNaData(p, p.documentos, feriasNoDia(p.ferias, hoje), hoje) as Aptidao;
      // Os pontos das multas em 12 meses: aviso perto do limite de suspensão.
      const pontos = pontosEm12Meses(p.multas, p.id, hoje);
      if (pontos.pontos >= AVISO_PONTOS) aptidao.avisos.push(`${pontos.pontos} pontos em multas nos últimos 12 meses (suspende com ${LIMITE_PONTOS_EAR})`);
      return { ...p, aptidao, pontos, resumoFerias: resumoDeFerias(p.dataAdmissao, p.ferias, hoje, controleDesde) as ResumoFerias };
    }),
  };
}
export type LinhaMotorista = Awaited<ReturnType<typeof listarMotoristas>>["linhas"][number];
