// TESTES DE DATA E FUSO — `npm run teste:datas`.
//
// O defeito que motivou este arquivo: TODA data do sistema aparecia um dia
// antes. Vencimento em 30/09 saía 29/09; o cabeçalho do painel anunciava
// "dados de 22/09" no dia em que a referência era 23/09.
//
// A causa é a confusão entre DIA DE CALENDÁRIO e INSTANTE — os dois são
// `Date` em JavaScript. O sistema guarda dia como meia-noite do fuso do
// servidor (UTC na Vercel), e o formatador lia em America/Sao_Paulo: três
// horas para trás, um dia a menos.
//
// Nada disso quebra teste de função, aparece em tipo ou derruba build. Só
// aparece na tela, e só para quem conferir contra a Omie — que é a pior
// forma de um sistema de auditoria errar. Por isso o invariante fica preso
// aqui, com o fuso do processo forçado nos dois cenários que importam.
import { fmtData, fmtDataHora, fmtDiaDoInstante } from "../src/lib/controladoria/format";
import { inicioDoDia, fimDoMes, inicioDoMes } from "../src/lib/controladoria/periodos";
import { dataReferenciaPadrao } from "../src/lib/controladoria/ciclo";

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(
    `${ok ? "  ok  " : "FALHA "} ${nome}` +
      (ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         obtido   ${JSON.stringify(real)}`)
  );
}

console.log(`\n(fuso do processo: ${Intl.DateTimeFormat().resolvedOptions().timeZone})`);

console.log("\n1. Dia de calendário aparece no dia certo");
{
  // Construído como o resto do sistema constrói: meia-noite do fuso do servidor.
  conferir("vencimento 30/09 não vira 29/09", fmtData(inicioDoDia(new Date(2026, 8, 30))), "30/09/2026");
  conferir("primeiro dia do mês", fmtData(inicioDoMes(new Date(2026, 8, 15))), "01/09/2026");
  conferir("último dia do mês, com hora cheia", fmtData(fimDoMes(new Date(2026, 8, 1))), "30/09/2026");
  conferir("virada de ano", fmtData(inicioDoDia(new Date(2026, 0, 1))), "01/01/2026");
  // 1º de março: o dia seguinte ao fim de fevereiro, onde o erro de um dia
  // mudaria o mês inteiro.
  conferir("virada de mês em fevereiro", fmtData(inicioDoDia(new Date(2026, 2, 1))), "01/03/2026");
}

console.log("\n2. D-1 em Brasília, e a tela concorda com ele");
{
  // 08:47 em Brasília do dia 24 → a referência é o dia 23.
  const manha = new Date("2026-09-24T11:47:00Z");
  conferir("de manhã, D-1 é o dia anterior", fmtData(dataReferenciaPadrao(manha)), "23/09/2026");

  // 00:30 em Brasília do dia 24 (03:30 UTC) — ainda dia 24 lá, D-1 = 23.
  // É a janela em que o deslocamento manual de −3 h errava.
  const madrugada = new Date("2026-09-24T03:30:00Z");
  conferir("depois da meia-noite em Brasília, D-1 é o mesmo", fmtData(dataReferenciaPadrao(madrugada)), "23/09/2026");

  // 22:00 em Brasília do dia 23 = 01:00 UTC do dia 24. Em Brasília ainda é 23,
  // então D-1 = 22 — e ler o dia em UTC aqui daria 23, um dia à frente.
  const noite = new Date("2026-09-24T01:00:00Z");
  conferir("à noite, ainda é o dia anterior em Brasília", fmtData(dataReferenciaPadrao(noite)), "22/09/2026");
}

console.log("\n3. Instante é outra coisa, e continua lido em Brasília");
{
  const instante = new Date("2026-09-24T11:47:00Z"); // 08:47 em Brasília
  conferir("hora local de quem operou", fmtDataHora(instante), "24/09/2026, 08:47");
  conferir("o dia do instante", fmtDiaDoInstante(instante), "24/09/2026");

  // 01:00 UTC do dia 25 = 22:00 do dia 24 em Brasília. Para quem operou, foi
  // dia 24 — e é isso que um registro de "quando aconteceu" tem que dizer.
  const noite = new Date("2026-09-25T01:00:00Z");
  conferir("noite em Brasília não vira o dia seguinte", fmtDiaDoInstante(noite), "24/09/2026");
}

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTodos os testes passaram.");
process.exit(falhas ? 1 : 0);
