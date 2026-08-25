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
  // Grafias alternativas do nome da operacao, tentadas em ordem quando a Omie
  // responde `Method "X" not exists`.
  //
  // Existe porque os nomes de `call` da Omie nao seguem convencao unica e sao
  // sensiveis a caixa: o mesmo produto tem `ListarClientes` e `ListarNFSEs`
  // (plural, sigla em caixa alta). Errar a grafia devolve um erro que nao e de
  // credencial nem de dado, e sem esta lista o unico jeito de acertar seria um
  // deploy por tentativa — contra uma conta a que este repositorio nao tem
  // acesso para conferir.
  callsAlternativos?: readonly string[];
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
  // Extrato por conta corrente e por periodo: as linhas IMPORTADAS DO BANCO
  // (OFX, CNAB ou Open Finance). Nao e paginado — a janela de datas limita o
  // volume. Vem vazio quando a empresa nao importa extrato, e vazio aqui NAO
  // significa que nao ha movimento bancario (ver `lancamentos` abaixo).
  extrato: { path: "financas/extrato/", call: "ListarExtrato", listKey: ["listaExtrato", "extrato"] },
  // LANCAMENTOS DE CONTA CORRENTE — os avulsos.
  //
  // A Omie tem dois conceitos que parecem o mesmo e nao sao: o EXTRATO, acima
  // (linhas importadas do banco), e os LANCAMENTOS deste endpoint, que sao os
  // creditos e debitos digitados direto na conta corrente, sem vinculo com
  // titulo. A movimentacao que a tela "Movimentacao da Conta Corrente" mostra
  // e maior que os dois: ela inclui, sobretudo, as BAIXAS DE TITULO.
  //
  // O caminho ate aqui, registrado porque ele se repete: o extrato voltou
  // vazio, o sistema concluiu "a empresa nao importa extrato", e o painel
  // passou a mostrar R$ 131 mil de saldo contra os R$ 2,99 milhoes da Omie.
  // Cinco grafias de metodo foram chutadas e recusadas; a sexta,
  // `ListarLancCC`, veio da documentacao e foi aceita. Ai o diagnostico rodou
  // todas as variantes de filtro nas duas contas e a resposta foi "nao existem
  // registros" ate mesmo SEM filtro — o que fecha a questao: nao ha o que
  // buscar aqui. O endpoint fica no diagnostico como sentinela; se um dia
  // aparecer avulso, ele aparece.
  //
  // CORRECAO, registrada porque a conclusao anterior estava errada e ficou
  // escrita aqui por semanas: nao era "nao ha o que buscar". Este endpoint, de
  // fato, so lista avulso — isso continua valendo. O que estava errado era o
  // passo seguinte, o de concluir que a movimentacao da tela ja estava
  // espelhada via baixa de titulo: a tela de Conciliacao mostra zero
  // lancamento em todas as contas, contra 21.713 registros conciliados na
  // Omie no mesmo periodo.
  //
  // O erro de metodo foi ter variado o NOME da operacao mantendo o CAMINHO.
  // `ListarMovimentos` esta na lista de alternativos abaixo e nunca teve
  // chance: a operacao existe, mas em `financas/mf/` — ver `movimentos`.
  lancamentos: {
    path: "financas/contacorrentelancamentos/",
    call: "ListarLancCC",
    callsAlternativos: ["ListarLancamentosCC", "ListarMovimentos", "ListarLancamentos"],
    listKey: ["lancamentoCCCadastro", "listaLancamento", "lancamentos", "movimentos"],
  },
  // MOVIMENTOS FINANCEIROS — a tela "Movimentacao da Conta Corrente".
  //
  // Entrou depois de uma correcao de rota que vale registrar, porque o erro é
  // facil de repetir: a Omie roteia por CAMINHO + `call`, e a tentativa
  // anterior variou so o nome da operacao (`ListarMovimentos` entre os
  // `callsAlternativos` de `financas/contacorrentelancamentos/`). Nome certo em
  // caminho errado devolve "method not exists" igual a nome errado — e a
  // conclusao que se tirou dali ("nao ha o que buscar") era do teste, nao da
  // conta. O caminho desta operacao e `financas/mf/`.
  //
  // O que a tela mostra e que os outros dois endpoints nao mostram: 21.713
  // registros no ano, conciliados, com CONTA CORRENTE, CATEGORIA, TIPO DE
  // DOCUMENTO, DOCUMENTO e NOTA FISCAL na mesma linha. Se vier assim pela API,
  // resolve as duas coisas que hoje faltam — a conciliacao bancaria, que esta
  // zerada por nao ter o lado do extrato, e o numero do documento fiscal dos
  // titulos, que e o que obriga a conferencia de CT-e a casar por valor e data.
  //
  // Entra primeiro no DIAGNOSTICO, nao no sync: e uma hipotese com bom
  // fundamento, nao um fato. O diagnostico responde se a conta aceita, qual
  // filtro passa e quais campos chegam preenchidos — e so entao vale gravar.
  movimentos: {
    path: "financas/mf/",
    call: "ListarMovimentos",
    callsAlternativos: ["ListarMovimentosFinanceiros", "ListarMF"],
    listKey: ["movimentos", "listaMovimentos", "movimentosEncontrados"],
  },
  nfe: { path: "produtos/nfconsultar/", call: "ListarNF", listKey: ["nfCadastro"] },
  // `ListarNFSEs` — plural e com a sigla em caixa alta. A primeira versao usava
  // `ListarNFSe` e a Omie respondeu `Method "ListarNFSe" not exists`, que e
  // erro de grafia, nao de credencial nem de permissao. As alternativas cobrem
  // as outras capitalizacoes plausiveis sem exigir um deploy por tentativa.
  nfse: {
    path: "servicos/nfse/",
    call: "ListarNFSEs",
    callsAlternativos: ["ListarNFSes", "ListarNfse", "ListarNFSe"],
    listKey: ["nfseEncontradas", "nfseCadastro", "nfseLista"],
  },
} as const satisfies Record<string, OmieEndpoint>;

