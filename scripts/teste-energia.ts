// ENERGIA DOS VEÍCULOS — `npm run teste:energia`.
// Diesel, gasolina, etanol e elétrico usam a mesma conta (preço por unidade ÷
// km por unidade); o que muda é de onde vem o preço, a ARLA e o consumo.
import { energiaDoTexto, PRECO_ENERGIA_PADRAO, reconfigurarEletrico, reconfigurarHibrido, tipoHibridoDoTexto, trocarEnergia } from "../src/lib/simulador/energia";
import { ipvaSP } from "../src/lib/simulador/ipva";
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
ok("elétrico: preço do kWh pelo mix de recarga (90% garagem, 10% DC pública)", perto(vanEletrica.variaveis.dieselLitro, Number((0.9 * PRECO_ENERGIA_PADRAO.ELETRICO + 0.1 * 2.1).toFixed(4))));
ok("elétrico: carregador por veículo nas adaptações", vanEletrica.veiculo.adaptacaoValor === van.veiculo.adaptacaoValor + 7000);
ok("elétrico: sem ARLA", vanEletrica.variaveis.arlaKm === 0);
ok("elétrico: consumo em km/kWh da categoria", perto(vanEletrica.variaveis.consumoAsfaltoKmL, 3.3));
ok("original não muda", van.energia === "DIESEL" && van.variaveis.arlaKm > 0);
ok("elétrico: sem troca de óleo (só lavagem, R$ 0,02/km)", perto(vanEletrica.variaveis.oleoLavagemKm, 0.02));
ok("elétrico: manutenção sem óleo, filtros, embreagem (70%)", perto(vanEletrica.variaveis.manutencaoAsfaltoKm, van.variaveis.manutencaoAsfaltoKm * 0.7) && perto(vanEletrica.variaveis.manutencaoTerraKm, van.variaveis.manutencaoTerraKm * 0.7));
ok("elétrico: pneus gastam 20% a mais (peso e torque)", perto(vanEletrica.variaveis.pneusAsfaltoKm, van.variaveis.pneusAsfaltoKm * 1.2));
const deVolta = trocarEnergia(vanEletrica, "DIESEL", PRECO_ENERGIA_PADRAO, 0.04, 0.06);
ok("de volta ao diesel: ARLA volta", perto(deVolta.variaveis.arlaKm, 0.04));
ok("de volta ao diesel: óleo, manutenção e pneus a combustão voltam", perto(deVolta.variaveis.oleoLavagemKm, 0.06) && perto(deVolta.variaveis.manutencaoAsfaltoKm, van.variaveis.manutencaoAsfaltoKm) && perto(deVolta.variaveis.pneusAsfaltoKm, van.variaveis.pneusAsfaltoKm));

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
ok("tarifa da garagem vem da base (no mix de recarga)", perto(daBase.variaveis.dieselLitro, Number((0.9 * 0.82 + 0.1 * 2.1).toFixed(4))));
ok("consumo da frota em km/kWh", perto(daBase.variaveis.consumoAsfaltoKmL, 3.1));
ok("sem ARLA", daBase.variaveis.arlaKm === 0);
ok("sem troca de óleo e com a manutenção do elétrico", perto(daBase.variaveis.oleoLavagemKm, 0.02) && perto(daBase.variaveis.manutencaoAsfaltoKm, van.variaveis.manutencaoAsfaltoKm * 0.7));

