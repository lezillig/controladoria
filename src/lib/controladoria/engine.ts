import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { achadosSemTratativa } from "./agents/administrativo";
import { AGENTES } from "./registry";
import { chaveDeTratativa, supervisionar, type AchadoRevisado, type HistoricoAchado, type QualidadeDaBase } from "./supervisor";
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
  // Fechados sozinhos antes e re-detectados agora: voltaram à fila.
  reabertos: number;
  suprimidos: number;
  totalAbertos: number;
  criticos: number;
  impactoTotalCents: number;
  observacoesSupervisor: string[];
  qualidadeDaBase: QualidadeDaBase;
  errosPorAgente: { agente: string; erro: string }[];
};

// MODO RETROATIVO — a auditoria olhando para trás.
//
// O ciclo diário audita o ano corrente. A auditoria retroativa (ver
// retroativa.ts) carrega um período passado e roda os mesmos agentes sobre
// ele, para achar o que já aconteceu. Duas coisas mudam no motor, e só elas:
//
//   - Só achados de EVENTO são persistidos. ESTADO descreve "agora" (título
//     vencido hoje, concentração dos últimos 3 meses) e, calculado sobre um
//     recorte de 2024 com a data de referência de hoje, seria um "agora"
//     falso sobrescrevendo o verdadeiro que o ciclo diário gravou.
//   - Nada de ESTADO é fechado. O fechamento automático de ESTADO se apoia em
//     "o agente releu a base de hoje e não viu" — e a leitura retroativa não
//     é a base de hoje.
//
// EVENTO dentro do período reavaliado continua fechando quando o agente não
// o reencontra (regra recalibrada, dado corrigido), como no ciclo diário.
export type OpcoesDaAuditoria = { retroativa?: boolean };