// Variantes de filtro da listagem de NFS-e, em ordem de preferencia.
//
// A conta real recusou `dDtEmissaoInicial`/`dDtEmissaoFinal` com
// "Tag [DDTEMISSAOFINAL] não faz parte da estrutura do tipo complexo
// [nfseListarRequest]". Como a documentacao publica nao cobre o vocabulario
// de filtro desta operacao, a lista deixa a propria conta escolher: o cliente
// desce a lista a cada recusa de tag e o diagnostico relata qual passou.
//
// A ULTIMA e so paginacao, sem filtro de data. Ela sempre passa, e e o que
// garante que a receita de servico — que no fretamento e a receita principal —
// entre na base mesmo se nenhum nome de filtro for reconhecido. O custo de
// cair nela e varrer mais paginas, nao perder nota.
export function paramsNfse(
  pagina: number,
  porPagina: number,
  de: string,
  ate: string
): readonly Record<string, unknown>[] {
  const paginacao = { nPagina: pagina, nRegPorPagina: porPagina };
  return [
    { ...paginacao, dDtEmissaoDe: de, dDtEmissaoAte: ate },
    { ...paginacao, dEmiInicial: de, dEmiFinal: ate },
    { ...paginacao, dDtInicial: de, dDtFinal: ate },
    { ...paginacao, dDtPeriodoInicial: de, dDtPeriodoFinal: ate },
    paginacao,
  ];
}

