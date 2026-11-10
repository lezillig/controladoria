import { prisma } from "@/lib/prisma";
import { custoMicroUsd, type UsoDeTokens } from "./precos";

// O QUE A IA CUSTOU, chamada por chamada.
//
// Até 11/2026 o uso ia só para o log do servidor: dava para provar que o
// cache de prompt funcionava, mas não para responder "quanto gastamos este
// mês, e com o quê". Cada chamada vira uma linha — quem pediu, para qual
// função, em que modelo respondeu de verdade (com a cobertura do lado do
// servidor pode não ser o pedido) e quanto custou. É a base do painel de uso
// e do teto mensal que pausa o que roda sozinho.

export type OrigemDoUso =
  | "analista"
  | "investigador"
  | "auditor"
  | "controller"
  | "custos"
  | "orcamento"
  | "precificacao"
  | "triagem"
  | "segunda_opiniao"
  | "parecer_mensal"
  | "conformidade"
  | "conformidade_conferencia"
  | "edital"
  | "planilha_edital";

export const ROTULO_DA_ORIGEM: Record<string, string> = {
  analista: "Leitura do relatório diário",
  investigador: "Investigador de auditoria",
  auditor: "Auditor interno",
  controller: "Controller",
  custos: "Especialista em custos",
  orcamento: "Orçamento e cenários",
  precificacao: "Precificação e propostas",
  triagem: "Triagem automática de achado crítico",
  segunda_opiniao: "Segunda opinião",
  parecer_mensal: "Parecer mensal do controller",
  conformidade: "Leitura de relatório de conformidade",
  conformidade_conferencia: "Conferência da leitura de conformidade",
  edital: "Leitura de edital",
  planilha_edital: "Planilha do edital",
};

export async function registrarUso(p: {
  companyId: string | null;
  origem: OrigemDoUso;
  message: { model: string; usage: UsoDeTokens };
  userId?: string | null;
  userNome?: string | null;
  referenciaTipo?: string | null;
  referenciaId?: string | null;
  lote?: boolean;
}): Promise<void> {
  const u = p.message.usage;
  const { microUsd, estimado } = custoMicroUsd(p.message.model, u, { lote: p.lote });
  // O log continua: é a prova, na hora, de que o cache de prompt está sendo
  // lido (`cache_lido` alto na segunda rodada é o sinal saudável).
  console.log(
    `[${p.origem}] ${p.message.model} entrada=${u.input_tokens} cache_lido=${u.cache_read_input_tokens ?? 0} ` +
      `cache_gravado=${u.cache_creation_input_tokens ?? 0} saida=${u.output_tokens}${p.lote ? " lote" : ""}`
  );
  try {
    await prisma.iaUso.create({
      data: {
        companyId: p.companyId,
        origem: p.origem,
        referenciaTipo: p.referenciaTipo ?? null,
        referenciaId: p.referenciaId ?? null,
        modelo: p.message.model,
        userId: p.userId ?? null,
        userNome: p.userNome ?? null,
        entradaTokens: u.input_tokens,
        cacheLidoTokens: u.cache_read_input_tokens ?? 0,
        cacheGravadoTokens: u.cache_creation_input_tokens ?? 0,
        saidaTokens: u.output_tokens,
        custoMicroUsd: microUsd,
        precoEstimado: estimado,
        lote: p.lote ?? false,
      },
    });
  } catch (e) {
    // Registro de custo que falha não pode derrubar a resposta que a pessoa
    // está esperando: fica o log acima, e o painel perde uma linha.
    console.warn(`[uso-ia] não gravou o uso: ${e instanceof Error ? e.message.slice(0, 200) : "erro desconhecido"}`);
  }
}

export function inicioDoMesCorrente(agora = new Date()): Date {
  return new Date(agora.getFullYear(), agora.getMonth(), 1);
}

// O TETO MENSAL. Vale para o que roda SOZINHO (triagem de achado crítico,
// parecer mensal): uma pessoa que pergunta vê o aviso e decide; um automatismo
// que gasta sem ninguém olhando precisa de um freio que não dependa de alguém
// abrir o painel.
export type SituacaoDoTeto = {
  // Nulo: sem teto configurado.
  tetoMicroUsd: number | null;
  gastoMicroUsd: number;
  estourado: boolean;
};

export async function situacaoDoTeto(companyId: string, agora = new Date()): Promise<SituacaoDoTeto> {
  const [config, soma] = await Promise.all([
    prisma.controladoriaConfig.findUnique({ where: { companyId }, select: { iaTetoMensalUsdCents: true } }),
    prisma.iaUso.aggregate({ where: { companyId, criadoEm: { gte: inicioDoMesCorrente(agora) } }, _sum: { custoMicroUsd: true } }),
  ]);
  const tetoMicroUsd = config?.iaTetoMensalUsdCents != null ? config.iaTetoMensalUsdCents * 10_000 : null;
  const gastoMicroUsd = soma._sum.custoMicroUsd ?? 0;
  return { tetoMicroUsd, gastoMicroUsd, estourado: tetoMicroUsd !== null && gastoMicroUsd >= tetoMicroUsd };
}
