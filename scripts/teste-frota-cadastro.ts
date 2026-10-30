// FROTA, DOCUMENTOS E FINANCIAMENTOS — `npm run teste:frota-cadastro`.
//
// Parte 1 (sem banco): RENAVAM e chassi; a ficha do veículo; a situação dos
// documentos; o saldo para quitação (valor presente, que confere com o banco)
// e a situação do contrato pelas três fontes (Omie, informado, datas); o
// rateio por veículo; a leitura das planilhas (montadas aqui, no formato das
// reais: cabeçalho fora da linha 1, contrato que continua na linha de baixo,
// bloco de quitados, tabela dinâmica e total no meio). Parte 2 (Postgres em
// TESTE_DATABASE_URL; sem ela, pula): a migração gravada duas vezes — a
// segunda não duplica nada.

import ExcelJS from "exceljs";

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "  ok  " : "FALHA "} ${nome}${ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         veio     ${JSON.stringify(real)}`}`);
}
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

// As planilhas de exemplo, no formato das reais (dados inventados).
function planilhas() {
  const controle = new ExcelJS.Workbook();
  const fa = controle.addWorksheet("FROTA ATIVA");
  fa.addRow(["CONTRATO", "PREFIXO", "NF COMPRA", "DATA DE COMPRA", "VALOR COMPRA", "PLACA", "LICENCIAMENTO", "CRLV", "CRV", "ISENÇÃO IPVA", "INÍCIO ISENÇÃO", "MARCA", "MODELO", "COR", "RENAVAM", "CHASSIS", "FABRICAÇÃO", "MODELO", "ADAPTAÇÃO", "CAPACIDADE", "TIPO", "CATEGORIA", "ALUGUEL", "TACÓGRAFO", "ARTESP", "EMTU", "Nº  CVS", "CVS - VALIDADE", "Nº CRM", "CRM - VALIDADE", "VENC. SEMESTRAL", "ATE - ESCOLAR", "EMDEC ESCOLAR", "EMDEC FRETAMENTO", "ANTT", "APÓLICE APP / RCF", "VENCIMENTO APÓLICE", "TAG PEDÁGIO"]);
  fa.addRow(["ESCOLAR - SUL 01", 12, 4455, d("2023-08-04"), 200000, "ABC-1D23", "FINAL 3", 2026, "ATPV", "ISENTO - FALTA RESTITUIR", d("2024-01-01"), "Renault", "Master", "BRANCO", "01234567897", "93YF62004SJ991981", 2023, 2024, "LETRA G", "16 Lugares", "VAN", "Escolar", "ALUGUEL", d("2027-01-07"), "N/A", "N/A", "047.927-85", d("2026-12-05"), "N/A", "N/A", d("2026-11-10"), "SRV2891514", "N/A", "N/A", "N/A", "ESCOLAR - 1002806001248", d("2027-08-17"), "SIM"]);
  fa.addRow(["FRETAMENTO", "N/A", "?", "?", "?", "BRA2E19", "FINAL 9", 2025, "OK", "NÃO TEM ISENÇÃO", "NÃO TEM ISENÇÃO", "Marcopolo", "Volare", "PRATA", "123", "93PB84936RS505184", 2024, 2024, "-", "28 Lugares", "MICRO", "Fretamento", "PARTICULAR", "PRELIMINAR", d("2026-12-02"), "INCLUSÃO", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "FRETAMENTO - 1002806001249 ", d("2027-08-17"), "NÃO"]);
  const vend = controle.addWorksheet("VENDIDOS");
  vend.addRow(["VEÍCULOS VENDIDOS"]);
  vend.addRow(["DATA DE VENDA", "VALOR", "CONTRATO", "COMPRADOR", "COMPRA FINALIZADA", "PLACA", "MARCA", "MODELO", "RENAVAM", "CHASSIS", "Ano Fabricação", "Ano Modelo"]);
  vend.addRow([d("2024-06-04"), 140000, "FRETAMENTO", "COMPRADOR X", "SIM - FALTA CRM", "DTD8077", "Fiat", "Ducato", "?", "93W245H3392040666", 2009, 2009]);
  const cons = controle.addWorksheet("CONSULTA DE PLACA");
  cons.addRow(["CONTRATO", "PESQUISA LW", "PESQUISA FAZENDA", "PLACA"]);
  cons.addRow(["X", d("2026-09-22"), d("2026-09-25"), "ABC1D23"]);

  const fin = new ExcelJS.Workbook();
  const cg = fin.addWorksheet("Controle Geral");
  cg.addRow([]);
  cg.addRow([null, "Acumulado Geral"]);
  cg.addRow([null, d("2026-08-31")]);
  const cdc = fin.addWorksheet("CDC MONEO");
  cdc.addRow([null, null, "Banco MONEO"]);
  cdc.addRow([1, "Banco", "Nº Contrato", "Tipo Contrato", "Valor Financiado", "Taxa Mês (%)", "Vencimento", "Total de Parcelas", "Parcelas Pagas", "Parcelas Restantes", "Valor da Parcela", "Valor Pago", "Vl para Quitação", "Data Final", "Situação", "Placa", "Parcela Placa", "Saldo Placa", "Chassi", "Renavam", "Ano / Modelo", "Marca", "Modelo", "DANFE / NF", "Data de Emissão", "Empresa", "Valor da Nota"]);
  cdc.addRow([null, "MONEO", 806595, "Financiamento", 434846.66, 0.014, 24, 48, 2, 46, 12496.96, 24993.92, 421738.13, d("2030-08-24"), "ALIENADO", "ABC1D23", 6248.48, 210869.07]);
  // Continuação: outro veículo do mesmo contrato, sem repetir o contrato.
  cdc.addRow([null, "MONEO", null, null, null, null, null, null, null, null, null, null, null, null, "ALIENADO", "0", 6248.48, 210869.07, "93YF62S01VJ707143", null, "2026/2027", "RENAULT", "MASTER", 1519502, d("2026-08-20"), "RENAULT DO BRASIL", 255709.3]);
  cdc.addRow([null, null, 2, "Total", 434846.66]);
  cdc.addRow([null, null, "Rótulos de Linha", "Soma de Parcela Placa"]);
  cdc.addRow([null, null, "ABC1D23", 6248.48]);
  cdc.getCell("F3").numFmt = "0.00%";
  const cc = fin.addWorksheet("CONS. CNP (CAIXA)");
  cc.addRow([null, null, null, null, null, "CNP Consórcios (CAIXA)"]);
  const cabCnp = ["Banco", "Nº Contrato", "Grupo", "Cota", "Faixa de Crédito", "Lance", "Líquido", "Vencimento", "Taxa Mês (%)", "Nº de Parcelas", "Parcelas Pagas", "Parcelas Restantes", "Valor da Parcela", "Valor para Quitação", "Data Final", "DT Contemplação", "Situação", "Placa"];
  cc.addRow(cabCnp);
  cc.addRow([null, 6152941, 2123, 26, 99298.1, 0.475, 52131.5, 15, 0.17, 37, 36, 1, 3220.44, 3220.44, d("2026-11-15"), d("2026-06-22"), "Contemplada com o bem", "BRA2E19"]);
  cc.addRow([null, 6156079, 2123, 73, 99298.1, 0, null, 15, 0.17, 34, 33, 1, 1850.68, 1850.68, d("2026-11-15"), null, "Não contemplada", null]);
  cc.addRow([null, null, 2124, 5, 50000, null, null, 15, 0.17, 40, 10, 30, 1500, 45000, d("2029-01-15"), d("2026-07-01"), "Contemplada sem o bem", null]);
  cc.addRow(["QUITADOS"]);
  cc.addRow(cabCnp);
  cc.addRow([null, 6100001, 2000, 1, 80000, null, null, 15, 0.17, 30, 30, 0, 2000, 0, d("2025-11-15"), d("2023-01-10"), "Contemplada com o bem", "DTD8077"]);
  cc.getCell("I3").numFmt = "0%";
  cc.getCell("I4").numFmt = "0%";
  return [
    { nome: "CONTROLE.xlsm", livro: controle },
    { nome: "Consorcios.xlsx", livro: fin },
  ];
}

