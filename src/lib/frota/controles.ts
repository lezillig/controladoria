import { alertaDoDocumento, documentosFaltando, TIPO_DOCUMENTO, type Alerta } from "./documentos";

// OS CONTROLES DA FROTA — regras puras sobre o cadastro, usadas pelo painel
// de vencimentos e pelo agente diário (src/lib/frota/agenteFrota.ts).

export const EM_OPERACAO = ["ativo", "manutencao", "reserva"];
const ANTECEDENCIA_APOLICE_DIAS = 45;

export type CoberturaApolice = "coberto" | "vence_em_breve" | "vencida" | "sem_apolice" | "sem_vencimento" | "segmento_incompativel" | "nao_se_aplica";
export const ROTULO_COBERTURA: Record<CoberturaApolice, string> = {
  coberto: "coberto",
  vence_em_breve: "vence em até 45 dias",
  vencida: "apólice vencida",
  sem_apolice: "sem apólice",
  sem_vencimento: "apólice sem vencimento",
  segmento_incompativel: "segmento da apólice incompatível com o uso",
  nao_se_aplica: "fora da frota",
};

// O segmento de apólice que cobre o uso do veículo (nulo: qualquer um serve).
export function segmentosAceitos(v: { categoriaUso: string | null; tipo: string }): string[] | null {
  if (v.tipo === "carro") return ["veiculo_leve", "fretamento", "outro"];
  switch (v.categoriaUso) {
    case "escolar":
      return ["escolar"];
    case "fretamento":
    case "fretamento_adaptado":
    case "unidade_movel":
      return ["fretamento", "antt"];
    case "cargas":
      return ["cargas"];
    default:
      return null;
  }
}

// TODO VEÍCULO EM OPERAÇÃO TEM APÓLICE ATIVA: vinculada, dentro da vigência
// (a do veículo na apólice, ou a da apólice) e do segmento do uso.
export function coberturaDeApolice(
  v: { status: string; categoriaUso: string | null; tipo: string; apoliceVencimento: Date | null },
  apolice: { ativo: boolean; segmento: string | null; vigenciaFim: Date | null } | null,
  hoje: Date
): CoberturaApolice {
  if (!EM_OPERACAO.includes(v.status)) return "nao_se_aplica";
  if (!apolice || !apolice.ativo) return "sem_apolice";
  const fim = v.apoliceVencimento ?? apolice.vigenciaFim;
  if (!fim) return "sem_vencimento";
  const dias = Math.floor((fim.getTime() - Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate())) / 86_400_000);
  if (dias < 0) return "vencida";
  const aceitos = segmentosAceitos(v);
  if (aceitos && apolice.segmento && !aceitos.includes(apolice.segmento)) return "segmento_incompativel";
  return dias <= ANTECEDENCIA_APOLICE_DIAS ? "vence_em_breve" : "coberto";
}

// Os documentos de um veículo em operação, com o alerta de cada um, e o pior.
const GRAVIDADE: Alerta[] = ["vencido", "7", "30", "60", "sem_data", "ok", "nao_se_aplica"];
export function piorAlerta(alertas: Alerta[]): Alerta | null {
  if (alertas.length === 0) return null;
  return alertas.reduce((pior, a) => (GRAVIDADE.indexOf(a) < GRAVIDADE.indexOf(pior) ? a : pior));
}

export function alertasDoVeiculo(docs: { tipo: string; situacao: string; validade: Date | null }[], hoje: Date) {
  return docs.map((d) => ({ ...d, alerta: alertaDoDocumento(d, hoje) }));
}

// O QUE IMPEDE O VEÍCULO DE RODAR num contrato: documento vencido, documento
// exigido pela categoria sem lançamento, apólice ausente, vencida ou de outro
// segmento. Usado ao alocar o veículo (pendência crítica para a Operação).
export function impedimentosParaRodar(
  v: { status: string; categoriaUso: string | null; tipo: string; capacidade: number | null; apoliceVencimento: Date | null },
  docs: { tipo: string; situacao: string; validade: Date | null }[],
  apolice: { ativo: boolean; segmento: string | null; vigenciaFim: Date | null } | null,
  hoje: Date
): string[] {
  const rotulo = (t: string) => TIPO_DOCUMENTO.get(t)?.rotulo ?? t;
  const r = docs.filter((d) => alertaDoDocumento(d, hoje) === "vencido").map((d) => `${rotulo(d.tipo)} vencido`);
  r.push(...documentosFaltando(v, docs).map((t) => `${rotulo(t)} não lançado`));
  const c = coberturaDeApolice(v, apolice, hoje);
  if (c === "sem_apolice" || c === "vencida" || c === "segmento_incompativel") r.push(ROTULO_COBERTURA[c]);
  return r;
}
