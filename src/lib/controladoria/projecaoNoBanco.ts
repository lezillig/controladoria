import type { OmieContrato } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { montarDreAnualNoBanco } from "./dreNoBanco";
import type { ChaveDre } from "./dre";
import { LINHAS_DRE } from "./dre";
import {
  apenasFechadas,
  ehLinhaDeGrupo,
  type BaseHistorica,
  type Cenario,
  type Competencia,
  type LinhaOrcada,
  type Premissa,
  type SerieDaLinha,
} from "./projecao";

// A COLHEITA DA PROJEÇÃO — o que projecao.ts precisa, vindo do banco.
//
// A série por linha do DRE sai da MESMA função do DRE anual da tela
// (montarDreAnualNoBanco), um ano de cada vez: três anos cobrem os 24 meses
// fechados que a sazonalidade com tendência pede, mais o ano corrente. O
// número projetado parte, portanto, do mesmo número que a tela de Custos e
// DRE mostra como realizado — não há uma segunda conta de "receita" para
// divergir da primeira.

export type EscopoProjecao = { companyId: string; conexaoId: string | null };

const ANOS_DE_BASE = 3;

export async function classificacoesDoDre(companyId: string) {
  const guardadas = await prisma.dreClassificacao.findMany({
    where: { companyId },
    select: { categoriaCodigo: true, linha: true, subgrupo: true, origem: true },
  });
  return new Map(guardadas.map((c) => [c.categoriaCodigo, { linha: c.linha, subgrupo: c.subgrupo, confirmada: c.origem === "CONFIRMADA" }]));
}

export async function baseHistoricaNoBanco(escopo: EscopoProjecao, dataReferencia: Date): Promise<BaseHistorica> {
  const [classificacoes, config] = await Promise.all([
    classificacoesDoDre(escopo.companyId),
    prisma.controladoriaConfig.findUnique({ where: { companyId: escopo.companyId }, select: { retencoesNasDeducoes: true, dataInicioBase: true } }),
  ]);
  const anoAtual = dataReferencia.getFullYear();
  const primeiroAno = Math.max(anoAtual - (ANOS_DE_BASE - 1), config?.dataInicioBase.getFullYear() ?? anoAtual - (ANOS_DE_BASE - 1));
  const anos = Array.from({ length: anoAtual - primeiroAno + 1 }, (_, i) => primeiroAno + i);

  const dres = await Promise.all(
    anos.map((ano) =>
      montarDreAnualNoBanco(
        { companyId: escopo.companyId, conexaoId: escopo.conexaoId, janela: { desde: new Date(ano, 0, 1), ate: null } },
        ano,
        dataReferencia,
        classificacoes,
        { regime: "competencia", somarRetencoes: config?.retencoesNasDeducoes ?? false }
      )
    )
  );

  const porLinha = new Map<ChaveDre, SerieDaLinha>();
  for (const def of LINHAS_DRE) porLinha.set(def.chave, new Map());
  // A base não começa antes do início dela: meses anteriores a dataInicioBase
  // sairiam zerados e pareceriam um ano sem receita.
  const inicioBase = config ? `${config.dataInicioBase.getFullYear()}-${String(config.dataInicioBase.getMonth() + 1).padStart(2, "0")}` : "0000-00";
  dres.forEach((dre, i) => {
    const ano = anos[i];
    for (const linha of dre.linhas) {
      const serie = porLinha.get(linha.chave as ChaveDre);
      if (!serie) continue;
      linha.porMes.forEach((valor, indice) => {
        const competencia: Competencia = `${ano}-${String(indice + 1).padStart(2, "0")}`;
        if (competencia < inicioBase) return;
        serie.set(competencia, valor);
      });
    }
  });

  return apenasFechadas(porLinha, dataReferencia);
}

export async function contratosDoEscopo(escopo: EscopoProjecao): Promise<OmieContrato[]> {
  return prisma.omieContrato.findMany({
    where: { companyId: escopo.companyId, ...(escopo.conexaoId ? { conexaoId: escopo.conexaoId } : {}) },
  });
}

export function escopoTexto(conexaoId: string | null): string {
  return conexaoId ?? "GRUPO";
}

// As premissas gravadas em Json voltam validadas: linha conhecida, percentual
// numérico, competências no formato. O que não passa é descartado em silêncio
// — cenário com premissa corrompida não pode derrubar a tela inteira.
export function premissasDoJson(bruto: unknown): Premissa[] {
  if (!Array.isArray(bruto)) return [];
  const saida: Premissa[] = [];
  for (const p of bruto) {
    if (!p || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    if (typeof o.linha !== "string" || !ehLinhaDeGrupo(o.linha)) continue;
    if (typeof o.percentual !== "number" || !Number.isFinite(o.percentual)) continue;
    if (typeof o.desde !== "string" || !/^\d{4}-\d{2}$/.test(o.desde)) continue;
    const ate = typeof o.ate === "string" && /^\d{4}-\d{2}$/.test(o.ate) ? o.ate : null;
    saida.push({ linha: o.linha, percentual: o.percentual, desde: o.desde, ate, descricao: typeof o.descricao === "string" ? o.descricao : null });
  }
  return saida;
}

export function cenarioDoRegistro(registro: { premissas: unknown; baseReceita: string } | null): Cenario {
  if (!registro) return { premissas: [], baseReceita: "HISTORICA" };
  return {
    premissas: premissasDoJson(registro.premissas),
    baseReceita: registro.baseReceita === "CONTRATADA" ? "CONTRATADA" : "HISTORICA",
  };
}

// O orçamento vigente de um ano: a versão mais alta gravada para o escopo.
export async function orcamentoVigente(escopo: EscopoProjecao, ano: number): Promise<{ versao: number; linhas: LinhaOrcada[]; cenarioId: string | null; criadoEm: Date | null }> {
  const texto = escopoTexto(escopo.conexaoId);
  const ultima = await prisma.orcamentoLinha.findFirst({
    where: { companyId: escopo.companyId, escopo: texto, ano },
    orderBy: { versao: "desc" },
    select: { versao: true, cenarioId: true, criadoEm: true },
  });
  if (!ultima) return { versao: 0, linhas: [], cenarioId: null, criadoEm: null };
  const linhas = await prisma.orcamentoLinha.findMany({
    where: { companyId: escopo.companyId, escopo: texto, ano, versao: ultima.versao },
    select: { linha: true, competencia: true, valorCents: true },
  });
  return { versao: ultima.versao, linhas, cenarioId: ultima.cenarioId, criadoEm: ultima.criadoEm };
}
