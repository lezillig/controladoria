import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { enviarEmail, isEnvioDisponivel } from "@/lib/email/send";
import { urlDoSistema } from "@/lib/appUrl";
import { enviarLote, isLoteDisponivel, textoDaResposta, type DesfechoDoLote } from "@/lib/ia/lote";
import { mascararDocumentosNoTexto } from "@/lib/ia/mascara";
import { situacaoDoTeto } from "@/lib/ia/uso";
import { destinatarios } from "./contexto";
import { MODELO_ESPECIALISTA } from "./especialistas";
import { ferramentasDeAnalise } from "./ferramentasDeAnalise";
import { fmtBRL } from "./format";
import type { ConsultaFeita } from "./investigador";

// PARECER MENSAL DO CONTROLLER — o mês inteiro em uma leitura.
//
// O relatório diário diz o que mudou de ontem para hoje; os pareceres dos
// especialistas respondem a uma pergunta. Faltava a peça que um controller
// entrega no fechamento: o resultado do mês contra os anteriores, o caixa, o
// que a auditoria apontou e continua sem correção, e as decisões que isso
// pede.
//
// COMO OS NÚMEROS CHEGAM AO MODELO. O briefing é montado chamando as mesmas
// consultas que os especialistas usam (ferramentasDeAnalise) — que por sua vez
// são as funções das telas. Nada é calculado aqui. O texto que vai ao modelo
// fica guardado no parecer (`briefing`), e a tela o mostra: qualquer número
// citado tem de estar lá.
//
// POR QUE EM LOTE. Ninguém espera este parecer na tela — ele é pedido quando o
// mês vira e lido de manhã. Em lote custa metade (ver src/lib/ia/lote.ts).

export const ParecerSchema = z.object({
  resumoExecutivo: z.string().describe("De três a cinco frases: o que aconteceu no mês e o que pede decisão. Sem preâmbulo."),
  resultado: z
    .array(z.object({ titulo: z.string(), texto: z.string().describe("O que mudou, com os números do briefing, e a causa provável — dizendo quando é hipótese.") }))
    .max(6)
    .describe("Os movimentos do resultado que importam: receita, custos por linha, margem. Do maior para o menor em dinheiro."),
  caixa: z.string().describe("O que está em aberto a receber e a pagar por faixa de atraso, e o que isso significa para o mês seguinte."),
  achadosNaoCorrigidos: z.string().describe("O que a auditoria apontou há mais de 30 dias e continua aberto: quanto dinheiro, quais regras, o que trava."),
  achadosDoMes: z.string().describe("O que surgiu e o que foi resolvido no mês, por severidade."),
  decisoes: z
    .array(z.object({ decisao: z.string(), porque: z.string(), dadoQueSustenta: z.string().describe("O número do briefing que sustenta a decisão.") }))
    .max(3)
    .describe("No máximo três decisões para a diretoria, da mais urgente para a menos."),
  limitacoes: z.array(z.string()).max(6).describe("O que a base não permitiu concluir (mês ainda em formação, categoria sem classificação, dado ausente)."),
});
export type Parecer = z.infer<typeof ParecerSchema>;

const SYSTEM_PROMPT = `Você é o controller de um grupo brasileiro de fretamento e transporte de passageiros. Escreve o parecer mensal para a diretoria.

O que você recebe é o briefing do mês: resultado, DRE, comparativos, série de doze meses, ranking de fornecedores e clientes, títulos em aberto por faixa de atraso, a estratégia de custo e a situação dos achados de auditoria. Todos os números já foram calculados pelo sistema, pelas mesmas funções das telas.

Regras do parecer:
- Use somente números que estão no briefing, como estão escritos. Não some, não estime, não arredonde para outro valor. Se a conclusão pede um número que não está lá, diga que a base não traz.
- Cada afirmação sobre causa é uma hipótese até o dado mostrar: escreva "provável", "a verificar" quando for o caso.
- Compare sempre: contra o mês anterior, contra o mesmo mês do ano passado e contra a média da série, quando o briefing traz.
- O leitor é a diretoria, não a contabilidade: frases completas, sem jargão, o mais importante primeiro.
- As decisões são no máximo três, concretas, com dono possível (Financeiro, Operação, Comercial, RH) e o número que as sustenta.
- Responda em português do Brasil.`;

