import { prisma } from "@/lib/prisma";
import {
  OMIE_ENDPOINTS,
  OMIE_PACE_MS,
  OmieVazioError,
  extrairItens,
  extrairTotalRegistros,
  omieCall,
  sleep,
  conferirFormatoCredencial,
  descreverParam,
  paramsLancamentos,
  paramsMovimentos,
  paramsNfse,
  type OmieEndpoint,
  type ProblemaCredencial,
} from "./client";
import {
  formatarDataOmie,
  normalizarCategoria,
  normalizarContaCorrente,
  normalizarDepartamento,
  normalizarMovimentoExtrato,
  normalizarMovimentoFinanceiro,
  normalizarNfe,
  normalizarNfse,
  normalizarParceiro,
  normalizarProjeto,
  normalizarTitulo,
} from "./mapping";

// DIAGNÓSTICO DA INTEGRAÇÃO COM A OMIE.
//
// Existe para responder, em trinta segundos e antes de qualquer carga, a
// pergunta que hoje só a primeira sincronização responde: a credencial vale, a
// conta tem os endpoints liberados, e os NOMES DOS CAMPOS que esta conta
// devolve são os que o mapeamento espera?
//
// A última é a que mais custa quando fica para depois. A Omie varia nomes de
// campo entre planos, versões e módulos contratados; um campo com nome
// diferente não quebra o sync — ele grava nulo em silêncio, e o problema só
// aparece semanas depois como "por que a coluna categoria está vazia".
//
// Por isso o diagnóstico faz DUAS coisas em cada endpoint:
//
//   1. Chama com EXATAMENTE os mesmos parâmetros do sync. Um teste que usasse
//      uma chamada mais simples poderia passar enquanto o sync falha — e um
//      teste que mente é pior que teste nenhum.
//   2. Passa o primeiro registro pelo MESMO normalizador do sync e reporta
//      quais campos vieram preenchidos. É a diferença entre "conectou" e
//      "conectou e os dados chegam utilizáveis".
//
// Nada é gravado. O diagnóstico lê e descarta — é seguro rodar a qualquer
// momento, inclusive com a carga histórica em andamento.

// Uma página, poucos registros: o objetivo é provar o caminho, não trazer
// dado. Mais que isso só gastaria o limite de consumo da conta.
const REGISTROS_DE_AMOSTRA = 3;

// Janela para os endpoints que exigem período. 90 dias é largo o bastante para
// qualquer operação ativa ter movimento e curto o bastante para a resposta ser
// rápida.
const DIAS_DE_AMOSTRA = 90;

export type ResultadoEndpoint = {
  chave: string;
  rotulo: string;
  call: string;
  // OK = respondeu. Vazio = respondeu que não há registros no período, o que
  // também é sucesso de integração (ver EMPTY_FAULT_PATTERNS no client).
  estado: "OK" | "VAZIO" | "ERRO" | "PULADO";
  registros: number;
  totalNaConta: number;
  // Sob qual nome o array veio. A Omie não padroniza, e saber qual dos
  // candidatos respondeu é o que permite corrigir o mapeamento numa linha.
  listaEncontradaEm: string | null;
  // Quando o endpoint tem variantes de filtro, qual delas a conta aceitou.
  // Null nos endpoints de param único — só polui a tela sem informar nada.
  filtroAceito: string | null;
  // Nomes crus dos campos do primeiro registro, como a conta devolveu.
  camposRecebidos: string[];
  // O que o normalizador conseguiu preencher a partir desse registro, e o que
  // ficou vazio. É aqui que um nome de campo divergente aparece.
  camposMapeados: string[];
  camposVazios: string[];
  erro: string | null;
  duracaoMs: number;
};

export type ResultadoDiagnostico = {
  conexao: { id: string; nome: string; apelido: string };
  executadoEm: Date;
  // Defeitos de FORMATO da credencial, achados sem sair da máquina. Vêm antes
  // da lista de endpoints porque, quando há algum, os dez endpoints falham
  // pelo mesmo motivo e a lista não acrescenta nada.
  problemasDeCredencial: ProblemaCredencial[];
  endpoints: ResultadoEndpoint[];
  // Resumo pronto para leitura rápida — é o que a pessoa olha antes de ler a
  // tabela inteira.
  ok: number;
  vazios: number;
  erros: number;
};

