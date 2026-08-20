import type { OmieConexao, OmieSyncRun } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { credencialConfigurada } from "@/lib/omie/client";
import { executarFase, FASES, proximaFase, type FaseSync } from "@/lib/omie/sync";
import { carregarContexto, garantirConfig } from "./contexto";
import { executarAuditoria } from "./engine";
import { gerarEEnviarRelatorio } from "./relatorio";
import { fimDoDia, inicioDoDia, inicioDoMes, somarDias } from "./periodos";

// CICLO DIÁRIO DA CONTROLADORIA
//
// Máquina de estados que leva o sistema de "nada" a "relatório no e-mail".
// Com mais de uma conta Omie no grupo, o ciclo tem dois tipos de execução:
//
//   1. SINCRONIZAÇÃO, uma por conexão (Azul, MCZ):
//        cadastros → títulos → movimentos → notas
//      Cada conta tem credencial, numeração e limite de consumo próprios —
//      misturá-las numa execução só significaria uma falha na Azul parar o
//      espelho da MCZ, e um cursor compartilhado entre APIs diferentes.
//
//   2. CONSOLIDAÇÃO, uma por dia, depois que TODAS as conexões terminaram:
//        auditoria → relatório
//      Roda sobre o grupo inteiro. É aqui que aparece o que nenhuma das duas
//      empresas veria sozinha: a mesma nota paga pelas duas, o caixa total, a
//      concentração real de fornecedor.
//
// Roda em passos porque o cron da Vercel no plano Hobby tem 60s de teto duro
// por invocação. Cada chamada de executarPasso() faz o que cabe no orçamento,
// grava onde parou em OmieSyncRun (fase + cursor) e devolve se ainda há
// trabalho. Um único ponto de entrada serve ao cron (que se auto-encadeia) e
// ao botão "sincronizar agora" da tela.
//
// A CARGA HISTÓRICA (backfill) usa a mesma máquina, mês a mês, por conexão,
// sem gerar relatório: são dezenas de janelas mensais e disparar um e-mail por
// mês carregado seria absurdo.

// Fases que rodam depois da sincronização, só na execução consolidada.
export type FasePosSync = "auditoria" | "relatorio";
export type FaseCiclo = FaseSync | FasePosSync | "concluido";

export type ResultadoPasso = {
  runId: string | null;
  fase: FaseCiclo;
  conexaoApelido: string | null;
  backfill: boolean;
  concluido: boolean;
  // Ainda há trabalho: o chamador deve invocar de novo (encadeando ou em laço).
  continua: boolean;
  detalhes: string[];
};

function nadaAFazer(detalhe: string): ResultadoPasso {
  return {
    runId: null,
    fase: "concluido",
    conexaoApelido: null,
    backfill: false,
    concluido: true,
    continua: false,
    detalhes: [detalhe],
  };
}

