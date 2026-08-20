import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { achadosSemTratativa } from "./agents/administrativo";
import { AGENTES } from "./registry";
import { supervisionar, type AchadoRevisado, type HistoricoAchado, type QualidadeDaBase } from "./supervisor";
import type { AchadoNovo, ContextoAuditoria } from "./types";

// MOTOR DE AUDITORIA
// Orquestra: agentes -> supervisor -> persistencia. Tudo que e decisao de
// negocio mora nos agentes; tudo que e julgamento sobre os achados mora no
// supervisor; aqui so fica o encanamento — de proposito, porque este e o
// arquivo que mais tende a virar depósito de regra escondida.

export type ResultadoAuditoria = {
  novos: number;
  reincidentes: number;
  fechadosAutomaticamente: number;
  suprimidos: number;
  totalAbertos: number;
  criticos: number;
  impactoTotalCents: number;
  observacoesSupervisor: string[];
  qualidadeDaBase: QualidadeDaBase;
  errosPorAgente: { agente: string; erro: string }[];
};

export async function executarAuditoria(ctx: ContextoAuditoria): Promise<ResultadoAuditoria> {
  const emitidos: AchadoNovo[] = [];
  const errosPorAgente: { agente: string; erro: string }[] = [];
  // Agentes que rodaram sem excecao. So as regras DELES podem fechar achados
  // automaticamente: se o agente de conciliacao quebrou, o silencio dele nao
  // e prova de que o problema acabou — e ausencia de informacao.
  const agentesOk: string[] = [];

  // Mapa regra -> agente, montado durante a propria execucao: e o que permite
  // gravar a autoria do achado sem obrigar cada agente a repetir o proprio id
  // em cada linha que emite (e sem executar ninguem duas vezes).
  const agentePorRegra = new Map<string, string>();

  for (const agente of AGENTES) {
    try {
      for (const achado of agente.executar(ctx)) {
        emitidos.push(achado);
        agentePorRegra.set(achado.regra, agente.id);
      }
      agentesOk.push(agente.id);
    } catch (e) {
      // Um agente que quebra nao pode derrubar os outros dez: o relatorio do
      // dia sai com o que deu certo e com o erro registrado, em vez de nao sair.
      errosPorAgente.push({ agente: agente.id, erro: e instanceof Error ? e.message : "erro desconhecido" });
    }
  }

  const anteriores = await prisma.auditFinding.findMany({
    where: { companyId: ctx.companyId },
    select: { chave: true, status: true, severidade: true, ocorrencias: true, regra: true, id: true },
  });
  const historico = new Map<string, HistoricoAchado>(
    anteriores.map((a) => [a.chave, { status: a.status, severidade: a.severidade, ocorrencias: a.ocorrencias }])
  );

  const revisao = supervisionar(ctx, emitidos, historico);

  // De qual empresa é cada achado. Os agentes não precisam se preocupar com
  // isso: quando o achado aponta para um título, a conexão é deduzida dele.
  // Achado sem entidade de título (projeção de caixa, indicadores do grupo)
  // fica sem conexão — e é o correto: ele fala do grupo, não de uma empresa.
  const conexaoPorTitulo = new Map(ctx.titulos.map((t) => [t.id, { id: t.conexaoId, apelido: t.conexaoApelido }]));
  // Apontamento de conformidade também sabe de qual empresa é — e pode
  // legitimamente não saber: consultoria que analisa os dois CNPJs no mesmo
  // relatório produz apontamento do grupo, e forçar uma empresa ali seria
  // inventar uma precisão que o documento não tem.
  const conexaoPorApontamento = new Map(
    ctx.conformidade.apontamentos
      .filter((a) => a.conexaoId && a.conexaoApelido)
      .map((a) => [a.id, { id: a.conexaoId as string, apelido: a.conexaoApelido as string }])
  );
  const resolverConexao = (achado: AchadoRevisado) => {
    if (achado.entidadeTipo === "OmieTitulo" && achado.entidadeId) {
      return conexaoPorTitulo.get(achado.entidadeId) ?? null;
    }
    if (achado.entidadeTipo === "ConformidadeApontamento" && achado.entidadeId) {
      return conexaoPorApontamento.get(achado.entidadeId) ?? null;
    }
    return null;
  };

  let novos = 0;
  let reincidentes = 0;
  const chavesEmitidas = new Set<string>();

  for (const achado of revisao.aprovados) {
    chavesEmitidas.add(achado.chave);
    const existente = historico.has(achado.chave);
    if (existente) reincidentes++;
    else novos++;
    await persistirAchado(ctx, achado, agentePorRegra.get(achado.regra) ?? "desconhecido", resolverConexao(achado));
  }

  // Fechamento automatico: achados de ESTADO que os agentes DELE pararam de
  // emitir deixaram de existir na base (o titulo foi pago, a conta foi
  // conciliada). Viram OBSOLETO — nunca RESOLVIDO, que e reservado a
  // tratativa humana registrada. A distincao importa no indicador de controle
  // interno: "resolvemos 40 achados" e diferente de "40 sumiram sozinhos".
  const regrasDeEstado = new Set(revisao.aprovados.filter((a) => a.tipo === "ESTADO").map((a) => a.regra));

  const fechaveis = anteriores.filter(
    (a) =>
      (a.status === "ABERTO" || a.status === "EM_ANALISE") &&
      !chavesEmitidas.has(a.chave) &&
      agentesOk.includes(agentePorRegra.get(a.regra) ?? "") &&
      regrasDeEstado.has(a.regra)
  );

  let fechadosAutomaticamente = 0;
  if (fechaveis.length > 0) {
    const resultado = await prisma.auditFinding.updateMany({
      where: { id: { in: fechaveis.map((a) => a.id) } },
      data: { status: "OBSOLETO", resolvidoEm: new Date() },
    });
    fechadosAutomaticamente = resultado.count;
  }

  // Meta-controle: achados criticos parados. Roda DEPOIS da persistencia,
  // sobre o estado final — auditar a si mesmo no meio da propria execucao
  // daria um retrato do qual o proprio ato de auditar ainda nao faz parte.
  const abertos = await prisma.auditFinding.findMany({
    where: { companyId: ctx.companyId, status: { in: ["ABERTO", "EM_ANALISE"] } },
    select: { severidade: true, detectadoEm: true, titulo: true, impactoCents: true },
  });

  const meta = achadosSemTratativa(
    abertos.map((a) => ({ severidade: a.severidade, detectadoEm: a.detectadoEm, titulo: a.titulo })),
    ctx.agora
  );
  if (meta) {
    await persistirAchado(ctx, { ...meta, confianca: 100, notaSupervisor: null, chaveRelacionada: null }, "administrativo", null);
  }

  const criticos = abertos.filter((a) => a.severidade === "CRITICA").length;
  const impactoTotalCents = abertos.reduce((acc, a) => acc + (a.impactoCents ?? 0), 0);

  return {
    novos,
    reincidentes,
    fechadosAutomaticamente,
    suprimidos: revisao.suprimidos.length,
    totalAbertos: abertos.length,
    criticos,
    impactoTotalCents,
    observacoesSupervisor: revisao.observacoes,
    qualidadeDaBase: revisao.qualidadeDaBase,
    errosPorAgente,
  };
}

