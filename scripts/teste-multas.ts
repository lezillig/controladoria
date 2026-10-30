// MULTAS — `npm run teste:multas`.
//
// Parte 1 (sem banco): o próximo passo de cada multa, o prazo de indicação
// (perdido = risco de NIC), os pontos em 12 meses, quem dirigia pelo uso do
// veículo e pela escala, a competência do desconto e a leitura da planilha
// (montada aqui no formato da real: termo/notificação/desconto com data,
// "AZUL MOB", "NÃO ASSINOU" e "URGENTE"; aba de pontos; aba de NIC com uma
// linha deslocada). Parte 2 (Postgres em TESTE_DATABASE_URL; sem ela, pula):
// a migração gravada duas vezes sem duplicar, as pendências do agente (uma
// por prazo urgente, UMA para os perdidos, desconto para o RH) e a aprovação
// do desconto gravando a competência.

import ExcelJS from "exceljs";

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "  ok  " : "FALHA "} ${nome}${ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         veio     ${JSON.stringify(real)}`}`);
}
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const hora = (h: number, m: number) => new Date(Date.UTC(1899, 11, 30, h, m));

function planilha() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Controle Multas 2026");
  ws.addRow(["MOTORISTA", "SOLICITAÇÃO DIÁRIO", "ENTREGA DIÁRIO", "STATUS ATUAL", "DATA INCLUSÃO LW", "PLACA", "MODELO", "DATA INFRAÇÃO", "HORA", "ESPECIFICAÇÃO", "ÓRGÃO", "AIT", "VALOR", "TERMO / NOTIFCAÇÃO", "NOT ENCAMINHADA", "VENCT NOT", "DESC. COMPETENCIA", "VENCT BOL"]);
  ws.addRow(["PESSOA A", "-", "-", "FINALIZADO", d("2026-02-16"), "ABC1D23", "MASTER", d("2026-01-26"), hora(10, 16), "VELOCIDADE", "DER - SP", "I4702557731", 104.13, d("2026-03-19"), d("2026-03-04"), d("2026-03-23"), d("2026-03-01")]);
  ws.addRow(["PESSOA B", "-", "-", "FINALIZADO", d("2026-02-16"), "BRA2E19", "TRANSIT", d("2026-01-28"), hora(7, 47), "PEDÁGIO", "CET - SP", "1DK2197171", 156.18, "AZUL MOB", "AZUL MOB", d("2026-02-22"), "AZUL MOB"]);
  ws.addRow(["PESSOA C", d("2026-06-15"), "-", "URGENTE", d("2026-06-05"), "ABC1D23", "MASTER", d("2026-05-30"), hora(16, 6), "RODÍZIO", "DSV - PREFEITURA SP", "1DK2312751", 234.78, "URGENTE", "URGENTE", d("2026-07-02")]);
  ws.addRow(["NÃO LOCALIZADO", "-", "-", "NÃO LOCALIZADO", d("2026-07-27"), "ABC1D23", "MASTER", d("2026-07-20"), hora(9, 0), "FAIXA INCORRETA", "CET - SP", "SIC48789980", 156.18, "URGENTE", "URGENTE", d("2026-11-03")]);
  ws.addRow(["PESSOA D", "-", "-", "TERMO ASSINADO", d("2026-09-01"), "XYZ9A99", "SPIN", d("2026-08-20"), hora(11, 30), "CELULAR", "DETRAN - SP", "4VA17361472", 293.47, "NÃO ASSINOU", "URGENTE", d("2026-12-01")]);
  ws.addRow(["NÃO IDENTIFICADO", d("2026-09-10"), "-", "URGENTE", d("2026-09-05"), "ABC1D23", "MASTER", d("2026-09-01"), hora(8, 0), "VELOCIDADE", "DER - SP", "1DK9999999", 104.13, "URGENTE", "URGENTE", d("2026-12-10")]);
  ws.addRow([null, null, null, null, null, "PLACA RUIM", null, d("2026-08-20"), null, "X", "Y", "ZZ99999999", 10]);
  const pts = wb.addWorksheet("Planilha1");
  for (let i = 0; i < 12; i++) pts.addRow([]);
  pts.addRow([null, null, null, null, null, "MOTORISTA", "PLACA", "MODELO", "DATA INFRAÇÃO", "HORA", "ESPECIFICAÇÃO", "ÓRGÃO", "AIT", "VALOR", "PONTOS"]);
  pts.addRow([null, null, null, null, null, "PESSOA A", "ABC1D23", "MASTER", d("2026-01-26"), hora(10, 16), "VELOCIDADE", "DER - SP", "I4702557731", 104.13, 4]);
  const nic = wb.addWorksheet("MULTAS NIC");
  nic.addRow(["MOTORISTA", "PLACA", "DATA ORIGINÁRIA", "HORA ORIGINÁRIA", "AIT ORIGINÁRIA", "AIT NIC", "VALOR NIC", "MOTIVO NIC"]);
  nic.addRow(["PESSOA C", "ABC1D23", d("2026-05-30"), hora(16, 6), "1DK2312751", "I000080083", 1408.66, "não indicado no prazo"]);
  nic.addRow(["PESSOA C", "ABC1D23", "MASTER", d("2026-05-30"), "1DK2312751", "I000080022", 208.26, "linha deslocada"]);
  return wb;
}

