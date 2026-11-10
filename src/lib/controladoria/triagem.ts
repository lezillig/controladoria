import { prisma } from "@/lib/prisma";
import { enviarEmail, isEnvioDisponivel } from "@/lib/email/send";
import { urlDoSistema } from "@/lib/appUrl";
import { situacaoDoTeto } from "@/lib/ia/uso";
import { destinatarios } from "./contexto";
import { fmtBRL } from "./format";
import { avancarInvestigacao, iniciarInvestigacao, isInvestigadorDisponivel } from "./investigador";

// TRIAGEM AUTOMÁTICA DE ACHADO CRÍTICO DE ANTIFRAUDE.
//
// Um achado crítico de fraude (boleto com a linha trocada, beneficiário que
// não é o fornecedor, título alterado depois de lançado) chegava de manhã como
// uma linha no alerta: o que a regra viu, e só. Quem recebe ainda tinha de
// abrir a tela, investigar e decidir se segurava o pagamento — e o pagamento
// do dia sai cedo.
//
// Aqui o ciclo da madrugada abre sozinho uma investigação para cada achado
// crítico novo dessa família, no especialista de auditoria, e o e-mail da
// manhã traz o que foi conferido e uma recomendação: SEGURAR, LIBERAR ou
// VERIFICAR. A DECISÃO CONTINUA DE UMA PESSOA: nenhuma ferramenta escreve, a
// triagem não trata o achado nem toca no título. É a mesma investigação da
// tela, com a mesma trilha de consultas, aberta mais cedo.
//
// Custa dinheiro sem ninguém clicar, então tem três freios: liga/desliga na
// configuração, um teto por dia, e o teto mensal da IA (situacaoDoTeto).

// A família de antifraude: todas as regras "FR-…". Só as CRÍTICAS, abertas e
// recentes — a triagem é para o que surgiu agora, não para o estoque.
const PREFIXO_DAS_REGRAS = "FR-";
const DIAS_DE_JANELA = 3;
// Abaixo disto o supervisor já marcou o achado como dependente de
// verificação; não vale um parecer pago em cima.
const CONFIANCA_MINIMA = 60;
export const ESPECIALISTA_DA_TRIAGEM = "auditor";

export type AchadoParaTriagem = {
  id: string;
  regra: string;
  titulo: string;
  descricao: string;
  conexaoId: string | null;
  conexaoApelido: string | null;
  entidadeRef: string | null;
  valorCents: number | null;
};

export function aberturaDaTriagem(a: AchadoParaTriagem): string {
  return [
    "TRIAGEM DE ACHADO CRÍTICO DE ANTIFRAUDE, aberta automaticamente pelo ciclo da madrugada. Ninguém está esperando na tela: o resultado vai por e-mail a quem decide o pagamento.",
    "",
    `Achado ${a.id} — regra ${a.regra}${a.entidadeRef ? ` — ${a.entidadeRef}` : ""}${a.valorCents != null ? ` — ${fmtBRL(a.valorCents)}` : ""}`,
    a.titulo,
    a.descricao,
    "",
    "O que fazer:",
    "1. Abra o achado (detalhar_achado) e leia a evidência.",
    "2. Confira com fontes independentes: os títulos e as baixas desse parceiro, o histórico dele (série mensal, banco e conta habituais), outros achados sobre a mesma entidade.",
    "3. Diga o que SUSTENTA a suspeita, o que a ENFRAQUECE e o que a base não permite conferir.",
    "",
    "Feche com uma única linha, exatamente neste formato, escolhendo uma das três palavras:",
    "RECOMENDAÇÃO: SEGURAR | LIBERAR | VERIFICAR — motivo em uma frase",
    "",
    "SEGURAR: os dados apontam risco real de pagamento indevido — não pagar antes de alguém confirmar com o fornecedor por um canal já conhecido.",
    "LIBERAR: os dados explicam o achado (por exemplo, a mudança de banco já aparece em pagamentos anteriores conferidos).",
    "VERIFICAR: os dados não decidem; diga exatamente o que uma pessoa precisa olhar.",
    "Na dúvida entre LIBERAR e VERIFICAR, é VERIFICAR.",
  ].join("\n");
}

function inicioDoDia(agora: Date): Date {
  return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
}

export type ResultadoDaTriagem = {
  abertas: number;
  emAndamento: number;
  concluidas: number;
  // Por que não abriu mais, quando não abriu.
  motivo: string | null;
  avisadas: number;
};

