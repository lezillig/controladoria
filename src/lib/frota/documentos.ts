// DOCUMENTOS E LICENÇAS DO VEÍCULO (spec 02) — o catálogo e a leitura da
// situação. Substitui as colunas de validade da planilha CONTROLE
// INFORMAÇÕES GERAIS. A antecedência é quando o aviso começa (60/30/7 dias).

export type TipoDocumento = { chave: string; rotulo: string; antecedenciaDias: number; temNumero: boolean; ajuda?: string };

export const TIPOS_DOCUMENTO: TipoDocumento[] = [
  { chave: "tacografo", rotulo: "Tacógrafo (aferição)", antecedenciaDias: 30, temNumero: false },
  { chave: "artesp", rotulo: "ARTESP", antecedenciaDias: 60, temNumero: false },
  { chave: "emtu", rotulo: "EMTU", antecedenciaDias: 60, temNumero: false },
  { chave: "cvs", rotulo: "CVS (vigilância sanitária)", antecedenciaDias: 60, temNumero: true },
  { chave: "crm", rotulo: "CRM", antecedenciaDias: 60, temNumero: true },
  { chave: "vistoria_semestral", rotulo: "Vistoria semestral", antecedenciaDias: 30, temNumero: false },
  { chave: "ate_escolar", rotulo: "ATE escolar", antecedenciaDias: 30, temNumero: true },
  { chave: "emdec_escolar", rotulo: "EMDEC escolar", antecedenciaDias: 60, temNumero: false },
  { chave: "emdec_fretamento", rotulo: "EMDEC fretamento", antecedenciaDias: 60, temNumero: false },
  { chave: "antt", rotulo: "ANTT", antecedenciaDias: 60, temNumero: false },
];
export const TIPO_DOCUMENTO = new Map(TIPOS_DOCUMENTO.map((t) => [t.chave, t]));

export const SITUACOES_DOCUMENTO = ["vigente", "nao_se_aplica", "preliminar", "em_inclusao", "pendente"] as const;
export const ROTULO_SITUACAO_DOCUMENTO: Record<string, string> = {
  vigente: "com validade",
  nao_se_aplica: "não se aplica",
  preliminar: "preliminar",
  em_inclusao: "em inclusão",
  pendente: "pendente (sem data)",
};

export type Alerta = "vencido" | "7" | "30" | "60" | "ok" | "nao_se_aplica" | "sem_data";

// A situação do documento numa data: vencido, vence em até 7/30/60 dias
// (limitado à antecedência do tipo), em dia, não se aplica ou sem data.
// A antecedência é a do tipo de documento do veículo; os documentos das
// pessoas (src/lib/pessoas/documentos.ts) passam a deles.
export function alertaDoDocumento(doc: { tipo: string; situacao: string; validade: Date | null }, hoje: Date, antecedenciaDias?: number): Alerta {
  if (doc.situacao === "nao_se_aplica") return "nao_se_aplica";
  if (!doc.validade) return "sem_data";
  const dias = Math.floor((Date.UTC(doc.validade.getUTCFullYear(), doc.validade.getUTCMonth(), doc.validade.getUTCDate()) - Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate())) / 86_400_000);
  if (dias < 0) return "vencido";
  const antecedencia = antecedenciaDias ?? TIPO_DOCUMENTO.get(doc.tipo)?.antecedenciaDias ?? 60;
  if (dias <= 7) return "7";
  if (dias <= Math.min(30, antecedencia)) return "30";
  if (dias <= antecedencia) return "60";
  return "ok";
}

// A célula da planilha: data, "N/A", "PRELIMINAR", "INCLUSÃO", "VENCIDO",
// "?", ou um número no lugar da data (ATE: "SRV2891514").
export function lerCelulaDocumento(valor: unknown): { situacao: string; validade: Date | null; numero: string | null; observacao: string | null } | null {
  if (valor instanceof Date) return { situacao: "vigente", validade: valor, numero: null, observacao: null };
  const t = String(valor ?? "").trim();
  if (!t) return null;
  const s = t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  if (/^N\/?A$|^-$/.test(s)) return { situacao: "nao_se_aplica", validade: null, numero: null, observacao: null };
  if (s.startsWith("PRELIMINAR")) return { situacao: "preliminar", validade: null, numero: null, observacao: null };
  if (s.startsWith("INCLUS")) return { situacao: "em_inclusao", validade: null, numero: null, observacao: null };
  if (s === "?" ) return { situacao: "pendente", validade: null, numero: null, observacao: "sem informação na planilha" };
  if (s.startsWith("VENCID")) return { situacao: "pendente", validade: null, numero: null, observacao: "marcado como vencido na planilha, sem data" };
  const data = /^(\d{2})\/(\d{2})\/(\d{4})(.*)$/.exec(t);
  if (data) return { situacao: "vigente", validade: new Date(Date.UTC(Number(data[3]), Number(data[2]) - 1, Number(data[1]))), numero: null, observacao: data[4].replace(/^[\s-]+/, "") || null };
  return { situacao: "pendente", validade: null, numero: t.slice(0, 60), observacao: "valor sem data na planilha" };
}
