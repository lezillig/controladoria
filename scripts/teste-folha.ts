// O FECHAMENTO DA FOLHA — `npm run teste:folha`.
//
// 1. O calendário: último dia útil, 5º dia útil (sábado conta), vencimento
//    antecipado em feriado (15/11 e 20/11).
// 2. O status: marca, pago no prazo e com atraso pela Omie, atrasado, vence logo.
// 3. Com Postgres (TESTE_DATABASE_URL): marcas, títulos e quadro importado.
import { PrismaClient } from "@prisma/client";
import { ITENS_FOLHA, antecipar, enesimoDiaUtil, evidenciaDoItem, montarChecklist, naoUtil, podeMarcarItem, statusDoItem, ultimoDiaUtil, type TituloDaFolha } from "../src/lib/controladoria/fechamentoFolha";
import { pascoa } from "../src/lib/controladoria/periodos";

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

  console.log("\nFeriados móveis e de São Paulo");
  conferir("Páscoa de 2027 e 2031", [pascoa(2027), pascoa(2031)], ["2027-03-28", "2031-04-13"]);
  conferir("Sexta-feira Santa e Corpus Christi não são úteis", [naoUtil(d("2027-03-26")), naoUtil(d("2026-06-04"))], [true, true]);
  conferir("25/01 (São Paulo) e 09/07 (estado) não são úteis", [naoUtil(d("2027-01-25")), naoUtil(d("2027-07-09"))], [true, true]);
  conferir("Carnaval fecha banco, mas conta para a CLT", [naoUtil(d("2027-02-09")), naoUtil(d("2027-02-09"), true)], [true, false]);
  conferir("guia de 26/03/2027 (Sexta-feira Santa) antecipa para a quinta", iso(antecipar(d("2027-03-26"))), "2027-03-25");

  console.log("\nQuem marca o quê");
  const it = (chave: string) => ITENS_FOLHA.find((i) => i.chave === chave)!;
  const rh = new Set(["folha", "marcar-folha"]);
  const fin = new Set(["folha", "marcar-folha-financeiro"]);
  conferir("RH marca o ponto, não o salário nem o INSS", [podeMarcarItem(it("PONTO"), rh), podeMarcarItem(it("SALARIO"), rh), podeMarcarItem(it("INSS"), rh)], [true, false, false]);
  conferir("Financeiro marca o salário, não o INSS", [podeMarcarItem(it("SALARIO"), fin), podeMarcarItem(it("INSS"), fin)], [true, false]);

  console.log("\nStatus");
  const p = { inicio: null, ate: d("2026-10-30"), texto: "" };
  const marca = { feitoEm: d("2026-10-29"), feitoPor: "Diana", observacao: null };
  const ev = (pagoEm: string | null) => ({ titulos: [], valorCents: 1, pagos: pagoEm ? 1 : 0, emAberto: pagoEm ? 0 : 1, ultimoPagamento: pagoEm ? d(pagoEm) : null });
  conferir("marca sem título na Omie vale", statusDoItem({ prazo: p, marca, evidencia: null, hoje: d("2026-11-10") }), "feito");
  // A Omie vem antes da marca: a marca não esconde o atraso nem o título em aberto.
  conferir("marcado, mas a Omie mostra pago com atraso", statusDoItem({ prazo: p, marca, evidencia: ev("2026-11-03"), hoje: d("2026-11-10") }), "omie-atraso");
  conferir("marcado, mas a Omie tem título em aberto", statusDoItem({ prazo: p, marca, evidencia: ev(null), hoje: d("2026-11-10") }), "divergente");
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
  // As marcas são só de acréscimo (o banco recusa apagar): cada execução usa
  // uma empresa própria e não apaga as dela.
  const E = `empresa-folha-${Date.now()}`;
  const limpar = async () => {
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
    // Marcou e desmarcou o plano de saúde na Azul: vale a última linha.
    await prisma.folhaFechamentoMarca.create({ data: { companyId: E, conexaoId: az.id, competencia: "2026-10", chave: "PLANILHA", feitoPor: "Diana", feitoEm: new Date("2026-10-20T10:00:00Z") } });
    await prisma.folhaFechamentoMarca.create({ data: { companyId: E, conexaoId: az.id, competencia: "2026-10", chave: "PLANILHA", acao: "desfeito", feitoPor: "Diana", feitoEm: new Date("2026-10-21T10:00:00Z") } });
    const marca = await prisma.folhaFechamentoMarca.findFirstOrThrow({ where: { companyId: E, chave: "PONTO" } });
    const recusa = async (f: () => Promise<unknown>) => f().then(() => "gravou", (e: Error) => (/so de acrescimo/.test(e.message) ? "recusado" : e.message.slice(0, 80)));
    conferir("marca só de acréscimo: alterar e apagar são recusados", [await recusa(() => prisma.folhaFechamentoMarca.update({ where: { id: marca.id }, data: { feitoPor: "outro" } })), await recusa(() => prisma.folhaFechamentoMarca.delete({ where: { id: marca.id } }))], ["recusado", "recusado"]);
    await prisma.folhaQuadro.create({ data: { companyId: E, conexaoId: az.id, empresaCodigo: "164", competencia: d("2026-10-01"), arquivoNome: "q.xlsx", pessoas: 120, salarioCents: 1 } });
    const { conexoes, linhas } = await checklistDaFolha({ companyId: E, competencia: out26, hoje: d("2026-11-12") });
    const st = (chave: string) => linhas.find((l) => l.item.chave === chave)!.porEmpresa.map((e) => e.status);
    conferir("empresas", conexoes.map((x) => x.apelido), ["AZ", "MC"]);
    conferir("salário da Azul pago depois do 5º dia útil", st("SALARIO"), ["omie-atraso", "atrasado"]);
    conferir("ponto marcado só na MCZ", st("PONTO"), ["atrasado", "feito"]);
    conferir("quadro importado marca os relatórios", st("RELATORIOS"), ["feito", "sem-prazo"]);
    conferir("marcado e depois desmarcado: não está feito", st("PLANILHA")[0] === "feito", false);
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
