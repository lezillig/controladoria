import { prisma } from "@/lib/prisma";
import { mascararDocumentosNoTexto } from "@/lib/ia/mascara";
import { especialistaPorId } from "./especialistas";
import { iniciarInvestigacao, type ConsultaFeita, type EstadoInvestigacao } from "./investigador";

// SEGUNDA OPINIÃO — a investigação do investigador sobe para um especialista
// no modelo maior, levando o caminho inteiro: a pergunta, cada consulta feita
// com o que ela devolveu, e a conclusão.
//
// O investigador roda no Sonnet porque são dezenas de perguntas por semana e a
// maioria se resolve com a consulta certa. Algumas não: a resposta ficou
// rasa, a conclusão não convence, ou o assunto é dinheiro demais para uma
// leitura só. Para essas, em vez de refazer a pergunta do zero em outro lugar,
// um clique pede a um especialista que REVISE o trabalho — conteste a
// conclusão, refaça o que precisar conferir, faça a consulta que faltou.
//
// O que vai para o especialista é a TRANSCRIÇÃO do caminho, em texto, e não a
// conversa crua do outro modelo. A conversa crua carrega blocos de raciocínio
// presos ao prompt e às ferramentas com que nasceram; trocar de prompt (o do
// auditor é outro) invalidaria esses blocos. A transcrição não depende de
// nada disso, e a pessoa pode ler exatamente o que o especialista recebeu.

// Quem dá a segunda opinião: o auditor interno, que tem as consultas do
// investigador (para refazer) e as somas (para pôr o caso em proporção).
export const ESPECIALISTA_DA_SEGUNDA_OPINIAO = "auditor";

// Tetos da transcrição, em caracteres. Uma consulta devolve no máximo 50
// linhas; 6 mil caracteres cobrem isso com folga, e o total cabe muitas vezes
// na janela do modelo.
const TETO_POR_RESULTADO = 6000;
const TETO_DA_TRANSCRICAO = 150_000;

type Bloco = { type?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; text?: string };
type Mensagem = { role?: string; content?: unknown };

