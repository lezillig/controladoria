// BOLETO FRIO — `npm run teste:boleto`.
//
// Puro, sem banco: a leitura do código de barras (44 e 47 dígitos, o fator de
// vencimento que recomeçou em 2025, arrecadação), o que a sincronização grava
// (nunca o código inteiro), o que vira versão (só a troca) e as cinco regras.
export {};
import { digitoGeral, lerBoleto, nomeDoBanco } from "../src/lib/controladoria/boleto";
import { boletoDoTitulo } from "../src/lib/omie/mapping";
import { detectarVersoes } from "../src/lib/omie/sync";
import { alteracaoAntesDoPagamento, auditarBoletos } from "../src/lib/controladoria/agents/antifraudeBoleto";
import { conferirBeneficiario, memoSemCpf, nomeNoExtrato } from "../src/lib/controladoria/beneficiarioOfx";
import type { ContextoAuditoria } from "../src/lib/controladoria/types";

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "  ok  " : "FALHA "} ${nome}${ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         veio     ${JSON.stringify(real)}`}`);
}

// Monta um boleto como o banco monta: o teste não depende de boleto real.
const DIA = 86_400_000;
const fatorDe = (iso: string) => 1000 + Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.UTC(2025, 1, 22)) / DIA);
function codigoDeBarras(banco: string, venc: string, valorCents: number, campoLivre = "1234567890123456789012345"): string {
  const sem = banco + "9" + String(fatorDe(venc)).padStart(4, "0") + String(valorCents).padStart(10, "0") + campoLivre;
  return sem.slice(0, 4) + digitoGeral(sem) + sem.slice(4);
}
// Módulo 10 escrito de novo aqui (e não importado): a linha digitável do teste
// não pode ser conferida pela mesma conta que a lê.
function mod10(n: string) {
  let s = 0;
  [...n].reverse().forEach((c, i) => {
    const p = Number(c) * (i % 2 === 0 ? 2 : 1);
    s += p > 9 ? p - 9 : p;
  });
  return (10 - (s % 10)) % 10;
}
function linhaDigitavel(c: string): string {
  const c1 = c.slice(0, 4) + c.slice(19, 24);
  const c2 = c.slice(24, 34);
  const c3 = c.slice(34, 44);
  return `${c1.slice(0, 5)}.${c1.slice(5)}${mod10(c1)} ${c2.slice(0, 5)}.${c2.slice(5)}${mod10(c2)} ${c3.slice(0, 5)}.${c3.slice(5)}${mod10(c3)} ${c[4]} ${c.slice(5, 19)}`;
}

console.log("Leitura do código");
const venc = new Date("2026-08-10T12:00:00Z");
const itau = codigoDeBarras("341", "2026-08-10", 1_234_56);
const lido = lerBoleto(itau, venc);
conferir(
  "44 dígitos: banco, valor, vencimento pelo fator de 2025, dígito",
  lido && lido.tipo === "bancario" ? [lido.banco, lido.valorCents, lido.vencimento?.toISOString().slice(0, 10), lido.digitoValido] : null,
  ["341", 1_234_56, "2026-08-10", true]
);
const pelaLinha = lerBoleto(linhaDigitavel(itau), venc);
conferir("47 dígitos (linha digitável, com pontos e espaços) vira o mesmo código", pelaLinha?.codigoDeBarras, itau);
conferir("linha digitável válida", pelaLinha?.tipo === "bancario" && pelaLinha.digitoValido, true);
const adulterado = itau.slice(0, 30) + ((Number(itau[30]) + 1) % 10) + itau.slice(31);
const lidoAdulterado = lerBoleto(adulterado, venc);
conferir("um dígito trocado no campo livre não fecha o dígito geral", lidoAdulterado?.tipo === "bancario" && lidoAdulterado.digitoValido, false);
const linha = linhaDigitavel(itau).replace(/\D/g, "");
const linhaErrada = linha.slice(0, 12) + ((Number(linha[12]) + 1) % 10) + linha.slice(13);
const lidaErrada = lerBoleto(linhaErrada, venc);
conferir("um dígito trocado na linha digitável não fecha o campo", lidaErrada?.tipo === "bancario" && lidaErrada.digitoValido, false);
const semVenc = "341" + "9" + "0000" + "0000000000" + "1234567890123456789012345";
const lidoSemVenc = lerBoleto(semVenc.slice(0, 4) + digitoGeral(semVenc) + semVenc.slice(4), venc);
conferir("fator zero: sem vencimento; valor zero é valor livre", lidoSemVenc?.tipo === "bancario" ? [lidoSemVenc.vencimento, lidoSemVenc.valorCents] : null, [null, 0]);
const antigo = lerBoleto(codigoDeBarras("237", "2026-08-10", 100).replace(/^(.{5})\d{4}/, `$1${String(Math.round((Date.UTC(2024, 5, 3) - Date.UTC(1997, 9, 7)) / DIA)).padStart(4, "0")}`), new Date("2024-06-03T12:00:00Z"));
conferir("fator anterior a 2025 lido pela base de 1997", antigo?.tipo === "bancario" ? antigo.vencimento?.toISOString().slice(0, 10) : null, "2024-06-03");
const arrec = lerBoleto("8" + "4" + "6" + "0" + "00000012345" + "0".repeat(29), venc);
conferir("arrecadação (começa com 8): só o valor", arrec?.tipo === "arrecadacao" ? arrec.valorCents : null, 12345);
conferir("texto que não é boleto", [lerBoleto("abc", venc), lerBoleto("", venc), lerBoleto(null, venc), lerBoleto("123", venc)], [null, null, null, null]);
conferir("nome do banco", [nomeDoBanco("341"), nomeDoBanco("999")], ["Itaú (341)", "banco 999"]);

