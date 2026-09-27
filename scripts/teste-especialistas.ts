// OS ESPECIALISTAS DE IA — `npm run teste:especialistas`.
//
// Sem banco e sem chamada à API: o que se testa aqui é o que dá para quebrar
// em silêncio ao editar o registro. Um id repetido escolheria o prompt errado;
// um nome de ferramenta repetido entre os dois conjuntos faz a API recusar a
// chamada inteira com um 400 — e só na primeira pergunta de produção; um
// especialista sem o contrato comum responderia sem as regras de só leitura e
// de citar o dado.
import { ESPECIALISTAS, especialistaPorId, faixaDeCusto, MODELO_ESPECIALISTA } from "../src/lib/controladoria/especialistas";
import { ferramentasDeAuditoria } from "../src/lib/controladoria/investigador";
import { ferramentasDeAnalise } from "../src/lib/controladoria/ferramentasDeAnalise";

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(
    `${ok ? "  ok  " : "FALHA "} ${nome}${ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         obtido   ${JSON.stringify(real)}`}`
  );
}

console.log("\nRegistro");
const ids = ESPECIALISTAS.map((e) => e.id);
conferir("cinco especialistas", ids.length, 5);
conferir("ids únicos", new Set(ids).size, ids.length);
conferir("o investigador é o primeiro e o padrão", especialistaPorId(undefined).id, "investigador");
conferir("id desconhecido cai no investigador", especialistaPorId("gerente-de-marketing").id, "investigador");
conferir("id conhecido é respeitado", especialistaPorId("controller").id, "controller");

for (const e of ESPECIALISTAS) {
  const ehInvestigador = e.id === "investigador";
  conferir(`${e.id}: tem pelo menos três objetivos prontos`, e.objetivos.length >= 3, true);
  conferir(`${e.id}: todo objetivo tem rótulo e pergunta`, e.objetivos.every((o) => o.rotulo.length > 3 && o.pergunta.length > 40), true);
  conferir(`${e.id}: teto de consultas entre 8 e 24`, e.maximoDeConsultas >= 8 && e.maximoDeConsultas <= 24, true);
  if (ehInvestigador) {
    // O prompt do investigador vive em investigador.ts; aqui ele fica vazio de
    // propósito, e a rodada usa o de lá.
    conferir("investigador: prompt delegado ao investigador.ts", e.systemPrompt, "");
    conferir("investigador: só as ferramentas de auditoria", e.ferramentas, ["auditoria"]);
  } else {
    conferir(`${e.id}: roda no modelo dos especialistas`, e.modelo, MODELO_ESPECIALISTA);
    conferir(`${e.id}: tem as ferramentas de análise`, e.ferramentas.includes("analise"), true);
    // O contrato comum — só leitura, cite o dado, diga o que a base não cobre.
    conferir(`${e.id}: carrega o contrato de só leitura`, /Você não altera nada/.test(e.systemPrompt), true);
    conferir(`${e.id}: exige número vindo de consulta`, /saiu de uma consulta feita nesta conversa/.test(e.systemPrompt), true);
    conferir(`${e.id}: distingue não encontrei de não existe`, /"não encontrei" de "não existe"/.test(e.systemPrompt), true);
    conferir(`${e.id}: declara o que a base não cobre`, /não há extrato bancário/.test(e.systemPrompt), true);
    conferir(`${e.id}: fala do grupo certo`, /Azul Mob e MCZ/.test(e.systemPrompt), true);
  }
  conferir(`${e.id}: faixa de custo declarada`, faixaDeCusto(e).length > 10, true);
}

console.log("\nFerramentas");
const escopo = { companyId: "teste", conexaoId: null };
const auditoria = ferramentasDeAuditoria(escopo, []);
const analise = ferramentasDeAnalise(escopo, [], new Date(2026, 8, 22));
const nomes = [...auditoria, ...analise].map((f) => f.name);
conferir("nenhum nome de ferramenta repetido entre os dois conjuntos", new Set(nomes).size, nomes.length);
conferir("as ferramentas de análise existem", analise.length >= 8, true);
conferir(
  "toda ferramenta tem descrição que diga quando usá-la",
  [...auditoria, ...analise].every((f) => {
    const descricao = (f as { description?: unknown }).description;
    return typeof descricao === "string" && descricao.length > 40;
  }),
  true
);
conferir(
  "as somas do DRE e o comparativo estão entre elas",
  ["dre", "dre_anual", "comparativo", "serie_de_resultado", "estrategia_de_custo", "configuracao_e_regras"].every((n) => nomes.includes(n)),
  true
);

console.log(falhas === 0 ? "\nTodos os testes passaram.\n" : `\n${falhas} FALHA(S).\n`);
process.exit(falhas === 0 ? 0 : 1);
