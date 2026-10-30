import type ExcelJS from "exceljs";
import { ehEletrico, normalizarChassi, normalizarPlaca, normalizarRenavam, tipoDeVeiculo } from "@/lib/cadastro/normalizacao";
import { situacaoIpva, usoDoTexto } from "@/lib/cadastro/fichaVeiculo";
import { lerCelulaDocumento } from "./documentos";

// A MIGRAÇÃO ÚNICA DAS PLANILHAS — "CONTROLE INFORMAÇÕES GERAIS" (FROTA
// ATIVA, VENDIDOS, CONSULTA DE PLACA) e "Consórcios e Financiamentos" (uma
// aba por banco: CDC, giro, consórcio). Lida uma vez, para ninguém redigitar
// a frota; depois o sistema é a fonte e as planilhas se aposentam.
//
// Este arquivo só LÊ (puro sobre o workbook): devolve o que entraria e os
// problemas encontrados, para a tela mostrar a prévia. A gravação fica em
// migracaoNoBanco.ts.
//
// As abas de banco não têm formato fixo: o cabeçalho pode estar na linha 1,
// 2 ou 4, há blocos de "QUITADO" com cabeçalho repetido, tabelas dinâmicas
// ("Rótulos de Linha") e linhas de total no meio. A leitura acha cada
// cabeçalho pelo nome das colunas, lê as linhas abaixo até o próximo, e
// descarta total e tabela dinâmica. No CDC, a linha seguinte sem número de
// contrato é outro veículo do MESMO contrato.

type Valor = string | number | Date | null;

export type Problema = { aba: string; linha: number; problema: string };

export type DocumentoMigrado = { tipo: string; situacao: string; validade: Date | null; numero: string | null; observacao: string | null };

export type VeiculoMigrado = {
  chave: string;
  placa: string | null;
  chassi: string | null;
  renavam: string | null;
  prefixo: string | null;
  tipo: string | null;
  eletrico: boolean;
  marca: string | null;
  modelo: string | null;
  cor: string | null;
  anoFab: number | null;
  anoMod: number | null;
  capacidade: number | null;
  adaptacao: string | null;
  categoriaUso: string | null;
  categoriaRegistro: string | null;
  alocacao: string | null;
  dataCompra: Date | null;
  valorCompraCents: number | null;
  notaFiscalCompra: string | null;
  vendedorNome: string | null;
  vidaUtilMeses: number | null;
  crlvExercicio: number | null;
  crvSituacao: string | null;
  ipvaSituacao: string | null;
  ipvaIsencaoInicio: Date | null;
  tagPedagio: boolean | null;
  apoliceDescricao: string | null;
  apoliceVencimento: Date | null;
  status: "ativo" | "vendido";
  dataVenda: Date | null;
  valorVendaCents: number | null;
  compradorNome: string | null;
  transferenciaSituacao: string | null;
  documentos: DocumentoMigrado[];
  consultas: { fonte: string; data: Date }[];
  origens: string[];
};

export type FinanciamentoMigrado = {
  chave: string;
  produto: "financiamento_bens" | "capital_giro" | "consorcio";
  modalidade: string | null;
  instituicao: string;
  contratoNumero: string | null;
  celulaCredito: string | null;
  grupo: string | null;
  cota: string | null;
  dataInicio: Date | null;
  dataFinal: Date | null;
  valorBensCents: number | null;
  entradaCents: number | null;
  valorFinanciadoCents: number | null;
  valorCreditadoCents: number | null;
  lanceCents: number | null;
  lancePlanejadoPct: number | null;
  taxaPct: number | null;
  vencimentoDia: number | null;
  parcelas: number | null;
  parcelasPagas: number | null;
  valorParcelaCents: number | null;
  valorPagoCents: number | null;
  saldoQuitacaoCents: number | null;
  situacaoConsorcio: string | null;
  dataContemplacao: Date | null;
  quitado: boolean;
  alienado: boolean;
  veiculos: { chave: string; parcelaCents: number | null; saldoCents: number | null }[];
  origem: string;
  observacoes: string | null;
};

export type LeituraMigracao = {
  veiculos: VeiculoMigrado[];
  financiamentos: FinanciamentoMigrado[];
  problemas: Problema[];
  abasLidas: string[];
  abasIgnoradas: string[];
  // A data a que os saldos da planilha se referem (o "Acumulado Geral" da aba
  // Controle Geral).
  dataReferencia: Date | null;
};

// ---- Células ----

export function valorDaCelula(c: ExcelJS.Cell | undefined): Valor {
  if (!c) return null;
  let v: unknown = c.value;
  if (v && typeof v === "object" && !(v instanceof Date)) {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: string; error?: string; formula?: string };
    if ("result" in o) v = o.result;
    else if (o.richText) v = o.richText.map((r) => r.text).join("");
    else if (o.text !== undefined) v = o.text;
    else if (o.error) v = null;
    else if (o.formula) v = null;
    else v = null;
    if (v && typeof v === "object" && !(v instanceof Date)) v = null;
  }
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? "SIM" : "NÃO";
  const t = String(v).trim();
  return t === "" ? null : t;
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
export const rotulo = (v: Valor) => (v === null || v instanceof Date ? "" : semAcento(String(v)).toUpperCase().replace(/[º°]/g, "").replace(/\s+/g, " ").replace(/[.:]+$/, "").trim());
const desconhecido = (v: Valor) => v === null || (typeof v === "string" && /^(\?|-|N\/?D|#.*)$/i.test(v.trim()));

function texto(v: Valor): string | null {
  if (desconhecido(v)) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim().replace(/\s+/g, " ") || null;
}
function numero(v: Valor): number | null {
  if (desconhecido(v)) return null;
  if (typeof v === "number") return v;
  if (v instanceof Date) return null;
  const t = String(v).replace(/R\$|\s/g, "");
  const n = Number(/,\d{1,2}$/.test(t) ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}
const cents = (v: Valor) => {
  const n = numero(v);
  return n === null ? null : Math.round(n * 100);
};
function inteiro(v: Valor): number | null {
  const n = numero(v);
  return n === null ? null : Math.round(n);
}
function data(v: Valor): Date | null {
  if (v instanceof Date) return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
  const t = texto(v);
  const m = t ? /^(\d{2})\/(\d{2})\/(\d{4})/.exec(t) : null;
  return m ? new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]))) : null;
}