// Variantes de parametro dos LANCAMENTOS de conta corrente.
//
// A lista comecou com nove variantes porque a documentacao publica nao cobria
// o vocabulario de filtro deste metodo. O diagnostico rodou todas nas duas
// contas reais e o resultado foi conclusivo, entao a lista encolheu para o que
// a Omie efetivamente aceita:
//
//   aceitos   — nPagina, nRegPorPagina, dDtIncDe/dDtIncAte (data de INCLUSAO),
//               dDtAltDe/dDtAltAte (data de ALTERACAO)
//   recusados — nCodCC, dDtLancamentoDe/Ate, dDtInicial/Final,
//               dPeriodoInicial/Final, todos com "Tag [X] nao faz parte da
//               estrutura do tipo complexo [lanccListarRequest]"
//
// `nCodCC` NAO EXISTE aqui: este metodo nao filtra por conta corrente. Manter
// as variantes recusadas na lista so gastaria chamada da conta para receber a
// mesma recusa — a descoberta ja aconteceu, e repeti-la em producao e custo
// sem informacao.
//
// E o achado que importa: mesmo SEM filtro nenhum, so paginacao, as duas
// contas responderam "nao existem registros" — enquanto a tela de Movimentacao
// da Conta Corrente da Omie mostra 21.551 linhas. A leitura correta disso e
// que este metodo lista LANCAMENTOS AVULSOS (credito ou debito digitado direto
// na conta, sem vinculo com titulo), e nao a movimentacao inteira. A
// movimentacao que a tela mostra vem majoritariamente de BAIXA DE TITULO — que
// este modulo ja espelha, em OmieBaixa. Ver `saldos.ts`: e la que a diferenca
// de saldo passou a ser investigavel, conta a conta, em vez de por chute de
// endpoint.
export function paramsLancamentos(
  pagina: number,
  porPagina: number,
  de: string,
  ate: string
): readonly Record<string, unknown>[] {
  const paginacao = { nPagina: pagina, nRegPorPagina: porPagina };
  return [
    // Data de INCLUSAO e data de ALTERACAO. Nenhuma das duas e a data do
    // lancamento em si — o filtro por competencia fica por conta de quem
    // chama, depois de receber.
    { ...paginacao, dDtIncDe: de, dDtIncAte: ate },
    { ...paginacao, dDtAltDe: de, dDtAltAte: ate },
    // So paginacao: o metodo aceita chamada sem filtro, e essa e a unica forma
    // de distinguir "a janela nao tem lancamento" de "a conta nao tem nenhum".
    paginacao,
  ];
}

// Variantes de parametro dos MOVIMENTOS FINANCEIROS.
//
// A tela da Omie filtra por periodo de PAGAMENTO — e a data que ela chama de
// "Data" na linha conciliada — entao essa variante vem primeiro. As seguintes
// cobrem emissao e registro, e a ultima e so paginacao: sem filtro nenhum, a
// resposta distingue "a janela nao tem movimento" de "a conta nao devolve
// nada", que foi exatamente a duvida que custou uma semana no extrato.
export function paramsMovimentos(
  pagina: number,
  porPagina: number,
  de: string,
  ate: string
): readonly Record<string, unknown>[] {
  const paginacao = { nPagina: pagina, nRegPorPagina: porPagina };
  return [
    { ...paginacao, dDtPagtoDe: de, dDtPagtoAte: ate },
    { ...paginacao, dDtEmissaoDe: de, dDtEmissaoAte: ate },
    { ...paginacao, dDtRegistroDe: de, dDtRegistroAte: ate },
    { ...paginacao, dDtVencDe: de, dDtVencAte: ate },
    paginacao,
  ];
}

// Descricao curta da variante aceita, para a tela de diagnostico. Sem isto a
// descoberta morreria no cliente e o proximo ajuste voltaria a ser chute.
export function descreverParam(param: Record<string, unknown>): string {
  const filtros = Object.keys(param).filter((k) => !/^nPagina$|^nRegPorPagina$/.test(k));
  return filtros.length === 0 ? "sem filtro de data (só paginação)" : filtros.join(", ");
}