export async function executarPasso(params: {
  companyId: string;
  // Timestamp absoluto até onde este passo pode trabalhar.
  fimDoOrcamento: number;
  // Teto duro da invocação (mais folgado), repassado ao cliente HTTP.
  deadline: number;
  // Data de referência do ciclo diário (D-1).
  dataReferencia: Date;
}): Promise<ResultadoPasso> {
  const { companyId, fimDoOrcamento, deadline, dataReferencia } = params;
  const config = await garantirConfig(companyId);

  const conexoes = await prisma.omieConexao.findMany({
    where: { companyId, ativa: true },
    orderBy: { ordem: "asc" },
  });
  if (conexoes.length === 0) {
    return nadaAFazer("Nenhuma conexão Omie ativa cadastrada.");
  }

  // Conexão sem credencial no ambiente não entra no ciclo: tentar sincronizar
  // produziria erro a cada invocação e encheria o log sem chance de sucesso.
  // Aparece como pendência na tela de conexões, que é onde a pessoa resolve.
  const utilizaveis = conexoes.filter((c) => credencialConfigurada(c.credencialRef));
  if (utilizaveis.length === 0) {
    return nadaAFazer(
      "Nenhuma conexão com credencial configurada no ambiente — confira as variáveis OMIE_APP_KEY_* na hospedagem."
    );
  }

  const run = await obterOuCriarRun(companyId, utilizaveis, dataReferencia, config.dataInicioBase);
  if (!run) return nadaAFazer("Ciclo do dia já concluído para todas as conexões.");

  const conexao = run.conexaoId ? utilizaveis.find((c) => c.id === run.conexaoId) ?? null : null;
  const detalhes: string[] = [];
  const fase = run.fase as FaseCiclo;

  // ---- Fases de sincronização (sempre no escopo de uma conexão) ----
  if ((FASES as readonly string[]).includes(fase)) {
    if (!conexao) {
      // Execução de sync sem conexão resolvível: a conexão foi desativada ou
      // removida no meio do caminho. Encerra em vez de girar em falso.
      await prisma.omieSyncRun.update({
        where: { id: run.id },
        data: { status: "ERRO", finalizadoEm: new Date(), erro: "Conexão da execução não está mais ativa." },
      });
      return nadaAFazer("Execução encerrada: a conexão correspondente foi desativada.");
    }

    const resultado = await executarFase(
      fase as FaseSync,
      {
        companyId,
        conexaoId: conexao.id,
        conexaoApelido: conexao.apelido,
        credencialRef: conexao.credencialRef,
        cursor: run.cursor,
        janelaInicio: run.janelaInicio,
        janelaFim: run.janelaFim,
        fimDoOrcamento,
        deadline,
      },
      run.backfill
    );

    const proxima = resultado.faseConcluida ? proximaFase(fase as FaseSync) : null;
    // Fim das fases de sync: a execução da conexão termina aqui. A auditoria e
    // o relatório são de uma execução CONSOLIDADA, criada quando todas as
    // conexões tiverem terminado (ver obterOuCriarRun).
    const novaFase: FaseCiclo = resultado.faseConcluida ? proxima ?? "concluido" : (fase as FaseCiclo);

    await prisma.omieSyncRun.update({
      where: { id: run.id },
      data: {
        fase: novaFase,
        cursor: resultado.proximoCursor,
        invocacoes: { increment: 1 },
        cadastros: { increment: resultado.cadastros },
        titulosPagar: { increment: resultado.titulosPagar },
        titulosReceber: { increment: resultado.titulosReceber },
        baixas: { increment: resultado.baixas },
        movimentos: { increment: resultado.movimentos },
        notas: { increment: resultado.notas },
        ...(resultado.erros.length > 0
          ? { erro: [run.erro, ...resultado.erros].filter(Boolean).join(" | ").slice(0, 2000) }
          : {}),
        ...(novaFase === "concluido" ? { status: "CONCLUIDO" as const, finalizadoEm: new Date() } : {}),
      },
    });

    detalhes.push(
      `[${conexao.apelido}] ${fase}: ${resultado.titulosPagar} títulos a pagar, ${resultado.titulosReceber} a receber, ` +
        `${resultado.baixas} baixas, ${resultado.movimentos} movimentos, ${resultado.notas} notas, ` +
        `${resultado.cadastros} cadastros.`
    );
    for (const erro of resultado.erros) detalhes.push(`[${conexao.apelido}] erro: ${erro}`);

    return {
      runId: run.id,
      fase: novaFase,
      conexaoApelido: conexao.apelido,
      backfill: run.backfill,
      concluido: novaFase === "concluido",
      // Mesmo terminando esta conexão, o ciclo continua: há a próxima conexão,
      // o próximo mês de backfill ou a consolidação esperando. Quem decide é
      // obterOuCriarRun na chamada seguinte.
      continua: true,
      detalhes,
    };
  }

  // ---- Auditoria (consolidada, grupo inteiro) ----
  if (fase === "auditoria") {
    const ctx = await carregarContexto(companyId, run.janelaFim);
    const resultado = await executarAuditoria(ctx);

    await prisma.omieSyncRun.update({
      where: { id: run.id },
      data: {
        fase: "relatorio",
        cursor: null,
        invocacoes: { increment: 1 },
        achados: resultado.totalAbertos,
        detalhes: {
          supervisor: resultado.observacoesSupervisor,
          qualidadeDaBase: resultado.qualidadeDaBase,
          errosPorAgente: resultado.errosPorAgente,
          novos: resultado.novos,
          reincidentes: resultado.reincidentes,
          fechadosAutomaticamente: resultado.fechadosAutomaticamente,
          suprimidos: resultado.suprimidos,
        },
      },
    });

    detalhes.push(
      `Auditoria: ${resultado.novos} novo(s), ${resultado.reincidentes} reincidente(s), ` +
        `${resultado.fechadosAutomaticamente} fechado(s) automaticamente, ${resultado.suprimidos} suprimido(s) pelo supervisor. ` +
        `${resultado.totalAbertos} em aberto (${resultado.criticos} crítico(s)).`
    );

    return {
      runId: run.id,
      fase: "relatorio",
      conexaoApelido: null,
      backfill: false,
      concluido: false,
      continua: true,
      detalhes,
    };
  }

  // ---- Relatório ----
  if (fase === "relatorio") {
    const ctx = await carregarContexto(companyId, run.janelaFim);
    const enviados: string[] = [];

    if (config.relatorioPorConexao && conexoes.length > 1) {
      // Um relatório por empresa: o contexto é recarregado com o filtro da
      // conexão, então cada e-mail traz os números daquela empresa — e não uma
      // fatia do consolidado, que seria outra coisa.
      for (const c of conexoes) {
        const ctxConexao = await carregarContexto(companyId, run.janelaFim, c.id);
        const r = await gerarEEnviarRelatorio(ctxConexao, { enviar: true, conexao: c });
        enviados.push(
          r.enviado ? `[${c.apelido}] enviado para ${r.destinatarios.join(", ")}.` : `[${c.apelido}] não enviado: ${r.erro}`
        );
      }
    } else {
      const r = await gerarEEnviarRelatorio(ctx, { enviar: true });
      enviados.push(
        r.enviado ? `Relatório consolidado enviado para ${r.destinatarios.join(", ")}.` : `Não enviado: ${r.erro}`
      );
    }

    await prisma.omieSyncRun.update({
      where: { id: run.id },
      data: { fase: "concluido", status: "CONCLUIDO", finalizadoEm: new Date(), invocacoes: { increment: 1 } },
    });

    detalhes.push(...enviados);

    return {
      runId: run.id,
      fase: "concluido",
      conexaoApelido: null,
      backfill: false,
      concluido: true,
      continua: false,
      detalhes,
    };
  }

  return nadaAFazer("Nada a fazer.");
}

