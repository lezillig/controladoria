import { prisma } from "@/lib/prisma";
import {
  OMIE_ENDPOINTS,
  OMIE_PACE_MS,
  OmieVazioError,
  extrairItens,
  extrairTotalPaginas,
  omieCall,
  sleep,
  type OmieEndpoint,
  paramsNfse,
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
import type { OmieNatureza } from "./types";

// Motor de sincronizacao Omie -> espelho local.
//
// Roda como MAQUINA DE ESTADOS com cursor persistido (OmieSyncRun.fase e
// .cursor), e nao como um script linear, por uma restricao concreta da
// plataforma: o cron da Vercel no plano Hobby tem 60s de teto duro por
// invocacao. Uma carga inicial de varios meses de titulos jamais caberia
// nisso. Cada invocacao entao processa o quanto cabe num orcamento seguro,
// grava onde parou e a rota se auto-encadeia — mesmo desenho ja validado em
// producao neste projeto pelo import do TiqueTaque
// (src/app/api/cron/tiquetaque-import/route.ts).
//
// Idempotencia e requisito, nao detalhe: uma invocacao pode ser repetida
// (retentativa, execucao manual, encadeamento duplicado). Toda escrita aqui
// e upsert por chave natural da Omie.

export const FASES = ["cadastros", "titulos", "movimentos", "notas"] as const;
export type FaseSync = (typeof FASES)[number];

export type ResultadoFase = {
  faseConcluida: boolean;
  proximoCursor: string | null;
  cadastros: number;
  titulosPagar: number;
  titulosReceber: number;
  baixas: number;
  movimentos: number;
  notas: number;
  erros: string[];
};

function vazio(): ResultadoFase {
  return {
    faseConcluida: false,
    proximoCursor: null,
    cadastros: 0,
    titulosPagar: 0,
    titulosReceber: 0,
    baixas: 0,
    movimentos: 0,
    notas: 0,
    erros: [],
  };
}

const REGISTROS_POR_PAGINA = 200;

// Tamanho do lote de escrita, deliberadamente menor que a página.
//
// Uma transação com duzentas operações segura uma conexão do começo ao fim, e
// várias invocações simultâneas multiplicam isso — foi o que derrubou o banco
// compartilhado com o sistema de gestão no meio da primeira carga. Lotes de
// vinte e cinco mantêm quase todo o ganho de latência (vinte idas de rede por
// página em vez de quinhentas) sem prender conexão por transação longa.
//
// O limite existe porque o banco é COMPARTILHADO: carregar histórico
// financeiro não pode derrubar a operação de frota que roda no mesmo Postgres.
const OPERACOES_POR_LOTE = 25;

// Executa as operações em transações menores, em sequência.
//
// Sequencial de propósito: paralelizar os lotes devolveria a mesma pressão de
// conexões que este limite existe para evitar.
async function gravarEmLotes<T>(operacoes: T[], executar: (lote: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < operacoes.length; i += OPERACOES_POR_LOTE) {
    await executar(operacoes.slice(i, i + OPERACOES_POR_LOTE));
  }
}

// As baixas são gravadas em tabela própria, então saem do objeto do título
// antes do upsert.
function semBaixas<T extends { baixas: unknown }>(t: T): Omit<T, "baixas"> {
  const { baixas, ...resto } = t;
  void baixas;
  return resto;
}

export type ContextoFase = {
  companyId: string;
  // Conexao Omie desta execucao. O sync roda SEMPRE no escopo de uma conexao:
  // cada conta Omie tem numeracao propria de lancamentos, e misturar as duas
  // numa mesma passada faria uma sobrescrever a outra nas chaves naturais.
  conexaoId: string;
  conexaoApelido: string;
  credencialRef: string;
  cursor: string | null;
  janelaInicio: Date;
  janelaFim: Date;
  // Timestamp absoluto: passado dele, a fase para e devolve cursor para a
  // proxima invocacao continuar.
  fimDoOrcamento: number;
  // Teto duro da invocacao (mais folgado que o orcamento), repassado ao
  // client para ele nao iniciar um backoff que nao cabe.
  deadline: number;
};

function acabouOTempo(ctx: ContextoFase): boolean {
  return Date.now() > ctx.fimDoOrcamento;
}

function lerCursor<T>(cursor: string | null, padrao: T): T {
  if (!cursor) return padrao;
  try {
    return { ...padrao, ...(JSON.parse(cursor) as object) } as T;
  } catch {
    return padrao;
  }
}

// ---------- Fase 1: cadastros (dimensoes) ----------
// Sincronizados por inteiro (nao por janela): sao poucos registros, mudam
// pouco e todo o resto depende deles para ter nome legivel. Rodam ANTES dos
// titulos de proposito — um titulo que chega antes do seu fornecedor ainda
// entra (o nome vai desnormalizado no proprio titulo), mas o relatorio fica
// melhor com a ordem certa.

type CursorCadastros = { entidade: string; pagina: number };

const ENTIDADES_CADASTRO = [
  "contasCorrentes",
  "categorias",
  "departamentos",
  "projetos",
  "clientes",
] as const;

async function sincronizarCadastros(ctx: ContextoFase, backfill: boolean): Promise<ResultadoFase> {
  const res = vazio();

  // Cadastro NÃO tem janela: cliente, categoria, projeto e conta corrente são
  // o estado atual da conta Omie, não o movimento de um mês. A carga histórica
  // percorre 38 janelas mensais, e sem esta guarda cada uma delas rebaixava os
  // mesmos 8.572 clientes, 6.767 projetos e 430 categorias de novo — mais de
  // seiscentos mil registros redundantes trafegando entre a Omie, a função e o
  // banco.
  //
  // Foi isso que estourou a franquia de transferência do Neon e derrubou, com
  // ela, o sistema de gestão de motoristas que divide o mesmo banco. O custo
  // não era do dado: era de buscar o mesmo dado 38 vezes.
  //
  // A primeira janela ainda sincroniza (sem cadastro, título fica sem nome
  // legível e a auditoria perde os cruzamentos). Da segunda em diante, a carga
  // histórica pula — e o ciclo DIÁRIO, que não é backfill, continua atualizando
  // todo dia, que é onde a mudança de cadastro precisa mesmo chegar.
  if (backfill) {
    const jaTemCadastro = await prisma.omieParceiro.findFirst({
      where: { conexaoId: ctx.conexaoId },
      select: { id: true },
    });
    if (jaTemCadastro) return { ...res, faseConcluida: true };
  }

  const cursor = lerCursor<CursorCadastros>(ctx.cursor, { entidade: ENTIDADES_CADASTRO[0], pagina: 1 });

  let indice = ENTIDADES_CADASTRO.indexOf(cursor.entidade as (typeof ENTIDADES_CADASTRO)[number]);
  if (indice < 0) indice = 0;
  let pagina = cursor.pagina;

  for (; indice < ENTIDADES_CADASTRO.length; indice++) {
    const entidade = ENTIDADES_CADASTRO[indice];
    const endpoint: OmieEndpoint = OMIE_ENDPOINTS[entidade];

    for (;;) {
      if (acabouOTempo(ctx)) {
        return { ...res, proximoCursor: JSON.stringify({ entidade, pagina } satisfies CursorCadastros) };
      }

      let resposta;
      try {
        resposta = await omieCall(
          endpoint,
          { pagina, registros_por_pagina: REGISTROS_POR_PAGINA, apenas_importado_api: "N" },
          { credencialRef: ctx.credencialRef, deadline: ctx.deadline, toleraVazio: true }
        );
      } catch (e) {
        if (e instanceof OmieVazioError) break;
        res.erros.push(`${entidade}: ${e instanceof Error ? e.message : "erro desconhecido"}`);
        break;
      }
      await sleep(OMIE_PACE_MS);

      const itens = extrairItens(resposta, endpoint);
      res.cadastros += await gravarCadastros(ctx, entidade, itens);

      const totalPaginas = extrairTotalPaginas(resposta);
      if (itens.length === 0 || pagina >= totalPaginas) break;
      pagina++;
    }
    pagina = 1;
  }

  return { ...res, faseConcluida: true };
}

// Grava uma página de cadastros em UM lote.
//
// Antes era um upsert por registro — e, no caso de cliente, duas idas ao banco
// por registro, porque o hash bancário anterior era consultado um a um. Com
// 8.572 clientes numa conta, isso passa de dezessete mil viagens de rede entre
// a função na Vercel e o banco no Neon. A latência dessas viagens, e não o
// volume de dados, é o que consumia as invocações de 40 segundos.
//
// `$transaction` com array despacha o lote de uma vez. A leitura dos hashes
// vira uma consulta por página, em vez de uma por cliente.
async function gravarCadastros(
  ctx: ContextoFase,
  entidade: (typeof ENTIDADES_CADASTRO)[number],
  itens: Record<string, unknown>[]
): Promise<number> {
  const { companyId, conexaoId, conexaoApelido } = ctx;
  const comuns = { companyId, conexaoId, conexaoApelido };
  const agora = new Date();

  if (entidade === "clientes") {
    const parceiros = itens.map(normalizarParceiro).filter((p): p is NonNullable<typeof p> => p !== null);
    if (parceiros.length === 0) return 0;

    // Troca de dados bancários de fornecedor é o vetor clássico de fraude de
    // boleto. O carimbo de "alterada em" só muda quando o hash MUDA — nunca
    // quando ele aparece pela primeira vez, que é só o cadastro sendo
    // espelhado. Ver o agente antifraude, regra FR-CONTA-ALTERADA.
    const anteriores = await prisma.omieParceiro.findMany({
      where: { conexaoId, codigoOmie: { in: parceiros.map((p) => p.codigoOmie) } },
      select: { codigoOmie: true, contaBancariaHash: true },
    });
    const hashAnterior = new Map(anteriores.map((a) => [a.codigoOmie, a.contaBancariaHash]));

    await gravarEmLotes(parceiros, (lote) =>
      prisma.$transaction(
        lote.map((p) => {
          const antes = hashAnterior.get(p.codigoOmie) ?? null;
          const trocou = antes !== null && p.contaBancariaHash !== null && antes !== p.contaBancariaHash;
          return prisma.omieParceiro.upsert({
            where: { conexaoId_codigoOmie: { conexaoId, codigoOmie: p.codigoOmie } },
            // `primeiraVezEm` só no create, e é o ponto inteiro dela: no update
            // ela não aparece, então a data em que o espelho viu o fornecedor
            // pela primeira vez sobrevive a todas as sincronizações seguintes.
            // Foi exatamente isso que faltou a `sincronizadoEm`, que é
            // reescrito toda vez e por isso não sabe dizer quem é novo.
            create: { ...comuns, ...p, primeiraVezEm: agora, sincronizadoEm: agora },
            update: {
              ...p,
              ...(trocou ? { contaBancariaAlteradaEm: agora } : {}),
              sincronizadoEm: agora,
            },
            // Só o id volta. O padrão do Prisma é devolver a linha inteira, e
            // multiplicado por milhares de registros isso é tráfego puro sem
            // uso — ninguém lê o retorno destes upserts.
            select: { id: true },
          });
        })
      )
    );
    return parceiros.length;
  }

  if (entidade === "categorias") {
    const registros = itens.map(normalizarCategoria).filter((c): c is NonNullable<typeof c> => c !== null);
    await gravarEmLotes(registros, (lote) =>
      prisma.$transaction(
        lote.map((c) =>
          prisma.omieCategoria.upsert({
            where: { conexaoId_codigo: { conexaoId, codigo: c.codigo } },
            create: { ...comuns, ...c },
            update: { ...c, sincronizadoEm: agora },
            select: { id: true },
          })
        )
      )
    );
    return registros.length;
  }

  if (entidade === "departamentos") {
    const registros = itens.map(normalizarDepartamento).filter((d): d is NonNullable<typeof d> => d !== null);
    await gravarEmLotes(registros, (lote) =>
      prisma.$transaction(
        lote.map((d) =>
          prisma.omieDepartamento.upsert({
            where: { conexaoId_codigo: { conexaoId, codigo: d.codigo } },
            create: { ...comuns, ...d },
            update: { ...d, sincronizadoEm: agora },
            select: { id: true },
          })
        )
      )
    );
    return registros.length;
  }

  if (entidade === "projetos") {
    const registros = itens.map(normalizarProjeto).filter((p): p is NonNullable<typeof p> => p !== null);
    await gravarEmLotes(registros, (lote) =>
      prisma.$transaction(
        lote.map((p) =>
          prisma.omieProjeto.upsert({
            where: { conexaoId_codigo: { conexaoId, codigo: p.codigo } },
            create: { ...comuns, ...p },
            update: { ...p, sincronizadoEm: agora },
            select: { id: true },
          })
        )
      )
    );
    return registros.length;
  }

  const contas = itens.map(normalizarContaCorrente).filter((c): c is NonNullable<typeof c> => c !== null);
  await gravarEmLotes(contas, (lote) =>
    prisma.$transaction(
      lote.map((cc) =>
        prisma.omieContaCorrente.upsert({
          where: { conexaoId_codigo: { conexaoId, codigo: cc.codigo } },
          create: { ...comuns, ...cc },
          update: { ...cc, sincronizadoEm: agora },
          select: { id: true },
        })
      )
    )
  );
  return contas.length;
}

// ---------- Fase 2: titulos ----------
// Um titulo pode precisar ser resincronizado por tres motivos distintos, e
// cada um exige um FILTRO diferente na Omie (a API nao tem um "tudo que
// mudou desde X"):
//   emissao   — titulo novo, lancado na janela;
//   pagamento — titulo antigo que foi baixado na janela (e onde aparecem
//               juros/multa, o dado que mais importa pra auditoria);
//   vencimento— titulo em aberto cujo STATUS muda sozinho com o tempo
//               ("a vencer" vira "atrasado" sem ninguem tocar nele).
// Por isso a fase roda como uma lista de "passos", cada um com seu filtro, e
// o cursor guarda (passo, pagina). Um passo que a conta Omie do cliente nao
// aceitar (parametro indisponivel no plano/versao) e registrado como erro e
// PULADO — nunca derruba os demais.

type PassoTitulo = { id: string; natureza: OmieNatureza; param: Record<string, unknown> };
type CursorTitulos = { passo: number; pagina: number };

// Janela de vencimento revisada a cada execucao diaria. 120 dias para tras
// cobre a inadimplencia recente que ainda esta sendo cobrada; 120 para
// frente cobre a projecao de fluxo de caixa que o painel mostra.
const DIAS_REVISAO_VENCIMENTO = 120;

export function planejarPassosTitulos(
  janelaInicio: Date,
  janelaFim: Date,
  backfill: boolean
): PassoTitulo[] {
  const de = formatarDataOmie(janelaInicio);
  const ate = formatarDataOmie(janelaFim);

  const revisaoDe = new Date(janelaFim);
  revisaoDe.setDate(revisaoDe.getDate() - DIAS_REVISAO_VENCIMENTO);
  const revisaoAte = new Date(janelaFim);
  revisaoAte.setDate(revisaoAte.getDate() + DIAS_REVISAO_VENCIMENTO);

  const passos: PassoTitulo[] = [];
  for (const natureza of ["PAGAR", "RECEBER"] as const) {
    const cNatureza = natureza === "PAGAR" ? "P" : "R";
    passos.push({
      id: `${natureza}:emissao`,
      natureza,
      param: { cNatureza, dDtEmisDe: de, dDtEmisAte: ate },
    });
    passos.push({
      id: `${natureza}:pagamento`,
      natureza,
      param: { cNatureza, dDtPagtoDe: de, dDtPagtoAte: ate },
    });
    // No backfill (carga historica mes a mes) a janela de vencimento seria
    // redundante com a de emissao e triplicaria o consumo da API sem trazer
    // titulo novo — so o ciclo diario precisa dela.
    if (!backfill) {
      passos.push({
        id: `${natureza}:vencimento`,
        natureza,
        param: {
          cNatureza,
          dDtVencDe: formatarDataOmie(revisaoDe),
          dDtVencAte: formatarDataOmie(revisaoAte),
        },
      });
    }
  }
  return passos;
}

async function sincronizarTitulos(ctx: ContextoFase, backfill: boolean): Promise<ResultadoFase> {
  const res = vazio();
  const passos = planejarPassosTitulos(ctx.janelaInicio, ctx.janelaFim, backfill);
  const cursor = lerCursor<CursorTitulos>(ctx.cursor, { passo: 0, pagina: 1 });

  let indice = cursor.passo;
  let pagina = cursor.pagina;

  for (; indice < passos.length; indice++) {
    const passo = passos[indice];

    for (;;) {
      if (acabouOTempo(ctx)) {
        return {
          ...res,
          proximoCursor: JSON.stringify({ passo: indice, pagina } satisfies CursorTitulos),
        };
      }

      let resposta;
      try {
        resposta = await omieCall(
          OMIE_ENDPOINTS.titulos,
          { nPagina: pagina, nRegPorPagina: REGISTROS_POR_PAGINA, ...passo.param },
          { credencialRef: ctx.credencialRef, deadline: ctx.deadline, toleraVazio: true }
        );
      } catch (e) {
        if (e instanceof OmieVazioError) break;
        res.erros.push(`títulos ${passo.id}: ${e instanceof Error ? e.message : "erro desconhecido"}`);
        break;
      }
      await sleep(OMIE_PACE_MS);

      const itens = extrairItens(resposta, OMIE_ENDPOINTS.titulos);

      // PesquisarLancamentos identifica o parceiro por CODIGO e CNPJ, nunca por
      // nome — conferido pelo diagnostico nas duas contas. Sem resolver o nome
      // aqui, toda tela de titulo mostraria "(não identificado)" e o agente
      // antifraude, que casa fornecedor com funcionario da folha, perderia o
      // lado legivel do achado.
      //
      // Resolvido em LOTE, uma consulta por pagina, contra o cadastro de
      // parceiros que a fase anterior do proprio ciclo ja espelhou. Fazer por
      // titulo seriam 500 consultas por pagina — em 20 meses de carga, o
      // suficiente para nao caber no orcamento de tempo da invocacao.
      const normalizados = itens
        .map((bruto) => normalizarTitulo(bruto, passo.natureza))
        .filter((t): t is NonNullable<typeof t> => t !== null);

      const codigosSemNome = [
        ...new Set(normalizados.filter((t) => !t.parceiroNome && t.parceiroCodigo).map((t) => t.parceiroCodigo!)),
      ];
      const nomePorCodigo = new Map<string, string>();
      if (codigosSemNome.length > 0) {
        const parceiros = await prisma.omieParceiro.findMany({
          where: { conexaoId: ctx.conexaoId, codigoOmie: { in: codigosSemNome } },
          select: { codigoOmie: true, nome: true },
        });
        for (const p of parceiros) nomePorCodigo.set(p.codigoOmie, p.nome);
      }

      // A DESCRICAO DA CATEGORIA tem exatamente o mesmo problema, e a mesma
      // solucao.
      //
      // O titulo traz `cCodCateg` e nunca a descricao — confirmado pelo
      // diagnostico nas duas contas, nas duas naturezas. O efeito era visivel e
      // ninguem tinha nomeado: a composicao de receita e despesa por categoria,
      // que existe para responder "de onde vem esse numero", listava codigos.
      // "1.01.03" nao responde nada; "Prestacao de servicos" responde.
      //
      // Em lote, contra o plano de categorias que a fase de cadastros do
      // proprio ciclo ja espelhou — mesma consulta unica por pagina, pelo mesmo
      // motivo de orcamento de tempo.
      const codigosSemDescricao = [
        ...new Set(
          normalizados.filter((t) => !t.categoriaDescricao && t.categoriaCodigo).map((t) => t.categoriaCodigo!)
        ),
      ];
      const descricaoPorCodigo = new Map<string, string>();
      if (codigosSemDescricao.length > 0) {
        const categorias = await prisma.omieCategoria.findMany({
          where: { conexaoId: ctx.conexaoId, codigo: { in: codigosSemDescricao } },
          select: { codigo: true, descricao: true },
        });
        for (const c of categorias) descricaoPorCodigo.set(c.codigo, c.descricao);
      }

      // Gravação em DOIS lotes, e não um upsert por registro.
      //
      // A versão anterior fazia uma ida ao banco por título e outra por baixa:
      // com 200 registros por página, umas 500 idas e voltas. A função roda na
      // Vercel e o banco é o Neon; cada ida paga latência de rede, e o efeito
      // medido foi uma janela mensal não terminar em nove invocações de 40
      // segundos — o que, em 38 janelas, nunca fecharia a carga.
      //
      // `$transaction` com um ARRAY de operações despacha o lote de uma vez, e
      // devolve os resultados na ordem em que entraram — que é como os ids dos
      // títulos chegam para as baixas. Dois lotes por página, em vez de
      // quinhentas viagens.
      //
      // Baixa depende do id do seu título, então os lotes não podem virar um
      // só. A ordem entre eles importa e está garantida pelo await.
      const comNome = normalizados.map((n) => ({
        ...n,
        parceiroNome: n.parceiroNome ?? nomePorCodigo.get(n.parceiroCodigo ?? "") ?? null,
        categoriaDescricao: n.categoriaDescricao ?? descricaoPorCodigo.get(n.categoriaCodigo ?? "") ?? null,
      }));

      // Os ids voltam na ordem em que as operações entraram, e é assim que
      // cada baixa encontra o seu título. Acumular lote a lote preserva essa
      // ordem — o que a versão de transação única dava de graça e passa a ser
      // responsabilidade daqui.
      const gravados: { id: string }[] = [];
      await gravarEmLotes(comNome, async (lote) => {
        const parcial = await prisma.$transaction(
          lote.map((t) =>
            prisma.omieTitulo.upsert({
              where: {
                conexaoId_natureza_codigoLancamento: {
                  conexaoId: ctx.conexaoId,
                  natureza: passo.natureza,
                  codigoLancamento: t.codigoLancamento,
                },
              },
              create: {
                companyId: ctx.companyId,
                conexaoId: ctx.conexaoId,
                conexaoApelido: ctx.conexaoApelido,
                ...semBaixas(t),
              },
              update: { ...semBaixas(t), sincronizadoEm: new Date() },
              select: { id: true },
            })
          )
        );
        gravados.push(...parcial);
      });

      const baixasDaPagina = comNome.flatMap((t, i) =>
        t.baixas.map((b) =>
          prisma.omieBaixa.upsert({
            where: { conexaoId_chave: { conexaoId: ctx.conexaoId, chave: b.chave } },
            create: { companyId: ctx.companyId, conexaoId: ctx.conexaoId, tituloId: gravados[i].id, ...b },
            update: { ...b, tituloId: gravados[i].id, sincronizadoEm: new Date() },
            select: { id: true },
          })
        )
      );
      await gravarEmLotes(baixasDaPagina, (lote) => prisma.$transaction(lote));

      res.baixas += baixasDaPagina.length;
      if (passo.natureza === "PAGAR") res.titulosPagar += comNome.length;
      else res.titulosReceber += comNome.length;

      const totalPaginas = extrairTotalPaginas(resposta);
      if (itens.length === 0 || pagina >= totalPaginas) break;
      pagina++;
    }
    pagina = 1;
  }

  return { ...res, faseConcluida: true };
}

// ---------- Fase 3: movimentos (extrato bancario) ----------
// Uma chamada por conta corrente por janela. O extrato nao e paginado, entao
// o cursor guarda so o indice da conta.

type CursorMovimentos = { conta: number };

async function sincronizarMovimentos(ctx: ContextoFase): Promise<ResultadoFase> {
  const res = vazio();
  const contas = await prisma.omieContaCorrente.findMany({
    where: { conexaoId: ctx.conexaoId, inativa: false },
    select: { codigo: true },
    orderBy: { codigo: "asc" },
  });
  const cursor = lerCursor<CursorMovimentos>(ctx.cursor, { conta: 0 });

  for (let i = cursor.conta; i < contas.length; i++) {
    if (acabouOTempo(ctx)) {
      return { ...res, proximoCursor: JSON.stringify({ conta: i } satisfies CursorMovimentos) };
    }

    const codigo = contas[i].codigo;
    let resposta;
    try {
      resposta = await omieCall(
        OMIE_ENDPOINTS.extrato,
        {
          nCodCC: Number(codigo),
          dPeriodoInicial: formatarDataOmie(ctx.janelaInicio),
          dPeriodoFinal: formatarDataOmie(ctx.janelaFim),
        },
        { credencialRef: ctx.credencialRef, deadline: ctx.deadline, toleraVazio: true }
      );
    } catch (e) {
      if (!(e instanceof OmieVazioError)) {
        res.erros.push(`extrato conta ${codigo}: ${e instanceof Error ? e.message : "erro desconhecido"}`);
      }
      continue;
    } finally {
      await sleep(OMIE_PACE_MS);
    }

    for (const bruto of extrairItens(resposta, OMIE_ENDPOINTS.extrato)) {
      const m = normalizarMovimentoExtrato(bruto, codigo);
      if (!m) continue;
      await prisma.omieMovimento.upsert({
        where: {
          conexaoId_codigoLancamento: { conexaoId: ctx.conexaoId, codigoLancamento: m.codigoLancamento },
        },
        create: {
          companyId: ctx.companyId,
          conexaoId: ctx.conexaoId,
          conexaoApelido: ctx.conexaoApelido,
          ...m,
          // A coluna é não-nula com padrão `false`; o normalizador devolve nulo
          // quando a Omie não informa. A decisão de tratar desconhecido como
          // "não conciliado" é DA GRAVAÇÃO, e fica escrita aqui — no
          // normalizador ela apagaria a diferença antes do diagnóstico vê-la.
          conciliado: m.conciliado ?? false,
        },
        update: { ...m, conciliado: m.conciliado ?? false, sincronizadoEm: new Date() },
      });
      res.movimentos++;
    }
  }

  return { ...res, faseConcluida: true };
}

// ---------- Fase 4: notas fiscais ----------
// Best-effort por decisao consciente: os parametros de filtro de data da
// NF-e/NFS-e variam entre planos e versoes do ERP, e uma recusa aqui nao
// pode impedir o relatorio financeiro do dia (o nucleo da controladoria sao
// titulos e extrato). Falha desta fase vira erro registrado no run e achado
// de conformidade, nunca aborto.

type CursorNotas = { tipo: "NFE" | "NFSE"; pagina: number };

async function sincronizarNotas(ctx: ContextoFase): Promise<ResultadoFase> {
  const res = vazio();
  const cursor = lerCursor<CursorNotas>(ctx.cursor, { tipo: "NFE", pagina: 1 });
  const tipos: ("NFE" | "NFSE")[] = ["NFE", "NFSE"];

  let indice = Math.max(0, tipos.indexOf(cursor.tipo));
  let pagina = cursor.pagina;

  for (; indice < tipos.length; indice++) {
    const tipo = tipos[indice];
    const endpoint = tipo === "NFE" ? OMIE_ENDPOINTS.nfe : OMIE_ENDPOINTS.nfse;

    for (;;) {
      if (acabouOTempo(ctx)) {
        return { ...res, proximoCursor: JSON.stringify({ tipo, pagina } satisfies CursorNotas) };
      }

      // NFS-e vai com a lista de variantes de filtro: o vocabulario dessa
      // operacao difere do da NF-e e a conta e quem diz qual aceita (ver
      // paramsNfse no client). A ultima variante nao filtra por data, entao a
      // nota de servico entra na base de qualquer jeito.
      const param =
        tipo === "NFE"
          ? {
              pagina,
              registros_por_pagina: REGISTROS_POR_PAGINA,
              apenas_importado_api: "N",
              dEmiInicial: formatarDataOmie(ctx.janelaInicio),
              dEmiFinal: formatarDataOmie(ctx.janelaFim),
            }
          : paramsNfse(
              pagina,
              REGISTROS_POR_PAGINA,
              formatarDataOmie(ctx.janelaInicio),
              formatarDataOmie(ctx.janelaFim)
            );

      let resposta;
      try {
        resposta = await omieCall(endpoint, param, {
          credencialRef: ctx.credencialRef,
          deadline: ctx.deadline,
          toleraVazio: true,
        });
      } catch (e) {
        if (!(e instanceof OmieVazioError)) {
          res.erros.push(`notas ${tipo}: ${e instanceof Error ? e.message : "erro desconhecido"}`);
        }
        break;
      }
      await sleep(OMIE_PACE_MS);

      const itens = extrairItens(resposta, endpoint);
      for (const bruto of itens) {
        const n = tipo === "NFE" ? normalizarNfe(bruto) : normalizarNfse(bruto);
        if (!n) continue;
        await prisma.omieNota.upsert({
          where: { conexaoId_chave: { conexaoId: ctx.conexaoId, chave: n.chave } },
          create: {
            companyId: ctx.companyId,
            conexaoId: ctx.conexaoId,
            conexaoApelido: ctx.conexaoApelido,
            ...n,
          },
          update: { ...n, sincronizadoEm: new Date() },
        });
        res.notas++;
      }

      const totalPaginas = extrairTotalPaginas(resposta);
      if (itens.length === 0 || pagina >= totalPaginas) break;
      pagina++;
    }
    pagina = 1;
  }

  return { ...res, faseConcluida: true };
}

export async function executarFase(
  fase: FaseSync,
  ctx: ContextoFase,
  backfill: boolean
): Promise<ResultadoFase> {
  switch (fase) {
    case "cadastros":
      return sincronizarCadastros(ctx, backfill);
    case "titulos":
      return sincronizarTitulos(ctx, backfill);
    case "movimentos":
      return sincronizarMovimentos(ctx);
    case "notas":
      return sincronizarNotas(ctx);
  }
}

export function proximaFase(fase: FaseSync): FaseSync | null {
  const i = FASES.indexOf(fase);
  return i >= 0 && i < FASES.length - 1 ? FASES[i + 1] : null;
}
