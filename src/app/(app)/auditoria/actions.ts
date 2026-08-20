"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import type { AuditStatus } from "@prisma/client";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Tratativa de achado — a única ação humana do módulo que muda o estado de um
// alerta. Por isso ela, e não a leitura, é o que exige a permissão mais
// restrita (ver canManageControladoria) e o que sempre grava trilha.

const STATUS_PERMITIDOS: AuditStatus[] = ["ABERTO", "EM_ANALISE", "RESOLVIDO", "IGNORADO"];

export type ResultadoTratativa = { erro?: string; ok?: boolean };

export async function tratarAchado(formData: FormData): Promise<ResultadoTratativa> {
  // ADMIN e CONTROLADORIA tratam; GESTOR lê mas não desliga alerta —
  // separar "ver" de "poder encerrar" é o mínimo de segregação de função num
  // módulo cujo produto é apontar o erro de alguém.
  const session = await requireRole("ADMIN", "CONTROLADORIA");

  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "") as AuditStatus;
  const observacao = String(formData.get("observacao") ?? "").trim();

  if (!id) return { erro: "Achado não informado." };
  if (!STATUS_PERMITIDOS.includes(status)) return { erro: "Situação inválida." };

  // IGNORADO sem justificativa é como o controle interno morre: em três meses
  // ninguém lembra por que aquele alerta foi desligado, e a lista inteira
  // perde credibilidade. RESOLVIDO também exige, pelo mesmo motivo — é a
  // única evidência de que houve tratativa de verdade.
  if ((status === "IGNORADO" || status === "RESOLVIDO") && observacao.length < 10) {
    return { erro: "Descreva em poucas palavras o que foi verificado ou por que o achado não se aplica (mínimo 10 caracteres)." };
  }

  const achado = await prisma.auditFinding.findFirst({
    where: { id, companyId: session.companyId },
  });
  if (!achado) return { erro: "Achado não encontrado." };

  const atualizado = await prisma.auditFinding.update({
    where: { id: achado.id },
    data: {
      status,
      observacaoTratativa: observacao || null,
      tratadoPorUserId: session.userId,
      resolvidoEm: status === "RESOLVIDO" || status === "IGNORADO" ? new Date() : null,
    },
  });

  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "ACHADO_TRATADO",
    entidadeTipo: "AuditFinding",
    entidadeId: achado.id,
    descricao: `Achado "${achado.titulo}" passou de ${achado.status} para ${status}.`,
    antes: { status: achado.status, observacao: achado.observacaoTratativa },
    depois: { status: atualizado.status, observacao: atualizado.observacaoTratativa },
  });

  revalidatePath("/auditoria");
  revalidatePath("/");
  return { ok: true };
}

// Registro append-only de ação humana no módulo. Fica em função separada e
// reutilizável porque toda ação de escrita da Controladoria passa por ela —
// esquecer a trilha numa delas deixaria um buraco justamente onde a pergunta
// "quem desligou este alerta?" precisa de resposta.
export async function registrarEvento(params: {
  companyId: string;
  userId?: string | null;
  userNome?: string | null;
  userEmail?: string | null;
  acao: string;
  entidadeTipo?: string;
  entidadeId?: string;
  descricao: string;
  antes?: unknown;
  depois?: unknown;
}): Promise<void> {
  // IP e user-agent vêm do cabeçalho da requisição: sem eles, "quem" fica
  // registrado mas "de onde" não — e é justamente o que importa quando a
  // credencial em si é o que está sob suspeita.
  const cabecalhos = await headers();
  const ip =
    cabecalhos.get("x-forwarded-for")?.split(",")[0]?.trim() ?? cabecalhos.get("x-real-ip") ?? null;

  await prisma.controladoriaEventLog.create({
    data: {
      companyId: params.companyId,
      userId: params.userId ?? null,
      userNome: params.userNome ?? null,
      userEmail: params.userEmail ?? null,
      acao: params.acao,
      entidadeTipo: params.entidadeTipo ?? null,
      entidadeId: params.entidadeId ?? null,
      descricao: params.descricao,
      antes: params.antes === undefined ? undefined : JSON.parse(JSON.stringify(params.antes)),
      depois: params.depois === undefined ? undefined : JSON.parse(JSON.stringify(params.depois)),
      ip,
      userAgent: cabecalhos.get("user-agent")?.slice(0, 300) ?? null,
    },
  });
}