async function persistirAchado(
  ctx: ContextoAuditoria,
  achado: AchadoRevisado,
  agente: string,
  conexao: { id: string; apelido: string } | null
): Promise<void> {
  const comum = {
    agente,
    conexaoId: conexao?.id ?? null,
    conexaoApelido: conexao?.apelido ?? null,
    regra: achado.regra,
    severidade: achado.severidade,
    categoria: achado.categoria,
    titulo: achado.titulo,
    descricao: achado.descricao,
    recomendacao: achado.recomendacao ?? null,
    valorCents: achado.valorCents ?? null,
    impactoCents: achado.impactoCents ?? null,
    dataReferencia: achado.dataReferencia ?? null,
    entidadeTipo: achado.entidadeTipo ?? null,
    entidadeId: achado.entidadeId ?? null,
    entidadeRef: achado.entidadeRef ?? null,
    evidencia: (achado.evidencia ?? null) as Prisma.InputJsonValue,
    confianca: achado.confianca,
    notaSupervisor: achado.notaSupervisor,
    chaveRelacionada: achado.chaveRelacionada,
  };

  await prisma.auditFinding.upsert({
    where: { companyId_chave: { companyId: ctx.companyId, chave: achado.chave } },
    create: { companyId: ctx.companyId, chave: achado.chave, ...comum },
    update: {
      // Campos calculados sao sempre atualizados (o valor de um titulo
      // vencido muda conforme ele e parcialmente pago). O que NAO se toca:
      // status, tratativa e detectadoEm — sao da pessoa que tratou, e
      // sobrescreve-los apagaria trabalho humano a cada execucao diaria.
      ...comum,
      ultimaOcorrencia: new Date(),
      ocorrencias: { increment: 1 },
    },
  });
}

// Reabre um achado fechado automaticamente cuja condicao voltou. Usado pelo
// upsert acima de forma implicita? Nao: de proposito, esta em funcao propria e
// explicita, porque reabrir um achado e um evento que merece aparecer no log
// (ver ControladoriaEventLog) e nao acontecer como efeito colateral de um
// update generico.
export async function reabrirSeNecessario(companyId: string, chave: string): Promise<boolean> {
  const atual = await prisma.auditFinding.findUnique({
    where: { companyId_chave: { companyId, chave } },
    select: { id: true, status: true },
  });
  if (!atual || atual.status !== "OBSOLETO") return false;

  await prisma.auditFinding.update({
    where: { id: atual.id },
    data: { status: "ABERTO", resolvidoEm: null },
  });
  return true;
}
