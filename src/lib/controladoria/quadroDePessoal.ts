import ExcelJS from "exceljs";

// A LISTA DE EMPREGADOS ATIVOS do sistema de folha ("Empregados em Excel —
// Apenas Ativos"), lida para o DRE por centro de custo.
//
// Lê só as colunas que o relatório usa: matrícula, nome, cargo, categoria,
// admissão, salário, centro de custo, serviço (o cliente onde a pessoa
// trabalha), departamento e sindicato. CPF, RG e PIS existem na planilha e
// são IGNORADOS já aqui — nem chegam à memória do servidor como dado lido,
// quanto mais ao banco.
//
// O cabeçalho é achado pelo nome, não pela posição: o sistema de folha muda a
// ordem das colunas entre versões, e ler pela posição trocaria salário por
// código de função sem nenhum erro aparente.

export type PessoaLida = {
  empresaCodigo: string;
  matricula: string;
  nome: string;
  cargo: string | null;
  categoria: string | null;
  admissao: Date | null;
  salarioCents: number;
  centroCustoCodigo: string;
  centroCustoDescricao: string;
  servico: string | null;
  departamento: string | null;
  sindicato: string | null;
};

export type ListaLida = { pessoas: PessoaLida[]; avisos: string[] };

// Sem acento, minúsculo, um espaço: "Descrição  Ccusto" → "descricao ccusto".
export const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Cada campo e os nomes de coluna que o trazem (o primeiro que existir).
const COLUNAS = {
  empresaCodigo: ["cod emp", "codigo empresa", "empresa"],
  matricula: ["cod epr", "matricula", "cod empregado", "codigo empregado"],
  nome: ["nome", "nome empregado"],
  admissao: ["admissao", "data admissao"],
  salario: ["salario", "salario base"],
  categoria: ["categoria"],
  cargo: ["descricao cargo", "cargo"],
  funcao: ["descricao funcao", "funcao"],
  ccCodigo: ["cod ccusto", "cod centro custo", "codigo centro de custo", "centro de custo codigo"],
  ccDescricao: ["descricao ccusto", "descricao centro custo", "centro de custo"],
  servico: ["descricao servico", "servico"],
  departamento: ["descricao dpto", "departamento", "descricao departamento"],
  sindicato: ["sindicato"],
} as const;

type Campo = keyof typeof COLUNAS;

function textoDaCelula(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("text" in v) return String(v.text);
    if ("result" in v) return textoDaCelula(v.result as ExcelJS.CellValue);
    return "";
  }
  return String(v);
}

// "1874.360000" (o formato do sistema de folha), "1.874,36", 1874.36.
export function lerSalarioCents(v: ExcelJS.CellValue): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) : null;
  const s = textoDaCelula(v).replace(/[R$\s]/g, "");
  if (!s) return null;
  let n: number;
  if (/,\d{1,2}$/.test(s)) n = Number(s.replace(/\./g, "").replace(",", "."));
  else n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

