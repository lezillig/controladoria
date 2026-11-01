// POR QUE A LEITURA DA GESTÃO FALHOU — `npm run teste:diagnostico-gestao`.
//
// Puro: a mensagem do Prisma (já redigida) vira o motivo certo — permissão
// com o GRANT pronto, tabela inexistente, versão antiga, conexão.
export {};
import { motivoDaFalhaNaGestao } from "../src/lib/gestao/diagnostico";

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "  ok  " : "FALHA "} ${nome}${ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         veio     ${JSON.stringify(real)}`}`);
}

const tabelas = ["Financiamento", "FinanciamentoVeiculo"];
const permissao = motivoDaFalhaNaGestao(
  'Invalid `prisma.$queryRaw()` invocation:\nRaw query failed. Code: `42501`. Message: `ERROR: permission denied for table Financiamento`',
  tabelas,
  "separado"
);
conferir("permissão negada → GRANT pronto", [permissao.tipo, permissao.sql], ["permissao", 'GRANT SELECT ON public."Financiamento", public."FinanciamentoVeiculo" TO controladoria_leitura;']);

const tabela = motivoDaFalhaNaGestao('Raw query failed. Code: `42P01`. Message: `relation "public.Financiamento" does not exist`', tabelas, "mesmo-banco");
conferir("tabela inexistente sem GESTAO_DATABASE_URL", [tabela.tipo, tabela.texto.includes("GESTAO_DATABASE_URL")], ["tabela", true]);

const coluna = motivoDaFalhaNaGestao('Raw query failed. Code: `42703`. Message: `column "posicaoEm" does not exist`', tabelas, "separado");
conferir("coluna inexistente → versão da gestão", [coluna.tipo, coluna.texto.includes("posicaoEm")], ["coluna", true]);

const conexao = motivoDaFalhaNaGestao("Can't reach database server at `[REDIGIDO]`", tabelas, "separado");
conferir("sem conexão", conexao.tipo, "conexao");

conferir("outro erro mostra a mensagem", motivoDaFalhaNaGestao("algo inesperado", tabelas, "separado").tipo, "outro");

if (falhas) {
  console.log(`\n${falhas} falha(s).`);
  process.exit(1);
}
console.log("\nDiagnóstico da leitura da gestão: tudo certo.");