export async function executarAuditoria(ctx: ContextoAuditoria, opcoes: OpcoesDaAuditoria = {}): Promise<ResultadoAuditoria> {
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
      for (const achado of await agente.executar(ctx)) {
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

  // Achados anteriores: os vivos, os julgados por gente e os fechados sozinhos
  // há pouco. OBSOLETO antigo fica de fora — a pilha só cresce (cada rodada
  // fecha centenas), a leitura ia a dezenas de milhares de linhas, e nada aqui
  // precisa deles: a reabertura de OBSOLETO re-emitido é feita em SQL, pela
  // chave, mais abaixo. Um OBSOLETO velho que volta conta como "novo" na
  // estatística da rodada — e reabre do mesmo jeito.
  const corteDeObsoletos = new Date(ctx.agora.getTime() - 90 * 86_400_000);
  const anteriores = await prisma.auditFinding.findMany({
    where: {
      companyId: ctx.companyId,
      OR: [{ status: { not: "OBSOLETO" } }, { resolvidoEm: { gte: corteDeObsoletos } }],
    },
    select: {
      chave: true, status: true, severidade: true, ocorrencias: true,
      regra: true, id: true,
      // Agente e tipo vêm da LINHA, não da execução corrente. Ver o comentário
      // do fechamento automático mais abaixo: era daqui que vinha o defeito.
      agente: true, tipo: true,
      entidadeId: true, entidadeRef: true,
      resolvidoEm: true,
      // Data do fato: decide se um EVENTO que sumiu estava dentro da janela
      // reavaliada (fecha) ou fora dela (fica). Ver podeFecharSozinho.
      dataReferencia: true,
    },
  });
  const historico = new Map<string, HistoricoAchado>(
    anteriores.map((a) => [a.chave, { status: a.status, severidade: a.severidade, ocorrencias: a.ocorrencias }])
  );

  // A tratativa humana também é lembrada por regra + entidade, para as regras
  // cuja chave muda todo mês (ver chaveDeTratativa no supervisor). Quando a
  // mesma pessoa julgou o mesmo fornecedor mais de uma vez, vale o julgamento
  // mais recente — é a única leitura que respeita "mudei de ideia".
  const historicoPorEntidade = new Map<string, HistoricoAchado & { tratadoEm: Date | null }>();
  for (const a of anteriores) {
    // Entram os dois julgamentos humanos, para que um "resolvido" posterior
    // sobreponha um "não se aplica" anterior; o supervisor só herda IGNORADO.
    if (a.status !== "IGNORADO" && a.status !== "RESOLVIDO") continue;
    const chave = chaveDeTratativa(a);
    if (!chave) continue;
    const atual = historicoPorEntidade.get(chave);
    if (atual && (atual.tratadoEm?.getTime() ?? 0) > (a.resolvidoEm?.getTime() ?? 0)) continue;
    historicoPorEntidade.set(chave, {
      status: a.status, severidade: a.severidade, ocorrencias: a.ocorrencias, tratadoEm: a.resolvidoEm,
    });
  }

  const revisao = supervisionar(ctx, emitidos, historico, historicoPorEntidade);

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
  const aPersistir: LinhaDeAchado[] = [];

  for (const achado of revisao.aprovados) {
    if (opcoes.retroativa && achado.tipo === "ESTADO") continue;
    // A mesma chave emitida duas vezes na rodada (duas regras equivalentes
    // consolidadas, ou um agente que repetiu a entidade) grava uma vez só:
    // o upsert em lote recusa chave repetida no mesmo comando.
    if (chavesEmitidas.has(achado.chave)) continue;
    chavesEmitidas.add(achado.chave);
    const existente = historico.has(achado.chave);
    if (existente) reincidentes++;
    else novos++;
    aPersistir.push(linhaDeAchado(ctx, achado, agentePorRegra.get(achado.regra) ?? "desconhecido", resolverConexao(achado)));
  }
  await persistirAchados(ctx.companyId, aPersistir);

  // FECHAMENTO AUTOMÁTICO — achados de ESTADO que deixaram de existir na base
  // (o título foi pago, a conta foi conciliada). Viram OBSOLETO, nunca
  // RESOLVIDO: este último é reservado à tratativa humana registrada, e a
  // distinção importa no indicador de controle interno — "resolvemos 40
  // achados" é diferente de "40 sumiram sozinhos".
  //
  // ESTA CONDIÇÃO JÁ FOI IMPOSSÍVEL DE SATISFAZER NO CASO QUE MAIS IMPORTA, e
  // vale registrar porque o defeito era invisível: tanto o tipo do achado
  // quanto o agente dono da regra eram deduzidos do que fora EMITIDO naquela
  // rodada. Para uma regra que parou de disparar — exatamente quando o
  // fechamento deveria acontecer — não havia o que deduzir. Resultado: zero
  // fechados em toda execução, e uma pilha que só crescia.
  //
  // Agora os dois vêm da própria linha, e a decisão passa a depender do que o
  // achado É, não do que a execução de hoje produziu.
  //
  // O que NÃO mudou, e é o que impede o conserto de virar outro defeito: o
  // agente dono precisa ter rodado sem erro. Se o agente quebrou, o silêncio
  // dele não é prova de que o problema acabou — é ausência de informação, e
  // fechar por ausência de informação é pior que não fechar.
  const janela = { desde: ctx.janelaDesde, ate: ctx.janelaAte ?? undefined };
  const fechaveis = anteriores.filter(
    (a) => !(opcoes.retroativa && a.tipo === "ESTADO") && podeFecharSozinho(a, chavesEmitidas, agentesOk, janela)
  );

  let fechadosAutomaticamente = 0;
  if (fechaveis.length > 0) {
    const resultado = await prisma.auditFinding.updateMany({
      where: { id: { in: fechaveis.map((a) => a.id) } },
      data: { status: "OBSOLETO", resolvidoEm: new Date() },
    });
    fechadosAutomaticamente = resultado.count;
  }

  // REABERTURA — o oposto do fechamento, e que faltava. Um achado fechado
  // sozinho (OBSOLETO) cuja condição VOLTOU precisa voltar à fila: o título
  // estornado que reabre, o evento fechado por recalibragem que a regra
  // corrigida volta a emitir, o meta-achado de tratativa parada que se
  // repete. O upsert de cima não toca no status de propósito (é da pessoa que
  // tratou), então ele nunca reabria nada — e o achado re-detectado ficava
  // OBSOLETO para sempre, com `ocorrencias` crescendo em silêncio. Só o
  // OBSOLETO reabre: RESOLVIDO e IGNORADO são julgamento humano.
  const reabertos = await prisma.auditFinding.updateMany({
    where: { companyId: ctx.companyId, chave: { in: [...chavesEmitidas] }, status: "OBSOLETO" },
    data: { status: "ABERTO", resolvidoEm: null },
  });

  // Meta-controle: achados criticos parados. Roda DEPOIS da persistencia,
  // sobre o estado final — auditar a si mesmo no meio da propria execucao
  // daria um retrato do qual o proprio ato de auditar ainda nao faz parte.
  const abertos = await prisma.auditFinding.findMany({
    where: { companyId: ctx.companyId, status: { in: ["ABERTO", "EM_ANALISE"] } },
    select: { severidade: true, detectadoEm: true, titulo: true, impactoCents: true },
  });

  const meta = opcoes.retroativa
    ? null
    : achadosSemTratativa(
        abertos.map((a) => ({ severidade: a.severidade, detectadoEm: a.detectadoEm, titulo: a.titulo })),
        ctx.agora
      );
  if (meta) {
    await persistirAchados(ctx.companyId, [
      linhaDeAchado(ctx, { ...meta, confianca: 100, notaSupervisor: null, chaveRelacionada: null }, "administrativo", null),
    ]);
    // O meta-achado é persistido DEPOIS do fechamento, então na execução
    // seguinte ele estava na lista de anteriores sem estar nas chaves
    // emitidas — e fechava. Reaberto aqui pelo mesmo caminho dos demais.
    await prisma.auditFinding.updateMany({
      where: { companyId: ctx.companyId, chave: meta.chave, status: "OBSOLETO" },
      data: { status: "ABERTO", resolvidoEm: null },
    });
  }

  const criticos = abertos.filter((a) => a.severidade === "CRITICA").length;
  const impactoTotalCents = abertos.reduce((acc, a) => acc + (a.impactoCents ?? 0), 0);

  return {
    novos,
    reincidentes,
    fechadosAutomaticamente,
    reabertos: reabertos.count,
    suprimidos: revisao.suprimidos.length,
    totalAbertos: abertos.length,
    criticos,
    impactoTotalCents,
    observacoesSupervisor: revisao.observacoes,
    qualidadeDaBase: revisao.qualidadeDaBase,
    errosPorAgente,
  };
}

// A linha que vai para o banco, já com tudo resolvido. Separada da gravação
// para o lote poder ser montado inteiro antes de qualquer escrita.
export type LinhaDeAchado = {
  chave: string;
  agente: string;
  tipo: string;
  conexaoId: string | null;
  conexaoApelido: string | null;
  regra: string;
  severidade: AchadoRevisado["severidade"];
  categoria: AchadoRevisado["categoria"];
  titulo: string;
  descricao: string;
  recomendacao: string | null;
  valorCents: number | null;
  impactoCents: number | null;
  dataReferencia: Date | null;
  entidadeTipo: string | null;
  entidadeId: string | null;
  entidadeRef: string | null;
  evidencia: Prisma.InputJsonValue | null;
  confianca: number;
  notaSupervisor: string | null;
  chaveRelacionada: string | null;
};

// TETO DO INTEIRO DE 32 BITS: R$ 21.474.836,47. `valorCents` e `impactoCents`
// são INT4 no banco, e um achado agregado (o custo total de uma categoria no
// ano, a soma de uma regra sobre o conjunto) pode passar disso. Sem o teto, a
// gravação inteira quebrava — "Unable to fit integer value into INT4" — no
// meio da rodada, com parte dos achados gravada e o fechamento sem rodar.
// Gravar o teto e dizer na nota é o oposto: o número aparece truncado, com
// aviso, e a rodada termina.
const TETO_INT4 = 2_147_483_647;

function comTeto(valor: number | null): number | null {
  if (valor === null || valor === undefined) return null;
  return Math.max(-TETO_INT4, Math.min(TETO_INT4, Math.round(valor)));
}

export function linhaDeAchado(
  ctx: ContextoAuditoria,
  achado: AchadoRevisado,
  agente: string,
  conexao: { id: string; apelido: string } | null
): LinhaDeAchado {
  const estourou = (achado.valorCents ?? 0) > TETO_INT4 || (achado.impactoCents ?? 0) > TETO_INT4;
  const nota = estourou
    ? [achado.notaSupervisor, "Valor acima do teto de armazenamento (R$ 21,4 milhões): gravado no teto — o valor real está no texto."]
        .filter(Boolean)
        .join(" ")
    : achado.notaSupervisor;
  void ctx;
  return {
    chave: achado.chave,
    agente,
    tipo: achado.tipo,
    conexaoId: conexao?.id ?? null,
    conexaoApelido: conexao?.apelido ?? null,
    regra: achado.regra,
    severidade: achado.severidade,
    categoria: achado.categoria,
    titulo: achado.titulo,
    descricao: achado.descricao,
    recomendacao: achado.recomendacao ?? null,
    valorCents: comTeto(achado.valorCents ?? null),
    impactoCents: comTeto(achado.impactoCents ?? null),
    dataReferencia: achado.dataReferencia ?? null,
    entidadeTipo: achado.entidadeTipo ?? null,
    entidadeId: achado.entidadeId ?? null,
    entidadeRef: achado.entidadeRef ?? null,
    evidencia: (achado.evidencia ?? null) as Prisma.InputJsonValue | null,
    confianca: achado.confianca,
    notaSupervisor: nota,
    chaveRelacionada: achado.chaveRelacionada,
  };
}

// GRAVAÇÃO EM LOTE — um comando por até 500 achados, não um upsert por achado.
//
// O laço de upserts era um comando e uma ida ao banco POR ACHADO: com quatro
// mil achados e ~13 ms de ida e volta até o Neon, só a gravação passava dos
// 42 s do orçamento do cron — o ciclo estourava na fase de auditoria. Medido
// em banco local: 4.000 upserts sequenciais em 8,7 s; o mesmo lote com
// `INSERT … SELECT FROM unnest(...) ON CONFLICT DO UPDATE` em 0,25 s.
//
// O que NÃO muda, e é o contrato desta função: campos calculados são sempre
// atualizados (o valor de um título vencido muda conforme é pago); status,
// tratativa, responsável, prazo e detectadoEm nunca são tocados — são da
// pessoa que tratou. `ocorrencias` soma 1 e `ultimaOcorrencia` avança.
//
// `id` e `atualizadoEm` são gerados aqui: `cuid()` e `@updatedAt` são do
// cliente Prisma, não do banco, e um INSERT cru não os recebe.
const TAMANHO_DO_LOTE = 500;

export async function persistirAchados(companyId: string, linhas: LinhaDeAchado[]): Promise<void> {
  for (let i = 0; i < linhas.length; i += TAMANHO_DO_LOTE) {
    const lote = linhas.slice(i, i + TAMANHO_DO_LOTE);
    // O lote viaja como UM parâmetro JSON e vira linhas com jsonb_to_recordset:
    // arrays de parâmetro com nulos dentro quebram na serialização binária do
    // driver ("improper binary format in array element"), e JSON não tem esse
    // problema — nulo é nulo, data é texto ISO, evidência já é JSON.
    const lote_json = JSON.stringify(
      lote.map((l) => ({
        id: `af_${randomUUID().replace(/-/g, "")}`,
        chave: l.chave,
        agente: l.agente,
        tipo: l.tipo,
        conexaoId: l.conexaoId,
        conexaoApelido: l.conexaoApelido,
        regra: l.regra,
        severidade: l.severidade,
        categoria: l.categoria,
        titulo: l.titulo,
        descricao: l.descricao,
        recomendacao: l.recomendacao,
        valorCents: l.valorCents,
        impactoCents: l.impactoCents,
        dataReferencia: l.dataReferencia ? l.dataReferencia.toISOString() : null,
        entidadeTipo: l.entidadeTipo,
        entidadeId: l.entidadeId,
        entidadeRef: l.entidadeRef,
        evidencia: l.evidencia,
        confianca: l.confianca,
        notaSupervisor: l.notaSupervisor,
        chaveRelacionada: l.chaveRelacionada,
      }))
    );
    await prisma.$executeRaw`
      INSERT INTO "AuditFinding" (
        id, "companyId", chave, agente, tipo, "conexaoId", "conexaoApelido", regra, severidade, categoria,
        titulo, descricao, recomendacao, "valorCents", "impactoCents", "dataReferencia",
        "entidadeTipo", "entidadeId", "entidadeRef", evidencia, confianca, "notaSupervisor", "chaveRelacionada",
        "atualizadoEm"
      )
      SELECT
        u.id, ${companyId}, u.chave, u.agente, u.tipo, u."conexaoId", u."conexaoApelido", u.regra,
        u.severidade::"AuditSeveridade", u.categoria::"AuditCategoria",
        u.titulo, u.descricao, u.recomendacao, u."valorCents", u."impactoCents", u."dataReferencia",
        u."entidadeTipo", u."entidadeId", u."entidadeRef", u.evidencia, u.confianca, u."notaSupervisor", u."chaveRelacionada",
        now()
      FROM jsonb_to_recordset(${lote_json}::jsonb) AS u(
        id text, chave text, agente text, tipo text, "conexaoId" text, "conexaoApelido" text, regra text,
        severidade text, categoria text, titulo text, descricao text, recomendacao text,
        "valorCents" int, "impactoCents" int, "dataReferencia" timestamptz,
        "entidadeTipo" text, "entidadeId" text, "entidadeRef" text, evidencia jsonb, confianca int,
        "notaSupervisor" text, "chaveRelacionada" text
      )
      ON CONFLICT ("companyId", chave) DO UPDATE SET
        agente = EXCLUDED.agente,
        tipo = EXCLUDED.tipo,
        "conexaoId" = EXCLUDED."conexaoId",
        "conexaoApelido" = EXCLUDED."conexaoApelido",
        regra = EXCLUDED.regra,
        severidade = EXCLUDED.severidade,
        categoria = EXCLUDED.categoria,
        titulo = EXCLUDED.titulo,
        descricao = EXCLUDED.descricao,
        recomendacao = EXCLUDED.recomendacao,
        "valorCents" = EXCLUDED."valorCents",
        "impactoCents" = EXCLUDED."impactoCents",
        "dataReferencia" = EXCLUDED."dataReferencia",
        "entidadeTipo" = EXCLUDED."entidadeTipo",
        "entidadeId" = EXCLUDED."entidadeId",
        "entidadeRef" = EXCLUDED."entidadeRef",
        evidencia = EXCLUDED.evidencia,
        confianca = EXCLUDED.confianca,
        "notaSupervisor" = EXCLUDED."notaSupervisor",
        "chaveRelacionada" = EXCLUDED."chaveRelacionada",
        "ultimaOcorrencia" = now(),
        ocorrencias = "AuditFinding".ocorrencias + 1,
        "atualizadoEm" = now()
    `;
  }
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


// A DECISÃO DE FECHAR, separada da execução de propósito.
//
// É uma regra com quatro condições que precisam valer juntas, e cada uma delas
// evita um erro diferente — três dos quais já aconteceram ou quase. Dentro de
// `executarAuditoria` ela só poderia ser exercitada com banco, contexto e doze
// agentes em pé; aqui, com quatro objetos.
// Regras que só emitem dentro de uma janela própria, mais curta que a da
// auditoria: a troca de conta bancária seguida de pagamento só é apontada por
// 45 dias. Passado o prazo, o silêncio da regra não é reavaliação — é o
// relógio dela. Sem esta lista, o indício de fraude mais grave do agente
// sumia sozinho no 46º dia, sem ninguém ter olhado.
const REGRAS_SEM_FECHAMENTO_AUTOMATICO = new Set(["FR-CONTA-ALTERADA", "FR-CONTA-ALTERADA-REPETIDA"]);

export function podeFecharSozinho(
  achado: { status: string; chave: string; tipo: string; agente: string; regra?: string; dataReferencia?: Date | null },
  chavesEmitidas: Set<string>,
  agentesOk: string[],
  // Janela que os agentes acabaram de reavaliar. Sem ela, vale a regra
  // estrita: EVENTO nunca fecha sozinho. `ate` aberto significa "até hoje".
  janela?: { desde: Date; ate?: Date }
): boolean {
  // 1. Tratado por gente não volta a ser mexido por máquina. RESOLVIDO e
  //    IGNORADO carregam justificativa registrada; sobrescrevê-los apagaria o
  //    trabalho de quem tratou.
  if (achado.status !== "ABERTO" && achado.status !== "EM_ANALISE") return false;

  // 2. Se a condição voltou a ser detectada agora, ela não deixou de existir.
  if (chavesEmitidas.has(achado.chave)) return false;
  if (achado.regra && REGRAS_SEM_FECHAMENTO_AUTOMATICO.has(achado.regra)) return false;

  // 3. ESTADO fecha sozinho. EVENTO é fato consumado — um pagamento em
  //    duplicidade não deixa de ter acontecido porque não apareceu hoje — e
  //    só fecha quando uma auditoria COMPLETA acabou de reavaliar o período
  //    em que ele aconteceu (a janela vem informada e a data do fato cai
  //    dentro dela) e o agente dono, sem erro, não o apontou: ou o dado foi
  //    corrigido na Omie (a baixa errada foi refeita) ou a regra foi
  //    recalibrada e deixou de considerar aquilo um problema. O achado antigo
  //    descreve algo que a auditoria, olhando o mesmo dado, não vê mais.
  //
  //    Fato FORA da janela reavaliada fica como está. A versão anterior
  //    fechava também esses ("saiu do alcance, ninguém vai reencontrar") — e
  //    isso deixou de ser verdade no dia em que a auditoria retroativa passou
  //    a existir: um desvio de 2024 achado numa varredura do passado não pode
  //    ser fechado pelo ciclo diário de 2026 só porque o ciclo não olha 2024.
  //    Quem reavalia 2024 é outra varredura de 2024 — e é ela que fecha.
  //
  //    A regra estrita ("EVENTO nunca fecha") custou caro: 766 recebimentos a
  //    menor e 850 duplicidades continuaram abertos DEPOIS de a regra ter
  //    sido corrigida, porque nada os fechava. Sem janela informada (chamada
  //    fora de uma auditoria completa), vale a regra estrita. Achado sem data
  //    do fato conta como dentro da janela: não há como saber que ficou para
  //    trás.
  if (achado.tipo !== "ESTADO") {
    if (!janela) return false;
    const data = achado.dataReferencia ?? null;
    if (data && data < janela.desde) return false;
    if (data && janela.ate && data > janela.ate) return false;
  }

  // 4. O agente dono precisa ter rodado sem erro. Agente que quebrou emite
  //    silêncio, e silêncio não é prova de que o problema acabou. Fechar por
  //    ausência de informação é pior que não fechar: some da lista sem nunca
  //    ter sido resolvido.
  return agentesOk.includes(achado.agente);
}
