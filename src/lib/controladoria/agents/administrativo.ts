import { fmtBRL, fmtData, fmtNumero, fmtPercent } from "../format";
import { diasEntre } from "../periodos";
import type { AchadoNovo, Agente, ContextoAuditoria } from "../types";
import { agrupar, chaveAchado, somar } from "./comum";

// AGENTE ADMINISTRATIVO / AUTOMAÇÃO
// Audita o proprio sistema e o cadastro que o alimenta. Existe porque a
// falha mais perigosa de um sistema de auditoria nao e apontar algo errado —
// e PARAR DE APONTAR sem ninguem notar. Um sync quebrado ha uma semana
// produz um relatorio diario bonito, verde e completamente desatualizado.

// D-1 significa: ao rodar hoje, a base tem que estar fechada ate ontem. Dois
// dias de defasagem ja e falha de compromisso.
const DIAS_TOLERANCIA_SYNC = 2;
// Achado critico parado por mais tempo que isso deixa de ser risco financeiro
// e vira problema de governanca.
const DIAS_TRATATIVA_CRITICA = 7;

export const agenteAdministrativo: Agente = {
  id: "administrativo",
  nome: "Administrativo e integridade do sistema",
  area: "Administrativo",
  descricao:
    "Verifica se o espelho da Omie está mesmo em D-1, se houve erro na última sincronização, se os cadastros têm os dados mínimos para auditoria e se os achados críticos estão sendo tratados dentro do prazo.",
  executar: auditarAdministrativo,
};

function auditarAdministrativo(ctx: ContextoAuditoria): AchadoNovo[] {
  const achados: AchadoNovo[] = [];

  achados.push(...syncDesatualizado(ctx));
  achados.push(...erroNoUltimoSync(ctx));
  achados.push(...cadastroIncompleto(ctx));
  achados.push(...contaSemMovimento(ctx));

  return achados;
}

// AD-SYNC-ATRASADO — o compromisso de D-1 nao esta sendo cumprido.
function syncDesatualizado(ctx: ContextoAuditoria): AchadoNovo[] {
  const ultimo = ctx.ultimoSyncConcluido;

  if (!ultimo) {
    return [
      {
        regra: "AD-SYNC-AUSENTE",
        tipo: "ESTADO",
        severidade: "ALTA",
        categoria: "CONFORMIDADE",
        titulo: "Nenhuma sincronização com a Omie concluída",
        descricao:
          "Não há registro de sincronização diária concluída com sucesso. Todo número deste módulo depende do espelho " +
          "da Omie estar atualizado — sem ele, o que aparece nas telas é histórico, não situação atual.",
        recomendacao:
          "Conferir em Controladoria → Sincronização se OMIE_APP_KEY e OMIE_APP_SECRET estão configuradas e rodar uma " +
          "sincronização manual. Persistindo, verificar se o agendamento diário está ativo no vercel.json.",
        dataReferencia: ctx.dataReferencia,
        evidencia: {},
        chave: chaveAchado("AD-SYNC-AUSENTE", "atual"),
      },
    ];
  }

  const referencia = ultimo.finalizadoEm ?? ultimo.iniciadoEm;
  const atraso = diasEntre(referencia, ctx.agora);
  if (atraso <= DIAS_TOLERANCIA_SYNC) return [];

  return [
    {
      regra: "AD-SYNC-ATRASADO",
      tipo: "ESTADO",
      severidade: atraso > 5 ? "CRITICA" : "ALTA",
      categoria: "CONFORMIDADE",
      titulo: `Base desatualizada há ${fmtNumero(atraso)} dias`,
      descricao:
        `A última sincronização concluída com a Omie foi em ${fmtData(referencia)}. O compromisso do módulo é D-1 — ` +
        `com essa defasagem, os alertas de vencimento, inadimplência e caixa deste relatório estão olhando para um passado.`,
      recomendacao:
        "Rodar a sincronização manual e verificar o log do agendamento. Falha repetida costuma ser credencial expirada " +
        "na Omie ou limite de consumo da API atingido.",
      dataReferencia: ctx.dataReferencia,
      evidencia: { ultimoSync: referencia.toISOString(), atrasoDias: atraso, runId: ultimo.id },
      chave: chaveAchado("AD-SYNC-ATRASADO", "atual"),
    },
  ];
}

