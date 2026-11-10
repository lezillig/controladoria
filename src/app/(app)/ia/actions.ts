"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { registrarEvento } from "@/lib/controladoria/trilha";
import { exigirPermissao } from "../_dados";

// Os freios da IA que roda sozinha. Quem altera é quem altera o modelo de
// gestão — é uma decisão de quanto a empresa aceita gastar sem ninguém clicar.
export async function salvarConfiguracaoDaIa(formData: FormData): Promise<void> {
  const session = await exigirPermissao("gerir-modelo");

  const numero = (campo: string): number | null => {
    const bruto = String(formData.get(campo) ?? "").trim().replace(/\./g, "").replace(",", ".");
    if (!bruto) return null;
    const n = Number(bruto);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const tetoUsd = numero("tetoMensalUsd");
  const porDia = numero("triagemPorDia");
  const orcamento = numero("orcamentoTokensParecer");

  const dados = {
    // Em branco = sem teto. Guardado em centavos de dólar.
    iaTetoMensalUsdCents: tetoUsd === null ? null : Math.round(tetoUsd * 100),
    iaTriagemAutomatica: formData.get("triagemAutomatica") === "1",
    iaTriagemPorDia: Math.min(20, Math.max(0, Math.round(porDia ?? 3))),
    iaParecerMensalAutomatico: formData.get("parecerMensalAutomatico") === "1",
    // Abaixo de 20 mil a API recusa; em branco ou menor que isso = desligado.
    iaOrcamentoTokensParecer: orcamento !== null && orcamento >= 20_000 ? Math.round(orcamento) : null,
  };

  const anterior = await prisma.controladoriaConfig.findUnique({
    where: { companyId: session.companyId },
    select: { iaTetoMensalUsdCents: true, iaTriagemAutomatica: true, iaTriagemPorDia: true, iaParecerMensalAutomatico: true, iaOrcamentoTokensParecer: true },
  });
  if (!anterior) redirect("/ia?erro=config");
  const atualizada = await prisma.controladoriaConfig.update({ where: { companyId: session.companyId }, data: dados });

  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "CONFIG_ALTERADA",
    entidadeTipo: "ControladoriaConfig",
    entidadeId: atualizada.id,
    descricao: "Limites da IA alterados (teto mensal, triagem automática, parecer mensal, orçamento de tokens).",
    antes: anterior,
    depois: dados,
  });

  revalidatePath("/ia");
  redirect("/ia?salvo=1#limites");
}
