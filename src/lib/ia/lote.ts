import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { clienteDaIa } from "./cliente";
import { registrarUso, type OrigemDoUso } from "./uso";

// PEDIDOS EM LOTE — metade do preço, sem ninguém esperando.
//
// A API tem uma fila assíncrona (Message Batches): o pedido entra, é atendido
// quando houver capacidade — em geral em menos de uma hora, no máximo em 24 —
// e custa 50% do preço normal. Serve para o que não tem uma pessoa olhando a
// tela: o parecer mensal do controller e a conferência da leitura de
// conformidade. Não serve para investigação com ferramentas (cada ida e volta
// seria um lote).
//
// Quem recolhe o resultado é a rota /api/cron/ia (o condutor do ciclo passa
// por ela a cada meia hora) e a própria tela que espera, ao abrir. O pedido
// fica em IaLote até lá; o que fazer com a resposta é de quem pediu (ver
// TRATADORES, no fim).
//
// O lote não aceita `fallbacks` (a cobertura do lado do servidor): uma recusa
// volta como recusa, e o tratador a mostra.

type ParametrosDaChamada = Anthropic.Beta.Messages.BatchCreateParams.Request["params"];

export type TipoDeLote = "parecer_mensal" | "conformidade_conferencia";

const ORIGEM_DO_TIPO: Record<TipoDeLote, OrigemDoUso> = {
  parecer_mensal: "parecer_mensal",
  conformidade_conferencia: "conformidade_conferencia",
};

