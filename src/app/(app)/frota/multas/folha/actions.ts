"use server";

import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { redigir } from "@/lib/controladoria/falhas";
import { registrarAlteracao } from "@/lib/auditoria/trilha";
import { lerEventosDeMulta } from "@/lib/frota/fechamentoMultas";
import { eventosParaContabilidade, gravarEventosDaFolha } from "@/lib/frota/fechamentoMultasNoBanco";
import { exigirPermissao } from "../../../_dados";

// O DESCONTO DE MULTA NA FOLHA, do lado do RH: marcar os eventos da
// competência como mandados à Contabilidade e, depois de processada a folha,
// subir o relatório de eventos para conferir. O arquivo não fica guardado —
// só as linhas de evento de multa.

type Resposta = { erro?: string; ok?: boolean; resumo?: string };
const lerCompetencia = (v: FormDataEntryValue | null) => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(v ?? ""));
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)) : null;
};

export async function marcarEventosEnviados(fd: FormData): Promise<Resposta> {
  const session = await exigirPermissao("gerir-motoristas");
  try {
    const competencia = lerCompetencia(fd.get("competencia"));
    if (!competencia) return { erro: "Competência inválida." };
    const eventos = await eventosParaContabilidade(session.companyId, competencia);
    const ids = eventos.flatMap((e) => e.ids);
    if (!ids.length) return { erro: "Não há descontos aprovados para essa competência." };
    const agora = new Date();
    await prisma.frotaMulta.updateMany({ where: { id: { in: ids }, companyId: session.companyId, descontoEnviadoEm: null }, data: { descontoEnviadoEm: agora } });
    await registrarAlteracao(prisma, { companyId: session.companyId, usuario: session.name, tabela: "FrotaMulta", registroId: `eventos:${competencia.toISOString().slice(0, 7)}`, operacao: "update", depois: { descontoEnviadoEm: agora, multas: ids.length } });
    revalidatePath("/frota/multas/folha");
    return { ok: true, resumo: `${ids.length} multa(s) marcadas como mandadas à Contabilidade.` };
  } catch (e) {
    return { erro: redigir(e instanceof Error ? e.message : "erro").slice(0, 300) };
  }
}

export async function importarFolhaProcessada(fd: FormData): Promise<Resposta> {
  const session = await exigirPermissao("gerir-motoristas");
  try {
    const competencia = lerCompetencia(fd.get("competencia"));
    if (!competencia) return { erro: "Competência inválida." };
    const f = fd.get("arquivo");
    if (!(f instanceof File) || f.size === 0) return { erro: "Escolha o relatório de eventos da folha." };
    if (f.size > 8 * 1024 * 1024) return { erro: "Arquivo acima de 8 MB." };
    const livro = new ExcelJS.Workbook();
    try {
      await livro.xlsx.load((await f.arrayBuffer()) as ArrayBuffer);
    } catch {
      return { erro: "Não consegui abrir: envie em .xlsx (exportado do sistema de folha)." };
    }
    const lido = lerEventosDeMulta(livro);
    if (lido.erro) return { erro: lido.erro };
    const { resultado } = await gravarEventosDaFolha(session.companyId, competencia, lido.linhas, f.name, session.name);
    revalidatePath("/frota/multas/folha");
    const ok = resultado.filter((r) => r.situacao === "ok").length;
    return { ok: true, resumo: `${lido.lidas} eventos lidos, ${lido.linhas.length} de multa. ${ok} motorista(s) batem, ${resultado.length - ok} com divergência.` };
  } catch (e) {
    return { erro: redigir(e instanceof Error ? e.message : "erro").slice(0, 300) };
  }
}
