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

  // Só reporta o filtro quando havia escolha a fazer: em endpoint de param
  // único a informação seria ruído.
  const variantes = Array.isArray(alvo.param) ? (alvo.param as readonly Record<string, unknown>[]) : null;
  let filtroAceito: string | null = null;

  try {
    const resposta = await omieCall(alvo.endpoint, alvo.param ?? {}, {
      credencialRef,
      aoAceitarVariante: (i) => {
        if (variantes) filtroAceito = descreverParam(variantes[i] ?? {});
      },
    });
    const itens = extrairItens(resposta, alvo.endpoint);
    const listaEncontradaEm = alvo.endpoint.listKey.find((k) => Array.isArray(resposta?.[k])) ?? null;

    if (itens.length === 0) {
      return {
        ...base,
        estado: "VAZIO",
        listaEncontradaEm,
        filtroAceito,
        totalNaConta: extrairTotalRegistros(resposta),
        duracaoMs: Date.now() - inicio,
      };
    }

    const primeiro = itens[0];
    const mapeado = alvo.normalizar(primeiro);

    return {
      ...base,
      estado: "OK",
      registros: itens.length,
      totalNaConta: extrairTotalRegistros(resposta),
      listaEncontradaEm,
      filtroAceito,
      camposRecebidos: nomesDeCampos(primeiro),
      camposMapeados: mapeado ? preenchidos(mapeado) : [],
      camposVazios: mapeado ? ausentes(mapeado) : ["registro descartado pelo mapeamento"],
      duracaoMs: Date.now() - inicio,
    };
  } catch (e) {
    // "Sem registros" chega como exceção (a Omie devolve HTTP 500 nesse caso).
    // É sucesso de integração, não falha — e distinguir os dois é justamente o
    // que o diagnóstico precisa mostrar com clareza.
    if (e instanceof OmieVazioError) {
      return { ...base, estado: "VAZIO", duracaoMs: Date.now() - inicio };
    }
    return {
      ...base,
      estado: "ERRO",
      erro: e instanceof Error ? e.message : "erro desconhecido",
      duracaoMs: Date.now() - inicio,
    };
  }
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
function nomesDeCampos(registro: Record<string, unknown>): string[] {
  const nomes: string[] = [];
  for (const [chave, valor] of Object.entries(registro)) {
    nomes.push(chave);
    if (valor && typeof valor === "object" && !Array.isArray(valor)) {
      for (const filho of Object.keys(valor as Record<string, unknown>)) {
        nomes.push(`${chave}.${filho}`);
      }
    }
  }
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
