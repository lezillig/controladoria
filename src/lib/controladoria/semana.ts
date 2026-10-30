import { prisma } from "@/lib/prisma";
import { contratosComSituacao } from "@/lib/frota/contratosDaGestao";

// A SEMANA EM REVISTA (relatório de segunda-feira para a diretoria): o que se
// decidiu e o que está parado na fila de pendências, os achados que entraram
// e os que saíram, e as dívidas da frota em atraso na Omie. Entra no
// relatório diário das segundas — o mesmo e-mail, sem um segundo canal para
// a diretoria aprender a ignorar.

export type ResumoDaSemana = {
  inicio: Date;
  fim: Date;
  pendencias: { abertas: number; paradas: number; decididas: number; porPerfil: { perfil: string; abertas: number }[] };
  achados: { novos: number; resolvidos: number; abertos: number };
  financiamentos: { contratosEmAtraso: number; atrasadoCents: number; naoLancadas: number } | null;
};

const DIA = 86_400_000;

// Segunda-feira no horário de São Paulo (UTC−3).
export const ehSegunda = (d: Date) => new Date(d.getTime() - 3 * 3_600_000).getUTCDay() === 1;

export async function montarSemana(companyId: string, dataReferencia: Date): Promise<ResumoDaSemana> {
  const fim = dataReferencia;
  const inicio = new Date(fim.getTime() - 7 * DIA);
  const [abertas, decididas, novos, resolvidos, abertosAgora, financiamentos] = await Promise.all([
    prisma.audPendencia.findMany({ where: { companyId, status: "aguardando_aprovacao" }, select: { perfilAprovador: true, criadaEm: true } }),
    prisma.audPendencia.count({ where: { companyId, decididaEm: { gte: inicio, lte: fim } } }),
    prisma.auditFinding.count({ where: { companyId, detectadoEm: { gte: inicio, lte: fim } } }),
    prisma.auditFinding.count({ where: { companyId, resolvidoEm: { gte: inicio, lte: fim } } }),
    prisma.auditFinding.count({ where: { companyId, status: { in: ["ABERTO", "EM_ANALISE"] } } }),
    contratosComSituacao(companyId, fim).catch(() => ({ contratos: [], gestaoDisponivel: false })),
  ]);
  const porPerfil = new Map<string, number>();
  for (const p of abertas) porPerfil.set(p.perfilAprovador, (porPerfil.get(p.perfilAprovador) ?? 0) + 1);
  const ativos = financiamentos.contratos.filter((c) => !c.situacao.quitado);
  return {
    inicio,
    fim,
    pendencias: {
      abertas: abertas.length,
      paradas: abertas.filter((p) => p.criadaEm < inicio).length,
      decididas,
      porPerfil: [...porPerfil.entries()].map(([perfil, n]) => ({ perfil, abertas: n })).sort((a, b) => b.abertas - a.abertas),
    },
    achados: { novos, resolvidos, abertos: abertosAgora },
    financiamentos: financiamentos.gestaoDisponivel
      ? {
          contratosEmAtraso: ativos.filter((c) => c.situacao.atrasadas.quantidade > 0).length,
          atrasadoCents: ativos.reduce((s, c) => s + c.situacao.atrasadas.valorCents, 0),
          naoLancadas: ativos.reduce((s, c) => s + c.situacao.naoLancadas, 0),
        }
      : null,
  };
}
