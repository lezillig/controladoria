import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// OS NÚMEROS DO PAINEL DE USO DA IA. Um filtro só (`ondeDoUso`) serve os
// cartões, os quadros e a lista: é o que garante que a lista aberta por um
// cartão soma exatamente o número do cartão.

export type FiltroDoUso = {
  companyId: string;
  // AAAA-MM
  mes: string;
  origem?: string;
  modelo?: string;
  // Nome de quem pediu; "(automático)" = sem pessoa (ciclo, triagem).
  usuario?: string;
  lote?: boolean;
};

export const SEM_USUARIO = "(automático)";

export function mesValido(mes: string | undefined): mes is string {
  return !!mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(mes);
}

export function mesCorrente(agora = new Date()): string {
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
}

export function ondeDoUso(f: FiltroDoUso): Prisma.IaUsoWhereInput {
  const [ano, mes] = f.mes.split("-").map(Number);
  return {
    companyId: f.companyId,
    criadoEm: { gte: new Date(ano, mes - 1, 1), lt: new Date(ano, mes, 1) },
    ...(f.origem ? { origem: f.origem } : {}),
    ...(f.modelo ? { modelo: f.modelo } : {}),
    ...(f.usuario ? { userNome: f.usuario === SEM_USUARIO ? null : f.usuario } : {}),
    ...(f.lote !== undefined ? { lote: f.lote } : {}),
  };
}

export type GrupoDoUso = { chave: string; chamadas: number; microUsd: number };

async function agrupar(where: Prisma.IaUsoWhereInput, campo: "origem" | "modelo" | "userNome"): Promise<GrupoDoUso[]> {
  const grupos = await prisma.iaUso.groupBy({ by: [campo], where, _count: { _all: true }, _sum: { custoMicroUsd: true } });
  return grupos
    .map((g) => ({ chave: (g[campo] as string | null) ?? SEM_USUARIO, chamadas: g._count._all, microUsd: g._sum.custoMicroUsd ?? 0 }))
    .sort((a, b) => b.microUsd - a.microUsd);
}

export async function resumoDoUso(f: FiltroDoUso) {
  const where = ondeDoUso(f);
  const [total, emLote, estimadas, porOrigem, porModelo, porUsuario] = await Promise.all([
    prisma.iaUso.aggregate({ where, _count: { _all: true }, _sum: { custoMicroUsd: true, entradaTokens: true, saidaTokens: true, cacheLidoTokens: true } }),
    prisma.iaUso.aggregate({ where: { ...where, lote: true }, _count: { _all: true }, _sum: { custoMicroUsd: true } }),
    prisma.iaUso.count({ where: { ...where, precoEstimado: true } }),
    agrupar(where, "origem"),
    agrupar(where, "modelo"),
    agrupar(where, "userNome"),
  ]);
  return {
    microUsd: total._sum.custoMicroUsd ?? 0,
    chamadas: total._count._all,
    entradaTokens: total._sum.entradaTokens ?? 0,
    saidaTokens: total._sum.saidaTokens ?? 0,
    cacheLidoTokens: total._sum.cacheLidoTokens ?? 0,
    loteMicroUsd: emLote._sum.custoMicroUsd ?? 0,
    loteChamadas: emLote._count._all,
    estimadas,
    porOrigem,
    porModelo,
    porUsuario,
  };
}

export async function chamadasDoUso(f: FiltroDoUso, limite = 200) {
  const where = ondeDoUso(f);
  const [linhas, soma] = await Promise.all([
    prisma.iaUso.findMany({ where, orderBy: { criadoEm: "desc" }, take: limite }),
    prisma.iaUso.aggregate({ where, _count: { _all: true }, _sum: { custoMicroUsd: true } }),
  ]);
  return { linhas, total: soma._count._all, microUsd: soma._sum.custoMicroUsd ?? 0 };
}

function percentil(ordenados: number[], p: number): number {
  if (ordenados.length === 0) return 0;
  return ordenados[Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1)];
}

// Tokens de SAÍDA por parecer de especialista nos últimos 90 dias — a medida
// de onde sai o orçamento de tokens (iaOrcamentoTokensParecer): a orientação
// da API é partir do percentil 90 do uso real, não de um palpite.
const ORIGENS_DE_PARECER = ["auditor", "controller", "custos", "orcamento", "precificacao", "triagem", "segunda_opiniao"];

export async function tokensPorParecer(companyId: string, agora = new Date()): Promise<{ pareceres: number; mediana: number; p90: number }> {
  const grupos = await prisma.iaUso.groupBy({
    by: ["referenciaId"],
    where: { companyId, referenciaTipo: "Investigacao", origem: { in: ORIGENS_DE_PARECER }, criadoEm: { gte: new Date(agora.getTime() - 90 * 86_400_000) } },
    _sum: { saidaTokens: true },
  });
  const totais = grupos.map((g) => g._sum.saidaTokens ?? 0).sort((a, b) => a - b);
  return { pareceres: totais.length, mediana: percentil(totais, 50), p90: percentil(totais, 90) };
}
