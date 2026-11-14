// POR QUE A LEITURA DA GESTÃO FALHOU — `npm run teste:diagnostico-gestao`.
//
// Puro: a mensagem do Prisma (já redigida) vira o motivo certo — permissão
// com o GRANT pronto, tabela inexistente, versão antiga, conexão.
export {};
import { gestaoLidaEstaAtrasada, leituraDaVersaoDaGestao, motivoDaFalhaNaGestao, resumoDaVersaoDaGestao } from "../src/lib/gestao/diagnostico";

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

const outro = motivoDaFalhaNaGestao("algo inesperado com usuario_x", tabelas, "separado");
conferir("outro erro: tipo outro, sem ecoar a mensagem do banco", [outro.tipo, outro.texto.includes("usuario_x")], ["outro", false]);
const cred = motivoDaFalhaNaGestao("P1000: Authentication failed against database server, the provided database credentials for `leitor_gestao` are not valid.", tabelas, "separado");
conferir("credencial recusada: tipo próprio, sem o nome do usuário", [cred.tipo, cred.texto.includes("leitor_gestao")], ["credencial", false]);

// EM QUE VERSÃO ESTÁ A GESTÃO LIDA: o que separa "cópia antiga" de "gestão
// que ainda não publicou" é a última migração aplicada no banco lido.
const antiga = { migracao: "20260902110000_cartao_de_frota", aplicadaEm: new Date("2026-09-02T15:00:00.000Z"), total: 41 };
const nova = { migracao: "20261109130000_trilha_indicacao_ponto_voucher", aplicadaEm: new Date("2026-11-09T20:00:00.000Z"), total: 77 };
const daAntiga = leituraDaVersaoDaGestao(antiga, "mesmo-banco");
conferir(
  "banco parado antes dos financiamentos: diz a migração, a data, que é cópia antiga e o conserto",
  [daAntiga.includes("20260902110000_cartao_de_frota (aplicada em 02/09/2026)"), daAntiga.includes("cópia antiga"), daAntiga.includes("GESTAO_DATABASE_URL"), gestaoLidaEstaAtrasada(antiga)],
  [true, true, true, true]
);
const daNova = leituraDaVersaoDaGestao(nova, "mesmo-banco");
conferir("banco já na versão dos financiamentos: não acusa cópia antiga", [daNova.includes("cópia antiga"), daNova.includes("deveria existir"), gestaoLidaEstaAtrasada(nova)], [false, true, false]);
conferir("a própria migração dos financiamentos já não é atraso", gestaoLidaEstaAtrasada({ ...nova, migracao: "20261016120000_financiamento_veiculo" }), false);
conferir("sem histórico, mesmo banco: não é onde a gestão publica", leituraDaVersaoDaGestao(null, "mesmo-banco").includes("não é o banco onde a gestão publica"), true);
conferir("sem histórico, conexão própria: é o papel de leitura que não enxerga", [leituraDaVersaoDaGestao(null, "separado").includes("papel de leitura"), gestaoLidaEstaAtrasada(null)], [true, false]);
conferir("a versão em uma linha", resumoDaVersaoDaGestao(nova), "20261109130000_trilha_indicacao_ponto_voucher, aplicada em 09/11/2026 (77 migrações no total)");

if (falhas) {
  console.log(`\n${falhas} falha(s).`);
  process.exit(1);
}
console.log("\nDiagnóstico da leitura da gestão: tudo certo.");
