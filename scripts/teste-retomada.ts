// RETOMADA DA SINCRONIZAÇÃO DO DIA APÓS ERRO — `npm run teste:retomada`.
//
// Em 04/11/2026 a execução do dia caiu por um defeito (valor de boleto acima
// do INT4) e, corrigido o defeito, o ciclo respondia "já concluído": ERRO
// contava como dia rodado. Sem banco: só a decisão de retomar.
import { INTERVALO_ENTRE_RETOMADAS_MS, MAXIMO_RETOMADAS, aindaVaiRetomar, podeRetomarAposErro } from "../src/lib/controladoria/ciclo";
import { PREFIXO_RECUSA } from "../src/lib/omie/client";
import { syncPorConexao } from "../src/lib/controladoria/agents/administrativo";

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
// A consolidação do dia espera a empresa que ainda vai ser retomada (mesmo
// dentro do intervalo); a que esgotou as retomadas ou foi recusada não segura.
conferir("no intervalo: ainda vai retomar (a consolidação espera)", aindaVaiRetomar(run({ finalizadoEm: new Date(agora - 60_000) })), true);
conferir("esgotou as retomadas: não segura a consolidação", aindaVaiRetomar(run({ retomadas: MAXIMO_RETOMADAS })), false);
conferir("recusa da Omie: não segura a consolidação", aindaVaiRetomar(run({ erro: `${PREFIXO_RECUSA}: chave inválida` })), false);

// AD-SYNC-CONEXAO: a conexão que falha, a parada e a que NUNCA sincronizou.
{
  const hoje = new Date("2026-11-07T12:00:00Z");
  const cx = (apelido: string, criadoEm: string) => ({ apelido, criadoEm: new Date(criadoEm) }) as never;
  const exec = (status: string, quando: string) => ({ status, iniciadoEm: new Date(quando), finalizadoEm: new Date(quando), fase: "titulos", erro: status === "ERRO" ? "falhou" : null }) as never;
  const achados = syncPorConexao({
    conexoes: [cx("AZUL", "2026-01-01"), cx("MCZ", "2026-01-01"), cx("NOVA", "2026-11-01"), cx("RECEM", "2026-11-06")],
    ultimaExecucaoPorConexao: [exec("ERRO", "2026-11-07T06:00:00Z"), exec("CONCLUIDO", "2026-11-07T06:00:00Z"), null, null],
    agora: hoje,
    dataReferencia: new Date("2026-11-06T00:00:00"),
  } as never);
  conferir(
    "erro na AZUL; NOVA (ativa há 6 dias) nunca sincronizou; a recém-criada ainda não cobra",
    achados.map((a) => a.titulo),
    ["Sincronização da AZUL terminou em erro", "A NOVA nunca sincronizou"]
  );
}

if (falhas) {
  console.log(`\n${falhas} falha(s).`);
  process.exit(1);
}
console.log("\nRetomada: tudo certo.");
