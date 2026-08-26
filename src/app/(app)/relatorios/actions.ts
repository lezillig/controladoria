"use server";

import { revalidatePath } from "next/cache";
import { conciliarConformidade } from "@/lib/conformidade/conciliacao";
import { carregarConformidade } from "@/lib/conformidade/panorama";
import { dataReferenciaPadrao } from "@/lib/controladoria/ciclo";
import { carregarContexto, janelaDeAuditoria } from "@/lib/controladoria/contexto";
import { executarAuditoria } from "@/lib/controladoria/engine";
import { gerarEEnviarRelatorio } from "@/lib/controladoria/relatorio";
import { parseLocalDate } from "@/lib/date";
import { registrarEvento } from "../auditoria/actions";
import { exigirPermissao } from "../_dados";

// Geração manual do relatório. O caminho normal é o agendamento diário; este
// existe para reenviar um dia que falhou no envio, para gerar o relatório de
// uma data específica (fechamento, reunião) e para ver como ficou antes de
// mandar para a diretoria.

export type ResultadoGeracao = {
  erro?: string;
  relatorioId?: string;
  enviado?: boolean;
  destinatarios?: string[];
  achados?: number;
  narrativa?: boolean;
};

export async function gerarRelatorioAgora(formData: FormData): Promise<ResultadoGeracao> {
  const session = await exigirPermissao("sincronizar");

  const enviar = formData.get("enviar") === "1";
  const dataBruta = String(formData.get("data") ?? "").trim();
  const dataReferencia = dataBruta ? parseLocalDate(dataBruta) : dataReferenciaPadrao();

  if (Number.isNaN(dataReferencia.getTime())) return { erro: "Data inválida." };
  if (dataReferencia > new Date()) return { erro: "Não é possível gerar relatório de uma data futura." };

  try {
    const ctx = await carregarContexto(session.companyId, dataReferencia, undefined, {
      desde: janelaDeAuditoria(dataReferencia),
    });

    // Roda a auditoria antes de montar o relatório: gerar o relatório sobre
    // achados de ontem, com dados de hoje, produziria um documento que não
    // corresponde a nenhum momento real da empresa.
    await executarAuditoria(ctx);
    // Mesma ordem do ciclo diário (ver ciclo.ts): a conciliação com os
    // apontamentos da consultoria depende dos achados já persistidos.
    await conciliarConformidade(session.companyId);
    // O contexto foi montado antes da auditoria, então os vínculos recém-criados
    // ainda não estão nele. Só esta parte é recarregada — refazer o contexto
    // inteiro custaria uma segunda leitura completa da base para atualizar três
    // listas. No ciclo diário isso não é preciso: lá o relatório é outra
    // invocação, com contexto novo.
    ctx.conformidade = await carregarConformidade(session.companyId);

    const resultado = await gerarEEnviarRelatorio(ctx, { enviar });

    await registrarEvento({
      companyId: session.companyId,
      userId: session.userId,
      userNome: session.name,
      userEmail: session.email,
      acao: enviar ? "RELATORIO_ENVIADO" : "RELATORIO_MANUAL",
      entidadeTipo: "RelatorioDiario",
      entidadeId: resultado.relatorioId,
      descricao: enviar
        ? `Relatório de ${dataReferencia.toLocaleDateString("pt-BR")} gerado e enviado para ${resultado.destinatarios.join(", ")}.`
        : `Relatório de ${dataReferencia.toLocaleDateString("pt-BR")} gerado sem envio.`,
    });

    revalidatePath("/relatorios");

    return {
      relatorioId: resultado.relatorioId,
      enviado: resultado.enviado,
      destinatarios: resultado.destinatarios,
      achados: resultado.achadosTotal,
      narrativa: resultado.narrativaGerada,
      erro: resultado.erro ?? undefined,
    };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Falha ao gerar o relatório." };
  }
}
