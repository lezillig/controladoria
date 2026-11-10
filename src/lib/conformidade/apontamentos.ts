import type { AuditSeveridade, ConformidadeArea, ConformidadeNatureza } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ApontamentoExtraido } from "./analise";
import { OBRIGACAO_POR_CODIGO } from "./obrigacoes";
import { chaveRecorrencia, competenciaDeTexto, escolherChaveRecorrencia } from "./tipos";

// GRAVAÇÃO DOS APONTAMENTOS que uma leitura automática propôs.
//
// Morava nas ações da tela de Conformidade. Veio para cá quando a conferência
// da leitura (src/lib/conformidade/conferencia.ts) passou a gravar apontamento
// fora da tela — o resultado dela chega por lote, recolhido pelo ciclo, sem
// sessão de ninguém. A regra é a mesma nos dois caminhos: tudo nasce como
// proposta não validada.

const AREAS_VALIDAS: ConformidadeArea[] = [
  "FISCAL", "TRABALHISTA", "PREVIDENCIARIO", "CONTABIL", "FINANCEIRO",
  "SOCIETARIO", "REGULATORIO", "CONTRATUAL", "LGPD", "OUTRO",
];
const SEVERIDADES_VALIDAS: AuditSeveridade[] = ["CRITICA", "ALTA", "MEDIA", "BAIXA", "INFO"];
const NATUREZAS_VALIDAS: ConformidadeNatureza[] = [
  "RISCO", "DOCUMENTO", "QUESTIONAMENTO", "DIVERGENCIA", "OBRIGACAO", "OPORTUNIDADE",
];

export function areaValida(area: string): ConformidadeArea {
  return AREAS_VALIDAS.includes(area as ConformidadeArea) ? (area as ConformidadeArea) : "OUTRO";
}

export type DocumentoBase = {
  id: string;
  companyId: string;
  conexaoId: string | null;
  conexaoApelido: string | null;
  competencia: Date;
};

export async function criarApontamentos(
  companyId: string,
  documento: DocumentoBase,
  extraidos: ApontamentoExtraido[],
  // Marca de conferência para os que forem criados (ver conferencia.ts).
  opcoes: { conferencia?: string } = {}
): Promise<{ apontamentosCriados: number; apontamentosIgnorados: number }> {
  let criados = 0;
  let ignorados = 0;

  for (const item of extraidos) {
    const area = AREAS_VALIDAS.includes(item.area as ConformidadeArea) ? (item.area as ConformidadeArea) : "OUTRO";
    const severidade = SEVERIDADES_VALIDAS.includes(item.severidade as AuditSeveridade)
      ? (item.severidade as AuditSeveridade)
      : "MEDIA";
    const chave = await resolverChave(companyId, area, item.assuntoCanonico || item.titulo);

    const duplicado = await prisma.conformidadeApontamento.findFirst({
      where: { companyId, chaveRecorrencia: chave, competencia: documento.competencia },
      select: { id: true },
    });
    if (duplicado) {
      ignorados++;
      continue;
    }

    // O código da obrigação só é aceito se existir no catálogo: um código
    // inventado apontaria para uma fundamentação inexistente na tela, que é
    // pior que fundamentação nenhuma.
    const obrigacaoCodigo = item.obrigacaoCodigo && OBRIGACAO_POR_CODIGO.has(item.obrigacaoCodigo)
      ? item.obrigacaoCodigo
      : null;

    await inserirApontamento({
      companyId,
      conexaoId: documento.conexaoId,
      conexaoApelido: documento.conexaoApelido,
      documentoId: documento.id,
      competencia: documento.competencia,
      competenciaAlvo: item.competenciaAlvo ? competenciaDeTexto(item.competenciaAlvo) : null,
      area,
      natureza: NATUREZAS_VALIDAS.includes(item.natureza as ConformidadeNatureza)
        ? (item.natureza as ConformidadeNatureza)
        : "RISCO",
      baseLegal: item.baseLegal?.slice(0, 300) ?? OBRIGACAO_POR_CODIGO.get(obrigacaoCodigo ?? "")?.baseLegal ?? null,
      obrigacaoCodigo,
      severidade,
      titulo: item.titulo.slice(0, 300),
      descricao: item.descricao,
      recomendacao: item.recomendacao,
      trechoOrigem: item.trechoOrigem?.slice(0, 1000) ?? null,
      paginaOrigem: item.paginaOrigem?.slice(0, 80) ?? null,
      valorEnvolvidoCents:
        item.valorEnvolvidoReais !== null && Number.isFinite(item.valorEnvolvidoReais)
          ? Math.round(item.valorEnvolvidoReais * 100)
          : null,
      prazo:
        item.prazoSugeridoDias !== null && item.prazoSugeridoDias > 0
          ? new Date(Date.now() + item.prazoSugeridoDias * 86_400_000)
          : null,
      chaveRecorrencia: chave,
      propostoPorIa: true,
      conferencia: opcoes.conferencia ?? null,
    });
    criados++;
  }

  return { apontamentosCriados: criados, apontamentosIgnorados: ignorados };
}