async function puros() {
  const n = await import("../src/lib/cadastro/normalizacao");
  const ficha = await import("../src/lib/cadastro/fichaVeiculo");
  const docs = await import("../src/lib/frota/documentos");
  const f = await import("../src/lib/frota/financiamentos");
  const { lerPlanilhas } = await import("../src/lib/frota/migracaoPlanilhas");

  console.log("\n1. RENAVAM, chassi e a ficha");
  conferir("RENAVAM com o zero à esquerda e dígito certo", [n.normalizarRenavam("1234567897"), n.normalizarRenavam("01234567890")], ["01234567897", null]);
  conferir("chassi: 17 caracteres, sem I/O/Q", [n.normalizarChassi("93yf62004sj991981"), n.normalizarChassi("93YF6200OSJ991981"), n.normalizarChassi("123")], ["93YF62004SJ991981", null, null]);
  const ok = ficha.lerVeiculo({ placa: "abc-1d23", tipo: "van", anoFab: "2023", anoMod: "2024", capacidade: "16", categoriaUso: "escolar", valorCompra: "200.000,00", tagPedagio: "sim" }, d("2026-10-30"), true);
  conferir("ficha válida, com valor só para quem vê valores", ok.ok ? [ok.dados.placa, ok.dados.tagPedagio, ok.dados.valorCompraCents?.toString()] : ok, ["ABC1D23", true, "20000000"]);
  const semValor = ficha.lerVeiculo({ placa: "ABC1D23", valorCompra: "1" }, d("2026-10-30"), false);
  conferir("sem a permissão de valores, o valor não entra", semValor.ok ? "valorCompraCents" in semValor.dados : semValor, false);
  conferir("sem placa e sem chassi: recusa", ficha.lerVeiculo({}, d("2026-10-30")).ok, false);
  conferir("veículo novo sem placa, pelo chassi", ficha.lerVeiculo({ chassi: "93YF62S01VJ707143" }, d("2026-10-30")).ok, true);
  conferir("ano do modelo dois anos depois: recusa", ficha.lerVeiculo({ placa: "ABC1D23", anoFab: "2020", anoMod: "2022" }).ok, false);
  conferir("venda exige comprador", ficha.lerSituacao({ acao: "vender", data: "2026-10-01" }, d("2026-10-30")).ok, false);
  conferir(
    "IPVA pelo texto da planilha",
    ["ISENTO - FALTA RESTITUIR", "NÃO TEM ISENÇÃO", "VALOR RESTITUÍDO - ISENTO", "SEM RESTITUIÇÃO - ISENTO", "EM ANÁLISE"].map(ficha.situacaoIpva),
    ["isento_falta_restituir", "nao_isento", "isento_restituido", "isento_sem_restituicao", "em_analise"]
  );
  const inv = ficha.investimentoDoVeiculo({ valorCompraCents: 200_000_00, vidaUtilMeses: 60, dataCompra: d("2024-10-01"), fipeValorCents: 180_000_00, valorAjustadoCents: null }, 20_000_00, d("2026-10-30"));
  conferir("investimento = compra + adaptações; depreciação e residual; mercado pela FIPE", [inv.investidoCents, inv.depreciacaoMensalCents, inv.residualContabilCents, inv.fonteMercado], [220_000_00, 3_666_67, 220_000_00 - 3_666_67 * 24, "FIPE"]);

  console.log("\n2. Documentos");
  const hoje = d("2026-10-30");
  const al = (validade: string | null, tipo = "artesp", situacao = "vigente") => docs.alertaDoDocumento({ tipo, situacao, validade: validade ? d(validade) : null }, hoje);
  conferir("vencido, 7, 30, 60 dias e em dia", [al("2026-10-29"), al("2026-11-05"), al("2026-11-25"), al("2026-12-20"), al("2027-06-01")], ["vencido", "7", "30", "60", "ok"]);
  conferir("tacógrafo avisa só com 30 dias", al("2026-12-20", "tacografo"), "ok");
  conferir("não se aplica e sem data", [al(null, "artesp", "nao_se_aplica"), al(null)], ["nao_se_aplica", "sem_data"]);
  conferir("célula da planilha", ["N/A", "PRELIMINAR", "INCLUSÃO", "?", "25/05/2024 - ROUBADA", "SRV2891514"].map((x) => docs.lerCelulaDocumento(x)?.situacao), ["nao_se_aplica", "preliminar", "em_inclusao", "pendente", "vigente", "pendente"]);

  const ctl = await import("../src/lib/frota/controles");
  const ap = (segmento: string | null, fim: string | null, ativo = true) => ({ ativo, segmento, vigenciaFim: fim ? d(fim) : null });
  const veic = (status: string, categoriaUso: string | null, tipo = "van", venc: string | null = null) => ({ status, categoriaUso, tipo, apoliceVencimento: venc ? d(venc) : null });
  conferir(
    "apólice: coberto, vence em breve, vencida, sem apólice, segmento errado, fora da frota",
    [
      ctl.coberturaDeApolice(veic("ativo", "escolar"), ap("escolar", "2027-08-17"), hoje),
      ctl.coberturaDeApolice(veic("ativo", "fretamento"), ap("fretamento", "2026-12-01"), hoje),
      ctl.coberturaDeApolice(veic("manutencao", "fretamento", "van", "2026-10-01"), ap("fretamento", "2027-08-17"), hoje),
      ctl.coberturaDeApolice(veic("ativo", "escolar"), null, hoje),
      ctl.coberturaDeApolice(veic("ativo", "escolar"), ap("fretamento", "2027-08-17"), hoje),
      ctl.coberturaDeApolice(veic("vendido", "escolar"), null, hoje),
    ],
    ["coberto", "vence_em_breve", "vencida", "sem_apolice", "segmento_incompativel", "nao_se_aplica"]
  );

  console.log("\n3. Financiamentos");
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
  const ctr = (id: string, extra: Record<string, unknown> = {}) => ({ id, instituicao: "X", produto: "consorcio", contratoNumero: null, grupo: null, cota: null, valorParcelaCents: BigInt(1_850_68), vencimentoDia: 15, parcelas: 34, dataInicio: d("2024-01-01"), dataFinal: d("2027-12-31"), ...extra });
  const tit = (id: string, venc: string, valor: number, doc: string | null = null, parc: string | null = null) => ({ id, numeroDocumento: doc, numeroParcela: parc, dataVencimento: d(venc), valorDocumentoCents: valor });
  const lig = po.ligarTitulos(
    [ctr("c1", { contratoNumero: "806595", produto: "financiamento_bens", valorParcelaCents: BigInt(23_000_00) }), ctr("c2", { grupo: "2123", cota: "73" }), ctr("c3"), ctr("c4")],
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

  console.log("\n4. Leitura das planilhas");
  const r = lerPlanilhas(planilhas());
  const placa = (p: string) => r.veiculos.find((v) => v.placa === p)!;
  conferir("veículos: 2 ativos, 1 vendido, 1 novo sem placa (pelo chassi)", [r.veiculos.length, r.veiculos.filter((v) => v.status === "vendido").map((v) => v.placa), r.veiculos.filter((v) => !v.placa).map((v) => v.chassi)], [4, ["DTD8077"], ["93YF62S01VJ707143"]]);
  const v = placa("ABC1D23");
  conferir("ficha da planilha", [v.prefixo, v.tipo, v.capacidade, v.categoriaUso, v.categoriaRegistro, v.ipvaSituacao, v.tagPedagio, v.renavam, v.valorCompraCents, v.apoliceDescricao], ["12", "van", 16, "escolar", "aluguel", "isento_falta_restituir", true, "01234567897", 200000_00, "ESCOLAR - 1002806001248"]);
  conferir("documentos: CVS com número, ATE com número no lugar da data", [v.documentos.find((x) => x.tipo === "cvs")?.numero, v.documentos.find((x) => x.tipo === "ate_escolar")?.situacao, v.documentos.find((x) => x.tipo === "ate_escolar")?.numero], ["047.927-85", "pendente", "SRV2891514"]);
  conferir("RENAVAM inválido vira problema, não dado", [placa("BRA2E19").renavam, r.problemas.some((p) => p.problema.includes("RENAVAM"))], [null, true]);
  conferir("consultas e data de referência", [v.consultas.length, r.dataReferencia?.toISOString().slice(0, 10)], [2, "2026-08-31"]);
  const moneo = r.financiamentos.find((x) => x.instituicao === "BANCO MONEO")!;
  conferir("CDC: dois veículos no mesmo contrato; taxa em %; total e dinâmica ignorados", [r.financiamentos.filter((x) => x.produto === "financiamento_bens").length, moneo.veiculos.map((x) => x.chave), moneo.taxaPct, moneo.alienado], [1, ["P:ABC1D23", "C:93YF62S01VJ707143"], 1.4, true]);
  conferir("o veículo novo ganhou NF e vendedor da aba do banco", [r.veiculos.find((x) => !x.placa)?.notaFiscalCompra, r.veiculos.find((x) => !x.placa)?.vendedorNome], ["1519502", "RENAULT DO BRASIL"]);
  const cotas = r.financiamentos.filter((x) => x.produto === "consorcio");
  conferir(
    "cotas: situação, lance em % do crédito, cota sem contrato por grupo/cota, bloco de quitados",
    cotas.map((c) => [c.cota, c.situacaoConsorcio, c.lanceCents, c.quitado, c.taxaPct]),
    [["26", "contemplada_com_bem", Math.round(0.475 * 9929810), false, 17], ["73", "nao_contemplada", 0, false, 17], ["5", "contemplada_sem_bem", null, false, 0.17], ["1", "contemplada_com_bem", null, true, 0.17]]
  );

  console.log("\nFIPE: a sugestão a partir do cadastro e a tabela do mês");
  const fipe = await import("../src/lib/frota/fipe");
  conferir("preço da FIPE em centavos", [fipe.lerPrecoFipe("R$ 40.202,00"), fipe.lerPrecoFipe("R$ 1.234.567,89"), fipe.lerPrecoFipe("sem preço")], [4020200, 123456789, null]);
  conferir("van e carro na tabela de carros; micro e ônibus na de caminhões", ["van", "carro", "micro", "onibus", "caminhao"].map(fipe.tipoFipeDoVeiculo), ["cars", "cars", "trucks", "trucks", "trucks"]);
  const marcasCarros = [{ codigo: "39", nome: "Mercedes-Benz" }, { codigo: "48", nome: "Renault" }, { codigo: "59", nome: "VW - VolksWagen" }, { codigo: "13", nome: "Citroën" }];
  const marcasCaminhoes = [{ codigo: "108", nome: "MARCOPOLO" }, { codigo: "109", nome: "MERCEDES-BENZ" }, { codigo: "102", nome: "AGRALE" }];
  conferir(
    "marca: apelidos da planilha (MB, VW, Volare, sem acento)",
    [fipe.marcaSugerida(marcasCarros, "MB")?.codigo, fipe.marcaSugerida(marcasCarros, "vw")?.codigo, fipe.marcaSugerida(marcasCarros, "Citroen")?.codigo, fipe.marcaSugerida(marcasCaminhoes, "Volare")?.codigo, fipe.marcaSugerida(marcasCaminhoes, "MERCEDES")?.codigo, fipe.marcaSugerida(marcasCarros, "Tesla")],
    ["39", "59", "13", "108", "109", null]
  );
  const modelos = [{ codigo: "1", nome: "Sprinter 415 Furgão Curto T.B. 2.2 Dies." }, { codigo: "2", nome: "Master Furgão L3H2 2.3 Diesel" }, { codigo: "3", nome: "Master Minibus Exec. L3H2 2.3 Diesel" }, { codigo: "4", nome: "Kangoo Express 1.6" }];
  conferir("modelos: os parecidos com o cadastro primeiro", fipe.modelosParecidos(modelos, "MASTER MINIBUS").map((m) => m.codigo), ["3", "2", "4", "1"]);
  const masters = [{ codigo: "c", nome: "Master 2.3 dCi Chassi 16V Diesel" }, { codigo: "f", nome: "Master 2.3 dCi Furgão 16V Diesel" }, { codigo: "e", nome: "Master 2.3 dCi Executive Longo 16L Dies" }, { codigo: "s", nome: "Master 2.3 dCi STD Médio Esco. 20L Dies." }, { codigo: "k", nome: "Kangoo Express 1.6" }];
  conferir(
    "van de passageiros: versão de passageiro antes de chassi e furgão; capacidade e uso desempatam",
    [
      fipe.modelosParecidos(masters, "Master", { tipo: "van", capacidade: 16, categoriaUso: "fretamento" }).map((m) => m.codigo),
      fipe.modelosParecidos(masters, "Master", { tipo: "van", capacidade: 20, categoriaUso: "escolar" })[0].codigo,
      fipe.modelosParecidos(masters, "Master", { tipo: "caminhao" })[0].codigo,
    ],
    [["e", "s", "c", "f", "k"], "s", "c"]
  );
  const anos = [{ codigo: "32000-3", nome: "32000 Diesel" }, { codigo: "2026-3", nome: "2026 Diesel" }, { codigo: "2025-1", nome: "2025 Gasolina" }, { codigo: "2025-3", nome: "2025 Diesel" }];
  conferir(
    "ano: o do cadastro (diesel antes); o do ano que vem cai no Zero KM",
    [fipe.anoSugerido(anos, 2025)?.codigo, fipe.anoSugerido(anos, 2027)?.codigo, fipe.anoSugerido(anos, 2019), fipe.anoSugerido(anos, null)],
    ["2025-3", "32000-3", null, null]
  );
  conferir(
    "a referência da lista e a do preço são a mesma",
    [fipe.chaveDaReferencia("outubro/2026") === fipe.chaveDaReferencia("outubro de 2026"), fipe.chaveDaReferencia("março de 2026") === fipe.chaveDaReferencia("marco/2026"), fipe.chaveDaReferencia("setembro/2026") === fipe.chaveDaReferencia("outubro de 2026")],
    [true, true, false]
  );
  const { chaveDoGrupoFipe } = await import("../src/lib/frota/frotaNoBanco");
  conferir(
    "veículos iguais: mesma marca, modelo e ano, sem diferença de caixa",
    [chaveDoGrupoFipe({ tipo: "van", marca: "Renault", modelo: "Master", anoMod: 2024 }) === chaveDoGrupoFipe({ tipo: "van", marca: "RENAULT", modelo: "master ", anoMod: 2024 }), chaveDoGrupoFipe({ tipo: "van", marca: "Renault", modelo: "Master", anoMod: 2024 }) === chaveDoGrupoFipe({ tipo: "van", marca: "Renault", modelo: "Master", anoMod: 2025 })],
    [true, false]
  );
}

async function noBanco() {
  const url = process.env.TESTE_DATABASE_URL;
  if (!url) {
    console.log("\nTESTE_DATABASE_URL não definida — pulando a parte com banco.");
    return;
  }
  process.env.DATABASE_URL = url;
  const { prisma } = await import("../src/lib/prisma");
  const { lerPlanilhas } = await import("../src/lib/frota/migracaoPlanilhas");
  const { gravarFrota, gravarContratos } = await import("../src/lib/frota/migracaoNoBanco");
  const EMP = "empresa-teste-frota";
  const limpar = async () => {
    for (const t of ["audLog", "frotaFinanciamentoVeiculo", "frotaFinanciamento", "frotaDocumento", "frotaConsulta", "cadCentroCusto", "cadVeiculo", "frotaApolice"] as const) {
      await (prisma[t] as unknown as { deleteMany: (a: object) => Promise<unknown> }).deleteMany({ where: { companyId: EMP } });
    }
  };
  await limpar();
  try {
    console.log("\n5. A migração gravada");
    const leitura = lerPlanilhas(planilhas());
    const a = await gravarFrota(EMP, "teste", leitura);
    const b = await gravarContratos(EMP, "teste", leitura, leitura.dataReferencia!);
    conferir("primeira vez: tudo novo", [a.novos, b.novos], [4, 5]);
    const conta = async (m: "frotaDocumento" | "frotaConsulta" | "frotaApolice" | "frotaFinanciamentoVeiculo" | "cadCentroCusto" | "cadVeiculo") =>
      (prisma[m] as unknown as { count: (a: object) => Promise<number> }).count({ where: { companyId: EMP } });
    conferir("documentos, consultas, apólices, vínculos e centros de custo", [await conta("frotaDocumento"), await conta("frotaConsulta"), await conta("frotaApolice"), await conta("frotaFinanciamentoVeiculo"), await conta("cadCentroCusto")], [20, 2, 2, 4, 3]);
    const a2 = await gravarFrota(EMP, "teste", leitura);
    const b2 = await gravarContratos(EMP, "teste", leitura, leitura.dataReferencia!);
    conferir("segunda vez: nada novo, nada duplicado", [a2.novos, a2.atualizados, b2.novos, b2.atualizados, await conta("cadVeiculo")], [0, 0, 0, 0, 4]);
    const apolice = await prisma.frotaApolice.findFirst({ where: { companyId: EMP, descricao: "ESCOLAR - 1002806001248" } });
    conferir("apólice com segmento e número", [apolice?.segmento, apolice?.numero], ["escolar", "1002806001248"]);
    const trilha = await prisma.audLog.count({ where: { companyId: EMP, agente: "migracao-planilhas", tabela: "CadVeiculo", operacao: "insert" } });
    conferir("cada veículo criado está na trilha", trilha, 4);
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
