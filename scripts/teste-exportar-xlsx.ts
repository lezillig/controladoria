// TESTES DA EXPORTAÇÃO EXCEL DO SIMULADOR — `npm run teste:exportar-xlsx`.
//
// A planilha exportada (src/lib/simulador/exportarXlsx.ts) só vale se as suas
// FÓRMULAS derem os mesmos números do motor. Este teste:
//   1. gera a planilha das duas simulações históricas (Holambra e SJP);
//   2. confere a estrutura: as seis abas na ordem, fórmulas (e não valores)
//      nas células-chave, entradas em azul, links em verde, fonte Arial;
//   3. RECALCULA as fórmulas com um motor de planilha independente e compara
//      com `simular()`: preço/km por item (R$ 0,01), custo total por item e
//      totais (0,1%), preço do lote, lucro dos cenários (R$ 1);
//   4. muda premissas NA PLANILHA (diesel, utilização, fator noturno...),
//      recalcula de novo e compara com `simular()` da entrada alterada — prova
//      de que a conta está nas fórmulas e não em números congelados.
//
// Motores de recálculo: LibreOffice headless (`soffice --convert-to xlsx`
// recalcula ao abrir, porque o exportador não grava valores nas fórmulas) e o
// pacote Python `formulas` (scripts/recalcular-xlsx.py). Roda com os que
// estiverem instalados; sem nenhum dos dois, o teste FALHA — o recálculo é o
// ponto do teste.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { historicoHolambra, historicoSaoJoseDosPinhais, type SimulacaoHistorica } from "../src/lib/simulador/historico";
import { arredondarParaCima, simular } from "../src/lib/simulador/motor";
import { ABAS, gerarPlanilhaSimulacao, letraColuna } from "../src/lib/simulador/exportarXlsx";
import type { EntradaSimulacao, ResultadoSimulacao } from "../src/lib/simulador/tipos";

let falhas = 0;
function ok(nome: string, passou: boolean, detalhe = "") {
  if (!passou) falhas++;
  console.log(`${passou ? "  ok  " : "FALHA "} ${nome}${passou ? "" : `\n         ${detalhe}`}`);
}
function conferir(nome: string, real: unknown, esperado: unknown) {
  ok(nome, JSON.stringify(real) === JSON.stringify(esperado), `esperado ${JSON.stringify(esperado)}\n         obtido   ${JSON.stringify(real)}`);
}

// Maior diferença encontrada por grandeza, para o resumo final.
const maiores: Record<string, { dif: number; onde: string }> = {};
type Tolerancia = { tipo: "abs"; valor: number } | { tipo: "rel"; valor: number };
function perto(grandeza: string, nome: string, real: unknown, alvo: number, tol: Tolerancia) {
  const n = typeof real === "number" ? real : NaN;
  const dif = Math.abs(n - alvo);
  const limite = tol.tipo === "abs" ? tol.valor + 1e-9 : Math.abs(alvo) * tol.valor + 1e-6;
  const m = maiores[grandeza];
  if (Number.isFinite(dif) && (!m || dif > m.dif)) maiores[grandeza] = { dif, onde: nome };
  ok(nome, Number.isFinite(dif) && dif <= limite, `esperado ${alvo}, planilha ${JSON.stringify(real)} (diferença ${Number.isFinite(dif) ? dif.toExponential(3) : "—"})`);
}
const PRECO: Tolerancia = { tipo: "abs", valor: 0.01 };
const TOTAL: Tolerancia = { tipo: "rel", valor: 0.001 };
const REAL: Tolerancia = { tipo: "abs", valor: 1 };

// ---------------------------------------------------------------- motores de recálculo

type Valores = Record<string, Record<string, unknown>>; // ABA (maiúsculas) → endereço → valor
type Motor = { nome: string; recalcular: (arquivos: string[], dir: string) => Promise<Valores[]> };

const tem = (cmd: string, args: string[]) => {
  const r = spawnSync(cmd, args, { stdio: "ignore" });
  return !r.error && r.status === 0;
};

async function valoresDoXlsx(arquivo: string): Promise<Valores> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(arquivo);
  const v: Valores = {};
  wb.eachSheet((ws) => {
    const aba: Record<string, unknown> = (v[ws.name.toUpperCase()] = {});
    ws.eachRow((row) =>
      row.eachCell((c) => {
        const val = c.value as unknown;
        aba[c.address] = val !== null && typeof val === "object" && "result" in val ? (val as { result: unknown }).result : val;
      })
    );
  });
  return v;
}

