// TESTES DO MOTOR DO SIMULADOR DE CUSTOS — `npm run teste:simulador`.
//
// Critério de aceite da v1 (docs/simulador_custos_handoff/docs/ESPECIFICACAO,
// seção 7): reproduzir as duas simulações de referência — Holambra PE 036/2026
// e São José dos Pinhais PE 089/2026 — com tolerância de R$ 0,01 no preço/km e
// de 0,1% nos totais, a partir das sementes do pacote. Os números esperados
// vêm de testes/casos_de_teste_esperados.json, sem edição.
//
// Sem banco: o motor é puro.
import esperado from "../src/lib/simulador/historico/casos_de_teste_esperados.json";
import { historicoHolambra, historicoSaoJoseDosPinhais } from "../src/lib/simulador/historico";
import { arredondarParaCima, simular } from "../src/lib/simulador/motor";

let falhas = 0;
function ok(nome: string, passou: boolean, detalhe = "") {
  if (!passou) falhas++;
  console.log(`${passou ? "  ok  " : "FALHA "} ${nome}${passou ? "" : `\n         ${detalhe}`}`);
}
function conferir(nome: string, real: unknown, esperadoValor: unknown) {
  ok(nome, JSON.stringify(real) === JSON.stringify(esperadoValor), `esperado ${JSON.stringify(esperadoValor)}\n         obtido   ${JSON.stringify(real)}`);
}
// Preço/km: R$ 0,01. Totais: 0,1%. Custo/km (4 casas na planilha): 0,1%.
function perto(nome: string, real: number, alvo: number, tipo: "preco" | "total") {
  const passou = tipo === "preco" ? Math.abs(real - alvo) <= 0.01 + 1e-9 : Math.abs(real - alvo) <= Math.abs(alvo) * 0.001 + 1e-6;
  ok(nome, passou, `esperado ${alvo}, obtido ${real} (diferença ${(real - alvo).toFixed(6)})`);
}

console.log("ROUNDUP do Excel");
conferir("7,74 exato não sobe", arredondarParaCima(7.74), 7.74);
conferir("7,7401 sobe para 7,75", arredondarParaCima(7.7401), 7.75);
conferir("18,0046 sobe para 18,01", arredondarParaCima(18.0046), 18.01);
conferir("negativo afasta do zero", arredondarParaCima(-1.231), -1.24);

console.log("\nSEMENTES — nenhum número da planilha fica de fora");
for (const h of [historicoHolambra(), historicoSaoJoseDosPinhais()]) {
  const numericas = h.leitor.todas.filter((l) => typeof l.valor === "number").map((l) => l.item);
  const naoUsadas = numericas.filter((n) => !h.leitor.consumidos.has(n));
  conferir(`${h.edital.numero}: todo número da semente foi usado ou declarado derivado`, naoUsadas, []);
}

console.log("\nHOLAMBRA PE 036/2026 — 9 linhas, julgamento por item");
{
  const h = historicoHolambra();
  const r = simular(h.entrada);
  const casos = esperado.holambra.linhas;
  conferir("nove linhas", r.itens.length, casos.length);
  for (const caso of casos) {
    const item = r.itens.find((i) => i.item === String(caso.linha))!;
    const e = caso.esperado;
    perto(`linha ${caso.linha}: preço/km`, item.precoKm, e.preco_km, "preco");
    perto(`linha ${caso.linha}: custo total`, item.custoTotal, e.custo_total, "total");
    perto(`linha ${caso.linha}: custo/km`, item.custoKm, e.custo_km, "total");
    perto(`linha ${caso.linha}: valor total`, item.faturamento, e.valor_total, "total");
    perto(`linha ${caso.linha}: lucro líquido`, item.lucro, e.lucro_liquido, "total");
    conferir(`linha ${caso.linha}: preço de referência`, item.precoReferenciaKm, caso.preco_ref);
  }
  const t = esperado.holambra.totais_esperados;
  perto("total: valor da proposta", r.totais.faturamento, t.valor_proposta, "total");
  perto("total: custo", r.totais.custoTotal, t.custo_total, "total");
  perto("total: lucro líquido", r.totais.lucro, t.lucro_liquido, "total");
  // Decisão registrada no pacote: as linhas 03 e 09 ficam acima da referência.
  conferir(
    "linhas acima do preço de referência: 03 e 09",
    r.itens.filter((i) => i.precoReferenciaKm !== null && i.precoKm > i.precoReferenciaKm).map((i) => i.item),
    ["3", "9"]
  );
  conferir("sem lote no julgamento por item", r.lote, null);
  conferir("frota e equipe", [r.totais.veiculos, r.totais.motoristas, r.totais.monitoras], [10, 10, 9]);
}

