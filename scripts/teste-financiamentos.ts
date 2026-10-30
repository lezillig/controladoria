// FINANCIAMENTOS CONFERIDOS NA OMIE E A INTEGRAÇÃO COM A GESTÃO —
// `npm run teste:financiamentos`.
//
// Parte 1 (sem banco): o saldo para quitação (valor presente, que confere com
// o banco) e a situação do contrato pelas três fontes (Omie, informado,
// datas); o rateio por veículo; a ligação dos títulos aos contratos; o
// contrato da gestão no formato da conferência; o que vai para a gestão.
// Parte 2 (Postgres em TESTE_DATABASE_URL; sem ela, pula): os contratos lidos
// das tabelas da gestão (public."Financiamento", criadas aqui se o banco de
// teste não as tem), ligados aos títulos da Omie, a situação devolvida à
// gestão, o agente diário, as multas pelo AIT e a gestão fora do ar.

export {};

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "  ok  " : "FALHA "} ${nome}${ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         veio     ${JSON.stringify(real)}`}`);
}
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const hoje = d("2026-10-30");

async function puros() {
  const f = await import("../src/lib/frota/financiamentos");

  console.log("\n1. Saldo e situação do contrato");
  conferir("saldo para quitação = valor presente (o \"Valor para Quitação\" do banco)", f.saldoParaQuitacao({ produto: "financiamento_bens", restantes: 46, valorParcelaCents: 624848, taxaPct: 1.4 }), 21086907);
  conferir("consórcio: restantes × parcela", f.saldoParaQuitacao({ produto: "consorcio", restantes: 3, valorParcelaCents: 1000, taxaPct: 17 }), 3000);
  conferir("parcela da Omie", [f.lerNumeroParcela("007/048"), f.lerNumeroParcela("7 de 48"), f.lerNumeroParcela("3"), f.lerNumeroParcela("9/8")], [{ n: 7, total: 48 }, { n: 7, total: 48 }, { n: 3, total: null }, null]);
  conferir("vencimento no fim do mês curto", f.vencimentoDaParcela(d("2026-01-31"), 2, 31).toISOString().slice(0, 10), "2026-02-28");
  const base = { produto: "financiamento_bens", parcelas: 48, valorParcelaCents: 1_000_00, taxaPct: 1.4, dataPrimeiraParcela: d("2026-01-10"), dataFinal: null, vencimentoDia: 10, parcelasPagas: null, saldoQuitacaoCents: null, saldoInformadoEm: null, ativo: true };
  const pelasDatas = f.situacaoDoFinanciamento(base, hoje);
  conferir("sem Omie nem informado: pelas datas", [pelasDatas.origemPagas, pelasDatas.pagas, pelasDatas.restantes, pelasDatas.proximoVencimento?.toISOString().slice(0, 10)], ["datas", 10, 38, "2026-11-10"]);
  const informado = f.situacaoDoFinanciamento({ ...base, parcelasPagas: 8, saldoInformadoEm: d("2026-08-31") }, hoje);
  conferir("informado vale sobre as datas", [informado.origemPagas, informado.pagas], ["informado", 8]);
  const pag = (num: number | null, venc: string, pago: boolean) => ({ numeroParcela: num, dataVencimento: d(venc), valorCents: 1_000_00, pago, dataPagamento: pago ? d(venc) : null });
  const omie = f.situacaoDoFinanciamento({ ...base, parcelasPagas: 8, saldoInformadoEm: d("2026-08-31") }, hoje, [pag(9, "2026-09-10", true), pag(10, "2026-10-10", false), pag(11, "2026-11-10", false)]);
  conferir("Omie com \"009/048\": pagas pela maior paga; atrasada e a vencer", [omie.origemPagas, omie.pagas, omie.atrasadas, omie.aVencerNaOmie.quantidade, omie.ultimoPagamento?.toISOString().slice(0, 10)], ["omie", 9, { quantidade: 1, valorCents: 1_000_00 }, 1, "2026-09-10"]);
  const omieSemNumero = f.situacaoDoFinanciamento({ ...base, parcelasPagas: 8, saldoInformadoEm: d("2026-08-31") }, hoje, [pag(null, "2026-09-10", true), pag(null, "2026-10-10", true)]);
  conferir("Omie sem número: informado + pagas depois da informação", omieSemNumero.pagas, 10);
  conferir("parcelas previstas nos próximos 60 dias e não lançadas na Omie", omieSemNumero.naoLancadas, 2);
  const cons = f.situacaoDoFinanciamento({ ...base, produto: "consorcio", parcelasPagas: 8, saldoQuitacaoCents: 500_000_00, saldoInformadoEm: d("2026-08-31") }, hoje, [pag(null, "2026-09-10", true)]);
  conferir("consórcio: saldo informado − parcelas pagas depois", cons.saldoCents, 500_000_00 - 1_000_00);
  conferir(
    "rateio pela parcela de cada veículo; sem ela, igual",
    [[...f.rateioDoContrato([{ veiculoId: "a", parcelaCents: 300 }, { veiculoId: "b", parcelaCents: 100 }])], [...f.rateioDoContrato([{ veiculoId: "a", parcelaCents: null }, { veiculoId: "b", parcelaCents: 100 }])]],
    [[["a", 0.75], ["b", 0.25]], [["a", 0.5], ["b", 0.5]]]
  );
  const porVeic = f.saldoPorVeiculo([{ instituicao: "X", valorParcelaCents: 400, situacao: { ...pelasDatas, quitado: false, saldoCents: 1000 }, veiculos: [{ veiculoId: "a", parcelaCents: 300 }, { veiculoId: "b", parcelaCents: 100 }] }]);
  conferir("saldo devedor por veículo", porVeic.get("a"), { saldoCents: 750, parcelaMensalCents: 300, contratos: 1, instituicoes: ["X"] });

  console.log("\n2. Os títulos da Omie e os contratos");
  const po = await import("../src/lib/frota/parcelasOmie");
  conferir("palavras da instituição", [po.palavrasDaInstituicao("BANCO ITAUCARD"), po.palavrasDaInstituicao("BB CONSÓRCIOS"), po.palavrasDaInstituicao("CNP CONSÓRCIO (CAIXA)"), po.palavrasDaInstituicao("BRADESCO FINANCIAMENTOS")], [["ITAU"], ["BB", "BRASIL"], ["CNP", "CAIXA"], ["BRADESCO"]]);
  conferir(
    "parceiro: banco × administradora × quem vendeu o veículo",
    [
      po.parceiroCombina("BANCO STELLANTIS S.A.", ["STELLANTIS"], false),
      po.parceiroCombina("STELLANTIS AUTOMOVEIS BRASIL LTDA", ["STELLANTIS"], false),
      po.parceiroCombina("SANTANDER ADMINISTRADORA DE CONSORCIOS", ["SANTANDER"], false),
      po.parceiroCombina("SANTANDER ADMINISTRADORA DE CONSORCIOS", ["SANTANDER"], true),
      po.parceiroCombina("BB ADMINISTRADORA DE CONSORCIOS S.A.", ["BB", "BRASIL"], true),
    ],
    [true, false, false, true, true]
  );
  const ctr = (id: string, extra: Record<string, unknown> = {}) => ({ id, instituicao: "X", produto: "consorcio", contratoNumero: null, grupo: null, cota: null, valorParcelaCents: 1_850_68, vencimentoDia: 15, parcelas: 34, dataInicio: d("2024-01-01"), dataFinal: d("2027-12-31"), ...extra });
  const tit = (id: string, venc: string, valor: number, doc: string | null = null, parc: string | null = null) => ({ id, numeroDocumento: doc, numeroParcela: parc, dataVencimento: d(venc), valorDocumentoCents: valor });
  const lig = po.ligarTitulos(
    [ctr("c1", { contratoNumero: "806595", produto: "financiamento_bens", valorParcelaCents: 23_000_00 }), ctr("c2", { grupo: "2123", cota: "73" }), ctr("c3"), ctr("c4")],
    [
      tit("t1", "2026-09-15", 23_000_00, "CTR 806595", "028/036"),
      tit("t2", "2026-09-15", 1_850_68, "GR 2123 CT 73"),
      tit("t3", "2026-09-16", 1_850_68),
      tit("t4", "2026-09-15", 1_850_68),
      tit("t5", "2026-09-17", 1_850_68),
      tit("t6", "2026-10-15", 1_850_68),
      tit("t7", "2026-09-15", 999_00),
    ]
  );
  conferir(
    "títulos → contratos: pelo número, pela cota, pelo valor (um por mês em cotas iguais); sobra o que não cabe",
    [lig.ligacoes.map((l) => `${l.tituloId}>${l.financiamentoId}:${l.criterio}${l.numeroParcela ? `#${l.numeroParcela}` : ""}`), lig.sobras],
    [["t1>c1:contrato#28", "t2>c2:cota", "t4>c3:valor", "t3>c4:valor", "t6>c2:valor"], 2]
  );

  console.log("\n3. O contrato da gestão no formato da conferência");
  const { contratoDaGestao } = await import("../src/lib/frota/contratosDaGestao");
  const lido = { id: "g1", banco: "MONEO", modalidade: "CDC", numeroContrato: "806595", grupo: null, cota: null, valorCents: 434_846_66, taxaPct: 1.4, diaVencimento: 24, totalParcelas: 48, parcelasPagas: 2, valorParcelaCents: 12_496_96, saldoQuitacaoCents: 421_738_13, dataFinal: d("2030-06-24"), situacao: "ALIENADO", contemplacao: null, dataContemplacao: null, quitado: false, posicaoEm: d("2026-08-31") };
  const vg = (placa: string, vehicleId: string | null) => ({ id: `fv-${placa}`, financiamentoId: "g1", placa, vehicleId, parcelaCents: 6_248_48, saldoCents: null, modelo: "Master", status: "ATIVO", chassi: null });
  const c = contratoDaGestao(lido, [vg("ABC1D23", "v1"), vg("BRA2E19", null)]);
  conferir(
    "CDC vira financiamento de bens; posição da gestão = informado; início pelo fim e o prazo",
    [c.produto, c.instituicao, c.ativo, c.saldoInformadoEm?.toISOString().slice(0, 10), c.dataInicio?.toISOString().slice(0, 10), c.situacaoConsorcio],
    ["financiamento_bens", "MONEO", true, "2026-08-31", "2026-07-24", null]
  );
  conferir("placa sem veículo na gestão: a placa é a chave", c.veiculos.map((v) => v.veiculoId), ["v1", "placa:BRA2E19"]);
  const cota = contratoDaGestao({ ...lido, modalidade: "CONSORCIO", contemplacao: "SEM_BEM", quitado: true, parcelasPagas: null, saldoQuitacaoCents: null }, []);
  conferir("consórcio: contemplação e quitado; sem posição informada, sem data", [cota.produto, cota.situacaoConsorcio, cota.ativo, cota.saldoInformadoEm], ["consorcio", "contemplada_sem_bem", false, null]);

  console.log("\n4. O que vai para a gestão");
  const ig = await import("../src/lib/integracao/gestao");
  const situacao = f.situacaoDoFinanciamento({ ...c, parcelas: 3, parcelasPagas: 2 }, hoje, [{ numeroParcela: 3, dataVencimento: d("2026-09-24"), valorCents: 1, pago: true, dataPagamento: d("2026-09-25") }]);
  const sg = ig.situacaoParaGestao({ ...c, pagamentosOmie: [], situacao });
  conferir("última parcela paga na Omie com o contrato aberto: quitadoNaOmie", [sg.quitadoNaOmie, sg.pagas, sg.ultimoPagamento, sg.saldoCents], [true, 3, "2026-09-25", 0]);
  conferir("contrato já quitado na gestão não pede de novo", ig.situacaoParaGestao({ ...c, ativo: false, pagamentosOmie: [], situacao }).quitadoNaOmie, false);
  conferir("AIT normalizado", ig.normalizarAit(" 1dk-231.2751 "), "1DK2312751");
  const t = (id: string, doc: string, pago: boolean, venc: string) => ({ id, conexaoApelido: "AZUL", numeroDocumento: doc, observacao: null, dataVencimento: d(venc), valorDocumentoCents: 100_00, valorPagoCents: pago ? 100_00 : 0, liquidado: pago, dataUltimaBaixa: pago ? d(venc) : null });
  conferir(
    "o título do AIT: o pago primeiro, com a data da baixa",
    ig.casarTitulosComAits([t("a", "MULTA 1DK-2312751", false, "2026-10-01"), t("b", "1DK2312751 2a via", true, "2026-09-01"), t("c", "OUTRA", true, "2026-09-01")], ["1DK2312751", "ZZZ999999"]).map((p) => [p.ait, p.tituloId, p.pago, p.dataPagamento]),
    [["1DK2312751", "b", true, "2026-09-01"]]
  );
  const req = (h?: string) => new Request("http://x/api", { headers: h ? { authorization: h } : {} });
  const antes = process.env.INTEGRACAO_TOKEN;
  delete process.env.INTEGRACAO_TOKEN;
  const semToken = ig.integracaoAutorizada(req("Bearer qualquer"));
  process.env.INTEGRACAO_TOKEN = "segredo-de-teste";
  conferir("token: sem configurar, certo, errado, ausente", [semToken, ig.integracaoAutorizada(req("Bearer segredo-de-teste")), ig.integracaoAutorizada(req("Bearer segredo-de-testX")), ig.integracaoAutorizada(req())], ["nao-configurada", true, false, false]);
  if (antes === undefined) delete process.env.INTEGRACAO_TOKEN;
  else process.env.INTEGRACAO_TOKEN = antes;
}

async function noBanco() {
  const url = process.env.TESTE_DATABASE_URL;
  if (!url) {
    console.log("\nTESTE_DATABASE_URL não definida — pulando a parte com banco.");
    return;
  }
  process.env.DATABASE_URL = url;
  const { prisma } = await import("../src/lib/prisma");
  const { conciliarParcelasOmie } = await import("../src/lib/frota/parcelasOmie");
  const { contratosComSituacao } = await import("../src/lib/frota/contratosDaGestao");
  const { rodarAgenteFinanciamentos } = await import("../src/lib/frota/agenteFinanciamentos");
  const { patrimonioDaFrota } = await import("../src/lib/frota/patrimonio");
  const ig = await import("../src/lib/integracao/gestao");
  const EMP = "empresa-teste-financiamentos";
  const sql = (s: string) => prisma.$executeRawUnsafe(s);

  // As tabelas da gestão, só se o banco de teste não as tem (e então são
  // apagadas no fim); com elas, só as linhas desta empresa.
  const existe = async (t: string) => ((await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${t}'`))[0].n > 0);
  const criadas: string[] = [];
  for (const [t, ddl] of [
    ["Financiamento", `CREATE TABLE public."Financiamento" (id text PRIMARY KEY, "companyId" text, chave text, banco text, modalidade text, "numeroContrato" text, grupo text, cota text, "valorCents" int, "taxaPct" numeric(9,4), "diaVencimento" int, "totalParcelas" int, "parcelasPagas" int, "valorParcelaCents" int, "saldoQuitacaoCents" int, "dataFinal" timestamp, situacao text, contemplacao text, "dataContemplacao" timestamp, quitado boolean DEFAULT false, "posicaoEm" timestamp, origem text)`],
    ["FinanciamentoVeiculo", `CREATE TABLE public."FinanciamentoVeiculo" (id text PRIMARY KEY, "companyId" text, "financiamentoId" text, placa text, "vehicleId" text, "parcelaCents" int, "saldoCents" int, ativo boolean DEFAULT true)`],
    ["Vehicle", `CREATE TABLE public."Vehicle" (id text PRIMARY KEY, "companyId" text, plate text, status text, "currentMileage" int, model text, type text, year int)`],
    ["Multa", `CREATE TABLE public."Multa" (id text PRIMARY KEY, "companyId" text, "vehicleId" text, "dataInfracao" timestamp, "valorCents" int, "omieValorPagoCents" int, "quemPaga" text)`],
  ] as const) {
    if (!(await existe(t))) {
      await sql(ddl);
      criadas.push(t);
    }
  }
  for (const col of [`chassi text`, `"dataCompra" timestamp`, `"valorCompraCents" int`, `"dataVenda" timestamp`]) await sql(`ALTER TABLE public."Vehicle" ADD COLUMN IF NOT EXISTS ${col}`);

  const limpar = async () => {
    for (const t of ["FinanciamentoVeiculo", "Financiamento", "Vehicle", "Multa"]) if (await existe(t)) await sql(`DELETE FROM public."${t}" WHERE "companyId" = '${EMP}'`);
    for (const t of ["audPendencia", "audLog", "frotaParcelaOmie", "frotaInstituicaoParceiro", "omieBaixa", "omieTitulo", "omieParceiro", "omieConexao"] as const) {
      await (prisma[t] as unknown as { deleteMany: (a: object) => Promise<unknown> }).deleteMany({ where: { companyId: EMP } });
    }
  };
  await limpar();
  try {
    // A gestão: um CDC do MONEO com duas placas (uma ainda sem veículo) e uma cota da CNP.
    await sql(`INSERT INTO public."Vehicle" (id, "companyId", plate, status, "currentMileage", model, type, year, "dataCompra", "valorCompraCents") VALUES ('vf-a', '${EMP}', 'ABC1D23', 'ATIVO', 0, 'Master', 'VAN', 2024, '2026-06-20', 25570930)`);
    await sql(`INSERT INTO public."Financiamento" (id, "companyId", chave, banco, modalidade, "numeroContrato", "valorCents", "taxaPct", "diaVencimento", "totalParcelas", "parcelasPagas", "valorParcelaCents", "saldoQuitacaoCents", "dataFinal", situacao, quitado, "posicaoEm", origem) VALUES
      ('fin-a', '${EMP}', 'a', 'MONEO', 'CDC', '806595', 43484666, 1.4, 24, 48, 2, 1249696, 42173813, '2030-06-24', 'ALIENADO', false, '2026-08-31', 'teste'),
      ('fin-b', '${EMP}', 'b', 'CNP CONSÓRCIO (CAIXA)', 'CONSORCIO', NULL, 9929810, 0.17, 15, 34, 32, 185068, 370136, '2026-10-15', 'Não contemplada', false, '2026-08-31', 'teste')`);
    await sql(`UPDATE public."Financiamento" SET grupo = '2123', cota = '73', contemplacao = 'NAO_CONTEMPLADA' WHERE id = 'fin-b'`);
    await sql(`INSERT INTO public."FinanciamentoVeiculo" (id, "companyId", "financiamentoId", placa, "vehicleId", "parcelaCents", ativo) VALUES
      ('fv-1', '${EMP}', 'fin-a', 'ABC1D23', 'vf-a', 624848, true),
      ('fv-2', '${EMP}', 'fin-a', 'BRA2E19', NULL, 624848, true)`);

    // A Omie: o banco e a administradora, as parcelas e uma multa.
    const cx = await prisma.omieConexao.create({ data: { companyId: EMP, nome: "Teste", apelido: "TST", credencialRef: "TESTEFIN" } });
    const base = { companyId: EMP, conexaoId: cx.id, conexaoApelido: "TST" };
    await prisma.omieParceiro.createMany({
      data: [
        { ...base, codigoOmie: "P1", nome: "BANCO MONEO S.A.", ehFornecedor: true },
        { ...base, codigoOmie: "P2", nome: "CNP CONSORCIO S.A. ADMINISTRADORA DE CONSORCIOS", ehFornecedor: true },
      ],
    });
    let n = 0;
    const titulo = async (p: { parceiro: string | null; doc: string; parcela?: string; venc: string; valor: number; pago: boolean; categoria?: string }) => {
      const t = await prisma.omieTitulo.create({
        data: {
          ...base,
          natureza: "PAGAR",
          codigoLancamento: `L${++n}`,
          parceiroCodigo: p.parceiro,
          numeroDocumento: p.doc,
          numeroParcela: p.parcela ?? null,
          dataVencimento: d(p.venc),
          valorDocumentoCents: p.valor,
          valorPagoCents: p.pago ? p.valor : 0,
          status: p.pago ? "PAGO" : "A VENCER",
          liquidado: p.pago,
          dataUltimaBaixa: p.pago ? d(p.venc) : null,
          categoriaDescricao: p.categoria ?? "Financiamentos",
        },
      });
      if (p.pago) await prisma.omieBaixa.create({ data: { companyId: EMP, conexaoId: cx.id, tituloId: t.id, chave: `B${n}`, dataBaixa: d(p.venc), valorCents: p.valor } });
      return t;
    };
    await titulo({ parceiro: "P1", doc: "CTR 806595", parcela: "003/048", venc: "2026-09-24", valor: 1249696, pago: true });
    await titulo({ parceiro: "P1", doc: "CTR 806595", parcela: "004/048", venc: "2026-10-24", valor: 1249696, pago: false });
    await titulo({ parceiro: "P2", doc: "GR 2123 CT 73", venc: "2026-09-15", valor: 185068, pago: true });
    await titulo({ parceiro: "P2", doc: "BOLETO", venc: "2026-10-15", valor: 185068, pago: true });
    await titulo({ parceiro: null, doc: "MULTA 1DK-2312751", venc: "2026-10-05", valor: 19523, pago: true, categoria: "Multas de trânsito" });
    await titulo({ parceiro: null, doc: "MULTA AVULSA", venc: "2026-10-10", valor: 13000, pago: true, categoria: "Multas de trânsito" });

    console.log("\n5. A conferência com a Omie, lendo os contratos da gestão");
    const r = await conciliarParcelasOmie(EMP);
    conferir("os quatro títulos ligados, banco e administradora reconhecidos", [r.ligacoes, r.semParceiro, r.gestaoIndisponivel ?? false], [4, [], false]);
    const ligs = await prisma.frotaParcelaOmie.findMany({ where: { companyId: EMP }, orderBy: { criterio: "asc" } });
    conferir("ligação guardada pelo id do contrato na gestão", ligs.map((l) => `${l.financiamentoId}:${l.criterio}`), ["fin-a:contrato", "fin-a:contrato", "fin-b:cota", "fin-b:valor"]);
    const { contratos } = await contratosComSituacao(EMP, hoje);
    const a = contratos.find((c) => c.id === "fin-a")!;
    const b = contratos.find((c) => c.id === "fin-b")!;
    conferir("CDC: 3 pagas pela Omie, 1 em atraso, 2 a lançar", [a.situacao.origemPagas, a.situacao.pagas, a.situacao.atrasadas.quantidade, a.situacao.naoLancadas], ["omie", 3, 1, 2]);
    conferir("cota: 32 informadas + 2 pagas depois = quitada", [b.situacao.pagas, b.situacao.quitado, b.situacao.saldoCents], [34, true, 0]);

    console.log("\n6. O que a gestão recebe");
    const fg = await ig.financiamentosParaGestao(EMP, hoje);
    const ga = fg.contratos.find((c) => c.id === "fin-a")!;
    const gb = fg.contratos.find((c) => c.id === "fin-b")!;
    conferir("contrato a contrato", [fg.gestaoDisponivel, ga.parcelasLigadas, ga.atrasadas.quantidade, ga.quitadoNaOmie, gb.quitadoNaOmie, gb.ultimoPagamento], [true, 2, 1, false, true, "2026-10-15"]);
    const mg = await ig.multasParaGestao(EMP, [{ ait: "1DK2312751", dataInfracao: d("2026-09-10") }, { ait: "ZZZ999999", dataInfracao: d("2026-09-10") }], d("2026-09-01"));
    conferir("multa paga pelo AIT; a sem AIT aparece como paga sem multa", [mg.pagamentos.map((p) => [p.ait, p.pago, p.dataPagamento]), mg.semMulta?.map((t) => t.numeroDocumento)], [[["1DK2312751", true, "2026-10-05"]], ["MULTA AVULSA"]]);

    console.log("\n7. O agente diário");
    await prisma.audPendencia.create({ data: { companyId: EMP, agente: "agente-frota", tipo: "apolice", titulo: "x", perfilAprovador: "operacao" } });
    const ag = await rodarAgenteFinanciamentos(EMP, hoje, true);
    const pend = await prisma.audPendencia.findMany({ where: { companyId: EMP }, orderBy: { tipo: "asc" } });
    conferir("atraso e não lançada para o Financeiro; a de apólice encerrada (é da gestão)", [ag.pendencias, ag.encerradas, pend.map((p) => `${p.tipo}:${p.status}`)], [2, 1, ["apolice:rejeitada", "parcela-atraso:aguardando_aprovacao", "parcela-nao-lancada:aguardando_aprovacao"]]);
    const ag2 = await rodarAgenteFinanciamentos(EMP, hoje, true);
    conferir("rodar de novo não duplica", [ag2.pendencias, await prisma.audPendencia.count({ where: { companyId: EMP } })], [0, 3]);

    console.log("\n8. O patrimônio para a rentabilidade");
    await sql(`INSERT INTO public."Multa" (id, "companyId", "vehicleId", "dataInfracao", "valorCents", "omieValorPagoCents", "quemPaga") VALUES
      ('mu-1', '${EMP}', 'vf-a', '2026-10-05', 19523, 15618, 'empresa'), ('mu-2', '${EMP}', 'vf-a', '2026-10-06', 13000, NULL, 'motorista'), ('mu-3', '${EMP}', 'vf-a', '2026-09-06', 9000, NULL, 'empresa')`);
    const pat = await patrimonioDaFrota(EMP, { inicio: d("2026-10-01"), fim: d("2026-10-31") });
    conferir("multas assumidas no mês, pelo valor pago na Omie (a do motorista e a de outro mês ficam fora)", pat.multas.get("vf-a"), 15618);
    const fa = pat.financiamentos.filter((x) => x.vehicleId === "vf-a");
    conferir("compra da gestão; metade do CDC no veículo; juros pela taxa", [pat.saldoPelaOmie, pat.veiculos.find((v) => v.id === "vf-a")?.valorCompraCents, fa.map((x) => x.parcelaCents), (pat.juros.get("vf-a") ?? 0) > 0], [true, 25570930, [624848], true]);

    if (criadas.includes("Financiamento")) {
      console.log("\n9. A gestão fora do ar");
      await sql(`ALTER TABLE public."Financiamento" RENAME TO "FinanciamentoFora"`);
      try {
        const fora = await conciliarParcelasOmie(EMP);
        conferir("não refaz nada e as ligações ficam", [fora.gestaoIndisponivel, await prisma.frotaParcelaOmie.count({ where: { companyId: EMP } })], [true, 4]);
        const fg2 = await ig.financiamentosParaGestao(EMP, hoje);
        conferir("a integração diz que não leu (e não \"nada pago\")", fg2.gestaoDisponivel, false);
      } finally {
        await sql(`ALTER TABLE public."FinanciamentoFora" RENAME TO "Financiamento"`);
      }
    }
  } finally {
    await limpar();
    for (const t of criadas) await sql(`DROP TABLE IF EXISTS public."${t}"`);
    await prisma.$disconnect();
  }
}

(async () => {
  await puros();
  await noBanco();
  console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
  if (falhas) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
