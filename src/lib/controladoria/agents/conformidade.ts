import {
  estaEmAberto,
  estaVencido,
  montarPanoramaConformidade,
  OCORRENCIAS_PARA_REINCIDENCIA,
  type ApontamentoConformidade,
} from "@/lib/conformidade/panorama";
import { ROTULO_AREA, rotuloCompetencia } from "@/lib/conformidade/tipos";
import { fmtBRL, fmtData, fmtNumero } from "../format";
import { diasEntre } from "../periodos";
import type { AchadoNovo, Agente, ContextoAuditoria } from "../types";
import { chaveAchado } from "./comum";

// AGENTE DE CONFORMIDADE
//
// Os outros dez agentes leem os DADOS da empresa. Este lê o que a empresa
// recebe sobre si mesma: o relatório mensal da consultoria, o apontamento da
// contabilidade, o auto de fiscalização. Ele não julga o mérito do que está
// escrito lá — quem sabe se o crédito de PIS/COFINS cabe é a consultoria.
//
// O que ele audita é o CICLO DE VIDA do apontamento, que é onde a empresa
// costuma perder dinheiro de verdade:
//
//   - prazo combinado que estourou;
//   - risco grave parado sem responsável;
//   - o MESMO ponto voltando mês após mês (o processo nunca foi corrigido);
//   - apontamento que os próprios dados confirmam (deixa de ser opinião);
//   - proposta de leitura automática que ninguém conferiu;
//   - o relatório do mês que não chegou.
//
// Um relatório de risco que fica no anexo do e-mail não é controle: é prova
// documentada de que a empresa sabia. Este agente existe para que a distância
// entre "fomos avisados" e "tratamos" seja um número visível todo dia.

// Risco grave que fica parado mais que isso deixa de ser pendência e vira
// decisão por omissão.
const DIAS_PARADO_GRAVE = 30;

export const agenteConformidade: Agente = {
  id: "conformidade",
  nome: "Conformidade e riscos externos",
  area: "Controladoria",
  descricao:
    "Acompanha os apontamentos recebidos de consultoria, contabilidade e auditoria externa: prazo estourado, risco grave sem tratativa, ponto que se repete há meses, apontamento confirmado pelos próprios dados e relatório mensal que não chegou.",
  executar: auditarConformidade,
};

function auditarConformidade(ctx: ContextoAuditoria): AchadoNovo[] {
  const apontamentos = ctx.conformidade.apontamentos;
  // Sem nada recebido, o agente fica em silêncio. Não emite "cadastre o
  // primeiro documento": o sistema tem uma tela para isso, e transformar
  // ausência de uso numa pendência de auditoria é como uma lista de achados
  // começa a ser ignorada.
  if (apontamentos.length === 0 && ctx.conformidade.documentos.length === 0) return [];

  return [
    ...prazoEstourado(ctx),
    ...graveParado(ctx),
    ...reincidentes(ctx),
    ...confirmadosPelosDados(ctx),
    ...propostasNaoConferidas(ctx),
    ...relatorioNaoRecebido(ctx),
    ...pontosCegos(ctx),
  ];
}

function rotuloApontamento(a: ApontamentoConformidade): string {
  return `${ROTULO_AREA[a.area] ?? a.area} · ${rotuloCompetencia(a.competencia)}`;
}

// CONF-PRAZO — o prazo que a própria empresa definiu para tratar o apontamento
// passou. Um por apontamento: cada um tem responsável e conversa própria.
function prazoEstourado(ctx: ContextoAuditoria): AchadoNovo[] {
  return ctx.conformidade.apontamentos
    .filter((a) => estaVencido(a, ctx.dataReferencia))
    .map((a) => {
      const atraso = diasEntre(a.prazo!, ctx.dataReferencia);
      return {
        regra: "CONF-PRAZO",
        tipo: "ESTADO" as const,
        // Sobe um nível em relação à gravidade do apontamento: o risco original
        // continua o mesmo, mas agora somou-se a ele a falha de tratativa.
        severidade: a.severidade === "CRITICA" || a.severidade === "ALTA" ? ("CRITICA" as const) : ("ALTA" as const),
        categoria: "CONFORMIDADE" as const,
        titulo: `Prazo vencido há ${fmtNumero(atraso)} dia(s): ${a.titulo}`,
        descricao:
          `Apontamento de ${rotuloApontamento(a)} com prazo para ${fmtData(a.prazo)}${a.responsavel ? `, sob responsabilidade de ${a.responsavel}` : " e sem responsável definido"}. ` +
          `Continua ${a.status === "EM_TRATATIVA" ? "em tratativa" : "aberto"}${a.valorEnvolvidoCents ? `, com ${fmtBRL(a.valorEnvolvidoCents)} envolvidos` : ""}.`,
        recomendacao:
          "Repactuar o prazo com data e responsável ou registrar a conclusão na tela de Conformidade. Prazo que vence e ninguém repactua deixa de ser prazo.",
        valorCents: a.valorEnvolvidoCents ?? undefined,
        dataReferencia: ctx.dataReferencia,
        entidadeTipo: "ConformidadeApontamento",
        entidadeId: a.id,
        entidadeRef: rotuloApontamento(a),
        evidencia: { area: a.area, prazo: a.prazo?.toISOString(), atrasoDias: atraso, responsavel: a.responsavel },
        chave: chaveAchado("CONF-PRAZO", a.id),
      };
    });
}

