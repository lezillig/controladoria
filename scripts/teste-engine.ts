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
import { chaveDeTratativa, tratativaAnterior, type HistoricoAchado } from "../src/lib/controladoria/supervisor";

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
  agente: "contas-pagar",
  ...over,
});

const NENHUMA = new Set<string>();
const TODOS_OK = ["contas-pagar", "contas-receber", "conciliacao"];

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
  // porque não apareceu na leitura de hoje — sem janela informada, vale a
  // regra estrita.
  conferir("evento não fecha sozinho sem janela", podeFecharSozinho(achado({ tipo: "EVENTO" }), NENHUMA, TODOS_OK), false);
}
{
  // REAVALIAÇÃO DENTRO DA JANELA. O agente releu o mesmo período, rodou bem
  // e não apontou o fato: ou o dado foi corrigido na Omie ou a regra foi
  // recalibrada. É o que fecha os 766 recebimentos a menor que a regra
  // corrigida deixou de emitir.
  const janela = { desde: new Date("2025-01-01") };
  const dentro = achado({ tipo: "EVENTO", dataReferencia: new Date("2026-03-10") });
  conferir("evento dentro da janela reavaliada fecha", podeFecharSozinho(dentro, NENHUMA, TODOS_OK, janela), true);
  // Fato que ficou para trás da janela: ninguém o reavaliou nesta rodada. Um
  // desvio de 2024 achado pela auditoria retroativa não pode ser fechado pelo
  // ciclo diário de 2026 só porque o ciclo não olha 2024 — quem fecha é outra
  // varredura de 2024.
  const fora = achado({ tipo: "EVENTO", dataReferencia: new Date("2024-11-10") });
  conferir("evento anterior à janela NÃO fecha (não foi reavaliado)", podeFecharSozinho(fora, NENHUMA, TODOS_OK, janela), false);
  // A varredura retroativa de 2024 informa a janela fechada dos dois lados:
  // fecha o que está nela e deixa em paz o que veio depois.
  const janela2024 = { desde: new Date("2024-01-01"), ate: new Date("2024-12-31T23:59:59.999") };
  conferir("varredura de 2024 fecha evento de 2024 que sumiu", podeFecharSozinho(fora, NENHUMA, TODOS_OK, janela2024), true);
  conferir("varredura de 2024 não fecha evento de 2026", podeFecharSozinho(dentro, NENHUMA, TODOS_OK, janela2024), false);
  const semData = achado({ tipo: "EVENTO", dataReferencia: null });
  // Sem data do fato não há como saber se o período foi reavaliado — e foi
  // assim que a varredura retroativa fechou indícios de combustível do ano
  // corrente. Fica aberto.
  conferir("evento sem data de referência NÃO fecha, mesmo com janela", podeFecharSozinho(semData, NENHUMA, TODOS_OK, janela), false);
  conferir("evento dentro da janela ainda detectado não fecha", podeFecharSozinho(dentro, new Set([dentro.chave]), TODOS_OK, janela), false);
  conferir("evento dentro da janela com agente quebrado não fecha", podeFecharSozinho(dentro, NENHUMA, ["conciliacao"], janela), false);
  conferir("estado continua fechando com janela", podeFecharSozinho(achado({ dataReferencia: null }), NENHUMA, TODOS_OK, janela), true);
}
{
  // AGENTE QUEBRADO. O silêncio dele não é prova de que o problema acabou — é
  // ausência de informação. Fechar aqui apagaria da tela um problema vivo, que
  // é o erro mais caro que esta regra pode cometer.
  const semOAgente = ["contas-receber", "conciliacao"];
  conferir("agente que falhou não fecha nada", podeFecharSozinho(achado(), NENHUMA, semOAgente), false);
}
{
  conferir("nenhum agente ok, nada fecha", podeFecharSozinho(achado(), NENHUMA, []), false);
}
{
  // O CASO DE FEVEREIRO. Título vencido em 15/12 e pago com juros em 10/01:
  // CP-JUROS nasce em janeiro datado pela baixa (10/01). Em fevereiro a janela
  // passa a começar em 01/01, o contexto só traz títulos por vencimento ou
  // emissão na janela (ou em aberto) — o título quitado de dezembro sai, a
  // regra não o reavalia, e o achado "dentro da janela" fechava como
  // OBSOLETO. Os juros continuam pagos.
  const janelaDeFevereiro = { desde: new Date(2026, 0, 1) };
  const juros = achado({
    chave: "CP-JUROS|AZUL:123",
    regra: "CP-JUROS",
    tipo: "EVENTO",
    dataReferencia: new Date(2026, 0, 10),
    entidadeTipo: "OmieTitulo",
    entidadeId: "titulo-dezembro",
  });
  const semOTitulo = { titulosNoContexto: new Set(["outro-titulo"]), gestaoDisponivel: true };
  const comOTitulo = { titulosNoContexto: new Set(["titulo-dezembro"]), gestaoDisponivel: true };
  conferir("evento de título fora do contexto NÃO fecha (não foi relido)", podeFecharSozinho(juros, NENHUMA, TODOS_OK, janelaDeFevereiro, semOTitulo), false);
  conferir("o mesmo evento, com o título relido e não reemitido, fecha", podeFecharSozinho(juros, NENHUMA, TODOS_OK, janelaDeFevereiro, comOTitulo), true);
  // ESTADO de título fora do contexto é o título que deixou de estar em
  // aberto (o contexto traz todo aberto) — a condição sumiu, fecha.
  conferir(
    "estado de título fora do contexto continua fechando",
    podeFecharSozinho(achado({ entidadeTipo: "OmieTitulo", entidadeId: "titulo-dezembro" }), NENHUMA, TODOS_OK, janelaDeFevereiro, semOTitulo),
    true
  );
}
{
  // GESTÃO FORA. Frota e pessoal rodam "sem erro" sobre listas vazias; o
  // silêncio é falta de dado, não problema resolvido.
  const semGestao = { titulosNoContexto: new Set<string>(), gestaoDisponivel: false };
  const comGestao = { titulosNoContexto: new Set<string>(), gestaoDisponivel: true };
  const agentes = [...TODOS_OK, "frota", "pessoal", "antifraude"];
  const fantasma = achado({ chave: "PE-FANTASMA|m1", regra: "PE-FANTASMA", agente: "pessoal" });
  const funcionario = achado({ chave: "FR-FORNECEDOR-FUNCIONARIO|AZUL|x", regra: "FR-FORNECEDOR-FUNCIONARIO", agente: "antifraude" });
  conferir("pessoal com a gestão fora não fecha", podeFecharSozinho(fantasma, NENHUMA, agentes, undefined, semGestao), false);
  conferir("cruzamento com a folha em outro agente também não", podeFecharSozinho(funcionario, NENHUMA, agentes, undefined, semGestao), false);
  conferir("com a gestão de volta, fecha como sempre", podeFecharSozinho(fantasma, NENHUMA, agentes, undefined, comGestao), true);
  conferir("regra só da Omie fecha mesmo com a gestão fora", podeFecharSozinho(achado(), NENHUMA, agentes, undefined, semGestao), true);
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

// ------------------------------------------------- 4. tratativa que atravessa a competência
console.log("\n4. 'Não se aplica' vale para a mesma regra e entidade em outra competência");
{
  // O caso real: HI-* carrega a competência na chave. Marcado "não se aplica"
  // em agosto, setembro chegava com chave nova e severidade cheia.
  const ignorado: HistoricoAchado = { status: "IGNORADO", severidade: "ALTA", ocorrencias: 3 };
  const resolvido: HistoricoAchado = { status: "RESOLVIDO", severidade: "ALTA", ocorrencias: 3 };
  const agosto = { chave: "HI-FORA-DO-PADRAO|forn-1|2026-08", regra: "HI-FORA-DO-PADRAO", entidadeRef: "Posto X" };
  const setembro = { chave: "HI-FORA-DO-PADRAO|forn-1|2026-09", regra: "HI-FORA-DO-PADRAO", entidadeRef: "Posto X" };
  const outroFornecedor = { chave: "HI-FORA-DO-PADRAO|forn-2|2026-09", regra: "HI-FORA-DO-PADRAO", entidadeRef: "Posto Y" };
  const outraRegra = { chave: "HI-REAJUSTE|forn-1|2026-09", regra: "HI-REAJUSTE", entidadeRef: "Posto X" };

  const porChave = new Map<string, HistoricoAchado>([[agosto.chave, ignorado]]);
  const porEntidade = new Map<string, HistoricoAchado>([[chaveDeTratativa(agosto)!, ignorado]]);

  conferir("chave exata vem primeiro", tratativaAnterior(agosto, porChave, porEntidade), { anterior: ignorado, herdada: false });
  conferir("mês seguinte herda o 'não se aplica'", tratativaAnterior(setembro, porChave, porEntidade), { anterior: ignorado, herdada: true });
  conferir("outro fornecedor não herda", tratativaAnterior(outroFornecedor, porChave, porEntidade), null);
  conferir("outra regra do mesmo fornecedor não herda", tratativaAnterior(outraRegra, porChave, porEntidade), null);

  // RESOLVIDO não atravessa: resolvido em agosto não diz nada sobre setembro.
  const porEntidadeResolvido = new Map<string, HistoricoAchado>([[chaveDeTratativa(agosto)!, resolvido]]);
  conferir("resolvido em outra competência não herda", tratativaAnterior(setembro, new Map(), porEntidadeResolvido), null);

  // Achado sem entidade não tem por onde herdar — e não pode herdar de "nada".
  conferir("achado sem entidade não gera chave", chaveDeTratativa({ regra: "FC-SALDO-NEGATIVO" }), null);
  conferir("id vale mais que a referência textual", chaveDeTratativa({ regra: "CP-VENCIDO", entidadeId: "t1", entidadeRef: "Posto X" }), "CP-VENCIDO|t1");
}

console.log(falhas === 0 ? "\nTodos os testes passaram.\n" : `\n${falhas} FALHA(S).\n`);
process.exit(falhas === 0 ? 0 : 1);