// "2023/2024", "2025 / 2026", 2025 → anos.
function anos(v: Valor): { fab: number | null; mod: number | null } {
  const t = texto(v);
  if (!t) return { fab: null, mod: null };
  const m = /(\d{4})\s*\/\s*(\d{4})/.exec(t);
  if (m) return { fab: Number(m[1]), mod: Number(m[2]) };
  const u = /^(\d{4})$/.exec(t);
  return u ? { fab: Number(u[1]), mod: null } : { fab: null, mod: null };
}

// A taxa: com formato de % na célula, o número é fração (0,0134 = 1,34%).
function taxa(c: ExcelJS.Cell | undefined): number | null {
  const n = numero(valorDaCelula(c));
  if (n === null) return null;
  const pctNoFormato = /%/.test(c?.numFmt ?? "");
  return Math.round((pctNoFormato || n < 0.1 ? n * 100 : n) * 10_000) / 10_000;
}

// ---- Veículo: a chave e o acúmulo de dados de várias abas ----

function chaveDoVeiculo(placa: string | null, chassi: string | null) {
  return placa ? `P:${placa}` : chassi ? `C:${chassi}` : null;
}

class Frota {
  porChave = new Map<string, VeiculoMigrado>();
  porChassi = new Map<string, string>();

  obter(placaBruta: Valor, chassiBruto: Valor): VeiculoMigrado | null {
    const placa = normalizarPlaca(texto(placaBruta));
    const chassi = normalizarChassi(texto(chassiBruto));
    let chave = chaveDoVeiculo(placa, chassi);
    if (!chave) return null;
    // O mesmo veículo visto antes só pelo chassi (antes do emplacamento).
    if (placa && chassi && this.porChassi.has(chassi) && this.porChassi.get(chassi) !== chave) {
      const antiga = this.porChassi.get(chassi)!;
      const v = this.porChave.get(antiga)!;
      if (!v.placa) {
        this.porChave.delete(antiga);
        v.placa = placa;
        v.chave = chave;
        this.porChave.set(chave, v);
      } else chave = antiga;
    }
    if (!placa && chassi && this.porChassi.has(chassi)) chave = this.porChassi.get(chassi)!;
    let v = this.porChave.get(chave);
    if (!v) {
      v = {
        chave, placa, chassi, renavam: null, prefixo: null, tipo: null, eletrico: false, marca: null, modelo: null, cor: null, anoFab: null, anoMod: null,
        capacidade: null, adaptacao: null, categoriaUso: null, categoriaRegistro: null, alocacao: null, dataCompra: null, valorCompraCents: null,
        notaFiscalCompra: null, vendedorNome: null, vidaUtilMeses: null, crlvExercicio: null, crvSituacao: null, ipvaSituacao: null, ipvaIsencaoInicio: null,
        tagPedagio: null, apoliceDescricao: null, apoliceVencimento: null, status: "ativo", dataVenda: null, valorVendaCents: null, compradorNome: null,
        transferenciaSituacao: null, documentos: [], consultas: [], origens: [],
      };
      this.porChave.set(chave, v);
    }
    if (chassi && !v.chassi) v.chassi = chassi;
    if (chassi) this.porChassi.set(chassi, v.chave);
    return v;
  }
}

// Preenche só o que está vazio: a planilha principal (CONTROLE) é lida
// primeiro e vale mais que o que se repete nas abas de banco.
function completar<T extends object>(alvo: T, dados: Partial<T>) {
  for (const [k, v] of Object.entries(dados) as [keyof T, T[keyof T]][]) {
    if (v === null || v === undefined || (typeof v === "string" && v === "")) continue;
    if (alvo[k] === null || alvo[k] === undefined) alvo[k] = v;
  }
}

function lugares(v: Valor): number | null {
  const t = texto(v);
  const m = t ? /(\d{1,2})/.exec(t) : null;
  return m ? Number(m[1]) : null;
}

// ---- Cabeçalhos ----

type Cabecalho = { linha: number; colunas: Map<string, number[]> };

function lerCabecalho(ws: ExcelJS.Worksheet, linha: number): Cabecalho {
  const colunas = new Map<string, number[]>();
  ws.getRow(linha).eachCell({ includeEmpty: false }, (c, i) => {
    const r = rotulo(valorDaCelula(c));
    if (!r) return;
    colunas.set(r, [...(colunas.get(r) ?? []), i]);
  });
  return { linha, colunas };
}