const base = { situacao: "aberta", ehNic: false, responsavel: "a_definir", condutorPessoaId: null as string | null, condutorNome: null as string | null, condutorNaoLocalizado: false, diarioSolicitadoEm: null as Date | null, diarioRecebidoEm: null as Date | null, termoAssinadoEm: null as Date | null, termoRecusado: false, prazoIndicacao: null as Date | null, indicadoEm: null as Date | null, pagoEm: null as Date | null, descontoCompetencia: null as Date | null };

async function puros() {
  const mu = await import("../src/lib/frota/multas");
  const hoje = d("2026-10-30");
  console.log("\n1. O processo");
  conferir("sem condutor: identificar; com diário pedido: aguardando; não localizado", [mu.passosAbertos(base)[0], mu.passosAbertos({ ...base, diarioSolicitadoEm: d("2026-10-01") })[0], mu.passosAbertos({ ...base, condutorNaoLocalizado: true })[0]], ["identificar_condutor", "aguardando_diario", "nao_localizado"]);
  conferir("com condutor e sem decisão: definir quem paga", mu.passosAbertos({ ...base, condutorPessoaId: "p" })[0], "definir_responsavel");
  conferir("motorista paga: termo, indicação, pagamento", mu.passosAbertos({ ...base, condutorPessoaId: "p", responsavel: "motorista" }), ["colher_termo", "indicar_condutor", "pagar"]);
  conferir("termo assinado, indicada e paga: falta só o desconto", mu.passosAbertos({ ...base, condutorPessoaId: "p", responsavel: "motorista", termoAssinadoEm: d("2026-10-01"), indicadoEm: d("2026-10-02"), pagoEm: d("2026-10-05") }), ["descontar"]);
  conferir("a empresa assume: só pagar; NIC não se indica", [mu.passosAbertos({ ...base, responsavel: "empresa" }), mu.passosAbertos({ ...base, ehNic: true, responsavel: "empresa" })], [["pagar"], ["pagar"]]);
  conferir("tudo feito: pronta para finalizar; finalizada: nada", [mu.passosAbertos({ ...base, responsavel: "empresa", pagoEm: d("2026-10-01") }), mu.passosAbertos({ ...base, situacao: "finalizada" })], [["concluir"], []]);
  conferir(
    "prazo de indicação: perdido, urgente, em dia; indicada ou assumida não conta",
    [mu.prazoDeIndicacao({ ...base, prazoIndicacao: d("2026-10-20") }, hoje), mu.prazoDeIndicacao({ ...base, prazoIndicacao: d("2026-11-03") }, hoje), mu.prazoDeIndicacao({ ...base, prazoIndicacao: d("2026-12-01") }, hoje).situacao, mu.prazoDeIndicacao({ ...base, prazoIndicacao: d("2026-10-20"), indicadoEm: d("2026-10-10") }, hoje).situacao, mu.prazoDeIndicacao({ ...base, responsavel: "empresa", prazoIndicacao: d("2026-10-20") }, hoje).situacao],
    [{ situacao: "perdido", dias: -10 }, { situacao: "urgente", dias: 4 }, "em_dia", "nao_se_aplica", "nao_se_aplica"]
  );
  const ms = [
    { condutorPessoaId: "p", dataInfracao: d("2026-09-01"), pontos: 7, situacao: "aberta", responsavel: "motorista", ehNic: false },
    { condutorPessoaId: "p", dataInfracao: d("2026-03-01"), pontos: 5, situacao: "finalizada", responsavel: "motorista", ehNic: false },
    { condutorPessoaId: "p", dataInfracao: d("2025-09-01"), pontos: 7, situacao: "finalizada", responsavel: "motorista", ehNic: false },
    { condutorPessoaId: "p", dataInfracao: d("2026-05-01"), pontos: 4, situacao: "aberta", responsavel: "empresa", ehNic: false },
    { condutorPessoaId: "p", dataInfracao: d("2026-06-01"), pontos: 7, situacao: "cancelada", responsavel: "motorista", ehNic: false },
    { condutorPessoaId: "p", dataInfracao: d("2026-07-01"), pontos: null, situacao: "aberta", responsavel: "a_definir", ehNic: false },
  ];
  conferir("pontos em 12 meses: sem as antigas, as assumidas e as anuladas", mu.pontosEm12Meses(ms, "p", hoje), { pontos: 12, multas: 3, semPontos: 1 });
  const t = new Date("2026-10-10T17:30:00.000Z");
  const usos = [{ driverId: "m1", checkInAt: new Date("2026-10-10T10:00:00Z"), checkOutAt: new Date("2026-10-10T20:00:00Z") }, { driverId: "m2", checkInAt: new Date("2026-10-09T10:00:00Z"), checkOutAt: new Date("2026-10-09T20:00:00Z") }];
  const escalas = [{ driverId: "m3", date: d("2026-10-10") }, { driverId: "m4", date: d("2026-10-10") }];
  conferir(
    "quem dirigia: o uso do veículo; sem uso, a escala; dois na escala, candidatos",
    [mu.condutorPelosRegistros(t, usos, escalas), mu.condutorPelosRegistros(t, [], escalas.slice(0, 1)), mu.condutorPelosRegistros(t, [], escalas), mu.condutorPelosRegistros(t, [], [])],
    [{ driverId: "m1", fonte: "uso" }, { driverId: "m3", fonte: "escala" }, { candidatos: ["m3", "m4"] }, null]
  );
  conferir("infração às 23h30 em SP é do dia em SP (escala)", mu.condutorPelosRegistros(new Date("2026-10-11T02:30:00Z"), [], escalas.slice(0, 1)), { driverId: "m3", fonte: "escala" });
  conferir("competência do desconto: o mês até o dia 20, senão o seguinte", [mu.competenciaDoDesconto(d("2026-10-15")).toISOString().slice(0, 10), mu.competenciaDoDesconto(d("2026-10-30")).toISOString().slice(0, 10), mu.competenciaDoDesconto(d("2026-12-28")).toISOString().slice(0, 10)], ["2026-10-01", "2026-11-01", "2027-01-01"]);

  console.log("\n2. A planilha");
  const r = mu.lerPlanilhaMultas(planilha());
  const porAit = new Map(r.multas.map((m) => [m.ait, m]));
  conferir("abas, multas e NIC; linha ruim vira problema", [r.abasLidas, r.multas.length, r.multas.filter((m) => m.ehNic).length, r.problemas.length], [["Controle Multas 2026", "Planilha1", "MULTAS NIC"], 8, 2, 1]);
  conferir("NÃO IDENTIFICADO não é nome: identificar o condutor (diário pedido)", [porAit.get("1DK9999999")!.condutorNome, mu.passosAbertos({ ...porAit.get("1DK9999999")!, condutorPessoaId: null, pagoEm: null })[0]], [null, "aguardando_diario"]);
  const a = porAit.get("I4702557731")!;
  conferir("finalizada com termo, indicação e desconto; pontos da outra aba; hora de SP", [a.situacao, a.responsavel, a.termoAssinadoEm?.toISOString().slice(0, 10), a.indicadoEm?.toISOString().slice(0, 10), a.descontoCompetencia?.toISOString().slice(0, 10), a.descontoValorCents, a.pontos, a.dataInfracao.toISOString()], ["finalizada", "motorista", "2026-03-19", "2026-03-04", "2026-03-01", 10413, 4, "2026-01-26T13:16:00.000Z"]);
  conferir("AZUL MOB: a empresa assumiu", [porAit.get("1DK2197171")!.responsavel, porAit.get("1DK2197171")!.descontoCompetencia], ["empresa", null]);
  const c = porAit.get("1DK2312751")!;
  conferir("URGENTE: aberta, a definir, diário pedido", [c.situacao, c.responsavel, c.diarioSolicitadoEm?.toISOString().slice(0, 10), c.indicadoEm], ["aberta", "a_definir", "2026-06-15", null]);
  conferir("não localizado: sem condutor, marcado", [porAit.get("SIC48789980")!.condutorNome, porAit.get("SIC48789980")!.condutorNaoLocalizado], [null, true]);
  conferir("NÃO ASSINOU: termo recusado", porAit.get("4VA17361472")!.termoRecusado, true);
  const n = porAit.get("I000080083")!;
  conferir("NIC: da empresa, apontando a originária, órgão herdado", [n.ehNic, n.responsavel, n.nicDeAit, n.orgao, n.valorCents], [true, "empresa", "1DK2312751", "DSV - PREFEITURA SP", 140866]);
  conferir("NIC com a linha deslocada: a data vem da coluna seguinte", porAit.get("I000080022")?.dataInfracao.toISOString().slice(0, 10), "2026-05-30");
}