// Insere o apontamento já com a contagem de recorrência acertada — e acerta a
// dos irmãos dele. A contagem fica materializada em cada linha (em vez de ser
// calculada na leitura) porque o agente de conformidade é uma função pura sobre
// o contexto e o relatório precisa do número pronto; recalcular por agrupamento
// em toda tela e em todo e-mail seria o mesmo trabalho feito cinco vezes.
export async function inserirApontamento(dados: {
  companyId: string;
  conexaoId: string | null;
  conexaoApelido: string | null;
  documentoId: string | null;
  competencia: Date;
  competenciaAlvo?: Date | null;
  area: ConformidadeArea;
  natureza: ConformidadeNatureza;
  baseLegal?: string | null;
  obrigacaoCodigo?: string | null;
  severidade: AuditSeveridade;
  titulo: string;
  descricao: string;
  recomendacao: string | null;
  trechoOrigem: string | null;
  paginaOrigem: string | null;
  valorEnvolvidoCents: number | null;
  prazo: Date | null;
  responsavel?: string | null;
  chaveRecorrencia: string;
  propostoPorIa: boolean;
  validadoPorUserId?: string | null;
  conferencia?: string | null;
}): Promise<string> {
  const irmaos = await prisma.conformidadeApontamento.findMany({
    where: { companyId: dados.companyId, chaveRecorrencia: dados.chaveRecorrencia },
    select: { id: true, competencia: true },
  });

  const competencias = new Set([...irmaos.map((i) => i.competencia.getTime()), dados.competencia.getTime()]);
  const ocorrencias = competencias.size;
  const primeira = new Date(Math.min(...competencias));

  const criado = await prisma.conformidadeApontamento.create({
    data: {
      ...dados,
      propostoPorIa: dados.propostoPorIa,
      validado: !dados.propostoPorIa,
      validadoPorUserId: dados.validadoPorUserId ?? null,
      validadoEm: dados.propostoPorIa ? null : new Date(),
      primeiraCompetencia: primeira,
      ocorrencias,
    },
    select: { id: true },
  });

  if (irmaos.length > 0) {
    await prisma.conformidadeApontamento.updateMany({
      where: { id: { in: irmaos.map((i) => i.id) } },
      data: { ocorrencias, primeiraCompetencia: primeira },
    });
  }

  return criado.id;
}

// Chave de recorrência do assunto, já reaproveitando a de um ponto equivalente
// que a empresa recebeu antes. É o passo que faz "juros por atraso a
// fornecedores" de agosto reconhecer o "atraso a fornecedores gerando juros" de
// julho como o MESMO problema — sem isso, cada reescrita da consultoria zeraria
// a contagem de reincidência, que é o número mais valioso deste módulo.
export async function resolverChave(companyId: string, area: ConformidadeArea, assunto: string): Promise<string> {
  const candidata = chaveRecorrencia(area, assunto);
  const existentes = await prisma.conformidadeApontamento.findMany({
    where: { companyId, area },
    select: { chaveRecorrencia: true },
    distinct: ["chaveRecorrencia"],
  });
  return escolherChaveRecorrencia(candidata, existentes.map((e) => e.chaveRecorrencia));
}