function coluna(cab: Cabecalho, nomes: string[], ocorrencia = 0): number | null {
  for (const n of nomes) {
    const c = cab.colunas.get(n);
    if (c && c[ocorrencia] !== undefined) return c[ocorrencia];
  }
  return null;
}

// ---- CONTROLE INFORMAÇÕES GERAIS ----

const COLUNAS_DOCUMENTO: { tipo: string; validade: string[]; numero?: string[] }[] = [
  { tipo: "tacografo", validade: ["TACOGRAFO"] },
  { tipo: "artesp", validade: ["ARTESP"] },
  { tipo: "emtu", validade: ["EMTU"] },
  { tipo: "cvs", validade: ["CVS - VALIDADE", "CVS VALIDADE"], numero: ["N CVS", "N  CVS", "NO CVS"] },
  { tipo: "crm", validade: ["CRM - VALIDADE", "CRM VALIDADE"], numero: ["N CRM", "NO CRM"] },
  { tipo: "vistoria_semestral", validade: ["VENC. SEMESTRAL", "VENC SEMESTRAL"] },
  { tipo: "ate_escolar", validade: ["ATE - ESCOLAR", "ATE ESCOLAR"] },
  { tipo: "emdec_escolar", validade: ["EMDEC ESCOLAR"] },
  { tipo: "emdec_fretamento", validade: ["EMDEC FRETAMENTO"] },
  { tipo: "antt", validade: ["ANTT"] },
];

function lerFrotaAtiva(ws: ExcelJS.Worksheet, frota: Frota, problemas: Problema[]) {
  const cab = lerCabecalho(ws, 1);
  const col = (n: string[], o = 0) => coluna(cab, n, o);
  const cPlaca = col(["PLACA"]);
  if (!cPlaca) return problemas.push({ aba: ws.name, linha: 1, problema: "coluna PLACA não encontrada; aba não lida" });
  const c = {
    contrato: col(["CONTRATO"]), prefixo: col(["PREFIXO"]), nf: col(["NF COMPRA"]), dataCompra: col(["DATA DE COMPRA"]), valorCompra: col(["VALOR COMPRA"]),
    crlv: col(["CRLV"]), crv: col(["CRV"]), ipva: col(["ISENCAO IPVA"]), ipvaInicio: col(["INICIO ISENCAO"]), marca: col(["MARCA"]), modelo: col(["MODELO"], 0),
    cor: col(["COR"]), renavam: col(["RENAVAM"]), chassi: col(["CHASSIS", "CHASSI"]), fab: col(["FABRICACAO"]), anoMod: col(["MODELO"], 1), adaptacao: col(["ADAPTACAO"]),
    capacidade: col(["CAPACIDADE"]), tipo: col(["TIPO"]), categoria: col(["CATEGORIA"]), aluguel: col(["ALUGUEL"]), apolice: col(["APOLICE APP / RCF", "APOLICE APP/RCF"]),
    vencApolice: col(["VENCIMENTO APOLICE"]), tag: col(["TAG PEDAGIO"]),
  };
  const cel = (r: ExcelJS.Row, i: number | null) => (i ? valorDaCelula(r.getCell(i)) : null);
  for (let ln = 2; ln <= ws.rowCount; ln++) {
    const r = ws.getRow(ln);
    const placaBruta = cel(r, cPlaca);
    if (desconhecido(placaBruta)) continue;
    const v = frota.obter(placaBruta, cel(r, c.chassi));
    if (!v) {
      problemas.push({ aba: ws.name, linha: ln, problema: `placa "${texto(placaBruta)}" inválida e sem chassi válido — linha não lida` });
      continue;
    }
    const renavamTxt = texto(cel(r, c.renavam));
    const renavam = normalizarRenavam(renavamTxt);
    if (renavamTxt && !renavam) problemas.push({ aba: ws.name, linha: ln, problema: `${v.placa ?? v.chassi}: RENAVAM "${renavamTxt}" com dígito verificador inválido — não gravado` });
    const tipoTxt = texto(cel(r, c.tipo));
    const ipvaTxt = texto(cel(r, c.ipva));
    const registro = texto(cel(r, c.aluguel));
    const tag = texto(cel(r, c.tag));
    const apolice = texto(cel(r, c.apolice));
    completar(v, {
      alocacao: texto(cel(r, c.contrato)),
      prefixo: /^N\/?A$/i.test(texto(cel(r, c.prefixo)) ?? "") ? null : texto(cel(r, c.prefixo)),
      notaFiscalCompra: texto(cel(r, c.nf)),
      dataCompra: data(cel(r, c.dataCompra)),
      valorCompraCents: cents(cel(r, c.valorCompra)),
      crlvExercicio: (() => { const n = inteiro(cel(r, c.crlv)); return n && n > 1990 && n < 2100 ? n : null; })(),
      crvSituacao: texto(cel(r, c.crv)),
      ipvaSituacao: situacaoIpva(ipvaTxt),
      ipvaIsencaoInicio: data(cel(r, c.ipvaInicio)),
      marca: texto(cel(r, c.marca)),
      modelo: texto(cel(r, c.modelo)),
      cor: texto(cel(r, c.cor)),
      renavam,
      anoFab: inteiro(cel(r, c.fab)),
      anoMod: inteiro(cel(r, c.anoMod)),
      adaptacao: texto(cel(r, c.adaptacao)) === "-" ? null : texto(cel(r, c.adaptacao)),
      capacidade: lugares(cel(r, c.capacidade)),
      tipo: tipoTxt ? tipoDeVeiculo(tipoTxt) : null,
      categoriaUso: usoDoTexto(texto(cel(r, c.categoria))),
      categoriaRegistro: registro && /ALUGUEL/i.test(registro) ? "aluguel" : registro && /PARTICULAR/i.test(registro) ? "particular" : null,
      tagPedagio: tag && /^SIM/i.test(tag) ? true : tag && /^N/i.test(tag) ? false : null,
      apoliceDescricao: apolice && !/^N\/?A$/i.test(apolice) ? apolice.replace(/\s+/g, " ").trim() : null,
      apoliceVencimento: data(cel(r, c.vencApolice)),
    });
    if (ehEletrico(tipoTxt)) v.eletrico = true;
    if (ipvaTxt && !v.ipvaSituacao) problemas.push({ aba: ws.name, linha: ln, problema: `${v.placa}: isenção de IPVA "${ipvaTxt}" não reconhecida` });
    for (const d of COLUNAS_DOCUMENTO) {
      const cv = coluna(cab, d.validade);
      if (!cv) continue;
      const lido = lerCelulaDocumento(valorDaCelula(r.getCell(cv)));
      if (!lido) continue;
      const cn = d.numero ? coluna(cab, d.numero) : null;
      const numeroDoc = cn ? texto(valorDaCelula(r.getCell(cn))) : null;
      if (!v.documentos.some((x) => x.tipo === d.tipo)) {
        v.documentos.push({ tipo: d.tipo, ...lido, numero: lido.numero ?? (numeroDoc && !/^N\/?A$/i.test(numeroDoc) ? numeroDoc : null) });
      }
    }
    if (!v.origens.includes(ws.name)) v.origens.push(ws.name);
  }
}