// Existe alguma credencial de conexao configurada no ambiente? Serve so para
// a tela inicial distinguir "nada configurado ainda" de "configurado, mas sem
// dado" — a checagem que importa e a por conexao (credencialConfigurada).
export function existeAlgumaCredencialOmie(): boolean {
  // Exige valor, nao so a existencia do nome: variavel criada em branco
  // faria a tela inicial dizer "configurado" sobre um ambiente que nao esta.
  return Object.entries(process.env).some(([k, v]) => k.startsWith("OMIE_APP_KEY_") && (v ?? "").trim() !== "");
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

// APARA a credencial antes de usar. Quebra de linha e espaco no fim sao o
// jeito mais comum de uma chave valida virar "chave invalida": o valor e
// copiado de um bloco de texto e colado no painel da hospedagem, que preserva
// o branco fielmente. A Omie compara byte a byte e recusa — com uma mensagem
// que aponta pra chave, e nao pro espaco.
function lerCru(credencialRef: string): { app_key: string; app_secret: string } {
  const { chave, segredo } = nomesDasVariaveis(credencialRef);
  return { app_key: (process.env[chave] ?? "").trim(), app_secret: (process.env[segredo] ?? "").trim() };
}

function credenciais(credencialRef: string): { app_key: string; app_secret: string } {
  const { chave, segredo } = nomesDasVariaveis(credencialRef);
  const { app_key, app_secret } = lerCru(credencialRef);
  if (!app_key || !app_secret) {
    throw new Error(
      `${chave}/${segredo} não configuradas — a conexão Omie correspondente está indisponível.`
    );
  }
  return { app_key, app_secret };
}

// Formato esperado das credenciais da Omie: app_key so digitos, app_secret
// hexadecimal de 32 caracteres.
const FORMATO_APP_KEY = /^\d{6,20}$/;
const FORMATO_APP_SECRET = /^[0-9a-f]{32}$/i;

// Confere o FORMATO da credencial sem sair da maquina — e, principalmente,
// sem revelar o valor.
//
// Por que existe: "A chave de acesso não está preenchida ou não é válida" e a
// unica coisa que a Omie devolve para qualquer defeito de credencial. Ela nao
// distingue chave trocada de chave com espaco colado no fim, de nome da
// variavel colado junto com o valor, de segredo copiado ainda mascarado. Sem
// esta checagem local, o unico caminho seria tentativa e erro contra a API —
// e cada tentativa custa um deploy.
//
// Cada problema descrito aqui e derivavel do valor sem expor o valor: contagem
// de caracteres e classe de caractere. Nenhum trecho do segredo entra no
// texto, porque este texto vai pra tela e pra trilha de auditoria.
export type ProblemaCredencial = { variavel: string; problema: string };

export function conferirFormatoCredencial(credencialRef: string): ProblemaCredencial[] {
  const { chave, segredo } = nomesDasVariaveis(credencialRef);
  const problemas: ProblemaCredencial[] = [];

  const pares: [string, string, RegExp, string][] = [
    [chave, process.env[chave] ?? "", FORMATO_APP_KEY, "o App Key da Omie é uma sequência só de dígitos"],
    [
      segredo,
      process.env[segredo] ?? "",
      FORMATO_APP_SECRET,
      "o App Secret da Omie tem 32 caracteres hexadecimais (0-9 e a-f)",
    ],
  ];

  for (const [nome, bruto, formato, esperado] of pares) {
    const valor = bruto.trim();

    // Vazia e "só espaço em branco" são o mesmo defeito para quem lê: o campo
    // não tem valor. Reportar as duas coisas (branco nas pontas + formato
    // inválido) sobre um campo em branco seria ruído em cima da causa.
    if (valor === "") {
      problemas.push({
        variavel: nome,
        problema:
          bruto === ""
            ? "não existe neste ambiente ou foi criada sem valor. Confira se o campo Value está preenchido — o painel aceita salvar em branco."
            : "só tem espaço em branco, sem valor.",
      });
      continue;
    }

    if (valor !== bruto) {
      // Aparado em tempo de execucao, mas vale avisar: espaco invisivel no
      // painel e o defeito que mais custa tempo pra achar.
      problemas.push({
        variavel: nome,
        problema: "tem espaço ou quebra de linha nas pontas. O sistema apara antes de enviar, mas convém limpar no painel.",
      });
    }

    if (valor.includes("=")) {
      problemas.push({
        variavel: nome,
        problema: `contém "=". Provavelmente o nome da variável foi colado junto com o valor — o campo deve conter só o que vem depois do "=".`,
      });
      continue;
    }

    if (/[•*]/.test(valor)) {
      problemas.push({
        variavel: nome,
        problema: "contém • ou *, ou seja, foi copiada ainda mascarada. Clique em exibir na Omie antes de copiar.",
      });
      continue;
    }

    if (/\s/.test(valor)) {
      problemas.push({ variavel: nome, problema: "contém espaço no meio do valor." });
      continue;
    }

    if (!formato.test(valor)) {
      problemas.push({
        variavel: nome,
        problema: `tem ${valor.length} caractere(s) e não confere com o formato esperado — ${esperado}.`,
      });
    }
  }

  // Valor repetido entre empresas. Cada metade passa em qualquer checagem
  // isolada — sao valores bem formados — e a Omie recusa as duas contas com a
  // mesma frase generica. So aparece comparando as conexoes entre si, e vale
  // para as DUAS metades: copiar o App Secret da outra empresa e tao facil
  // quanto copiar o App Key, e da no mesmo 403.
  const { app_key, app_secret } = lerCru(credencialRef);
  const repetidos: [string, string, string, string][] = [
    [chave, app_key, "OMIE_APP_KEY_", "App Key"],
    [segredo, app_secret, "OMIE_APP_SECRET_", "App Secret"],
  ];

  for (const [nome, valor, prefixo, rotulo] of repetidos) {
    if (valor === "") continue;
    const gemeas = Object.entries(process.env)
      .filter(([k, v]) => k.startsWith(prefixo) && k !== nome && (v ?? "").trim() === valor)
      .map(([k]) => k);
    if (gemeas.length > 0) {
      problemas.push({
        variavel: nome,
        problema: `tem o mesmo valor de ${gemeas.join(", ")}. Duas empresas não compartilham ${rotulo} — uma das duas está com a credencial da outra.`,
      });
    }
  }

  return problemas;
}

// Uma conexao so e utilizavel quando o par de variaveis existe E TEM VALOR.
// A tela de conexoes usa isto para mostrar "credencial ausente" em vez de
// deixar o usuario descobrir no erro do primeiro sync.
//
// Compara depois de aparar de proposito. Variavel CRIADA COM VALOR VAZIO e um
// estado real e comum — o painel da hospedagem aceita salvar assim, e colar um
// bloco `NOME=valor` no campo de nome cria a variavel sem valor nenhum. Uma
// checagem que so testasse a existencia da chave deixaria esse caso passar
// direto para a Omie, que responde "a chave de acesso nao esta preenchida ou
// nao e valida" — a mesma frase que ela usa para chave errada. O resultado
// seria procurar credencial invalida quando o problema e campo em branco.
export function credencialConfigurada(credencialRef: string): boolean {
  const { app_key, app_secret } = lerCru(credencialRef);
  return app_key !== "" && app_secret !== "";
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
  // Chamado com o indice da variante de parametro que a conta aceitou, quando
  // `param` e uma lista. Serve ao diagnostico, que precisa RELATAR qual filtro
  // vingou — sem isso a descoberta morreria dentro da chamada.
  aoAceitarVariante?: (indice: number) => void;
};

// Nomes de operacao a tentar, na ordem: o principal e depois as grafias
// alternativas do endpoint.
function nomesDaCall(endpoint: OmieEndpoint): readonly string[] {
  return [endpoint.call, ...(endpoint.callsAlternativos ?? [])];
}

// A Omie devolve isto quando o nome da operacao nao existe naquele dominio.
// Nao e erro de credencial, nao e erro de dado: e grafia.
const METODO_INEXISTENTE = /Method\s+"?[^"]*"?\s+not\s+exists/i;

