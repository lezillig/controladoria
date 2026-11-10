"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { pedirParecerMensal } from "@/lib/controladoria/parecerMensal";
import { registrarEvento } from "@/lib/controladoria/trilha";
import { exigirPermissao, resolverEscopo } from "../_dados";

// Pedir um parecer custa uma chamada à IA (em lote, metade do preço): a mesma
// permissão de quem investiga.
export async function pedirParecer(formData: FormData): Promise<void> {
  const session = await exigirPermissao("investigar");
  const competencia = String(formData.get("competencia") ?? "");
  const escopo = await resolverEscopo(session.companyId, String(formData.get("empresa") ?? "") || undefined);
  const r = await pedirParecerMensal({
    companyId: session.companyId,
    conexaoId: escopo.conexaoId,
    empresa: escopo.apelido ?? "grupo (as duas empresas)",
    competencia,
    pedidoPor: session.name,
    userId: session.userId,
    refazer: formData.get("refazer") === "1",
  });
  if (!r.ok) redirect(`/parecer-mensal?erro=${encodeURIComponent(r.erro.slice(0, 200))}`);
  if (!r.jaExistia) {
    try {
      await registrarEvento({
        companyId: session.companyId,
        userId: session.userId,
        userNome: session.name,
        userEmail: session.email,
        acao: "INVESTIGACAO_IA",
        entidadeTipo: "ParecerMensal",
        entidadeId: r.id,
        descricao: `Parecer mensal de ${competencia} pedido${escopo.apelido ? ` (${escopo.apelido})` : " (grupo)"}`,
      });
    } catch {
      // A trilha não pode custar o pedido.
    }
  }
  revalidatePath("/parecer-mensal");
  redirect(`/parecer-mensal?id=${r.id}`);
}