type Alvo = {
  chave: string;
  rotulo: string;
  endpoint: OmieEndpoint;
  // Lista = variantes de filtro a tentar, na ordem; a conta escolhe.
  param: Record<string, unknown> | readonly Record<string, unknown>[] | null;
  // Passa o registro cru pelo normalizador do sync e devolve o objeto gravado,
  // ou null quando o registro é descartado. Devolver null é informação: quer
  // dizer que o mapeamento não reconheceu o registro.
  normalizar: (bruto: Record<string, unknown>) => Record<string, unknown> | null;
};

export async function diagnosticarConexao(conexaoId: string, companyId: string): Promise<ResultadoDiagnostico> {
  const conexao = await prisma.omieConexao.findFirst({
    where: { id: conexaoId, companyId },
    select: { id: true, nome: true, apelido: true, credencialRef: true },
  });
  if (!conexao) throw new Error("Conexão não encontrada.");

  const hoje = new Date();
  const desde = new Date(hoje);
  desde.setDate(desde.getDate() - DIAS_DE_AMOSTRA);
  const de = formatarDataOmie(desde);
  const ate = formatarDataOmie(hoje);

  const paginacaoCadastro = { pagina: 1, registros_por_pagina: REGISTROS_DE_AMOSTRA, apenas_importado_api: "N" };

  const alvos: Alvo[] = [
    {
      chave: "contasCorrentes",
      rotulo: "Contas correntes",
      endpoint: OMIE_ENDPOINTS.contasCorrentes,
      param: paginacaoCadastro,
      normalizar: normalizarContaCorrente,
    },
    {
      chave: "categorias",
      rotulo: "Plano de categorias",
      endpoint: OMIE_ENDPOINTS.categorias,
      param: paginacaoCadastro,
      normalizar: normalizarCategoria,
    },
    {
      chave: "departamentos",
      rotulo: "Departamentos",
      endpoint: OMIE_ENDPOINTS.departamentos,
      param: paginacaoCadastro,
      normalizar: normalizarDepartamento,
    },
    {
      chave: "projetos",
      rotulo: "Projetos",
      endpoint: OMIE_ENDPOINTS.projetos,
      param: paginacaoCadastro,
      normalizar: normalizarProjeto,
    },
    {
      chave: "clientes",
      rotulo: "Clientes e fornecedores",
      endpoint: OMIE_ENDPOINTS.clientes,
      param: paginacaoCadastro,
      normalizar: normalizarParceiro,
    },
    {
      chave: "titulosPagar",
      rotulo: "Títulos a pagar",
      endpoint: OMIE_ENDPOINTS.titulos,
      param: { nPagina: 1, nRegPorPagina: REGISTROS_DE_AMOSTRA, cNatureza: "P", dDtEmisDe: de, dDtEmisAte: ate },
      normalizar: (b) => normalizarTitulo(b, "PAGAR"),
    },
    {
      chave: "titulosReceber",
      rotulo: "Títulos a receber",
      endpoint: OMIE_ENDPOINTS.titulos,
      param: { nPagina: 1, nRegPorPagina: REGISTROS_DE_AMOSTRA, cNatureza: "R", dDtEmisDe: de, dDtEmisAte: ate },
      normalizar: (b) => normalizarTitulo(b, "RECEBER"),
    },
    {
      chave: "nfe",
      rotulo: "Notas fiscais de produto (NF-e)",
      endpoint: OMIE_ENDPOINTS.nfe,
      param: {
        pagina: 1,
        registros_por_pagina: REGISTROS_DE_AMOSTRA,
        apenas_importado_api: "N",
        dEmiInicial: de,
        dEmiFinal: ate,
      },
      normalizar: normalizarNfe,
    },
    {
      chave: "nfse",
      rotulo: "Notas fiscais de serviço (NFS-e)",
      endpoint: OMIE_ENDPOINTS.nfse,
      param: paramsNfse(1, REGISTROS_DE_AMOSTRA, de, ate),
      normalizar: normalizarNfse,
    },
  ];

  const endpoints: ResultadoEndpoint[] = [];

  for (const alvo of alvos) {
    endpoints.push(await testar(alvo, conexao.credencialRef));
    await sleep(OMIE_PACE_MS);
  }

  // O extrato depende de uma conta corrente: ele é chamado por nCodCC, e não
  // há como testá-lo sem antes descobrir um código válido. Por isso ele fica
  // por último e usa o código que o próprio diagnóstico acabou de obter — o
  // que, de quebra, testa a cadeia inteira, que é como o sync funciona.
  const codigoConta = await primeiraContaCorrente(conexao.credencialRef);
  if (codigoConta === null) {
    endpoints.push({
      chave: "extrato",
      rotulo: "Extrato bancário",
      call: OMIE_ENDPOINTS.extrato.call,
      estado: "PULADO",
      registros: 0,
      totalNaConta: 0,
      listaEncontradaEm: null,
      filtroAceito: null,
      camposRecebidos: [],
      camposMapeados: [],
      camposVazios: [],
      erro: "Nenhuma conta corrente foi obtida — o extrato é consultado por conta e não pôde ser testado.",
      duracaoMs: 0,
    });
  } else {
    endpoints.push(
      await testar(
        {
          chave: "extrato",
          rotulo: `Extrato bancário (conta ${codigoConta})`,
          endpoint: OMIE_ENDPOINTS.extrato,
          param: { nCodCC: Number(codigoConta), dPeriodoInicial: de, dPeriodoFinal: ate },
          normalizar: (b) => normalizarMovimentoExtrato(b, codigoConta),
        },
        conexao.credencialRef
      )
    );
  }

  // MOVIMENTAÇÃO DA CONTA CORRENTE — a hipótese que ainda não foi testada.
  //
  // Vem antes dos lançamentos avulsos porque é a candidata a fonte, não a
  // sentinela: é a tela que mostra 21.713 registros conciliados no ano, com
  // conta, categoria, tipo de documento e número fiscal na mesma linha.
  //
  // O que este teste responde, e que nenhuma leitura de documentação responde:
  // (1) a conta aceita a operação neste caminho; (2) qual filtro de data ela
  // aceita — a lista de variantes deixa a própria conta escolher; (3) quais
  // campos chegam PREENCHIDOS. A terceira é a que decide se isto resolve o
  // número do documento fiscal ou só a conciliação.
  endpoints.push(
    await testar(
      {
        chave: "movimentos",
        rotulo: "Movimentação da conta corrente",
        endpoint: OMIE_ENDPOINTS.movimentos,
        param: paramsMovimentos(1, REGISTROS_DE_AMOSTRA, de, ate),
        normalizar: normalizarMovimentoFinanceiro,
      },
      conexao.credencialRef
    )
  );
  await sleep(OMIE_PACE_MS);

  // LANÇAMENTOS AVULSOS de conta corrente — sentinela, não fonte.
  //
  // Entrou aqui como aposta: o extrato voltava vazio, a tela da Omie mostrava
  // 21.551 movimentações, e este parecia o endpoint que faltava. As variantes
  // rodaram nas duas contas e a resposta foi "não existem registros" até sem
  // filtro nenhum. Isso continua valendo, e é o que faz dele uma sentinela
  // útil: este endpoint lista só o crédito ou débito digitado direto na conta.
  //
  // O que NÃO se sustentou foi a conclusão que se tirou dali — a de que a
  // movimentação da tela já estaria espelhada por vir de baixa de título. Se
  // estivesse, a Conciliação não estaria zerada. A movimentação tem endpoint
  // próprio, testado logo acima.
  //
  // Fica no diagnóstico de propósito. Custa uma chamada, e é o que vai avisar
  // no dia em que a operação passar a usar lançamento avulso — sem isso, esse
  // dinheiro entraria na conta sem aparecer em lugar nenhum aqui.
  //
  // Sem normalizador: `() => null` faz cada registro aparecer como
  // "descartado", que aqui é o comportamento certo. O que se quer desta
  // execução é a lista de campos que a conta devolve, não gravar nada.
  endpoints.push(
    await testar(
      {
        chave: "lancamentos",
        rotulo: "Lançamentos avulsos de conta corrente",
        endpoint: OMIE_ENDPOINTS.lancamentos,
        param: paramsLancamentos(1, REGISTROS_DE_AMOSTRA, de, ate),
        normalizar: () => null,
      },
      conexao.credencialRef
    )
  );

  return {
    conexao: { id: conexao.id, nome: conexao.nome, apelido: conexao.apelido },
    executadoEm: new Date(),
    problemasDeCredencial: conferirFormatoCredencial(conexao.credencialRef),
    endpoints,
    ok: endpoints.filter((e) => e.estado === "OK").length,
    vazios: endpoints.filter((e) => e.estado === "VAZIO").length,
    erros: endpoints.filter((e) => e.estado === "ERRO").length,
  };
}

