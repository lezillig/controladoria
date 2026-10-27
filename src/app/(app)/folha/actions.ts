"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { ITENS_FOLHA, lerCompetencia } from "@/lib/controladoria/fechamentoFolha";
import { registrarEvento } from "@/lib/controladoria/trilha";
import { exigirPermissao } from "../_dados";

// MARCAR UM ITEM DO FECHAMENTO DA FOLHA — feito ou desfeito, por empresa e
// competência. Desmarcar apaga a marca; a trilha guarda as duas ações.

export async function marcarItemDaFolha(formData: FormData): Promise<void> {
  const session = await exigirPermissao("marcar-folha");
  const conexaoId = String(formData.get("conexaoId") ?? "");
  const competencia = String(formData.get("competencia") ?? "");
  const chave = String(formData.get("chave") ?? "");
  const feito = formData.get("feito") === "1";
  const observacao = String(formData.get("observacao") ?? "").trim().slice(0, 500) || null;

  const item = ITENS_FOLHA.find((i) => i.chave === chave);
  const c = lerCompetencia(competencia);
  if (!item || !c) return;
  const conexao = await prisma.omieConexao.findFirst({ where: { id: conexaoId, companyId: session.companyId }, select: { id: true, apelido: true } });
  if (!conexao) return;

  const onde = { companyId: session.companyId, conexaoId, competencia, chave };
  if (feito) {
    await prisma.folhaFechamentoMarca.upsert({
      where: { companyId_conexaoId_competencia_chave: onde },
      create: { ...onde, feitoPor: session.name, observacao },
      update: { feitoPor: session.name, feitoEm: new Date(), observacao },
    });
  } else {
    await prisma.folhaFechamentoMarca.deleteMany({ where: onde });
  }
  try {
    await registrarEvento({
      companyId: session.companyId,
      userId: session.userId,
      userNome: session.name,
      userEmail: session.email,
      acao: feito ? "FOLHA_ITEM_FEITO" : "FOLHA_ITEM_DESFEITO",
      entidadeTipo: "FolhaFechamentoMarca",
      descricao: `${feito ? "Marcou" : "Desmarcou"} "${item.titulo(c)}" — ${conexao.apelido}, folha ${competencia}${observacao ? ` (${observacao})` : ""}`,
    });
  } catch {
    // a marca já está gravada
  }
  revalidatePath("/folha");
  revalidatePath("/");
}