// CONF-PARADO — risco grave sem prazo e sem movimento. Diferente do anterior:
// aqui ninguém sequer combinou uma data, que costuma ser o estágio anterior ao
// esquecimento.
function graveParado(ctx: ContextoAuditoria): AchadoNovo[] {
  return ctx.conformidade.apontamentos
    .filter(
      (a) =>
        estaEmAberto(a) &&
        (a.severidade === "CRITICA" || a.severidade === "ALTA") &&
        a.prazo === null &&
        diasEntre(a.criadoEm, ctx.dataReferencia) > DIAS_PARADO_GRAVE &&
        // Assunto já reincidente não vira também "parado": CONF-REINCIDENTE diz
        // a mesma coisa com mais força e melhor recomendação (tratar a causa).
        // Sem este corte, um único problema de três meses ocuparia quatro
        // linhas na mesa de quem decide — e é assim que a lista deixa de ser lida.
        a.ocorrencias < OCORRENCIAS_PARA_REINCIDENCIA
    )
    .map((a) => ({
      regra: "CONF-PARADO",
      tipo: "ESTADO" as const,
      severidade: "ALTA" as const,
      categoria: "CONFORMIDADE" as const,
      titulo: `Risco grave sem prazo há ${fmtNumero(diasEntre(a.criadoEm, ctx.dataReferencia))} dias: ${a.titulo}`,
      descricao:
        `Apontamento de ${rotuloApontamento(a)} classificado como ${a.severidade.toLowerCase()} está aberto desde ` +
        `${fmtData(a.criadoEm)} sem responsável nem prazo. Enquanto isso, a empresa tem registrado por escrito que foi avisada.`,
      recomendacao:
        a.recomendacao ??
        "Atribuir responsável e prazo. Se a conclusão for conviver com o risco, registrar como 'aceito com risco' — que é decisão, e não esquecimento.",
      valorCents: a.valorEnvolvidoCents ?? undefined,
      dataReferencia: ctx.dataReferencia,
      entidadeTipo: "ConformidadeApontamento",
      entidadeId: a.id,
      entidadeRef: rotuloApontamento(a),
      evidencia: { area: a.area, severidade: a.severidade, aberto_desde: a.criadoEm.toISOString() },
      chave: chaveAchado("CONF-PARADO", a.id),
    }));
}

// CONF-REINCIDENTE — o mesmo assunto em três ou mais competências. É o achado
// mais valioso do módulo: nenhum relatório mensal lido isoladamente mostra
// isso, e é exatamente o que separa "incidente" de "processo quebrado".
function reincidentes(ctx: ContextoAuditoria): AchadoNovo[] {
  const abertos = ctx.conformidade.apontamentos.filter(estaEmAberto);
  const porChave = new Map<string, ApontamentoConformidade[]>();
  for (const a of ctx.conformidade.apontamentos) {
    porChave.set(a.chaveRecorrencia, [...(porChave.get(a.chaveRecorrencia) ?? []), a]);
  }

  const achados: AchadoNovo[] = [];
  const jaEmitidas = new Set<string>();

  for (const a of abertos) {
    if (jaEmitidas.has(a.chaveRecorrencia)) continue;
    const serie = porChave.get(a.chaveRecorrencia) ?? [];
    const competencias = [...new Set(serie.map((x) => x.competencia.getTime()))].sort();
    if (competencias.length < OCORRENCIAS_PARA_REINCIDENCIA) continue;

    jaEmitidas.add(a.chaveRecorrencia);
    const primeira = new Date(competencias[0]);
    const meses = competencias.map((t) => rotuloCompetencia(new Date(t)));

    achados.push({
      regra: "CONF-REINCIDENTE",
      tipo: "ESTADO",
      severidade: competencias.length >= 5 ? "CRITICA" : "ALTA",
      categoria: "ERRO_PROCESSO",
      titulo: `Apontado em ${competencias.length} competências seguidas: ${a.titulo}`,
      descricao:
        `O mesmo assunto aparece nos relatórios de ${meses.join(", ")}, desde ${rotuloCompetencia(primeira)}. ` +
        `Repetição nessa escala não é um problema que voltou: é um processo que nunca foi corrigido — e cada mês novo ` +
        `aumenta o tempo de exposição, não a chance de resolver sozinho.`,
      recomendacao:
        "Tratar a CAUSA, não a ocorrência do mês: quem executa a rotina, o que falta (sistema, alçada, treinamento, prazo) " +
        "e qual controle passa a impedir a recorrência. Enquanto a causa não muda, o apontamento volta no mês que vem.",
      valorCents: serie.reduce((acc, x) => acc + (x.valorEnvolvidoCents ?? 0), 0) || undefined,
      dataReferencia: ctx.dataReferencia,
      entidadeTipo: "ConformidadeApontamento",
      entidadeId: a.id,
      entidadeRef: rotuloApontamento(a),
      evidencia: { chaveRecorrencia: a.chaveRecorrencia, competencias: meses, ocorrencias: competencias.length },
      chave: chaveAchado("CONF-REINCIDENTE", a.chaveRecorrencia),
    });
  }

  return achados;
}

