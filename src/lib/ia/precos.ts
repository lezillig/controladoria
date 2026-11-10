// PREÇO DE CADA CHAMADA À IA, em milionésimos de dólar.
//
// A API cobra por token, e o preço muda por modelo e por tipo de token: o que
// entra, o que sai (o raciocínio conta como saída), o que foi lido do cache de
// prompt e o que foi gravado nele. Com o preço em dólares por MILHÃO de
// tokens, tokens × preço já é o custo em milionésimos de dólar — a unidade em
// que o custo é guardado, porque em centavos quase toda chamada arredondaria
// para zero e a soma do mês sairia errada.
//
// A tabela é a publicada pela Anthropic em 11/2026. Modelo que não está aqui
// (um novo, ou o de cobertura que o servidor escolheu numa recusa) é cobrado
// pelo mais caro da tabela e marcado como ESTIMADO: o teto mensal erra para o
// lado seguro, e a tela mostra que aquele número não é exato.

export type Preco = {
  // Dólares por milhão de tokens.
  entrada: number;
  saida: number;
  cacheLido: number;
  // Gravação com validade de 5 minutos, a única que o sistema usa.
  cacheGravado: number;
};

// Do prefixo mais específico para o mais geral: "claude-fable-5-2" tem de ser
// testado antes de "claude-fable-5", senão o 5.2 sairia pelo preço do 5.
const TABELA: [string, Preco][] = [
  ["claude-fable-5-2", { entrada: 8, saida: 40, cacheLido: 0.2, cacheGravado: 10 }],
  ["claude-mythos-5-2", { entrada: 8, saida: 40, cacheLido: 0.2, cacheGravado: 10 }],
  ["claude-fable-5-1", { entrada: 10, saida: 50, cacheLido: 0.25, cacheGravado: 12.5 }],
  ["claude-mythos-5-1", { entrada: 10, saida: 50, cacheLido: 0.25, cacheGravado: 12.5 }],
  ["claude-fable-5", { entrada: 10, saida: 50, cacheLido: 1, cacheGravado: 12.5 }],
  ["claude-opus-5-5", { entrada: 4, saida: 20, cacheLido: 0.2, cacheGravado: 5 }],
  ["claude-opus-5", { entrada: 5, saida: 25, cacheLido: 0.5, cacheGravado: 6.25 }],
  ["claude-opus-4-8", { entrada: 5, saida: 25, cacheLido: 0.5, cacheGravado: 6.25 }],
  ["claude-sonnet-5-5", { entrada: 2, saida: 10, cacheLido: 0.1, cacheGravado: 2.5 }],
  ["claude-sonnet-5", { entrada: 2, saida: 10, cacheLido: 0.2, cacheGravado: 2.5 }],
  ["claude-haiku-5-5", { entrada: 0.1, saida: 0.5, cacheLido: 0.01, cacheGravado: 0.125 }],
];

// O Haiku 5.5 tem duas faixas: acima de 100 mil tokens de prompt, cinco vezes
// o preço.
const HAIKU_PROMPT_LONGO: Preco = { entrada: 0.5, saida: 2.5, cacheLido: 0.05, cacheGravado: 0.625 };
const LIMITE_DO_PROMPT_CURTO = 100_000;

const MAIS_CARO: Preco = TABELA.reduce((a, [, p]) => (p.saida > a.saida ? p : a), TABELA[0][1]);

export type UsoDeTokens = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

export function precoDoModelo(modelo: string, tokensDePrompt = 0): { preco: Preco; estimado: boolean } {
  const m = modelo.toLowerCase();
  const achado = TABELA.filter(([prefixo]) => m.startsWith(prefixo)).sort((a, b) => b[0].length - a[0].length)[0];
  if (!achado) return { preco: MAIS_CARO, estimado: true };
  if (achado[0] === "claude-haiku-5-5" && tokensDePrompt > LIMITE_DO_PROMPT_CURTO) return { preco: HAIKU_PROMPT_LONGO, estimado: false };
  return { preco: achado[1], estimado: false };
}

/** Custo de uma chamada em milionésimos de dólar. Em lote, metade. */
export function custoMicroUsd(modelo: string, uso: UsoDeTokens, opcoes: { lote?: boolean } = {}): { microUsd: number; estimado: boolean } {
  const lido = uso.cache_read_input_tokens ?? 0;
  const gravado = uso.cache_creation_input_tokens ?? 0;
  const { preco, estimado } = precoDoModelo(modelo, uso.input_tokens + lido + gravado);
  const cheio = uso.input_tokens * preco.entrada + lido * preco.cacheLido + gravado * preco.cacheGravado + uso.output_tokens * preco.saida;
  return { microUsd: Math.round(opcoes.lote ? cheio / 2 : cheio), estimado };
}

export function fmtUsd(microUsd: number): string {
  const usd = microUsd / 1_000_000;
  // Abaixo de um dólar, quatro casas: uma consulta custa frações de centavo e
  // "US$ 0,00" esconderia justamente o que a tela existe para mostrar.
  const casas = Math.abs(usd) < 1 ? 4 : 2;
  return `US$ ${usd.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}`;
}
