// Mão de obra × veículo: as partes fecham o custo total e o faturamento, o
// crédito de PIS/COFINS abate só do veículo e cada parte leva a sua fração de
// administração e contingência.
import { historicoHolambra, historicoSaoJoseDosPinhais } from "../src/lib/simulador/historico";
import { simular } from "../src/lib/simulador/motor";
import { separarMaoDeObraEVeiculo } from "../src/lib/simulador/separacao";
import type { EntradaSimulacao } from "../src/lib/simulador/tipos";

let falhas = 0;
function perto(nome: string, real: number, esperado: number, tolerancia = 0.01) {
  const passou = Math.abs(real - esperado) <= tolerancia;
  if (!passou) falhas++;
  console.log(`  ${passou ? "ok  " : "FALHA"} ${nome}${passou ? "" : `\n         esperado ${esperado}\n         obtido   ${real}`}`);
}
function ok(nome: string, condicao: boolean) {
  if (!condicao) falhas++;
  console.log(`  ${condicao ? "ok  " : "FALHA"} ${nome}`);
}
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

for (const h of [historicoHolambra(), historicoSaoJoseDosPinhais()]) {
  console.log(`\n${h.edital.municipio.toUpperCase()}`);
  const r = simular(h.entrada);
  const p = h.entrada.premissas;
  const s = separarMaoDeObraEVeiculo(r.itens, p);
  const somaPartes = (f: (x: (typeof s.partes)[number]) => number) => s.partes.reduce((a, x) => a + f(x), 0);
  perto("as partes somam o custo total", somaPartes((x) => x.comIndiretos), s.custoTotal);
  perto("as partes somam o custo direto", somaPartes((x) => x.direto), r.itens.reduce((a, i) => a + i.custoDireto, 0));
  perto("os preços das partes somam o faturamento", somaPartes((x) => x.preco), s.faturamento);
  perto("participações somam 100%", somaPartes((x) => x.participacao), 1, 1e-9);
  perto("veículo = fixo + variável", s.veiculo.comIndiretos, s.partes[1].comIndiretos + s.partes[2].comIndiretos);
  perto("mão de obra = mão de obra do motor × meses", s.maoDeObra.direto, r.itens.reduce((a, i) => a + i.maoDeObraMes, 0) * p.contrato.mesesCustoFixo);
  ok("mão de obra e veículo positivos", s.maoDeObra.comIndiretos > 0 && s.veiculo.comIndiretos > 0);

  // Um item sozinho é a mesma conta restrita a ele.
  const um = separarMaoDeObraEVeiculo([r.itens[0]], p);
  perto("um item: custo total do item", um.custoTotal, r.itens[0].custoTotal);
  perto("um item: preço por veículo-mês fecha o preço do item", um.maoDeObra.preco + um.veiculo.preco + um.partes[3].preco, r.itens[0].faturamento);

  // Lucro Real com crédito: o crédito sai do veículo; a mão de obra não muda de custo.
  const e: EntradaSimulacao = clone(h.entrada);
  e.premissas.preco.creditoPisCofinsPct = 0.0925;
  const rr = simular(e);
  const sr = separarMaoDeObraEVeiculo(rr.itens, e.premissas);
  perto("com crédito: mão de obra líquida = com indiretos", sr.maoDeObra.liquido, sr.maoDeObra.comIndiretos);
  perto("com crédito: o veículo leva todo o crédito", sr.veiculo.comIndiretos - sr.veiculo.liquido, rr.itens.reduce((a, i) => a + i.creditoPisCofins, 0));
  perto("com crédito: preços ainda fecham o faturamento", sr.partes.reduce((a, x) => a + x.preco, 0), sr.faturamento);
}

console.log("\nSEM ITENS");
const vazio = separarMaoDeObraEVeiculo([], historicoHolambra().entrada.premissas);
ok("tudo zero, sem divisão por zero", vazio.custoTotal === 0 && vazio.partes.every((x) => x.preco === 0 && x.porKm === 0 && x.participacao === 0));

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