function textoDoResultado(conteudo: unknown): string {
  if (typeof conteudo === "string") return conteudo;
  if (Array.isArray(conteudo)) {
    return (conteudo as Bloco[])
      .map((b) => (b.type === "text" && typeof b.text === "string" ? b.text : b.type === "document" ? "[documento enviado ao modelo]" : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/** As consultas da conversa gravada, na ordem, cada uma com o que devolveu. */
export function consultasDaConversa(mensagens: unknown): { ferramenta: string; entrada: unknown; resultado: string }[] {
  if (!Array.isArray(mensagens)) return [];
  const pedidos = new Map<string, { ferramenta: string; entrada: unknown }>();
  const feitas: { ferramenta: string; entrada: unknown; resultado: string }[] = [];
  for (const m of mensagens as Mensagem[]) {
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content as Bloco[]) {
      if (m.role === "assistant" && b.type === "tool_use" && typeof b.id === "string") {
        pedidos.set(b.id, { ferramenta: String(b.name ?? "consulta"), entrada: b.input ?? {} });
      }
      if (m.role === "user" && b.type === "tool_result" && typeof b.tool_use_id === "string") {
        const pedido = pedidos.get(b.tool_use_id);
        if (pedido) feitas.push({ ...pedido, resultado: textoDoResultado(b.content) });
      }
    }
  }
  return feitas;
}

export function aberturaDaSegundaOpiniao(origem: {
  pergunta: string;
  especialista: string;
  resposta: string | null;
  erro: string | null;
  consultas: ConsultaFeita[];
  mensagens: unknown;
}): string {
  const quem = especialistaPorId(origem.especialista).nome;
  const feitas = consultasDaConversa(origem.mensagens);
  const linhas: string[] = [
    `SEGUNDA OPINIÃO. O ${quem} investigou a pergunta abaixo. Você está recebendo o caminho inteiro dele: cada consulta que fez, o que ela devolveu, e a conclusão.`,
    "",
    "Seu trabalho é revisar, não repetir:",
    "1. A conclusão se sustenta no que foi consultado? Aponte cada afirmação sem dado que a apoie.",
    "2. O que ele não olhou e deveria ter olhado? Faça essas consultas você mesmo.",
    "3. Refaça as consultas cujo resultado decide a conclusão, para conferir.",
    "4. Feche com a SUA conclusão, dizendo onde concorda, onde discorda e por quê.",
    "",
    "Pergunta original:",
    origem.pergunta.trim(),
    "",
    `Consultas que ele fez (${feitas.length}):`,
  ];
  let usado = linhas.join("\n").length;
  let cortadas = 0;
  feitas.forEach((c, i) => {
    const resultado = c.resultado.length > TETO_POR_RESULTADO ? `${c.resultado.slice(0, TETO_POR_RESULTADO)} […cortado]` : c.resultado;
    const bloco = `\n[${i + 1}] ${c.ferramenta} ${JSON.stringify(c.entrada)}\nDevolveu:\n${resultado || "(sem conteúdo)"}`;
    if (usado + bloco.length > TETO_DA_TRANSCRICAO) {
      cortadas++;
      return;
    }
    usado += bloco.length;
    linhas.push(bloco);
  });
  if (cortadas > 0) linhas.push(`\n(${cortadas} consulta(s) ficaram de fora desta transcrição por tamanho; refaça as que importarem.)`);
  // Conversa sem resultado gravado (investigação antiga): fica o resumo de
  // uma linha que a tela mostra.
  if (feitas.length === 0 && origem.consultas.length > 0) {
    for (const c of origem.consultas) linhas.push(`- ${c.ferramenta} ${JSON.stringify(c.entrada)} → ${c.resumo}`);
  }
  linhas.push("", "Conclusão dele:", origem.resposta?.trim() || `Não fechou uma resposta${origem.erro ? ` (${origem.erro})` : ""}.`);
  // Os resultados já passaram pelo filtro quando foram ao primeiro modelo; a
  // pergunta e a conclusão são texto livre e passam agora.
  return mascararDocumentosNoTexto(linhas.join("\n"));
}

export async function pedirSegundaOpiniao(params: {
  investigacaoId: string;
  companyId: string;
  userId: string | null;
  userNome: string | null;
}): Promise<{ ok: true; estado: EstadoInvestigacao } | { ok: false; erro: string }> {
  const origem = await prisma.investigacao.findFirst({ where: { id: params.investigacaoId, companyId: params.companyId } });
  if (!origem) return { ok: false, erro: "Investigação não encontrada." };
  if (origem.status === "EXECUTANDO") return { ok: false, erro: "Esta investigação ainda está em andamento. Espere ela fechar." };
  if (origem.origem === "SEGUNDA_OPINIAO") return { ok: false, erro: "Esta já é uma segunda opinião." };
  if (origem.especialista !== "investigador") return { ok: false, erro: "A segunda opinião é para as investigações do investigador; os pareceres dos especialistas já rodam no modelo maior." };

  // Uma por investigação: clicar de novo reabre a que existe em vez de pagar
  // outro parecer sobre o mesmo caminho.
  const existente = await prisma.investigacao.findFirst({
    where: { companyId: params.companyId, origem: "SEGUNDA_OPINIAO", origemId: origem.id, status: { in: ["EXECUTANDO", "CONCLUIDA"] } },
    select: { id: true },
  });
  if (existente) {
    const { lerInvestigacao } = await import("./investigador");
    const estado = await lerInvestigacao(existente.id, params.companyId);
    if (estado) return { ok: true, estado };
  }

  const estado = await iniciarInvestigacao({
    companyId: params.companyId,
    conexaoId: origem.conexaoId,
    empresa: origem.empresa,
    pergunta: `Segunda opinião sobre: ${origem.pergunta}`.slice(0, 2000),
    especialista: ESPECIALISTA_DA_SEGUNDA_OPINIAO,
    userId: params.userId,
    userNome: params.userNome,
    origem: "SEGUNDA_OPINIAO",
    origemId: origem.id,
    achadoId: origem.achadoId,
    abertura: aberturaDaSegundaOpiniao({
      pergunta: origem.pergunta,
      especialista: origem.especialista,
      resposta: origem.resposta,
      erro: origem.erro,
      consultas: Array.isArray(origem.consultas) ? (origem.consultas as ConsultaFeita[]) : [],
      mensagens: origem.mensagens,
    }),
  });
  return { ok: true, estado };
}
