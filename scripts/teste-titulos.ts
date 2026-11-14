// A ORDEM E A BUSCA DA LISTA DE TÍTULOS — `npm run teste:titulos`.
//
// Sem banco: a lista de contas a pagar e a receber ordenada pela coluna e na
// direção que a pessoa escolhe, o "—" sempre no fim, a busca por nome, CNPJ e
// documento, e a ordem lida da URL.
import type { OmieTitulo } from "@prisma/client";
import { DIRECAO_INICIAL, filtrarPorBusca, lerBusca, lerOrdem, ordenarTitulos, proximaOrdem } from "../src/lib/controladoria/ordemDeTitulos";

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "  ok  " : "FALHA "} ${nome}${ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         veio     ${JSON.stringify(real)}`}`);
}
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

// Só os campos que a ordem e a busca leem; o resto do título não importa aqui.
const titulo = (id: string, p: Partial<OmieTitulo>): OmieTitulo =>
  ({
    id,
    parceiroNome: null,
    parceiroDocumento: null,
    numeroDocumento: null,
    dataVencimento: d("2026-01-01"),
    valorDocumentoCents: 0,
    valorPagoCents: 0,
    saldoCents: null,
    jurosCents: 0,
    multaCents: 0,
    tarifaCents: 0,
    status: "RECEBIDO",
    liquidado: true,
    cancelado: false,
    ...p,
  }) as OmieTitulo;

const lista = [
  titulo("a", { parceiroNome: "Comando da Aeronáutica", parceiroDocumento: "00394429009400", numeroDocumento: "11837", dataVencimento: d("2026-02-02"), valorDocumentoCents: 3_533_000, jurosCents: 1 }),
  titulo("b", { parceiroNome: "Secretaria Municipal", parceiroDocumento: "07420613000127", numeroDocumento: "11836", dataVencimento: d("2026-02-05"), valorDocumentoCents: 2_858_333, jurosCents: 1, multaCents: 1 }),
  titulo("c", { parceiroNome: "Água Viva Ltda", parceiroDocumento: "11222333000181", numeroDocumento: "902", dataVencimento: d("2026-03-10"), valorDocumentoCents: 50_000, jurosCents: 700, multaCents: 2_000, tarifaCents: 300 }),
  titulo("d", { parceiroNome: "Zeta Transportes", numeroDocumento: "10", dataVencimento: d("2026-01-15"), valorDocumentoCents: 900_000, liquidado: false, status: "ATRASADO", saldoCents: 400_000 }),
  titulo("e", { parceiroNome: null, dataVencimento: d("2026-01-10"), valorDocumentoCents: 10_000, liquidado: false, status: "A VENCER" }),
];
const ids = (l: OmieTitulo[]) => l.map((t) => t.id).join("");

console.log("\n1. Ordem pela coluna, nas duas direções");
conferir("vencimento, do mais antigo (a ordem de sempre)", ids(ordenarTitulos(lista, { coluna: "vencimento", direcao: "asc" })), "edabc");
conferir("vencimento, do mais novo", ids(ordenarTitulos(lista, { coluna: "vencimento", direcao: "desc" })), "cbade");
conferir("valor, do maior ao menor", ids(ordenarTitulos(lista, { coluna: "valor", direcao: "desc" })), "abdce");
conferir("valor, do menor ao maior", ids(ordenarTitulos(lista, { coluna: "valor", direcao: "asc" })), "ecdba");
conferir("encargos, do maior: o de R$ 30,00 sobe e os sem encargo ficam no fim", ids(ordenarTitulos(lista, { coluna: "encargos", direcao: "desc" })), "cbaed");
conferir("encargos, do menor: o menor que existe primeiro, e os sem encargo continuam no fim", ids(ordenarTitulos(lista, { coluna: "encargos", direcao: "asc" })), "abced");
conferir("saldo, do maior: título pago não tem saldo e vai para o fim", ids(ordenarTitulos(lista, { coluna: "saldo", direcao: "desc" })), "deabc");
conferir("saldo, do menor: os pagos continuam no fim", ids(ordenarTitulos(lista, { coluna: "saldo", direcao: "asc" })), "edabc");
conferir("nome de A a Z, sem tropeçar no acento; sem nome no fim", ids(ordenarTitulos(lista, { coluna: "parceiro", direcao: "asc" })), "cabde");
conferir("nome de Z a A; sem nome continua no fim", ids(ordenarTitulos(lista, { coluna: "parceiro", direcao: "desc" })), "dbace");
conferir("documento como número (10 antes de 902 antes de 11836)", ids(ordenarTitulos(lista, { coluna: "documento", direcao: "asc" })), "dcbae");
conferir("situação de A a Z, empate pelo vencimento", ids(ordenarTitulos(lista, { coluna: "situacao", direcao: "asc" })), "edabc");
conferir("a lista de origem não é mexida", ids(lista), "abcde");

console.log("\n2. A ordem lida do endereço");
conferir("sem nada: vencimento, do mais antigo", lerOrdem(undefined, undefined), { coluna: "vencimento", direcao: "asc" });
conferir("coluna que não existe cai na padrão", lerOrdem("senha", "desc"), { coluna: "vencimento", direcao: "asc" });
conferir("coluna sem direção usa a do primeiro clique (dinheiro: maior primeiro)", [lerOrdem("encargos", undefined), lerOrdem("parceiro", "qualquer")], [{ coluna: "encargos", direcao: "desc" }, { coluna: "parceiro", direcao: "asc" }]);
conferir("direção pedida vale", lerOrdem("valor", "asc"), { coluna: "valor", direcao: "asc" });
conferir("clicar na coluna que já ordena inverte; em outra, começa na direção dela", [proximaOrdem({ coluna: "valor", direcao: "desc" }, "valor"), proximaOrdem({ coluna: "valor", direcao: "asc" }, "encargos"), proximaOrdem({ coluna: "valor", direcao: "desc" }, "vencimento")], [{ coluna: "valor", direcao: "asc" }, { coluna: "encargos", direcao: DIRECAO_INICIAL.encargos }, { coluna: "vencimento", direcao: "asc" }]);

console.log("\n3. Busca");
conferir("vazia devolve tudo", filtrarPorBusca(lista, "  ").length, 5);
conferir("nome sem acento e sem caixa", ids(filtrarPorBusca(lista, "aeronautica")), "a");
conferir("parte do nome com acento digitado", ids(filtrarPorBusca(lista, "ÁGUA")), "c");
conferir("CNPJ com pontuação", ids(filtrarPorBusca(lista, "07.420.613/0001-27")), "b");
conferir("CNPJ só com números, em parte", ids(filtrarPorBusca(lista, "00394429")), "a");
conferir("número do documento", ids(filtrarPorBusca(lista, "1183")), "ab");
conferir("texto com número não vira busca de CNPJ", ids(filtrarPorBusca(lista, "zeta 1")), "");
conferir("nada casa", ids(filtrarPorBusca(lista, "inexistente")), "");
conferir("a busca é aparada e limitada", [lerBusca("  posto  "), lerBusca("x".repeat(200)).length, lerBusca(undefined)], ["posto", 80, ""]);

console.log(falhas === 0 ? "\nTodos os testes passaram.\n" : `\n${falhas} FALHA(S).\n`);
process.exit(falhas === 0 ? 0 : 1);