// "dd/mm/aaaa" ou data do Excel. Meia-noite UTC, como as datas de calendário
// da base.
export function lerData(v: ExcelJS.CellValue): Date | null {
  if (v instanceof Date) return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
  const m = textoDaCelula(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  return Number.isNaN(d.getTime()) ? null : d;
}

// Código como texto, sem o ".0" que o Excel põe em número.
const codigo = (v: ExcelJS.CellValue) => textoDaCelula(v).trim().replace(/\.0+$/, "");
const textoOuNulo = (v: ExcelJS.CellValue) => textoDaCelula(v).replace(/\s+/g, " ").trim() || null;

export async function lerListaDeEmpregados(conteudo: ArrayBuffer | Buffer): Promise<ListaLida> {
  const livro = new ExcelJS.Workbook();
  try {
    await livro.xlsx.load(conteudo as ArrayBuffer);
  } catch {
    throw new Error("Não consegui abrir o arquivo. Envie a lista de empregados em .xlsx (o .xls antigo precisa ser salvo de novo como .xlsx).");
  }
  const avisos: string[] = [];
  for (const planilha of livro.worksheets) {
    // O cabeçalho: a primeira linha (das 15 primeiras) com nome e centro de custo.
    let linhaCabecalho = 0;
    let indice: Partial<Record<Campo, number>> = {};
    for (let r = 1; r <= Math.min(15, planilha.rowCount); r++) {
      const nomes = new Map<string, number>();
      planilha.getRow(r).eachCell({ includeEmpty: false }, (c, col) => {
        const n = normalizar(textoDaCelula(c.value));
        if (n && !nomes.has(n)) nomes.set(n, col);
      });
      const achado: Partial<Record<Campo, number>> = {};
      for (const campo of Object.keys(COLUNAS) as Campo[]) {
        const col = COLUNAS[campo].map((a) => nomes.get(a)).find((x) => x !== undefined);
        if (col !== undefined) achado[campo] = col;
      }
      if (achado.nome && achado.ccCodigo && achado.salario) {
        linhaCabecalho = r;
        indice = achado;
        break;
      }
    }
    if (!linhaCabecalho) continue;

    const pessoas: PessoaLida[] = [];
    let semSalario = 0;
    for (let r = linhaCabecalho + 1; r <= planilha.rowCount; r++) {
      const linha = planilha.getRow(r);
      const v = (campo: Campo) => (indice[campo] ? linha.getCell(indice[campo]!).value : null);
      const nome = textoOuNulo(v("nome"));
      const cc = codigo(v("ccCodigo"));
      if (!nome || !cc) continue;
      const salario = lerSalarioCents(v("salario"));
      if (salario === null) semSalario++;
      pessoas.push({
        empresaCodigo: codigo(v("empresaCodigo")) || "?",
        matricula: codigo(v("matricula")) || String(r),
        nome,
        cargo: textoOuNulo(v("cargo")) ?? textoOuNulo(v("funcao")),
        categoria: textoOuNulo(v("categoria")),
        admissao: lerData(v("admissao")),
        salarioCents: salario ?? 0,
        centroCustoCodigo: cc,
        centroCustoDescricao: textoOuNulo(v("ccDescricao")) ?? `Centro de custo ${cc}`,
        servico: textoOuNulo(v("servico")),
        departamento: textoOuNulo(v("departamento")),
        sindicato: textoOuNulo(v("sindicato")),
      });
    }
    if (semSalario > 0) avisos.push(`${semSalario} pessoa(s) sem salário legível na planilha: entram com zero e não pesam na divisão da folha.`);
    if (pessoas.length === 0) throw new Error("A planilha tem o cabeçalho, mas nenhuma pessoa com nome e centro de custo.");
    return { pessoas, avisos };
  }
  throw new Error('Não achei as colunas "Nome", "Cód Ccusto" e "Salário". É a lista "Empregados em Excel — Apenas Ativos" do sistema de folha?');
}

// Agrupa a lista pela empresa da folha ("Cód Emp") — um arquivo pode trazer mais de uma.
export function porEmpresa(pessoas: PessoaLida[]) {
  const mapa = new Map<string, PessoaLida[]>();
  for (const p of pessoas) mapa.set(p.empresaCodigo, [...(mapa.get(p.empresaCodigo) ?? []), p]);
  return mapa;
}

// O TIPO INICIAL DE CADA CENTRO DE CUSTO, para a pessoa só corrigir. Apoio é
// quem não fatura: a empresa corporativa inteira (a MCZ) e, na operação, o
// centro cujo pessoal é quase todo do departamento administrativo ou cujo nome
// é de área de suporte.
const NOMES_DE_APOIO = /\b(administrativ|recursos humanos|financeir|comercial|manutencao|oficina|monitoramento|servicos gerais|logistic|diretoria|operacional|compras|juridico|contabil)/;

export function tipoSugerido(params: { conexaoCorporativa: boolean; descricao: string; pessoas: { departamento: string | null }[] }): "OPERACIONAL" | "APOIO" {
  if (params.conexaoCorporativa) return "APOIO";
  if (NOMES_DE_APOIO.test(normalizar(params.descricao))) return "APOIO";
  const adm = params.pessoas.filter((p) => normalizar(p.departamento ?? "").startsWith("administrativ")).length;
  return params.pessoas.length > 0 && adm / params.pessoas.length > 0.5 ? "APOIO" : "OPERACIONAL";
}
