import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { registrarAlteracao } from "./trilha";

// A FILA ÚNICA DE DECISÕES (AudPendencia) — ADR-005 do azul-gestao: agente ou
// carga propõe com evidências; uma pessoa do perfil aprovador aprova ou
// rejeita, com comentário; a decisão vai para a trilha.

export const PERFIS_APROVADORES = ["admin", "gestor", "operacao", "financeiro", "rh"] as const;
export type PerfilAprovador = (typeof PERFIS_APROVADORES)[number];
export const SEVERIDADES = ["baixa", "media", "alta", "critica"] as const;

// Quem decide: ADMIN decide tudo. Os demais precisam da permissão de decidir
// e de corresponder ao perfil aprovador — pelo papel da gestão ou pelo nome de
// um perfil de acesso atribuído (ex.: perfil "Financeiro" decide pendência de
// `financeiro`). "gestor" aceita qualquer GESTOR.
const PAPEL_DO_PERFIL: Record<string, string[]> = {
  gestor: ["GESTOR"],
  operacao: ["GESTOR"],
  financeiro: ["CONTROLADORIA"],
  rh: ["FOLHA"],
  admin: [],
};
// Os nomes de perfil de acesso que valem por cada perfil aprovador.
const ALIAS_DO_PERFIL: Record<string, string[]> = {
  admin: ["diretoria", "administr", "admin"],
  gestor: ["gestor", "gerente", "diretoria"],
  operacao: ["operac", "frota", "trafego", "documenta"],
  financeiro: ["financ"],
  rh: ["rh", "recursos humanos", "departamento pessoal", "dp"],
};
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function podeDecidir(p: { papel: string; temPermissao: boolean; perfis: string[]; perfilAprovador: string }): boolean {
  if (p.papel === "ADMIN") return true;
  if (!p.temPermissao) return false;
  if ((PAPEL_DO_PERFIL[p.perfilAprovador] ?? []).includes(p.papel)) return true;
  const nomes = ALIAS_DO_PERFIL[p.perfilAprovador] ?? [semAcento(p.perfilAprovador)];
  return p.perfis.some((n) => nomes.some((a) => semAcento(n).startsWith(a)));
}

export type NovaPendencia = {
  companyId: string;
  agente?: string | null;
  tipo: string;
  titulo: string;
  descricao?: string | null;
  severidade?: (typeof SEVERIDADES)[number];
  evidencias?: Prisma.InputJsonValue;
  acaoProposta?: Prisma.InputJsonValue;
  perfilAprovador: PerfilAprovador;
  chaveExcecao?: string | null;
};

// Idempotente pela chave da exceção: se já há uma aguardando com a mesma
// chave, devolve essa (e não abre outra).
export async function criarPendencia(p: NovaPendencia): Promise<{ id: string; nova: boolean }> {
  if (p.chaveExcecao) {
    const aberta = await prisma.audPendencia.findFirst({
      where: { companyId: p.companyId, chaveExcecao: p.chaveExcecao, status: "aguardando_aprovacao" },
      select: { id: true },
    });
    if (aberta) return { id: aberta.id, nova: false };
  }
  const criada = await prisma.audPendencia.create({
    data: {
      companyId: p.companyId,
      agente: p.agente ?? null,
      tipo: p.tipo,
      titulo: p.titulo,
      descricao: p.descricao ?? null,
      severidade: p.severidade ?? "media",
      evidencias: p.evidencias,
      acaoProposta: p.acaoProposta,
      perfilAprovador: p.perfilAprovador,
      chaveExcecao: p.chaveExcecao ?? null,
    },
    select: { id: true },
  });
  return { id: criada.id, nova: true };
}

export async function decidirPendencia(p: {
  companyId: string;
  id: string;
  decisao: "aprovada" | "rejeitada";
  comentario: string | null;
  usuario: string;
  papel: string;
  temPermissao: boolean;
  perfis: string[];
}): Promise<{ ok: true } | { ok: false; erro: string }> {
  const pend = await prisma.audPendencia.findFirst({ where: { id: p.id, companyId: p.companyId } });
  if (!pend) return { ok: false, erro: "Pendência não encontrada." };
  if (pend.status !== "aguardando_aprovacao") return { ok: false, erro: "Esta pendência já foi decidida." };
  if (!podeDecidir({ papel: p.papel, temPermissao: p.temPermissao, perfis: p.perfis, perfilAprovador: pend.perfilAprovador })) {
    return { ok: false, erro: `Só o perfil ${pend.perfilAprovador} (ou um administrador) decide esta pendência.` };
  }
  if (p.decisao === "rejeitada" && !p.comentario?.trim()) return { ok: false, erro: "Para rejeitar, escreva o motivo." };
  // QUEM PEDIU NÃO APROVA (segregação de funções); o administrador pode,
  // porque em empresa pequena às vezes é a mesma pessoa — e fica na trilha.
  const solicitante = (pend.evidencias as { solicitadoPor?: string } | null)?.solicitadoPor;
  if (p.decisao === "aprovada" && solicitante && solicitante === p.usuario && p.papel !== "ADMIN") return { ok: false, erro: "Quem pediu não aprova: outra pessoa do perfil aprovador precisa decidir." };
  const agora = new Date();
  await prisma.$transaction(async (tx) => {
    // Condicional no status: duas pessoas decidindo ao mesmo tempo, só uma vale.
    const r = await tx.audPendencia.updateMany({
      where: { id: pend.id, status: "aguardando_aprovacao" },
      data: { status: p.decisao, decididaPor: p.usuario, decididaEm: agora, comentario: p.comentario?.trim() || null },
    });
    if (r.count === 0) throw new Error("Esta pendência já foi decidida.");
    await registrarAlteracao(tx, {
      companyId: p.companyId,
      usuario: p.usuario,
      tabela: "AudPendencia",
      registroId: pend.id,
      operacao: "update",
      antes: { status: pend.status },
      depois: { status: p.decisao, comentario: p.comentario?.trim() || null },
    });
  });
  if (p.decisao === "aprovada") {
    const { executarPendencia } = await import("./executores");
    await executarPendencia(pend.id);
  }
  return { ok: true };
}
