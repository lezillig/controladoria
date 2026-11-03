// ONDE O DINHEIRO ESCAPA — `npm run teste:vazamentos`.
//
// Puro: as perdas por origem em ordem de valor, a recorrência nos meses
// anteriores e a soma de todas as origens igual à do cartão.
//
// Com Postgres (TESTE_DATABASE_URL): o total do ranking é o "Perdas do mês"
// do resumo no banco, e a lista que cada linha abre (detalhamento.ts, com o
// recorte da origem) soma exatamente a linha.
export {};
import { montarVazamentos, type LinhaDeVazamento } from "../src/lib/controladoria/vazamentos";

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "  ok  " : "FALHA "} ${nome}${ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         veio     ${JSON.stringify(real)}`}`);
}

const linha = (p: Partial<LinhaDeVazamento>): LinhaDeVazamento => ({
  atual: true,
  mes: "2026-10",
  natureza: "PAGAR",
  parceiro: "POSTO ALFA",
  conexaoId: "x",
  conta: "10",
  atrasoCents: 0,
  tarifaCents: 0,
  descontoCents: 0,
  ...p,
});
const nomeDaConta = (_c: string, codigo: string) => (codigo === "10" ? "AZUL · Itaú" : null);

console.log("Puro");
const v = montarVazamentos(
  [
    linha({ atrasoCents: 300_00, tarifaCents: 12_00 }),
    linha({ parceiro: "OFICINA BETA", atrasoCents: 500_00 }),
    linha({ natureza: "RECEBER", parceiro: "CLIENTE GAMA", descontoCents: 800_00, tarifaCents: 8_00 }),
    linha({ natureza: null, parceiro: "", conta: "", tarifaCents: 5_00 }),
    // Histórico: o Posto Alfa cobrou juros em 4 dos 6 meses; a Oficina, em 1.
    ...["2026-04", "2026-05", "2026-07", "2026-09"].map((mes) => linha({ atual: false, mes, atrasoCents: 150_00 })),
    linha({ atual: false, mes: "2026-08", parceiro: "OFICINA BETA", atrasoCents: 60_00 }),
    // Juros num título a receber não é perda nossa (é o cliente que pagou).
    linha({ natureza: "RECEBER", parceiro: "CLIENTE GAMA", atrasoCents: 999_00 }),
  ],
  { mesesOlhados: 6, nomeDaConta }
);
conferir("total = juros e multa a pagar + tarifa de tudo + desconto a receber", v.totalCents, 300_00 + 12_00 + 500_00 + 800_00 + 8_00 + 5_00);
conferir(
  "em ordem de valor, com o rótulo da origem",
  v.maiores.map((m) => [m.rotulo, m.valorCents]),
  [
    ["Desconto concedido · CLIENTE GAMA", 800_00],
    ["Juros e multa · OFICINA BETA", 500_00],
    ["Juros e multa · POSTO ALFA", 300_00],
    ["Tarifa bancária · AZUL · Itaú", 20_00],
    ["Tarifa bancária · conta não identificada", 5_00],
  ]
);
const posto = v.maiores.find((m) => m.rotulo.includes("POSTO"))!;
conferir("recorrência: 4 de 6 meses, média de 600 ÷ 6", [posto.mesesComPerda, posto.mesesOlhados, posto.mediaMensalCents], [4, 6, 100_00]);
conferir("recorrente pede mudar o vencimento", posto.acao.startsWith("O atraso se repete"), true);
conferir("pontual pede pagar no vencimento", v.maiores.find((m) => m.rotulo.includes("OFICINA"))!.acao.startsWith("Pagar no vencimento"), true);
conferir("o filtro da lista de cada origem", [posto.filtro, v.maiores[3].filtro], [{ parte: "juros_multa", parceiro: "POSTO ALFA" }, { parte: "tarifa", conta: "x:10" }]);
conferir("só as cinco maiores; a soma delas é mostrada", [v.maiores.length, v.origens, v.somaDosMaioresCents], [5, 5, 1625_00]);
conferir("origem só do passado não entra", montarVazamentos([linha({ atual: false, mes: "2026-09", atrasoCents: 100 })], { mesesOlhados: 6, nomeDaConta }).maiores, []);

