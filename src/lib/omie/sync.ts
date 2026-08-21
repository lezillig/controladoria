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

async function sincronizarCadastros(ctx: ContextoFase): Promise<ResultadoFase> {
  const res = vazio();
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

async function gravarCadastros(
  ctx: ContextoFase,
  entidade: (typeof ENTIDADES_CADASTRO)[number],
  itens: Record<string, unknown>[]
): Promise<number> {
  const { companyId, conexaoId, conexaoApelido } = ctx;
  let gravados = 0;

  for (const bruto of itens) {
    if (entidade === "clientes") {
      const p = normalizarParceiro(bruto);
      if (!p) continue;
      const { contaBancariaHash, ...resto } = p;
      // Troca de dados bancarios de fornecedor e o vetor classico de fraude
      // de boleto. O carimbo de "alterada em" so muda quando o hash MUDA
      // (nunca quando ele aparece pela primeira vez, que e so o cadastro
      // sendo espelhado) — ver o agente antifraude, regra FR-CONTA-ALTERADA.
      const atual = await prisma.omieParceiro.findUnique({
        where: { conexaoId_codigoOmie: { conexaoId, codigoOmie: p.codigoOmie } },
        select: { contaBancariaHash: true },
      });
      const trocou =
        atual?.contaBancariaHash != null &&
        contaBancariaHash != null &&
        atual.contaBancariaHash !== contaBancariaHash;

      await prisma.omieParceiro.upsert({
        where: { conexaoId_codigoOmie: { conexaoId, codigoOmie: p.codigoOmie } },
        create: { companyId, conexaoId, conexaoApelido, ...resto, contaBancariaHash, sincronizadoEm: new Date() },
        update: {
          ...resto,
          contaBancariaHash,
          ...(trocou ? { contaBancariaAlteradaEm: new Date() } : {}),
          sincronizadoEm: new Date(),
        },
      });
      gravados++;
      continue;
    }

    if (entidade === "categorias") {
      const c = normalizarCategoria(bruto);
      if (!c) continue;
      await prisma.omieCategoria.upsert({
        where: { conexaoId_codigo: { conexaoId, codigo: c.codigo } },
        create: { companyId, conexaoId, conexaoApelido, ...c },
        update: { ...c, sincronizadoEm: new Date() },
      });
      gravados++;
      continue;
    }

    if (entidade === "departamentos") {
      const d = normalizarDepartamento(bruto);
      if (!d) continue;
      await prisma.omieDepartamento.upsert({
        where: { conexaoId_codigo: { conexaoId, codigo: d.codigo } },
        create: { companyId, conexaoId, conexaoApelido, ...d },
        update: { ...d, sincronizadoEm: new Date() },
      });
      gravados++;
      continue;
    }

    if (entidade === "projetos") {
      const p = normalizarProjeto(bruto);
      if (!p) continue;
      await prisma.omieProjeto.upsert({
        where: { conexaoId_codigo: { conexaoId, codigo: p.codigo } },
        create: { companyId, conexaoId, conexaoApelido, ...p },
        update: { ...p, sincronizadoEm: new Date() },
      });
      gravados++;
      continue;
    }

    const cc = normalizarContaCorrente(bruto);
    if (!cc) continue;
    await prisma.omieContaCorrente.upsert({
      where: { conexaoId_codigo: { conexaoId, codigo: cc.codigo } },
      create: { companyId, conexaoId, conexaoApelido, ...cc },
      update: { ...cc, sincronizadoEm: new Date() },
    });
    gravados++;
  }

  return gravados;
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
      for (const bruto of itens) {
        const t = normalizarTitulo(bruto, passo.natureza);
        if (!t) continue;
        const { baixas, ...campos } = t;

        const titulo = await prisma.omieTitulo.upsert({
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
            ...campos,
          },
          update: { ...campos, sincronizadoEm: new Date() },
          select: { id: true },
        });

        for (const b of baixas) {
          await prisma.omieBaixa.upsert({
            where: { conexaoId_chave: { conexaoId: ctx.conexaoId, chave: b.chave } },
            create: { companyId: ctx.companyId, conexaoId: ctx.conexaoId, tituloId: titulo.id, ...b },
            update: { ...b, tituloId: titulo.id, sincronizadoEm: new Date() },
          });
          res.baixas++;
        }

        if (passo.natureza === "PAGAR") res.titulosPagar++;
        else res.titulosReceber++;
      }

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
        },
        update: { ...m, sincronizadoEm: new Date() },
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
      return sincronizarCadastros(ctx);
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
