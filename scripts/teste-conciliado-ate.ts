// ATÉ QUE DIA CADA CONTA ESTÁ CONCILIADA — `npm run teste:conciliado-ate`.
import { PrismaClient } from "@prisma/client";
import { conciliadoAte } from "../src/lib/controladoria/conciliadoAte";
import { grupoDaConta, montarSaldos, totais } from "../src/lib/controladoria/saldosDasContas";
import { normalizarSaldosDoExtrato } from "../src/lib/omie/mapping";
import { contaDoOfx, cruzarOfx, lerOfx, valorOfx } from "../src/lib/controladoria/ofx";

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "  ok  " : "FALHA "} ${nome}${ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         veio     ${JSON.stringify(real)}`}`);
}
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const iso = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : null);
const ref = new Date(2026, 9, 26);

function pura() {
  console.log("\nConta");
  const r = (p: string | null, primeiro: string | null, ultimo: string | null) => {
    const a = conciliadoAte({ primeiroPendente: p ? d(p) : null, primeiroMovimento: primeiro ? d(primeiro) : null, ultimoMovimento: ultimo ? d(ultimo) : null }, ref);
    return [iso(a.ate), a.nadaConciliado, a.diasDeAtraso];
  };
  conferir("pendente em 10/10: conciliado até 09/10, 17 dias", r("2026-10-10", "2025-01-02", "2026-10-26"), ["2026-10-09", false, 17]);
  conferir("sem pendente: até o último lançamento, em dia", r(null, "2025-01-02", "2026-10-24"), ["2026-10-24", false, 0]);
  conferir("primeiro lançamento pendente: nada conciliado", r("2025-01-02", "2025-01-02", "2026-10-26"), ["2025-01-01", true, 663]);
  conferir("sem extrato", r(null, null, null), [null, false, null]);

  console.log("\nSaldos");
  const cab = normalizarSaldosDoExtrato({ nCodCC: 1, cCodTipo: "CC", cDesTipo: "Conta Corrente", nSaldoAtual: 1915174.84, nSaldoConciliado: 1900000, nSaldoDisponivel: 2015174.84, nLimiteCreditoTotal: 100000, dPeriodoFinal: "26/10/2026", listaMovimentos: [] });
  conferir("cabeçalho do extrato", cab && [cab.tipoDescricao, cab.saldoOmieCents, cab.saldoConciliadoOmieCents, cab.saldoDisponivelOmieCents, cab.limiteCreditoCents], ["Conta Corrente", 191517484, 190000000, 201517484, 10000000]);
  conferir("resposta sem saldo não grava", normalizarSaldosDoExtrato({ listaMovimentos: [] }), null);
  conferir("tipo da conta", [grupoDaConta({ descricao: "Bradesco Invest Fácil" }), grupoDaConta({ descricao: "Bradesco", tipoDescricao: "Aplicação Financeira" }), grupoDaConta({ descricao: "Cartão Omie" }), grupoDaConta({ descricao: "Itaú" })], ["aplicacao", "aplicacao", "cartao", "disponivel"]);
  const base = { banco: null, inativa: false, tipoCodigo: null, tipoDescricao: null, saldoConciliadoOmieCents: null, saldoDisponivelOmieCents: null, saldoOmieEm: null };
  const linhas = montarSaldos({
    contas: [
      { ...base, conexaoId: "AZ", conexaoApelido: "AZUL", codigo: "1", descricao: "Itaú", saldoInicialCents: 100_00, saldoOmieCents: 500_00 },
      { ...base, conexaoId: "AZ", conexaoApelido: "AZUL", codigo: "2", descricao: "Bradesco", saldoInicialCents: 0, saldoOmieCents: null },
      { ...base, conexaoId: "AZ", conexaoApelido: "AZUL", codigo: "3", descricao: "Antiga", saldoInicialCents: 0, saldoOmieCents: 0, inativa: true },
    ],
    movimentado: new Map([["AZ:1", 350_00], ["AZ:2", 80_00]]),
    informados: [
      { id: "i1", conexaoId: "AZ", contaCodigo: null, descricao: "Bradesco Investimentos", aplicacao: true, data: d("2026-10-20"), valorCents: 2_700_000_00, autorNome: "L", empresa: "AZUL" },
      { id: "i0", conexaoId: "AZ", contaCodigo: null, descricao: "bradesco investimentos", aplicacao: true, data: d("2026-09-30"), valorCents: 2_600_000_00, autorNome: "L", empresa: "AZUL" },
      { id: "i2", conexaoId: "AZ", contaCodigo: "2", descricao: "Bradesco", aplicacao: false, data: d("2026-10-25"), valorCents: 90_00, autorNome: "L", empresa: "AZUL" },
    ],
  });
  conferir("considerado: Omie, banco informado, fora da Omie (o mais recente)", linhas.map((l) => [l.descricao, l.fonte, l.consideradoCents, l.extratoCents]), [
    ["Itaú", "omie", 500_00, 450_00],
    ["Bradesco", "banco", 90_00, 80_00],
    ["Bradesco Investimentos", "banco", 2_700_000_00, null],
  ]);
  console.log("\nOFX");
  const ofx = lerOfx(`OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><BANKID>0237<ACCTID>12345<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20261001120000<DTEND>20261027120000
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261002120000<TRNAMT>500000,00<FITID>A1<MEMO>PIX RECEBIDO</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261005120000<TRNAMT>-1.234,56<FITID>A2<MEMO>TARIFA</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261110120000<TRNAMT>-986,31<FITID>A3<MEMO>AGENDADO</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>1037656,99<DTASOF>00000000</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`);
  conferir("OFX: conta, saldo, lançamentos", [ofx.banco, ofx.conta, ofx.saldoCents, ofx.saldoEm, ofx.lancamentos.map((l) => [l.id, iso(l.data), l.valorCents])], [
    "0237", "12345", 103765699, null, [["A1", "2026-10-02", 50000000], ["A2", "2026-10-05", -123456], ["A3", "2026-11-10", -98631]],
  ]);
  conferir("valores com ponto ou vírgula", [valorOfx("-1,234.56"), valorOfx("1234.5"), valorOfx("10,00"), valorOfx("x")], [-123456, 123450, 1000, null]);
  conferir("conta pelo banco e número (com dígito)", contaDoOfx(ofx, [{ banco: "341", numeroConta: "12345" }, { banco: "237", numeroConta: "0012345-6" }])?.banco, "237");
  const cr = cruzarOfx({
    banco: ofx.lancamentos,
    ate: ofx.fim,
    omie: [
      { id: "o1", data: d("2026-10-03"), valorCents: 50000000, descricao: "pix", conciliado: true },
      { id: "o2", data: d("2026-10-20"), valorCents: -123456, descricao: "fora da folga", conciliado: false },
      { id: "o3", data: d("2026-10-06"), valorCents: -5000, descricao: "só na omie", conciliado: false },
    ],
  });
  conferir("cruzamento", [cr.casados.map((c) => [c.banco.id, c.omie.id, c.dias]), cr.soNoBanco.map((l) => l.id), cr.soNaOmie.map((o) => o.id), cr.agendados.map((l) => l.id)], [[["A1", "o1", 1]], ["A2"], ["o2", "o3"], ["A3"]]);

  conferir("totais", totais(linhas), { disponivel: 590_00, aplicacao: 2_700_000_00, cartao: 0, total: 2_700_590_00 });
}

