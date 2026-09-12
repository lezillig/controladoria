import type { AuditFinding, ControladoriaConfig } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { urlDoSistema } from "@/lib/appUrl";
import { enviarEmail, isEnvioDisponivel } from "@/lib/email/send";
import { montarPanorama } from "./analytics";
import { destinatarios } from "./contexto";
import { fmtBRL, fmtData } from "./format";
import type { ContextoAuditoria } from "./types";

// ALERTA POR EXCEÇÃO.
//
// O relatório diário existe para ser lido todo dia; o alerta existe para o
// contrário. Ele fica em silêncio enquanto nada muda e interrompe alguém no
// dia em que surge algo que não pode esperar o relatório: um achado CRÍTICO
// novo, ou o caixa projetado abaixo de zero.
//
// O que sustenta o silêncio é a memória do que já foi dito. Cada achado
// guarda quando foi alertado — alerta uma vez, no dia em que surge, e não
// todo dia enquanto estiver aberto. O caixa negativo é um estado, não um
// evento; repetido todo dia viraria ruído, e ruído é exatamente o que este
// e-mail existe para não ser. Repete só depois de uma carência.

// Dias entre dois alertas de caixa pela mesma razão.
export const CARENCIA_CAIXA_DIAS = 3;

export type AchadoParaAlerta = Pick<
  AuditFinding,
  "id" | "regra" | "titulo" | "severidade" | "valorCents" | "impactoCents" | "recomendacao" | "conexaoApelido" | "entidadeRef"
>;

export type ProjecaoParaAlerta = { dias: number; saldoProjetadoCents: number };

export type DecisaoDeAlerta = {
  achados: AchadoParaAlerta[];
  // O horizonte mais curto em que o caixa fica negativo, ou null.
  caixa: ProjecaoParaAlerta | null;
};

// A DECISÃO, pura: o que entra no alerta dado o que existe. Separada do envio
// para ser testável sem banco e sem e-mail — é aqui que mora a regra de
// "alertar uma vez", e é ela que não pode errar para nenhum dos lados.
export function decidirAlerta(params: {
  achadosCriticosAbertos: AchadoParaAlerta[];
  jaAlertados: Set<string>;
  projecao: ProjecaoParaAlerta[];
  ultimoAlertaCaixaEm: Date | null;
  agora: Date;
}): DecisaoDeAlerta {
  const achados = params.achadosCriticosAbertos.filter((a) => !params.jaAlertados.has(a.id));

  const negativos = params.projecao.filter((p) => p.saldoProjetadoCents < 0).sort((a, b) => a.dias - b.dias);
  const emCarencia =
    params.ultimoAlertaCaixaEm !== null &&
    params.agora.getTime() - params.ultimoAlertaCaixaEm.getTime() < CARENCIA_CAIXA_DIAS * 86_400_000;
  const caixa = negativos.length > 0 && !emCarencia ? negativos[0] : null;

  return { achados, caixa };
}

export type ResultadoAlerta = {
  enviado: boolean;
  motivo: string;
  achados: number;
  caixa: boolean;
};

