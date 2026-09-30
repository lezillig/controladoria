// ENERGIA DOS VEÍCULOS — `npm run teste:energia`.
// Diesel, gasolina, etanol e elétrico usam a mesma conta (preço por unidade ÷
// km por unidade); o que muda é de onde vem o preço, a ARLA e o consumo.
import { energiaDoTexto, PRECO_ENERGIA_PADRAO, trocarEnergia } from "../src/lib/simulador/energia";
import { PERFIS_PADRAO, perfisDaBase } from "../src/lib/simulador/premissas";
import { aplicarIndicadores } from "../src/lib/simulador/aplicarReais";
import { simular } from "../src/lib/simulador/motor";
import { historicoSaoJoseDosPinhais } from "../src/lib/simulador/historico";
import type { BaseVigente } from "../src/lib/simulador/baseDeCustos";

let falhas = 0;
function ok(nome: string, cond: boolean, detalhe = "") {
  if (!cond) falhas++;
  console.log(`${cond ? "  ok  " : "FALHA "} ${nome}${cond ? "" : ` — ${detalhe}`}`);
}
const perto = (a: number, b: number) => Math.abs(a - b) < 1e-9;

console.log("\nTexto da frota");
ok("elétrico", energiaDoTexto("Elétrico (bateria)") === "ELETRICO");
ok("etanol / álcool", energiaDoTexto("Álcool") === "ETANOL" && energiaDoTexto("Etanol") === "ETANOL");
ok("gasolina e flex", energiaDoTexto("Gasolina") === "GASOLINA" && energiaDoTexto("Flex") === "GASOLINA");
ok("diesel S10", energiaDoTexto("Diesel S10") === "DIESEL");

console.log("\nTipos padrão");
ok("carro a gasolina, van a diesel", PERFIS_PADRAO.find((p) => p.tipo === "CARRO")?.energia === "GASOLINA" && PERFIS_PADRAO.find((p) => p.tipo === "VAN")?.energia === "DIESEL");
ok("carro adaptado herda a gasolina", PERFIS_PADRAO.find((p) => p.tipo === "CARRO_ADAPTADO")?.energia === "GASOLINA");

console.log("\nTrocar a energia de um tipo");
const van = PERFIS_PADRAO.find((p) => p.tipo === "VAN")!;
const vanEletrica = trocarEnergia(van, "ELETRICO", PRECO_ENERGIA_PADRAO, 0.04);
ok("elétrico: preço por kWh", perto(vanEletrica.variaveis.dieselLitro, PRECO_ENERGIA_PADRAO.ELETRICO));
ok("elétrico: sem ARLA", vanEletrica.variaveis.arlaKm === 0);
ok("elétrico: consumo em km/kWh da categoria", perto(vanEletrica.variaveis.consumoAsfaltoKmL, 3.3));
ok("original não muda", van.energia === "DIESEL" && van.variaveis.arlaKm > 0);
const deVolta = trocarEnergia(vanEletrica, "DIESEL", PRECO_ENERGIA_PADRAO, 0.04);
ok("de volta ao diesel: ARLA volta", perto(deVolta.variaveis.arlaKm, 0.04));

console.log("\nFrota da base");
const base: BaseVigente = {
  em: new Date(2026, 8, 30),
  parametros: new Map([["energia_rs_kwh", { valor: 0.82, texto: null, fonte: "teste", vigenciaInicio: new Date() }]]),
  veiculos: [{ id: "v1", chave: "van|e-sprinter|2026", fonte: "teste", vigenciaInicio: new Date(), tipo: "Van", modelo: "e-Sprinter", combustivel: "Elétrico", consumoKmL: 3.1 }],
  funcoes: [],
  pedagios: [],
};
const [daBase] = perfisDaBase(base);
ok("modelo elétrico da base vira perfil elétrico", daBase.energia === "ELETRICO");
ok("tarifa da recarga vem da base", perto(daBase.variaveis.dieselLitro, 0.82));
ok("consumo da frota em km/kWh", perto(daBase.variaveis.consumoAsfaltoKmL, 3.1));
ok("sem ARLA", daBase.variaveis.arlaKm === 0);

console.log("\nCusto real não se aplica ao elétrico");
const r = aplicarIndicadores(historicoSaoJoseDosPinhais().entrada.premissas, [vanEletrica, van], [
  { caminho: "perfil:VAN:variaveis.dieselLitro", rotulo: "Combustível pago — Van", valor: 6.4, unidade: "R$/l", base: "", periodo: "", amostra: 30, confianca: "ALTA", avisos: [] },
], ["perfil:VAN:variaveis.dieselLitro"], {});
ok("a van a diesel recebe o preço medido", perto(r.perfis[1].variaveis.dieselLitro, 6.4));
ok("a van elétrica fica com o R$/kWh", perto(r.perfis[0].variaveis.dieselLitro, PRECO_ENERGIA_PADRAO.ELETRICO));

console.log("\nA conta");
const e = structuredClone(historicoSaoJoseDosPinhais().entrada);
e.premissas.perfis = [{ ...vanEletrica, codigo: "VE" }];
for (const rota of e.rotas) rota.perfilVeiculo = "VE";
const res = simular(e);
const km = res.itens.reduce((a, i) => a + i.kmRodado, 0);
const energia = res.itens.reduce((a, i) => a + i.diesel, 0);
ok("custo de energia por km rodado ≈ R$/kWh ÷ km/kWh", km > 0 && Math.abs(energia / km - PRECO_ENERGIA_PADRAO.ELETRICO / 3.3) < 0.02, `${energia / km}`);
ok("sem ARLA na conta", res.itens.every((i) => i.arla === 0));

console.log(falhas === 0 ? "\nTudo certo.\n" : `\n${falhas} FALHA(S).\n`);
process.exit(falhas === 0 ? 0 : 1);