// Decide em que execução trabalhar, nesta ordem de prioridade:
//   1. execução já em andamento (retoma de onde parou);
//   2. próxima janela de carga histórica de alguma conexão;
//   3. sincronização do dia de alguma conexão que ainda não rodou;
//   4. consolidação do dia, quando todas as conexões já terminaram.
async function obterOuCriarRun(
  companyId: string,
  conexoes: OmieConexao[],
  dataReferencia: Date,
  dataInicioBase: Date
): Promise<OmieSyncRun | null> {
  const emAndamento = await prisma.omieSyncRun.findFirst({
    where: { companyId, status: "EXECUTANDO" },
    orderBy: { iniciadoEm: "asc" },
  });
  if (emAndamento) return emAndamento;

  const mesCorrente = inicioDoMes(dataReferencia);

  // ---- 2. Carga histórica pendente ----
  for (const conexao of conexoes) {
    const ultimoBackfill = await prisma.omieSyncRun.findFirst({
      where: { conexaoId: conexao.id, backfill: true, status: "CONCLUIDO" },
      orderBy: { janelaFim: "desc" },
    });

    const proximoMes = ultimoBackfill
      ? inicioDoMes(new Date(ultimoBackfill.janelaFim.getFullYear(), ultimoBackfill.janelaFim.getMonth() + 1, 1))
      : inicioDoMes(dataInicioBase);

    if (proximoMes < mesCorrente) {
      const fim = fimDoDia(new Date(proximoMes.getFullYear(), proximoMes.getMonth() + 1, 0));
      return prisma.omieSyncRun.create({
        data: {
          companyId,
          conexaoId: conexao.id,
          fase: "cadastros",
          janelaInicio: proximoMes,
          janelaFim: fim,
          backfill: true,
        },
      });
    }
  }

  const janelaFimDoDia = fimDoDia(dataReferencia);
  // A janela diária cobre D-1 e alguns dias para trás: a Omie recebe
  // lançamento retroativo com frequência (a nota chega dias depois), e uma
  // janela de exatamente um dia perderia tudo que foi digitado com atraso.
  const janelaInicioDoDia = inicioDoDia(somarDias(dataReferencia, -3));

  // ---- 3. Sincronização do dia, por conexão ----
  for (const conexao of conexoes) {
    const jaRodou = await prisma.omieSyncRun.findFirst({
      where: {
        conexaoId: conexao.id,
        backfill: false,
        janelaFim: janelaFimDoDia,
        status: { in: ["CONCLUIDO", "ERRO"] },
      },
    });
    if (jaRodou) continue;

    return prisma.omieSyncRun.create({
      data: {
        companyId,
        conexaoId: conexao.id,
        fase: "cadastros",
        janelaInicio: janelaInicioDoDia,
        janelaFim: janelaFimDoDia,
        backfill: false,
      },
    });
  }

  // ---- 4. Consolidação do dia ----
  // `conexaoId: null` marca a execução do grupo. Só é criada depois que todas
  // as conexões terminaram: auditar com metade do espelho atualizado geraria
  // achado que some no dia seguinte, e ninguém confia num alerta assim.
  const consolidacaoFeita = await prisma.omieSyncRun.findFirst({
    where: { companyId, conexaoId: null, backfill: false, janelaFim: janelaFimDoDia },
  });
  if (consolidacaoFeita) return null;

  return prisma.omieSyncRun.create({
    data: {
      companyId,
      conexaoId: null,
      fase: "auditoria",
      janelaInicio: janelaInicioDoDia,
      janelaFim: janelaFimDoDia,
      backfill: false,
    },
  });
}

// Data de referência do ciclo: D-1 no fuso de Brasília. Calculada a partir do
// horário UTC do servidor (a Vercel roda em UTC) — usar a data local do
// processo faria o cron das 03:10 de Brasília processar "hoje" em vez de
// "ontem", e o relatório sairia sempre com um dia a mais.
export function dataReferenciaPadrao(agora = new Date()): Date {
  const brasilia = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
  return inicioDoDia(new Date(brasilia.getFullYear(), brasilia.getMonth(), brasilia.getDate() - 1));
}
