import { alertaDoDocumento, type Alerta } from "@/lib/frota/documentos";

// DOCUMENTOS DO MOTORISTA (e do monitor) — o catálogo, o que cada função
// exige e a APTIDÃO PARA A ESCALA: apto, não apto (com o motivo) ou
// incompleto (falta lançar documento exigido, nada vencido).
//
// Exigidos para dirigir passageiros: CNH (categoria D ou E, com EAR), curso
// de transporte coletivo, exame toxicológico (CNH C/D/E) e ASO; no escolar,
// também o curso de transporte escolar e a certidão de antecedentes. O
// monitor precisa do ASO e, no escolar, da certidão. Credenciais de órgão e
// treinamentos dependem do contrato: vencidos, avisam — não travam.

export type TipoDocumentoPessoa = { chave: string; rotulo: string; curto: string; antecedenciaDias: number; ajuda?: string };

export const TIPOS_DOCUMENTO_PESSOA: TipoDocumentoPessoa[] = [
  { chave: "cnh", rotulo: "CNH", curto: "CNH", antecedenciaDias: 60, ajuda: "categoria D ou E e EAR para transportar passageiros" },
  { chave: "curso_coletivo", rotulo: "Curso de transporte coletivo de passageiros", curto: "curso coletivo", antecedenciaDias: 60, ajuda: "renovação a cada 5 anos" },
  { chave: "toxicologico", rotulo: "Exame toxicológico", curto: "toxicológico", antecedenciaDias: 60, ajuda: "periódico para CNH C, D e E" },
  { chave: "aso", rotulo: "ASO (exame ocupacional)", curto: "ASO", antecedenciaDias: 30, ajuda: "periódico, conforme o PCMSO" },
  { chave: "curso_escolar", rotulo: "Curso de transporte escolar", curto: "curso escolar", antecedenciaDias: 60, ajuda: "renovação a cada 5 anos; obrigatório no escolar" },
  { chave: "antecedentes", rotulo: "Certidão de antecedentes criminais", curto: "antecedentes", antecedenciaDias: 30, ajuda: "exigida no escolar" },
  { chave: "credencial_emtu", rotulo: "Credencial EMTU", curto: "EMTU", antecedenciaDias: 60 },
  { chave: "credencial_artesp", rotulo: "Credencial ARTESP", curto: "ARTESP", antecedenciaDias: 60 },
  { chave: "credencial_escolar", rotulo: "Credencial do transporte escolar (DTP/prefeitura)", curto: "credencial escolar", antecedenciaDias: 60 },
  { chave: "direcao_defensiva", rotulo: "Treinamento de direção defensiva", curto: "direção defensiva", antecedenciaDias: 60 },
  { chave: "primeiros_socorros", rotulo: "Treinamento de primeiros socorros", curto: "primeiros socorros", antecedenciaDias: 60 },
  { chave: "acessibilidade", rotulo: "Treinamento de atendimento a pessoas com deficiência", curto: "acessibilidade", antecedenciaDias: 60 },
];
export const TIPO_DOCUMENTO_PESSOA = new Map(TIPOS_DOCUMENTO_PESSOA.map((t) => [t.chave, t]));

export const SITUACOES_DOCUMENTO_PESSOA = ["vigente", "pendente", "nao_se_aplica"] as const;
export const ROTULO_SITUACAO_DOCUMENTO_PESSOA: Record<string, string> = { vigente: "com validade", pendente: "pendente (sem data)", nao_se_aplica: "não se aplica" };

export const CARGOS_DA_ESCALA = ["motorista", "monitor"];

export type DocumentoPessoa = { tipo: string; situacao: string; validade: Date | null; categoria?: string | null; ear?: boolean | null };

export const alertaDoDocumentoPessoa = (d: DocumentoPessoa, hoje: Date): Alerta => alertaDoDocumento(d, hoje, TIPO_DOCUMENTO_PESSOA.get(d.tipo)?.antecedenciaDias ?? 60);