export function isLoteDisponivel(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const cliente = () => clienteDaIa({ timeout: 120_000, maxRetries: 1 });

export async function enviarLote(p: {
  companyId: string;
  tipo: TipoDeLote;
  referenciaId: string;
  userId?: string | null;
  userNome?: string | null;
  params: ParametrosDaChamada;
  betas?: string[];
}): Promise<{ ok: true; loteId: string } | { ok: false; erro: string }> {
  if (!isLoteDisponivel()) return { ok: false, erro: "ANTHROPIC_API_KEY não configurada." };
  // A linha nasce antes do envio: se a função morrer entre o envio e a
  // gravação, sobra um pedido sem lote (que vira erro visível), e não um lote
  // pago que ninguém vai recolher.
  const lote = await prisma.iaLote.create({
    data: { companyId: p.companyId, tipo: p.tipo, referenciaId: p.referenciaId, userId: p.userId ?? null, userNome: p.userNome ?? null },
  });
  try {
    const enviado = await cliente().beta.messages.batches.create({
      requests: [{ custom_id: lote.id, params: p.params }],
      ...(p.betas?.length ? { betas: p.betas } : {}),
    });
    await prisma.iaLote.update({ where: { id: lote.id }, data: { batchId: enviado.id } });
    return { ok: true, loteId: lote.id };
  } catch (e) {
    const erro = e instanceof Anthropic.APIError ? `A API respondeu ${e.status ?? "sem status"}: ${e.message.slice(0, 300)}` : e instanceof Error ? e.message.slice(0, 300) : "erro desconhecido";
    await prisma.iaLote.update({ where: { id: lote.id }, data: { status: "ERRO", erro, concluidoEm: new Date() } });
    return { ok: false, erro };
  }
}

export type DesfechoDoLote = { ok: true; message: Anthropic.Beta.BetaMessage } | { ok: false; erro: string };

type Tratador = (lote: { id: string; companyId: string; referenciaId: string; userId: string | null; userNome: string | null }, desfecho: DesfechoDoLote) => Promise<void>;

// Carregados sob demanda: quem trata importa este arquivo para enviar, e um
// import estático nos dois sentidos fecharia um ciclo.
const TRATADORES: Record<TipoDeLote, () => Promise<Tratador>> = {
  parecer_mensal: async () => (await import("@/lib/controladoria/parecerMensal")).receberParecerMensal,
  conformidade_conferencia: async () => (await import("@/lib/conformidade/conferencia")).receberConferencia,
};

// Um pedido sem lote há mais de uma hora é um envio que morreu no meio.
const ENVIO_PERDIDO_MS = 60 * 60_000;

/** Recolhe os lotes que terminaram. Devolve quantos ainda estão na fila. */
export async function coletarLotes(filtro: { companyId?: string; tipo?: TipoDeLote; referenciaId?: string } = {}): Promise<{ coletados: number; pendentes: number }> {
  const abertos = await prisma.iaLote.findMany({
    where: { status: "ENVIADO", ...(filtro.companyId ? { companyId: filtro.companyId } : {}), ...(filtro.tipo ? { tipo: filtro.tipo } : {}), ...(filtro.referenciaId ? { referenciaId: filtro.referenciaId } : {}) },
    orderBy: { criadoEm: "asc" },
    take: 20,
  });
  if (abertos.length === 0 || !isLoteDisponivel()) return { coletados: 0, pendentes: abertos.length };

  const c = cliente();
  let coletados = 0;
  for (const lote of abertos) {
    const tipo = lote.tipo as TipoDeLote;
    const fechar = async (desfecho: DesfechoDoLote) => {
      // O tratador primeiro: se ele falhar, o lote continua ENVIADO e a
      // próxima coleta tenta de novo (o resultado fica 29 dias na API).
      await (await TRATADORES[tipo]())(lote, desfecho);
      await prisma.iaLote.update({
        where: { id: lote.id },
        data: { status: desfecho.ok ? "CONCLUIDO" : "ERRO", erro: desfecho.ok ? null : desfecho.erro, concluidoEm: new Date() },
      });
      coletados++;
    };
    try {
      if (!TRATADORES[tipo]) {
        await prisma.iaLote.update({ where: { id: lote.id }, data: { status: "ERRO", erro: `tipo de lote desconhecido: ${lote.tipo}`, concluidoEm: new Date() } });
        continue;
      }
      if (!lote.batchId) {
        if (Date.now() - lote.criadoEm.getTime() > ENVIO_PERDIDO_MS) await fechar({ ok: false, erro: "O envio não foi concluído. Peça de novo." });
        continue;
      }
      const situacao = await c.beta.messages.batches.retrieve(lote.batchId);
      if (situacao.processing_status !== "ended") continue;

      let desfecho: DesfechoDoLote = { ok: false, erro: "O lote terminou sem resultado para este pedido." };
      for await (const r of await c.beta.messages.batches.results(lote.batchId)) {
        if (r.custom_id !== lote.id) continue;
        if (r.result.type === "succeeded") {
          desfecho = { ok: true, message: r.result.message };
        } else if (r.result.type === "errored") {
          desfecho = { ok: false, erro: `A API recusou o pedido: ${JSON.stringify(r.result.error).slice(0, 300)}` };
        } else {
          desfecho = { ok: false, erro: r.result.type === "expired" ? "O pedido expirou na fila (24 horas). Peça de novo." : "O pedido foi cancelado." };
        }
      }
      await fechar(desfecho);
      // O uso só é registrado depois de o lote fechar: se o tratador falhar,
      // a próxima coleta repete tudo, e o custo não pode entrar duas vezes.
      if (desfecho.ok) {
        await registrarUso({
          companyId: lote.companyId,
          origem: ORIGEM_DO_TIPO[tipo],
          message: desfecho.message,
          userId: lote.userId,
          userNome: lote.userNome,
          referenciaTipo: "IaLote",
          referenciaId: lote.id,
          lote: true,
        });
      }
    } catch (e) {
      // Uma coleta que falha não fecha o lote: a próxima tenta de novo.
      console.warn(`[lote] coleta do lote ${lote.id} falhou: ${e instanceof Error ? e.message.slice(0, 200) : "erro desconhecido"}`);
    }
  }
  const pendentes = await prisma.iaLote.count({ where: { status: "ENVIADO", ...(filtro.companyId ? { companyId: filtro.companyId } : {}) } });
  return { coletados, pendentes };
}

/** O texto de uma resposta, com recusa e corte tratados antes de ler. */
export function textoDaResposta(message: Anthropic.Beta.BetaMessage): { ok: true; texto: string } | { ok: false; erro: string } {
  if (message.stop_reason === "refusal") {
    return { ok: false, erro: `O modelo recusou o pedido (categoria ${message.stop_details?.category ?? "não informada"}).` };
  }
  if (message.stop_reason === "max_tokens") return { ok: false, erro: "A resposta estourou o limite de tokens antes de fechar." };
  const texto = message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return texto ? { ok: true, texto } : { ok: false, erro: "O modelo não devolveu texto." };
}