export async function enviarAlertaPorExcecao(ctx: ContextoAuditoria): Promise<ResultadoAlerta> {
  const config: ControladoriaConfig = ctx.config;

  const abertos = await prisma.auditFinding.findMany({
    where: { companyId: ctx.companyId, status: { in: ["ABERTO", "EM_ANALISE"] }, severidade: "CRITICA" },
    orderBy: [{ impactoCents: "desc" }, { valorCents: "desc" }],
    select: {
      id: true, regra: true, titulo: true, severidade: true, valorCents: true, impactoCents: true,
      recomendacao: true, conexaoApelido: true, entidadeRef: true, alertadoEm: true,
    },
  });
  const jaAlertados = new Set(abertos.filter((a) => a.alertadoEm !== null).map((a) => a.id));

  const panorama = await montarPanorama(ctx);
  const decisao = decidirAlerta({
    achadosCriticosAbertos: abertos,
    jaAlertados,
    projecao: panorama.projecao,
    ultimoAlertaCaixaEm: config.ultimoAlertaCaixaEm,
    agora: ctx.agora,
  });

  if (decisao.achados.length === 0 && !decisao.caixa) {
    return { enviado: false, motivo: "nada novo a alertar", achados: 0, caixa: false };
  }

  const para = destinatarios(config);
  if (!isEnvioDisponivel() || para.length === 0) {
    // Sem canal, o alerta não sai — e as marcas NÃO são gravadas: no dia em
    // que o e-mail for configurado, o que ficou represado sai de uma vez.
    return {
      enviado: false,
      motivo: !isEnvioDisponivel() ? "envio de e-mail não configurado (RESEND_API_KEY)" : "nenhum destinatário no modelo de gestão",
      achados: decisao.achados.length,
      caixa: decisao.caixa !== null,
    };
  }

  const { assunto, html, texto } = montarAlerta(decisao, ctx.dataReferencia, panorama.saldoAtualCents);
  const envio = await enviarEmail({ para, assunto, html, texto });
  if (!envio.enviado) {
    return { enviado: false, motivo: envio.erro ?? "falha no envio", achados: decisao.achados.length, caixa: decisao.caixa !== null };
  }

  // As marcas só depois do envio confirmado. Marcar antes e falhar o envio
  // seria calar o alerta para sempre sobre achados que ninguém leu.
  const agora = new Date();
  if (decisao.achados.length > 0) {
    await prisma.auditFinding.updateMany({
      where: { id: { in: decisao.achados.map((a) => a.id) } },
      data: { alertadoEm: agora },
    });
  }
  if (decisao.caixa) {
    await prisma.controladoriaConfig.update({ where: { companyId: ctx.companyId }, data: { ultimoAlertaCaixaEm: agora } });
  }
  await prisma.controladoriaEventLog.create({
    data: {
      companyId: ctx.companyId,
      acao: "ALERTA_ENVIADO",
      descricao:
        `Alerta por exceção enviado para ${para.join(", ")}: ${decisao.achados.length} achado(s) crítico(s) novo(s)` +
        (decisao.caixa ? `; caixa projetado negativo em ${decisao.caixa.dias} dias (${fmtBRL(decisao.caixa.saldoProjetadoCents)})` : "") +
        ".",
      depois: { achados: decisao.achados.map((a) => a.id), caixa: decisao.caixa },
    },
  });

  return { enviado: true, motivo: `enviado para ${para.join(", ")}`, achados: decisao.achados.length, caixa: decisao.caixa !== null };
}

