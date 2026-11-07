"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { ITENS_FOLHA, lerCompetencia, podeMarcarItem } from "@/lib/controladoria/fechamentoFolha";
import { registrarEvento } from "@/lib/controladoria/trilha";
import { acessoDaSessao, exigirPermissao } from "../_dados";

// MARCAR UM ITEM DO FECHAMENTO DA FOLHA — feito ou desfeito, por empresa e
// competência. Cada item é de um responsável (RH, Financeiro, Contabilidade) e
// só quem tem a permissão dele marca. Marcar e desmarcar são LINHAS NOVAS (a
// tabela é só de acréscimo; o banco recusa alterar ou apagar), gravadas na
// mesma transação do evento da trilha: sem trilha, não há marca.

export async function marcarItemDaFolha(formData: FormData): Promise<void> {
  const session = await exigirPermissao("folha");
  const conexaoId = String(formData.get("conexaoId") ?? "");
  const competencia = String(formData.get("competencia") ?? "");
  const chave = String(formData.get("chave") ?? "");
  const feito = formData.get("feito") === "1";
  const observacao = String(formData.get("observacao") ?? "").trim().slice(0, 500) || null;

  const item = ITENS_FOLHA.find((i) => i.chave === chave);
  const c = lerCompetencia(competencia);
  if (!item || !c) return;
  const acesso = await acessoDaSessao(session);
  if (!podeMarcarItem(item, acesso.permissoes)) throw new Error(`Este item é do ${item.responsavel}: seu perfil não marca.`);
  const conexao = await prisma.omieConexao.findFirst({ where: { id: conexaoId, companyId: session.companyId }, select: { id: true, apelido: true } });
  if (!conexao) return;

  const onde = { companyId: session.companyId, conexaoId, competencia, chave };
  await prisma.$transaction(async (tx) => {
    const ultima = await tx.folhaFechamentoMarca.findFirst({ where: onde, orderBy: [{ feitoEm: "desc" }, { id: "desc" }], select: { acao: true } });
    // Desmarcar o que não está marcado (ou marcar de novo) não vira linha.
    if ((ultima?.acao ?? "desfeito") === (feito ? "feito" : "desfeito")) return;
    await tx.folhaFechamentoMarca.create({ data: { ...onde, acao: feito ? "feito" : "desfeito", feitoPor: session.name, feitoPorId: session.userId, observacao } });
    await registrarEvento({
      tx,
      companyId: session.companyId,
      userId: session.userId,
      userNome: session.name,
      userEmail: session.email,
      acao: feito ? "FOLHA_ITEM_FEITO" : "FOLHA_ITEM_DESFEITO",
      entidadeTipo: "FolhaFechamentoMarca",
      descricao: `${feito ? "Marcou" : "Desmarcou"} "${item.titulo(c)}" — ${conexao.apelido}, folha ${competencia}${observacao ? ` (${observacao})` : ""}`,
    });
  });
  revalidatePath("/folha");
  revalidatePath("/");
}