const motores: Motor[] = [];
const soffice = ["soffice", "libreoffice"].find((c) => tem(c, ["--version"]));
if (soffice) {
  motores.push({
    nome: "LibreOffice",
    recalcular: async (arquivos, dir) => {
      const saida = path.join(dir, "libreoffice");
      const perfil = `file://${path.join(dir, "perfil-lo")}`;
      const r = spawnSync(soffice, [`-env:UserInstallation=${perfil}`, "--headless", "--calc", "--convert-to", "xlsx", "--outdir", saida, ...arquivos], {
        encoding: "utf8",
        timeout: 180_000,
      });
      if (r.status !== 0) throw new Error(`LibreOffice falhou: ${r.stderr || r.error}`);
      return Promise.all(arquivos.map((a) => valoresDoXlsx(path.join(saida, path.basename(a)))));
    },
  });
}
if (tem("python3", ["-c", "import formulas"])) {
  motores.push({
    nome: "Python formulas",
    recalcular: async (arquivos) =>
      arquivos.map((a) => {
        const json = a.replace(/\.xlsx$/, ".formulas.json");
        const r = spawnSync("python3", [path.join(__dirname, "recalcular-xlsx.py"), a, json], { encoding: "utf8", timeout: 300_000 });
        if (r.status !== 0) throw new Error(`formulas falhou: ${r.stderr}`);
        return JSON.parse(readFileSync(json, "utf8")) as Valores;
      }),
  });
}

// ---------------------------------------------------------------- leitura da planilha gerada

// Endereços das células-chave, achados pelos RÓTULOS da planilha gerada — o
// teste lê a planilha como uma pessoa leria, sem copiar o leiaute.
type Mapa = {
  wb: ExcelJS.Workbook;
  nItens: number;
  colItem: (i: number) => string;
  colTotal: string;
  comp: (rotulo: string) => number; // linha na Composição
  prem: (rotulo: string) => string; // endereço B da premissa
  cenLinha: (rotulo: string) => number;
  cenColunas: number;
  propTotal: string;
};

function linhaPorRotulo(ws: ExcelJS.Worksheet, rotulo: string): number {
  let achada = 0;
  ws.eachRow((row, n) => {
    const a = row.getCell(1).value;
    if (!achada && typeof a === "string" && a.trim().startsWith(rotulo)) achada = n;
  });
  if (!achada) throw new Error(`Rótulo "${rotulo}" não encontrado na aba ${ws.name}.`);
  return achada;
}

async function mapear(buffer: Buffer): Promise<Mapa> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const wc = wb.getWorksheet("Composição de Custo")!;
  const lCodigo = linhaPorRotulo(wc, "Código do item");
  let nItens = 0;
  while (wc.getCell(lCodigo, nItens + 2).value !== null) nItens++;
  const wz = wb.getWorksheet("Cenários")!;
  let cenColunas = 0;
  while (typeof wz.getCell(6, cenColunas + 2).value === "number") cenColunas++;
  const wp = wb.getWorksheet("Proposta")!;
  return {
    wb,
    nItens,
    colItem: (i) => letraColuna(i + 2),
    colTotal: letraColuna(nItens + 2),
    comp: (r) => linhaPorRotulo(wc, r),
    prem: (r) => `B${linhaPorRotulo(wb.getWorksheet("Premissas")!, r)}`,
    cenLinha: (r) => linhaPorRotulo(wz, r),
    cenColunas,
    propTotal: `F${linhaPorRotuloColuna(wp, 2, "VALOR TOTAL DA PROPOSTA")}`,
  };
}

// linhaPorRotulo lê a coluna A; na Proposta o rótulo do total está na B.
function linhaPorRotuloColuna(ws: ExcelJS.Worksheet, col: number, rotulo: string): number {
  let achada = 0;
  ws.eachRow((row, n) => {
    const a = row.getCell(col).value;
    if (!achada && typeof a === "string" && a.startsWith(rotulo)) achada = n;
  });
  return achada;
}

const formulaDe = (c: ExcelJS.Cell): string | null => {
  const v = c.value as unknown;
  return v !== null && typeof v === "object" && "formula" in v ? String((v as { formula: string }).formula) : null;
};
const cor = (c: ExcelJS.Cell) => c.font?.color?.argb ?? null;

