import ExcelJS from "exceljs";
import {
  ABAS_DE_PARAMETRO,
  CATALOGO_PARAMETROS,
  CHAVE_REFERENCIA,
  COLUNAS_FROTA,
  COLUNAS_MAO_DE_OBRA,
  COLUNAS_PEDAGIO,
  normalizarCabecalho,
  normalizarPct,
  normalizarRotulo,
  numeroDoTexto,
  todosOsNumeros,
  type DefinicaoColuna,
  type EntidadeParametro,
  type TipoValor,
} from "./catalogo";

// LEITURA DO GABARITO DE DADOS — puro: recebe o arquivo, devolve registros.
//
// Não grava nada. Quem grava é baseDeCustos.ts, com a regra de vigência; aqui
// só se transforma planilha em dado e se diz, em linguagem de gente, o que
// faltou ou não pôde ser lido. Célula vazia não é erro — o Gabarito é
// preenchido aos poucos —, mas item essencial (★) vazio vira aviso.

export type ParametroLido = {
  entidade: EntidadeParametro;
  chave: string;
  rotulo: string;
  unidade: string | null;
  valor: number | null;
  texto: string | null;
};

export type RegistroLido = { chave: string; campos: Record<string, string | number | boolean | null> };

export type LeituraGabarito = {
  parametros: ParametroLido[];
  veiculos: RegistroLido[];
  funcoes: RegistroLido[];
  pedagios: RegistroLido[];
  referencias: { aba: "HISTORICO_CONTRATO" | "MERCADO"; chave: string; dados: Record<string, string | number | null> }[];
  avisos: string[];
};

const LINHA_CABECALHO = 4;
const PRIMEIRA_LINHA_DE_DADOS = 7;

// O valor de uma célula do exceljs em forma simples: número, texto ou nulo.
// Fórmula vale pelo resultado; texto rico, pela concatenação; data, pela data
// em ISO (as datas do Gabarito são texto livre, "set/2026").
function valorSimples(v: ExcelJS.CellValue): number | string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") return v.trim() === "" ? null : v.trim();
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("result" in v) return valorSimples((v as { result?: ExcelJS.CellValue }).result ?? null);
    if ("richText" in v) return valorSimples((v as { richText: { text: string }[] }).richText.map((t) => t.text).join(""));
    if ("text" in v) return valorSimples((v as { text: string }).text);
  }
  return null;
}

function converter(bruto: number | string | null, tipo: TipoValor): number | string | boolean | null {
  if (bruto === null) return null;
  switch (tipo) {
    case "texto":
      return String(bruto);
    case "simnao": {
      const t = String(bruto).trim().toLowerCase();
      if (["sim", "s", "yes", "true", "1"].includes(t)) return true;
      if (["não", "nao", "n", "no", "false", "0"].includes(t)) return false;
      return null;
    }
    case "inteiro": {
      const n = typeof bruto === "number" ? bruto : numeroDoTexto(bruto);
      return n === null ? null : Math.trunc(n);
    }
    case "numero": {
      return typeof bruto === "number" ? bruto : numeroDoTexto(bruto);
    }
    case "pct": {
      const n = typeof bruto === "number" ? bruto : numeroDoTexto(bruto);
      return n === null ? null : normalizarPct(n);
    }
  }
}

function normalizarChave(...partes: (string | number | boolean | null | undefined)[]): string {
  return partes
    .map((p) => (p === null || p === undefined ? "" : String(p)))
    .map((p) =>
      p
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim()
    )
    .join("|");
}