console.log("\nSÃO JOSÉ DOS PINHAIS PE 089/2026 — lote único, SRP a 85%");
{
  const h = historicoSaoJoseDosPinhais();
  const r = simular(h.entrada);
  const e = esperado.sjpinhais.itens;
  const i1 = r.itens.find((i) => i.item === "1")!;
  const i2 = r.itens.find((i) => i.item === "2")!;
  for (const [nome, item, alvo] of [
    ["item 1 (pacientes)", i1, e.item1_pacientes],
    ["item 2 (servidores)", i2, e.item2_servidores],
  ] as const) {
    perto(`${nome}: km útil/mês`, item.kmUtil, alvo.km_util_mes, "total");
    perto(`${nome}: custo total/mês`, item.custoTotal, alvo.custo_total_mes, "total");
    perto(`${nome}: custo/km`, item.custoKm, alvo.custo_km, "total");
    perto(`${nome}: preço/km`, item.precoKm, alvo.preco_km, "preco");
    perto(`${nome}: lucro/mês`, item.lucro, alvo.lucro_mes, "total");
  }
  const lote = r.lote!;
  perto("lote: km útil/mês", lote.kmUtil, e.lote.km_util_mes, "total");
  perto("lote: custo total/mês", lote.custoTotal, e.lote.custo_total_mes, "total");
  perto("lote: custo/km", lote.custoKm, e.lote.custo_km, "total");
  perto("lote: preço/km médio ponderado", lote.precoKm, e.lote.preco_km, "preco");
  perto("lote: lucro/mês", lote.lucro, e.lote.lucro_mes, "total");
  conferir("lote: preço único da proposta (2 casas, para cima)", lote.precoProposta, 9.31);
  conferir("item 2 isolado fica acima do teto de R$ 11,11", lote.itensAcimaDoTeto, ["2"]);
  // Decisão registrada: o lote a R$ 9,31 dá lucro de ~9%.
  ok("lote a R$ 9,31: margem perto de 9%", Math.abs((lote.margemAoPrecoProposta ?? 0) - 0.09) < 0.005, `margem ${lote.margemAoPrecoProposta}`);

  console.log("\n  cenários a R$ 9,89/km");
  const c = r.cenarios;
  conferir("preço de teste", c.precoTesteKm, 9.89);
  const cen = esperado.sjpinhais.cenarios_a_9_89_por_km_8_vans;
  for (const [rotulo, u] of [["60%", 0.6], ["70%", 0.7], ["80%", 0.8], ["85%", 0.85], ["90%", 0.9], ["100%", 1]] as const) {
    const linha = c.linhas.find((l) => l.utilizacao === u)!;
    const alvo = cen[rotulo];
    // O esperado vem arredondado a reais e a 0,1 ponto de margem.
    ok(`${rotulo}: lucro/mês ≈ ${alvo.lucro_mes}`, Math.abs(linha.lucro - alvo.lucro_mes) < 1, `obtido ${linha.lucro.toFixed(2)}`);
    ok(`${rotulo}: margem ≈ ${alvo.margem}`, Math.abs((linha.margem ?? 0) - alvo.margem) < 0.0006, `obtido ${linha.margem}`);
  }
  ok(
    `ponto de equilíbrio ≈ ${cen.ponto_equilibrio_utilizacao}`,
    c.pontoEquilibrio !== null && Math.abs(c.pontoEquilibrio - cen.ponto_equilibrio_utilizacao) < 0.005,
    `obtido ${c.pontoEquilibrio}`
  );
  const linha85 = c.linhas.find((l) => l.utilizacao === 0.85)!;
  perto("85%: lucro/ano = lucro/mês × 12", linha85.lucroAno, linha85.lucro * 12, "total");
  perto("85%: lucro/van/mês = lucro ÷ 7 vans operacionais", linha85.lucroVeiculoMes, linha85.lucro / 7, "total");
  // Preço para o lucro alvo cai com a utilização: o fixo se dilui.
  const precos = c.linhas.map((l) => l.precoLucroAlvoKm);
  conferir("preço p/ lucro alvo decresce com a utilização", precos.every((p, i) => i === 0 || p <= precos[i - 1]), true);
}

console.log("\nPROPRIEDADES — a conta responde às premissas como deveria");
{
  const base = historicoSaoJoseDosPinhais().entrada;
  const r0 = simular(base);
  const maisDiesel = simular({ ...base, premissas: { ...base.premissas, variaveis: { ...base.premissas.variaveis, dieselLitro: base.premissas.variaveis.dieselLitro * 1.1 } } });
  ok("diesel +10% aumenta o custo", maisDiesel.totais.custoTotal > r0.totais.custoTotal);
  ok("diesel +10% não mexe no custo fixo", Math.abs(maisDiesel.itens[0].custoFixo - r0.itens[0].custoFixo) < 1e-6);
  const semReserva = simular({ ...base, premissas: { ...base.premissas, contrato: { ...base.premissas.contrato, reservaTecnicaPct: 0 } } });
  ok("sem reserva técnica o custo do veículo cai", semReserva.itens[0].veiculoMes < r0.itens[0].veiculoMes);
  const vazio = simular({ ...base, rotas: [] });
  conferir("sem rotas: nada a custar, nada quebra", [vazio.totais.custoTotal, vazio.itens[0].precoKm, vazio.cenarios.pontoEquilibrio], [0, 0, null]);
}

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