console.log("\nHíbrido");
ok("texto: híbrido, plug-in e DM-i", energiaDoTexto("Song Pro DM-i") === "HIBRIDO" && energiaDoTexto("Híbrido") === "HIBRIDO" && energiaDoTexto("Plug-in hybrid") === "HIBRIDO" && energiaDoTexto("PHEV") === "HIBRIDO");
const carro = PERFIS_PADRAO.find((p) => p.tipo === "CARRO")!;
const carroHibrido = trocarEnergia(carro, "HIBRIDO", PRECO_ENERGIA_PADRAO, 0.04, 0.06);
ok("carro híbrido: gasolina, sem ARLA", perto(carroHibrido.variaveis.dieselLitro, PRECO_ENERGIA_PADRAO.GASOLINA) && carroHibrido.variaveis.arlaKm === 0);
ok("carro híbrido padrão: pleno (Toyota), rota urbana, +50% por litro", carroHibrido.hibrido?.tipo === "HEV" && perto(carroHibrido.variaveis.consumoAsfaltoKmL, carro.variaveis.consumoAsfaltoKmL * 1.5));
ok("híbrido pleno: óleo continua, manutenção igual à combustão, depreciação ×0,8", perto(carroHibrido.variaveis.oleoLavagemKm, carro.variaveis.oleoLavagemKm) && perto(carroHibrido.variaveis.manutencaoAsfaltoKm, carro.variaveis.manutencaoAsfaltoKm) && perto(carroHibrido.veiculo.depreciacaoAa, Number((carro.veiculo.depreciacaoAa * 0.8).toFixed(4))));
const rodoviario = reconfigurarHibrido(carroHibrido, { rota: "RODOVIARIO" }, PRECO_ENERGIA_PADRAO, 0.04);
ok("pleno na estrada: só +7%", perto(rodoviario.variaveis.consumoAsfaltoKmL, Number((carro.variaveis.consumoAsfaltoKmL * 1.07).toFixed(4))));
const plugin = reconfigurarHibrido(carroHibrido, { tipo: "PHEV", rota: "MISTO" }, PRECO_ENERGIA_PADRAO, 0.04);
ok("plug-in sem recarga, rota mista: +12%, manutenção ×1,35, depreciação ×1,3", perto(plugin.variaveis.consumoAsfaltoKmL, Number((carro.variaveis.consumoAsfaltoKmL * 1.12).toFixed(4))) && perto(plugin.variaveis.manutencaoAsfaltoKm, Number((carro.variaveis.manutencaoAsfaltoKm * 1.35).toFixed(4))) && perto(plugin.veiculo.depreciacaoAa, Number((carro.veiculo.depreciacaoAa * 1.3).toFixed(4))));
const recarregado = reconfigurarHibrido(plugin, { pctEletrico: 0.6 }, PRECO_ENERGIA_PADRAO, 0.04);
const custoKm = (x: typeof plugin) => x.variaveis.dieselLitro / x.variaveis.consumoAsfaltoKmL;
const esperado = 0.4 * (PRECO_ENERGIA_PADRAO.GASOLINA / (carro.variaveis.consumoAsfaltoKmL * 1.12)) + 0.6 * 0.23 * PRECO_ENERGIA_PADRAO.ELETRICO;
ok("plug-in com 60% do km no elétrico: custo por km é a mistura litro + kWh", Math.abs(custoKm(recarregado) - esperado) < 1e-3, `${custoKm(recarregado)} × ${esperado}`);
const etanol = reconfigurarHibrido(carroHibrido, { combustivel: "ETANOL" }, PRECO_ENERGIA_PADRAO, 0.04);
ok("flex a etanol: preço do etanol e 70% do rendimento", perto(etanol.variaveis.dieselLitro, PRECO_ENERGIA_PADRAO.ETANOL) && perto(etanol.variaveis.consumoAsfaltoKmL, Number((carro.variaveis.consumoAsfaltoKmL * 1.5 * 0.7).toFixed(4))));
ok("reconfigurar e voltar não acumula", perto(reconfigurarHibrido(plugin, { tipo: "HEV", rota: "URBANO" }, PRECO_ENERGIA_PADRAO, 0.04).variaveis.consumoAsfaltoKmL, carroHibrido.variaveis.consumoAsfaltoKmL));
const vanHibrida = trocarEnergia(van, "HIBRIDO", PRECO_ENERGIA_PADRAO, 0.04, 0.06);
ok("van híbrida: diesel, com ARLA, 20% a mais por litro", perto(vanHibrida.variaveis.dieselLitro, PRECO_ENERGIA_PADRAO.DIESEL) && vanHibrida.variaveis.arlaKm > 0 && perto(vanHibrida.variaveis.consumoAsfaltoKmL, van.variaveis.consumoAsfaltoKmL * 1.2));
const carroDeVolta = trocarEnergia(carroHibrido, "GASOLINA", PRECO_ENERGIA_PADRAO, 0.04, 0.06);
ok("híbrido de volta à gasolina: consumo e manutenção voltam", perto(carroDeVolta.variaveis.consumoAsfaltoKmL, carro.variaveis.consumoAsfaltoKmL) && perto(carroDeVolta.variaveis.manutencaoAsfaltoKm, carro.variaveis.manutencaoAsfaltoKm));
const hibridoParaEletrico = trocarEnergia(carroHibrido, "ELETRICO", PRECO_ENERGIA_PADRAO, 0.04, 0.06);
ok("híbrido para elétrico: manutenção do elétrico sobre a da combustão", perto(hibridoParaEletrico.variaveis.manutencaoAsfaltoKm, carro.variaveis.manutencaoAsfaltoKm * 0.7) && perto(hibridoParaEletrico.variaveis.consumoAsfaltoKmL, 6.5));
const [daBaseHibrido] = perfisDaBase({ ...base, veiculos: [{ id: "v2", chave: "carro|song|2026", fonte: "teste", vigenciaInicio: new Date(), tipo: "Carro", modelo: "Song Pro DM-i", combustivel: "Híbrido plug-in" }] });
ok("modelo da base \"Song Pro DM-i\" vira plug-in, gasolina, rendimento do plug-in sem recarga", daBaseHibrido.energia === "HIBRIDO" && daBaseHibrido.hibrido?.tipo === "PHEV" && perto(daBaseHibrido.variaveis.dieselLitro, PRECO_ENERGIA_PADRAO.GASOLINA) && perto(daBaseHibrido.variaveis.consumoAsfaltoKmL, Number((carro.variaveis.consumoAsfaltoKmL * 1.3).toFixed(4))));
ok("tipo de híbrido pelo texto", tipoHibridoDoTexto("Corolla Cross Hybrid") === "HEV" && tipoHibridoDoTexto("King DM-i") === "PHEV" && tipoHibridoDoTexto("Pulse Bio-Hybrid 12V") === "MHEV");

