// AUDITORIA DO DRE DO MÊS — `npm run teste:auditoria-mes` (precisa de TESTE_DATABASE_URL).
import { PrismaClient, type Prisma } from "@prisma/client";
import { compararComOmie } from "../src/lib/controladoria/conferenciaOmie";
import { mudancasDoTitulo, projetoDaOmie } from "../src/lib/controladoria/conferenciaOsOmie";

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "  ok  " : "FALHA "} ${nome}${ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         veio     ${JSON.stringify(real)}`}`);
}
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

function osNaOmie() {
  console.log("\nOS conferida na Omie, título a título");
  const nome = (c: string | null) => (c ? `P${c}` : "sem projeto");
  const base = { projetoCodigo: "10", valorDocumentoCents: 2_550_00, dataVencimento: d("2026-10-08"), cancelado: false };
  conferir("projeto 0 da Omie é sem projeto", [projetoDaOmie("0"), projetoDaOmie(""), projetoDaOmie(null), projetoDaOmie(" 12 ")], [null, null, null, "12"]);
  conferir("igual não muda nada", mudancasDoTitulo(base, { ...base }, nome), []);
  conferir(
    "projeto, valor, vencimento e cancelamento",
    mudancasDoTitulo(base, { projetoCodigo: "0", valorDocumentoCents: 250_00, dataVencimento: d("2026-11-08"), cancelado: true }, nome).map((m) => [m.campo, m.sistema, m.omie]),
    [["projeto", "P10", "sem projeto"], ["valor", "R$\u00a02.550,00", "R$\u00a0250,00"], ["vencimento", "08/10/2026", "08/11/2026"], ["cancelado", "vivo", "cancelado"]]
  );
}

function pura() {
  osNaOmie();
  console.log("\nComparação com a Omie");
  const t = (codigo: string, x: Partial<import("../src/lib/controladoria/conferenciaOmie").TituloComparavel> = {}) => ({
    codigo, parceiro: "P", documento: null, parcela: null, categoria: null, emissao: d("2026-10-01"), vencimento: d("2026-10-15"), valorCents: 100_00, cancelado: false, baixadoNoMesCents: 0, ultimaBaixaNoMes: null, ...x,
  });
  const omie = [t("1"), t("2", { valorCents: 150_00 }), t("3"), t("4", { cancelado: true }), t("5"), t("6", { cancelado: true })];
  const sistema = [t("1"), t("2"), t("4"), t("7"), t("6", { cancelado: true })];
  const r = compararComOmie({ omie, sistema, sistemaPorCodigo: new Map([...sistema, t("5", { vencimento: d("2026-11-15") })].map((x) => [x.codigo, x])), criterio: "competencia", natureza: "PAGAR" });
  conferir("divergências por tipo", r.diferencas.map((x) => [x.tipo, x.codigo, x.impactoCents]).sort((a, b) => String(a[1]).localeCompare(String(b[1]))), [["valor", "2", 50_00], ["falta", "3", 100_00], ["cancelado", "4", -100_00], ["data", "5", 100_00], ["sobra", "7", -100_00]]);
  conferir("totais e iguais", [r.totalOmieCents, r.totalSistemaCents, r.iguais], [450_00, 400_00, 2]);
  const c = compararComOmie({
    omie: [t("1", { baixadoNoMesCents: 100_00, ultimaBaixaNoMes: d("2026-10-10") }), t("2")],
    sistema: [t("1", { baixadoNoMesCents: 60_00, ultimaBaixaNoMes: d("2026-10-10") })],
    sistemaPorCodigo: new Map(),
    criterio: "caixa",
    natureza: "RECEBER",
  });
  conferir("caixa: baixa parcial faltando; título sem baixa no mês não conta", [c.diferencas.map((x) => [x.tipo, x.impactoCents]), c.totalOmieCents, c.titulosOmie], [[["valor", 40_00]], 100_00, 1]);
}

