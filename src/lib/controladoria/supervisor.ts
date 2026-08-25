import type { AuditSeveridade, AuditStatus } from "@prisma/client";
import { fmtBRL } from "./format";
import { diasEntre } from "./periodos";
import type { AchadoNovo, ContextoAuditoria } from "./types";

// SUPERVISOR DOS AGENTES
//
// Camada de revisao entre os agentes e a publicacao. Nenhum achado chega ao
// painel ou ao e-mail sem passar por aqui.
//
// A razao de existir: um agente deterministico sempre "tem certeza" do que
// calculou — ele viu o numero e aplicou a regra. O que ele NAO consegue saber,
// por construcao, e:
//   1. se o dado que ele leu estava completo (extrato nao importado faz a
//      regra "baixa sem movimento bancario" acusar centenas de falsos
//      positivos, todos tecnicamente corretos e todos errados);
//   2. se OUTRO agente ja apontou o mesmo fato por outro caminho;
//   3. se aquele mesmo achado ja foi julgado inaplicavel por uma pessoa;
//   4. se ele esta gritando "critico" mais alto que os outros 40 achados,
//      o que na pratica significa que nada e critico.
//
// O supervisor nao reescreve o que o agente calculou: ele nunca muda numero.
// Ele suprime, rebaixa, relaciona e atribui CONFIANCA — e registra o porque em
// notaSupervisor, visivel ao lado do achado. Revisao invisivel seria
// indistinguivel de censura, e a primeira pergunta de qualquer auditor
// externo seria justamente essa.

export type AchadoRevisado = AchadoNovo & {
  confianca: number;
  notaSupervisor: string | null;
  chaveRelacionada: string | null;
};

export type AchadoSuprimido = {
  regra: string;
  titulo: string;
  motivo: string;
};

export type ResultadoSupervisao = {
  aprovados: AchadoRevisado[];
  suprimidos: AchadoSuprimido[];
  // Linhas para o log da execucao e para a tela de auditoria: o que o
  // supervisor fez nesta rodada, em portugues.
  observacoes: string[];
  // Avaliacao da base que sustentou (ou limitou) as conclusoes desta rodada.
  qualidadeDaBase: QualidadeDaBase;
};

export type QualidadeDaBase = {
  // 0 a 100.
  score: number;
  temExtrato: boolean;
  temNotas: boolean;
  temTitulos: boolean;
  syncAtrasadoDias: number | null;
  limitacoes: string[];
};

// Abaixo deste piso o achado nao entra no bloco executivo do e-mail (continua
// na tela, com a nota do supervisor explicando o rebaixamento).
export const PISO_CONFIANCA_EXECUTIVO = 60;

// Mais que isso de "critico" numa unica rodada nao e um retrato da empresa,
// e uma falha de calibragem — e o efeito pratico e o leitor parar de olhar.
const MAXIMO_CRITICOS_POR_RODADA = 5;

// Uma unica regra disparando mais que isso quase sempre significa problema
// sistemico de dado, nao N problemas independentes.
const MAXIMO_ACHADOS_POR_REGRA = 25;

// Regras que dependem do extrato bancario estar importado. Sem extrato, cada
// uma delas produz falso positivo em massa.
const REGRAS_DEPENDENTES_DE_EXTRATO = [
  "CB-NAO-CONCILIADO",
  "CB-SAIDA-SEM-TITULO",
  "CB-BAIXA-SEM-MOVIMENTO",
  "CB-DEBITO-DUPLICADO",
  "CB-SEM-CATEGORIA",
  "CB-SALDO-MINIMO",
  "FC-SALDO-NEGATIVO",
];

// Regras que dependem das notas fiscais terem sido sincronizadas.
const REGRAS_DEPENDENTES_DE_NOTAS = [
  "FI-NOTA-CANCELADA",
  "FI-RECEITA-SEM-NOTA",
  "FI-NOTA-SEM-TITULO",
  "FI-PIS-COFINS",
  "FI-ISS",
  "FI-SEQUENCIA",
];

