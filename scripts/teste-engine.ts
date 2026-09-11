// TESTES DO FECHAMENTO AUTOMÁTICO — `npm run teste:engine`.
//
// Esta regra decide o que SOME da lista de achados sem ninguém mandar. Errar
// para um lado deixa a pilha crescer para sempre (foi o que aconteceu: 4.151
// em aberto e zero fechados em toda execução observada). Errar para o outro é
// pior — apaga da tela um problema que continua existindo.
//
// O defeito original era invisível porque a condição parecia correta lendo o
// código: ela exigia que o achado fosse de ESTADO e que o agente dono tivesse
// rodado bem. O problema era DE ONDE essas duas informações vinham — das
// emissões da rodada atual. Para uma regra que parou de disparar, que é
// justamente quando o fechamento deveria acontecer, não havia o que consultar.
import { podeFecharSozinho } from "../src/lib/controladoria/engine";

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(
    `${ok ? "  ok  " : "FALHA "} ${nome}${ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         obtido   ${JSON.stringify(real)}`}`
  );
}

const achado = (over: Partial<Parameters<typeof podeFecharSozinho>[0]> = {}) => ({
  status: "ABERTO",
  chave: "CP-VENCIDO|titulo-1",
  tipo: "ESTADO",
  agente: "contasPagar",
  ...over,
});

const NENHUMA = new Set<string>();
const TODOS_OK = ["contasPagar", "contasReceber", "conciliacao"];

// ------------------------------------------------- 1. o caso que estava quebrado
console.log("\n1. O caso que a versão anterior nunca fechava");
{
  // A regra parou de disparar POR COMPLETO — nenhum achado dela foi emitido
  // nesta rodada. É o cenário de "o problema foi resolvido", e era exatamente
  // o que a condição antiga não conseguia satisfazer, porque deduzia tipo e
  // agente das emissões que não existiam.
  conferir("regra que silenciou fecha os achados dela", podeFecharSozinho(achado(), NENHUMA, TODOS_OK), true);
}
{
  // Variante: a regra continua disparando para OUTRAS entidades, e só este
  // título saiu. Funcionava antes e precisa continuar funcionando.
  const outras = new Set(["CP-VENCIDO|titulo-99"]);
  conferir("título que saiu enquanto a regra segue ativa", podeFecharSozinho(achado(), outras, TODOS_OK), true);
}

// ------------------------------------------------- 2. o que não pode fechar
console.log("\n2. O que não pode fechar sozinho");
{
  const emitidas = new Set(["CP-VENCIDO|titulo-1"]);
  conferir("condição ainda detectada não fecha", podeFecharSozinho(achado(), emitidas, TODOS_OK), false);
}
{
  // FATO CONSUMADO. Um pagamento em duplicidade não deixa de ter acontecido
  // porque não apareceu na leitura de hoje.
  conferir("evento não fecha sozinho", podeFecharSozinho(achado({ tipo: "EVENTO" }), NENHUMA, TODOS_OK), false);
}
{
  // AGENTE QUEBRADO. O silêncio dele não é prova de que o problema acabou — é
  // ausência de informação. Fechar aqui apagaria da tela um problema vivo, que
  // é o erro mais caro que esta regra pode cometer.
  const semOAgente = ["contasReceber", "conciliacao"];
  conferir("agente que falhou não fecha nada", podeFecharSozinho(achado(), NENHUMA, semOAgente), false);
}
{
  conferir("nenhum agente ok, nada fecha", podeFecharSozinho(achado(), NENHUMA, []), false);
}

// ------------------------------------------------- 3. tratativa humana
console.log("\n3. Tratativa humana é intocável");
for (const status of ["RESOLVIDO", "IGNORADO", "OBSOLETO"]) {
  conferir(
    `${status} não é mexido por máquina`,
    podeFecharSozinho(achado({ status }), NENHUMA, TODOS_OK),
    false
  );
}
{
  // EM_ANALISE fecha: alguém começou a olhar, mas a condição sumiu antes de
  // haver tratativa registrada. Não há trabalho humano a preservar — há um
  // achado que deixou de existir.
  conferir("em análise fecha se a condição sumiu", podeFecharSozinho(achado({ status: "EM_ANALISE" }), NENHUMA, TODOS_OK), true);
}

console.log(falhas === 0 ? "\nTodos os testes passaram.\n" : `\n${falhas} FALHA(S).\n`);
process.exit(falhas === 0 ? 0 : 1);