async function banco() {
  const url = process.env.TESTE_DATABASE_URL;
  if (!url) return console.log("\nTESTE_DATABASE_URL não definida — pulando o banco.");
  console.log("\nNo banco");
  process.env.DATABASE_URL = url;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const { situacaoDasContas } = await import("../src/lib/controladoria/conciliadoAte");
  const E = "empresa-conciliado-ate";
  const limpar = async () => {
    await prisma.omieMovimento.deleteMany({ where: { companyId: E } });
    await prisma.omieConexao.deleteMany({ where: { companyId: E } });
  };
  await limpar();
  try {
    const az = await prisma.omieConexao.create({ data: { companyId: E, nome: "Azul", apelido: "AZ", credencialRef: "AZ" } });
    let n = 0;
    const m = (conta: string, data: string, conciliado: boolean, valorCents = -100_00) => ({ companyId: E, conexaoId: az.id, conexaoApelido: "AZ", contaCorrenteCodigo: conta, codigoLancamento: `L${++n}`, data: d(data), valorCents, conciliado, dataConciliacao: conciliado ? d("2026-10-20") : null });
    await prisma.omieMovimento.createMany({
      data: [m("1", "2026-09-01", true), m("1", "2026-09-15", false, 50_00), m("1", "2026-10-01", true), m("1", "2026-10-20", false), m("1", "2026-11-05", false), m("2", "2026-10-25", true)],
    });
    const s = await situacaoDasContas({ companyId: E, conexaoId: null, dataReferencia: ref });
    const c1 = s.get(`${az.id}:1`)!;
    conferir("conta 1: pendentes até a referência (agendado fora)", [c1.pendentes, c1.pendentesCents, iso(c1.primeiroPendente), iso(c1.ultimaConciliacao)], [2, 150_00, "2026-09-15", "2026-10-20"]);
    conferir("conta 1 conciliada até 14/09", iso(conciliadoAte(c1, ref).ate), "2026-09-14");
    conferir("conta 2 em dia", conciliadoAte(s.get(`${az.id}:2`)!, ref).diasDeAtraso, 0);
  } finally {
    await limpar();
    await prisma.$disconnect();
  }
}

(async () => {
  pura();
  await banco();
  console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
})();
