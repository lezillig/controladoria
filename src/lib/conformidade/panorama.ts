import type { AuditSeveridade, ConformidadeArea, ConformidadeExtracao, ConformidadeOrigem, ConformidadeStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ROTULO_AREA, STATUS_EM_ABERTO } from "./tipos";

// Os dados de conformidade como o resto do sistema os enxerga, e a leitura
// agregada que o painel, o relatório diário e o agente compartilham.
//
// O conteúdo binário do arquivo NUNCA entra aqui. Ele mora no banco e sai por um
// caminho só, a rota de download — carregá-lo junto do contexto faria cada
// execução da auditoria arrastar dezenas de megabytes de PDF para dentro da
// memória do cron, sem nenhum uso.

export type DocumentoConformidade = {
  id: string;
  conexaoId: string | null;
  conexaoApelido: string | null;
  titulo: string;
  origem: ConformidadeOrigem;
  emissor: string | null;
  competencia: Date;
  arquivoNome: string;
  tamanhoBytes: number;
  extracao: ConformidadeExtracao;
  extracaoErro: string | null;
  resumo: string | null;
  enviadoPorNome: string | null;
  criadoEm: Date;
};

export type ApontamentoConformidade = {
  id: string;
  conexaoId: string | null;
  conexaoApelido: string | null;
  documentoId: string | null;
  competencia: Date;
  area: ConformidadeArea;
  severidade: AuditSeveridade;
  titulo: string;
  descricao: string;
  recomendacao: string | null;
  trechoOrigem: string | null;
  paginaOrigem: string | null;
  valorEnvolvidoCents: number | null;
  status: ConformidadeStatus;
  responsavel: string | null;
  prazo: Date | null;
  observacaoTratativa: string | null;
  propostoPorIa: boolean;
  validado: boolean;
  chaveRecorrencia: string;
  primeiraCompetencia: Date;
  ocorrencias: number;
  criadoEm: Date;
  resolvidoEm: Date | null;
};

export type VinculoConformidade = {
  id: string;
  apontamentoId: string;
  achadoId: string;
  achadoChave: string;
  automatico: boolean;
  pontuacao: number;
};

export type DadosConformidade = {
  documentos: DocumentoConformidade[];
  apontamentos: ApontamentoConformidade[];
  vinculos: VinculoConformidade[];
};

export const CONFORMIDADE_VAZIA: DadosConformidade = { documentos: [], apontamentos: [], vinculos: [] };

export async function carregarConformidade(companyId: string, conexaoId?: string): Promise<DadosConformidade> {
  // Filtro por empresa inclui o que é do GRUPO (conexaoId nulo): uma consultoria
  // que analisa os dois CNPJs no mesmo relatório aponta risco que vale para as
  // duas, e escondê-lo na visão de uma delas faria a tela mentir por omissão.
  const escopo = conexaoId ? { companyId, OR: [{ conexaoId }, { conexaoId: null }] } : { companyId };

  const [documentos, apontamentos, vinculos] = await Promise.all([
    prisma.conformidadeDocumento.findMany({
      where: escopo,
      orderBy: [{ competencia: "desc" }, { criadoEm: "desc" }],
      select: {
        id: true,
        conexaoId: true,
        conexaoApelido: true,
        titulo: true,
        origem: true,
        emissor: true,
        competencia: true,
        arquivoNome: true,
        tamanhoBytes: true,
        extracao: true,
        extracaoErro: true,
        resumo: true,
        enviadoPorNome: true,
        criadoEm: true,
      },
    }),
    prisma.conformidadeApontamento.findMany({
      where: escopo,
      orderBy: [{ competencia: "desc" }, { severidade: "asc" }],
      select: {
        id: true,
        conexaoId: true,
        conexaoApelido: true,
        documentoId: true,
        competencia: true,
        area: true,
        severidade: true,
        titulo: true,
        descricao: true,
        recomendacao: true,
        trechoOrigem: true,
        paginaOrigem: true,
        valorEnvolvidoCents: true,
        status: true,
        responsavel: true,
        prazo: true,
        observacaoTratativa: true,
        propostoPorIa: true,
        validado: true,
        chaveRecorrencia: true,
        primeiraCompetencia: true,
        ocorrencias: true,
        criadoEm: true,
        resolvidoEm: true,
      },
    }),
    prisma.conformidadeVinculo.findMany({
      where: { companyId },
      select: { id: true, apontamentoId: true, achadoId: true, achadoChave: true, automatico: true, pontuacao: true },
    }),
  ]);

  return { documentos, apontamentos, vinculos };
}

// ---------------------------------------------------------------------------
// Leitura agregada
// ---------------------------------------------------------------------------

