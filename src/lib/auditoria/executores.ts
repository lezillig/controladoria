import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// O QUE ACONTECE QUANDO UMA PENDÊNCIA É APROVADA (ADR-005): a ação proposta
// executa só depois da aprovação, e o resultado (executada ou erro) fica na
// própria pendência. Tipos sem executor são só registro de decisão — hoje,
// todos: os fluxos que mudavam cadastro de veículo, contrato, compra e multa
// são da gestão.

type Pendencia = { id: string; companyId: string; tipo: string; acaoProposta: Prisma.JsonValue; decididaPor: string | null };

const EXECUTORES: Record<string, (p: Pendencia) => Promise<string>> = {};

export async function executarPendencia(id: string): Promise<void> {
  const p = await prisma.audPendencia.findUnique({ where: { id } });
  if (!p || p.status !== "aprovada") return;
  const executor = EXECUTORES[p.tipo];
  if (!executor) return;
  try {
    const resumo = await executor(p);
    await prisma.audPendencia.update({ where: { id }, data: { status: "executada", executadaEm: new Date(), erro: null, comentario: [p.comentario, `Executada: ${resumo}`].filter(Boolean).join(" — ") } });
  } catch (e) {
    await prisma.audPendencia.update({ where: { id }, data: { status: "erro", erro: (e instanceof Error ? e.message : String(e)).slice(0, 500) } });
  }
}