// AD-SYNC-ERRO — a execucao terminou, mas com falhas parciais. Importante
// separar de "nao rodou": aqui parte dos dados veio e parte nao, o que e
// justamente o caso em que o relatorio parece completo e nao esta.
function erroNoUltimoSync(ctx: ContextoAuditoria): AchadoNovo[] {
  const ultimo = ctx.ultimoSyncConcluido;
  if (!ultimo?.erro) return [];

  return [
    {
      regra: "AD-SYNC-ERRO",
      tipo: "ESTADO",
      severidade: "MEDIA",
      categoria: "CONFORMIDADE",
      titulo: "Última sincronização concluiu com erros parciais",
      descricao:
        `A sincronização de ${fmtData(ultimo.finalizadoEm ?? ultimo.iniciadoEm)} terminou, mas registrou falhas: ` +
        `${ultimo.erro.slice(0, 300)}. Parte dos dados do período pode estar faltando — e a ausência não aparece ` +
        `como erro nas telas, aparece como número menor.`,
      recomendacao:
        "Abrir Controladoria → Sincronização, ver quais fases falharam e reprocessar o período. " +
        "Erro recorrente na mesma fase indica campo ou endpoint da Omie que mudou e precisa de ajuste no mapeamento.",
      dataReferencia: ctx.dataReferencia,
      evidencia: { erro: ultimo.erro.slice(0, 1000), fase: ultimo.fase, runId: ultimo.id },
      chave: chaveAchado("AD-SYNC-ERRO", ultimo.id),
    },
  ];
}

// AD-CADASTRO — fornecedores/clientes ativos sem os dados minimos para
// qualquer auditoria seria (documento) ou cobranca (e-mail).
function cadastroIncompleto(ctx: ContextoAuditoria): AchadoNovo[] {
  const ativos = ctx.parceiros.filter((p) => !p.inativo);
  if (ativos.length === 0) return [];

  const semDocumento = ativos.filter((p) => !p.documento);
  if (semDocumento.length === 0) return [];

  const percentual = (semDocumento.length / ativos.length) * 100;
  if (percentual < 5) return [];

  return [
    {
      regra: "AD-CADASTRO-SEM-DOCUMENTO",
      tipo: "ESTADO",
      severidade: percentual > 20 ? "MEDIA" : "BAIXA",
      categoria: "ERRO_PROCESSO",
      titulo: `${semDocumento.length} cadastros ativos sem CNPJ/CPF (${fmtPercent(percentual)})`,
      descricao:
        `Cadastro sem documento impede validar quem é a contraparte, cruzar fornecedor com funcionário e emitir informes. ` +
        `É também o que permite o mesmo fornecedor existir duas vezes sem o sistema perceber.`,
      recomendacao:
        "Completar o documento dos cadastros com movimento no período e tornar o campo obrigatório no cadastro da Omie.",
      dataReferencia: ctx.dataReferencia,
      evidencia: { semDocumento: semDocumento.length, ativos: ativos.length, percentual },
      chave: chaveAchado("AD-CADASTRO-SEM-DOCUMENTO", "atual"),
    },
  ];
}

// AD-CONTA-SEM-MOVIMENTO — conta corrente ativa sem nenhum lancamento
// espelhado. Quase sempre significa extrato nao importado, e nao conta
// parada — e extrato faltando invalida silenciosamente toda a conciliacao.
function contaSemMovimento(ctx: ContextoAuditoria): AchadoNovo[] {
  const ativas = ctx.contasCorrentes.filter((c) => !c.inativa);
  if (ativas.length === 0) return [];

  const comMovimento = new Set(ctx.movimentos.map((m) => m.contaCorrenteCodigo));
  const semMovimento = ativas.filter((c) => !comMovimento.has(c.codigo));
  if (semMovimento.length === 0) return [];

  return [
    {
      regra: "AD-CONTA-SEM-MOVIMENTO",
      tipo: "ESTADO",
      severidade: "MEDIA",
      categoria: "CONFORMIDADE",
      titulo: `${semMovimento.length} conta(s) corrente(s) ativa(s) sem extrato importado`,
      descricao:
        `As contas ${semMovimento.map((c) => c.descricao).join(", ")} estão ativas na Omie mas não têm nenhum lançamento ` +
        `no espelho local. Sem o extrato dessas contas, a conciliação bancária e a projeção de caixa ignoram o dinheiro que passa por elas.`,
      recomendacao:
        "Verificar se essas contas realmente não têm movimento ou se o extrato não está sendo devolvido pela API. " +
        "Contas encerradas devem ser inativadas na Omie para sair desta verificação.",
      dataReferencia: ctx.dataReferencia,
      evidencia: { contas: semMovimento.map((c) => ({ codigo: c.codigo, descricao: c.descricao })) },
      chave: chaveAchado("AD-CONTA-SEM-MOVIMENTO", semMovimento.map((c) => c.codigo).sort().join(",")),
    },
  ];
}

