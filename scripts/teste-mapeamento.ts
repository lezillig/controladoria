// TESTES DO MAPEAMENTO DO EXTRATO BANCÁRIO — `npm run teste:mapeamento`.
//
// O extrato real das duas contas (diagnóstico de 15/09/2026) chega com
// `cNatureza=P|R`, `cOrigem` textual ("Conta Paga", "Débito de
// Transferência"...), `cSituacao=Conciliado|Previsto`, e a primeira linha é o
// "SALDO ANTERIOR" sem código. O código esperava "D"/"C" na natureza e, por
// isso, gravaria todo pagamento como crédito — um extrato de sinal trocado que
// nenhuma regra de conciliação acusaria, só somaria errado.
//
// Cada caso aqui é uma linha como a Omie a devolve, e o que o espelho tem que
// guardar dela.
import { normalizarMovimentoExtrato } from "../src/lib/omie/mapping";
import { executarFase } from "../src/lib/omie/sync";

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(
    `${ok ? "  ok  " : "FALHA "} ${nome}${ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         obtido   ${JSON.stringify(real)}`}`
  );
}

const CONTA = "5651605965";
const linha = (over: Record<string, unknown> = {}) => ({
  dDataLancamento: "10/09/2026",
  nValorDocumento: 1234.56,
  cDesCliente: "FORNECEDOR X",
  cSituacao: "Conciliado",
  cNatureza: "P",
  cOrigem: "Conta Paga",
  nSaldo: 1000,
  nSaldoPrev: 1000,
  ...over,
});

console.log("\n1. Sinal pela natureza P/R (o vocabulário real das contas)");
{
  conferir("pagamento (P) positivo vira débito", normalizarMovimentoExtrato(linha(), CONTA)?.valorCents, -123456);
  conferir(
    "recebimento (R) positivo vira crédito",
    normalizarMovimentoExtrato(linha({ cNatureza: "R", cOrigem: "Conta Recebida" }), CONTA)?.valorCents,
    123456
  );
  conferir("D continua débito", normalizarMovimentoExtrato(linha({ cNatureza: "D" }), CONTA)?.valorCents, -123456);
  conferir("C continua crédito", normalizarMovimentoExtrato(linha({ cNatureza: "C" }), CONTA)?.valorCents, 123456);
  conferir(
    "valor já negativo continua negativo com P",
    normalizarMovimentoExtrato(linha({ nValorDocumento: -1234.56 }), CONTA)?.valorCents,
    -123456
  );
}

console.log("\n2. Sem natureza: a origem textual decide");
{
  conferir(
    "Débito de Transferência",
    normalizarMovimentoExtrato(linha({ cNatureza: undefined, cOrigem: "Débito de Transferência" }), CONTA)?.valorCents,
    -123456
  );
  conferir(
    "Crédito de Transferência",
    normalizarMovimentoExtrato(linha({ cNatureza: undefined, cOrigem: "Crédito de Transferência" }), CONTA)?.valorCents,
    123456
  );
  conferir(
    "Débito em Conta Corrente",
    normalizarMovimentoExtrato(linha({ cNatureza: undefined, cOrigem: "Débito em Conta Corrente" }), CONTA)?.valorCents,
    -123456
  );
  conferir(
    "sem natureza nem origem, positivo fica crédito",
    normalizarMovimentoExtrato(linha({ cNatureza: undefined, cOrigem: undefined }), CONTA)?.valorCents,
    123456
  );
}

console.log("\n3. O que o espelho descarta de propósito");
{
  conferir(
    "SALDO ANTERIOR sem código é subtotal, não movimento",
    normalizarMovimentoExtrato(
      { dDataLancamento: "01/09/2026", nValorDocumento: 0, cDesCliente: "SALDO ANTERIOR", nSaldo: 500, nSaldoPrev: 500 },
      CONTA
    ),
    null
  );
  conferir("Previsto ainda não aconteceu", normalizarMovimentoExtrato(linha({ cSituacao: "Previsto" }), CONTA), null);
  conferir("sem data não entra", normalizarMovimentoExtrato(linha({ dDataLancamento: undefined }), CONTA), null);
  conferir("sem valor não entra", normalizarMovimentoExtrato(linha({ nValorDocumento: undefined }), CONTA), null);
}

console.log("\n4. O resto do registro");
{
  const m = normalizarMovimentoExtrato(linha({ cNumero: "NF 123", cDesCategoria: "Tarifas Bancárias" }), CONTA);
  conferir("conta corrente", m?.contaCorrenteCodigo, CONTA);
  conferir("conciliado pela situação textual", m?.conciliado, true);
  conferir("não conciliado", normalizarMovimentoExtrato(linha({ cSituacao: "Não conciliado" }), CONTA)?.conciliado, false);
  conferir("parceiro pela descrição", m?.parceiroNome, "FORNECEDOR X");
  conferir("documento por cNumero", m?.documento, "NF 123");
  conferir(
    "chave determinística sem código próprio (conta:data:centavos:parceiro:obs)",
    m?.codigoLancamento,
    `${CONTA}:2026-09-10:123456:FORNECEDOR X:`
  );
  conferir(
    "mesmo valor, mesmo dia, outro parceiro: outra chave",
    normalizarMovimentoExtrato(linha({ cDesCliente: "FORNECEDOR Y" }), CONTA)?.codigoLancamento === m?.codigoLancamento,
    false
  );
  conferir(
    "a mesma linha lida de novo tem a mesma chave",
    normalizarMovimentoExtrato(linha(), CONTA)?.codigoLancamento,
    m?.codigoLancamento
  );
}

// 5. Limite de consumo no meio da carga NÃO pula a página.
//
// O caso: a Omie responde "Consumo redundante" perto do fim do orçamento da
// invocação, sem tempo para o backoff. O sync registrava o erro, pulava o
// passo e a fase concluía — numa janela de carga histórica, o mês ficava
// CONCLUIDO sem os títulos e nunca mais era relido. Nenhuma chamada aqui toca
// o banco: a Omie falha antes de haver o que gravar.
async function limiteDeConsumoRetomaDaPagina() {
  console.log("\n5. Falha passageira da Omie devolve o cursor em vez de pular");
  process.env.OMIE_APP_KEY_TESTE = "1234567890";
  process.env.OMIE_APP_SECRET_TESTE = "0123456789abcdef0123456789abcdef";
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ faultstring: "Consumo redundante detectado", faultcode: "SOAP-ENV:Client-8020" }), {
      status: 500,
    })) as typeof fetch;
  try {
    const agora = Date.now();
    const base = {
      companyId: "c", conexaoId: "x", conexaoApelido: "AZUL", credencialRef: "TESTE",
      janelaInicio: new Date(2025, 0, 1), janelaFim: new Date(2025, 0, 31, 23, 59, 59, 999),
      // Sem folga para o backoff: é exatamente a situação do fim do orçamento.
      fimDoOrcamento: agora + 30_000, deadline: agora + 1_000,
    };
    const titulos = await executarFase("titulos", { ...base, cursor: JSON.stringify({ passo: 1, pagina: 7 }) }, true);
    conferir("títulos: a fase não conclui", titulos.faseConcluida, false);
    conferir("títulos: o cursor volta para a mesma página do mesmo passo", titulos.proximoCursor, JSON.stringify({ passo: 1, pagina: 7 }));
    conferir("títulos: o erro fica registrado, um só", titulos.erros.length, 1);
    const cadastros = await executarFase("cadastros", { ...base, cursor: JSON.stringify({ entidade: "clientes", pagina: 3 }) }, false);
    conferir("cadastros: retoma de clientes, página 3", [cadastros.faseConcluida, cadastros.proximoCursor], [false, JSON.stringify({ entidade: "clientes", pagina: 3 })]);
    const notas = await executarFase("notas", { ...base, cursor: null }, false);
    conferir("notas: retoma da NF-e, página 1", [notas.faseConcluida, notas.proximoCursor], [false, JSON.stringify({ tipo: "NFE", pagina: 1 })]);

    // Recusa de NEGÓCIO continua como era: erro registrado e passo pulado.
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ faultstring: "A chave de acesso não está preenchida ou não é válida." }), {
        status: 500,
      })) as typeof fetch;
    const recusa = await executarFase("titulos", { ...base, cursor: null }, true);
    conferir("recusa que não é passageira: a fase conclui com um erro por passo", [recusa.faseConcluida, recusa.erros.length], [true, 4]);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
}

limiteDeConsumoRetomaDaPagina().then(() => {
  console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTodos os testes passaram.");
  process.exit(falhas ? 1 : 0);
});
