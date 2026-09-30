// CALCULADORAS DE MÃO DE OBRA — `npm run teste:mao-de-obra`.
// Encargos por grupos contra a referência GEIPOT e fator de utilização
// contra os exemplos da pesquisa (docs/simulador_custos/PESQUISA.md, 3.4–3.5).
import { camposParaCompletar, sugestaoDaFuncao } from "../src/lib/simulador/convencoes";
import { calcularEncargos, ENCARGOS_PADRAO, fatorDeUtilizacao, FU_PADRAO, PRESETS_ENCARGOS } from "../src/lib/simulador/maoDeObra";

let falhas = 0;
function ok(nome: string, cond: boolean, detalhe = "") {
  if (!cond) falhas++;
  console.log(`${cond ? "  ok  " : "FALHA "} ${nome}${cond ? "" : ` — ${detalhe}`}`);
}
const perto = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

console.log("\nEncargos");
const normal = calcularEncargos(ENCARGOS_PADRAO);
const grupo = (g: string) => normal.grupos.find((x) => x.grupo === g)!.total;
ok("Grupo A normal = 36,8% (GEIPOT)", perto(grupo("A"), 0.368, 1e-9), String(grupo("A")));
ok("Grupo B sem férias no modo FU ≈ 13%", perto(grupo("B"), 0.1297, 0.001), String(grupo("B")));
ok("Grupo D = A × B", perto(grupo("D"), grupo("A") * grupo("B"), 1e-12));
ok("total na faixa de referência (60–66%)", normal.total > 0.6 && normal.total < 0.66, String(normal.total));
const posto = calcularEncargos({ ...ENCARGOS_PADRAO, modo: "POSTO" });
ok("modo posto soma as férias no Grupo B", perto(posto.grupos[1].total - grupo("B"), 1 / 12, 1e-9));
const simples = calcularEncargos({ ...ENCARGOS_PADRAO, ...PRESETS_ENCARGOS.SIMPLES.valores });
ok("Simples: Grupo A só com FGTS", perto(simples.grupos[0].total, 0.08, 1e-9), String(simples.grupos[0].total));
ok("resumo cita os quatro grupos", /A .* \+ B .* \+ C .* \+ D .* = /.test(normal.resumo), normal.resumo);

console.log("\nFator de utilização");
const dezHoras = fatorDeUtilizacao({ ...FU_PADRAO, somarAcrescimos: false });
ok("10 h × 22 dias em 44 h = 1,0 motorista", perto(dezHoras.fuSemHoraExtra, 1, 1e-9), String(dezHoras.fuSemHoraExtra));
const plantao = fatorDeUtilizacao({ horasPorDia: 24, diasPorMes: 30.4, jornada: "12X36", somarAcrescimos: true, folgasPct: 0, feriasPct: 1 / 11, reservaPct: 0.0186 });
ok("posto 24 h em 12x36 ≈ 4,4 motoristas", perto(plantao.fuFinal, 4.4, 0.15), String(plantao.fuFinal));
const doze = fatorDeUtilizacao({ horasPorDia: 12, diasPorMes: 30.4, jornada: "12X36", somarAcrescimos: true, folgasPct: 0, feriasPct: 1 / 11, reservaPct: 0.0186 });
ok("posto 12 h em 12x36 ≈ 2,2 motoristas", perto(doze.fuFinal, 2.2, 0.1), String(doze.fuFinal));
const comHE = fatorDeUtilizacao({ ...FU_PADRAO, horasPorDia: 11, somarAcrescimos: false });
ok("11 h/dia: 1 motorista inteiro + 22 h extras", comHE.motoristasInteiros === 1 && perto(comHE.horasExtrasPorMotorista, 22, 1e-9), JSON.stringify(comHE));
ok("sem acréscimos, FU final = FU sem hora extra", perto(comHE.fuFinal, comHE.fuSemHoraExtra, 1e-12));

console.log("\nCONVENÇÃO DA FUNÇÃO (completar a linha da base)");
const sug = ["Motorista de carro", "Motorista de van", "Motorista de micro-ônibus", "Motorista de ônibus", "Auxiliar administrativo"].map((funcao) => ({ rotulo: funcao, campos: { funcao } }));
const da = (f: string) => sugestaoDaFuncao(f, sug, "funcao")?.rotulo ?? null;
ok("nome igual, sem acento e caixa", da("MOTORISTA DE ONIBUS") === "Motorista de ônibus");
ok("pela palavra: van", da("Motorista Van 15 lugares") === "Motorista de van");
ok("micro antes de ônibus", da("Motorista micro-ônibus") === "Motorista de micro-ônibus");
ok("ônibus não pega micro", da("Motorista ônibus rodoviário") === "Motorista de ônibus");
ok("administrativo", da("Aux. adm") === "Auxiliar administrativo");
ok("sem correspondência: nada", da("Mecânico") === null && da("") === null);
const conv = { campos: { funcao: "Motorista de van", salarioBase: 2986.75, cesta: 190, vrDia: 42, planoSaude: 333.76 } };
const tabela = ["funcao", "salarioBase", "cesta", "vrVa", "vrDia", "planoSaude"];
const chaves = (v: Record<string, unknown>) => camposParaCompletar(v, conv, "funcao", tabela).map(([k]) => k).join(",");
ok("completa só o vazio", chaves({ funcao: "Motorista de van", salarioBase: 3100, cesta: null }) === "cesta,vrDia,planoSaude");
ok("VR/VA mensal na linha: não põe VR por dia", chaves({ funcao: "Motorista de van", vrVa: 1092 }) === "salarioBase,cesta,planoSaude");

console.log(falhas === 0 ? "\nTudo certo.\n" : `\n${falhas} FALHA(S).\n`);
process.exit(falhas === 0 ? 0 : 1);