/** Abre as triagens que cabem hoje. Não chama o modelo. */
export async function abrirTriagens(companyId: string, agora = new Date()): Promise<{ abertas: number; motivo: string | null }> {
  if (!isInvestigadorDisponivel()) return { abertas: 0, motivo: "ANTHROPIC_API_KEY não configurada" };
  const config = await prisma.controladoriaConfig.findUnique({
    where: { companyId },
    select: { iaTriagemAutomatica: true, iaTriagemPorDia: true },
  });
  if (!config?.iaTriagemAutomatica) return { abertas: 0, motivo: "triagem automática desligada na configuração" };

  const teto = await situacaoDoTeto(companyId, agora);
  if (teto.estourado) return { abertas: 0, motivo: "teto mensal da IA atingido" };

  const hoje = await prisma.investigacao.count({ where: { companyId, origem: "TRIAGEM", criadoEm: { gte: inicioDoDia(agora) } } });
  const vagas = Math.max(0, config.iaTriagemPorDia - hoje);
  if (vagas === 0) return { abertas: 0, motivo: hoje > 0 ? null : "teto diário de triagens é zero" };

  const candidatos = await prisma.auditFinding.findMany({
    where: {
      companyId,
      severidade: "CRITICA",
      status: "ABERTO",
      regra: { startsWith: PREFIXO_DAS_REGRAS },
      confianca: { gte: CONFIANCA_MINIMA },
      detectadoEm: { gte: new Date(agora.getTime() - DIAS_DE_JANELA * 86_400_000) },
    },
    // O de maior valor primeiro: se o teto do dia cortar, corta o menor.
    orderBy: [{ valorCents: { sort: "desc", nulls: "last" } }, { detectadoEm: "desc" }],
    select: { id: true, regra: true, titulo: true, descricao: true, conexaoId: true, conexaoApelido: true, entidadeRef: true, valorCents: true },
    take: 50,
  });
  if (candidatos.length === 0) return { abertas: 0, motivo: null };
  const jaTriados = new Set(
    (await prisma.investigacao.findMany({ where: { companyId, origem: "TRIAGEM", achadoId: { in: candidatos.map((c) => c.id) } }, select: { achadoId: true } })).map((i) => i.achadoId)
  );

  let abertas = 0;
  for (const a of candidatos) {
    if (abertas >= vagas) break;
    if (jaTriados.has(a.id)) continue;
    await iniciarInvestigacao({
      companyId,
      conexaoId: a.conexaoId,
      empresa: a.conexaoApelido ?? "grupo (as duas empresas)",
      pergunta: `Triagem automática: ${a.titulo}`.slice(0, 2000),
      especialista: ESPECIALISTA_DA_TRIAGEM,
      userId: null,
      userNome: "Triagem automática",
      origem: "TRIAGEM",
      achadoId: a.id,
      abertura: aberturaDaTriagem(a),
    });
    abertas++;
  }
  return { abertas, motivo: null };
}

/** Avança UMA triagem em andamento (uma rodada), se houver. */
export async function avancarUmaTriagem(companyId: string): Promise<boolean> {
  const proxima = await prisma.investigacao.findFirst({
    where: { companyId, origem: "TRIAGEM", status: "EXECUTANDO" },
    orderBy: { criadoEm: "asc" },
    select: { id: true },
  });
  if (!proxima) return false;
  await avancarInvestigacao(proxima.id, companyId);
  return true;
}