(async () => {
  const url = process.env.TESTE_DATABASE_URL;
  if (!url) {
    console.log("\nTESTE_DATABASE_URL não definida — pulando a parte com banco.");
    return fim();
  }
  process.env.DATABASE_URL = url;
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const { vazamentosNoBanco } = await import("../src/lib/controladoria/vazamentos");
  const { resumoDoPeriodoNoBanco } = await import("../src/lib/controladoria/resumoNoBanco");
  const { detalharJurosEMulta, detalharPerdas } = await import("../src/lib/controladoria/detalhamento");
  const EMPRESA = "empresa-teste-vazamentos";
  const limpar = async () => {
    await prisma.omieBaixa.deleteMany({ where: { companyId: EMPRESA } });
    await prisma.omieTitulo.deleteMany({ where: { companyId: EMPRESA } });
    await prisma.omieContaCorrente.deleteMany({ where: { companyId: EMPRESA } });
    await prisma.omieConexao.deleteMany({ where: { companyId: EMPRESA } });
  };
  try {
    console.log("Com banco");
    await limpar();
    const cx = await prisma.omieConexao.create({ data: { companyId: EMPRESA, nome: "Teste", apelido: "TESTE", credencialRef: "TESTE_VAZ" } });
    await prisma.omieContaCorrente.create({ data: { companyId: EMPRESA, conexaoId: cx.id, conexaoApelido: "TESTE", codigo: "10", descricao: "Itaú" } });
    const base = { companyId: EMPRESA, conexaoId: cx.id, conexaoApelido: "TESTE", status: "PAGO", dataVencimento: new Date(2026, 9, 5), valorDocumentoCents: 10_000_00 };
    let n = 0;
    const titulo = (natureza: "PAGAR" | "RECEBER", parceiroNome: string | null) => prisma.omieTitulo.create({ data: { ...base, natureza, codigoLancamento: `V${++n}`, parceiroNome } });
    const baixa = (tituloId: string, dataBaixa: Date, p: { juros?: number; multa?: number; tarifa?: number; desconto?: number; conta?: string | null }) =>
      prisma.omieBaixa.create({
        data: { companyId: EMPRESA, conexaoId: cx.id, tituloId, chave: `B${++n}`, dataBaixa, valorCents: 10_000_00, jurosCents: p.juros ?? 0, multaCents: p.multa ?? 0, tarifaCents: p.tarifa ?? 0, descontoCents: p.desconto ?? 0, contaCorrenteCodigo: p.conta === undefined ? "10" : p.conta },
      });
    const posto = await titulo("PAGAR", "POSTO ALFA");
    const semNome = await titulo("PAGAR", null);
    const cliente = await titulo("RECEBER", "CLIENTE GAMA");
    await baixa(posto.id, new Date(2026, 9, 10), { juros: 120_00, multa: 30_00, tarifa: 2_50 });
    await baixa(posto.id, new Date(2026, 8, 10), { juros: 90_00 }); // setembro: histórico
    await baixa(semNome.id, new Date(2026, 9, 12), { juros: 40_00, conta: null, tarifa: 1_00 });
    await baixa(cliente.id, new Date(2026, 9, 20), { desconto: 75_00, tarifa: 3_00 });
    await baixa(cliente.id, new Date(2026, 10, 2), { desconto: 999_00 }); // novembro: fora do período

    const periodo = { inicio: new Date(2026, 9, 1), fim: new Date(2026, 9, 31, 23, 59, 59, 999), rotulo: "outubro/2026" };
    const escopo = { companyId: EMPRESA, conexaoId: null, periodo };
    const [vz, resumo] = await Promise.all([vazamentosNoBanco(escopo), resumoDoPeriodoNoBanco(escopo)]);
    conferir("o total do ranking é o 'Perdas do mês' do cartão", vz.totalCents, resumo.perdaTotalCents);
    conferir(
      "as origens do mês",
      vz.maiores.map((m) => [m.rotulo, m.valorCents]),
      [
        ["Juros e multa · POSTO ALFA", 150_00],
        ["Desconto concedido · CLIENTE GAMA", 75_00],
        ["Juros e multa · (fornecedor não identificado)", 40_00],
        ["Tarifa bancária · TESTE · Itaú", 5_50],
        ["Tarifa bancária · conta não identificada", 1_00],
      ]
    );
    conferir("o posto também cobrou em setembro", [vz.maiores[0].mesesComPerda, vz.maiores[0].mediaMensalCents], [1, 15_00]);
    const lista = async (i: number) => {
      const f = vz.maiores[i].filtro;
      const d =
        f.parte === "juros_multa"
          ? await detalharJurosEMulta({ ...escopo, recorte: { parceiro: f.parceiro } })
          : await detalharPerdas({ ...escopo, componente: f.parte, recorte: { parceiro: f.parceiro, conta: f.conta } });
      return d.totalCents;
    };
    for (let i = 0; i < vz.maiores.length; i++) conferir(`a lista de "${vz.maiores[i].rotulo}" soma a linha`, await lista(i), vz.maiores[i].valorCents);
  } finally {
    await limpar();
    await prisma.$disconnect();
  }
  fim();
})();

function fim() {
  if (falhas) {
    console.log(`\n${falhas} falha(s).`);
    process.exit(1);
  }
  console.log("\nVazamentos: tudo certo.");
}