async function noBanco() {
  const url = process.env.TESTE_DATABASE_URL;
  if (!url) {
    console.log("\nTESTE_DATABASE_URL não definida — pulando a parte com banco.");
    return;
  }
  process.env.DATABASE_URL = url;
  delete process.env.GESTAO_DATABASE_URL;
  const { prisma } = await import("../src/lib/prisma");
  const mu = await import("../src/lib/frota/multas");
  const { gravarMultas } = await import("../src/lib/frota/multasNoBanco");
  const { rodarPassoMultas } = await import("../src/lib/frota/agenteMultas");
  const { executarPendencia } = await import("../src/lib/auditoria/executores");
  const EMP = "empresa-teste-multas";
  const limpar = async () => {
    await prisma.audPendencia.deleteMany({ where: { companyId: EMP } });
    await prisma.audLog.deleteMany({ where: { companyId: EMP } });
    await prisma.frotaMulta.updateMany({ where: { companyId: EMP }, data: { nicDeId: null } });
    await prisma.frotaMulta.deleteMany({ where: { companyId: EMP } });
    await prisma.cadPessoa.deleteMany({ where: { companyId: EMP } });
    await prisma.cadVeiculo.deleteMany({ where: { companyId: EMP } });
  };
  await limpar();
  try {
    console.log("\n3. No banco");
    await prisma.cadVeiculo.create({ data: { companyId: EMP, placa: "ABC1D23", tipo: "van" } });
    await prisma.cadPessoa.create({ data: { companyId: EMP, cpf: "00000000191", nome: "Pessoa A", cargo: "motorista" } });
    const leitura = mu.lerPlanilhaMultas(planilha());
    const r1 = await gravarMultas(EMP, "teste", leitura);
    conferir("primeira vez: tudo novo; placa e condutor casados quando há cadastro", [r1.novas, r1.semVeiculo, r1.condutorSemCadastro], [8, 2, 3]);
    const a = await prisma.frotaMulta.findFirst({ where: { companyId: EMP, ait: "I4702557731" }, include: { condutor: true, veiculo: true } });
    conferir("multa ligada ao veículo e à pessoa", [a?.veiculo?.placa, a?.condutor?.nome, a?.condutorNome], ["ABC1D23", "Pessoa A", null]);
    const nic = await prisma.frotaMulta.findFirst({ where: { companyId: EMP, ait: "I000080083" }, include: { nicDe: true } });
    conferir("NIC ligada à multa de origem", nic?.nicDe?.ait, "1DK2312751");
    const r2 = await gravarMultas(EMP, "teste", leitura);
    conferir("segunda vez: nada novo, nada duplicado", [r2.novas, await prisma.frotaMulta.count({ where: { companyId: EMP } })], [0, 8]);

    // Uma com termo assinado e sem desconto (vai para o RH), outra com prazo
    // em 4 dias (pendência própria); as perdidas vão numa só.
    await prisma.frotaMulta.update({ where: { companyId_ait: { companyId: EMP, ait: "1DK2312751" } }, data: { condutorPessoaId: a!.condutorPessoaId, condutorNome: null, responsavel: "motorista", termoAssinadoEm: d("2026-10-01") } });
    const hoje = d("2026-10-30");
    const p1 = await rodarPassoMultas(EMP, hoje);
    const pend = await prisma.audPendencia.findMany({ where: { companyId: EMP }, orderBy: { tipo: "asc" } });
    conferir(
      "pendências: desconto (RH), prazo urgente, termo recusado e UMA para os perdidos",
      pend.map((p) => [p.tipo, p.perfilAprovador]),
      [["desconto-multa", "rh"], ["multa-indicacao", "multas"], ["multa-termo-recusado", "multas"], ["multas-prazo-perdido", "multas"]]
    );
    await rodarPassoMultas(EMP, hoje);
    conferir("rodar de novo não duplica", [p1.pendencias, await prisma.audPendencia.count({ where: { companyId: EMP } })], [4, 4]);
    const desconto = pend.find((p) => p.tipo === "desconto-multa")!;
    await prisma.audPendencia.update({ where: { id: desconto.id }, data: { status: "aprovada", decididaPor: "rh" } });
    await executarPendencia(desconto.id);
    const m = await prisma.frotaMulta.findFirst({ where: { companyId: EMP, ait: "1DK2312751" } });
    conferir("aprovado pelo RH: competência e valor gravados", [m?.descontoCompetencia?.toISOString().slice(0, 10), m?.descontoValorCents], ["2026-11-01", 23478]);
  } finally {
    await limpar();
    await prisma.$disconnect();
  }
}

puros()
  .then(noBanco)
  .then(() => {
    console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
    process.exit(falhas ? 1 : 0);
  })
  .catch((e) => {
    console.error("O teste não completou:", e);
    process.exit(1);
  });
