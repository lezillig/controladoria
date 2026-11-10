import Anthropic from "@anthropic-ai/sdk";

// O cliente da API, montado do mesmo jeito em todo lugar.
//
// Dois cuidados que a leitura de edital já tinha e que agora valem para todas
// as chamadas:
//   - a chave limpa de espaço, quebra de linha e aspas coladas junto na
//     hospedagem — a causa mais comum de "chave recusada";
//   - o espaço de trabalho (ANTHROPIC_WORKSPACE_ID, o "wrkspc_…" do console),
//     quando configurado. Um arquivo enviado à API pertence a um espaço: a
//     chamada que o lê tem de ir ao mesmo espaço que o recebeu, senão o
//     arquivo "não existe".
const limpar = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "").trim();

export function clienteDaIa(opcoes: { timeout?: number; maxRetries?: number } = {}): Anthropic {
  const espaco = limpar(process.env.ANTHROPIC_WORKSPACE_ID);
  return new Anthropic({
    apiKey: limpar(process.env.ANTHROPIC_API_KEY),
    ...(opcoes.timeout !== undefined ? { timeout: opcoes.timeout } : {}),
    ...(opcoes.maxRetries !== undefined ? { maxRetries: opcoes.maxRetries } : {}),
    ...(espaco && { defaultHeaders: { "anthropic-workspace-id": espaco } }),
  });
}

// QUANDO O PROBLEMA É A CONTA, E NÃO O PEDIDO.
//
// Chave recusada, conta sem crédito e chave sem espaço de trabalho derrubam
// TODA chamada, e a mensagem crua da API (um envelope JSON com `request_id`)
// não diz a ninguém o que fazer. Foi o que o primeiro ciclo de produção
// mostrou: o parecer mensal falhou com 401 e o aviso gravado era o envelope.
// Aqui a falha vira uma frase com a providência — a mesma para o lote, o
// investigador e a leitura de conformidade. Devolve null quando o erro é do
// pedido (formato, limite, tempo), que cada chamador explica do seu jeito.
export function problemaDaConta(e: unknown): string | null {
  const texto = e instanceof Error ? e.message : String(e);
  if (/credit balance/i.test(texto)) {
    return "A conta da API da Anthropic está sem crédito. Quem administra a conta precisa comprar créditos no console da Anthropic (Billing); depois é só pedir de novo.";
  }
  if (/workspace/i.test(texto)) {
    return "A chave da IA não está ligada a um espaço de trabalho. Crie a chave dentro de um espaço de trabalho no console da Anthropic, ou informe o ID do espaço (wrkspc_…) na variável ANTHROPIC_WORKSPACE_ID da hospedagem.";
  }
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    // O motivo que a API dá, sem o envelope, para saber o que corrigir.
    const motivo = (/"message"\s*:\s*"([^"]+)"/.exec(texto)?.[1] ?? texto).slice(0, 120);
    return e.status === 401
      ? `A chave da IA foi recusada pela Anthropic (401: ${motivo}). Confira ANTHROPIC_API_KEY na hospedagem (a chave inteira, sem espaços) e se ela continua ativa no console; depois da troca, refaça o deploy.`
      : `A chave da IA existe, mas não tem acesso (${e.status}: ${motivo}). Confira o espaço de trabalho (ANTHROPIC_WORKSPACE_ID) e as permissões da chave.`;
  }
  return null;
}

/** O erro de uma chamada, em uma frase: o problema da conta ou o que a API respondeu. */
export function erroDaChamada(e: unknown): string {
  return (
    problemaDaConta(e) ??
    (e instanceof Anthropic.APIError ? `A API respondeu ${e.status ?? "sem status"}: ${e.message.slice(0, 300)}` : e instanceof Error ? e.message.slice(0, 300) : "erro desconhecido")
  );
}