// A partir de quantas competências seguidas o mesmo assunto deixa de ser um
// apontamento e passa a ser um processo que ninguém corrigiu. Três é o número
// que separa "ainda estamos tratando" de "isso virou rotina".
export const OCORRENCIAS_PARA_REINCIDENCIA = 3;

export type PanoramaConformidade = {
  temModulo: boolean;
  abertos: number;
  criticos: number;
  vencidos: number;
  reincidentes: number;
  naoValidados: number;
  confirmadosPeloSistema: number;
  sugestoesPendentes: number;
  semCobertura: number;
  valorEnvolvidoCents: number;
  porArea: { area: ConformidadeArea; rotulo: string; abertos: number; criticos: number }[];
  ultimaCompetencia: Date | null;
  competenciaEsperada: Date | null;
  documentoEsperadoRecebido: boolean;
  prioritarios: ApontamentoConformidade[];
};

export function estaEmAberto(a: ApontamentoConformidade): boolean {
  return (STATUS_EM_ABERTO as ConformidadeStatus[]).includes(a.status);
}

export function estaVencido(a: ApontamentoConformidade, referencia: Date): boolean {
  return estaEmAberto(a) && a.prazo !== null && a.prazo < referencia;
}

// A competência que já deveria ter chegado: o mês anterior fechado, e só depois
// do dia 15 — cobrar o relatório de julho no dia 2 de agosto seria alarme falso
// todo mês, e alarme falso mensal é como um controle deixa de ser lido.
const DIA_LIMITE_ENTREGA = 15;

export function competenciaEsperada(referencia: Date): Date | null {
  if (referencia.getDate() < DIA_LIMITE_ENTREGA) return null;
  return new Date(referencia.getFullYear(), referencia.getMonth() - 1, 1, 0, 0, 0, 0);
}

export function montarPanoramaConformidade(dados: DadosConformidade, referencia: Date): PanoramaConformidade {
  const abertos = dados.apontamentos.filter(estaEmAberto);
  const graves = abertos.filter((a) => a.severidade === "CRITICA" || a.severidade === "ALTA");

  const apontamentosComVinculo = new Set(dados.vinculos.map((v) => v.apontamentoId));
  const confirmados = new Set(dados.vinculos.filter((v) => !v.automatico).map((v) => v.apontamentoId));

  const porArea = [...new Set(abertos.map((a) => a.area))]
    .map((area) => ({
      area,
      rotulo: ROTULO_AREA[area] ?? area,
      abertos: abertos.filter((a) => a.area === area).length,
      criticos: graves.filter((a) => a.area === area).length,
    }))
    .sort((x, y) => y.criticos - x.criticos || y.abertos - x.abertos);

  const esperada = competenciaEsperada(referencia);

  // A ordem do bloco executivo: primeiro o que tem prazo estourado, depois o
  // reincidente, depois a severidade. Um apontamento médio que se repete há
  // cinco meses interessa mais à diretoria que um alto que chegou ontem — o
  // primeiro é falha de gestão, o segundo ainda é notícia.
  const ordemSeveridade: AuditSeveridade[] = ["CRITICA", "ALTA", "MEDIA", "BAIXA", "INFO"];
  const prioritarios = [...abertos]
    .sort((x, y) => {
      const vx = estaVencido(x, referencia) ? 1 : 0;
      const vy = estaVencido(y, referencia) ? 1 : 0;
      if (vx !== vy) return vy - vx;
      if (x.ocorrencias !== y.ocorrencias) return y.ocorrencias - x.ocorrencias;
      return ordemSeveridade.indexOf(x.severidade) - ordemSeveridade.indexOf(y.severidade);
    })
    .slice(0, 5);

  return {
    temModulo: dados.documentos.length > 0 || dados.apontamentos.length > 0,
    abertos: abertos.length,
    criticos: graves.length,
    vencidos: abertos.filter((a) => estaVencido(a, referencia)).length,
    reincidentes: abertos.filter((a) => a.ocorrencias >= OCORRENCIAS_PARA_REINCIDENCIA).length,
    naoValidados: abertos.filter((a) => a.propostoPorIa && !a.validado).length,
    confirmadosPeloSistema: abertos.filter((a) => confirmados.has(a.id)).length,
    sugestoesPendentes: dados.vinculos.filter((v) => v.automatico).length,
    semCobertura: abertos.filter((a) => !apontamentosComVinculo.has(a.id)).length,
    valorEnvolvidoCents: abertos.reduce((acc, a) => acc + (a.valorEnvolvidoCents ?? 0), 0),
    porArea,
    ultimaCompetencia: dados.documentos[0]?.competencia ?? null,
    competenciaEsperada: esperada,
    documentoEsperadoRecebido:
      esperada === null || dados.documentos.some((d) => d.competencia.getTime() === esperada.getTime()),
    prioritarios,
  };
}