function lerVendidos(ws: ExcelJS.Worksheet, frota: Frota, problemas: Problema[]) {
  let linhaCab = 0;
  for (let ln = 1; ln <= Math.min(6, ws.rowCount); ln++) if (lerCabecalho(ws, ln).colunas.has("PLACA")) linhaCab = ln;
  if (!linhaCab) return problemas.push({ aba: ws.name, linha: 1, problema: "cabeçalho com PLACA não encontrado; aba não lida" });
  const cab = lerCabecalho(ws, linhaCab);
  const col = (n: string[], o = 0) => coluna(cab, n, o);
  const c = { data: col(["DATA DE VENDA"]), valor: col(["VALOR"]), contrato: col(["CONTRATO"]), comprador: col(["COMPRADOR"]), finalizada: col(["COMPRA FINALIZADA"]), placa: col(["PLACA"]), marca: col(["MARCA"]), modelo: col(["MODELO"]), renavam: col(["RENAVAM"]), chassi: col(["CHASSIS", "CHASSI"]), fab: col(["ANO FABRICACAO"]), mod: col(["ANO MODELO"]) };
  const cel = (r: ExcelJS.Row, i: number | null) => (i ? valorDaCelula(r.getCell(i)) : null);
  for (let ln = linhaCab + 1; ln <= ws.rowCount; ln++) {
    const r = ws.getRow(ln);
    const placaBruta = cel(r, c.placa);
    if (desconhecido(placaBruta) && desconhecido(cel(r, c.chassi))) continue;
    const ativo = frota.porChave.get(`P:${normalizarPlaca(texto(placaBruta))}`);
    if (ativo && ativo.origens.includes("FROTA ATIVA")) {
      problemas.push({ aba: ws.name, linha: ln, problema: `${ativo.placa}: está na FROTA ATIVA e nos VENDIDOS — mantido como ativo` });
      continue;
    }
    const v = frota.obter(placaBruta, cel(r, c.chassi));
    if (!v) {
      problemas.push({ aba: ws.name, linha: ln, problema: `placa "${texto(placaBruta)}" inválida e sem chassi válido — linha não lida` });
      continue;
    }
    const dataVenda = data(cel(r, c.data));
    v.status = "vendido";
    completar(v, {
      dataVenda: dataVenda && dataVenda.getUTCFullYear() > 2001 ? dataVenda : null,
      valorVendaCents: cents(cel(r, c.valor)),
      alocacao: texto(cel(r, c.contrato)),
      compradorNome: texto(cel(r, c.comprador)),
      transferenciaSituacao: texto(cel(r, c.finalizada)),
      marca: texto(cel(r, c.marca)),
      modelo: texto(cel(r, c.modelo)),
      renavam: normalizarRenavam(texto(cel(r, c.renavam))),
      anoFab: inteiro(cel(r, c.fab)),
      anoMod: inteiro(cel(r, c.mod)),
    });
    if (!v.dataVenda) problemas.push({ aba: ws.name, linha: ln, problema: `${v.placa ?? v.chassi}: vendido sem data de venda válida` });
    if (!v.origens.includes(ws.name)) v.origens.push(ws.name);
  }
}

function lerConsultas(ws: ExcelJS.Worksheet, frota: Frota) {
  const cab = lerCabecalho(ws, 1);
  const cPlaca = coluna(cab, ["PLACA"]);
  const fontes = [
    { fonte: "LW", col: coluna(cab, ["PESQUISA LW"]) },
    { fonte: "Fazenda", col: coluna(cab, ["PESQUISA FAZENDA"]) },
  ];
  if (!cPlaca) return;
  for (let ln = 2; ln <= ws.rowCount; ln++) {
    const r = ws.getRow(ln);
    const v = frota.porChave.get(`P:${normalizarPlaca(texto(valorDaCelula(r.getCell(cPlaca))))}`);
    if (!v) continue;
    for (const f of fontes) {
      const d = f.col ? data(valorDaCelula(r.getCell(f.col))) : null;
      if (d && !v.consultas.some((x) => x.fonte === f.fonte && x.data.getTime() === d.getTime())) v.consultas.push({ fonte: f.fonte, data: d });
    }
  }
}

