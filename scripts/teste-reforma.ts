// A REFORMA ANO A ANO: a tabela de transição, os meses do contrato em cada
// ano, e a conta — em 2026 o preço é o de hoje; do regime novo em diante, o
// preço B mantém o lucro alvo e o A (nota de hoje) mostra a margem que sobra.
import { historicoSaoJoseDosPinhais } from "../src/lib/simulador/historico";
import { simular } from "../src/lib/simulador/motor";
import { PERFIS_PADRAO, PREMISSAS_PADRAO } from "../src/lib/simulador/premissas";
import { clausulaDeReequilibrio, lerInicio, mesesPorAno, reformaAnoAAno, tabelaDeTransicao } from "../src/lib/simulador/reforma";
import type { EntradaSimulacao } from "../src/lib/simulador/tipos";

let falhas = 0;
function ok(nome: string, passou: boolean, detalhe = "") {
  if (!passou) falhas++;
  console.log(`  ${passou ? "ok  " : "FALHA"} ${nome}${passou || !detalhe ? "" : `\n         ${detalhe}`}`);
}
const perto = (nome: string, real: number | null | undefined, esperado: number, tol = 1e-6) =>
  ok(nome, typeof real === "number" && Math.abs(real - esperado) <= tol, `esperado ${esperado}, obtido ${real}`);
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

console.log("TABELA DE TRANSIÇÃO (padrão: CBS 8,8%, IBS 17,7%)");
const t = tabelaDeTransicao(PREMISSAS_PADRAO);
const ano = (a: number) => t.find((x) => x.ano === a)!;
ok("2026: PIS/COFINS e teste compensado", ano(2026).pisCofins && ano(2026).teste);
perto("2027: CBS cheia − 0,1 p.p.", ano(2027).cbs, 0.087);
perto("2027: IBS 0,1%", ano(2027).ibs, 0.001);
ok("2027: sem PIS/COFINS", !ano(2027).pisCofins);
perto("2029: IBS a 10% da referência", ano(2029).ibs, 0.0177);
perto("2029: ISS/ICMS a 90%", ano(2029).fatorIssIcms, 0.9);
perto("2032: ISS/ICMS a 60%", ano(2032).fatorIssIcms, 0.6);
perto("2033: IBS cheio", ano(2033).ibs, 0.177);
perto("2033: ISS/ICMS extintos", ano(2033).fatorIssIcms, 0);
const comReducao = clone(PREMISSAS_PADRAO);
comReducao.preco.reducaoIbsCbsPct = 0.4;
perto("redução de 40%: CBS 60% da referência", tabelaDeTransicao(comReducao).find((x) => x.ano === 2030)!.cbs, 0.088 * 0.6);

console.log("\nMESES DO CONTRATO EM CADA ANO");
ok("out/2026 + 24 meses: 3, 12 e 9", JSON.stringify([...mesesPorAno({ ano: 2026, mes: 10 }, 24)]) === JSON.stringify([[2026, 3], [2027, 12], [2028, 9]]));
ok("lê 2027-03", JSON.stringify(lerInicio("2027-03")) === JSON.stringify({ ano: 2027, mes: 3 }));
ok("recusa mês 13 e texto", lerInicio("2027-13") === null && lerInicio("amanhã") === null && lerInicio(null) === null);

// Uma van, 1 motorista, R$ 4.400 km no mês, contrato privado de 60 meses.
function van(): EntradaSimulacao {
  const premissas = clone(PREMISSAS_PADRAO);
  premissas.perfis = clone(PERFIS_PADRAO.filter((x) => x.codigo === "VAN"));
  premissas.contrato.vigenciaMeses = 60;
  return {
    premissas,
    itens: [{ codigo: "1", descricao: "Van", shareIntermunicipal: 0 }],
    rotas: [{ item: "1", nome: "R1", kmReferencia: 4400, kmDia: 200, kmTerraDia: 0, veiculos: 1, motoristas: 1, monitoras: 0, noturno: false, passagensPedagioMes: 0, tarifaPedagio: 0, perfilVeiculo: "VAN" }],
    criterio: "ITEM",
    unidadePreco: "VEICULO_MES",
  } as unknown as EntradaSimulacao;
}

