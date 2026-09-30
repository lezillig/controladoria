// LEITURA DE NÚMEROS DIGITADOS — `npm run teste:numeros`.
// A regra única da tela e do servidor (src/lib/simulador/numeros.ts). Os dois
// erros que motivaram o teste: "2.000" lido como 2 (salário dividido por mil
// ao passar pelo campo) e "9.31" lido como 931 (lance multiplicado por cem).
import { lerDataHoraDeBrasilia, lerInteiro, lerNumero } from "../src/lib/simulador/numeros";

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

// Inteiros (colunas Int): o Prisma truncava "12,5" meses para 12 e a posição
// "1,5" para 1 sem avisar. Fracionário agora é recusado.
const inteiros: [string, number | null][] = [["12", 12], ["1.000", 1000], ["12,5", null], ["1.5", null], ["", null], ["doze", null], ["-3", -3]];
for (const [texto, esperado] of inteiros) {
  const lido = lerInteiro(texto);
  const ok = lido === esperado;
  if (!ok) falhas++;
  console.log(`${ok ? "  ok  " : "FALHA "} inteiro "${texto}" → ${lido}${ok ? "" : ` (esperado ${esperado})`}`);
}

// Data e hora do lance (datetime-local, sem fuso): é hora de Brasília. Com
// `new Date(texto)` no servidor em UTC, o lance das 10h virava 10h UTC (7h
// na tela). O resultado não pode depender do fuso do processo.
const datas: [string, string | null][] = [
  ["2026-09-30T10:00", "2026-09-30T13:00:00.000Z"],
  ["2026-09-30T23:30:15", "2026-10-01T02:30:15.000Z"],
  ["2026-02-30T10:00", null],
  ["2026-13-01T10:00", null],
  ["30/09/2026 10:00", null],
  ["", null],
];
for (const [texto, esperado] of datas) {
  const lido = lerDataHoraDeBrasilia(texto)?.toISOString() ?? null;
  const ok = lido === esperado;
  if (!ok) falhas++;
  console.log(`${ok ? "  ok  " : "FALHA "} data e hora "${texto}" → ${lido}${ok ? "" : ` (esperado ${esperado})`}`);
}
console.log(falhas === 0 ? "\nTudo certo.\n" : `\n${falhas} FALHA(S).\n`);
process.exit(falhas === 0 ? 0 : 1);
