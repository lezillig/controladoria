// O FECHAMENTO DA FOLHA — `npm run teste:folha`.
//
// 1. O calendário: último dia útil, 5º dia útil (sábado conta), vencimento
//    antecipado em feriado (15/11 e 20/11).
// 2. O status: marca, pago no prazo e com atraso pela Omie, atrasado, vence logo.
// 3. Com Postgres (TESTE_DATABASE_URL): marcas, títulos e quadro importado.
import { PrismaClient } from "@prisma/client";
import { ITENS_FOLHA, antecipar, enesimoDiaUtil, evidenciaDoItem, montarChecklist, statusDoItem, ultimoDiaUtil, type TituloDaFolha } from "../src/lib/controladoria/fechamentoFolha";

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "  ok  " : "FALHA "} ${nome}${ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         veio     ${JSON.stringify(real)}`}`);
}
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const iso = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : null);
const out26 = { ano: 2026, mes: 10 };

function pura() {
  console.log("\nCalendário");
  conferir("último dia útil de out/2026 (31 é sábado)", iso(ultimoDiaUtil(out26)), "2026-10-30");
  conferir("5º dia útil de nov/2026, sábado conta, 02/11 feriado", iso(enesimoDiaUtil({ ano: 2026, mes: 11 }, 5, true)), "2026-11-07");
  conferir("3º dia útil de nov/2026 sem sábado", iso(enesimoDiaUtil({ ano: 2026, mes: 11 }, 3)), "2026-11-05");
  conferir("15/11/2026 (domingo, feriado) antecipa", iso(antecipar(d("2026-11-15"))), "2026-11-13");
  conferir("20/11/2026 (Consciência Negra) antecipa", iso(antecipar(d("2026-11-20"))), "2026-11-19");
  const prazo = (chave: string) => iso(ITENS_FOLHA.find((i) => i.chave === chave)!.prazo(out26).ate);
  conferir("prazos da folha de outubro", ["PLANO_SAUDE", "PONTO", "BENEFICIOS_FECHAMENTO", "BENEFICIOS_CREDITO", "SALARIO", "ESOCIAL", "FGTS", "SINDICAL"].map(prazo), [
    "2026-10-05", "2026-10-19", "2026-10-22", "2026-10-30", "2026-11-07", "2026-11-13", "2026-11-19", null,
  ]);

  console.log("\nStatus");
  const p = { inicio: null, ate: d("2026-10-30"), texto: "" };
  const marca = { feitoEm: d("2026-10-29"), feitoPor: "Diana", observacao: null };
  const ev = (pagoEm: string | null) => ({ titulos: [], valorCents: 1, pagos: pagoEm ? 1 : 0, emAberto: pagoEm ? 0 : 1, ultimoPagamento: pagoEm ? d(pagoEm) : null });
  conferir("marca vence tudo", statusDoItem({ prazo: p, marca, evidencia: null, hoje: d("2026-11-10") }), "feito");
  conferir("pago no próprio dia do prazo", statusDoItem({ prazo: p, marca: null, evidencia: ev("2026-10-30"), hoje: d("2026-11-10") }), "omie-ok");
  conferir("pago depois do prazo", statusDoItem({ prazo: p, marca: null, evidencia: ev("2026-11-03"), hoje: d("2026-11-10") }), "omie-atraso");
  conferir("título em aberto e prazo vencido", statusDoItem({ prazo: p, marca: null, evidencia: ev(null), hoje: d("2026-10-31") }), "atrasado");
  conferir("vence em 2 dias", statusDoItem({ prazo: p, marca: null, evidencia: null, hoje: d("2026-10-28") }), "vence-logo");
  conferir("antes do início", statusDoItem({ prazo: { inicio: d("2026-10-10"), ate: d("2026-10-19"), texto: "" }, marca: null, evidencia: null, hoje: d("2026-10-02") }), "futuro");
  conferir("sem prazo", statusDoItem({ prazo: { inicio: null, ate: null, texto: "" }, marca: null, evidencia: null, hoje: d("2026-10-02") }), "sem-prazo");

  console.log("\nConferência pela Omie");
  const t = (categoria: string, pagoEm: string | null, vencimento = "2026-10-30"): TituloDaFolha => ({ categoria, parceiro: "X", valorCents: 100_00, vencimento: d(vencimento), liquidado: !!pagoEm, pagoEm: pagoEm ? d(pagoEm) : null });
  const titulos = [
    t("Vale Transporte", "2026-10-30"),
    t("Vale Refeição", "2026-10-29"),
    t("Salários", "2026-11-06", "2026-11-06"),
    t("Adiantamento Salarial", "2026-10-20", "2026-10-20"),
    t("Transportes Terceirizados", "2026-10-30"),
    t("FGTS", null, "2026-11-20"),
  ];
  const item = (chave: string) => ITENS_FOLHA.find((i) => i.chave === chave)!;
  conferir("VT/VR: só os benefícios, não o frete", evidenciaDoItem(item("BENEFICIOS_CREDITO"), out26, titulos)?.titulos.map((x) => x.categoria), ["Vale Transporte", "Vale Refeição"]);
  conferir("salário sem o adiantamento", evidenciaDoItem(item("SALARIO"), out26, titulos)?.titulos.map((x) => x.categoria), ["Salários"]);
  const linhas = montarChecklist({ competencia: out26, hoje: d("2026-11-25"), empresas: [{ conexaoId: "AZ", titulos, marcas: new Map() }] });
  const st = (chave: string) => linhas.find((l) => l.item.chave === chave)!.porEmpresa[0].status;
  conferir("checklist: VT pago, salário pago, FGTS em aberto vencido", [st("BENEFICIOS_CREDITO"), st("SALARIO"), st("FGTS")], ["omie-ok", "omie-ok", "atrasado"]);
}