// Pares de regras que descrevem o MESMO fato por caminhos diferentes. A
// primeira e a principal (mais especifica/acionavel); a segunda vira
// relacionada, com severidade rebaixada, para o mesmo problema nao ocupar
// duas linhas na mesa de quem decide.
const REGRAS_EQUIVALENTES: [string, string][] = [
  ["CP-DUPLICIDADE", "CB-DEBITO-DUPLICADO"],
  ["CP-JUROS", "OP-JUROS-ANO"],
  ["CR-INADIMPLENCIA", "CR-PERDA-PROVAVEL"],
  // Apontamento externo com prazo estourado E confirmação nos dados: a cobrança
  // do prazo é o que exige ação hoje; a confirmação é o argumento que sustenta
  // a prioridade. Uma linha, não duas.
  ["CONF-PRAZO", "CONF-CONFIRMADO"],
];

// Regras cujo achado ja e agregado por natureza (falam do conjunto, nao de um
// caso) — nunca devem ser consolidadas nem contadas como "regra ruidosa".
const REGRAS_AGREGADAS = new Set([
  "CP-SEM-CATEGORIA",
  "CP-SEM-CENTRO-CUSTO",
  "CP-SEM-DOCUMENTO",
  "CP-FANTASMA",
  "OP-JUROS-ANO",
  "OP-TARIFAS",
  "OP-ALCADA",
  "FI-RECEITA-SEM-NOTA",
  // Um achado por TIPO de documento, falando do conjunto de titulos daquele
  // tipo — nao um achado por titulo.
  "FI-DOC-SEM-NUMERO",
  // "Por onde o dinheiro saiu": cada uma fala do CONJUNTO de baixas do
  // período, não de um caso — um achado por regra, com a lista na evidência.
  "FR-BAIXA-SEM-CONTA",
  "FR-CANCELADO-COM-BAIXA",
  "FR-BAIXA-ANTECIPADA",
  "FR-BAIXA-DESVIADA",
  "FR-BAIXA-FUTURA",
  "FR-BAIXA-DUPLICADA",
  "FR-DESCONTO-TOTAL",
  "RE-COBERTURA-BAIXA",
  "CONF-NAO-CONFERIDO",
  "CONF-SEM-RELATORIO",
  "CONF-PONTO-CEGO",
]);

// Regras cujo valor NAO foi calculado por este sistema: veio escrito num
// documento externo (ver o Controle 2, mais abaixo).
const REGRAS_COM_VALOR_EXTERNO = (regra: string): boolean => regra.startsWith("CONF-");

const ESCALA: AuditSeveridade[] = ["INFO", "BAIXA", "MEDIA", "ALTA", "CRITICA"];

function rebaixar(s: AuditSeveridade, niveis = 1): AuditSeveridade {
  return ESCALA[Math.max(0, ESCALA.indexOf(s) - niveis)];
}

