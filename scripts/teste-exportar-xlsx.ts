// TESTES DA EXPORTAÇÃO EXCEL DO SIMULADOR — `npm run teste:exportar-xlsx`.
//
// A planilha exportada (src/lib/simulador/exportarXlsx.ts) só vale se as suas
// FÓRMULAS derem os mesmos números do motor. Este teste:
//   1. gera a planilha das duas simulações históricas (Holambra e SJP) e de
//      variações delas que exercitam cada recurso do motor — unidades de preço
//      (veículo-mês, diária, hora, binômia), perfis de veículo, item sem
//      motorista, combustível do cliente, depreciação linear e soma dos
//      dígitos com idade e valor médio, capital composto, adaptações,
//      manutenção fixa, implantação, horas extras e noturnas em horas (com o
//      adicional noturno), despesas sobre o preço, tributos da locação sem
//      motorista e Lucro Real (com a base do IR somando capital próprio e
//      contingência);
//   2. confere a estrutura: as abas na ordem, fórmulas (e não valores) nas
//      células-chave, entradas em azul, links em verde, fonte Arial;
//   3. RECALCULA as fórmulas com um motor de planilha independente e compara
//      com `simular()`: preços por unidade (R$ 0,01), custos, faturamento e
//      lucro (0,1%), lote, cenários (R$ 1) e ponto de equilíbrio;
//   4. muda premissas NA PLANILHA (diesel, utilização, fator noturno, unidade,
//      valor de um perfil...), recalcula de novo e compara com `simular()` da
//      entrada alterada — prova de que a conta está nas fórmulas.
//
// Motores de recálculo: LibreOffice headless (`soffice --convert-to xlsx`
// recalcula ao abrir, porque o exportador não grava valores nas fórmulas; os
// valores são lidos com openpyxl) e o
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
import { PERFIS_PADRAO } from "../src/lib/simulador/premissas";
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
let comparacoes = 0;
type Tolerancia = { tipo: "abs"; valor: number } | { tipo: "rel"; valor: number };
function perto(grandeza: string, nome: string, real: unknown, alvo: number, tol: Tolerancia) {
  comparacoes++;
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
const PCT_: Tolerancia = { tipo: "abs", valor: 1e-6 };

// ---------------------------------------------------------------- motores de recálculo

type Valores = Record<string, Record<string, unknown>>; // ABA (maiúsculas) → endereço → valor
type Motor = { nome: string; recalcular: (arquivos: string[], dir: string) => Promise<Valores[]> };

const tem = (cmd: string, args: string[]) => {
  const r = spawnSync(cmd, args, { stdio: "ignore" });
  return !r.error && r.status === 0;
};

// Valores gravados por um motor (LibreOffice) ou calculados pelo `formulas`,
// num JSON {"ABA": {"B12": valor}} — ver scripts/recalcular-xlsx.py.
function pelaPython(args: string[], json: string): Valores {
  const r = spawnSync("python3", [path.join(__dirname, "recalcular-xlsx.py"), ...args, json], { encoding: "utf8", timeout: 600_000 });
  if (r.status !== 0) throw new Error(`recalcular-xlsx.py falhou: ${r.stderr}`);
  return JSON.parse(readFileSync(json, "utf8")) as Valores;
}

const motores: Motor[] = [];
const soffice = ["soffice", "libreoffice"].find((c) => tem(c, ["--version"]));
if (soffice && tem("python3", ["-c", "import openpyxl"])) {
  motores.push({
    nome: "LibreOffice",
    recalcular: async (arquivos, dir) => {
      const saida = path.join(dir, "libreoffice");
      const perfil = `file://${path.join(dir, "perfil-lo")}`;
      const r = spawnSync(soffice, [`-env:UserInstallation=${perfil}`, "--headless", "--calc", "--convert-to", "xlsx", "--outdir", saida, ...arquivos], {
        encoding: "utf8",
        timeout: 600_000,
      });
      if (r.status !== 0) throw new Error(`LibreOffice falhou: ${r.stderr || r.error}`);
      return arquivos.map((a) => {
        const recalculada = path.join(saida, path.basename(a));
        return pelaPython(["--ler", recalculada], recalculada.replace(/\.xlsx$/, ".json"));
      });
    },
  });
}
if (tem("python3", ["-c", "import formulas"])) {
  motores.push({
    nome: "Python formulas",
    recalcular: async (arquivos) => arquivos.map((a) => pelaPython([a], a.replace(/\.xlsx$/, ".formulas.json"))),
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
  perfilCel: (rotulo: string, codigo: string) => string; // endereço na aba Perfis
  rotaCol: (cabecalho: string) => string; // letra da coluna na aba Rotas
  cenLinha: (rotulo: string) => number;
  cenColunas: number;
  propTotal: string;
};

function linhaPorRotulo(ws: ExcelJS.Worksheet, rotulo: string, col = 1): number {
  let achada = 0;
  ws.eachRow((row, n) => {
    const a = row.getCell(col).value;
    if (!achada && typeof a === "string" && a.trim().startsWith(rotulo)) achada = n;
  });
  if (!achada) throw new Error(`Rótulo "${rotulo}" não encontrado na aba ${ws.name}.`);
  return achada;
}
function colunaPorCabecalho(ws: ExcelJS.Worksheet, linha: number, texto: string): string {
  const row = ws.getRow(linha);
  for (let c = 1; c <= row.cellCount; c++) {
    const v = row.getCell(c).value;
    if (typeof v === "string" && v.startsWith(texto)) return letraColuna(c);
  }
  throw new Error(`Cabeçalho "${texto}" não encontrado na aba ${ws.name}.`);
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
  const wf = wb.getWorksheet("Perfis de Veículo")!;
  return {
    wb,
    nItens,
    colItem: (i) => letraColuna(i + 2),
    colTotal: letraColuna(nItens + 2),
    comp: (r) => linhaPorRotulo(wc, r),
    prem: (r) => `B${linhaPorRotulo(wb.getWorksheet("Premissas")!, r)}`,
    perfilCel: (r, codigo) => `${colunaPorCabecalho(wf, 4, codigo)}${linhaPorRotulo(wf, r)}`,
    rotaCol: (t) => colunaPorCabecalho(wb.getWorksheet("Rotas")!, 4, t),
    cenLinha: (r) => linhaPorRotulo(wz, r),
    cenColunas,
    propTotal: `H${linhaPorRotulo(wb.getWorksheet("Proposta")!, "VALOR TOTAL DA PROPOSTA", 2)}`,
  };
}

const formulaDe = (c: ExcelJS.Cell): string | null => {
  const v = c.value as unknown;
  return v !== null && typeof v === "object" && "formula" in v ? String((v as { formula: string }).formula) : null;
};
const cor = (c: ExcelJS.Cell) => c.font?.color?.argb ?? null;

async function gerar(h: SimulacaoHistorica, entrada: EntradaSimulacao): Promise<Buffer> {
  return gerarPlanilhaSimulacao({
    edital: h.edital,
    licitante: { razaoSocial: "AZUL TRANSPORTES E TURISMO LTDA", cnpj: "10.764.533/0001-01", endereco: null, representante: null },
    regras: h.regras,
    entrada,
    resultado: simular(entrada),
    versao: 3,
    geradoEm: new Date("2026-09-30T12:00:00Z"),
  });
}

// ---------------------------------------------------------------- estrutura

function conferirEstrutura(nome: string, m: Mapa, entrada: EntradaSimulacao) {
  const { wb } = m;
  conferir(`${nome}: abas na ordem`, wb.worksheets.map((w) => w.name), [...ABAS]);
  conferir(`${nome}: uma coluna por item na Composição`, m.nItens, entrada.itens.length);
  const wc = wb.getWorksheet("Composição de Custo")!;
  const wr = wb.getWorksheet("Rotas")!;
  const ws = wb.getWorksheet("Premissas")!;
  const wf = wb.getWorksheet("Perfis de Veículo")!;
  const wz = wb.getWorksheet("Cenários")!;
  const wp = wb.getWorksheet("Proposta")!;

  const formulasCom = (ws2: ExcelJS.Worksheet, enderecos: string[], trecho: RegExp) =>
    enderecos.every((e) => {
      const f = formulaDe(ws2.getCell(e));
      return f !== null && trecho.test(f);
    });
  const itensCol = Array.from({ length: m.nItens }, (_, i) => m.colItem(i));
  const naComp = (rotulo: string, cols = itensCol) => cols.map((c) => `${c}${m.comp(rotulo)}`);
  ok(`${nome}: preço/km de cada item é fórmula com ROUNDUP`, formulasCom(wc, naComp("PREÇO/KM CALCULADO"), /ROUNDUP\(/));
  ok(`${nome}: preços por veículo-mês, diária e binômia com ROUNDUP`, ["Preço por veículo-mês", "Preço por diária", "Binômia — parcela fixa", "Binômia — parcela por km"].every((r) => formulasCom(wc, naComp(r), /ROUNDUP\(/)));
  ok(`${nome}: km útil somado das rotas com SUMIF pelo código`, formulasCom(wc, naComp("Km útil faturável"), /^SUMIF\(Rotas!/));
  ok(`${nome}: supervisão só entre itens com motorista`, formulasCom(wc, naComp("Preposto / supervisão"), /SUMIF\(.*"S"/));
  ok(`${nome}: diesel do item obedece ao combustível do cliente`, formulasCom(wc, naComp("Diesel"), /^IF\(.*="S",0,SUMIF/));
  ok(`${nome}: salários do item zeram sem motorista`, formulasCom(wc, naComp("Salários"), /^IF\(.*="S",SUMIF/));
  ok(`${nome}: faturamento segue a unidade de preço`, formulasCom(wc, naComp("Faturamento no"), /"BINOMIA".*"KM".*"VEICULO_MES"/));
  ok(`${nome}: crédito de PIS/COFINS é fórmula`, formulasCom(wc, naComp("Crédito de PIS/COFINS"), /Premissas!\$B\$\d+/));
  ok(`${nome}: IR sobre o lucro só quando positivo`, formulasCom(wc, naComp("IRPJ/CSLL sobre o lucro"), /^IF\(.*>0/));
  ok(`${nome}: base do IR = lucro antes do IR + não dedutíveis`, formulasCom(wc, naComp("Base do IRPJ/CSLL"), /^[A-Z]+\d+\+[A-Z]+\d+$/));
  ok(`${nome}: não dedutíveis = capital próprio × meses + contingência`, formulasCom(wc, naComp("Não dedutíveis"), /\*Premissas!\$B\$\d+\+.*\*Premissas!\$B\$\d+$/));
  ok(`${nome}: preços cobrem o custo a cobrir (com o IR dos não dedutíveis)`, formulasCom(wc, naComp("Preço por veículo-mês"), new RegExp(`[A-Z]+${m.comp("Custo a cobrir no preço")}/`)));
  ok(`${nome}: custo total e total/lote são fórmulas`, formulasCom(wc, naComp("CUSTO TOTAL", [...itensCol, m.colTotal]), /./));
  ok(`${nome}: preço proposto obedece ao critério (IF LOTE)`, formulasCom(wc, naComp("Preço proposto na unidade"), /IF\(Premissas!\$B\$\d+="LOTE"/));
  ok(`${nome}: preço único por km = ROUNDUP da média ponderada`, formulasCom(wc, naComp("Preço único por km", [m.colTotal]), /^ROUNDUP\(/));
  ok(`${nome}: tributos do total ponderados pelo faturamento`, formulasCom(wc, naComp("Tributos sobre faturamento", [m.colTotal]), /SUMPRODUCT\(/));

  const rotas = entrada.rotas.map((_, i) => 5 + i);
  const naRota = (cab: string) => rotas.map((l) => `${m.rotaCol(cab)}${l}`);
  ok(`${nome}: perfil da rota achado com MATCH na aba Perfis`, formulasCom(wr, naRota("Coluna do perfil"), /^IFERROR\(MATCH\(.*'Perfis de Veículo'!/));
  ok(
    `${nome}: salários por rota com salário do perfil, noturno e horas`,
    formulasCom(wr, naRota("Salários"), /INDEX\('Perfis de Veículo'.*IF\([A-Z]+\d+="S".*1\.5\+.*\*2\+Premissas!\$B\$\d+\*Premissas!\$B\$\d+\)/)
  );
  ok(`${nome}: hora noturna custa só o adicional com a hora reduzida`, formulasCom(ws, [m.prem("Custo a mais por hora noturna")], /^\(1\+Premissas!\$B\$\d+\)\*60\/52\.5-1$/));
  ok(`${nome}: capital próprio por rota vem do perfil`, formulasCom(wr, naRota("Capital próprio"), /INDEX\('Perfis de Veículo'/));
  ok(`${nome}: diesel por rota com consumo do perfil e asfalto/terra`, formulasCom(wr, naRota("Diesel"), /INDEX\('Perfis de Veículo'.*\(1-[A-Z]+\d+\)/));
  ok(`${nome}: depreciação da rota vem do perfil`, formulasCom(wr, naRota("Depreciação"), /INDEX\('Perfis de Veículo'/));
  ok(`${nome}: % terra por rota é fórmula`, formulasCom(wr, naRota("% terra"), /\/[A-Z]+\d+/));

  const entradaDiesel = ws.getCell(m.prem("Diesel"));
  ok(`${nome}: premissa (diesel) é número em azul`, typeof entradaDiesel.value === "number" && cor(entradaDiesel) === "FF0000FF");
  ok(`${nome}: custo financeiro é fórmula`, formulasCom(ws, [m.prem("Custo financeiro")], /\*.*\/30$/));
  ok(
    `${nome}: tributos de cada item são fórmula da parcela intermunicipal`,
    formulasCom(ws, entrada.itens.map((it) => m.prem(`Tributos médios — Item ${it.codigo}`)), /\(1-Premissas!\$B\$\d+\)/)
  );
  ok(
    `${nome}: tributos do item sem motorista são os da locação`,
    formulasCom(ws, entrada.itens.map((it) => m.prem(`Tributos médios — Item ${it.codigo}`)), /^IF\(Premissas!\$B\$\d+="S",.*,Premissas!\$B\$\d+\)$/) &&
      formulasCom(ws, [m.prem("Tributos totais — locação")], /IF\(Premissas!\$B\$\d+=0,/)
  );
  const padraoValor = wf.getCell(m.perfilCel("Valor do veículo", "PADRÃO"));
  ok(`${nome}: perfil padrão é link verde das Premissas`, /^Premissas!/.test(formulaDe(padraoValor) ?? "") && cor(padraoValor) === "FF008000");
  ok(`${nome}: depreciação ano a ano é fórmula por método`, formulasCom(wf, [m.perfilCel("Depreciação no ano 1", "PADRÃO")], /"PERCENTUAL".*"LINEAR"/));
  ok(`${nome}: taxa de capital composta é fórmula`, formulasCom(wf, [m.perfilCel("Taxa de capital aplicada", "PADRÃO")], /="S"/));

  ok(`${nome}: preço de teste dos cenários é entrada`, typeof wz.getCell("B4").value === "number" && cor(wz.getCell("B4")) === "FF0000FF");
  conferir(`${nome}: utilizações no cabeçalho dos cenários`, Array.from({ length: m.cenColunas }, (_, j) => wz.getCell(6, j + 2).value), entrada.utilizacoesCenario ?? [0.6, 0.7, 0.8, 0.85, 0.9, 1]);
  const lLucro = m.cenLinha("Lucro líquido no");
  ok(`${nome}: lucro dos cenários é fórmula`, formulasCom(wz, Array.from({ length: m.cenColunas }, (_, j) => `${letraColuna(j + 2)}${lLucro}`), /./));
  ok(`${nome}: faturamento fixo dos cenários usa o preço de teste`, formulasCom(wz, [`B${m.cenLinha("Faturamento fixo")}`], /\$B\$4/));
  ok(`${nome}: ponto de equilíbrio e tipo são fórmulas`, formulasCom(wz, [`B${m.cenLinha("Ponto de equilíbrio")}`, `B${m.cenLinha("Tipo do equilíbrio")}`], /^IF\(/));

  const itensProp = entrada.itens.map((_, i) => 10 + i);
  ok(`${nome}: preço proposto na Proposta é link verde da Composição`, itensProp.every((l) => /^'Composição de Custo'!/.test(formulaDe(wp.getCell(`F${l}`)) ?? "") && cor(wp.getCell(`F${l}`)) === "FF008000"));
  ok(`${nome}: valor total na Proposta é fórmula`, itensProp.every((l) => /^'Composição de Custo'!/.test(formulaDe(wp.getCell(`H${l}`)) ?? "")));

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
  const ap = r.modo === "MENSAL" ? "mês" : "período";
  const L = {
    pkm: m.comp("PREÇO/KM CALCULADO"),
    pvm: m.comp("Preço por veículo-mês"),
    pd: m.comp("Preço por diária"),
    ph: m.comp("Preço por hora"),
    bfix: m.comp("Binômia — parcela fixa"),
    bvar: m.comp("Binômia — parcela por km"),
    pUn: m.comp("PREÇO NA UNIDADE"),
    peq: m.comp("Preço por km equivalente"),
    qtdU: m.comp("Quantidade na unidade"),
    tot: m.comp("CUSTO TOTAL"),
    kmfat: m.comp("Km útil faturável"),
    sup: m.comp("Preposto / supervisão"),
    impl: m.comp("Implantação amortizada"),
    sal: m.comp("Salários"),
    veicm: m.comp("Subtotal veículos"),
    die: m.comp("Diesel"),
    cred: m.comp("Crédito de PIS/COFINS"),
    fat: m.comp(`Faturamento no ${ap} ao preço calculado`),
    lair: m.comp("Lucro antes do IRPJ/CSLL"),
    lucm: m.comp(`Lucro líquido no ${ap}`),
    trb: m.comp("Tributos sobre faturamento"),
    ppkm: m.comp("Preço único por km"),
    ppropU: m.comp("Preço proposto na unidade"),
    lucp: m.comp(`Lucro líquido no ${ap} ao preço proposto`),
  };
  r.itens.forEach((it, i) => {
    const c = m.colItem(i);
    const g = (l: number) => comp[`${c}${l}`];
    const nomeItem = `${pre} item ${it.item}`;
    perto("preço por unidade", `${nomeItem}: preço/km`, g(L.pkm), it.indicadores.km.preco, PRECO);
    perto("preço por unidade", `${nomeItem}: preço/veículo-mês`, g(L.pvm), it.indicadores.veiculoMes.preco, PRECO);
    perto("preço por unidade", `${nomeItem}: preço/diária`, g(L.pd), it.indicadores.diaria.preco, PRECO);
    if (it.indicadores.hora) perto("preço por unidade", `${nomeItem}: preço/hora`, g(L.ph), it.indicadores.hora.preco, PRECO);
    else conferir(`${nomeItem}: sem horas/dia, sem preço por hora`, g(L.ph), "");
    perto("preço por unidade", `${nomeItem}: binômia fixo/veículo-mês`, g(L.bfix), it.indicadores.binomia.fixoVeiculoMes, PRECO);
    perto("preço por unidade", `${nomeItem}: binômia por km`, g(L.bvar), it.indicadores.binomia.variavelKm, PRECO);
    perto("preço por unidade", `${nomeItem}: preço na unidade do contrato`, g(L.pUn), it.precoUnidade, PRECO);
    perto("preço por unidade", `${nomeItem}: preço/km equivalente`, g(L.peq), it.precoKm, PRECO);
    perto("quantidades", `${nomeItem}: quantidade na unidade`, g(L.qtdU), it.quantidadeUnidade, TOTAL);
    perto("custos por item", `${nomeItem}: custo total`, g(L.tot), it.custoTotal, TOTAL);
    perto("custos por item", `${nomeItem}: salários`, g(L.sal), it.salarios, TOTAL);
    perto("custos por item", `${nomeItem}: supervisão`, g(L.sup), it.supervisao, TOTAL);
    perto("custos por item", `${nomeItem}: implantação/mês`, g(L.impl), it.implantacaoMes, TOTAL);
    perto("custos por item", `${nomeItem}: veículo/mês`, g(L.veicm), it.veiculoMes, TOTAL);
    perto("custos por item", `${nomeItem}: diesel`, g(L.die), it.diesel, TOTAL);
    perto("custos por item", `${nomeItem}: crédito PIS/COFINS`, g(L.cred), it.creditoPisCofins, TOTAL);
    perto("faturamento e lucro por item", `${nomeItem}: faturamento`, g(L.fat), it.faturamento, TOTAL);
    perto("faturamento e lucro por item", `${nomeItem}: lucro antes do IR`, g(L.lair), it.lucroAntesIr, TOTAL);
    perto("faturamento e lucro por item", `${nomeItem}: lucro`, g(L.lucm), it.lucro, TOTAL);
    const pprop = r.lote ? r.lote.precoPropostaUnidade : it.precoUnidade;
    perto("preço do lote / proposta", `${nomeItem}: preço proposto`, g(L.ppropU), pprop, PRECO);
  });
  const T = m.colTotal;
  const gt = (l: number) => comp[`${T}${l}`];
  perto("totais", `${pre} total: custo`, gt(L.tot), r.totais.custoTotal, TOTAL);
  perto("totais", `${pre} total: faturamento`, gt(L.fat), r.totais.faturamento, TOTAL);
  perto("totais", `${pre} total: lucro`, gt(L.lucm), r.totais.lucro, TOTAL);
  perto("totais", `${pre} total: km útil`, gt(L.kmfat), r.totais.kmUtil, TOTAL);

  // Preço único: o do lote ou, no julgamento por item, o padrão dos cenários.
  const km = r.totais.kmUtil;
  const qtd = r.itens.reduce((a, i) => a + i.quantidadeUnidade, 0);
  const precoPadrao =
    r.unidade === "BINOMIA"
      ? arredondarParaCima(km > 0 ? r.itens.reduce((a, i) => a + i.indicadores.binomia.variavelKm * i.kmUtil, 0) / km : 0, 2)
      : arredondarParaCima(qtd > 0 ? r.totais.faturamento / qtd : 0, 2);
  perto("preço do lote / proposta", `${pre} preço único na unidade`, gt(L.ppropU), r.lote ? r.lote.precoPropostaUnidade : precoPadrao, PRECO);
  if (r.lote) {
    perto("preço do lote / proposta", `${pre} lote: preço único por km`, gt(L.ppkm), r.lote.precoProposta, PRECO);
    perto("preço do lote / proposta", `${pre} lote: preço médio ponderado por km`, gt(L.pkm), r.lote.precoKm, PRECO);
    perto("preço do lote / proposta", `${pre} lote: preço médio na unidade`, gt(L.pUn), r.lote.precoUnidade, PRECO);
    perto("tributos ponderados", `${pre} lote: tributos ponderados`, gt(L.trb), r.lote.tributosPct, { tipo: "abs", valor: 1e-9 });
    perto("lucro ao preço do lote", `${pre} lote: lucro ao preço da proposta`, gt(L.lucp), r.lote.lucroAoPrecoProposta, REAL);
  }

  // Cenários.
  perto("cenários", `${pre} cenários: preço de teste`, cen["B4"], r.cenarios.precoTesteKm, PRECO);
  const lc = {
    custo: m.cenLinha("Custo total no"),
    alvo: m.cenLinha("Preço/km p/ lucro alvo"),
    zero: m.cenLinha("Preço/km lucro zero"),
    fat: m.cenLinha("Faturamento no"),
    lucro: m.cenLinha("Lucro líquido no"),
    ano: m.cenLinha("Lucro líquido / ano"),
    veic: m.cenLinha("Lucro / veículo / mês"),
    pe: m.cenLinha("Ponto de equilíbrio"),
    tipo: m.cenLinha("Tipo do equilíbrio"),
  };
  r.cenarios.linhas.forEach((linha, j) => {
    const c = letraColuna(j + 2);
    const u = `${Math.round(linha.utilizacao * 100)}%`;
    perto("lucro dos cenários", `${pre} cenário ${u}: lucro`, cen[`${c}${lc.lucro}`], linha.lucro, REAL);
    perto("lucro dos cenários", `${pre} cenário ${u}: lucro/ano`, cen[`${c}${lc.ano}`], linha.lucroAno, REAL);
    perto("lucro dos cenários", `${pre} cenário ${u}: lucro/veículo/mês`, cen[`${c}${lc.veic}`], linha.lucroVeiculoMes, REAL);
    perto("custo e faturamento dos cenários", `${pre} cenário ${u}: custo total`, cen[`${c}${lc.custo}`], linha.custoTotal, TOTAL);
    perto("custo e faturamento dos cenários", `${pre} cenário ${u}: faturamento`, cen[`${c}${lc.fat}`], linha.faturamento, TOTAL);
    perto("preço dos cenários", `${pre} cenário ${u}: preço p/ lucro alvo`, cen[`${c}${lc.alvo}`], linha.precoLucroAlvoKm, PRECO);
    perto("preço dos cenários", `${pre} cenário ${u}: preço lucro zero`, cen[`${c}${lc.zero}`], linha.precoLucroZeroKm, PRECO);
  });
  const pe = cen[`B${lc.pe}`];
  if (r.cenarios.pontoEquilibrio === null) conferir(`${pre} ponto de equilíbrio: não empata`, pe, "não empata");
  else perto("ponto de equilíbrio", `${pre} ponto de equilíbrio`, pe, r.cenarios.pontoEquilibrio, PCT_);
  conferir(`${pre} tipo do equilíbrio`, cen[`B${lc.tipo}`], r.cenarios.tipoEquilibrio === "MINIMA" ? "MÍNIMA" : "MÁXIMA");

  // Proposta: faturamento ao preço proposto × anualização.
  const fatorAno = r.modo === "MENSAL" ? entrada.premissas.contrato.vigenciaMeses : 1;
  const fatProposto = (i: number) => {
    const it = r.itens[i];
    if (!r.lote) return it.faturamento;
    if (r.unidade === "KM") return r.lote.precoProposta * it.kmUtil;
    if (r.unidade === "BINOMIA") return it.faturamento;
    return r.lote.precoPropostaUnidade * it.quantidadeUnidade;
  };
  const valorProposta = r.itens.reduce((a, _it, i) => a + fatProposto(i), 0) * fatorAno;
  perto("totais", `${pre} proposta: valor total`, prop[m.propTotal], valorProposta, TOTAL);
}

// ---------------------------------------------------------------- cenários de teste

type Caso = { nome: string; historico: SimulacaoHistorica; entrada: EntradaSimulacao };
const clone = <T>(x: T): T => structuredClone(x);
const HOL = historicoHolambra();
const SJP = historicoSaoJoseDosPinhais();
const variar = (nome: string, h: SimulacaoHistorica, mudar: (e: EntradaSimulacao) => void): Caso => {
  const e = clone(h.entrada);
  mudar(e);
  return { nome, historico: h, entrada: e };
};
const perfisPadrao = () => clone(PERFIS_PADRAO);

const casos: Caso[] = [
  { nome: "Holambra", historico: HOL, entrada: HOL.entrada },
  { nome: "SJP", historico: SJP, entrada: SJP.entrada },
  variar("SJP veículo-mês", SJP, (e) => {
    e.unidadePreco = "VEICULO_MES";
    e.precoTesteKm = null;
  }),
  variar("SJP hora (uma rota sem horas/dia)", SJP, (e) => {
    e.unidadePreco = "HORA";
    e.precoTesteKm = null;
    e.rotas.forEach((r, i) => (r.horasDia = r.item === "1" ? 13 : i === 6 ? null : 10));
  }),
  variar("SJP binômia", SJP, (e) => {
    e.unidadePreco = "BINOMIA";
    e.precoTesteKm = null;
  }),
  variar("Holambra diária", HOL, (e) => {
    e.unidadePreco = "DIARIA";
  }),
  variar("SJP perfis ONIBUS/CARRO + depreciação por perfil", SJP, (e) => {
    const perfis = perfisPadrao();
    const onibus = perfis.find((p) => p.codigo === "ONIBUS")!;
    Object.assign(onibus.veiculo, { metodoDepreciacao: "SOMA_DIGITOS", vidaUtilAnos: 10, idadeInicialAnos: 3, valorResidualPct: 0.15, remuneracaoSobreValorMedio: true });
    const carro = perfis.find((p) => p.codigo === "CARRO")!;
    Object.assign(carro.veiculo, {
      metodoDepreciacao: "LINEAR",
      vidaUtilAnos: 5,
      idadeInicialAnos: 1,
      valorResidualPct: 0.3,
      capitalComposto: true,
      fracaoFinanciada: 0.6,
      taxaFinanciamentoAa: 0.22,
      custoCapitalProprioAa: 0.11,
      adaptacaoValor: 5000,
      adaptacaoMesesDepreciacao: 36,
      manutencaoFixaPctMes: 0.002,
      garagemMes: 300,
      garagemComReserva: false,
    });
    e.premissas.perfis = perfis;
    e.premissas.contrato.vigenciaMeses = 36;
    e.rotas[0].perfilVeiculo = "ONIBUS";
    e.rotas[1].perfilVeiculo = "CARRO";
    e.rotas[4].perfilVeiculo = "CARRO";
    e.rotas[5].perfilVeiculo = "NAO-EXISTE"; // cai no padrão, como no motor
  }),
  variar("Holambra LINEAR c/ idade, valor médio, capital composto, adaptação, manutenção fixa", HOL, (e) => {
    Object.assign(e.premissas.veiculo, {
      metodoDepreciacao: "LINEAR",
      vidaUtilAnos: 8,
      valorResidualPct: 0.2,
      idadeInicialAnos: 2.5,
      remuneracaoSobreValorMedio: true,
      capitalComposto: true,
      fracaoFinanciada: 0.7,
      taxaFinanciamentoAa: 0.2,
      custoCapitalProprioAa: 0.1,
      adaptacaoValor: 30000,
      adaptacaoMesesDepreciacao: 60,
      manutencaoFixaPctMes: 0.001,
    });
    e.premissas.contrato.vigenciaMeses = 48;
  }),
  variar("SJP SOMA_DIGITOS passando da vida útil, valor médio", SJP, (e) => {
    Object.assign(e.premissas.veiculo, { metodoDepreciacao: "SOMA_DIGITOS", vidaUtilAnos: 7, idadeInicialAnos: 6, valorResidualPct: 0.1, remuneracaoSobreValorMedio: true });
    e.premissas.contrato.vigenciaMeses = 30;
  }),
  variar("SJP item sem motorista, combustível do cliente, horas extras, implantação, despesas s/ preço (diária)", SJP, (e) => {
    e.itens[1].comMotorista = false;
    e.itens[0].combustivelPorContaDoCliente = true;
    Object.assign(e.premissas.pessoal, { divisorHorasMes: 220, horasExtras50Mes: 10, horasExtras100Mes: 4, horasNoturnasMes: 20 });
    e.premissas.contrato.implantacaoTotal = 120000;
    e.premissas.preco.despesasSobrePrecoPct = 0.03;
    e.unidadePreco = "DIARIA";
    e.precoTesteKm = null;
  }),
  variar("SJP Lucro Real (km, lote)", SJP, (e) => {
    Object.assign(e.premissas.preco, { irpj: 0, csll: 0, irpjCsllSobreLucroPct: 0.34, creditoPisCofinsPct: 0.0925 });
    e.premissas.veiculo.manutencaoFixaPctMes = 0.001;
    e.premissas.veiculo.adaptacaoValor = 8000;
    e.premissas.veiculo.adaptacaoMesesDepreciacao = 48;
  }),
  variar("SJP Lucro Real binômia", SJP, (e) => {
    Object.assign(e.premissas.preco, { irpj: 0, csll: 0, irpjCsllSobreLucroPct: 0.34, creditoPisCofinsPct: 0.0925, despesasSobrePrecoPct: 0.02 });
    e.unidadePreco = "BINOMIA";
    e.precoTesteKm = null;
  }),
  variar("Holambra Lucro Real veículo-mês (equilíbrio máximo)", HOL, (e) => {
    Object.assign(e.premissas.preco, { irpj: 0, csll: 0, irpjCsllSobreLucroPct: 0.34, creditoPisCofinsPct: 0.0925 });
    e.unidadePreco = "VEICULO_MES";
  }),
  // As três correções da revisão de precificação, cada uma num caso.
  variar("Holambra horas noturnas a 25% nas linhas noturnas com fator", HOL, (e) => {
    Object.assign(e.premissas.pessoal, { horasNoturnasMes: 30, adicionalNoturnoPct: 0.25, horasExtras50Mes: 6 });
  }),
  variar("SJP item 2 sem motorista no Presumido (locação, lote)", SJP, (e) => {
    e.itens[1].comMotorista = false;
    Object.assign(e.premissas.preco, { irpjLocacao: 0.05, csllLocacao: 0.03 });
  }),
  variar("SJP Lucro Real, capital composto, contingência, adaptação, item sem motorista (km, lote)", SJP, (e) => {
    Object.assign(e.premissas.preco, { irpj: 0, csll: 0, irpjCsllSobreLucroPct: 0.34 });
    Object.assign(e.premissas.veiculo, { capitalComposto: true, fracaoFinanciada: 0.6, taxaFinanciamentoAa: 0.2, custoCapitalProprioAa: 0.12, adaptacaoValor: 10000, adaptacaoMesesDepreciacao: 48 });
    e.premissas.indiretos.contingenciaPct = 0.05;
    e.itens[1].comMotorista = false;
  }),
  variar("Holambra Lucro Real binômia, capital composto sobre valor médio, contingência", HOL, (e) => {
    Object.assign(e.premissas.preco, { irpj: 0, csll: 0, irpjCsllSobreLucroPct: 0.34 });
    Object.assign(e.premissas.veiculo, {
      capitalComposto: true,
      fracaoFinanciada: 0.5,
      taxaFinanciamentoAa: 0.16,
      custoCapitalProprioAa: 0.1,
      metodoDepreciacao: "LINEAR",
      vidaUtilAnos: 10,
      valorResidualPct: 0.15,
      remuneracaoSobreValorMedio: true,
    });
    e.premissas.indiretos.contingenciaPct = 0.04;
    e.unidadePreco = "BINOMIA";
  }),
];

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

    // Cobertura: cada recurso do motor aparece em algum caso, com efeito.
    console.log("\nCOBERTURA DOS CASOS");
    const resultados = casos.map((c) => simular(c.entrada));
    const algum = (f: (r: ResultadoSimulacao, e: EntradaSimulacao) => boolean) => resultados.some((r, i) => f(r, casos[i].entrada));
    for (const u of ["KM", "VEICULO_MES", "DIARIA", "HORA", "BINOMIA"] as const) ok(`unidade ${u}`, algum((r) => r.unidade === u));
    ok("rotas com perfis ONIBUS e CARRO", algum((_r, e) => ["ONIBUS", "CARRO"].every((p) => e.rotas.some((ro) => ro.perfilVeiculo === p))));
    ok("item sem motorista", algum((_r, e) => e.itens.some((i) => i.comMotorista === false)));
    ok("combustível do cliente (diesel zero no item)", algum((r, e) => e.itens.some((i, k) => i.combustivelPorContaDoCliente && r.itens[k].diesel === 0)));
    ok("depreciação LINEAR e SOMA_DIGITOS", ["LINEAR", "SOMA_DIGITOS"].every((m) => algum((_r, e) => e.premissas.veiculo.metodoDepreciacao === m)));
    ok("remuneração sobre o valor médio e capital composto", algum((_r, e) => e.premissas.veiculo.remuneracaoSobreValorMedio && e.premissas.veiculo.capitalComposto));
    ok("adaptação e manutenção fixa com custo", algum((r) => r.itens.some((i) => i.adaptacao > 0 && i.manutencaoFixa > 0)));
    ok("implantação amortizada", algum((r) => r.itens.some((i) => i.implantacaoMes > 0)));
    ok("horas extras em horas", algum((_r, e) => e.premissas.pessoal.horasExtras50Mes > 0));
    ok("horas noturnas com adicional diferente de 20%", algum((_r, e) => e.premissas.pessoal.horasNoturnasMes > 0 && (e.premissas.pessoal.adicionalNoturnoPct ?? 0.2) !== 0.2));
    ok(
      "item sem motorista no Presumido com os tributos da locação",
      algum((r, e) => e.premissas.preco.irpjCsllSobreLucroPct === 0 && e.itens.some((i, k) => i.comMotorista === false && r.itens[k].tributosPct !== r.itens[0].tributosPct))
    );
    ok("item sem motorista no Lucro Real", algum((_r, e) => e.premissas.preco.irpjCsllSobreLucroPct > 0 && e.itens.some((i) => i.comMotorista === false)));
    ok(
      "Lucro Real com capital composto e contingência (não dedutíveis na base do IR)",
      algum((r, e) => e.premissas.preco.irpjCsllSobreLucroPct > 0 && e.premissas.veiculo.capitalComposto && e.premissas.indiretos.contingenciaPct > 0 && r.itens.every((i) => i.naoDedutiveis > 0))
    );
    ok("despesas sobre o preço", algum((_r, e) => e.premissas.preco.despesasSobrePrecoPct > 0));
    ok("Lucro Real com crédito e IR sobre lucro positivo", algum((r) => r.itens.some((i) => i.creditoPisCofins > 0 && i.irpjCsllSobreLucro > 0)));
    ok("Lucro Real com cenário de prejuízo (IR não incide)", algum((r, e) => e.premissas.preco.irpjCsllSobreLucroPct > 0 && r.cenarios.linhas.some((l) => l.lucro < 0)));
    ok("equilíbrio MÍNIMO e MÁXIMO", algum((r) => r.cenarios.tipoEquilibrio === "MINIMA") && algum((r) => r.cenarios.tipoEquilibrio === "MAXIMA"));
    ok("item sem preço por hora (rota sem horas/dia)", algum((r) => r.unidade === "HORA" && r.itens.some((i) => i.indicadores.hora === null)));

    type Arquivo = { nome: string; arquivo: string; mapa: Mapa; resultado: ResultadoSimulacao; entrada: EntradaSimulacao };
    const arquivos: Arquivo[] = [];
    for (const [k, caso] of casos.entries()) {
      console.log(`\n${caso.nome.toUpperCase()} — estrutura`);
      const buffer = await gerar(caso.historico, caso.entrada);
      const arquivo = path.join(dir, `caso-${k}.xlsx`);
      writeFileSync(arquivo, buffer);
      const mapa = await mapear(buffer);
      conferirEstrutura(caso.nome, mapa, caso.entrada);
      arquivos.push({ nome: caso.nome, arquivo, mapa, resultado: resultados[k], entrada: caso.entrada });

      // Nas duas simulações históricas e no caso de perfis: premissas mudadas
      // DENTRO da planilha, e a mesma mudança na entrada do motor.
      if (k > 1 && !caso.nome.startsWith("SJP perfis")) continue;
      const e: EntradaSimulacao = clone(caso.entrada);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
      const ws = wb.getWorksheet("Premissas")!;
      const wr = wb.getWorksheet("Rotas")!;
      const mudar = (rotulo: string, valor: number | string) => (ws.getCell(mapa.prem(rotulo)).value = valor);
      const mudarRota = (i: number, cabecalho: string, valor: number | string) => (wr.getCell(`${mapa.rotaCol(cabecalho)}${5 + i}`).value = valor);
      e.premissas.variaveis.dieselLitro *= 1.1;
      mudar("Diesel", e.premissas.variaveis.dieselLitro);
      e.premissas.pessoal.fatorJornadaNoturna = 1.5;
      mudar("Fator de jornada noturna", 1.5);
      e.rotas[1].noturno = !e.rotas[1].noturno;
      mudarRota(1, "Noturno", e.rotas[1].noturno ? "S" : "N");
      e.rotas[0].kmTerraDia = e.rotas[0].kmDia * 0.5;
      mudarRota(0, "Km terra/dia", e.rotas[0].kmTerraDia);
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
      e.premissas.pessoal.horasNoturnasMes = 12;
      mudar("Horas noturnas", 12);
      e.premissas.pessoal.adicionalNoturnoPct = 0.25;
      mudar("Adicional noturno", 0.25);
      const ultimo = e.itens[e.itens.length - 1];
      ultimo.comMotorista = false;
      mudar(`Com motorista? (S/N) — Item ${ultimo.codigo}`, "N");
      e.precoTesteKm = 12.34;
      wb.getWorksheet("Cenários")!.getCell("B4").value = 12.34;
      if (e.premissas.perfis) {
        // Perfil: valor do ônibus, salário do motorista do carro, a unidade de
        // preço e o perfil de uma rota — tudo trocado na planilha.
        const wf = wb.getWorksheet("Perfis de Veículo")!;
        const onibus = e.premissas.perfis.find((p) => p.codigo === "ONIBUS")!;
        onibus.veiculo.valor = 350000;
        wf.getCell(mapa.perfilCel("Valor do veículo", "ONIBUS")).value = 350000;
        const carro = e.premissas.perfis.find((p) => p.codigo === "CARRO")!;
        carro.motorista.salario = 2600;
        wf.getCell(mapa.perfilCel("Salário base do motorista", "CARRO")).value = 2600;
        e.rotas[2].perfilVeiculo = "MICRO";
        mudarRota(2, "Perfil do veículo", "MICRO");
        e.unidadePreco = "VEICULO_MES";
        mudar("Unidade de preço", "VEICULO_MES");
        e.precoTesteKm = 30000;
        wb.getWorksheet("Cenários")!.getCell("B4").value = 30000;
        // Regime: Lucro Real na planilha — a base do IR passa a contar o
        // capital próprio dos perfis e a contingência.
        Object.assign(e.premissas.preco, { irpj: 0, csll: 0, irpjCsllSobreLucroPct: 0.34 });
        mudar("IRPJ (Presumido", 0);
        mudar("CSLL (Presumido", 0);
        mudar("IRPJ + CSLL sobre o lucro", 0.34);
      }
      const arquivoMudado = path.join(dir, `caso-${k}-mudado.xlsx`);
      await wb.xlsx.writeFile(arquivoMudado);
      const mudado = simular(e);
      ok(
        `${caso.nome}: as mudanças na planilha mexem no resultado (senão o recálculo não provaria nada)`,
        Math.abs(mudado.totais.custoTotal - resultados[k].totais.custoTotal) > 1 && mudado.itens.some((it, i) => it.precoUnidade !== resultados[k].itens[i].precoUnidade)
      );
      arquivos.push({ nome: `${caso.nome} c/ premissas mudadas na planilha`, arquivo: arquivoMudado, mapa, resultado: mudado, entrada: e });
    }

    for (const motor of motores) {
      console.log(`\nRECÁLCULO PELO ${motor.nome.toUpperCase()} × simular()`);
      const valores = await motor.recalcular(
        arquivos.map((c) => c.arquivo),
        dir
      );
      arquivos.forEach((c, k) => conferirNumeros(c.nome, motor.nome, c.mapa, valores[k], c.resultado, c.entrada));
    }

    console.log(`\nMaiores diferenças planilha × motor (${comparacoes} comparações numéricas, ${arquivos.length} planilhas × ${motores.length} motor(es)):`);
    for (const [g, { dif, onde }] of Object.entries(maiores)) console.log(`  ${g.padEnd(34)} ${dif.toExponential(3)}  (${onde})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
  process.exit(falhas === 0 ? 0 : 1);
})();