console.log("O que a sincronização grava");
const gravado = boletoDoTitulo(linhaDigitavel(itau), venc);
conferir("banco, valor, vencimento, dígito", [gravado.boletoBanco, gravado.boletoValorCents, gravado.boletoVencimento?.toISOString().slice(0, 10), gravado.boletoDigitoValido], ["341", 1_234_56, "2026-08-10", true]);
conferir("o código inteiro não é gravado (só o hash)", JSON.stringify(gravado).includes(itau.slice(19)), false);
conferir("o mesmo boleto, por código ou linha, dá o mesmo hash", boletoDoTitulo(itau, venc).boletoHash, gravado.boletoHash);
conferir("sem código, nada", boletoDoTitulo(null, venc), { boletoHash: null, boletoBanco: null, boletoValorCents: null, boletoVencimento: null, boletoDigitoValido: null });

console.log("O que vira versão");
const base = { codigoLancamento: "L1", parceiroCodigo: "F", valorDocumentoCents: 100, categoriaCodigo: "c", contaCorrenteCodigo: "1", dataVencimento: venc, numeroDocumento: "1" };
const existente = { id: "t1", ...base, boletoHash: null as string | null, boletoBanco: null as string | null };
conferir("boleto que aparece onde não havia não é edição", detectarVersoes([existente], [{ ...base, boletoHash: "aaa", boletoBanco: "341" }], "c").length, 0);
conferir(
  "boleto trocado vira versão (hash e banco)",
  detectarVersoes([{ ...existente, boletoHash: "aaa", boletoBanco: "341" }], [{ ...base, boletoHash: "bbb", boletoBanco: "260" }], "c").map((v) => v.campo),
  ["boletoHash", "boletoBanco"]
);
conferir("hash que ganha a chave (h1:) não é troca", detectarVersoes([{ ...existente, boletoHash: "aaa" }], [{ ...base, boletoHash: "h1:zzz", boletoBanco: null }], "c").length, 0);

console.log("Regras");
type Titulo = ContextoAuditoria["titulos"][number];
let seq = 0;
const titulo = (p: Partial<Titulo>): Titulo =>
  ({
    id: `t${++seq}`,
    companyId: "c",
    conexaoId: "x",
    conexaoApelido: "AZUL",
    natureza: "PAGAR",
    codigoLancamento: `L${seq}`,
    cancelado: false,
    liquidado: false,
    status: "A VENCER",
    parceiroNome: "FORNECEDOR A",
    parceiroDocumento: "11222333000181",
    parceiroCodigo: "1",
    numeroDocumento: `NF${seq}`,
    numeroParcela: null,
    dataVencimento: new Date("2026-08-10T12:00:00Z"),
    dataUltimaBaixa: null,
    valorDocumentoCents: 50_000_00,
    valorPagoCents: 0,
    retencaoIrCents: 0,
    retencaoIssCents: 0,
    retencaoPisCents: 0,
    retencaoCofinsCents: 0,
    retencaoCsllCents: 0,
    retencaoInssCents: 0,
    usuarioInclusao: null,
    usuarioAlteracao: null,
    boletoHash: `h${seq}`,
    boletoBanco: "341",
    boletoValorCents: null,
    boletoVencimento: null,
    boletoDigitoValido: true,
    ...p,
  }) as Titulo;
