// Mão de obra × veículo: as partes fecham o custo total e o faturamento, o
// crédito de PIS/COFINS abate só do veículo e cada parte leva a sua fração de
// administração e contingência.
import { historicoHolambra, historicoSaoJoseDosPinhais } from "../src/lib/simulador/historico";
import { simular } from "../src/lib/simulador/motor";
import { separarMaoDeObraEVeiculo } from "../src/lib/simulador/separacao";
import { PERFIS_PADRAO, PREMISSAS_PADRAO } from "../src/lib/simulador/premissas";
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

  // O detalhe de cada parte, mais a administração e contingência, fecha a parte.
  for (const x of s.partes) {
    const detalhe = s.componentes[x.chave].reduce((a, c) => a + c.valor, 0);
    perto(`detalhe fecha: ${x.rotulo}`, detalhe * (1 + s.indiretosPct), x.comIndiretos);
  }
  ok("pessoas = motoristas + monitoras", Math.abs(s.pessoas - r.itens.reduce((a, i) => a + i.motoristas + i.monitoras, 0)) < 1e-9);

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

// As parcelas abertas somam a linha delas.
function parcelasFecham(nome: string, s: ReturnType<typeof separarMaoDeObraEVeiculo>) {
  for (const c of s.componentes.maoDeObra) {
    if (!c.sub?.length) continue;
    perto(`${nome}: parcelas de "${c.rotulo}" somam a linha`, c.sub.reduce((a, x) => a + x.valor, 0), c.valor);
  }
}
for (const h of [historicoHolambra(), historicoSaoJoseDosPinhais()]) {
  const r = simular(h.entrada);
  parcelasFecham(h.edital.municipio, separarMaoDeObraEVeiculo(r.itens, h.entrada.premissas, h.entrada));
}

console.log("\nUM MOTORISTA DE VAN (o estudo do print)");
{
  // Van (TRANSFRETUR nível B), 1 motorista, horas extras de 14%, encargos padrão.
  const premissas = clone(PREMISSAS_PADRAO);
  premissas.perfis = clone(PERFIS_PADRAO.filter((x) => x.codigo === "VAN"));
  premissas.pessoal.supervisaoMes = 0;
  const e: EntradaSimulacao = {
    premissas,
    itens: [{ codigo: "1", descricao: "Van", shareIntermunicipal: 0 }],
    rotas: [{ item: "1", nome: "R1", kmReferencia: 4400, kmDia: 200, kmTerraDia: 0, veiculos: 1, motoristas: 1, monitoras: 0, noturno: false, passagensPedagioMes: 0, tarifaPedagio: 0, perfilVeiculo: "VAN" }],
    criterio: "ITEM",
  } as unknown as EntradaSimulacao;
  const r = simular(e);
  const s = separarMaoDeObraEVeiculo(r.itens, premissas, e);
  const [sal, enc, ben] = s.componentes.maoDeObra;
  perto("salários = 2.986,75 × 1,14", sal.valor, 3404.90);
  perto("encargos = 62,45% dos salários", enc.valor, 2126.36);
  ok("encargos abertos nos grupos A a D", enc.sub?.map((x) => x.rotulo[0]).join("") === "ABCD");
  perto("benefícios da convenção: 1 × (1.753,26 + 100)", ben.valor, 1853.26);
  ok("benefícios abertos: VR, cesta, PLR, plano, uniforme", ben.sub?.map((x) => x.rotulo.split(" ")[0]).join(",") === "Vale-refeição,Cesta,PLR,Plano,Uniforme,");
  parcelasFecham("van", s);
}

console.log("\nSEM ITENS");
const vazio = separarMaoDeObraEVeiculo([], historicoHolambra().entrada.premissas);
ok("tudo zero, sem divisão por zero", vazio.custoTotal === 0 && vazio.partes.every((x) => x.preco === 0 && x.porKm === 0 && x.participacao === 0));

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