// Curto de propósito. Quem recebe um alerta às seis da manhã precisa saber em
// dez segundos o que aconteceu e onde clicar. Análise é no relatório.
export function montarAlerta(
  decisao: DecisaoDeAlerta,
  dataReferencia: Date,
  saldoAtualCents: number
): { assunto: string; html: string; texto: string } {
  const url = urlDoSistema();
  const partes: string[] = [];
  if (decisao.achados.length > 0) partes.push(`${decisao.achados.length} achado(s) crítico(s) novo(s)`);
  if (decisao.caixa) partes.push(`caixa negativo em ${decisao.caixa.dias} dias`);
  const assunto = `[Alerta] ${partes.join(" · ")} — ${fmtData(dataReferencia)}`;

  const esc = (t: string | null | undefined) =>
    (t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const fonte = "font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;";

  const linhasTexto: string[] = [`ALERTA POR EXCEÇÃO — dados de ${fmtData(dataReferencia)}`, ""];
  const blocos: string[] = [];

  if (decisao.caixa) {
    const c = decisao.caixa;
    linhasTexto.push(
      `CAIXA PROJETADO NEGATIVO: ${fmtBRL(c.saldoProjetadoCents)} em ${c.dias} dias (saldo atual ${fmtBRL(saldoAtualCents)}).`,
      "Projeção pelos títulos em aberto: o que vence a pagar menos o que vence a receber, sobre o saldo atual.",
      ""
    );
    blocos.push(`
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px 16px;margin-bottom:16px;">
        <div style="${fonte}font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#991b1b;">Caixa projetado negativo</div>
        <div style="${fonte}font-size:22px;font-weight:700;color:#991b1b;margin-top:4px;">${esc(fmtBRL(c.saldoProjetadoCents))} <span style="font-size:14px;font-weight:400;">em ${c.dias} dias</span></div>
        <div style="${fonte}font-size:13px;color:#7f1d1d;margin-top:4px;">Saldo atual ${esc(fmtBRL(saldoAtualCents))}. Projeção pelos títulos em aberto: o que vence a pagar menos o que vence a receber.</div>
      </div>`);
  }

  if (decisao.achados.length > 0) {
    linhasTexto.push(`ACHADOS CRÍTICOS NOVOS (${decisao.achados.length})`);
    const itens = decisao.achados.map((a) => {
      const valor = a.impactoCents ?? a.valorCents;
      const link = url ? `${url}/auditoria?achado=${a.id}` : null;
      linhasTexto.push(
        `- [${a.regra}${a.conexaoApelido ? ` · ${a.conexaoApelido}` : ""}] ${a.titulo}${valor ? ` — ${fmtBRL(valor)}` : ""}`,
        ...(a.recomendacao ? [`  Ação: ${a.recomendacao}`] : []),
        ...(link ? [`  ${link}`] : [])
      );
      return `
        <div style="padding:10px 0;border-top:1px solid #e2e8f0;">
          <div style="${fonte}font-size:11px;color:#64748b;">${esc(a.regra)}${a.conexaoApelido ? ` · ${esc(a.conexaoApelido)}` : ""}</div>
          <div style="${fonte}font-size:14px;font-weight:600;color:#0f172a;margin-top:2px;">${
            link ? `<a href="${esc(link)}" style="color:#1d4ed8;text-decoration:none;">${esc(a.titulo)}</a>` : esc(a.titulo)
          }${valor ? ` <span style="font-weight:400;color:#334155;">— ${esc(fmtBRL(valor))}</span>` : ""}</div>
          ${a.recomendacao ? `<div style="${fonte}font-size:13px;color:#334155;margin-top:2px;">${esc(a.recomendacao)}</div>` : ""}
        </div>`;
    });
    blocos.push(`
      <div style="${fonte}font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#64748b;margin-bottom:6px;">Achados críticos novos (${decisao.achados.length})</div>
      ${itens.join("")}`);
  }

  if (url) linhasTexto.push("", `Auditoria: ${url}/auditoria?severidade=CRITICA`);

  const html = `
  <div style="background:#f1f5f9;padding:24px 12px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">
      <tr><td style="background:#991b1b;padding:18px 20px;">
        <div style="${fonte}font-size:16px;font-weight:700;color:#ffffff;">Alerta por exceção</div>
        <div style="${fonte}font-size:12px;color:#fecaca;margin-top:2px;">Dados de ${esc(fmtData(dataReferencia))}. Este e-mail só sai quando algo novo exige atenção.</div>
      </td></tr>
      <tr><td style="padding:20px;">${blocos.join("")}</td></tr>
      ${url ? `<tr><td style="padding:0 20px 20px;"><a href="${esc(url)}/auditoria?severidade=CRITICA" style="${fonte}display:inline-block;background:#1d4ed8;color:#ffffff;font-size:13px;font-weight:600;padding:10px 16px;border-radius:8px;text-decoration:none;">Abrir a auditoria</a></td></tr>` : ""}
    </table>
  </div>`;

  return { assunto, html, texto: linhasTexto.join("\n") };
}
