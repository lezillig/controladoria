"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { registrarEvento } from "@/lib/controladoria/trilha";
import { criarEstudo } from "@/lib/simulador/estudos";
import { tipoServicoProvavel } from "@/lib/radar/aderencia";
import { varrerPendentes, type ResultadoVarredura } from "@/lib/radar/varrer";
import { exigirPermissao } from "../../_dados";

// Decidir o que fazer com uma licitação do radar é trabalho do comercial
// ("gerir-simulador"); olhar a lista é de quem vê o simulador.

export type Resultado = { erro?: string; ok?: boolean; estudoId?: string; varredura?: ResultadoVarredura };

export async function varrerAgora(): Promise<Resultado> {
  const session = await exigirPermissao("gerir-simulador");
  const varredura = await varrerPendentes(session.companyId, 45_000);
  revalidatePath("/simulador/radar");
  return { ok: true, varredura };
}

const STATUS = ["NOVA", "ANALISANDO", "PARTICIPANDO", "DESCARTADA"] as const;

export async function decidir(id: string, status: string, motivo: string | null): Promise<Resultado> {
  const session = await exigirPermissao("gerir-simulador");
  if (!STATUS.includes(status as (typeof STATUS)[number])) return { erro: "Situação inválida." };
  const texto = motivo?.trim().slice(0, 500) || null;
  if (status === "DESCARTADA" && !texto) return { erro: "Diga por que a licitação foi descartada: é o que alimenta o filtro do radar." };
  const l = await prisma.radarLicitacao.findFirst({ where: { id, companyId: session.companyId }, select: { id: true, objeto: true } });
  if (!l) return { erro: "Licitação não encontrada." };
  await prisma.radarLicitacao.update({
    where: { id: l.id },
    data: { status, motivoDescarte: status === "DESCARTADA" ? texto : null, decididoPor: session.name, decididoEm: new Date() },
  });
  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "RADAR_LICITACAO_DECIDIDA",
    entidadeTipo: "RadarLicitacao",
    entidadeId: l.id,
    descricao: `Radar: "${l.objeto.slice(0, 120)}" marcada como ${status}${texto ? ` (${texto})` : ""}.`,
  });
  revalidatePath("/simulador/radar");
  return { ok: true };
}

// Abre um estudo de custo já com os dados do edital que o PNCP traz. Uma
// licitação gera no máximo um estudo: clicar de novo leva ao mesmo.
export async function abrirEstudo(id: string): Promise<Resultado> {
  const session = await exigirPermissao("gerir-simulador");
  const l = await prisma.radarLicitacao.findFirst({ where: { id, companyId: session.companyId } });
  if (!l) return { erro: "Licitação não encontrada." };
  if (l.estudoId) return { ok: true, estudoId: l.estudoId };
  const estudoId = await criarEstudo(
    session.companyId,
    {
      tipo: "LICITACAO",
      esfera: "PUBLICO",
      nome: `${l.municipio ?? l.orgaoNome} — ${l.modalidade} ${l.numeroCompra ?? ""}`.trim().slice(0, 200),
      cliente: l.orgaoNome,
      tipoServico: tipoServicoProvavel(l.objeto),
      uf: l.uf,
      municipio: l.municipio,
      descricao: `${l.objeto}\n\nPNCP: ${l.urlPncp}`,
      criterioJulgamento: "ITEM",
      unidadePreco: "KM",
      orgao: l.orgaoNome,
      numeroEdital: l.numeroCompra,
      modalidade: l.modalidade,
      dataSessao: l.aberturaPropostaEm ?? l.encerramentoPropostaEm,
      srp: l.srp,
      valorTotalMaximo: l.valorEstimadoCents != null ? Number(l.valorEstimadoCents) / 100 : null,
    },
    session.name
  );
  await prisma.radarLicitacao.update({
    where: { id: l.id },
    data: { estudoId, status: l.status === "NOVA" ? "ANALISANDO" : l.status, decididoPor: session.name, decididoEm: new Date() },
  });
  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "SIMULADOR_ESTUDO_CRIADO",
    entidadeTipo: "SimEstudo",
    entidadeId: estudoId,
    descricao: `Estudo criado a partir do radar de licitações (${l.numeroControle}).`,
  });
  revalidatePath("/simulador/radar");
  revalidatePath("/simulador");
  return { ok: true, estudoId };
}