const ctx = (titulos: Titulo[], versoes: ContextoAuditoria["versoesDeTitulo"] = []) => ({ titulos, versoesDeTitulo: versoes, parceiros: [] }) as unknown as ContextoAuditoria;
const regras = (c: ContextoAuditoria) => auditarBoletos(c, 10_000_00).map((a) => a.regra);

const pagos = (n: number, banco: string) =>
  Array.from({ length: n }, (_, i) => titulo({ boletoBanco: banco, liquidado: true, valorPagoCents: 50_000_00, dataVencimento: new Date(Date.UTC(2026, i, 10)) }));
const novo = titulo({ boletoBanco: "260", dataVencimento: new Date("2026-09-10T12:00:00Z") });
conferir("três boletos do Itaú e um do Nubank: o do Nubank", auditarBoletos(ctx([...pagos(3, "341"), novo]), 10_000_00).map((a) => [a.regra, a.entidadeId, a.severidade]), [["FR-BOLETO-BANCO-NOVO", novo.id, "ALTA"]]);
const depois = titulo({ boletoBanco: "260", dataVencimento: new Date("2026-10-10T12:00:00Z") });
conferir("só o primeiro boleto do banco novo", regras(ctx([...pagos(3, "341"), novo, depois])), ["FR-BOLETO-BANCO-NOVO"]);
conferir("com dois boletos só, não há hábito", regras(ctx([...pagos(2, "341"), titulo({ boletoBanco: "260", dataVencimento: new Date("2026-09-10T12:00:00Z") })])), []);
conferir("outro fornecedor não conta no hábito", regras(ctx([...pagos(3, "341"), titulo({ boletoBanco: "260", parceiroDocumento: "99888777000100", parceiroCodigo: "2" })])), []);

const t1 = titulo({ boletoHash: "igual" });
const t2 = titulo({ boletoHash: "igual", parceiroNome: "FORNECEDOR B", parceiroDocumento: "99888777000100", parceiroCodigo: "2" });
const repetido = auditarBoletos(ctx([t1, t2]), 10_000_00);
conferir("o mesmo boleto em dois títulos de fornecedores diferentes", repetido.map((a) => [a.regra, a.valorCents, a.severidade]), [["FR-BOLETO-REPETIDO", 50_000_00, "CRITICA"]]);
conferir("cancelado não conta", regras(ctx([t1, { ...t2, cancelado: true }])), []);

conferir("boleto que cobra mais que o título", regras(ctx([titulo({ boletoValorCents: 58_000_00 })])), ["FR-BOLETO-VALOR-DIVERGENTE"]);
conferir("boleto pelo líquido das retenções não é divergência", regras(ctx([titulo({ boletoValorCents: 47_500_00, retencaoIssCents: 2_500_00 })])), []);
conferir("boleto pelo valor do título", regras(ctx([titulo({ boletoValorCents: 50_000_00 })])), []);
conferir("centavos de diferença não contam", regras(ctx([titulo({ boletoValorCents: 50_000_90 })])), []);

conferir("dígito que não fecha, ainda a pagar", regras(ctx([titulo({ boletoDigitoValido: false })])), ["FR-BOLETO-INVALIDO"]);
conferir("dígito que não fecha, já pago: calado", regras(ctx([titulo({ boletoDigitoValido: false, liquidado: true, valorPagoCents: 50_000_00 })])), []);

const trocado = titulo({ boletoBanco: "260" });
const visto = new Date("2026-08-05T10:00:00Z");
const versoes = [
  { id: "v1", companyId: "c", tituloId: trocado.id, vistoEm: visto, campo: "boletoHash", de: "aaa", para: "bbb" },
  { id: "v2", companyId: "c", tituloId: trocado.id, vistoEm: visto, campo: "boletoBanco", de: "341", para: "260" },
];
const achadoTroca = auditarBoletos(ctx([trocado], versoes), 10_000_00);
conferir("boleto trocado num título a pagar, com troca de banco", achadoTroca.map((a) => [a.regra, a.tipo, a.severidade]), [["FR-BOLETO-TROCADO", "EVENTO", "CRITICA"]]);
conferir("o achado diz de qual banco para qual", achadoTroca[0]?.titulo.includes("Itaú (341) → Nubank (260)"), true);
conferir("título pequeno trocado e ainda a pagar: no mínimo ALTA", auditarBoletos(ctx([{ ...trocado, valorDocumentoCents: 100_00 }], versoes.slice(0, 1)), 10_000_00).map((a) => a.severidade), ["ALTA"]);
conferir("sem boleto, nada", auditarBoletos(ctx([titulo({ boletoHash: null, boletoBanco: null })]), 10_000_00), []);