async function gerar(h: SimulacaoHistorica, entrada: EntradaSimulacao = h.entrada): Promise<{ buffer: Buffer; resultado: ResultadoSimulacao }> {
  const resultado = simular(entrada);
  const buffer = await gerarPlanilhaSimulacao({
    edital: h.edital,
    licitante: { razaoSocial: "AZUL TRANSPORTES E TURISMO LTDA", cnpj: "10.764.533/0001-01", endereco: null, representante: null },
    regras: h.regras,
    entrada,
    resultado,
    versao: 3,
    geradoEm: new Date("2026-09-30T12:00:00Z"),
  });
  return { buffer, resultado };
}

// ---------------------------------------------------------------- estrutura

function conferirEstrutura(nome: string, m: Mapa, entrada: EntradaSimulacao) {
  const { wb } = m;
  conferir(`${nome}: seis abas na ordem`, wb.worksheets.map((w) => w.name), [...ABAS]);
  conferir(`${nome}: uma coluna por item na Composição`, m.nItens, entrada.itens.length);

  const wc = wb.getWorksheet("Composição de Custo")!;
  const wr = wb.getWorksheet("Rotas")!;
  const ws = wb.getWorksheet("Premissas")!;
  const wz = wb.getWorksheet("Cenários")!;
  const wp = wb.getWorksheet("Proposta")!;

  const formulasCom = (ws2: ExcelJS.Worksheet, enderecos: string[], trecho: RegExp) =>
    enderecos.every((e) => {
      const f = formulaDe(ws2.getCell(e));
      return f !== null && trecho.test(f);
    });
  const itensCol = Array.from({ length: m.nItens }, (_, i) => m.colItem(i));
  const lPkm = m.comp("PREÇO/KM CALCULADO");
  ok(`${nome}: preço/km de cada item é fórmula com ROUNDUP`, formulasCom(wc, itensCol.map((c) => `${c}${lPkm}`), /ROUNDUP\(/));
  ok(`${nome}: km útil somado das rotas com SUMIF pelo código`, formulasCom(wc, itensCol.map((c) => `${c}${m.comp("Km útil faturável")}`), /^SUMIF\(Rotas!/));
  ok(`${nome}: supervisão rateada pelo km útil`, formulasCom(wc, itensCol.map((c) => `${c}${m.comp("Preposto / supervisão")}`), /Rotas!\$P\$/));
  ok(`${nome}: garagem decide reserva pela premissa S/N`, formulasCom(wc, itensCol.map((c) => `${c}${m.comp("Garagem")}`), /IF\(Premissas!\$B\$\d+="S"/));
  ok(`${nome}: custo total e total/lote são fórmulas`, formulasCom(wc, [...itensCol, m.colTotal].map((c) => `${c}${m.comp("CUSTO TOTAL")}`), /./));
  ok(`${nome}: preço proposto obedece ao critério (IF LOTE)`, formulasCom(wc, itensCol.map((c) => `${c}${m.comp("Preço proposto")}`), /IF\(Premissas!\$B\$\d+="LOTE"/));
  ok(`${nome}: preço do lote = ROUNDUP da média ponderada`, formulasCom(wc, [`${m.colTotal}${m.comp("Preço proposto")}`], /^ROUNDUP\(/));
  ok(`${nome}: tributos do total ponderados pelo faturamento`, formulasCom(wc, [`${m.colTotal}${m.comp("Tributos sobre faturamento")}`], /SUMPRODUCT\(/));

  const rotas = entrada.rotas.map((_, i) => 5 + i);
  ok(`${nome}: salários por rota com fator noturno`, formulasCom(wr, rotas.map((l) => `R${l}`), /IF\(K\d+="S"/));
  ok(`${nome}: diesel por rota ponderado asfalto/terra`, formulasCom(wr, rotas.map((l) => `S${l}`), /G\d+.*consumo|\(1-G\d+\)/i));
  ok(`${nome}: % terra por rota é fórmula`, formulasCom(wr, rotas.map((l) => `G${l}`), /F\d+\/E\d+/));
  ok(`${nome}: pedágio por rota = passagens × tarifa`, formulasCom(wr, rotas.map((l) => `O${l}`), /^M\d+\*N\d+$/));

  const entradaDiesel = ws.getCell(m.prem("Diesel"));
  ok(`${nome}: premissa (diesel) é número em azul`, typeof entradaDiesel.value === "number" && cor(entradaDiesel) === "FF0000FF");
  ok(`${nome}: custo financeiro é fórmula`, formulasCom(ws, [m.prem("Custo financeiro")], /\*.*\/30$/));
  ok(
    `${nome}: tributos de cada item são fórmula da parcela intermunicipal`,
    formulasCom(ws, entrada.itens.map((it) => m.prem(`Tributos médios — Item ${it.codigo}`)), /\(1-Premissas!\$B\$\d+\)/)
  );

  ok(`${nome}: preço de teste dos cenários é entrada`, typeof wz.getCell("B4").value === "number" && cor(wz.getCell("B4")) === "FF0000FF");
  conferir(`${nome}: utilizações no cabeçalho dos cenários`, Array.from({ length: m.cenColunas }, (_, j) => wz.getCell(6, j + 2).value), entrada.utilizacoesCenario ?? [0.6, 0.7, 0.8, 0.85, 0.9, 1]);
  const lLucro = m.cenLinha("Lucro líquido no");
  ok(
    `${nome}: lucro dos cenários é fórmula sobre o preço de teste`,
    formulasCom(wz, Array.from({ length: m.cenColunas }, (_, j) => `${letraColuna(j + 2)}${lLucro}`), /./) &&
      /\$B\$4/.test(formulaDe(wz.getCell(`B${m.cenLinha("Faturamento no")}`)) ?? "")
  );
  ok(`${nome}: ponto de equilíbrio é fórmula`, formulasCom(wz, [`B${m.cenLinha("Ponto de equilíbrio")}`], /^IF\(/));

  const itensProp = entrada.itens.map((_, i) => 10 + i);
  ok(`${nome}: preço proposto na Proposta é link verde da Composição`, itensProp.every((l) => /^'Composição de Custo'!/.test(formulaDe(wp.getCell(`E${l}`)) ?? "") && cor(wp.getCell(`E${l}`)) === "FF008000"));
  ok(`${nome}: valor total na Proposta é fórmula`, itensProp.every((l) => formulaDe(wp.getCell(`F${l}`)) === `C${l}*E${l}`));

  let naoArial = 0;
  for (const w of wb.worksheets) w.eachRow((row) => row.eachCell((c) => void (c.font?.name && c.font.name !== "Arial" && naoArial++)));
  conferir(`${nome}: fonte Arial em todas as células`, naoArial, 0);
}

// ---------------------------------------------------------------- recálculo × motor

function conferirNumeros(nome: string, motor: string, m: Mapa, v: Valores, r: ResultadoSimulacao, entrada: EntradaSimulacao) {
  const comp = v["COMPOSIÇÃO DE CUSTO"] ?? {};
  const cen = v["CENÁRIOS"] ?? {};
  const prop = v["PROPOSTA"] ?? {};
  const pre = `${nome} [${motor}]`;
  const L = {
    pkm: m.comp("PREÇO/KM CALCULADO"),
    tot: m.comp("CUSTO TOTAL"),
    kmfat: m.comp("Km útil faturável"),
    fat: m.comp("Faturamento no"),
    lucm: m.comp("Lucro líquido no"),
    trb: m.comp("Tributos sobre faturamento"),
    pprop: m.comp("Preço proposto"),
    lucp: m.comp("Lucro líquido no " + (r.modo === "MENSAL" ? "mês" : "período") + " ao preço proposto"),
  };
  r.itens.forEach((it, i) => {
    const c = m.colItem(i);
    perto("preço/km por item", `${pre} item ${it.item}: preço/km`, comp[`${c}${L.pkm}`], it.precoKm, PRECO);
    perto("custo total por item", `${pre} item ${it.item}: custo total`, comp[`${c}${L.tot}`], it.custoTotal, TOTAL);
    perto("km útil por item", `${pre} item ${it.item}: km útil`, comp[`${c}${L.kmfat}`], it.kmUtil, TOTAL);
    perto("lucro por item", `${pre} item ${it.item}: lucro`, comp[`${c}${L.lucm}`], it.lucro, TOTAL);
  });
  const T = m.colTotal;
  perto("totais", `${pre} total: custo`, comp[`${T}${L.tot}`], r.totais.custoTotal, TOTAL);
  perto("totais", `${pre} total: faturamento`, comp[`${T}${L.fat}`], r.totais.faturamento, TOTAL);
  perto("totais", `${pre} total: lucro`, comp[`${T}${L.lucm}`], r.totais.lucro, TOTAL);
  perto("totais", `${pre} total: km útil`, comp[`${T}${L.kmfat}`], r.totais.kmUtil, TOTAL);

  // Preço único (lote) ou, no julgamento por item, a média ponderada
  // arredondada — o preço padrão dos cenários no motor.
  const precoUnico = r.lote ? r.lote.precoProposta : arredondarParaCima(r.totais.kmUtil > 0 ? r.totais.faturamento / r.totais.kmUtil : 0, 2);
  perto("preço do lote", `${pre} ${r.lote ? "lote: preço da proposta" : "média ponderada arredondada"}`, comp[`${T}${L.pprop}`], precoUnico, PRECO);
  if (r.lote) {
    perto("preço do lote", `${pre} lote: preço médio ponderado`, comp[`${T}${L.pkm}`], r.lote.precoKm, PRECO);
    perto("tributos ponderados", `${pre} lote: tributos ponderados`, comp[`${T}${L.trb}`], r.lote.tributosPct, { tipo: "abs", valor: 1e-9 });
    perto("lucro ao preço do lote", `${pre} lote: lucro ao preço da proposta`, comp[`${T}${L.lucp}`], r.lote.lucroAoPrecoProposta, REAL);
    r.itens.forEach((it, i) => perto("preço do lote", `${pre} item ${it.item}: proposta usa o preço do lote`, comp[`${m.colItem(i)}${L.pprop}`], r.lote!.precoProposta, PRECO));
  } else {
    r.itens.forEach((it, i) => perto("preço/km por item", `${pre} item ${it.item}: proposta usa o preço do item`, comp[`${m.colItem(i)}${L.pprop}`], it.precoKm, PRECO));
  }

  // Cenários.
  perto("cenários", `${pre} cenários: preço de teste`, cen["B4"], r.cenarios.precoTesteKm, PRECO);
  const lc = {
    custo: m.cenLinha("Custo total no"),
    alvo: m.cenLinha("Preço/km p/ lucro alvo"),
    lucro: m.cenLinha("Lucro líquido no"),
    ano: m.cenLinha("Lucro líquido / ano"),
    veic: m.cenLinha("Lucro / veículo / mês"),
    pe: m.cenLinha("Ponto de equilíbrio"),
  };
  r.cenarios.linhas.forEach((linha, j) => {
    const c = letraColuna(j + 2);
    const u = `${Math.round(linha.utilizacao * 100)}%`;
    perto("lucro dos cenários", `${pre} cenário ${u}: lucro`, cen[`${c}${lc.lucro}`], linha.lucro, REAL);
    perto("custo dos cenários", `${pre} cenário ${u}: custo total`, cen[`${c}${lc.custo}`], linha.custoTotal, TOTAL);
    perto("preço dos cenários", `${pre} cenário ${u}: preço p/ lucro alvo`, cen[`${c}${lc.alvo}`], linha.precoLucroAlvoKm, PRECO);
    perto("lucro dos cenários", `${pre} cenário ${u}: lucro/ano`, cen[`${c}${lc.ano}`], linha.lucroAno, REAL);
    perto("lucro dos cenários", `${pre} cenário ${u}: lucro/veículo/mês`, cen[`${c}${lc.veic}`], linha.lucroVeiculoMes, REAL);
  });
  const pe = cen[`B${lc.pe}`];
  if (r.cenarios.pontoEquilibrio === null) conferir(`${pre} ponto de equilíbrio: não empata`, pe, "não empata");
  else perto("ponto de equilíbrio", `${pre} ponto de equilíbrio`, pe, r.cenarios.pontoEquilibrio, { tipo: "abs", valor: 1e-6 });

  // Proposta: quantidade × preço proposto.
  const fatorAno = r.modo === "MENSAL" ? entrada.premissas.contrato.vigenciaMeses : 1;
  const precoProp = (i: number) => (r.lote ? r.lote.precoProposta : r.itens[i].precoKm);
  const valorProposta = r.itens.reduce((a, it, i) => a + it.kmUtil * fatorAno * precoProp(i), 0);
  perto("totais", `${pre} proposta: valor total`, prop[m.propTotal], valorProposta, TOTAL);
}

// ---------------------------------------------------------------- execução

(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "teste-exportar-xlsx-"));
  try {
    console.log(`Planilhas em ${dir}`);
    console.log(`Motores de recálculo: ${motores.map((m) => m.nome).join(", ") || "nenhum"}`);
    ok(
      "há um motor de recálculo disponível (LibreOffice ou Python formulas)",
      motores.length > 0,
      "instale o LibreOffice (soffice) ou `pip install formulas` — sem recálculo o teste não prova nada"
    );

    // Casos: as duas simulações históricas e, para cada uma, uma versão com
    // premissas mudadas DENTRO da planilha.
    type Caso = { nome: string; arquivo: string; mapa: Mapa; resultado: ResultadoSimulacao; entrada: EntradaSimulacao };
    const casos: Caso[] = [];
    const historicos: [string, SimulacaoHistorica][] = [
      ["Holambra", historicoHolambra()],
      ["SJP", historicoSaoJoseDosPinhais()],
    ];

    for (const [nome, h] of historicos) {
      console.log(`\n${nome.toUpperCase()} — ${h.edital.numero} — estrutura`);
      const { buffer, resultado } = await gerar(h);
      const arquivo = path.join(dir, `${nome}.xlsx`);
      writeFileSync(arquivo, buffer);
      const mapa = await mapear(buffer);
      conferirEstrutura(nome, mapa, h.entrada);
      casos.push({ nome, arquivo, mapa, resultado, entrada: h.entrada });

      // Premissas mudadas na planilha, e a mesma mudança na entrada do motor.
      const e: EntradaSimulacao = structuredClone(h.entrada);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
      const ws = wb.getWorksheet("Premissas")!;
      const wr = wb.getWorksheet("Rotas")!;
      const mudar = (rotulo: string, valor: number | string) => (ws.getCell(mapa.prem(rotulo)).value = valor);
      e.premissas.variaveis.dieselLitro *= 1.1;
      mudar("Diesel", e.premissas.variaveis.dieselLitro);
      e.premissas.pessoal.fatorJornadaNoturna = 1.5;
      mudar("Fator de jornada noturna", 1.5);
      e.rotas[1].noturno = !e.rotas[1].noturno;
      wr.getCell("K6").value = e.rotas[1].noturno ? "S" : "N";
      e.rotas[0].kmTerraDia = e.rotas[0].kmDia * 0.5;
      wr.getCell("F5").value = e.rotas[0].kmTerraDia;
      e.premissas.variaveis.consumoTerraKmL = 2;
      mudar("Consumo em terra", 2);
      e.premissas.contrato.utilizacao = 0.7;
      mudar("Utilização esperada", 0.7);
      e.premissas.veiculo.garagemComReserva = !e.premissas.veiculo.garagemComReserva;
      mudar("Garagem cobrada também", e.premissas.veiculo.garagemComReserva ? "S" : "N");
      e.premissas.pessoal.supervisaoMes = 5000;
      mudar("Preposto / supervisão", 5000);
      e.itens[0].shareIntermunicipal = 0.5;
      e.premissas.preco.icms = 0.12;
      mudar(`Parcela intermunicipal do faturamento — Item ${e.itens[0].codigo}`, 0.5);
      mudar("ICMS", 0.12);
      e.precoTesteKm = 12.34;
      wb.getWorksheet("Cenários")!.getCell("B4").value = 12.34;
      const arquivoMudado = path.join(dir, `${nome}-premissas-mudadas.xlsx`);
      await wb.xlsx.writeFile(arquivoMudado);
      const mudado = simular(e);
      ok(
        `${nome}: as mudanças de premissa mexem no resultado (senão o recálculo não provaria nada)`,
        Math.abs(mudado.totais.custoTotal - resultado.totais.custoTotal) > 1 && mudado.itens.some((it, i) => it.precoKm !== resultado.itens[i].precoKm)
      );
      casos.push({ nome: `${nome} c/ premissas mudadas na planilha`, arquivo: arquivoMudado, mapa, resultado: mudado, entrada: e });
    }

    for (const motor of motores) {
      console.log(`\nRECÁLCULO PELO ${motor.nome.toUpperCase()} × simular()`);
      const valores = await motor.recalcular(
        casos.map((c) => c.arquivo),
        dir
      );
      casos.forEach((c, k) => conferirNumeros(c.nome, motor.nome, c.mapa, valores[k], c.resultado, c.entrada));
    }

    console.log("\nMaiores diferenças planilha × motor:");
    for (const [g, { dif, onde }] of Object.entries(maiores)) console.log(`  ${g.padEnd(24)} ${dif.toExponential(3)}  (${onde})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
  process.exit(falhas === 0 ? 0 : 1);
})();
