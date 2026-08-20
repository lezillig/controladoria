// Cliente HTTP da API Omie (https://app.omie.com.br/api/v1/...).
//
// Formato da API: TODA chamada e um POST com o mesmo envelope —
// { call, app_key, app_secret, param: [ {...} ] } — pro endpoint do dominio
// (ex. financas/contapagar/). O nome da operacao vai em `call`, nao na URL.
//
// Tres comportamentos da Omie que o codigo abaixo trata e que sao a causa
// mais comum de integracao quebrada com esse ERP:
//
// 1. "Nao existem registros" volta como ERRO (HTTP 500 + faultstring), nao
//    como lista vazia. Tratar isso como falha faria o sync abortar todo dia
//    em que uma janela nao tivesse movimento — ver EMPTY_FAULT_PATTERNS.
// 2. O limite de consumo tambem volta como faultstring, nao so como 429.
// 3. Datas vao e voltam em DD/MM/AAAA (nao ISO) e valores em reais decimais
//    (nao centavos) — a conversao fica em mapping.ts, nunca espalhada.
//
// CREDENCIAIS, UMA POR CONEXAO. O grupo tem mais de um CNPJ, cada um com sua
// propria conta Omie e seu proprio par app_key/app_secret. Cada conexao
// cadastrada guarda no banco apenas o NOME do par de variaveis de ambiente
// (`credencialRef`); o segredo em si so existe no ambiente de execucao.
//
// `credencialRef` "AZUL" resolve para OMIE_APP_KEY_AZUL / OMIE_APP_SECRET_AZUL.
//
// A credencial nunca e gravada no banco, nunca aparece em tela e nunca vai pro
// log de erro (ver sanitizeErro abaixo — a Omie ecoa o app_key dentro da
// propria faultstring em erros de autenticacao, e esse texto acabaria
// persistido em OmieSyncRun.erro e visivel na UI).

const BASE_URL = "https://app.omie.com.br/api/v1";

export type OmieEndpoint = {
  path: string;
  call: string;
  // Nome do array de itens dentro da resposta. A Omie nao padroniza isso:
  // `clientes_cadastro`, `conta_pagar_cadastro`, `departamentos`,
  // `ListarContasCorrentes` (igual ao nome da call), `listaExtrato`...
  listKey: string[];
};

// Registro unico dos endpoints usados. Centralizado para que a lista do que
// este sistema le da Omie seja auditavel num lugar so — e para que ajustar
// um nome de campo apos a primeira execucao real contra a conta do cliente
// seja uma linha, nao uma caca ao tesouro.
export const OMIE_ENDPOINTS = {
  clientes: { path: "geral/clientes/", call: "ListarClientes", listKey: ["clientes_cadastro"] },
  categorias: { path: "geral/categorias/", call: "ListarCategorias", listKey: ["categoria_cadastro"] },
  departamentos: { path: "geral/departamentos/", call: "ListarDepartamentos", listKey: ["departamentos"] },
  projetos: { path: "geral/projetos/", call: "ListarProjetos", listKey: ["cadastro", "projeto_cadastro"] },
  contasCorrentes: {
    path: "geral/contacorrente/",
    call: "ListarContasCorrentes",
    listKey: ["ListarContasCorrentes", "conta_corrente_cadastro"],
  },
  // Fonte PRIMARIA dos titulos, para as duas naturezas (param cNatureza
  // "P"/"R"). Escolhido em vez de ListarContasPagar/ListarContasReceber
  // porque devolve, no mesmo registro, o titulo E o resumo financeiro das
  // baixas (pago, juros, multa, desconto) — que e exatamente o dado que
  // sustenta a auditoria de perda financeira. Com os endpoints de listagem
  // simples seria preciso uma chamada extra POR TITULO pra obter a baixa,
  // o que estoura o limite de consumo da Omie em qualquer base real.
  titulos: {
    path: "financas/pesquisartitulos/",
    call: "PesquisarLancamentos",
    listKey: ["titulosEncontrados", "titulos_encontrados"],
  },
  // Extrato por conta corrente e por periodo — base da conciliacao bancaria
  // (traz o marcador de conciliado, que a listagem de lancamentos nao traz).
  // Nao e paginado: a janela de datas e o que limita o volume.
  extrato: { path: "financas/extrato/", call: "ListarExtrato", listKey: ["listaExtrato", "extrato"] },
  nfe: { path: "produtos/nfconsultar/", call: "ListarNF", listKey: ["nfCadastro"] },
  nfse: { path: "servicos/nfse/", call: "ListarNFSe", listKey: ["nfseEncontradas", "nfseCadastro"] },
} as const satisfies Record<string, OmieEndpoint>;