// A depreciação da aba FROTA ATIVA da planilha de financiamentos dá a vida
// útil usada (valor ÷ depreciação anual).
function lerDepreciacao(ws: ExcelJS.Worksheet, frota: Frota) {
  const cab = lerCabecalho(ws, 1);
  const cPlaca = coluna(cab, ["PLACA"]);
  const cValor = coluna(cab, ["VALOR COMPRA"]);
  const cAnual = coluna(cab, ["DEPRECIACAO ANUAL"]);
  if (!cPlaca || !cValor || !cAnual) return;
  for (let ln = 2; ln <= ws.rowCount; ln++) {
    const r = ws.getRow(ln);
    const v = frota.porChave.get(`P:${normalizarPlaca(texto(valorDaCelula(r.getCell(cPlaca))))}`);
    if (!v) continue;
    const valor = numero(valorDaCelula(r.getCell(cValor)));
    const anual = numero(valorDaCelula(r.getCell(cAnual)));
    if (valor && anual && anual > 0) {
      const meses = Math.round((valor / anual) * 12);
      if (meses >= 12 && meses <= 360 && v.vidaUtilMeses === null) v.vidaUtilMeses = meses;
      if (v.valorCompraCents === null) v.valorCompraCents = Math.round(valor * 100);
    }
  }
}

// ---- Abas de banco ----

const INSTITUICAO_DA_ABA: [RegExp, string, FinanciamentoMigrado["produto"]][] = [
  [/^CDC RCI/i, "BANCO RCI", "financiamento_bens"],
  [/^CDC MONEO/i, "BANCO MONEO", "financiamento_bens"],
  [/^CDC SANTANDER/i, "BANCO SANTANDER", "financiamento_bens"],
  [/^CDC ITAU/i, "BANCO ITAUCARD", "financiamento_bens"],
  [/^CDC STELLANTIS/i, "BANCO STELLANTIS", "financiamento_bens"],
  [/^CDC BRADESCO/i, "BRADESCO FINANCIAMENTOS", "financiamento_bens"],
  [/^CDC /i, "", "financiamento_bens"],
  [/^GIRO BRADESCO/i, "BANCO BRADESCO", "capital_giro"],
  [/^GIRO/i, "", "capital_giro"],
  [/^CONS\. ?BRASIL/i, "BB CONSÓRCIOS", "consorcio"],
  [/^CONS\. ?ITAU/i, "ITAÚ CONSÓRCIO", "consorcio"],
  [/^CONS\. ?MERCABENCO/i, "MERCABENCO", "consorcio"],
  [/^CONS\. ?CNP/i, "CNP CONSÓRCIO (CAIXA)", "consorcio"],
  [/^CONS\. ?SANTANDER/i, "SANTANDER CONSÓRCIOS", "consorcio"],
  [/^CONS\. ?BRADESCO/i, "BRADESCO CONSÓRCIOS", "consorcio"],
  [/^CONS/i, "", "consorcio"],
];

// O rótulo da coluna → o campo.
const CAMPOS: [string, string[]][] = [
  ["banco", ["BANCO"]],
  ["contrato", ["N CONTRATO", "NO CONTRATO", "CONTRATO"]],
  ["celula", ["CELULA DE CREDITO"]],
  ["tipoContrato", ["TIPO CONTRATO"]],
  ["grupo", ["GRUPO"]],
  ["cota", ["COTA"]],
  ["valorBens", ["VALOR DOS BENS"]],
  ["entrada", ["VALOR DA ENTRADA"]],
  ["valorFinanciado", ["VALOR FINANCIADO", "VALOR SOLICITADO", "FAIXA DE CREDITO", "CREDITO", "VALOR"]],
  ["valorCreditado", ["VALOR CREDITADO", "LIQUIDO"]],
  ["lance", ["LANCE"]],
  ["taxa", ["TAXA MES (%)", "TAXA MES"]],
  ["vencimento", ["VENCIMENTO"]],
  ["parcelas", ["TOTAL DE PARCELAS", "N DE PARCELAS", "NO DE PARCELAS"]],
  ["pagas", ["PARCELAS PAGAS"]],
  ["valorParcela", ["VALOR DA PARCELA", "VALOR PRINCIPAL"]],
  ["valorPago", ["VALOR PAGO"]],
  ["quitacao", ["VALOR PARA QUITACAO", "VL PARA QUITACAO", "VALOR P/ QUITACAO"]],
  ["dataInicio", ["DATA DE INICIO"]],
  ["dataFinal", ["DATA FINAL", "DATA DA QUITACAO"]],
  ["contemplacao", ["DT CONTEMPLACAO", "DATA CONTEMPLACAO"]],
  ["situacao", ["SITUACAO"]],
  ["placa", ["PLACA"]],
  ["parcelaPlaca", ["PARCELA PLACA"]],
  ["saldoPlaca", ["SALDO PLACA"]],
  ["chassi", ["CHASSI", "CHASSIS"]],
  ["renavam", ["RENAVAM"]],
  ["anoModelo", ["ANO / MODELO", "ANO/MODELO"]],
  ["marca", ["MARCA"]],
  ["modelo", ["MODELO"]],
  ["cor", ["COR"]],
  ["nf", ["DANFE / NF", "DANFE/NF"]],
  ["dataNf", ["DT EMISSAO", "DATA DE EMISSAO", "DT DE EMISSAO"]],
  ["vendedor", ["EMPRESA"]],
  ["valorNota", ["VALOR DA NOTA", "VALOR NF"]],
];