// VARIANTE VAZIA NÃO É RESPOSTA FINAL.
//
// O cliente HTTP só desce para a próxima variante de filtro quando a Omie
// RECUSA a tag. Se uma variante é aceita e devolve vazio, ele para ali — e um
// filtro válido mas errado passa a mascarar o certo. Foi o que aconteceu com
// os lançamentos de conta corrente: o método respondeu, disse "sem registro",
// e as outras três variantes nunca foram tentadas, enquanto a tela da Omie
// mostrava 21.551 lançamentos.
//
// Aqui, no diagnóstico, cada variante é tentada por conta própria e a primeira
// QUE TRAZ LINHA vence. Se todas vierem vazias, o resultado diz quais foram
// tentadas — que é a informação de que se precisa para escolher a próxima
// hipótese, em vez de recomeçar do zero.
//
// O sync continua com o comportamento antigo de propósito: lá, insistir em
// quatro variantes a cada página multiplicaria por quatro o consumo da conta.
// Descobrir é trabalho do diagnóstico; o sync usa o que foi descoberto.
async function testar(alvo: Alvo, credencialRef: string): Promise<ResultadoEndpoint> {
  const inicio = Date.now();
  const base = {
    chave: alvo.chave,
    rotulo: alvo.rotulo,
    call: alvo.endpoint.call,
    registros: 0,
    totalNaConta: 0,
    listaEncontradaEm: null as string | null,
    filtroAceito: null as string | null,
    camposRecebidos: [] as string[],
    camposMapeados: [] as string[],
    camposVazios: [] as string[],
    erro: null as string | null,
  };

  const variantes: readonly Record<string, unknown>[] = Array.isArray(alvo.param)
    ? (alvo.param as readonly Record<string, unknown>[])
    : [(alvo.param ?? {}) as Record<string, unknown>];
  // Só faz sentido nomear o filtro quando havia escolha; em endpoint de param
  // único a informação seria ruído.
  const houveEscolha = Array.isArray(alvo.param);

  const tentadas: string[] = [];
  let ultimoErro: unknown = null;

  for (const [i, variante] of variantes.entries()) {
    if (i > 0) await sleep(OMIE_PACE_MS);
    const rotuloVariante = descreverParam(variante);

    try {
      const resposta = await omieCall(alvo.endpoint, variante, { credencialRef });
      const itens = extrairItens(resposta, alvo.endpoint);
      const listaEncontradaEm = alvo.endpoint.listKey.find((k) => Array.isArray(resposta?.[k])) ?? null;

      if (itens.length === 0) {
        tentadas.push(`${rotuloVariante}: aceito, sem registro`);
        continue;
      }

      const primeiro = itens[0];
      const mapeado = alvo.normalizar(primeiro);
      return {
        ...base,
        estado: "OK",
        registros: itens.length,
        totalNaConta: extrairTotalRegistros(resposta),
        listaEncontradaEm,
        filtroAceito: houveEscolha ? rotuloVariante : null,
        camposRecebidos: nomesDeCampos(primeiro),
        camposMapeados: mapeado ? preenchidos(mapeado) : [],
        camposVazios: mapeado ? ausentes(mapeado) : ["registro descartado pelo mapeamento"],
        duracaoMs: Date.now() - inicio,
      };
    } catch (e) {
      // "Sem registros" chega como EXCEÇÃO: a Omie devolve HTTP 500 nesse caso.
      // É sucesso de integração, não falha — e aqui significa apenas que esta
      // variante não serve, não que o endpoint esteja inacessível.
      if (e instanceof OmieVazioError) {
        tentadas.push(`${rotuloVariante}: aceito, sem registro`);
        continue;
      }
      ultimoErro = e;
      tentadas.push(`${rotuloVariante}: ${e instanceof Error ? e.message.slice(0, 120) : "erro"}`);
    }
  }

  // Chegou aqui: nenhuma variante trouxe linha. Erro real tem precedência
  // sobre vazio — dizer "sem registro" quando a conta recusou a chamada
  // mandaria procurar dado onde o problema é de acesso.
  if (ultimoErro && !(ultimoErro instanceof OmieVazioError)) {
    return {
      ...base,
      estado: "ERRO",
      erro: ultimoErro instanceof Error ? ultimoErro.message : "erro desconhecido",
      camposVazios: houveEscolha ? tentadas : [],
      duracaoMs: Date.now() - inicio,
    };
  }

  return {
    ...base,
    estado: "VAZIO",
    // As variantes tentadas viajam no campo de campos vazios porque é o único
    // que a tela já mostra por extenso. Sem elas, "sem registro" não diz se
    // foram testadas quatro formas de perguntar ou uma só.
    camposVazios: houveEscolha ? tentadas : [],
    duracaoMs: Date.now() - inicio,
  };
}