(async () => {
  pura();
  const url = process.env.TESTE_DATABASE_URL;
  if (!url) {
    console.log("TESTE_DATABASE_URL não definida — pulando.");
    process.exit(0);
  }
  process.env.DATABASE_URL = url;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const { auditoriaDoMes } = await import("../src/lib/controladoria/auditoriaDoMes");
  const E = "empresa-auditoria-mes";
  const limpar = async () => {
    await prisma.omieTitulo.deleteMany({ where: { companyId: E } });
    await prisma.dreClassificacao.deleteMany({ where: { companyId: E } });
    await prisma.omieCategoria.deleteMany({ where: { companyId: E } });
    await prisma.omieConexao.deleteMany({ where: { companyId: E } });
  };
  await limpar();
  try {
    const az = await prisma.omieConexao.create({ data: { companyId: E, nome: "Azul", apelido: "AZ", credencialRef: "AZ" } });
    await prisma.omieCategoria.createMany({ data: [
      { companyId: E, conexaoId: az.id, conexaoApelido: "AZ", codigo: "F1", descricao: "Financiamento de Veículos", contaDespesa: true },
      { companyId: E, conexaoId: az.id, conexaoApelido: "AZ", codigo: "C1", descricao: "Combustível", contaDespesa: true },
    ] });
    await prisma.dreClassificacao.createMany({ data: [
      { companyId: E, categoriaCodigo: "F1", linha: "FINANCIAMENTO_INVESTIMENTO", origem: "CONFIRMADA" },
      { companyId: E, categoriaCodigo: "C1", linha: "DESPESA_VEICULOS", origem: "CONFIRMADA" },
    ] });
    let n = 0;
    const t = (x: Record<string, unknown>) => ({ companyId: E, conexaoId: az.id, conexaoApelido: "AZ", codigoLancamento: `T${++n}`, natureza: "PAGAR", status: "PAGO", ...x }) as Prisma.OmieTituloUncheckedCreateInput;
    // Parcela 13/48 emitida com o contrato (2025), vence e é paga em outubro.
    const fin = await prisma.omieTitulo.create({ data: t({ categoriaCodigo: "F1", categoriaDescricao: "Financiamento de Veículos", parceiroNome: "BANCO", numeroParcela: "013/048", valorDocumentoCents: 66_625_54, dataEmissao: d("2025-10-10"), dataVencimento: d("2026-10-28"), dataRegistro: d("2025-10-10") }) });
    await prisma.omieBaixa.create({ data: { companyId: E, conexaoId: az.id, tituloId: fin.id, chave: "B1", dataBaixa: d("2026-10-27"), valorCents: 66_625_54 } });
    // Combustível de outubro, registrado no dia 5.
    await prisma.omieTitulo.create({ data: t({ categoriaCodigo: "C1", categoriaDescricao: "Combustível", parceiroNome: "POSTO", valorDocumentoCents: 10_000_00, dataEmissao: d("2026-10-05"), dataVencimento: d("2026-11-05"), dataRegistro: d("2026-10-05") }) });
    // Setembro: 80% registrado até o dia 27, o resto no dia 30. O segundo vence
    // em setembro e é pago em outubro, com atraso: pago no mês, contado em setembro.
    await prisma.omieTitulo.create({ data: t({ categoriaCodigo: "C1", valorDocumentoCents: 8_000_00, dataEmissao: d("2026-09-01"), dataVencimento: d("2026-09-10"), dataRegistro: d("2026-09-01") }) });
    const atrasado = await prisma.omieTitulo.create({ data: t({ categoriaCodigo: "C1", categoriaDescricao: "Combustível", parceiroNome: "POSTO", valorDocumentoCents: 2_000_00, dataEmissao: d("2026-09-15"), dataVencimento: d("2026-09-29"), dataRegistro: d("2026-09-30") }) });
    await prisma.omieBaixa.create({ data: { companyId: E, conexaoId: az.id, tituloId: atrasado.id, chave: "B2", dataBaixa: d("2026-10-03"), valorCents: 2_000_00 } });

    const a = await auditoriaDoMes({ companyId: E, conexaoId: null, ano: 2026, mes: 10, diaDeCorte: 27 });
    const linha = (k: string) => a.linhas.find((l) => l.chave === k);
    conferir("financiamento lançado em 2025: conta no mês do vencimento", [linha("FINANCIAMENTO_INVESTIMENTO")?.competenciaCents, linha("FINANCIAMENTO_INVESTIMENTO")?.vencimentoCents, linha("FINANCIAMENTO_INVESTIMENTO")?.pagoCents, linha("FINANCIAMENTO_INVESTIMENTO")?.pagoForaCents], [66_625_54, 66_625_54, 66_625_54, 0]);
    conferir("combustível emitido em outubro e vencendo em novembro: novembro", linha("DESPESA_VEICULOS")?.competenciaCents, 0);
    conferir("lista do pago fora do mês: o atrasado de setembro", a.pagosForaDoMes.map((x) => [x.parceiro, x.competencia, x.pagoCents]), [["POSTO", "2026-09", 2_000_00]]);
    conferir("maturidade: setembro tinha 80% no dia 27", a.maturidade.slice(0, 2).map((m) => [m.mes, m.ateODiaCents, m.totalCents]), [["2026-10", 66_625_54, 66_625_54], ["2026-09", 8_000_00, 10_000_00]]);
  } finally {
    await limpar();
    await prisma.$disconnect();
  }
  console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
})();
