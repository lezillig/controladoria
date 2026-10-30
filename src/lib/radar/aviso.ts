import { prisma } from "@/lib/prisma";
import { enviarEmail, isEnvioDisponivel } from "@/lib/email/send";
import { urlDoSistema } from "@/lib/appUrl";

// E-MAIL DO RADAR — sai depois da varredura das 07:50, só quando há o que
// dizer: licitação nova no radar (cada uma uma vez) ou proposta que o
// comercial está tocando e fecha em até DIAS_DE_PRAZO dias (todo dia, até
// fechar: prazo de licitação perdido não tem recurso).

export const DIAS_DE_PRAZO = 3;

export type ItemDoAviso = {
  id: string;
  aderencia: string;
  status: string;
  municipio: string | null;
  uf: string | null;
  orgaoNome: string;
  objeto: string;
  modalidade: string;
  encerramentoPropostaEm: Date | null;
  valorEstimadoCents: bigint | null;
  urlPncp: string;
};

export function destinatariosDoRadar(texto: string): string[] {
  return [...new Set(texto.split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];
}

const esc = (t: string | null | undefined) => (t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const reais = (c: bigint | null) => (c == null ? null : (Number(c) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }));
// Brasília, deslocamento fixo (sem horário de verão desde 2019).
const quando = (d: Date | null) => {
  if (!d) return "sem prazo informado";
  const b = new Date(d.getTime() - 3 * 3_600_000).toISOString();
  return `${b.slice(8, 10)}/${b.slice(5, 7)} ${b.slice(11, 16)}`;
};
const curto = (t: string, n = 180) => (t.length > n ? `${t.slice(0, n)}…` : t);

export function montarAviso(novas: ItemDoAviso[], prazos: ItemDoAviso[], url: string | null): { assunto: string; html: string; texto: string } {
  const altas = novas.filter((n) => n.aderencia === "ALTA");
  const medias = novas.filter((n) => n.aderencia !== "ALTA");
  const partes: string[] = [];
  if (altas.length) partes.push(`${altas.length} licitação(ões) nova(s) de transporte`);
  if (medias.length) partes.push(`${medias.length} para conferir`);
  if (prazos.length) partes.push(`${prazos.length} proposta(s) fechando em até ${DIAS_DE_PRAZO} dias`);
  const assunto = `[Radar de licitações] ${partes.join(" · ")}`;
  const tela = url ? `${url}/simulador/radar` : null;
  const fonte = "font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;";

  const linha = (i: ItemDoAviso) =>
    `<div style="padding:10px 0;border-top:1px solid #e2e8f0;">
      <div style="${fonte}font-size:12px;color:#64748b;">${esc(i.municipio ?? "—")}/${esc(i.uf ?? "—")} · ${esc(i.orgaoNome)} · ${esc(i.modalidade)}</div>
      <div style="${fonte}font-size:14px;color:#0f172a;margin-top:2px;"><a href="${esc(i.urlPncp)}" style="color:#1d4ed8;text-decoration:none;">${esc(curto(i.objeto))}</a></div>
      <div style="${fonte}font-size:12px;color:#334155;margin-top:2px;">Proposta até <strong>${esc(quando(i.encerramentoPropostaEm))}</strong>${reais(i.valorEstimadoCents) ? ` · estimado ${esc(reais(i.valorEstimadoCents))}` : ""}</div>
    </div>`;
  const bloco = (titulo: string, itens: ItemDoAviso[], cor: string) =>
    itens.length
      ? `<div style="margin-bottom:18px;"><div style="${fonte}font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${cor};">${esc(titulo)}</div>${itens.map(linha).join("")}</div>`
      : "";
  const html = `<div style="max-width:640px;">
    ${bloco(`Proposta fechando em até ${DIAS_DE_PRAZO} dias`, prazos, "#991b1b")}
    ${bloco("Novas — serviço de transporte", altas, "#065f46")}
    ${bloco("Novas — só citam ônibus, van ou locação (conferir)", medias, "#92400e")}
    ${tela ? `<p style="${fonte}font-size:13px;"><a href="${esc(tela)}" style="color:#1d4ed8;">Abrir o radar</a> para abrir estudo, participar ou descartar.</p>` : ""}
  </div>`;

  const txt = (i: ItemDoAviso) =>
    `- ${i.municipio ?? "—"}/${i.uf ?? "—"} (${i.orgaoNome}): ${curto(i.objeto)} — proposta até ${quando(i.encerramentoPropostaEm)} — ${i.urlPncp}`;
  const texto = [
    prazos.length ? `PROPOSTA FECHANDO EM ATÉ ${DIAS_DE_PRAZO} DIAS\n${prazos.map(txt).join("\n")}\n` : "",
    altas.length ? `NOVAS — SERVIÇO DE TRANSPORTE\n${altas.map(txt).join("\n")}\n` : "",
    medias.length ? `NOVAS — CONFERIR\n${medias.map(txt).join("\n")}\n` : "",
    tela ? `Radar: ${tela}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { assunto, html, texto };
}

const SELECAO = {
  id: true, aderencia: true, status: true, municipio: true, uf: true, orgaoNome: true, objeto: true,
  modalidade: true, encerramentoPropostaEm: true, valorEstimadoCents: true, urlPncp: true,
} as const;

export async function enviarAvisoDoRadar(companyId: string, agora = new Date()): Promise<{ enviado: boolean; motivo: string }> {
  const config = await prisma.controladoriaConfig.findUnique({ where: { companyId }, select: { emailsRadar: true } });
  const para = destinatariosDoRadar(config?.emailsRadar ?? "");
  if (para.length === 0) return { enviado: false, motivo: "nenhum destinatário do radar cadastrado" };
  if (!isEnvioDisponivel()) return { enviado: false, motivo: "envio de e-mail não configurado (RESEND_API_KEY)" };

  const [novas, prazos] = await Promise.all([
    prisma.radarLicitacao.findMany({
      where: { companyId, status: "NOVA", avisadoEm: null, OR: [{ encerramentoPropostaEm: null }, { encerramentoPropostaEm: { gte: agora } }] },
      orderBy: [{ aderencia: "asc" }, { encerramentoPropostaEm: "asc" }],
      select: SELECAO,
      take: 60,
    }),
    prisma.radarLicitacao.findMany({
      where: {
        companyId,
        status: { in: ["ANALISANDO", "PARTICIPANDO"] },
        encerramentoPropostaEm: { gte: agora, lte: new Date(agora.getTime() + DIAS_DE_PRAZO * 86_400_000) },
      },
      orderBy: { encerramentoPropostaEm: "asc" },
      select: SELECAO,
    }),
  ]);
  if (novas.length === 0 && prazos.length === 0) return { enviado: false, motivo: "nada novo nem prazo perto" };

  const { assunto, html, texto } = montarAviso(novas, prazos, urlDoSistema());
  const envio = await enviarEmail({ para, assunto, html, texto });
  if (!envio.enviado) return { enviado: false, motivo: envio.erro ?? "falha no envio" };
  // Marca só depois do envio confirmado: marcar antes e falhar calaria a
  // licitação para sempre.
  if (novas.length) await prisma.radarLicitacao.updateMany({ where: { id: { in: novas.map((n) => n.id) } }, data: { avisadoEm: new Date() } });
  return { enviado: true, motivo: `enviado para ${para.join(", ")}` };
}