async function banco() {
  const url = process.env.TESTE_DATABASE_URL;
  if (!url) {
    console.log("\nTESTE_DATABASE_URL não definida — pulando o banco.");
    return;
  }
  console.log("\nNo banco");
  process.env.DATABASE_URL = url;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const { alertasDaFolha, checklistDaFolha } = await import("../src/lib/controladoria/fechamentoFolhaNoBanco");
  const E = "empresa-folha";
  const limpar = async () => {
    await prisma.folhaFechamentoMarca.deleteMany({ where: { companyId: E } });
    await prisma.folhaQuadro.deleteMany({ where: { companyId: E } });
    await prisma.omieTitulo.deleteMany({ where: { companyId: E } });
    await prisma.omieConexao.deleteMany({ where: { companyId: E } });
  };
  await limpar();
  try {
    const az = await prisma.omieConexao.create({ data: { companyId: E, nome: "Azul", apelido: "AZ", credencialRef: "AZ" } });
    const mc = await prisma.omieConexao.create({ data: { companyId: E, nome: "MCZ", apelido: "MC", credencialRef: "MC" } });
    await prisma.omieTitulo.create({
      data: { companyId: E, conexaoId: az.id, conexaoApelido: "AZ", codigoLancamento: "S1", natureza: "PAGAR", status: "PAGO", categoriaDescricao: "Salários", valorDocumentoCents: 5000_00, valorPagoCents: 5000_00, liquidado: true, dataVencimento: d("2026-11-06"), dataUltimaBaixa: d("2026-11-09") },
    });
    await prisma.folhaFechamentoMarca.create({ data: { companyId: E, conexaoId: mc.id, competencia: "2026-10", chave: "PONTO", feitoPor: "Diana" } });
    await prisma.folhaQuadro.create({ data: { companyId: E, conexaoId: az.id, empresaCodigo: "164", competencia: d("2026-10-01"), arquivoNome: "q.xlsx", pessoas: 120, salarioCents: 1 } });
    const { conexoes, linhas } = await checklistDaFolha({ companyId: E, competencia: out26, hoje: d("2026-11-12") });
    const st = (chave: string) => linhas.find((l) => l.item.chave === chave)!.porEmpresa.map((e) => e.status);
    conferir("empresas", conexoes.map((x) => x.apelido), ["AZ", "MC"]);
    conferir("salário da Azul pago depois do 5º dia útil", st("SALARIO"), ["omie-atraso", "atrasado"]);
    conferir("ponto marcado só na MCZ", st("PONTO"), ["atrasado", "feito"]);
    conferir("quadro importado marca os relatórios", st("RELATORIOS"), ["feito", "sem-prazo"]);
    const alertas = await alertasDaFolha(E, d("2026-11-12"));
    conferir("alertas só de prazos desde a entrada do checklist", alertas.every((a) => a.prazo >= d("2026-10-27")), true);
    conferir("alerta do crédito de VT/VA/VR das duas empresas", alertas.filter((a) => a.titulo.startsWith("Crédito do VT")).map((a) => a.empresa), ["AZ", "MC"]);
    conferir("sem alerta do ponto (venceu antes)", alertas.some((a) => a.titulo.includes("ponto")), false);
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