const esc = (t: string | null | undefined) => (t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const ROTULO: Record<string, { texto: string; cor: string }> = {
  SEGURAR: { texto: "SEGURAR O PAGAMENTO", cor: "#b91c1c" },
  LIBERAR: { texto: "PODE LIBERAR", cor: "#047857" },
  VERIFICAR: { texto: "VERIFICAR ANTES DE PAGAR", cor: "#b45309" },
};

export type TriagemParaAviso = {
  id: string;
  achadoTitulo: string;
  regra: string;
  empresa: string;
  valorCents: number | null;
  status: string;
  recomendacao: string | null;
  resposta: string | null;
  erro: string | null;
  consultas: number;
};

export function montarAvisoDaTriagem(triagens: TriagemParaAviso[], url: string | null): { assunto: string; html: string; texto: string } {
  const segurar = triagens.filter((t) => t.recomendacao === "SEGURAR").length;
  const assunto =
    segurar > 0
      ? `Triagem de fraude: ${segurar} pagamento(s) para SEGURAR`
      : `Triagem de fraude: ${triagens.length} achado(s) crítico(s) conferido(s)`;
  const fonte = "font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;";
  const blocos = triagens.map((t) => {
    const r = ROTULO[t.recomendacao ?? "VERIFICAR"] ?? ROTULO.VERIFICAR;
    const corpo = t.status === "CONCLUIDA" ? t.resposta ?? "" : `A triagem não fechou: ${t.erro ?? "erro não informado"}. Confira o achado na tela.`;
    const link = url ? `${url}/auditoria/investigar?id=${t.id}` : null;
    return {
      html: `<tr><td style="${fonte}padding:16px 20px;border-top:1px solid #e2e8f0;">
        <div style="font-size:12px;font-weight:700;color:${r.cor};letter-spacing:.03em;">${r.texto}</div>
        <div style="font-size:15px;font-weight:600;color:#0f172a;margin-top:4px;">${esc(t.achadoTitulo)}</div>
        <div style="font-size:12px;color:#64748b;margin-top:2px;">${esc(t.regra)} · ${esc(t.empresa)}${t.valorCents != null ? ` · ${esc(fmtBRL(t.valorCents))}` : ""} · ${t.consultas} consulta(s) à base</div>
        <div style="font-size:13px;line-height:1.5;color:#334155;margin-top:8px;white-space:pre-wrap;">${esc(corpo)}</div>
        ${link ? `<div style="margin-top:8px;"><a href="${esc(link)}" style="font-size:13px;color:#1d4ed8;">Abrir a investigação com as consultas feitas</a></div>` : ""}
      </td></tr>`,
      texto: `${r.texto}\n${t.achadoTitulo}\n${t.regra} · ${t.empresa}${t.valorCents != null ? ` · ${fmtBRL(t.valorCents)}` : ""}\n\n${corpo}${link ? `\n\n${link}` : ""}`,
    };
  });
  const aviso =
    "A recomendação é de uma investigação automática sobre os dados do sistema. A decisão de pagar ou segurar é sua: na dúvida, confirme com o fornecedor por um telefone que você já conhecia.";
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;">
    <tr><td style="${fonte}padding:20px;"><div style="font-size:18px;font-weight:700;color:#0f172a;">Triagem dos achados críticos de fraude</div>
    <div style="font-size:13px;color:#475569;margin-top:6px;">${esc(aviso)}</div></td></tr>
    ${blocos.map((b) => b.html).join("\n")}
  </table>`;
  const texto = `Triagem dos achados críticos de fraude\n\n${aviso}\n\n${blocos.map((b) => b.texto).join("\n\n----------\n\n")}`;
  return { assunto, html, texto };
}

/** Manda o e-mail das triagens que fecharam e ainda não foram avisadas. */
export async function avisarTriagens(companyId: string): Promise<number> {
  // Só quando nenhuma está em andamento: um e-mail com tudo, não um por achado.
  const emAndamento = await prisma.investigacao.count({ where: { companyId, origem: "TRIAGEM", status: "EXECUTANDO" } });
  if (emAndamento > 0) return 0;
  const prontas = await prisma.investigacao.findMany({
    where: { companyId, origem: "TRIAGEM", status: { in: ["CONCLUIDA", "ERRO"] }, avisadaEm: null },
    orderBy: { criadoEm: "asc" },
    take: 20,
  });
  if (prontas.length === 0) return 0;
  const config = await prisma.controladoriaConfig.findUnique({ where: { companyId } });
  const para = config ? destinatarios(config) : [];
  // Sem canal, a marca NÃO é gravada: no dia em que o e-mail for configurado,
  // o que ficou represado sai. A triagem continua visível na tela.
  if (!isEnvioDisponivel() || para.length === 0) return 0;

  const achados = await prisma.auditFinding.findMany({
    where: { id: { in: prontas.map((p) => p.achadoId).filter((x): x is string => !!x) } },
    select: { id: true, titulo: true, regra: true, valorCents: true },
  });
  const porId = new Map(achados.map((a) => [a.id, a]));
  const { assunto, html, texto } = montarAvisoDaTriagem(
    prontas.map((p) => {
      const a = p.achadoId ? porId.get(p.achadoId) : undefined;
      return {
        id: p.id,
        achadoTitulo: a?.titulo ?? p.pergunta,
        regra: a?.regra ?? "—",
        empresa: p.empresa,
        valorCents: a?.valorCents ?? null,
        status: p.status,
        recomendacao: p.recomendacao,
        resposta: p.resposta,
        erro: p.erro,
        consultas: Array.isArray(p.consultas) ? p.consultas.length : 0,
      };
    }),
    urlDoSistema()
  );
  const envio = await enviarEmail({ para, assunto, html, texto });
  if (!envio.enviado) return 0;
  await prisma.investigacao.updateMany({ where: { id: { in: prontas.map((p) => p.id) } }, data: { avisadaEm: new Date() } });
  return prontas.length;
}