function mapaDoCabecalho(cab: Cabecalho): Map<string, number> {
  const m = new Map<string, number>();
  for (const [campo, nomes] of CAMPOS) {
    for (const n of nomes) {
      const c = cab.colunas.get(n);
      if (c) {
        m.set(campo, c[0]);
        break;
      }
    }
  }
  return m;
}

const ehCabecalhoDeBanco = (cab: Cabecalho) => {
  const tem = (n: string) => [...cab.colunas.keys()].some((k) => k === n || k.startsWith(n));
  return tem("PARCELAS PAGAS") && (tem("PLACA") || tem("N CONTRATO") || tem("CONTRATO"));
};

export function situacaoDaCota(t: string | null): string | null {
  const s = semAcento(t ?? "").toUpperCase();
  if (!s) return null;
  if (/NAO CONTEMPLAD/.test(s)) return "nao_contemplada";
  if (/S\/|SEM O BEM|SEM BEM/.test(s)) return "contemplada_sem_bem";
  if (/CONTEMPLAD/.test(s)) return "contemplada_com_bem";
  return null;
}

function lerAbaDeBanco(ws: ExcelJS.Worksheet, frota: Frota, problemas: Problema[], saida: Map<string, FinanciamentoMigrado>) {
  const [, instituicaoPadrao, produto] = INSTITUICAO_DA_ABA.find(([re]) => re.test(ws.name))!;
  let mapa: Map<string, number> | null = null;
  let quitadoBloco = false;
  // "QUITADO" sozinho numa linha: o próximo cabeçalho abre o bloco dos quitados.
  let proximoQuitado = false;
  let anterior: FinanciamentoMigrado | null = null;
  let emDinamica = false;
  for (let ln = 1; ln <= ws.rowCount; ln++) {
    const r = ws.getRow(ln);
    const cab = lerCabecalho(ws, ln);
    if (ehCabecalhoDeBanco(cab)) {
      mapa = mapaDoCabecalho(cab);
      quitadoBloco = proximoQuitado || [...cab.colunas.keys()].some((k) => /^QUITAD/.test(k));
      proximoQuitado = false;
      anterior = null;
      emDinamica = false;
      continue;
    }
    if (!mapa) continue;
    const todos = [...cab.colunas.keys()];
    if (todos.some((k) => k === "ROTULOS DE LINHA")) {
      emDinamica = true;
      continue;
    }
    if (emDinamica) {
      if (todos.some((k) => k.startsWith("TOTAL GERAL"))) emDinamica = false;
      continue;
    }
    if (todos.some((k) => /^DEMONSTRATIVO/.test(k))) {
      mapa = null;
      continue;
    }
    if (todos.length <= 2 && todos.some((k) => /^QUITADOS?$/.test(k))) {
      quitadoBloco = true;
      proximoQuitado = true;
      anterior = null;
      continue;
    }
    if (todos.some((k) => /^TOTAL( GERAL)?$/.test(k))) {
      anterior = null;
      continue;
    }
    const cel = (campo: string) => {
      const i = mapa!.get(campo);
      return i ? valorDaCelula(r.getCell(i)) : null;
    };
    const celula = (campo: string) => {
      const i = mapa!.get(campo);
      return i ? r.getCell(i) : undefined;
    };
    const contratoTxt = texto(cel("contrato"));
    const grupoCota = produto === "consorcio" && numero(cel("grupo")) !== null && numero(cel("cota")) !== null;
    // Consórcio sem número de contrato: a cota se identifica por grupo + cota.
    const contratoValido = contratoTxt && /\d{3,}/.test(contratoTxt) ? contratoTxt : null;
    const temVeiculo = !desconhecido(cel("placa")) || !desconhecido(cel("chassi"));
    const temParcelas = numero(cel("parcelas")) !== null;
    let fin: FinanciamentoMigrado | null = null;
    if ((contratoValido || grupoCota) && (temParcelas || numero(cel("valorParcela")) !== null)) {
      const banco = texto(cel("banco"));
      const linhaQuitada = quitadoBloco || /QUITAD/i.test(banco ?? "") || /QUITAD/i.test(texto(cel("quitacao")) ?? "");
      const grupo = texto(cel("grupo"));
      const cota = texto(cel("cota"));
      const valorFin = cents(cel("valorFinanciado"));
      const chave = [produto, instituicaoPadrao || banco, contratoValido ?? "", grupo ?? "", cota ?? "", produto === "financiamento_bens" ? valorFin ?? "" : ""].join("|");
      const existente = saida.get(chave);
      if (existente) fin = existente;
      else {
        const parcelas = inteiro(cel("parcelas"));
        let pagas = inteiro(cel("pagas"));
        if (pagas !== null && parcelas !== null && pagas > parcelas) {
          problemas.push({ aba: ws.name, linha: ln, problema: `contrato ${contratoValido}${cota ? ` cota ${cota}` : ""}: ${pagas} parcelas pagas de ${parcelas} — gravado como ${parcelas}` });
          pagas = parcelas;
        }
        // Todas as parcelas pagas é contrato encerrado, esteja ou não no bloco
        // dos quitados.
        const todasPagas = pagas !== null && parcelas !== null && pagas >= parcelas;
        const encerrado = linhaQuitada || todasPagas;
        const lanceBruto = numero(cel("lance"));
        const credito = cents(cel("valorFinanciado"));
        const situacaoTxt = texto(cel("situacao"));
        const vencimento = inteiro(cel("vencimento"));
        fin = {
          chave,
          produto,
          modalidade: produto === "consorcio" ? null : texto(cel("tipoContrato")) ?? (produto === "capital_giro" ? "Capital de Giro" : "CDC"),
          instituicao: instituicaoPadrao || banco || ws.name,
          contratoNumero: contratoValido,
          celulaCredito: texto(cel("celula")),
          grupo,
          cota,
          dataInicio: data(cel("dataInicio")),
          dataFinal: data(cel("dataFinal")),
          valorBensCents: cents(cel("valorBens")),
          entradaCents: cents(cel("entrada")),
          valorFinanciadoCents: credito,
          valorCreditadoCents: cents(cel("valorCreditado")),
          // Lance: até 1 é fração do crédito (0,475 = 47,5%); acima, valor.
          lanceCents: lanceBruto === null ? null : lanceBruto <= 1 ? (credito !== null ? Math.round(lanceBruto * credito) : null) : Math.round(lanceBruto * 100),
          lancePlanejadoPct: null,
          taxaPct: taxa(celula("taxa")),
          vencimentoDia: vencimento !== null && vencimento >= 1 && vencimento <= 31 ? vencimento : null,
          parcelas,
          parcelasPagas: linhaQuitada && parcelas !== null ? parcelas : pagas,
          valorParcelaCents: cents(cel("valorParcela")),
          valorPagoCents: cents(cel("valorPago")),
          saldoQuitacaoCents: encerrado ? 0 : (() => { const q = cents(cel("quitacao")); return q !== null && q >= 0 ? q : null; })(),
          situacaoConsorcio:
            produto !== "consorcio"
              ? null
              : (situacaoDaCota(situacaoTxt) ??
                (temVeiculo ? "contemplada_com_bem" : data(cel("contemplacao")) ? "contemplada_sem_bem" : "nao_contemplada")),
          dataContemplacao: data(cel("contemplacao")),
          quitado: encerrado,
          alienado: produto !== "consorcio" ? /ALIENAD/i.test(situacaoTxt ?? "") || produto === "financiamento_bens" : situacaoDaCota(situacaoTxt) === "contemplada_com_bem",
          veiculos: [],
          origem: `${ws.name}, linha ${ln}`,
          observacoes: banco && instituicaoPadrao && rotulo(banco) !== rotulo(instituicaoPadrao) && !/QUITAD/i.test(banco) ? `Na planilha: ${banco}` : null,
        };
        if (produto === "consorcio" && !situacaoDaCota(situacaoTxt) && !encerrado)
          problemas.push({ aba: ws.name, linha: ln, problema: `cota ${grupo}/${cota}: sem situação na planilha — considerada "${fin.situacaoConsorcio?.replace(/_/g, " ")}"` });
        if (!encerrado && fin.dataFinal && fin.dataFinal.getTime() < Date.now() - 30 * 86_400_000)
          problemas.push({ aba: ws.name, linha: ln, problema: `contrato ${contratoValido ?? `${grupo}/${cota}`}: prazo final ${fin.dataFinal.toISOString().slice(0, 10)} já passou e não está como quitado — conferir` });
        saida.set(chave, fin);
      }
    } else if (!contratoValido && temVeiculo && anterior && produto !== "consorcio") {
      // Outro veículo do mesmo contrato (a linha não repete o contrato).
      fin = anterior;
    } else if (temVeiculo && !contratoValido) {
      problemas.push({ aba: ws.name, linha: ln, problema: `linha com veículo e sem contrato reconhecível ("${contratoTxt ?? ""}") — não lida` });
      continue;
    } else continue;
    anterior = fin;
    if (!temVeiculo) continue;
    const placaTxt = texto(cel("placa"));
    const v = frota.obter(placaTxt === "0" ? null : cel("placa"), cel("chassi"));
    if (!v) {
      problemas.push({ aba: ws.name, linha: ln, problema: `${fin.contratoNumero}: veículo sem placa nem chassi válidos ("${placaTxt ?? ""}") — vínculo não gravado` });
      continue;
    }
    const a = anos(cel("anoModelo"));
    completar(v, {
      chassi: normalizarChassi(texto(cel("chassi"))),
      renavam: normalizarRenavam(texto(cel("renavam"))),
      marca: texto(cel("marca")),
      modelo: texto(cel("modelo")),
      cor: texto(cel("cor")),
      anoFab: a.fab,
      anoMod: a.mod,
      notaFiscalCompra: texto(cel("nf")),
      dataCompra: data(cel("dataNf")),
      vendedorNome: texto(cel("vendedor")),
      valorCompraCents: cents(cel("valorNota")),
    });
    if (!v.origens.includes(ws.name)) v.origens.push(ws.name);
    if (!fin.veiculos.some((x) => x.chave === v.chave)) fin.veiculos.push({ chave: v.chave, parcelaCents: cents(cel("parcelaPlaca")), saldoCents: cents(cel("saldoPlaca")) });
  }
}