function lerParametros(ws: ExcelJS.Worksheet, entidades: EntidadeParametro[], avisos: string[]): ParametroLido[] {
  const definicoes = CATALOGO_PARAMETROS.filter((d) => entidades.includes(d.entidade));
  const saida: ParametroLido[] = [];
  const achados = new Set<string>();
  ws.eachRow((row, numero) => {
    if (numero <= LINHA_CABECALHO) return;
    const rotuloBruto = valorSimples(row.getCell(1).value);
    if (typeof rotuloBruto !== "string") return;
    const rotulo = normalizarRotulo(rotuloBruto);
    const def = definicoes.find((d) => rotulo.startsWith(d.rotulo));
    if (!def) return;
    achados.add(def.chave);
    const unidade = valorSimples(row.getCell(2).value);
    const bruto = valorSimples(row.getCell(3).value);
    if (bruto === null) {
      if (def.essencial) avisos.push(`${ws.name}: "${def.rotulo}" está vazio (essencial).`);
      return;
    }
    if (def.tipo === "texto") {
      // Texto guarda também o número, quando houver um só: "Lucro Presumido"
      // fica só texto; "R$ 4,20; 4,5%" fica texto (dois números, lidos adiante).
      const numeros = typeof bruto === "number" ? [bruto] : todosOsNumeros(bruto);
      saida.push({ entidade: def.entidade, chave: def.chave, rotulo, unidade: typeof unidade === "string" ? unidade : null, valor: numeros.length === 1 ? numeros[0] : null, texto: String(bruto) });
      return;
    }
    const valor = converter(bruto, def.tipo);
    if (typeof valor !== "number") {
      avisos.push(`${ws.name}: "${def.rotulo}" não pôde ser lido como número ("${bruto}").`);
      return;
    }
    saida.push({ entidade: def.entidade, chave: def.chave, rotulo, unidade: typeof unidade === "string" ? unidade : null, valor, texto: null });
  });
  for (const d of definicoes) if (!achados.has(d.chave) && d.essencial) avisos.push(`${ws.name}: a linha "${d.rotulo}" não foi encontrada.`);
  return saida;
}

// Linhas de uma aba tabular, como mapa cabeçalho → valor simples.
function linhasTabulares(ws: ExcelJS.Worksheet): { linha: number; valores: Map<string, number | string | null> }[] {
  const cabecalhos = new Map<number, string>();
  ws.getRow(LINHA_CABECALHO).eachCell((cell, col) => {
    const v = valorSimples(cell.value);
    if (typeof v === "string") cabecalhos.set(col, normalizarCabecalho(v));
  });
  const linhas: { linha: number; valores: Map<string, number | string | null> }[] = [];
  for (let r = PRIMEIRA_LINHA_DE_DADOS; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const valores = new Map<string, number | string | null>();
    let algum = false;
    for (const [col, cab] of cabecalhos) {
      const v = valorSimples(row.getCell(col).value);
      if (v !== null) algum = true;
      valores.set(cab, v);
    }
    if (algum) linhas.push({ linha: r, valores });
  }
  return linhas;
}

function lerTabular(
  ws: ExcelJS.Worksheet,
  colunas: DefinicaoColuna[],
  chaveDe: (campos: RegistroLido["campos"]) => string | null,
  avisos: string[]
): RegistroLido[] {
  const saida: RegistroLido[] = [];
  const faltando = colunas.filter((c) => !linhasTabularesTemCabecalho(ws, c.cabecalho));
  for (const c of faltando) avisos.push(`${ws.name}: coluna "${c.cabecalho}" não encontrada no cabeçalho (linha ${LINHA_CABECALHO}).`);
  const vistas = new Set<string>();
  for (const { linha, valores } of linhasTabulares(ws)) {
    const campos: RegistroLido["campos"] = {};
    for (const c of colunas) {
      const bruto = valores.get(normalizarCabecalho(c.cabecalho)) ?? null;
      if (c.tipo === "pneus") {
        // "6 × R$ 1.150" → quantidade 6, preço 1150; o texto fica também.
        campos.pneusDescricao = bruto === null ? null : String(bruto);
        const nums = bruto === null ? [] : typeof bruto === "number" ? [bruto] : todosOsNumeros(bruto);
        campos.pneusQtde = nums.length >= 2 ? Math.trunc(nums[0]) : null;
        campos.pneuPreco = nums.length >= 2 ? nums[1] : nums.length === 1 ? nums[0] : null;
        continue;
      }
      const v = converter(bruto, c.tipo);
      if (bruto !== null && v === null) avisos.push(`${ws.name}, linha ${linha}: "${c.cabecalho}" não pôde ser lido ("${bruto}").`);
      campos[c.campo] = v;
    }
    const chave = chaveDe(campos);
    if (!chave) {
      avisos.push(`${ws.name}, linha ${linha}: sem os campos que identificam a linha — ignorada.`);
      continue;
    }
    if (vistas.has(chave)) {
      avisos.push(`${ws.name}, linha ${linha}: repete uma linha anterior (${chave}) — ignorada.`);
      continue;
    }
    vistas.add(chave);
    saida.push({ chave, campos });
  }
  return saida;
}