// Existe alguma credencial de conexao configurada no ambiente? Serve so para
// a tela inicial distinguir "nada configurado ainda" de "configurado, mas sem
// dado" — a checagem que importa e a por conexao (credencialConfigurada).
export function existeAlgumaCredencialOmie(): boolean {
  return Object.keys(process.env).some((k) => k.startsWith("OMIE_APP_KEY_"));
}

// Normaliza o sufixo para o formato de variavel de ambiente: maiusculas, sem
// acento e sem separador. "Azul Transportes" e "azul-transportes" apontam pro
// mesmo OMIE_APP_KEY_AZULTRANSPORTES — assim o cadastro na tela nao precisa
// que o usuario acerte a grafia exata da variavel.
export function normalizarCredencialRef(ref: string): string {
  return ref
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function nomesDasVariaveis(credencialRef: string): { chave: string; segredo: string } {
  const ref = normalizarCredencialRef(credencialRef);
  return { chave: `OMIE_APP_KEY_${ref}`, segredo: `OMIE_APP_SECRET_${ref}` };
}

function credenciais(credencialRef: string): { app_key: string; app_secret: string } {
  const { chave, segredo } = nomesDasVariaveis(credencialRef);
  const app_key = process.env[chave];
  const app_secret = process.env[segredo];
  if (!app_key || !app_secret) {
    throw new Error(
      `${chave}/${segredo} não configuradas — a conexão Omie correspondente está indisponível.`
    );
  }
  return { app_key, app_secret };
}

// Uma conexao so e utilizavel quando o par de variaveis existe no ambiente.
// A tela de conexoes usa isto para mostrar "credencial ausente" em vez de
// deixar o usuario descobrir no erro do primeiro sync.
export function credencialConfigurada(credencialRef: string): boolean {
  const { chave, segredo } = nomesDasVariaveis(credencialRef);
  return Boolean(process.env[chave] && process.env[segredo]);
}

// Espacamento minimo entre chamadas. A Omie limita o consumo por app_key e
// responde com falha (nao com fila) quando o limite e ultrapassado — o mesmo
// raciocinio ja aplicado ao TiqueTaque (src/lib/tiquetaque/pace.ts): a
// defesa principal e o cliente pacear, a retentativa e so rede de seguranca.
export const OMIE_PACE_MS = Number(process.env.OMIE_PACE_MS ?? 350);

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Faultstrings que significam "consulta sem resultado", NAO erro. A Omie
// responde HTTP 500 nesses casos; tratar como excecao faria o sync abortar
// em qualquer janela sem movimento (fim de semana, feriado, conta corrente
// sem lancamento no dia).
const EMPTY_FAULT_PATTERNS = [
  /n[aã]o (existem|foram encontrados) registros/i,
  /nenhum registro (foi )?encontrado/i,
  /n[aã]o h[aá] registros/i,
  /consulta n[aã]o retornou dados/i,
];

const RATE_LIMIT_PATTERNS = [
  /consumo (indevido|redundante)/i,
  /limite de requisi/i,
  /too many requests/i,
  /processando outra requisi/i,
];

export class OmieVazioError extends Error {}

const MAX_RETRIES = 3;

// Remove qualquer eco de credencial da mensagem antes dela virar
// OmieSyncRun.erro (persistido) ou texto de tela: a Omie devolve o app_key
// dentro da propria faultstring em varios erros de autenticacao.
function sanitizeErro(texto: string, credencialRef: string): string {
  try {
    const { app_key, app_secret } = credenciais(credencialRef);
    return texto.split(app_key).join("***").split(app_secret).join("***").slice(0, 500);
  } catch {
    // Sem credencial resolvida nao ha o que mascarar — mas o texto ainda e
    // truncado, porque faultstring da Omie pode vir com centenas de linhas.
    return texto.slice(0, 500);
  }
}

export type OmieCallOptions = {
  // Qual conexao Omie usar. Obrigatorio: com mais de uma conta no ar, um
  // parametro opcional aqui significaria "chamar a conta errada por
  // esquecimento" — e o erro seria silencioso, porque a resposta viria
  // normal, so que da empresa errada.
  credencialRef: string;
  // Timestamp absoluto (Date.now()-comparavel) alem do qual nao vale a pena
  // iniciar uma retentativa — o cron roda no plano Hobby da Vercel, 60s de
  // teto duro por invocacao. Mesmo mecanismo ja usado no client do
  // TiqueTaque, pelo mesmo motivo (um backoff longo matava a invocacao
  // inteira em vez de deixar a proxima continuar do cursor).
  deadline?: number;
  // Silencia o erro de "sem registros" devolvendo null em vez de lancar.
  toleraVazio?: boolean;
};

export async function omieCall(
  endpoint: OmieEndpoint,
  param: Record<string, unknown>,
  opts: OmieCallOptions,
  tentativa = 0
): Promise<Record<string, unknown> | null> {
  const { app_key, app_secret } = credenciais(opts.credencialRef);
  const body = JSON.stringify({ call: endpoint.call, app_key, app_secret, param: [param] });

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/${endpoint.path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
  } catch (e) {
    // Falha de rede (DNS, TLS, socket) — vale retentar, ao contrario de um
    // erro de negocio devolvido pela Omie.
    if (tentativa < MAX_RETRIES && podeEsperar(opts.deadline, backoffMs(tentativa))) {
      await sleep(backoffMs(tentativa));
      return omieCall(endpoint, param, opts, tentativa + 1);
    }
    throw new Error(
      `Falha de rede ao chamar ${endpoint.call}: ${e instanceof Error ? e.message : "erro desconhecido"}`
    );
  }

  const texto = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(texto) as Record<string, unknown>;
  } catch {
    if (res.status === 429 && tentativa < MAX_RETRIES && podeEsperar(opts.deadline, backoffMs(tentativa))) {
      await sleep(backoffMs(tentativa));
      return omieCall(endpoint, param, opts, tentativa + 1);
    }
    throw new Error(
      `Omie respondeu ${res.status} em ${endpoint.call} com conteúdo não-JSON: ${sanitizeErro(texto, opts.credencialRef)}`
    );
  }

  const fault = typeof json.faultstring === "string" ? json.faultstring : null;

  if (fault && EMPTY_FAULT_PATTERNS.some((p) => p.test(fault))) {
    if (opts.toleraVazio) return null;
    throw new OmieVazioError(fault);
  }

  const limitado = res.status === 429 || (fault !== null && RATE_LIMIT_PATTERNS.some((p) => p.test(fault)));
  if (limitado) {
    if (tentativa < MAX_RETRIES && podeEsperar(opts.deadline, backoffMs(tentativa))) {
      await sleep(backoffMs(tentativa));
      return omieCall(endpoint, param, opts, tentativa + 1);
    }
    throw new Error(
      `Omie recusou por limite de consumo em ${endpoint.call} e não há orçamento de tempo para retentativa.`
    );
  }

  if (fault) {
    const code = typeof json.faultcode === "string" ? ` (${json.faultcode})` : "";
    throw new Error(`Omie recusou ${endpoint.call}${code}: ${sanitizeErro(fault, opts.credencialRef)}`);
  }

  if (!res.ok) {
    throw new Error(`Omie respondeu ${res.status} em ${endpoint.call}: ${sanitizeErro(texto, opts.credencialRef)}`);
  }

  return json;
}

