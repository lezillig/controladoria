// RETOMADA DA SINCRONIZAÇÃO DO DIA APÓS ERRO — `npm run teste:retomada`.
//
// Em 04/11/2026 a execução do dia caiu por um defeito (valor de boleto acima
// do INT4) e, corrigido o defeito, o ciclo respondia "já concluído": ERRO
// contava como dia rodado. Sem banco: só a decisão de retomar.
import { INTERVALO_ENTRE_RETOMADAS_MS, MAXIMO_RETOMADAS, podeRetomarAposErro } from "../src/lib/controladoria/ciclo";
import { PREFIXO_RECUSA } from "../src/lib/omie/client";

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "  ok  " : "FALHA "} ${nome}` + (ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         obtido   ${JSON.stringify(real)}`));
}

const agora = Date.parse("2026-11-04T14:00:00Z");
const run = (p: Partial<Parameters<typeof podeRetomarAposErro>[0]> = {}) => ({
  status: "ERRO" as const,
  erro: "Invalid `prisma.omieTitulo.upsert()` invocation: Unable to fit integer value '7046588465' into an INT4",
  retomadas: 0,
  finalizadoEm: new Date(agora - INTERVALO_ENTRE_RETOMADAS_MS),
  backfill: false,
  ...p,
});

conferir("erro de execução do dia: retoma", podeRetomarAposErro(run(), agora), true);
conferir("concluída não é retomada", podeRetomarAposErro(run({ status: "CONCLUIDO" }), agora), false);
conferir("recusa da conta pela Omie não é retomada", podeRetomarAposErro(run({ erro: `${PREFIXO_RECUSA}: chave inválida` }), agora), false);
conferir("conexão desativada não é retomada", podeRetomarAposErro(run({ erro: "Conexão da execução não está mais ativa." }), agora), false);
conferir(`no máximo ${MAXIMO_RETOMADAS} retomadas no dia`, podeRetomarAposErro(run({ retomadas: MAXIMO_RETOMADAS }), agora), false);
conferir("espera o intervalo antes de tentar de novo", podeRetomarAposErro(run({ finalizadoEm: new Date(agora - 60_000) }), agora), false);
conferir("carga histórica tem a própria refeitura (não entra aqui)", podeRetomarAposErro(run({ backfill: true }), agora), false);

if (falhas) {
  console.log(`\n${falhas} falha(s).`);
  process.exit(1);
}
console.log("\nRetomada: tudo certo.");
