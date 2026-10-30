// MOTORISTAS: DOCUMENTOS, APTIDÃO E FÉRIAS — `npm run teste:motoristas`.
//
// Parte 1 (sem banco): o que cada função exige, a categoria da CNH, a
// aptidão numa data (apto, não apto, documentos a lançar) e as férias pelos
// períodos aquisitivo e concessivo (saldo, em dobro, limite para começar,
// controle que começa depois da admissão). Parte 2 (Postgres em
// TESTE_DATABASE_URL; sem ela, pula): a admissão completada pela lista de
// ativos da folha e o agente diário abrindo as pendências — sem a gestão
// disponível, ele avisa e segue.

export {};

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "  ok  " : "FALHA "} ${nome}${ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         veio     ${JSON.stringify(real)}`}`);
}
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const iso = (x: Date | null | undefined) => (x ? x.toISOString().slice(0, 10) : null);

async function puros() {
  const doc = await import("../src/lib/pessoas/documentos");
  const fe = await import("../src/lib/pessoas/ferias");
  const hoje = d("2026-10-30");

  console.log("\n1. Documentos e aptidão");
  conferir(
    "exigidos: motorista, motorista do escolar, monitor do escolar, administrativo",
    [doc.documentosExigidos({ cargo: "motorista", transportaEscolar: false }), doc.documentosExigidos({ cargo: "motorista", transportaEscolar: true }).length, doc.documentosExigidos({ cargo: "monitor", transportaEscolar: true }), doc.documentosExigidos({ cargo: "adm", transportaEscolar: false })],
    [["cnh", "curso_coletivo", "toxicologico", "aso"], 6, ["aso", "antecedentes"], []]
  );
  conferir("CNH: D e E habilitam passageiros; B não; sem categoria, não se sabe", ["D", "AE", "b", "", null].map(doc.categoriaHabilitaPassageiros), [true, true, false, null, null]);
  const motorista = { cargo: "motorista", transportaEscolar: false, ativo: true };
  const emDia = [
    { tipo: "cnh", situacao: "vigente", validade: d("2028-05-01"), categoria: "D", ear: true },
    { tipo: "curso_coletivo", situacao: "vigente", validade: d("2029-01-10") },
    { tipo: "toxicologico", situacao: "vigente", validade: d("2026-11-15") },
    { tipo: "aso", situacao: "vigente", validade: d("2027-03-01") },
  ];
  const a1 = doc.aptidaoNaData(motorista, emDia, null, hoje);
  conferir("tudo em dia: apto, com aviso do que vence em 30 dias", [a1.situacao, a1.avisos], ["apto", ["toxicológico vence em 15/11/2026"]]);
  const a2 = doc.aptidaoNaData(motorista, emDia.map((x) => (x.tipo === "cnh" ? { ...x, categoria: "B" } : x)), null, hoje);
  conferir("CNH B: não apto", [a2.situacao, a2.bloqueios], ["nao_apto", ["CNH categoria B não habilita passageiros (D ou E)"]]);
  const a3 = doc.aptidaoNaData(motorista, emDia.filter((x) => x.tipo !== "aso"), null, hoje);
  conferir("sem ASO lançado: documentos a lançar (não trava, mas não garante)", [a3.situacao, a3.faltando], ["incompleto", ["ASO"]]);
  const a4 = doc.aptidaoNaData(motorista, emDia.map((x) => (x.tipo === "aso" ? { ...x, validade: d("2026-10-01") } : x)), null, hoje);
  conferir("ASO vencido: não apto, com a data", [a4.situacao, a4.bloqueios], ["nao_apto", ["ASO vencido em 01/10/2026"]]);
  const a5 = doc.aptidaoNaData(motorista, emDia, { fim: d("2026-11-10") }, hoje);
  conferir("de férias: não apto até a volta", [a5.situacao, a5.bloqueios], ["nao_apto", ["de férias até 10/11/2026"]]);
  const a6 = doc.aptidaoNaData({ ...motorista, transportaEscolar: true }, emDia, null, hoje);
  conferir("no escolar: falta curso escolar e certidão", a6.faltando, ["curso escolar", "antecedentes"]);
  const a7 = doc.aptidaoNaData(motorista, [...emDia, { tipo: "credencial_emtu", situacao: "vigente", validade: d("2026-09-01") }], null, hoje);
  conferir("credencial vencida (depende do contrato): avisa, não trava", [a7.situacao, a7.avisos.includes("EMTU vencido em 01/09/2026")], ["apto", true]);
  const a8 = doc.aptidaoNaData(motorista, emDia, null, d("2026-11-20"));
  conferir("aptidão no dia da escala: o toxicológico já terá vencido", [a8.situacao, a8.bloqueios], ["nao_apto", ["toxicológico vencido em 15/11/2026"]]);
  conferir("CNH sem EAR trava; não se aplica não conta", [doc.aptidaoNaData(motorista, emDia.map((x) => (x.tipo === "cnh" ? { ...x, ear: false } : x)), null, hoje).bloqueios, doc.aptidaoNaData(motorista, emDia.map((x) => (x.tipo === "aso" ? { ...x, situacao: "nao_se_aplica", validade: null } : x)), null, hoje).situacao], [["CNH sem EAR (atividade remunerada)"], "apto"]);
  conferir("administrativo: fora da escala", doc.aptidaoNaData({ cargo: "adm", transportaEscolar: false, ativo: true }, [], null, hoje).situacao, "nao_se_aplica");

  console.log("\n2. Férias");
  const adm = d("2023-03-01");
  const p1 = fe.periodosDeFerias(adm, [{ inicio: d("2024-07-01"), fim: d("2024-07-30") }], hoje, d("2024-01-01"));
  conferir(
    "períodos: aquisitivo, concessivo, situação",
    p1.map((p) => [iso(p.aquisitivoInicio), iso(p.aquisitivoFim), iso(p.concessivoFim), p.saldo, p.situacao]),
    [
      ["2023-03-01", "2024-02-29", "2025-02-28", 0, "quitado"],
      ["2024-03-01", "2025-02-28", "2026-02-28", 30, "vencido"],
      ["2025-03-01", "2026-02-28", "2027-02-28", 30, "a_gozar"],
      ["2026-03-01", "2027-02-28", "2028-02-29", 30, "em_aquisicao"],
    ]
  );
  conferir("limite para começar 30 dias dentro do concessivo", [iso(p1[2].inicioAte), p1[2].diasParaLimite], ["2027-01-30", 92]);
  const r1 = fe.resumoDeFerias(adm, [{ inicio: d("2024-07-01"), fim: d("2024-07-30") }], hoje, d("2024-01-01"));
  conferir("resumo: um vencido (30 dias) e o próximo limite", [r1.vencidos, r1.saldoVencidoDias, iso(r1.limite?.inicioAte), r1.limite?.situacao], [1, 30, "2027-01-30", "a_gozar"]);
  const p2 = fe.periodosDeFerias(adm, [{ inicio: d("2025-06-01"), fim: d("2025-06-30") }], hoje, d("2024-01-01"));
  conferir("férias depois do concessivo: gozadas, mas em dobro", [p2[0].situacao, p2[0].emDobroDias], ["quitado", 30]);
  const p3 = fe.periodosDeFerias(adm, [], hoje, d("2025-06-01"));
  conferir("controle começou depois: anterior, a conferir, a gozar", p3.map((p) => p.situacao), ["anterior", "a_conferir", "a_gozar", "em_aquisicao"]);
  const p5 = fe.periodosDeFerias(d("2021-04-12"), [{ inicio: d("2024-02-01"), fim: d("2024-03-01") }, { inicio: d("2025-02-01"), fim: d("2025-03-02") }], hoje, d("2024-02-01"));
  conferir(
    "período anterior ao controle é presumido gozado: as férias registradas vão para os seguintes",
    p5.map((p) => [p.situacao, p.saldo]),
    [["anterior", 0], ["quitado", 0], ["quitado", 0], ["vencido", 30], ["a_gozar", 30], ["em_aquisicao", 30]]
  );
  const p4 = fe.periodosDeFerias(adm, [{ inicio: d("2024-04-01"), fim: d("2024-04-20"), abonoDias: 10 }, { inicio: d("2025-04-01"), fim: d("2025-04-15") }], hoje, d("2024-01-01"));
  conferir("abono conta nos 30; férias em duas partes", p4.slice(0, 2).map((p) => [p.usados, p.saldo, p.situacao]), [[30, 0, "quitado"], [15, 15, "vencido"]]);
  conferir("sem admissão: sem períodos", fe.periodosDeFerias(null, [], hoje, null), []);
  conferir(
    "afastamentos picados viram blocos",
    fe.juntarFerias([{ id: "a", inicio: d("2026-01-06"), fim: d("2026-01-10") }, { id: "b", inicio: d("2026-01-01"), fim: d("2026-01-05") }, { id: "c", inicio: d("2026-01-20"), fim: d("2026-01-25") }]).map((b) => [iso(b.inicio), iso(b.fim), b.ids.length]),
    [["2026-01-01", "2026-01-10", 2], ["2026-01-20", "2026-01-25", 1]]
  );
  conferir("de férias no dia", [iso(fe.feriasNoDia([{ inicio: d("2026-10-20"), fim: d("2026-11-08") }], hoje)?.fim), fe.feriasNoDia([{ inicio: d("2026-10-20"), fim: d("2026-10-29") }], hoje)], ["2026-11-08", null]);
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
  const { rodarAgenteMotoristas } = await import("../src/lib/pessoas/agenteMotoristas");
  const EMP = "empresa-teste-motoristas";
  const limpar = async () => {
    await prisma.audPendencia.deleteMany({ where: { companyId: EMP } });
    await prisma.audLog.deleteMany({ where: { companyId: EMP } });
    await prisma.pesDocumento.deleteMany({ where: { companyId: EMP } });
    await prisma.pesFerias.deleteMany({ where: { companyId: EMP } });
    await prisma.cadPessoa.deleteMany({ where: { companyId: EMP } });
    await prisma.folhaQuadro.deleteMany({ where: { companyId: EMP } });
  };
  await limpar();
  try {
    console.log("\n3. O agente no banco");
    const hoje = d("2026-10-30");
    // Ana: ASO vencido e um período sem férias; Beto: sem admissão (vem da
    // folha) e sem férias no primeiro período; Caio: limite para começar as
    // férias em 42 dias; Dani: no primeiro período, nada a cobrar.
    const [ana, beto, caio, dani] = await Promise.all(
      [
        { cpf: "00000000191", nome: "Ana Teste", dataAdmissao: d("2023-03-01") },
        { cpf: "00000000272", nome: "Beto Teste", dataAdmissao: null },
        { cpf: "00000000353", nome: "Caio Teste", dataAdmissao: d("2025-01-10") },
        { cpf: "00000000434", nome: "Dani Teste", dataAdmissao: d("2026-02-01") },
      ].map((p) => prisma.cadPessoa.create({ data: { companyId: EMP, cargo: "motorista", ...p } }))
    );
    const quem = new Map([[ana.id, "ana"], [beto.id, "beto"], [caio.id, "caio"], [dani.id, "dani"]]);
    await prisma.folhaQuadro.create({
      data: { companyId: EMP, conexaoId: "conexao-teste-motoristas", empresaCodigo: "1", competencia: d("2026-10-01"), arquivoNome: "ativos.xlsx", pessoas: 1, salarioCents: 0, lista: { create: [{ matricula: "1", nome: "BETO TESTE", admissao: d("2024-05-02"), salarioCents: 0, centroCustoCodigo: "1", centroCustoDescricao: "X" }] } },
    });
    await prisma.pesDocumento.create({ data: { companyId: EMP, pessoaId: ana.id, tipo: "aso", validade: d("2026-10-01") } });
    await prisma.pesFerias.create({ data: { companyId: EMP, pessoaId: ana.id, inicio: d("2024-07-01"), fim: d("2024-07-30"), origem: "manual" } });
    const r = await rodarAgenteMotoristas(EMP, hoje, true);
    conferir("admissão completada pela lista de ativos", [r.admissoesCompletadas, iso((await prisma.cadPessoa.findUnique({ where: { id: beto.id } }))?.dataAdmissao)], [1, "2024-05-02"]);
    const pend = await prisma.audPendencia.findMany({ where: { companyId: EMP } });
    conferir(
      "pendências para o RH: documento vencido, férias vencidas, férias a programar",
      pend.map((p) => [p.tipo, p.perfilAprovador, quem.get((p.evidencias as { pessoaId?: string }).pessoaId ?? "")]).sort((a, b) => `${a[0]}${a[2]}`.localeCompare(`${b[0]}${b[2]}`)),
      [["documento-pessoa-vencido", "rh", "ana"], ["ferias-a-programar", "rh", "caio"], ["ferias-vencidas", "rh", "ana"], ["ferias-vencidas", "rh", "beto"]]
    );
    conferir("sem a gestão: avisa e segue", r.avisosLeitura.some((a) => a.includes("férias não atualizadas")), true);
    const r2 = await rodarAgenteMotoristas(EMP, hoje);
    conferir("uma vez por dia", r2.jaRodouHoje, true);
    await rodarAgenteMotoristas(EMP, hoje, true);
    conferir("rodar de novo não duplica a pendência", await prisma.audPendencia.count({ where: { companyId: EMP } }), 4);
    conferir("quem não tem nada vencido não ganha pendência", await prisma.audPendencia.count({ where: { companyId: EMP, evidencias: { path: ["pessoaId"], equals: dani.id } } }), 0);
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
