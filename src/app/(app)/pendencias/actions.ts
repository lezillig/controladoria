"use server";

import { revalidatePath } from "next/cache";
import { decidirPendencia } from "@/lib/auditoria/pendencias";
import { exigirPermissao, acessoDaSessao } from "../_dados";

// DECIDIR UMA PENDÊNCIA — aprovar ou rejeitar, com comentário (obrigatório
// para rejeitar). Quem pode decidir: src/lib/auditoria/pendencias.ts.

export async function decidir(formData: FormData): Promise<void> {
  const session = await exigirPermissao("pendencias");
  const acesso = await acessoDaSessao(session);
  const decisao = formData.get("decisao") === "aprovada" ? "aprovada" : "rejeitada";
  await decidirPendencia({
    companyId: session.companyId,
    id: String(formData.get("id") ?? ""),
    decisao,
    comentario: String(formData.get("comentario") ?? "").slice(0, 1000) || null,
    usuario: session.name,
    papel: session.role,
    temPermissao: acesso.permissoes.has("decidir-pendencia"),
    perfis: acesso.perfilNome ? [acesso.perfilNome] : [],
  });
  revalidatePath("/pendencias");
}