// Metricas de governanca dos proprios achados (achados criticos parados,
// tempo medio de tratativa). Fica aqui, e nao dentro de auditarAdministrativo,
// porque depende dos achados JA PERSISTIDOS — o motor chama isso depois de
// gravar, para nao auditar a si mesmo no meio da propria execucao (ver
// engine.ts).
export function achadosSemTratativa(
  achadosAbertos: { severidade: string; detectadoEm: Date; titulo: string }[],
  agora: Date
): AchadoNovo | null {
  const criticosParados = achadosAbertos.filter(
    (a) => (a.severidade === "CRITICA" || a.severidade === "ALTA") && diasEntre(a.detectadoEm, agora) > DIAS_TRATATIVA_CRITICA
  );
  if (criticosParados.length === 0) return null;

  const maisAntigo = criticosParados.reduce((antigo, a) => (a.detectadoEm < antigo.detectadoEm ? a : antigo));

  return {
    regra: "AD-TRATATIVA-PARADA",
    tipo: "ESTADO",
    severidade: "ALTA",
    categoria: "CONFORMIDADE",
    titulo: `${criticosParados.length} achados críticos/altos sem tratativa há mais de ${DIAS_TRATATIVA_CRITICA} dias`,
    descricao:
      `O mais antigo ("${maisAntigo.titulo}") está aberto há ${fmtNumero(diasEntre(maisAntigo.detectadoEm, agora))} dias. ` +
      `Controle interno que aponta e não é tratado tem o efeito oposto ao pretendido: cria o registro de que a empresa ` +
      `sabia do problema e não agiu.`,
    recomendacao:
      "Definir responsável e prazo para cada achado crítico. Achados que não se aplicam à realidade da empresa devem ser " +
      "marcados como ignorados com justificativa — isso é tratativa, e some da lista sem virar dívida.",
    dataReferencia: agora,
    evidencia: { criticosParados: criticosParados.length, maisAntigo: maisAntigo.titulo },
    chave: chaveAchado("AD-TRATATIVA-PARADA", "atual"),
  };
}

// Cobertura dos campos essenciais no espelho, por entidade. Alimenta a tela
// de sincronizacao — e onde um alias de campo que ficou faltando no
// mapeamento da Omie aparece como coluna vazia em vez de sumir em silencio
// (ver src/lib/omie/mapping.ts).
export function coberturaDeCampos(ctx: ContextoAuditoria) {
  const titulos = ctx.titulos;
  const pct = (quantos: number, total: number) => (total > 0 ? (quantos / total) * 100 : 0);

  return [
    {
      entidade: "Títulos",
      total: titulos.length,
      campos: [
        { nome: "categoria", preenchidoPercent: pct(titulos.filter((t) => t.categoriaCodigo).length, titulos.length) },
        { nome: "centro de custo", preenchidoPercent: pct(titulos.filter((t) => t.departamentoCodigo || t.projetoCodigo).length, titulos.length) },
        { nome: "documento", preenchidoPercent: pct(titulos.filter((t) => t.numeroDocumento).length, titulos.length) },
        { nome: "fornecedor/cliente", preenchidoPercent: pct(titulos.filter((t) => t.parceiroCodigo).length, titulos.length) },
        { nome: "data de emissão", preenchidoPercent: pct(titulos.filter((t) => t.dataEmissao).length, titulos.length) },
      ],
    },
    {
      entidade: "Movimentos bancários",
      total: ctx.movimentos.length,
      campos: [
        { nome: "categoria", preenchidoPercent: pct(ctx.movimentos.filter((m) => m.categoriaCodigo).length, ctx.movimentos.length) },
        { nome: "conciliado", preenchidoPercent: pct(ctx.movimentos.filter((m) => m.conciliado).length, ctx.movimentos.length) },
        { nome: "título de origem", preenchidoPercent: pct(ctx.movimentos.filter((m) => m.tituloCodigo).length, ctx.movimentos.length) },
      ],
    },
    {
      entidade: "Parceiros",
      total: ctx.parceiros.length,
      campos: [
        { nome: "documento", preenchidoPercent: pct(ctx.parceiros.filter((p) => p.documento).length, ctx.parceiros.length) },
        { nome: "e-mail", preenchidoPercent: pct(ctx.parceiros.filter((p) => p.email).length, ctx.parceiros.length) },
      ],
    },
    {
      entidade: "Notas fiscais",
      total: ctx.notas.length,
      campos: [
        { nome: "impostos destacados", preenchidoPercent: pct(ctx.notas.filter((n) => n.valorIssCents !== null || n.valorPisCents !== null).length, ctx.notas.length) },
        { nome: "parceiro", preenchidoPercent: pct(ctx.notas.filter((n) => n.parceiroCodigo).length, ctx.notas.length) },
      ],
    },
  ];
}

// Resumo de volume por entidade, usado no painel de sincronizacao.
export function volumeEspelhado(ctx: ContextoAuditoria) {
  const porNatureza = agrupar(ctx.titulos, (t) => t.natureza);
  return {
    titulosPagar: porNatureza.get("PAGAR")?.length ?? 0,
    titulosReceber: porNatureza.get("RECEBER")?.length ?? 0,
    valorPagar: fmtBRL(somar(porNatureza.get("PAGAR") ?? [], (t) => t.valorDocumentoCents)),
    valorReceber: fmtBRL(somar(porNatureza.get("RECEBER") ?? [], (t) => t.valorDocumentoCents)),
    baixas: ctx.baixas.length,
    movimentos: ctx.movimentos.length,
    notas: ctx.notas.length,
    parceiros: ctx.parceiros.length,
  };
}