export function documentosExigidos(p: { cargo: string; transportaEscolar: boolean }): string[] {
  if (p.cargo === "motorista") return ["cnh", "curso_coletivo", "toxicologico", "aso", ...(p.transportaEscolar ? ["curso_escolar", "antecedentes"] : [])];
  if (p.cargo === "monitor") return ["aso", ...(p.transportaEscolar ? ["antecedentes"] : [])];
  return [];
}

// Categoria da CNH que habilita transportar passageiros (mais de 8 lugares):
// D ou E, sozinhas ou com A ("AD", "AE"). Sem categoria informada: não se sabe.
export function categoriaHabilitaPassageiros(categoria: string | null | undefined): boolean | null {
  const c = String(categoria ?? "").toUpperCase().replace(/[^A-E]/g, "");
  return c ? /[DE]/.test(c) : null;
}

const br = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join("/");

export type SituacaoAptidao = "apto" | "nao_apto" | "incompleto" | "nao_se_aplica";
export type Aptidao = { situacao: SituacaoAptidao; bloqueios: string[]; faltando: string[]; avisos: string[] };
export const ROTULO_APTIDAO: Record<SituacaoAptidao, string> = { apto: "apto", nao_apto: "não apto", incompleto: "documentos a lançar", nao_se_aplica: "fora da escala" };

// A aptidão NUMA DATA (hoje, ou o dia da escala): documento vencido até lá,
// CNH sem a categoria ou sem EAR, ou férias naquele dia tiram da escala.
export function aptidaoNaData(
  p: { cargo: string; transportaEscolar: boolean; ativo: boolean },
  docs: DocumentoPessoa[],
  feriasNoDia: { fim: Date } | null,
  data: Date
): Aptidao {
  const r: Aptidao = { situacao: "apto", bloqueios: [], faltando: [], avisos: [] };
  if (!p.ativo || !CARGOS_DA_ESCALA.includes(p.cargo)) return { ...r, situacao: "nao_se_aplica" };
  if (feriasNoDia) r.bloqueios.push(`de férias até ${br(feriasNoDia.fim)}`);
  const exigidos = documentosExigidos(p);
  const porTipo = new Map(docs.map((d) => [d.tipo, d]));
  for (const tipo of exigidos) {
    const t = TIPO_DOCUMENTO_PESSOA.get(tipo)!;
    const d = porTipo.get(tipo);
    if (d?.situacao === "nao_se_aplica") continue;
    if (!d || d.situacao === "pendente" || !d.validade) {
      r.faltando.push(t.curto);
      continue;
    }
    const alerta = alertaDoDocumentoPessoa(d, data);
    if (alerta === "vencido") r.bloqueios.push(`${t.curto} vencido em ${br(d.validade)}`);
    else if (alerta === "7" || alerta === "30") r.avisos.push(`${t.curto} vence em ${br(d.validade)}`);
  }
  const cnh = porTipo.get("cnh");
  if (p.cargo === "motorista" && cnh && cnh.situacao !== "nao_se_aplica") {
    if (categoriaHabilitaPassageiros(cnh.categoria) === false) r.bloqueios.push(`CNH categoria ${cnh.categoria} não habilita passageiros (D ou E)`);
    if (cnh.ear === false) r.bloqueios.push("CNH sem EAR (atividade remunerada)");
  }
  for (const d of docs) {
    if (exigidos.includes(d.tipo) || d.situacao !== "vigente" || !d.validade) continue;
    const alerta = alertaDoDocumentoPessoa(d, data);
    const t = TIPO_DOCUMENTO_PESSOA.get(d.tipo);
    if (alerta === "vencido") r.avisos.push(`${t?.curto ?? d.tipo} vencido em ${br(d.validade)}`);
  }
  r.situacao = r.bloqueios.length ? "nao_apto" : r.faltando.length ? "incompleto" : "apto";
  return r;
}