// A Omie valida a estrutura do param e recusa tag desconhecida, nomeando-a:
//   Tag [DDTEMISSAOFINAL] não faz parte da estrutura do tipo complexo [...]
// Cada operacao tem seu proprio vocabulario de filtro e a documentacao publica
// nao cobre todas — o mesmo conceito de "data de emissao" aparece como
// dEmiInicial num endpoint e com outro nome noutro. Reconhecer esta resposta
// permite oferecer variantes de param e deixar a CONTA dizer qual aceita, em
// vez de descobrir por um deploy de cada vez.
const TAG_INVALIDA = /Tag\s*\[[^\]]+\]\s*n[ãa]o faz parte da estrutura/i;

export async function omieCall(
  endpoint: OmieEndpoint,
  // Uma lista significa "tente estas formas de param, nesta ordem, até uma ser
  // aceita". A última deve ser a mais conservadora (tipicamente só paginação),
  // para que o endpoint funcione mesmo quando nenhum filtro é reconhecido.
  param: Record<string, unknown> | readonly Record<string, unknown>[],
  opts: OmieCallOptions,
  tentativa = 0,
  // Indice dentro de nomesDaCall(). Avanca apenas quando a Omie responde
  // "method not exists" — nunca por erro de credencial ou de parametro, que
  // dariam a mesma resposta em qualquer grafia.
  grafia = 0,
  // Indice dentro das variantes de param. Avanca apenas quando a Omie recusa
  // uma TAG da estrutura.
  variante = 0
): Promise<Record<string, unknown> | null> {
  const { app_key, app_secret } = credenciais(opts.credencialRef);
  const grafias = nomesDaCall(endpoint);
  const call = grafias[grafia] ?? endpoint.call;
  const variantes = Array.isArray(param) ? (param as readonly Record<string, unknown>[]) : [param as Record<string, unknown>];
  const paramAtual = variantes[variante] ?? variantes[variantes.length - 1];
  const body = JSON.stringify({ call, app_key, app_secret, param: [paramAtual] });

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
      return omieCall(endpoint, param, opts, tentativa + 1, grafia, variante);
    }
    throw new Error(`Falha de rede ao chamar ${call}: ${e instanceof Error ? e.message : "erro desconhecido"}`);
  }

  const texto = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(texto) as Record<string, unknown>;
  } catch {
    if (res.status === 429 && tentativa < MAX_RETRIES && podeEsperar(opts.deadline, backoffMs(tentativa))) {
      await sleep(backoffMs(tentativa));
      return omieCall(endpoint, param, opts, tentativa + 1, grafia, variante);
    }
    throw new Error(
      `Omie respondeu ${res.status} em ${call} com conteúdo não-JSON: ${sanitizeErro(texto, opts.credencialRef)}`
    );
  }

  // Grafia errada do nome da operacao: tenta a proxima da lista, sem gastar
  // retentativa (nao e falha transitoria) e sem backoff (nao e limite).
  const mensagem = typeof json.message === "string" ? json.message : "";
  if (METODO_INEXISTENTE.test(mensagem) && grafia + 1 < grafias.length) {
    return omieCall(endpoint, param, opts, tentativa, grafia + 1, variante);
  }

  const fault = typeof json.faultstring === "string" ? json.faultstring : null;

  // Tag de filtro que esta operacao nao conhece: tenta a proxima variante de
  // param. Como a ultima variante e sempre a conservadora (so paginacao),
  // esgotar a lista significa que nem sem filtro a chamada passa — e ai o
  // problema e outro, que o erro final vai descrever.
  if (fault && TAG_INVALIDA.test(fault) && variante + 1 < variantes.length) {
    return omieCall(endpoint, param, opts, tentativa, grafia, variante + 1);
  }

  // Aceita: avisa quem chamou qual variante vingou. Vem depois das recusas de
  // estrutura e antes de qualquer retorno, para valer tambem quando a resposta
  // e "sem registros" — que e sucesso de integracao.
  opts.aoAceitarVariante?.(variante);

  if (fault && EMPTY_FAULT_PATTERNS.some((p) => p.test(fault))) {
    if (opts.toleraVazio) return null;
    throw new OmieVazioError(fault);
  }

  const limitado = res.status === 429 || (fault !== null && RATE_LIMIT_PATTERNS.some((p) => p.test(fault)));
  if (limitado) {
    if (tentativa < MAX_RETRIES && podeEsperar(opts.deadline, backoffMs(tentativa))) {
      await sleep(backoffMs(tentativa));
      return omieCall(endpoint, param, opts, tentativa + 1, grafia, variante);
    }
    throw new Error(`Omie recusou por limite de consumo em ${call} e não há orçamento de tempo para retentativa.`);
  }

  if (fault) {
    const code = typeof json.faultcode === "string" ? ` (${json.faultcode})` : "";
    throw new Error(
      `Omie recusou ${call}${code}: ${sanitizeErro(fault, opts.credencialRef)}${dicaDeCredencial(fault, opts.credencialRef)}`
    );
  }

  if (!res.ok) {
    throw new Error(`Omie respondeu ${res.status} em ${call}: ${sanitizeErro(texto, opts.credencialRef)}`);
  }

  return json;
}

// A faultstring de credencial da Omie e sempre a mesma frase, para qualquer
// defeito: chave trocada, espaco colado no fim, segredo copiado mascarado,
// par de outra empresa. Anexa o que a checagem local de formato ja sabe, para
// que a pessoa leia a causa provavel junto do erro em vez de ir por eliminacao.
const FAULT_DE_CREDENCIAL = /chave de acesso|app_key|app_secret|n[aã]o (est[aá] preenchid|é v[aá]lid)/i;

function dicaDeCredencial(fault: string, credencialRef: string): string {
  if (!FAULT_DE_CREDENCIAL.test(fault)) return "";
  const { chave, segredo } = nomesDasVariaveis(credencialRef);
  const problemas = conferirFormatoCredencial(credencialRef);
  if (problemas.length === 0) {
    return ` — ${chave} e ${segredo} existem e têm o formato esperado, então o par foi recusado pela própria Omie: confira se as duas vieram do mesmo app (⚙️ → Resumo do App da empresa certa) e se a chave não foi regenerada depois de cadastrada aqui.`;
  }
  return ` — ${problemas.map((p) => `${p.variavel} ${p.problema}`).join(" ")}`;
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