function rotuloDaCompetencia(competencia: string): string {
  const [ano, mes] = competencia.split("-").map(Number);
  return new Date(ano, mes - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

export function competenciaValida(c: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(c);
}

/** O mês anterior ao de `agora`, em AAAA-MM. */
export function competenciaAnterior(agora = new Date()): string {
  const d = new Date(agora.getFullYear(), agora.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// As consultas do briefing, na ordem em que aparecem. Cada uma é uma
// ferramenta dos especialistas, chamada aqui pelo sistema e não pelo modelo.
const CONSULTAS_DO_BRIEFING: { titulo: string; ferramenta: string; entrada: (competencia: string) => Record<string, unknown> }[] = [
  { titulo: "Resultado do mês", ferramenta: "resultado_do_periodo", entrada: (competencia) => ({ competencia }) },
  { titulo: "Comparativo (mês anterior e mesmo mês do ano passado)", ferramenta: "comparativo", entrada: () => ({}) },
  { titulo: "DRE do mês, com as principais categorias de cada linha", ferramenta: "dre", entrada: (competencia) => ({ competencia, categoriasPorLinha: 6 }) },
  { titulo: "Série de doze meses", ferramenta: "serie_de_resultado", entrada: () => ({ meses: 12 }) },
  { titulo: "Maiores fornecedores do mês", ferramenta: "ranking_parceiros", entrada: (competencia) => ({ natureza: "PAGAR", competencia, limite: 15 }) },
  { titulo: "Maiores clientes do mês", ferramenta: "ranking_parceiros", entrada: (competencia) => ({ natureza: "RECEBER", competencia, limite: 15 }) },
  { titulo: "Em aberto por faixa de atraso", ferramenta: "em_aberto_por_faixa", entrada: () => ({}) },
  { titulo: "Estratégia de custo (categorias por prioridade)", ferramenta: "estrategia_de_custo", entrada: () => ({ limite: 15 }) },
];

async function achadosParaOBriefing(companyId: string, conexaoId: string | null, inicio: Date, fim: Date): Promise<string> {
  const escopo = { companyId, ...(conexaoId ? { conexaoId } : {}) };
  const abertos = { ...escopo, status: { in: ["ABERTO", "EM_ANALISE"] as ("ABERTO" | "EM_ANALISE")[] } };
  const ha30Dias = new Date(fim.getTime() - 30 * 86_400_000);
  const [porSeveridade, surgiram, resolvidos, antigos] = await Promise.all([
    prisma.auditFinding.groupBy({ by: ["severidade"], where: abertos, _count: { _all: true }, _sum: { valorCents: true, impactoCents: true } }),
    prisma.auditFinding.groupBy({ by: ["severidade"], where: { ...escopo, detectadoEm: { gte: inicio, lte: fim } }, _count: { _all: true } }),
    prisma.auditFinding.count({ where: { ...escopo, resolvidoEm: { gte: inicio, lte: fim } } }),
    prisma.auditFinding.findMany({
      where: { ...abertos, detectadoEm: { lt: ha30Dias }, severidade: { in: ["CRITICA", "ALTA"] } },
      orderBy: [{ impactoCents: { sort: "desc", nulls: "last" } }, { valorCents: { sort: "desc", nulls: "last" } }],
      take: 15,
      select: { regra: true, severidade: true, titulo: true, entidadeRef: true, valorCents: true, impactoCents: true, detectadoEm: true, ocorrencias: true, responsavel: true, status: true },
    }),
  ]);
  const dinheiro = (c: number | null | undefined) => (c == null ? "sem valor" : fmtBRL(c));
  const linhas: string[] = [];
  linhas.push("Abertos hoje, por severidade:");
  for (const g of porSeveridade) linhas.push(`- ${g.severidade}: ${g._count._all} achado(s), valor ${dinheiro(g._sum.valorCents)}, impacto evitável ${dinheiro(g._sum.impactoCents)}`);
  if (porSeveridade.length === 0) linhas.push("- nenhum achado aberto");
  linhas.push("", `Surgiram no mês: ${surgiram.map((g) => `${g._count._all} ${g.severidade}`).join(", ") || "nenhum"}. Resolvidos no mês: ${resolvidos}.`);
  linhas.push("", `Críticos e altos abertos há mais de 30 dias (${antigos.length} maiores):`);
  for (const a of antigos) {
    const dias = Math.round((fim.getTime() - a.detectadoEm.getTime()) / 86_400_000);
    linhas.push(
      `- [${a.severidade}] ${a.regra} — ${a.titulo}${a.entidadeRef ? ` (${a.entidadeRef})` : ""} — valor ${dinheiro(a.valorCents)}, impacto ${dinheiro(a.impactoCents)} — aberto há ${dias} dias, ${a.ocorrencias} ocorrência(s)${a.responsavel ? `, com ${a.responsavel}` : ", sem responsável"}${a.status === "EM_ANALISE" ? ", em análise" : ""}`
    );
  }
  if (antigos.length === 0) linhas.push("- nenhum");
  return linhas.join("\n");
}

export async function montarBriefingMensal(params: { companyId: string; conexaoId: string | null; empresa: string; competencia: string }): Promise<string> {
  const [ano, mes] = params.competencia.split("-").map(Number);
  const inicio = new Date(ano, mes - 1, 1);
  // A data de referência das consultas é o último dia do mês: é ela que faz
  // "o mês" e "os doze meses" serem os do parecer, e não os de hoje.
  const fim = new Date(ano, mes, 0, 23, 59, 59);
  const consultas: ConsultaFeita[] = [];
  const ferramentas = ferramentasDeAnalise({ companyId: params.companyId, conexaoId: params.conexaoId }, consultas, fim);
  // Cada ferramenta tem o seu tipo de entrada; aqui elas são chamadas pelo
  // nome, com a entrada conferida pelo `parse` da própria ferramenta.
  type Consulta = { name: string; parse: (entrada: unknown) => unknown; run: (entrada: unknown) => unknown };
  const porNome = new Map((ferramentas as unknown as Consulta[]).map((f) => [f.name, f]));

  const partes: string[] = [`# Parecer mensal — ${rotuloDaCompetencia(params.competencia)} — ${params.empresa}`];
  for (const c of CONSULTAS_DO_BRIEFING) {
    const f = porNome.get(c.ferramenta);
    let saida: string;
    try {
      if (!f) throw new Error("consulta indisponível");
      const r = await f.run(f.parse(c.entrada(params.competencia)));
      saida = typeof r === "string" ? r : JSON.stringify(r);
    } catch (e) {
      // Uma consulta que falha não derruba o parecer: o briefing diz que ela
      // faltou, e o modelo é instruído a apontar o que a base não trouxe.
      saida = `(consulta não disponível: ${e instanceof Error ? e.message.slice(0, 160) : "erro desconhecido"})`;
    }
    partes.push(`## ${c.titulo}\n${saida}`);
  }
  partes.push(`## Achados de auditoria\n${await achadosParaOBriefing(params.companyId, params.conexaoId, inicio, fim)}`);
  return mascararDocumentosNoTexto(partes.join("\n\n"));
}

// O pedido do parecer, separado de quem o envia (o lote, em produção; a
// régua, para comparar modelos e níveis de esforço com o mesmo prompt).
export function pedidoDoParecer(briefing: string, opcoes: { modelo?: string; esforco?: "low" | "medium" | "high" | "xhigh" } = {}) {
  return {
    model: opcoes.modelo ?? MODELO_ESPECIALISTA,
    // Teto para raciocínio + parecer. É anteparo, não controle de custo.
    max_tokens: 32000,
    output_config: { effort: opcoes.esforco ?? ("high" as const), format: betaZodOutputFormat(ParecerSchema) },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user" as const, content: `${briefing}\n\nEscreva o parecer mensal.` }],
  };
}

export type PedidoDeParecer = { ok: true; id: string; jaExistia: boolean } | { ok: false; erro: string };

export async function pedirParecerMensal(params: {
  companyId: string;
  conexaoId: string | null;
  empresa: string;
  competencia: string;
  pedidoPor: string;
  userId?: string | null;
  // Refaz um parecer que já existe (pronto ou com erro).
  refazer?: boolean;
}): Promise<PedidoDeParecer> {
  if (!competenciaValida(params.competencia)) return { ok: false, erro: "Competência inválida (use AAAA-MM)." };
  if (params.competencia > competenciaAnterior()) return { ok: false, erro: "O parecer é do mês fechado: escolha um mês que já terminou." };
  if (!isLoteDisponivel()) return { ok: false, erro: "ANTHROPIC_API_KEY não configurada." };
  const recorte = params.conexaoId ?? "grupo";
  const chave = { companyId_recorte_competencia: { companyId: params.companyId, recorte, competencia: params.competencia } };

  const existente = await prisma.parecerMensal.findUnique({ where: chave, select: { id: true, status: true } });
  if (existente && (existente.status === "AGUARDANDO" || !params.refazer)) return { ok: true, id: existente.id, jaExistia: true };

  const briefing = await montarBriefingMensal(params);
  const dados = { empresa: params.empresa, status: "AGUARDANDO", briefing, modelo: null, erro: null, pedidoPor: params.pedidoPor, concluidoEm: null };
  const parecer = existente
    ? await prisma.parecerMensal.update({ where: { id: existente.id }, data: { ...dados, parecer: Prisma.DbNull, criadoEm: new Date() } })
    : await prisma.parecerMensal.create({ data: { companyId: params.companyId, recorte, competencia: params.competencia, ...dados } });

  const envio = await enviarLote({
    companyId: params.companyId,
    tipo: "parecer_mensal",
    referenciaId: parecer.id,
    userId: params.userId ?? null,
    userNome: params.pedidoPor,
    params: pedidoDoParecer(briefing),
  });
  if (!envio.ok) {
    await prisma.parecerMensal.update({ where: { id: parecer.id }, data: { status: "ERRO", erro: envio.erro, concluidoEm: new Date() } });
    return { ok: false, erro: envio.erro };
  }
  return { ok: true, id: parecer.id, jaExistia: false };
}

/** Chamado pela coleta de lotes quando o parecer voltou (ou falhou). */
export async function receberParecerMensal(lote: { companyId: string; referenciaId: string }, desfecho: DesfechoDoLote): Promise<void> {
  const falhar = (erro: string) => prisma.parecerMensal.update({ where: { id: lote.referenciaId }, data: { status: "ERRO", erro, concluidoEm: new Date() } });
  if (!desfecho.ok) return void (await falhar(desfecho.erro));
  const texto = textoDaResposta(desfecho.message);
  if (!texto.ok) return void (await falhar(texto.erro));
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto.texto);
  } catch {
    return void (await falhar("O parecer não veio no formato esperado. Peça de novo."));
  }
  const lido = ParecerSchema.safeParse(bruto);
  if (!lido.success) return void (await falhar("O parecer não veio no formato esperado. Peça de novo."));

  const parecer = await prisma.parecerMensal.update({
    where: { id: lote.referenciaId },
    data: { status: "PRONTO", parecer: lido.data, modelo: desfecho.message.model, erro: null, concluidoEm: new Date() },
  });
  await avisarParecerPronto(lote.companyId, parecer, lido.data).catch(() => undefined);
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function avisarParecerPronto(companyId: string, parecer: { id: string; competencia: string; empresa: string }, conteudo: Parecer): Promise<void> {
  const config = await prisma.controladoriaConfig.findUnique({ where: { companyId } });
  const para = config ? destinatarios(config) : [];
  if (!isEnvioDisponivel() || para.length === 0) return;
  const url = urlDoSistema();
  const link = url ? `${url}/parecer-mensal?id=${parecer.id}` : null;
  const titulo = `Parecer mensal do controller — ${rotuloDaCompetencia(parecer.competencia)} — ${parecer.empresa}`;
  const decisoes = conteudo.decisoes.map((d, i) => `${i + 1}. ${d.decisao} — ${d.porque}`);
  const fonte = "font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;";
  const html = `<div style="${fonte}max-width:640px;margin:0 auto;color:#0f172a;">
    <h2 style="font-size:18px;margin:0 0 8px;">${esc(titulo)}</h2>
    <p style="font-size:14px;line-height:1.55;color:#334155;white-space:pre-wrap;">${esc(conteudo.resumoExecutivo)}</p>
    ${decisoes.length ? `<p style="font-size:13px;font-weight:700;margin:16px 0 4px;">Decisões propostas</p><ol style="font-size:14px;line-height:1.55;color:#334155;padding-left:20px;margin:0;">${conteudo.decisoes.map((d) => `<li><strong>${esc(d.decisao)}</strong> — ${esc(d.porque)}</li>`).join("")}</ol>` : ""}
    ${link ? `<p style="margin-top:16px;"><a href="${esc(link)}" style="font-size:14px;color:#1d4ed8;">Ler o parecer inteiro, com os números que o sustentam</a></p>` : ""}
  </div>`;
  const texto = `${titulo}\n\n${conteudo.resumoExecutivo}${decisoes.length ? `\n\nDecisões propostas\n${decisoes.join("\n")}` : ""}${link ? `\n\n${link}` : ""}`;
  await enviarEmail({ para, assunto: titulo, html, texto });
}

// O dia do mês a partir do qual o parecer é pedido sozinho. Antes disso o mês
// anterior ainda está recebendo lançamento: nota emitida no dia 30 entra na
// Omie nos primeiros dias, e um parecer sobre o mês pela metade erra o
// resultado para baixo.
export const DIA_DO_PARECER_AUTOMATICO = 6;

// Quem assina o pedido que o sistema faz sozinho. É por este nome que a nova
// tentativa reconhece um pedido que é dela para refazer.
export const PEDIDO_AUTOMATICO = "Pedido automático";

// De quanto em quanto tempo o pedido automático que falhou tenta de novo. Um
// dia, com folga para o condutor que atrasa: a chave trocada de manhã vale no
// ciclo seguinte, e uma chave que continua recusada custa uma tentativa por
// dia, não uma a cada meia hora.
const ESPERA_PARA_TENTAR_DE_NOVO_MS = 20 * 60 * 60_000;
// Tentativa que a API aceitou é tentativa paga. Duas que terminaram em erro
// (resposta fora do formato, recusa) não melhoram na terceira: daí em diante
// quem decide pedir de novo é uma pessoa, na tela.
const MAXIMO_DE_TENTATIVAS_PAGAS = 2;

export type PedidoAutomatico = { pedido: boolean; aviso: string | null };

/**
 * O parecer do mês que fechou, pedido sozinho a partir do dia 6.
 *
 * O PEDIDO QUE FALHOU TENTA DE NOVO. No primeiro ciclo de produção a API
 * recusou a chave; o pedido ficou gravado com erro e, como "já existia", o
 * automático nunca mais tentaria naquele mês — mesmo depois de a chave ser
 * trocada. Agora o pedido automático com erro é refeito uma vez por dia. O
 * que uma pessoa pediu e falhou continua sendo dela para pedir de novo.
 */
export async function pedirParecerDoMesSeCouber(companyId: string, agora = new Date()): Promise<PedidoAutomatico> {
  const nada: PedidoAutomatico = { pedido: false, aviso: null };
  if (agora.getDate() < DIA_DO_PARECER_AUTOMATICO) return nada;
  const config = await prisma.controladoriaConfig.findUnique({ where: { companyId }, select: { iaParecerMensalAutomatico: true } });
  if (!config?.iaParecerMensalAutomatico || !isLoteDisponivel()) return nada;
  const competencia = competenciaAnterior(agora);
  const existe = await prisma.parecerMensal.findUnique({
    where: { companyId_recorte_competencia: { companyId, recorte: "grupo", competencia } },
    select: { id: true, status: true, pedidoPor: true, concluidoEm: true },
  });
  if (existe) {
    const falhouSozinho = existe.status === "ERRO" && existe.pedidoPor === PEDIDO_AUTOMATICO;
    const esperou = existe.concluidoEm !== null && agora.getTime() - existe.concluidoEm.getTime() >= ESPERA_PARA_TENTAR_DE_NOVO_MS;
    if (!falhouSozinho || !esperou) return nada;
    const pagas = await prisma.iaLote.count({ where: { companyId, tipo: "parecer_mensal", referenciaId: existe.id, batchId: { not: null } } });
    if (pagas >= MAXIMO_DE_TENTATIVAS_PAGAS) return nada;
  }
  if ((await situacaoDoTeto(companyId, agora)).estourado) return { pedido: false, aviso: "teto mensal da IA atingido" };
  const r = await pedirParecerMensal({
    companyId,
    conexaoId: null,
    empresa: "grupo (as duas empresas)",
    competencia,
    pedidoPor: PEDIDO_AUTOMATICO,
    refazer: Boolean(existe),
  });
  return r.ok ? { pedido: true, aviso: null } : { pedido: false, aviso: r.erro };
}
