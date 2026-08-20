"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { INDICADORES_BSC } from "@/lib/controladoria/bsc";
import { registrarEvento } from "../auditoria/actions";

// Metas do BSC. O catálogo de indicadores (o que é medido e como) vive em
// código; só a META vive no banco — porque meta é decisão da empresa e muda
// sem deploy, enquanto fórmula de indicador é regra de negócio versionada.

export async function salvarMeta(formData: FormData): Promise<void> {
  const session = await requireRole("ADMIN", "CONTROLADORIA");

  const codigo = String(formData.get("codigo") ?? "");
  const indicador = INDICADORES_BSC.find((i) => i.codigo === codigo);
  // Código fora do catálogo é tentativa de gravar meta para um indicador que
  // não existe — nada a fazer, e nada a explicar ao usuário (a tela só oferece
  // os códigos válidos).
  if (!indicador) return;

  const metaBruta = String(formData.get("meta") ?? "").trim();
  const toleranciaBruta = String(formData.get("tolerancia") ?? "").trim();

  // Campo vazio = remover a meta. O indicador continua sendo medido e
  // exibido, apenas sem farol — melhor que um farol baseado num número que
  // ninguém decidiu.
  if (metaBruta === "") {
    const anterior = await prisma.bscMeta.findUnique({
      where: { companyId_codigo: { companyId: session.companyId, codigo } },
    });
    if (anterior) {
      await prisma.bscMeta.delete({ where: { id: anterior.id } });
      await registrarEvento({
        companyId: session.companyId,
        userId: session.userId,
        userNome: session.name,
        userEmail: session.email,
        acao: "META_BSC_ALTERADA",
        entidadeTipo: "BscMeta",
        entidadeId: codigo,
        descricao: `Meta do indicador ${indicador.nome} removida.`,
        antes: { meta: anterior.meta, tolerancia: anterior.toleranciaPercent },
      });
    }
    revalidatePath("/bsc");
    return;
  }

  const meta = Number(metaBruta.replace(",", "."));
  const tolerancia = Number(toleranciaBruta.replace(",", ".") || "10");
  if (!Number.isFinite(meta) || !Number.isFinite(tolerancia) || tolerancia < 0) return;

  const anterior = await prisma.bscMeta.findUnique({
    where: { companyId_codigo: { companyId: session.companyId, codigo } },
  });

  await prisma.bscMeta.upsert({
    where: { companyId_codigo: { companyId: session.companyId, codigo } },
    create: {
      companyId: session.companyId,
      codigo,
      meta,
      toleranciaPercent: tolerancia,
      atualizadoPorUserId: session.userId,
    },
    update: { meta, toleranciaPercent: tolerancia, ativo: true, atualizadoPorUserId: session.userId },
  });

  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "META_BSC_ALTERADA",
    entidadeTipo: "BscMeta",
    entidadeId: codigo,
    descricao: `Meta do indicador ${indicador.nome} definida em ${meta} (tolerância ${tolerancia}%).`,
    antes: anterior ? { meta: anterior.meta, tolerancia: anterior.toleranciaPercent } : null,
    depois: { meta, tolerancia },
  });

  revalidatePath("/bsc");
  revalidatePath("/");
}