export function avaliarQualidadeDaBase(ctx: ContextoAuditoria): QualidadeDaBase {
  const limitacoes: string[] = [];
  const temTitulos = ctx.titulos.length > 0;
  const temExtrato = ctx.movimentos.length > 0;
  const temNotas = ctx.notas.length > 0;

  const referencia = ctx.ultimoSyncConcluido?.finalizadoEm ?? ctx.ultimoSyncConcluido?.iniciadoEm ?? null;
  const syncAtrasadoDias = referencia ? diasEntre(referencia, ctx.agora) : null;

  let score = 100;
  if (!temTitulos) {
    score -= 60;
    limitacoes.push("Nenhum título espelhado da Omie — o módulo ainda não tem base para auditar.");
  }
  if (!temExtrato) {
    score -= 20;
    // O SALDO NÃO ENTRA MAIS NESTA LISTA. Ele passou a ser calculado pela soma
    // das baixas quando não há extrato (ver saldos.ts) — anunciá-lo como
    // suspenso mandaria desconfiar de um número que agora está certo.
    // Conciliação e projeção continuam dependendo do extrato: conciliar é,
    // por definição, confrontar o banco com o título, e não há o lado do banco.
    limitacoes.push(
      "Extrato bancário não importado: a conciliação e a projeção de caixa ficam suspensas nesta rodada. O saldo é " +
        "calculado pela soma das baixas de título — é o dinheiro que entrou e saiu por título, não a posição do banco."
    );
  }
  if (!temNotas) {
    score -= 10;
    // "Nesta leitura", e não "não sincronizadas".
    //
    // Esta função só enxerga o contexto JÁ RECORTADO por empresa e por
    // competência. Anunciar ausência de sincronização a partir disso foi o que
    // aconteceu com 4.665 notas gravadas no banco: o aviso mandou procurar
    // defeito na integração da Omie, que estava funcionando, quando o fato era
    // apenas que aquele recorte não continha nota nenhuma.
    //
    // Um sistema de auditoria não pode errar a natureza do que aponta. A
    // diferença entre "o dado não existe" e "o dado não está neste recorte" é
    // a diferença entre um problema e um filtro.
    limitacoes.push(
      "Nenhuma nota fiscal nesta leitura — confira a empresa e a competência selecionadas. As análises fiscais ficam suspensas."
    );
  }
  if (syncAtrasadoDias === null) {
    score -= 10;
    limitacoes.push("Sem registro de sincronização concluída — os dados podem não refletir D-1.");
  } else if (syncAtrasadoDias > 2) {
    score -= Math.min(30, syncAtrasadoDias * 5);
    limitacoes.push(`Última sincronização há ${syncAtrasadoDias} dias — a base não está em D-1.`);
  }

  return { score: Math.max(0, score), temExtrato, temNotas, temTitulos, syncAtrasadoDias, limitacoes };
}

export type HistoricoAchado = { status: AuditStatus; severidade: AuditSeveridade; ocorrencias: number };