for (const [nome, e] of [
  ["VAN (Presumido, ISS)", van()],
  ["SJP (histórico)", historicoSaoJoseDosPinhais().entrada],
] as [string, EntradaSimulacao][]) {
  console.log(`\n${nome} — de jan/2026, 96 meses`);
  e.premissas.contrato.vigenciaMeses = 96;
  const r = simular(e);
  const ref = reformaAnoAAno(e, r, { inicio: { ano: 2026, mes: 1 } });
  const a = (x: number) => ref.anos.find((y) => y.ano === x)!;
  ok("oito anos, 12 meses cada", ref.anos.length === 8 && ref.anos.every((x) => x.meses === 12));
  // 2026: os tributos de hoje; o preço B é o do motor antes do arredondamento.
  perto("2026: nota B ≈ nota de hoje (arredondamento)", a(2026).nota / 12 / ref.hoje.notaMes, 1, 0.005);
  perto("2026: sem reequilíbrio, a margem de hoje", a(2026).semReequilibrio.margem, r.totais.margem ?? 0, 0.005);
  perto("2026: sem CBS/IBS a pagar", a(2026).cbs + a(2026).ibs, 0);
  // B mantém o lucro alvo em todos os anos (Presumido).
  for (const y of [2027, 2030, 2033]) perto(`${y}: B dá o lucro alvo`, a(y).margem, e.premissas.preco.lucroAlvoPct, 1e-9);
  perto("2027: CBS = receita × 8,7%", a(2027).cbs, a(2027).receita * 0.087, 0.01);
  ok("2027: sem PIS/COFINS nos tributos", !a(2027).tributos.some((x) => x.rotulo === "PIS" || x.rotulo === "COFINS"));
  ok("2033: sem ISS e ICMS", !a(2033).tributos.some((x) => x.rotulo.startsWith("ISS") || x.rotulo.startsWith("ICMS")));
  ok("2027: crédito sobre os insumos", a(2027).credito > 0 && a(2026).credito === 0);
  perto("crédito = soma das linhas", a(2030).credito, a(2030).creditos.reduce((s, c) => s + c.valor, 0), 0.01);
  // A: a nota de hoje com CBS/IBS por dentro — a margem cai.
  ok("2027: sem reequilíbrio a margem cai", (a(2027).semReequilibrio.margem ?? 1) < (r.totais.margem ?? 0));
  perto("A: receita = nota de hoje ÷ (1 + CBS + IBS)", a(2031).semReequilibrio.receita, (ref.hoje.notaMes * 12) / (1 + a(2031).transicao.cbs + a(2031).transicao.ibs), 0.01);
  ok("reequilíbrio a pedir em 2033", (a(2033).reequilibrio ?? 0) > 0);
  ok("pior margem sem reequilíbrio num ano do regime novo", (ref.piorSemReequilibrio?.ano ?? 0) >= 2027);
  // Crédito do veículo: mais crédito, preço menor.
  const cv = reformaAnoAAno(e, r, { inicio: { ano: 2026, mes: 1 }, creditoVeiculo: true });
  ok("crédito do veículo reduz o preço de 2030", cv.anos.find((x) => x.ano === 2030)!.nota < a(2030).nota);
  ok("cláusula traz os anos", /2027: [+-]/.test(clausulaDeReequilibrio(ref)) && /LC|Lei Complementar 214/.test(clausulaDeReequilibrio(ref)));
}

console.log("\nLUCRO REAL — B mantém o lucro alvo depois do IR");
{
  const e = van();
  Object.assign(e.premissas.preco, { irpj: 0, csll: 0, irpjCsllSobreLucroPct: 0.34 });
  const r = simular(e);
  const ref = reformaAnoAAno(e, r, { inicio: { ano: 2027, mes: 1 } });
  perto("2027 no Real: margem = alvo", ref.anos[0].margem, e.premissas.preco.lucroAlvoPct, 1e-9);
}

async function planilha() {
  console.log("\nEXCEL — a aba Reforma do orçamento");
  const ExcelJS = (await import("exceljs")).default;
  const { gerarPlanilhaSimulacao } = await import("../src/lib/simulador/exportarXlsx");
  const e = van();
  e.reforma = { inicio: "2027-01" };
  const r = simular(e);
  const buf = await gerarPlanilhaSimulacao({
    edital: { numero: "T", orgao: "Cliente", municipio: "São Paulo", uf: "SP", objeto: "Van", dataSessao: null, plataforma: null },
    licitante: { razaoSocial: "Azul", cnpj: "" },
    esfera: "PRIVADO",
    regras: [],
    entrada: e,
    resultado: r,
    versao: 1,
    geradoEm: new Date(2026, 9, 4),
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const w = wb.getWorksheet("Reforma");
  ok("aba Reforma no arquivo", Boolean(w));
  const ref = reformaAnoAAno(e, r, { inicio: { ano: 2027, mes: 1 } });
  let nota2027: unknown = null;
  w?.eachRow((row) => {
    if (row.getCell(1).value === 2027 && typeof row.getCell(8).value === "number") nota2027 = row.getCell(8).value;
  });
  perto("nota de 2027 igual à da aba", nota2027 as number, ref.anos[0].nota, 0.01);
}

planilha()
  .catch((err) => {
    falhas++;
    console.error(err);
  })
  .finally(() => {
    console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
    process.exit(falhas === 0 ? 0 : 1);
  });