console.log("\nElétrico: depreciação e voltar");
const caro = trocarEnergia({ ...carro, veiculo: { ...carro.veiculo, valor: 300000 } }, "ELETRICO", PRECO_ENERGIA_PADRAO, 0.04, 0.02);
ok("elétrico premium (≥ R$ 200 mil) deprecia ×1,4", perto(caro.veiculo.depreciacaoAa, Number((carro.veiculo.depreciacaoAa * 1.4).toFixed(4))));
const devolta = trocarEnergia(caro, "GASOLINA", PRECO_ENERGIA_PADRAO, 0.04, 0.02);
ok("voltar à gasolina tira o carregador e a depreciação do elétrico", devolta.veiculo.adaptacaoValor === carro.veiculo.adaptacaoValor && perto(devolta.veiculo.depreciacaoAa, carro.veiculo.depreciacaoAa) && devolta.eletrico === undefined);
const mix = reconfigurarEletrico(caro, { garagemPct: 0.5, acPct: 0.2 }, PRECO_ENERGIA_PADRAO);
ok("mix de recarga 50% garagem, 20% AC, 30% DC", perto(mix.variaveis.dieselLitro, Number((0.5 * PRECO_ENERGIA_PADRAO.ELETRICO + 0.2 * 1.15 + 0.3 * 2.1).toFixed(4))) && mix.veiculo.adaptacaoValor === caro.veiculo.adaptacaoValor);

console.log("\nIPVA SP");
const i1 = ipvaSP({ valor: 200000, energia: "GASOLINA", anoInicio: 2027, vigenciaMeses: 12, depreciacaoAa: 0.1 });
ok("combustão: 4%", perto(i1.mediaAnual, 8000));
ok("locadora: 1%", perto(ipvaSP({ valor: 200000, energia: "GASOLINA", anoInicio: 2027, vigenciaMeses: 12, depreciacaoAa: 0.1, locadora: true }).mediaAnual, 2000));
const flex = ipvaSP({ valor: 200000, energia: "HIBRIDO", tipoHibrido: "HEV", hibridoFlex: true, anoInicio: 2026, vigenciaMeses: 48, depreciacaoAa: 0 });
ok("híbrido flex: 0%, 1%, 2%, 3% de 2026 a 2029", flex.anos.map((a) => a.aliquota).join() === "0,0.01,0.02,0.03");
const ev = ipvaSP({ valor: 200000, energia: "ELETRICO", anoInicio: 2030, vigenciaMeses: 24, depreciacaoAa: 0, capital: true });
ok("elétrico na capital: devolve metade até R$ 3.642 até 2030", perto(ev.anos[0].liquido, 8000 - 3642.08) && perto(ev.anos[1].liquido, 8000));
ok("ônibus e micro: 2%", perto(ipvaSP({ valor: 500000, energia: "DIESEL", onibusOuMicro: true, anoInicio: 2027, vigenciaMeses: 12, depreciacaoAa: 0 }).mediaAnual, 10000));

console.log("\nCusto real não se aplica ao elétrico");
const r = aplicarIndicadores(historicoSaoJoseDosPinhais().entrada.premissas, [vanEletrica, van], [
  { caminho: "perfil:VAN:variaveis.dieselLitro", rotulo: "Combustível pago — Van", valor: 6.4, unidade: "R$/l", base: "", periodo: "", amostra: 30, confianca: "ALTA", avisos: [] },
], ["perfil:VAN:variaveis.dieselLitro"], {});
ok("a van a diesel recebe o preço medido", perto(r.perfis[1].variaveis.dieselLitro, 6.4));
ok("a van elétrica fica com o R$/kWh do mix", perto(r.perfis[0].variaveis.dieselLitro, vanEletrica.variaveis.dieselLitro));

console.log("\nA conta");
const e = structuredClone(historicoSaoJoseDosPinhais().entrada);
e.premissas.perfis = [{ ...vanEletrica, codigo: "VE" }];
for (const rota of e.rotas) rota.perfilVeiculo = "VE";
const res = simular(e);
const km = res.itens.reduce((a, i) => a + i.kmRodado, 0);
const energia = res.itens.reduce((a, i) => a + i.diesel, 0);
ok("custo de energia por km rodado ≈ R$/kWh do mix ÷ km/kWh", km > 0 && Math.abs(energia / km - vanEletrica.variaveis.dieselLitro / 3.3) < 0.02, `${energia / km}`);
ok("sem ARLA na conta", res.itens.every((i) => i.arla === 0));

console.log(falhas === 0 ? "\nTudo certo.\n" : `\n${falhas} FALHA(S).\n`);
process.exit(falhas === 0 ? 0 : 1);
