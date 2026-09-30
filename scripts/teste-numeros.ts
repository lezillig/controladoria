// LEITURA DE NÚMEROS DIGITADOS — `npm run teste:numeros`.
// A regra única da tela e do servidor (src/lib/simulador/numeros.ts). Os dois
// erros que motivaram o teste: "2.000" lido como 2 (salário dividido por mil
// ao passar pelo campo) e "9.31" lido como 931 (lance multiplicado por cem).
import { lerNumero } from "../src/lib/simulador/numeros";

const casos: [string, number | null][] = [
  ["2.000", 2000], ["3.450", 3450], ["1.234.567", 1234567], ["3450", 3450], ["3.450,50", 3450.5],
  ["6,05", 6.05], ["6.05", 6.05], ["9.31", 9.31], ["0.85", 0.85], ["R$ 2.950,00", 2950], ["85%", 85],
  ["", null], ["abc", null], ["doze", null], ["-3", -3], ["12.5", 12.5], ["-1.500", -1500],
];
let falhas = 0;
for (const [texto, esperado] of casos) {
  const lido = lerNumero(texto);
  const ok = lido === esperado;
  if (!ok) falhas++;
  console.log(`${ok ? "  ok  " : "FALHA "} "${texto}" → ${lido}${ok ? "" : ` (esperado ${esperado})`}`);
}
console.log(falhas === 0 ? "\nTudo certo.\n" : `\n${falhas} FALHA(S).\n`);
process.exit(falhas === 0 ? 0 : 1);