// "COTAS NÃO CONTEMPLADAS": o lance pretendido de cada cota (grupo + cota).
function lerLancesPlanejados(ws: ExcelJS.Worksheet, saida: Map<string, FinanciamentoMigrado>) {
  const porGrupoCota = new Map<string, FinanciamentoMigrado>();
  for (const f of saida.values()) if (f.produto === "consorcio" && f.grupo && f.cota) porGrupoCota.set(`${Number(f.grupo)}|${Number(f.cota)}`, f);
  for (let ln = 1; ln <= ws.rowCount; ln++) {
    const cab = lerCabecalho(ws, ln);
    const grupos = cab.colunas.get("GRUPO") ?? [];
    for (const cg of grupos) {
      // Bloco: GRUPO, COTA, CRÉDITO, LANCE nas colunas seguintes.
      for (let k = ln + 1; k <= ws.rowCount; k++) {
        const r = ws.getRow(k);
        const g = numero(valorDaCelula(r.getCell(cg)));
        const c = numero(valorDaCelula(r.getCell(cg + 1)));
        const lance = numero(valorDaCelula(r.getCell(cg + 3)));
        if (g === null || c === null) {
          if (rotulo(valorDaCelula(r.getCell(cg))) === "GRUPO") break;
          continue;
        }
        const f = porGrupoCota.get(`${g}|${c}`);
        if (f && lance !== null && lance > 0 && lance <= 1 && f.lancePlanejadoPct === null) f.lancePlanejadoPct = Math.round(lance * 10_000) / 100;
      }
    }
  }
}