// CONF-CONFIRMADO — a consultoria apontou e um achado interno, gerado por outro
// caminho, diz a mesma coisa. Só vale com vínculo CONFIRMADO por uma pessoa: a
// sugestão automática é semelhança de texto, e semelhança de texto não é prova.
function confirmadosPelosDados(ctx: ContextoAuditoria): AchadoNovo[] {
  const confirmados = new Map<string, string[]>();
  for (const v of ctx.conformidade.vinculos) {
    if (v.automatico) continue;
    confirmados.set(v.apontamentoId, [...(confirmados.get(v.apontamentoId) ?? []), v.achadoChave]);
  }
  if (confirmados.size === 0) return [];

  return ctx.conformidade.apontamentos
    .filter((a) => estaEmAberto(a) && confirmados.has(a.id))
    .map((a) => {
      const chaves = confirmados.get(a.id)!;
      return {
        regra: "CONF-CONFIRMADO",
        tipo: "ESTADO" as const,
        severidade: a.severidade === "CRITICA" ? ("CRITICA" as const) : ("ALTA" as const),
        categoria: "RISCO_FINANCEIRO" as const,
        titulo: `Confirmado pelos dados: ${a.titulo}`,
        descricao:
          `Este apontamento de ${rotuloApontamento(a)} tem ${chaves.length} achado(s) desta auditoria apontando o mesmo fato ` +
          `por outro caminho (${chaves.slice(0, 3).join(", ")}). Duas fontes independentes — uma revisão externa e os ` +
          `próprios lançamentos — chegaram à mesma conclusão.`,
        recomendacao:
          a.recomendacao ??
          "Priorizar a tratativa: risco com confirmação nos dados não depende de nova apuração para ser decidido.",
        valorCents: a.valorEnvolvidoCents ?? undefined,
        dataReferencia: ctx.dataReferencia,
        entidadeTipo: "ConformidadeApontamento",
        entidadeId: a.id,
        entidadeRef: rotuloApontamento(a),
        evidencia: { achados: chaves, area: a.area },
        chave: chaveAchado("CONF-CONFIRMADO", a.id),
      };
    });
}

// CONF-NAO-CONFERIDO — agregado: propostas da leitura automática que ninguém
// validou. Enquanto não forem conferidas, elas não são apontamentos da empresa:
// são transcrição de máquina esperando revisão.
function propostasNaoConferidas(ctx: ContextoAuditoria): AchadoNovo[] {
  const pendentes = ctx.conformidade.apontamentos.filter((a) => estaEmAberto(a) && a.propostoPorIa && !a.validado);
  if (pendentes.length === 0) return [];

  const maisAntigo = pendentes.reduce((antigo, a) => (a.criadoEm < antigo.criadoEm ? a : antigo));
  const dias = diasEntre(maisAntigo.criadoEm, ctx.dataReferencia);
  if (dias < 3) return [];

  return [
    {
      regra: "CONF-NAO-CONFERIDO",
      tipo: "ESTADO",
      severidade: pendentes.some((a) => a.severidade === "CRITICA" || a.severidade === "ALTA") ? "MEDIA" : "BAIXA",
      categoria: "ERRO_PROCESSO",
      titulo: `${pendentes.length} apontamento(s) lidos automaticamente aguardam conferência`,
      descricao:
        `A leitura automática extraiu ${pendentes.length} apontamento(s) dos documentos recebidos e nenhuma pessoa os ` +
        `conferiu ainda — o mais antigo está esperando há ${fmtNumero(dias)} dias. Enquanto não são validados, eles não ` +
        `entram no bloco executivo do relatório nem contam como risco assumido pela empresa.`,
      recomendacao:
        "Abrir Conformidade e conferir cada proposta contra o trecho citado do documento original: confirmar, corrigir o texto ou descartar.",
      dataReferencia: ctx.dataReferencia,
      evidencia: { pendentes: pendentes.length, maisAntigoDias: dias },
      chave: chaveAchado("CONF-NAO-CONFERIDO", "atual"),
    },
  ];
}

