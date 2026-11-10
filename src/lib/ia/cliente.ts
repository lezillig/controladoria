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