console.log("Indício de troca no passado (alterado depois de lançado, antes de pago)");
const comAlteracao = (p: Partial<Titulo>) =>
  titulo({ boletoBanco: "260", valorDocumentoCents: 15_000_00, dataVencimento: new Date("2026-09-10T12:00:00Z"), dataInclusaoOmie: d0("2026-08-01"), usuarioInclusao: "ana", ...p });
function d0(iso: string) {
  return new Date(`${iso}T12:00:00Z`);
}
const sev = (t: Titulo) => auditarBoletos(ctx([...pagos(3, "341"), t]), 10_000_00).map((a) => a.severidade);
conferir("banco novo sem alteração: média", sev(comAlteracao({})), ["MEDIA"]);
conferir("alterado 4 dias depois de lançado, pela mesma pessoa: alta", sev(comAlteracao({ alteradoEmOmie: d0("2026-08-05"), usuarioAlteracao: "ana" })), ["ALTA"]);
conferir("alterado por outra pessoa: crítica", sev(comAlteracao({ alteradoEmOmie: d0("2026-08-05"), usuarioAlteracao: "bruno" })), ["CRITICA"]);
const pagoNaBaixa = comAlteracao({ liquidado: true, valorPagoCents: 15_000_00, dataUltimaBaixa: d0("2026-09-10"), alteradoEmOmie: d0("2026-09-10"), usuarioAlteracao: "bruno" });
conferir("pago: alteração no dia da baixa pode ser a própria baixa — não conta", alteracaoAntesDoPagamento(pagoNaBaixa), null);
const pagoDepois = comAlteracao({ liquidado: true, valorPagoCents: 15_000_00, dataUltimaBaixa: d0("2026-09-10"), alteradoEmOmie: d0("2026-09-02"), usuarioAlteracao: "bruno" });
conferir("pago: alterado 8 dias antes do pagamento conta", alteracaoAntesDoPagamento(pagoDepois)?.outraPessoa, true);
conferir("o achado diz quem alterou", auditarBoletos(ctx([...pagos(3, "341"), pagoDepois]), 10_000_00)[0]?.descricao.includes("por bruno"), true);
conferir("alterado no mesmo dia em que foi lançado não conta", alteracaoAntesDoPagamento(comAlteracao({ alteradoEmOmie: d0("2026-08-01") })), null);

console.log("Quem recebeu: o nome no extrato do banco × fornecedor");
const posto = { nomes: ["AUTO POSTO SAO JORGE LTDA", "Posto São Jorge"], documento: "12345678000190" };
conferir("o nome que sobra da linha", nomeNoExtrato("PAG BOLETO OUTROS BANCOS - AUTO POSTO SAO JO 10/08"), "AUTO POSTO SAO JO");
conferir("linha sem nome", [nomeNoExtrato("PAGTO TITULO 123456"), nomeNoExtrato("TARIFA BANCARIA PACOTE"), nomeNoExtrato("SISPAG FORNECEDORES TED")], [null, null, null]);
conferir("mesmo fornecedor, nome cortado pelo banco", conferirBeneficiario("PAG BOLETO OUTROS BANCOS - AUTO POSTO SAO JO", posto), "confere");
conferir("mesmo fornecedor pelo nome fantasia", conferirBeneficiario("PIX ENVIADO POSTO SAO JORGE", posto), "confere");
conferir("outra pessoa recebeu", conferirBeneficiario("PAGAMENTO DE BOLETO - MARIA APARECIDA SILVA", posto), "diverge");
conferir("CNPJ da filial do fornecedor confere (mesma raiz)", conferirBeneficiario("PIX ENVIADO 12.345.678/0002-71", posto), "confere");
conferir("CNPJ de outra empresa diverge, mesmo com o nome parecido", conferirBeneficiario("PIX ENVIADO POSTO SAO JORGE 98.765.432/0001-10", posto), "diverge");
conferir("só vocabulário do banco: não se julga", conferirBeneficiario("PAGTO COBRANCA 0012345", posto), "sem-nome");
conferir("palavra genérica (LTDA, COMERCIO) não basta para conferir", conferirBeneficiario("PAG BOLETO COMERCIO LTDA", { nomes: ["COMERCIO DE PECAS ALFA LTDA"], documento: null }), "diverge");
conferir("CPF da linha sai mascarado", memoSemCpf("PIX ENVIADO 123.456.789-01 FULANO"), "PIX ENVIADO ***.456.789-** FULANO");

if (falhas) {
  console.log(`\n${falhas} falha(s).`);
  process.exit(1);
}
console.log("\nBoleto: tudo certo.");