// CONF-SEM-RELATORIO — a cadência mensal foi interrompida. Só dispara quando já
// existe cadência: numa empresa que nunca recebeu nada, cobrar um relatório
// inexistente seria ruído puro.
function relatorioNaoRecebido(ctx: ContextoAuditoria): AchadoNovo[] {
  const panorama = montarPanoramaConformidade(ctx.conformidade, ctx.dataReferencia);
  const esperada = panorama.competenciaEsperada;
  if (!esperada || panorama.documentoEsperadoRecebido) return [];
  if (ctx.conformidade.documentos.length < 2) return [];

  return [
    {
      regra: "CONF-SEM-RELATORIO",
      tipo: "ESTADO",
      severidade: "MEDIA",
      categoria: "CONFORMIDADE",
      titulo: `Relatório de ${rotuloCompetencia(esperada)} ainda não recebido`,
      descricao:
        `A empresa vinha recebendo análise de risco todo mês e a competência de ${rotuloCompetencia(esperada)} não entrou ` +
        `no sistema. O último documento é de ${panorama.ultimaCompetencia ? rotuloCompetencia(panorama.ultimaCompetencia) : "competência desconhecida"}. ` +
        `Mês sem revisão externa é mês sem a segunda opinião que o resto deste sistema não consegue dar.`,
      recomendacao:
        "Cobrar o relatório do mês junto ao emissor e, ao recebê-lo, subir o arquivo em Conformidade. Se a periodicidade mudou, registrar isso para o alerta parar.",
      dataReferencia: ctx.dataReferencia,
      evidencia: {
        competenciaEsperada: esperada.toISOString(),
        ultimaRecebida: panorama.ultimaCompetencia?.toISOString() ?? null,
      },
      chave: chaveAchado("CONF-SEM-RELATORIO", rotuloCompetencia(esperada)),
    },
  ];
}

// CONF-PONTO-CEGO — agregado, informativo: apontamentos em aberto que nenhum
// achado interno cobre. Não é problema da empresa, é limite deste sistema — e o
// valor está justamente em ele admitir onde não enxerga, em vez de deixar a
// ausência de alerta parecer ausência de risco.
function pontosCegos(ctx: ContextoAuditoria): AchadoNovo[] {
  const abertos = ctx.conformidade.apontamentos.filter(estaEmAberto);
  if (abertos.length < 3) return [];

  const comVinculo = new Set(ctx.conformidade.vinculos.map((v) => v.apontamentoId));
  const semCobertura = abertos.filter((a) => !comVinculo.has(a.id));
  if (semCobertura.length === 0) return [];

  const areas = [...new Set(semCobertura.map((a) => ROTULO_AREA[a.area] ?? a.area))];

  return [
    {
      regra: "CONF-PONTO-CEGO",
      tipo: "ESTADO",
      severidade: "INFO",
      categoria: "CONFORMIDADE",
      titulo: `${semCobertura.length} risco(s) que só a revisão externa enxerga`,
      descricao:
        `Estes apontamentos, nas áreas de ${areas.join(", ")}, não têm nenhum achado correspondente entre os gerados pelos ` +
        `agentes. Ou o risco está fora do alcance dos dados financeiros da Omie — o caso normal de trabalhista, contratual e ` +
        `societário — ou falta aqui uma regra que o detecte. Nos dois casos, é a revisão externa que está segurando essa ponta.`,
      recomendacao:
        "Ler a lista com esta pergunta: algum destes seria detectável pelos lançamentos? Se sim, vale virar regra e passar a ser monitorado todo dia, não uma vez por mês.",
      dataReferencia: ctx.dataReferencia,
      evidencia: { semCobertura: semCobertura.length, areas, total: abertos.length },
      chave: chaveAchado("CONF-PONTO-CEGO", "atual"),
    },
  ];
}