async function primeiraContaCorrente(credencialRef: string): Promise<string | null> {
  try {
    const resposta = await omieCall(
      OMIE_ENDPOINTS.contasCorrentes,
      { pagina: 1, registros_por_pagina: 1, apenas_importado_api: "N" },
      { credencialRef, toleraVazio: true }
    );
    await sleep(OMIE_PACE_MS);
    const [primeira] = extrairItens(resposta, OMIE_ENDPOINTS.contasCorrentes);
    if (!primeira) return null;
    const cc = normalizarContaCorrente(primeira);
    return cc?.codigo ?? null;
  } catch {
    return null;
  }
}

// Nomes dos campos do registro cru, incluindo um nível de aninhamento — a Omie
// esconde metade do que interessa dentro de objetos (`recomendacoes`,
// `resumo`), e listar só o primeiro nível daria a falsa impressão de que o
// registro é pobre.
// Nomes de campo do registro cru, descendo DOIS níveis.
//
// Um nível não bastava: os totais de imposto da NF-e moram em
// `total.ICMSTot.vICMS` e `total.retTrib.vIRRF`, e a lista parava em
// `total.ICMSTot`. O diagnóstico mostrava o galho e escondia a folha —
// justamente onde estavam os campos que faltavam mapear.
//
// Dois níveis alcançam tudo que os normalizadores leem. Descer mais entraria
// em item de nota e devolveria centenas de nomes repetidos.
function nomesDeCampos(registro: Record<string, unknown>, profundidade = 2): string[] {
  const nomes: string[] = [];

  const visitar = (obj: Record<string, unknown>, prefixo: string, resta: number) => {
    for (const [chave, valor] of Object.entries(obj)) {
      const caminho = prefixo ? `${prefixo}.${chave}` : chave;
      nomes.push(caminho);
      if (resta > 0 && valor && typeof valor === "object" && !Array.isArray(valor)) {
        visitar(valor as Record<string, unknown>, caminho, resta - 1);
      }
    }
  };

  visitar(registro, "", profundidade);
  return nomes.sort();
}

function preenchidos(mapeado: Record<string, unknown>): string[] {
  return Object.entries(mapeado)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k]) => k)
    .sort();
}

// O que o normalizador NÃO conseguiu preencher. Valor zero e `false` contam
// como preenchidos de propósito: são respostas legítimas, e tratá-los como
// ausência faria o diagnóstico gritar em toda conta que simplesmente não tem
// juros no período.
function ausentes(mapeado: Record<string, unknown>): string[] {
  return Object.entries(mapeado)
    .filter(([, v]) => v === null || v === undefined || v === "")
    .map(([k]) => k)
    .sort();
}
