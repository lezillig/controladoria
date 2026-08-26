// TESTES DO RESUMO MENSAL — `npm run teste:historico`.
//
// Este módulo já produziu três defeitos em produção, e os três tinham a mesma
// origem: SQL cru não passa pelo compilador, e o que não é SQL nunca tinha sido
// exercitado. As partes puras — recorte do mês, baseline, desvio — passam a ser
// testadas aqui, onde uma conta errada aparece em um segundo em vez de num
// ciclo de meia hora.
//
// O que estes testes NÃO cobrem, e é honesto dizer: as três consultas. Elas só
// falam a verdade contra um Postgres de verdade. É por isso que a chamada delas
// vive dentro de try/catch no ciclo, e por isso existe o botão de recalcular.
import {
  competenciaAnterior,
  competenciasDaJanela,
  desvioDoPadrao,
  faixaDaCompetencia,
  montarBaselines,
  type SerieMensal,
} from "../src/lib/controladoria/historico";

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(
    `${ok ? "  ok  " : "FALHA "} ${nome}${ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         obtido   ${JSON.stringify(real)}`}`
  );
}

const dia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ------------------------------------------------- 1. recorte do mês
//
// O filtro do recálculo passou a ser por FAIXA DE DATA para poder usar índice.
// Se a faixa estiver errada, o resumo do mês fica errado — e ninguém percebe,
// porque um número plausível não levanta suspeita.
console.log("\n1. Faixa de datas de uma competência");
{
  const { inicio, fim } = faixaDaCompetencia("2021-03");
  conferir("começa no dia 1", dia(inicio), "2021-03-01");
  // O fim é o dia 1 do mês SEGUINTE, e a comparação no SQL é `< fim`: assim
  // título gravado às 23h do dia 31 não fica de fora.
  conferir("termina no dia 1 do mês seguinte", dia(fim), "2021-04-01");
}
{
  const { inicio, fim } = faixaDaCompetencia("2021-12");
  conferir("dezembro vira janeiro do ano seguinte", dia(fim), "2022-01-01");
  conferir("e começa certo", dia(inicio), "2021-12-01");
}
{
  // Fevereiro bissexto: o dia 29 precisa estar DENTRO da faixa.
  const { fim } = faixaDaCompetencia("2024-02");
  conferir("fevereiro bissexto inclui o dia 29", dia(fim), "2024-03-01");
}

// ------------------------------------------------- 2. competências de uma janela
console.log("\n2. Competências que uma janela toca");
conferir(
  "janela de backfill é um mês só",
  competenciasDaJanela(new Date(2021, 2, 1), new Date(2021, 2, 31)),
  ["2021-03"]
);
// A janela diária cobre D-3, e virando o mês encosta em dois. Recalcular só o
// mês do fim deixaria os últimos dias do mês anterior com o resumo velho para
// sempre — nenhuma janela seguinte volta lá.
conferir(
  "janela que vira o mês toca os dois",
  competenciasDaJanela(new Date(2021, 2, 30), new Date(2021, 3, 2)),
  ["2021-03", "2021-04"]
);
conferir(
  "janela de um ano devolve doze",
  competenciasDaJanela(new Date(2021, 0, 1), new Date(2021, 11, 31)).length,
  12
);

// ------------------------------------------------- 3. competência anterior
console.log("\n3. Competência anterior");
conferir("um mês atrás", competenciaAnterior("2026-08"), "2026-07");
conferir("virando o ano", competenciaAnterior("2026-01"), "2025-12");
conferir("doze meses atrás é o mesmo mês", competenciaAnterior("2026-08", 12), "2025-08");
conferir("treze meses atrás", competenciaAnterior("2026-01", 13), "2024-12");

// ------------------------------------------------- 4. baseline
const serie = (chave: string, valores: [string, number][]): SerieMensal[] =>
  valores.map(([competencia, valorCents]) => ({
    chave,
    rotulo: `Fornecedor ${chave}`,
    competencia,
    titulos: 1,
    valorCents,
    valorMaximoCents: valorCents,
    baixas: 1,
    diasPagamentoSoma: 0,
  }));

console.log("\n4. Baseline por chave");
{
  const linhas = serie("A", [
    ["2026-01", 100_000],
    ["2026-02", 100_000],
    ["2026-03", 110_000],
    ["2026-04", 90_000],
    ["2026-05", 100_000],
    ["2026-06", 100_000],
  ]);
  const b = montarBaselines(linhas).get("A")!;
  conferir("seis meses bastam", b.meses, 6);
  conferir("mediana ignora o extremo", b.medianaCents, 100_000);
  conferir("guarda o intervalo coberto", [b.primeiraCompetencia, b.ultimaCompetencia], ["2026-01", "2026-06"]);
}
{
  // Amostra pequena não é padrão. Cinco meses de um fornecedor novo não
  // autorizam afirmar "sempre foi assim" — e é disso que um achado depende.
  const b = montarBaselines(serie("B", [["2026-01", 1], ["2026-02", 1], ["2026-03", 1]]));
  conferir("menos de seis meses não gera baseline", b.size, 0);
}

// ------------------------------------------------- 5. desvio do padrão
//
// A escolha de MAD no lugar do desvio padrão é o coração desta camada: o desvio
// padrão é puxado pelo próprio ponto fora da curva que se procura.
console.log("\n5. Desvio do padrão");
{
  const b = montarBaselines(
    serie("C", [
      ["2026-01", 100_000],
      ["2026-02", 110_000],
      ["2026-03", 90_000],
      ["2026-04", 100_000],
      ["2026-05", 105_000],
      ["2026-06", 95_000],
    ])
  ).get("C")!;
  conferir("no padrão, desvio zero", desvioDoPadrao(100_000, b), 0);
  conferir("acima do padrão dá positivo", desvioDoPadrao(150_000, b) > 5, true);
  conferir("abaixo dá negativo", desvioDoPadrao(50_000, b) < -5, true);
}
{
  // MENSALIDADE FIXA — o caso que quebraria a conta. Todo mês igual dá MAD
  // zero, e dividir por zero faria um centavo de variação virar achado
  // crítico. Com MAD zero a comparação passa a ser proporcional à mediana.
  const b = montarBaselines(
    serie("D", [
      ["2026-01", 100_000],
      ["2026-02", 100_000],
      ["2026-03", 100_000],
      ["2026-04", 100_000],
      ["2026-05", 100_000],
      ["2026-06", 100_000],
    ])
  ).get("D")!;
  conferir("mensalidade fixa tem MAD zero", b.madCents, 0);
  conferir("e não vira infinito", Number.isFinite(desvioDoPadrao(300_000, b)), true);
  conferir("triplicou = 20 desvios", desvioDoPadrao(300_000, b), 20);
  conferir("um centavo a mais não é achado", Math.abs(desvioDoPadrao(100_001, b)) < 0.001, true);
}

console.log(falhas === 0 ? "\nTodos os testes passaram.\n" : `\n${falhas} FALHA(S).\n`);
process.exit(falhas === 0 ? 0 : 1);
