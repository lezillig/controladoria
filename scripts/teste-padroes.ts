// TESTES DAS REGRAS DE PADRÃO — `npm run teste:padroes`.
//
// Estas quatro regras acusam pessoas. "Recebeu e desapareceu" e "passou a ser
// pago antes do vencimento" são frases que, ditas sobre a pessoa errada,
// custam mais do que o achado valeria — e um erro de sinal aqui não quebra
// nada, só aponta para o lado contrário em silêncio.
//
// Por isso metade dos casos abaixo testa o que NÃO deve virar achado: o
// fornecedor que sempre foi caro, o que ainda está ativo, o reajuste que era
// só um pico, o pagamento adiantado que sempre foi adiantado.
import {
  foraDoPadrao,
  fornecedorEfemero,
  prazoAntecipado,
  reajusteSilencioso,
} from "../src/lib/controladoria/agents/padroes";
import type { SerieMensal } from "../src/lib/controladoria/historico";

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(
    `${ok ? "  ok  " : "FALHA "} ${nome}${ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         obtido   ${JSON.stringify(real)}`}`
  );
}

const MATERIALIDADE = 50_000; // R$ 500

// Monta uma série mensal. `dias` é a soma de (baixa − vencimento): negativo é
// pagamento adiantado.
function serie(
  chave: string,
  meses: { competencia: string; valor: number; baixas?: number; dias?: number }[]
): SerieMensal[] {
  return meses.map((m) => ({
    chave,
    rotulo: `Fornecedor ${chave}`,
    competencia: m.competencia,
    titulos: 1,
    valorCents: m.valor,
    valorMaximoCents: m.valor,
    baixas: m.baixas ?? 1,
    valorBaixadoCents: m.valor,
    diasPagamentoSoma: m.dias ?? 0,
  }));
}

// Doze meses de 2025 com o mesmo valor, mais o mês corrente.
function mensal(chave: string, valor: number, atual: number, dias = 0): SerieMensal[] {
  const meses = Array.from({ length: 12 }, (_, i) => ({
    competencia: `2025-${String(i + 1).padStart(2, "0")}`,
    valor,
    dias,
  }));
  return serie(chave, [...meses, { competencia: "2026-01", valor: atual, dias }]);
}

// ------------------------------------------------- 1. fora do padrão
console.log("\n1. HI-FORA-DO-PADRAO");
{
  const r = foraDoPadrao(mensal("A", 100_000, 900_000), "2026-01", MATERIALIDADE);
  conferir("nove vezes o padrão vira achado", r.length, 1);
  // O VALOR É O EXCEDENTE, não o total. Chamar os R$ 9.000 de "valor em jogo"
  // inflaria o impacto de todo achado desta regra — o padrão do fornecedor é
  // despesa esperada.
  conferir("o valor é o excedente sobre o padrão", r[0]?.valorCents, 800_000);
}
{
  const r = foraDoPadrao(mensal("B", 100_000, 105_000), "2026-01", MATERIALIDADE);
  conferir("variação pequena não vira achado", r.length, 0);
}
{
  // FORNECEDOR QUE SEMPRE FOI CARO. O valor absoluto é alto, mas é o padrão
  // dele — e é exatamente o caso que um limiar fixo acusaria todo mês.
  const r = foraDoPadrao(mensal("C", 5_000_000, 5_100_000), "2026-01", MATERIALIDADE);
  conferir("caro de sempre não é desvio", r.length, 0);
}
{
  const curto = serie("D", [
    { competencia: "2025-11", valor: 100_000 },
    { competencia: "2025-12", valor: 100_000 },
    { competencia: "2026-01", valor: 900_000 },
  ]);
  conferir("histórico curto não conclui nada", foraDoPadrao(curto, "2026-01", MATERIALIDADE).length, 0);
}
{
  // O mês corrente NÃO pode entrar na própria base de comparação: se entrasse,
  // um valor absurdo o bastante puxaria a mediana e deixaria de ser absurdo.
  const r = foraDoPadrao(mensal("E", 100_000, 10_000_000), "2026-01", MATERIALIDADE);
  conferir("o mês sob suspeita não entra no próprio padrão", r[0]?.valorCents, 9_900_000);
}

// ------------------------------------------------- 2. fornecedor efêmero
console.log("\n2. HI-FORNECEDOR-EFEMERO");
{
  const r = fornecedorEfemero(
    serie("F", [
      { competencia: "2025-03", valor: 400_000 },
      { competencia: "2025-04", valor: 500_000 },
    ]),
    "2026-01",
    MATERIALIDADE
  );
  conferir("dois meses, valor alto, sumiu", r.length, 1);
  conferir("valor é o total recebido", r[0]?.valorCents, 900_000);
}
{
  // AINDA ATIVO não é efêmero — é fornecedor novo, que tem regra própria.
  const r = fornecedorEfemero(
    serie("G", [
      { competencia: "2025-12", valor: 400_000 },
      { competencia: "2026-01", valor: 500_000 },
    ]),
    "2026-01",
    MATERIALIDADE
  );
  conferir("quem ainda fatura não sumiu", r.length, 0);
}
{
  const r = fornecedorEfemero(
    serie("H", [{ competencia: "2025-03", valor: 1_000 }]),
    "2026-01",
    MATERIALIDADE
  );
  conferir("valor irrelevante não vira achado", r.length, 0);
}
{
  const r = fornecedorEfemero(mensal("I", 400_000, 400_000), "2026-01", MATERIALIDADE);
  conferir("fornecedor recorrente não é efêmero", r.length, 0);
}

// ------------------------------------------------- 3. reajuste silencioso
console.log("\n3. HI-REAJUSTE-SILENCIOSO");
{
  // Doze meses a R$ 1.000, depois três a R$ 1.500 — o patamar mudou e ficou.
  const meses = [
    ...Array.from({ length: 12 }, (_, i) => ({
      competencia: `2025-${String(i + 1).padStart(2, "0")}`,
      valor: 100_000,
    })),
    { competencia: "2026-01", valor: 150_000 },
    { competencia: "2026-02", valor: 150_000 },
    { competencia: "2026-03", valor: 150_000 },
  ];
  const r = reajusteSilencioso(serie("J", meses), "2026-03", MATERIALIDADE);
  conferir("degrau de 50% que ficou vira achado", r.length, 1);
  // O valor é o custo ANUALIZADO: é o número de quem vai renegociar, não a
  // diferença de um mês.
  conferir("valor é a diferença projetada em doze meses", r[0]?.valorCents, 600_000);
}
{
  // PICO, não patamar: um mês alto e voltou. Isso é assunto de
  // HI-FORA-DO-PADRAO, não desta regra.
  const meses = [
    ...Array.from({ length: 12 }, (_, i) => ({
      competencia: `2025-${String(i + 1).padStart(2, "0")}`,
      valor: 100_000,
    })),
    { competencia: "2026-01", valor: 100_000 },
    { competencia: "2026-02", valor: 500_000 },
    { competencia: "2026-03", valor: 100_000 },
  ];
  const r = reajusteSilencioso(serie("K", meses), "2026-03", MATERIALIDADE);
  conferir("pico isolado não é reajuste", r.length, 0);
}
{
  const meses = [
    ...Array.from({ length: 12 }, (_, i) => ({
      competencia: `2025-${String(i + 1).padStart(2, "0")}`,
      valor: 100_000,
    })),
    { competencia: "2026-01", valor: 105_000 },
    { competencia: "2026-02", valor: 105_000 },
    { competencia: "2026-03", valor: 105_000 },
  ];
  conferir("reajuste de 5% não alarma", reajusteSilencioso(serie("L", meses), "2026-03", MATERIALIDADE).length, 0);
}

// ------------------------------------------------- 4. prazo antecipado
console.log("\n4. HI-PRAZO-ANTECIPADO");
{
  // Doze meses pago 3 dias DEPOIS do vencimento, depois três meses 10 dias
  // ANTES. A ordem da fila mudou.
  const meses = [
    ...Array.from({ length: 12 }, (_, i) => ({
      competencia: `2025-${String(i + 1).padStart(2, "0")}`,
      valor: 100_000,
      dias: 3,
    })),
    { competencia: "2026-01", valor: 100_000, dias: -10 },
    { competencia: "2026-02", valor: 100_000, dias: -10 },
    { competencia: "2026-03", valor: 100_000, dias: -10 },
  ];
  const r = prazoAntecipado(serie("M", meses), "2026-03", MATERIALIDADE);
  conferir("mudança de prazo vira achado", r.length, 1);
  conferir("valor é o pago no período recente", r[0]?.valorCents, 300_000);
}
{
  // SEMPRE FOI ADIANTADO. Não houve mudança — e é a diferença entre um padrão
  // e um desvio. Sem este caso, a regra acusaria todo fornecedor com desconto
  // por antecipação negociado em contrato.
  const meses = Array.from({ length: 15 }, (_, i) => ({
    competencia: i < 12 ? `2025-${String(i + 1).padStart(2, "0")}` : `2026-${String(i - 11).padStart(2, "0")}`,
    valor: 100_000,
    dias: -10,
  }));
  conferir("sempre adiantado não é mudança", prazoAntecipado(serie("N", meses), "2026-03", MATERIALIDADE).length, 0);
}
{
  // Passou a pagar mais CEDO, mas só dois dias. Ruído de calendário — feriado,
  // fim de semana, fechamento de lote.
  const meses = [
    ...Array.from({ length: 12 }, (_, i) => ({
      competencia: `2025-${String(i + 1).padStart(2, "0")}`,
      valor: 100_000,
      dias: 1,
    })),
    { competencia: "2026-01", valor: 100_000, dias: -2 },
    { competencia: "2026-02", valor: 100_000, dias: -2 },
    { competencia: "2026-03", valor: 100_000, dias: -2 },
  ];
  conferir("dois dias é ruído de calendário", prazoAntecipado(serie("O", meses), "2026-03", MATERIALIDADE).length, 0);
}

console.log(falhas === 0 ? "\nTodos os testes passaram.\n" : `\n${falhas} FALHA(S).\n`);
process.exit(falhas === 0 ? 0 : 1);