function backoffMs(tentativa: number): number {
  return 1500 * 2 ** tentativa; // 1.5s, 3s, 6s
}

function podeEsperar(deadline: number | undefined, esperaMs: number): boolean {
  if (deadline === undefined) return true;
  // Margem de 2s alem da espera: nao adianta esperar o backoff inteiro se a
  // chamada seguinte nao cabe mais no orcamento.
  return Date.now() + esperaMs + 2000 < deadline;
}

// Extrai o array de itens da resposta, tentando os nomes conhecidos daquele
// endpoint. Resposta sem nenhum deles = lista vazia (nao erro): varios
// endpoints da Omie simplesmente omitem o array quando nao ha registro.
export function extrairItens(
  resposta: Record<string, unknown> | null,
  endpoint: OmieEndpoint
): Record<string, unknown>[] {
  if (!resposta) return [];
  for (const key of endpoint.listKey) {
    const valor = resposta[key];
    if (Array.isArray(valor)) return valor as Record<string, unknown>[];
  }
  return [];
}

// Total de paginas, sob os varios nomes que a Omie usa
// (total_de_paginas nos endpoints "cadastro", nTotPaginas nos "pesquisar").
export function extrairTotalPaginas(resposta: Record<string, unknown> | null): number {
  if (!resposta) return 0;
  for (const key of ["total_de_paginas", "nTotPaginas", "totalPaginas"]) {
    const valor = resposta[key];
    if (typeof valor === "number" && Number.isFinite(valor)) return valor;
    if (typeof valor === "string" && valor.trim() !== "" && Number.isFinite(Number(valor))) return Number(valor);
  }
  return 0;
}

export function extrairTotalRegistros(resposta: Record<string, unknown> | null): number {
  if (!resposta) return 0;
  for (const key of ["total_de_registros", "nTotRegistros", "totalRegistros"]) {
    const valor = resposta[key];
    if (typeof valor === "number" && Number.isFinite(valor)) return valor;
  }
  return 0;
}