// ---- Entrada ----

export function lerPlanilhas(arquivos: { nome: string; livro: ExcelJS.Workbook }[]): LeituraMigracao {
  const frota = new Frota();
  const problemas: Problema[] = [];
  const financiamentos = new Map<string, FinanciamentoMigrado>();
  const abasLidas: string[] = [];
  const abasIgnoradas: string[] = [];
  const todas = arquivos.flatMap((a) => a.livro.worksheets.map((ws) => ({ arquivo: a.nome, ws })));
  const temControle = todas.some(({ ws }) => rotulo(ws.name) === "VENDIDOS") || todas.some(({ ws }) => rotulo(ws.name) === "CONSULTA DE PLACA");
  // A ordem importa: CONTROLE primeiro (vale mais), depois os bancos.
  const ordem = (n: string) => (/^FROTA ATIVA$/i.test(n) ? 0 : /^VENDIDOS$/i.test(n) ? 1 : /^CONSULTA DE PLACA$/i.test(n) ? 2 : 3);
  for (const { arquivo, ws } of todas.sort((a, b) => ordem(a.ws.name) - ordem(b.ws.name))) {
    const nome = rotulo(ws.name);
    const deControle = temControle ? arquivo === todas.find(({ ws: w }) => rotulo(w.name) === "VENDIDOS" || rotulo(w.name) === "CONSULTA DE PLACA")?.arquivo : true;
    if (nome === "FROTA ATIVA") {
      if (deControle) lerFrotaAtiva(ws, frota, problemas);
      else continue;
    } else if (nome === "VENDIDOS") lerVendidos(ws, frota, problemas);
    else if (nome === "CONSULTA DE PLACA") lerConsultas(ws, frota);
    else if (INSTITUICAO_DA_ABA.some(([re]) => re.test(ws.name))) lerAbaDeBanco(ws, frota, problemas, financiamentos);
    else {
      abasIgnoradas.push(`${arquivo} › ${ws.name}`);
      continue;
    }
    abasLidas.push(`${arquivo} › ${ws.name}`);
  }
  // Depois dos bancos: a FROTA ATIVA da planilha de financiamentos (só a
  // depreciação) e o lance planejado das cotas.
  for (const { arquivo, ws } of todas) {
    const nome = rotulo(ws.name);
    const deControle = arquivo === todas.find(({ ws: w }) => rotulo(w.name) === "VENDIDOS" || rotulo(w.name) === "CONSULTA DE PLACA")?.arquivo;
    if (nome === "FROTA ATIVA" && !deControle) {
      lerDepreciacao(ws, frota);
      abasLidas.push(`${arquivo} › ${ws.name} (depreciação)`);
    }
    if (nome === "COTAS NAO CONTEMPLADAS") {
      lerLancesPlanejados(ws, financiamentos);
      abasLidas.push(`${arquivo} › ${ws.name} (lances)`);
    }
  }
  for (const f of financiamentos.values()) {
    if (f.produto === "financiamento_bens" && f.veiculos.length === 0 && !f.quitado) problemas.push({ aba: f.origem, linha: 0, problema: `contrato ${f.contratoNumero} (${f.instituicao}) sem veículo ligado` });
  }
  let dataReferencia: Date | null = null;
  const controleGeral = todas.find(({ ws }) => rotulo(ws.name) === "CONTROLE GERAL");
  if (controleGeral) {
    for (let ln = 1; ln <= 6 && !dataReferencia; ln++) {
      controleGeral.ws.getRow(ln).eachCell({ includeEmpty: false }, (c) => {
        const v = valorDaCelula(c);
        if (!dataReferencia && v instanceof Date) dataReferencia = data(v);
      });
    }
  }
  return {
    veiculos: [...frota.porChave.values()],
    financiamentos: [...financiamentos.values()],
    problemas,
    abasLidas,
    abasIgnoradas: abasIgnoradas.filter((a) => !abasLidas.some((l) => l.startsWith(a))),
    dataReferencia,
  };
}