function linhasTabularesTemCabecalho(ws: ExcelJS.Worksheet, cabecalho: string): boolean {
  let achou = false;
  ws.getRow(LINHA_CABECALHO).eachCell((cell) => {
    const v = valorSimples(cell.value);
    if (typeof v === "string" && normalizarCabecalho(v) === normalizarCabecalho(cabecalho)) achou = true;
  });
  return achou;
}

export async function lerGabarito(arquivo: ArrayBuffer | Buffer): Promise<LeituraGabarito> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(arquivo as ArrayBuffer);
  const avisos: string[] = [];
  const aba = (nome: string) => {
    const ws = wb.getWorksheet(nome);
    if (!ws) avisos.push(`A aba "${nome}" não existe no arquivo — o Gabarito é o modelo com as abas 1_Frota a 10_Mercado.`);
    return ws ?? null;
  };

  const parametros: ParametroLido[] = [];
  for (const [nome, entidades] of Object.entries(ABAS_DE_PARAMETRO)) {
    const ws = aba(nome);
    if (ws) parametros.push(...lerParametros(ws, entidades, avisos));
  }

  const frota = aba("1_Frota");
  const veiculos = frota
    ? lerTabular(frota, COLUNAS_FROTA, (c) => (c.tipo && c.modelo ? normalizarChave(c.tipo as string, c.modelo as string, c.ano as number | null) : null), avisos)
    : [];
  const maoDeObra = aba("2_MaoDeObra");
  const funcoes = maoDeObra
    ? lerTabular(maoDeObra, COLUNAS_MAO_DE_OBRA, (c) => (c.funcao ? normalizarChave(c.funcao as string, c.regiao as string | null, c.cct as string | null) : null), avisos)
    : [];
  const pedagio = aba("7_Pedagios_Rotas");
  const pedagios = pedagio ? lerTabular(pedagio, COLUNAS_PEDAGIO, (c) => (c.praca ? normalizarChave(c.praca as string) : null), avisos) : [];

  const referencias: LeituraGabarito["referencias"] = [];
  for (const [nome, tipo] of [
    ["9_Historico_Contratos", "HISTORICO_CONTRATO"],
    ["10_Mercado", "MERCADO"],
  ] as const) {
    const ws = aba(nome);
    if (!ws) continue;
    const colunaChave = normalizarCabecalho(CHAVE_REFERENCIA[nome]);
    const cabecalhosOriginais = new Map<string, string>();
    ws.getRow(LINHA_CABECALHO).eachCell((cell) => {
      const v = valorSimples(cell.value);
      if (typeof v === "string") cabecalhosOriginais.set(normalizarCabecalho(v), normalizarRotulo(v));
    });
    for (const { linha, valores } of linhasTabulares(ws)) {
      const chave = valores.get(colunaChave);
      if (chave === null || chave === undefined) {
        avisos.push(`${nome}, linha ${linha}: sem "${CHAVE_REFERENCIA[nome]}" — ignorada.`);
        continue;
      }
      const dados: Record<string, string | number | null> = {};
      for (const [cab, v] of valores) dados[cabecalhosOriginais.get(cab) ?? cab] = v;
      referencias.push({ aba: tipo, chave: normalizarChave(String(chave)), dados });
    }
  }

  return { parametros, veiculos, funcoes, pedagios, referencias, avisos };
}

// A BASE QUE UMA LEITURA FORMARIA — sem banco. Serve à prévia da importação
// (a tela mostra o que a simulação passaria a usar antes de gravar) e aos
// testes.
export function baseDaLeitura(leitura: LeituraGabarito, em: Date, fonte: string): import("./baseDeCustos").BaseVigente {
  const comMeta = (r: RegistroLido, i: number) => ({ ...r.campos, id: `lido-${i}`, chave: r.chave, fonte, vigenciaInicio: em });
  return {
    em,
    parametros: new Map(leitura.parametros.map((p) => [p.chave, { valor: p.valor, texto: p.texto, fonte, vigenciaInicio: em }])),
    veiculos: leitura.veiculos.map(comMeta),
    funcoes: leitura.funcoes.map(comMeta),
    pedagios: leitura.pedagios.map(comMeta),
  };
}
