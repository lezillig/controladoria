"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { garantirConfig } from "@/lib/controladoria/contexto";
import { parseLocalDate } from "@/lib/date";
import { registrarEvento } from "../auditoria/actions";
import { exigirPermissao } from "../_dados";

// Parâmetros do modelo de gestão financeira. São os números que transformam
// regra genérica em política DESTA empresa — sem alçada cadastrada, por
// exemplo, o agente antifraude não tem como saber que três pagamentos de
// R$ 9.900 no mesmo dia são fracionamento de um de R$ 29.700.

export type ResultadoConfig = { erro?: string; ok?: boolean };

function reaisParaCents(valor: string): number | null {
  const limpo = valor.trim().replace(/\./g, "").replace(",", ".");
  if (limpo === "") return null;
  const numero = Number(limpo);
  return Number.isFinite(numero) ? Math.round(numero * 100) : null;
}

export async function salvarConfiguracao(formData: FormData): Promise<ResultadoConfig> {
  const session = await exigirPermissao("gerir-modelo");
  const anterior = await garantirConfig(session.companyId);

  const emails = String(formData.get("emails") ?? "")
    .split(/[,;\s]+/)
    .map((e) => e.trim())
    .filter(Boolean);

  const invalidos = emails.filter((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  if (invalidos.length > 0) return { erro: `E-mail inválido: ${invalidos.join(", ")}` };

  const dataInicioBruta = String(formData.get("dataInicioBase") ?? "").trim();
  const dataInicioBase = dataInicioBruta ? parseLocalDate(dataInicioBruta) : anterior.dataInicioBase;
  if (Number.isNaN(dataInicioBase.getTime())) return { erro: "Data inicial da base inválida." };

  const limiteAlcadaCents = reaisParaCents(String(formData.get("limiteAlcada") ?? ""));
  const saldoMinimoCaixaCents = reaisParaCents(String(formData.get("saldoMinimo") ?? ""));

  const numero = (campo: string, padrao: number): number => {
    const bruto = String(formData.get(campo) ?? "").trim().replace(",", ".");
    const valor = bruto === "" ? padrao : Number(bruto);
    return Number.isFinite(valor) ? valor : padrao;
  };

  const metaMargemBruta = String(formData.get("metaMargem") ?? "").trim();
  const metaMargemPercent = metaMargemBruta === "" ? null : Number(metaMargemBruta.replace(",", "."));
  if (metaMargemPercent !== null && !Number.isFinite(metaMargemPercent)) {
    return { erro: "Meta de margem inválida." };
  }

  const toleranciaVariacaoPercent = numero("toleranciaVariacao", anterior.toleranciaVariacaoPercent);
  const diasAtrasoCritico = Math.round(numero("diasAtrasoCritico", anterior.diasAtrasoCritico));
  const limiteConcentracaoFornecedorPercent = numero(
    "limiteConcentracao",
    anterior.limiteConcentracaoFornecedorPercent
  );

  // Checkbox ausente no formulário significa desmarcado — o navegador
  // simplesmente não envia o campo.
  const relatorioAutomatico = formData.get("relatorioAutomatico") === "1";
  const retencoesNasDeducoes = formData.get("retencoesNasDeducoes") === "1";

  if (toleranciaVariacaoPercent < 0 || limiteConcentracaoFornecedorPercent <= 0 || diasAtrasoCritico < 1) {
    return { erro: "Os parâmetros percentuais e de prazo precisam ser positivos." };
  }

  const atualizada = await prisma.controladoriaConfig.update({
    where: { companyId: session.companyId },
    data: {
      emailsRelatorio: emails.join(", "),
      dataInicioBase,
      limiteAlcadaCents,
      saldoMinimoCaixaCents,
      metaMargemPercent,
      toleranciaVariacaoPercent,
      diasAtrasoCritico,
      limiteConcentracaoFornecedorPercent,
      relatorioAutomatico,
      retencoesNasDeducoes,
    },
  });

  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "CONFIG_ALTERADA",
    entidadeTipo: "ControladoriaConfig",
    entidadeId: atualizada.id,
    descricao: "Parâmetros do modelo de gestão financeira alterados.",
    antes: {
      emails: anterior.emailsRelatorio,
      dataInicioBase: anterior.dataInicioBase,
      limiteAlcadaCents: anterior.limiteAlcadaCents,
      saldoMinimoCaixaCents: anterior.saldoMinimoCaixaCents,
      metaMargemPercent: anterior.metaMargemPercent,
      toleranciaVariacaoPercent: anterior.toleranciaVariacaoPercent,
      diasAtrasoCritico: anterior.diasAtrasoCritico,
      limiteConcentracaoFornecedorPercent: anterior.limiteConcentracaoFornecedorPercent,
      relatorioAutomatico: anterior.relatorioAutomatico,
      retencoesNasDeducoes: anterior.retencoesNasDeducoes,
    },
    depois: {
      emails: atualizada.emailsRelatorio,
      dataInicioBase: atualizada.dataInicioBase,
      limiteAlcadaCents: atualizada.limiteAlcadaCents,
      saldoMinimoCaixaCents: atualizada.saldoMinimoCaixaCents,
      metaMargemPercent: atualizada.metaMargemPercent,
      toleranciaVariacaoPercent: atualizada.toleranciaVariacaoPercent,
      diasAtrasoCritico: atualizada.diasAtrasoCritico,
      limiteConcentracaoFornecedorPercent: atualizada.limiteConcentracaoFornecedorPercent,
      relatorioAutomatico: atualizada.relatorioAutomatico,
      retencoesNasDeducoes: atualizada.retencoesNasDeducoes,
    },
  });

  revalidatePath("/configuracao");
  revalidatePath("/");
  return { ok: true };
}