export function supervisionar(
  ctx: ContextoAuditoria,
  achados: AchadoNovo[],
  historico: Map<string, HistoricoAchado>
): ResultadoSupervisao {
  const observacoes: string[] = [];
  const suprimidos: AchadoSuprimido[] = [];
  const qualidadeDaBase = avaliarQualidadeDaBase(ctx);

  let candidatos: AchadoRevisado[] = achados.map((a) => ({
    ...a,
    confianca: 100,
    notaSupervisor: null,
    chaveRelacionada: null,
  }));

  // ---- Controle 1: dado de base ausente ----
  // Suprimir e mais honesto que rebaixar: sem extrato, "baixa sem movimento"
  // nao e um achado fraco, e um achado sem sentido.
  const suprimirPorBase = (regras: string[], motivo: string) => {
    const antes = candidatos.length;
    candidatos = candidatos.filter((a) => {
      if (!regras.includes(a.regra)) return true;
      suprimidos.push({ regra: a.regra, titulo: a.titulo, motivo });
      return false;
    });
    if (candidatos.length < antes) observacoes.push(`${antes - candidatos.length} achado(s) suprimido(s): ${motivo}`);
  };

  if (!qualidadeDaBase.temExtrato) {
    suprimirPorBase(REGRAS_DEPENDENTES_DE_EXTRATO, "extrato bancário não importado nesta base");
  }
  if (!qualidadeDaBase.temNotas) {
    suprimirPorBase(REGRAS_DEPENDENTES_DE_NOTAS, "notas fiscais não sincronizadas nesta base");
  }

  // ---- Controle 2: coerência aritmética ----
  // O supervisor NAO corrige o numero do agente — ele o desqualifica. Numero
  // incoerente e sintoma de bug ou de dado corrompido, e publicar um numero
  // "consertado" esconderia justamente o que precisa ser investigado.
  const tetoPlausivel = Math.max(
    1,
    ctx.titulos.reduce((acc, t) => acc + t.valorDocumentoCents, 0)
  );
  candidatos = candidatos.filter((a) => {
    const valores = [a.valorCents, a.impactoCents].filter((v): v is number => v !== undefined);
    const negativo = valores.some((v) => v < 0);
    // O teto só vale para número CALCULADO sobre o espelho da Omie. Valor de
    // apontamento externo foi lido de um relatório de consultoria e pode
    // legitimamente superar o total de títulos espelhados — uma contingência
    // trabalhista estimada em R$ 800 mil é maior que o movimento de um mês, e
    // suprimi-la seria apagar justamente o risco mais grave da lista. Valor
    // negativo continua sendo erro em qualquer origem.
    const absurdo = !REGRAS_COM_VALOR_EXTERNO(a.regra) && valores.some((v) => v > tetoPlausivel);
    if (!negativo && !absurdo) return true;
    suprimidos.push({
      regra: a.regra,
      titulo: a.titulo,
      motivo: negativo
        ? "valor negativo — indica erro de cálculo no agente"
        : `valor acima do total de títulos da base (${fmtBRL(tetoPlausivel)}) — indica erro de cálculo no agente`,
    });
    return false;
  });

  // ---- Controle 3: tratativa humana anterior ----
  // Achado marcado como IGNORADO por uma pessoa nao volta gritando. Volta
  // rebaixado e com nota — respeita o julgamento de quem conhece o negocio,
  // sem apagar o fato de que a condicao persiste.
  for (const a of candidatos) {
    const anterior = historico.get(a.chave);
    if (!anterior) continue;

    if (anterior.status === "IGNORADO") {
      a.severidade = "INFO";
      a.confianca = Math.min(a.confianca, 40);
      a.notaSupervisor =
        "Já marcado como ignorado por um usuário anteriormente. Mantido apenas como registro, sem alerta.";
      continue;
    }
    if (anterior.status === "RESOLVIDO" && a.tipo === "ESTADO") {
      // Marcado como resolvido, mas a condicao voltou a aparecer: isso e
      // informacao nova e relevante — a tratativa nao pegou.
      a.notaSupervisor = "Achado havia sido marcado como resolvido, mas a condição voltou a ser detectada.";
      continue;
    }
    if (anterior.ocorrencias >= 10 && a.severidade !== "CRITICA") {
      a.notaSupervisor = `Recorrente: detectado em ${anterior.ocorrencias} execuções. Sugere causa estrutural, não caso isolado.`;
    }
  }

  // ---- Controle 4: consolidação entre agentes ----
  // Dois agentes chegando ao mesmo fato e sinal de robustez, nao motivo para
  // duas linhas na mesa de quem decide.
  const porEntidade = new Map<string, AchadoRevisado[]>();
  for (const a of candidatos) {
    if (!a.entidadeId) continue;
    const k = a.entidadeId;
    porEntidade.set(k, [...(porEntidade.get(k) ?? []), a]);
  }
  for (const [, grupo] of porEntidade) {
    if (grupo.length < 2) continue;
    for (const [principal, secundaria] of REGRAS_EQUIVALENTES) {
      const p = grupo.find((a) => a.regra === principal);
      const s = grupo.find((a) => a.regra === secundaria);
      if (!p || !s || REGRAS_AGREGADAS.has(s.regra)) continue;
      s.chaveRelacionada = p.chave;
      s.severidade = rebaixar(s.severidade);
      s.notaSupervisor = `Mesmo fato já apontado por "${p.titulo}" (regra ${principal}). Mantido como corroboração.`;
      observacoes.push(`Consolidado: ${secundaria} corrobora ${principal} na mesma entidade.`);
    }
  }

  // Contradição direta: o mesmo título não pode estar "vencido em aberto" e
  // "pago com juros" ao mesmo tempo. Quando acontece, o dado mudou no meio da
  // janela — o fato consumado (pagamento) prevalece sobre o estado.
  for (const [, grupo] of porEntidade) {
    const vencido = grupo.find((a) => a.regra === "CP-VENCIDO");
    const pago = grupo.find((a) => a.regra === "CP-JUROS");
    if (vencido && pago) {
      candidatos = candidatos.filter((a) => a !== vencido);
      suprimidos.push({
        regra: vencido.regra,
        titulo: vencido.titulo,
        motivo: "contradiz o registro de pagamento do mesmo título (prevalece o fato consumado)",
      });
    }
  }

  // ---- Controle 5: regra ruidosa ----
  const porRegra = new Map<string, AchadoRevisado[]>();
  for (const a of candidatos) porRegra.set(a.regra, [...(porRegra.get(a.regra) ?? []), a]);

  for (const [regra, grupo] of porRegra) {
    if (REGRAS_AGREGADAS.has(regra) || grupo.length <= MAXIMO_ACHADOS_POR_REGRA) continue;
    // Mantem os de maior valor (onde esta o dinheiro) e rebaixa o resto, em
    // vez de descartar: o dado continua na tela, so nao ocupa o alerta.
    const ordenados = [...grupo].sort((a, b) => (b.valorCents ?? 0) - (a.valorCents ?? 0));
    for (const a of ordenados.slice(MAXIMO_ACHADOS_POR_REGRA)) {
      a.severidade = rebaixar(a.severidade, 2);
      a.confianca = Math.min(a.confianca, 70);
      a.notaSupervisor =
        `A regra ${regra} disparou ${grupo.length} vezes nesta execução. Volume desse tamanho costuma indicar uma causa ` +
        `única (processo ou dado), não casos independentes — priorizados os de maior valor.`;
    }
    observacoes.push(
      `Regra ${regra} disparou ${grupo.length} vezes: ${grupo.length - MAXIMO_ACHADOS_POR_REGRA} achado(s) rebaixado(s) por volume.`
    );
  }

  // ---- Controle 6: evidência mínima ----
  for (const a of candidatos) {
    const temEvidencia = a.evidencia && Object.keys(a.evidencia).length > 0;
    const temEntidade = Boolean(a.entidadeId || a.entidadeRef);
    if (!temEvidencia && !temEntidade) {
      a.confianca = Math.min(a.confianca, 50);
      a.notaSupervisor = [a.notaSupervisor, "Sem evidência anexada nem entidade vinculada — verificar manualmente."]
        .filter(Boolean)
        .join(" ");
    }
  }

  // ---- Controle 7: qualidade da base afeta toda a rodada ----
  if (qualidadeDaBase.score < 100) {
    const fator = qualidadeDaBase.score / 100;
    for (const a of candidatos) {
      a.confianca = Math.round(a.confianca * fator);
    }
    observacoes.push(
      `Confiança da rodada ajustada para ${qualidadeDaBase.score}% da nominal: ${qualidadeDaBase.limitacoes.join(" ")}`
    );
  }

  // ---- Controle 8: calibragem de severidade ----
  const criticos = candidatos
    .filter((a) => a.severidade === "CRITICA")
    .sort((a, b) => (b.impactoCents ?? b.valorCents ?? 0) - (a.impactoCents ?? a.valorCents ?? 0));

  if (criticos.length > MAXIMO_CRITICOS_POR_RODADA) {
    for (const a of criticos.slice(MAXIMO_CRITICOS_POR_RODADA)) {
      a.severidade = "ALTA";
      a.notaSupervisor = [
        a.notaSupervisor,
        `Rebaixado de crítico: ${criticos.length} achados críticos na mesma execução. Priorizados os ${MAXIMO_CRITICOS_POR_RODADA} de maior impacto financeiro.`,
      ]
        .filter(Boolean)
        .join(" ");
    }
    observacoes.push(
      `${criticos.length} achados críticos detectados; ${criticos.length - MAXIMO_CRITICOS_POR_RODADA} rebaixados para alta por calibragem.`
    );
  }

  // Ordenacao final: severidade, depois impacto financeiro. E a ordem em que
  // o relatorio e a tela apresentam — e a ordem em que vale agir.
  candidatos.sort((a, b) => {
    const dif = ESCALA.indexOf(b.severidade) - ESCALA.indexOf(a.severidade);
    if (dif !== 0) return dif;
    return (b.impactoCents ?? b.valorCents ?? 0) - (a.impactoCents ?? a.valorCents ?? 0);
  });

  if (suprimidos.length > 0) {
    observacoes.push(`${suprimidos.length} achado(s) suprimido(s) no total pela revisão do supervisor.`);
  }

  return { aprovados: candidatos, suprimidos, observacoes, qualidadeDaBase };
}
