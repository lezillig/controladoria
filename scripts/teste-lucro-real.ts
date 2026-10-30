// A AUDITORIA DE LUCRO REAL — `npm run teste:lucro-real`.
//
// 1. A conta pura: o tipo de cada categoria pelo nome (o específico antes do
//    genérico), IRPJ com adicional, Presumido com o acréscimo da LC 224/2025,
//    coeficiente de turnos, depreciação no período.
// 2. Com Postgres (TESTE_DATABASE_URL): a Azul com as pessoas da MCZ — o que
//    uma paga à outra eliminado, o DAS da MCZ fora, a folha dela dentro com os
//    encargos que passam a existir —, as adições, as pendências de documento,
//    os créditos vencidos e a depreciação da frota.
export {};
import { PrismaClient } from "@prisma/client";
import { tipoDaCategoria } from "../src/lib/lucroReal/catalogo";
import { apurarLucroReal, coeficienteDeTurnos, impostosDoPresumido, impostosDoReal } from "../src/lib/lucroReal/apuracao";
import { tjlpDaSerie } from "../src/lib/lucroReal/tjlp";

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "  ok  " : "FALHA "} ${nome}${ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         veio     ${JSON.stringify(real)}`}`);
}

function pura() {
  console.log("\nTipo de cada categoria");
  const tipo = (d: string, linha: string | null = null) => tipoDaCategoria(d, linha).codigo;
  conferir("multa de trânsito antes de multa genérica", [tipo("Multas de trânsito"), tipo("Multa por infração - DER"), tipo("Juros e multa por atraso")], [
    "MULTA_TRANSITO",
    "MULTA_TRANSITO",
    "MORA_ENCARGOS",
  ]);
  conferir("juros de financiamento é juro; parcela é principal", [tipo("Juros de financiamento"), tipo("Financiamento de veículos"), tipo("Consórcio")], [
    "JUROS_TARIFAS",
    "FINANCIAMENTO",
    "FINANCIAMENTO",
  ]);
  conferir("pró-labore na linha de sócios é dedutível; o resto da linha, não", [tipo("Pró-labore", "DESPESA_SOCIOS"), tipo("Despesas dos sócios"), tipo("Cartão do diretor", "DESPESA_SOCIOS")], [
    "PRO_LABORE",
    "DESPESAS_SOCIOS",
    "DESPESAS_SOCIOS",
  ]);
  conferir("distribuição não é despesa de sócio", tipo("Distribuição de lucros aos sócios"), "DISTRIBUICAO");
  conferir("seguro de vida é benefício; seguro da frota, veículo", [tipo("Seguro de vida em grupo"), tipo("Seguro frota")], ["BENEFICIOS", "VEICULO_TRIBUTOS_SEGURO"]);
  conferir("IRPJ e DAS", [tipo("IRPJ trimestral", "DEDUCOES"), tipo("DAS - Simples Nacional", "DEDUCOES")], ["IRPJ_CSLL", "TRIBUTOS"]);
  conferir("sem nome reconhecido, pela linha", [tipo("Diversos", "DESPESA_SALARIOS"), tipo("Diversos", "CUSTO_SERVICO"), tipo("SEM_CATEGORIA")], [
    "SALARIOS_ENCARGOS",
    "OUTRAS_OPERACIONAIS",
    "SEM_CATEGORIA",
  ]);

  console.log("\nImpostos");
  conferir("Real: 15% + 10% acima de R$ 240 mil + 9%", impostosDoReal(1_000_000_00), {
    baseCents: 1_000_000_00,
    irpjCents: 150_000_00,
    adicionalCents: 76_000_00,
    csllCents: 90_000_00,
    totalCents: 316_000_00,
  });
  conferir("Real: prejuízo não paga", impostosDoReal(-5_00).totalCents, 0);
  // R$ 10 milhões: 16% de tudo + 1,6% sobre os R$ 5 milhões acima do limite.
  const p = impostosDoPresumido(10_000_000_00, 100_000_00);
  conferir("Presumido com o acréscimo da LC 224/2025", [p.baseCents, p.baseCsllCents], [1_600_000_00 + 80_000_00 + 100_000_00, 1_200_000_00 + 60_000_00 + 100_000_00]);
  conferir("turnos", [coeficienteDeTurnos(7.5), coeficienteDeTurnos(8.5), coeficienteDeTurnos(16), coeficienteDeTurnos(17)], [1, 1.5, 1.5, 2]);

  console.log("\nTJLP do Banco Central");
  const periodo = { inicio: new Date(2025, 9, 1), fim: new Date(2026, 8, 30, 23, 59, 59), rotulo: "" };
  const serie = [
    { data: "01/09/2025", valor: "8.00" },
    ...["10", "11", "12"].map((m) => ({ data: `01/${m}/2025`, valor: "9.00" })),
    ...["01", "02", "03", "04", "05", "06", "07", "08", "09"].map((m) => ({ data: `01/${m}/2026`, valor: "10.00" })),
    { data: "01/10/2026", valor: "9.29" },
    { data: "01/11/2026", valor: "9.29" },
  ];
  const tj = tjlpDaSerie(serie, periodo, new Date(2026, 9, 30));
  conferir("média dos doze meses e a de hoje", [tj?.meses, Math.round((tj?.mediaAa ?? 0) * 1e6), tj?.atualAa], [12, Math.round(((3 * 0.09 + 9 * 0.1) / 12) * 1e6), 0.0929]);
  conferir("sem meses no período, nada", tjlpDaSerie([{ data: "01/01/2020", valor: "5" }], periodo, new Date(2026, 9, 30)), null);

  console.log("\nApuração com insumos montados à mão");
  const r = apurarLucroReal({
    empresa: "AZ",
    corporativa: "MC",
    itens: [
      { chave: "R", descricao: "Clientes - Serviços Prestados", linha: "RECEITA_BRUTA", valorCents: 1_000_00, ehReceita: true, origem: "EMPRESA" },
      { chave: "B", descricao: "Brindes de fim de ano", linha: "DESPESA_COMERCIAL", valorCents: 10_00, ehReceita: false, origem: "EMPRESA" },
      { chave: "D", descricao: "Doações", linha: "DESPESA_GERAL", valorCents: 50_00, ehReceita: false, origem: "EMPRESA" },
      { chave: "P", descricao: "Parcela consórcio", linha: "FINANCIAMENTO_INVESTIMENTO", valorCents: 70_00, ehReceita: false, origem: "EMPRESA" },
    ],
    corporativaForaCents: 0,
    intercompanyEliminado: { receitaCents: 0, despesaCents: 0 },
    documentacao: [],
    titulosComPendencia: [],
    extratoSemCausa: { cents: 0, quantidade: 0, maiores: [] },
    recebiveisVencidos: { ate15mil: { cents: 0, quantidade: 0 }, de15a100mil: { cents: 0, quantidade: 0 }, acima100mil: { cents: 0, quantidade: 0 } },
    frota: null,
    horas: null,
    jcp: { plCents: 1_000_00, tjlp: 0.1 },
  });
  // Gerencial 940; parcela abaixo do LAIR fica fora; brinde volta; doação
  // acima de 2% de (940 + 50) = 19,80 volta: 30,20.
  conferir("gerencial, contábil e real", [r.lucroGerencialCents, r.lucroContabilCents, r.lucroRealCents], [940_00, 940_00, 940_00 + 10_00 + 30_20]);
  conferir("adições", r.adicoes.map((a) => [a.codigo, a.cents]), [["BRINDES", 10_00], ["DOACOES", 30_20]]);
  const jcp = r.oportunidades.find((o) => o.codigo === "JCP");
  conferir("JCP: PL × TJLP dentro do limite, a 24% (sem adicional)", jcp?.economiaCents, 24_00);
  conferir("parcelas para separar os juros", r.oportunidades.some((o) => o.codigo === "JUROS_PARCELAS"), true);
}

async function banco() {
  const url = process.env.TESTE_DATABASE_URL;
  if (!url) {
    console.log("\nTESTE_DATABASE_URL não definida — pulando a colheita no banco.");
    return;
  }
  console.log("\nNo banco");
  process.env.DATABASE_URL = url;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const { fixarHojeParaTeste } = await import("../src/lib/controladoria/competencia");
  fixarHojeParaTeste(new Date(2027, 0, 1));
  const { insumosDoLucroReal, dozeMesesFechados, depreciacaoNoPeriodo } = await import("../src/lib/lucroReal/noBanco");
  const E = "empresa-lucro-real";
  const sql = (q: string) => prisma.$executeRawUnsafe(q);
  // As tabelas da gestão que a frota lê, no esquema público (a gestão no mesmo
  // banco). Como no teste de financiamentos: só se o banco não as tem — com as
  // mesmas colunas de lá — e então são apagadas no fim; as colunas que só
  // este teste usa entram por ALTER.
  const existe = async (t: string) =>
    (await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${t}'`))[0].n > 0;
  const criadas: string[] = [];
  for (const [t, ddl] of [
    ["Vehicle", `CREATE TABLE public."Vehicle" (id text PRIMARY KEY, "companyId" text, plate text, status text, "currentMileage" int, model text, type text, year int)`],
    ["VehicleTrip", `CREATE TABLE public."VehicleTrip" (id text PRIMARY KEY, "companyId" text, "vehicleId" text, "startAt" timestamp, "distanceKm" float8)`],
  ] as const) {
    if (!(await existe(t))) {
      await sql(ddl);
      criadas.push(t);
    }
  }
  for (const col of [`"dataCompra" timestamp`, `"valorCompraCents" int`, `"dataVenda" timestamp`, `"vidaUtilMeses" int`, `"valorResidualCents" int`])
    await sql(`ALTER TABLE public."Vehicle" ADD COLUMN IF NOT EXISTS ${col}`);
  await sql(`ALTER TABLE public."VehicleTrip" ADD COLUMN IF NOT EXISTS "endAt" timestamp`);
  const limpar = async () => {
    await sql(`DELETE FROM public."VehicleTrip" WHERE "companyId" = '${E}'`);
    await sql(`DELETE FROM public."Vehicle" WHERE "companyId" = '${E}'`);
    await prisma.omieMovimento.deleteMany({ where: { companyId: E } });
    await prisma.omieTitulo.deleteMany({ where: { companyId: E } });
    await prisma.omieCategoria.deleteMany({ where: { companyId: E } });
    await prisma.dreClassificacao.deleteMany({ where: { companyId: E } });
    await prisma.balancoPatrimonial.deleteMany({ where: { companyId: E } });
    await prisma.omieConexao.deleteMany({ where: { companyId: E } });
  };
  await limpar();
  try {
    const az = await prisma.omieConexao.create({ data: { companyId: E, nome: "Azul", apelido: "AZ", credencialRef: "AZ", cnpj: "11111111000191" } });
    const mc = await prisma.omieConexao.create({ data: { companyId: E, nome: "MCZ", apelido: "MC", credencialRef: "MC", cnpj: "22222222000191", papelNoGrupo: "CORPORATIVO" } });
    const cats: [typeof az, string, string, string][] = [
      [az, "R1", "Clientes - Serviços Prestados", "RECEITA_BRUTA"],
      [az, "C1", "Combustível", "CUSTO_SERVICO"],
      [az, "M1", "Multas de trânsito", "DESPESA_VEICULOS"],
      [az, "S1", "Serviços de terceiros", "DESPESA_SERVICOS_TERCEIROS"],
      [az, "I1", "IRPJ", "DEDUCOES"],
      [az, "F1", "Financiamento de veículos", "FINANCIAMENTO_INVESTIMENTO"],
      [az, "X1", "Serviços da MCZ", "DESPESA_SERVICOS_TERCEIROS"],
      [mc, "RM", "Serviços prestados à Azul", "RECEITA_BRUTA"],
      [mc, "SAL", "Salários", "DESPESA_SALARIOS"],
      [mc, "DAS", "DAS - Simples Nacional", "DEDUCOES"],
      [mc, "VT", "Vale transporte", "DESPESA_ADMINISTRATIVA"],
    ];
    await prisma.omieCategoria.createMany({
      data: cats.map(([cx, codigo, descricao]) => ({ companyId: E, conexaoId: cx.id, conexaoApelido: cx.apelido, codigo, descricao })),
    });
    await prisma.dreClassificacao.createMany({ data: cats.map(([, codigo, , linha]) => ({ companyId: E, categoriaCodigo: codigo, linha, origem: "CONFIRMADA" as const })) });

    let n = 0;
    const jan = (dia: number) => new Date(2026, 0, dia);
    const t = (cx: typeof az, natureza: "PAGAR" | "RECEBER", categoriaCodigo: string, valorDocumentoCents: number, x: Record<string, unknown> = {}) => ({
      companyId: E,
      conexaoId: cx.id,
      conexaoApelido: cx.apelido,
      codigoLancamento: `L${++n}`,
      natureza,
      status: "PAGO",
      categoriaCodigo,
      valorDocumentoCents,
      dataEmissao: jan(5),
      dataVencimento: jan(20),
      liquidado: true,
      ...x,
    });
    await prisma.omieTitulo.createMany({
      data: [
        t(az, "RECEBER", "R1", 1_000_000_00, { parceiroDocumento: "33333333000100", numeroDocumento: "NF 1" }),
        t(az, "PAGAR", "C1", 100_000_00, { parceiroNome: "Posto A", parceiroDocumento: "44444444000100", numeroDocumento: "NF 10" }),
        t(az, "PAGAR", "C1", 20_000_00, { parceiroNome: "Posto B", parceiroDocumento: "45454545000100" }),
        t(az, "PAGAR", "M1", 5_000_00, { parceiroDocumento: "46464646000100", numeroDocumento: "AIT 1" }),
        t(az, "PAGAR", "S1", 8_000_00, { parceiroNome: "Prestador PF", parceiroDocumento: "12345678901", numeroDocumento: "RPA 1" }),
        t(az, "PAGAR", "S1", 3_000_00, { parceiroNome: "Sem documento", numeroDocumento: "R 2" }),
        t(az, "PAGAR", "I1", 30_000_00),
        t(az, "PAGAR", "F1", 50_000_00, { parceiroDocumento: "60746948000112", numeroDocumento: "P1" }),
        // O que a Azul paga à MCZ e a MCZ recebe da Azul: some no grupo.
        t(az, "PAGAR", "X1", 200_000_00, { parceiroDocumento: "22222222000191", numeroDocumento: "NF MCZ" }),
        t(mc, "RECEBER", "RM", 200_000_00, { parceiroDocumento: "11111111000191" }),
        t(mc, "PAGAR", "SAL", 150_000_00),
        t(mc, "PAGAR", "DAS", 5_000_00),
        t(mc, "PAGAR", "VT", 10_000_00, { parceiroDocumento: "55555555000100", numeroDocumento: "NF VT" }),
        // A receber antigos e abertos: nas faixas da Lei 9.430.
        t(az, "RECEBER", "R1", 10_000_00, { liquidado: false, status: "ATRASADO", saldoCents: 10_000_00, dataEmissao: new Date(2025, 0, 2), dataVencimento: new Date(2025, 0, 10) }),
        t(az, "RECEBER", "R1", 50_000_00, { liquidado: false, status: "ATRASADO", saldoCents: 50_000_00, dataEmissao: new Date(2025, 5, 1), dataVencimento: new Date(2025, 5, 1) }),
      ],
    });
    const mov = (conta: string, valorCents: number, x: Record<string, unknown> = {}) => ({
      companyId: E,
      conexaoId: az.id,
      conexaoApelido: "AZ",
      contaCorrenteCodigo: conta,
      codigoLancamento: `M${++n}`,
      data: jan(15),
      valorCents,
      ...x,
    });
    await prisma.omieMovimento.createMany({
      data: [
        mov("1", -7_000_00, { parceiroNome: "PIX sem nome" }),
        mov("1", -1_000_00),
        mov("2", 1_000_00),
        mov("1", -50_00, { tipo: "Tarifa bancária" }),
      ],
    });
    await sql(`INSERT INTO public."Vehicle" (id, "companyId", plate, status, "dataCompra", "valorCompraCents") VALUES ('lr-v1', '${E}', 'AAA1A11', 'ATIVO', '2024-06-01', 30000000), ('lr-v2', '${E}', 'BBB2B22', 'ATIVO', NULL, NULL)`);
    for (let dia = 1; dia <= 10; dia++) {
      const d = `2026-10-${String(dia).padStart(2, "0")}`;
      await sql(`INSERT INTO public."VehicleTrip" (id, "companyId", "vehicleId", "startAt", "endAt") VALUES ('lr-a${dia}', '${E}', 'lr-v1', '${d} 06:00', '${d} 09:00'), ('lr-b${dia}', '${E}', 'lr-v1', '${d} 17:00', '${d} 20:00')`);
    }

    const hoje = new Date(2026, 9, 30);
    const periodo = dozeMesesFechados(hoje);
    conferir("doze meses fechados", [periodo.inicio.getMonth(), periodo.inicio.getFullYear(), periodo.fim.getMonth(), periodo.fim.getDate()], [9, 2025, 8, 30]);
    conferir("depreciação: o ano inteiro a 20%; nada depois da vida útil", [depreciacaoNoPeriodo(30_000_000, new Date(2024, 5, 1), 0.2, periodo), depreciacaoNoPeriodo(30_000_000, new Date(2018, 0, 1), 0.2, periodo)], [6_000_000, 0]);

    // O balanço do grupo e o da Azul lançados em Indicadores: vale o da Azul.
    const balanco = (escopo: string, pl: number) => ({
      companyId: E, escopo, dataBase: new Date(Date.UTC(2025, 11, 31)), caixa: 0, contasReceber: 0, ativoCirculante: 0, imobilizadoLiquido: 0,
      ativoTotal: 0, fornecedores: 0, passivoCirculante: 0, dividaCurtoPrazo: 0, dividaLongoPrazo: 0, patrimonioLiquido: pl,
    });
    await prisma.balancoPatrimonial.createMany({ data: [balanco("GRUPO", 9_000_000), balanco(az.id, 2_000_000.5)] });
    // A TJLP digitada: o teste não depende da internet.
    const ins = await insumosDoLucroReal({ companyId: E, empresa: { id: az.id, apelido: "AZ" }, corporativa: { id: mc.id, apelido: "MC" }, periodo, hoje, jcpManual: { plCents: null, tjlp: 0.0929 } });
    conferir("JCP: PL do balanço da Azul e a TJLP digitada", [ins.jcp.plCents, ins.jcp.tjlp, ins.jcp.fontePl, ins.jcp.fonteTjlp], [
      200_000_050,
      0.0929,
      "PL do balanço de 31/12/2025 lançado em Indicadores",
      "TJLP digitada na tela",
    ]);
    const porChave = (origem: string) =>
      Object.fromEntries(ins.itens.filter((i) => i.origem === origem).map((i) => [i.chave, i.valorCents]).sort(([a], [b]) => String(a).localeCompare(String(b))));
    conferir("da Azul: tudo menos o pago à MCZ", porChave("EMPRESA"), { C1: 120_000_00, F1: 50_000_00, I1: 30_000_00, M1: 5_000_00, R1: 1_000_000_00, S1: 11_000_00 });
    conferir("da MCZ: só pessoas", porChave("PESSOAS_CORPORATIVA"), { SAL: 150_000_00, VT: 10_000_00 });
    conferir("o DAS da MCZ fica fora", ins.corporativaForaCents, 5_000_00);
    conferir("eliminado entre as empresas", ins.intercompanyEliminado, { receitaCents: 200_000_00, despesaCents: 200_000_00 });
    conferir("créditos vencidos nas faixas", ins.recebiveisVencidos, {
      ate15mil: { cents: 10_000_00, quantidade: 1 },
      de15a100mil: { cents: 50_000_00, quantidade: 1 },
      acima100mil: { cents: 0, quantidade: 0 },
    });
    conferir("frota", ins.frota && { ...ins.frota, detalhe: undefined, placasSemValor: undefined }, {
      veiculos: 1,
      semValor: 1,
      custoCents: 300_000_00,
      depreciacao20Cents: 60_000_00,
      depreciacao25Cents: 75_000_00,
    });
    conferir("frota veículo a veículo, e o que falta", [ins.frota?.detalhe?.map((v) => [v.placa, v.depreciacaoCents]), ins.frota?.placasSemValor], [[["AAA1A11", 60_000_00]], ["BBB2B22"]]);
    conferir("horas da Ituran", [ins.horas?.medianaEmViagem, ins.horas?.medianaJanela, ins.horas?.veiculoDias], [6, 14, 10]);
    conferir("saída sem causa (sem a transferência e a tarifa)", [ins.extratoSemCausa.cents, ins.extratoSemCausa.quantidade], [7_000_00, 1]);

    const r = apurarLucroReal(ins);
    // Gerencial: 1.000.000 − 120.000 − 5.000 − 11.000 − 30.000 − 150.000 − 10.000.
    conferir("resultado gerencial", r.lucroGerencialCents, 674_000_00);
    conferir("do gerencial ao contábil", r.ajustesDaBase.map((a) => [a.codigo, a.cents]), [
      ["IRPJ_CSLL", 30_000_00],
      ["DEPRECIACAO", -60_000_00],
      ["ENCARGOS_TRANSFERENCIA", -42_300_00],
    ]);
    conferir("adição da multa de trânsito", r.adicoes.map((a) => [a.codigo, a.cents]), [["MULTA_TRANSITO", 5_000_00]]);
    // O drill-down: o resultado aberto por linha do DRE, e cada ajuste nas
    // categorias até os títulos.
    conferir(
      "resultado gerencial por linha soma o todo",
      r.composicaoGerencial.reduce((a, l) => a + l.cents, 0),
      r.lucroGerencialCents
    );
    conferir("a receita abre nos títulos", r.composicaoGerencial[0]?.categorias[0]?.titulos.map((t) => t.valorCents), [1_000_000_00]);
    const encargos = r.ajustesDaBase.find((a) => a.codigo === "ENCARGOS_TRANSFERENCIA");
    conferir("encargos abrem na base salarial da MCZ, com os títulos dela", [encargos?.categorias?.map((c) => [c.descricao, c.cents, c.origem]), encargos?.categorias?.[0]?.titulos.length], [
      [["Salários", 150_000_00, "PESSOAS_CORPORATIVA"]],
      1,
    ]);
    conferir("a adição abre na categoria", r.adicoes[0]?.categorias?.map((c) => c.descricao), ["Multas de trânsito"]);
    conferir("lucro real e imposto", [r.lucroRealCents, r.real.totalCents], [606_700_00, 91_005_00 + 36_670_00 + 54_603_00]);
    conferir("presumido: R$ 1 milhão, sem acréscimo", [r.presumido.totalCents, r.presumido.disponivel], [24_000_00 + 10_800_00, true]);
    conferir(
      "pendências de documento",
      r.pendencias.map((p) => [p.codigo, p.cents, p.quantidade, p.maiores[0]?.parceiro ?? null]),
      [
        ["SEM_NOTA", 20_000_00, 1, "Posto B"],
        ["SEM_BENEFICIARIO", 3_000_00, 1, "Sem documento"],
        ["PF_SEM_RETENCAO", 8_000_00, 1, "Prestador PF"],
        ["EXTRATO_SEM_CAUSA", 7_000_00, 1, null],
      ]
    );
    conferir("cobertura de nota", r.coberturaDocumental, { comNotaCents: 100_000_00, exigeNotaCents: 120_000_00 });
    const op = Object.fromEntries(r.oportunidades.map((o) => [o.codigo, o.economiaCents]));
    conferir("oportunidades com valor", [op.PERDAS_CREDITO, op.TAXA_25, op.DOCUMENTACAO, op.TRANSFERENCIA, op.DEPRECIACAO_TURNOS], [
      20_400_00,
      5_100_00,
      12_920_00,
      -27_918_00,
      0,
    ]);
    conferir("veículo sem valor de compra apontado", "FROTA_SEM_VALOR" in op, true);
    // PL R$ 2.000.000,50 × 9,29% = R$ 185.800,05, abaixo de 50% do lucro; a 34%.
    conferir("JCP com o balanço", op.JCP, Math.round(Math.round(200_000_050 * 0.0929) * 0.34));

    const { jcpDoPeriodo } = await import("../src/lib/lucroReal/noBanco");
    const doGrupo = jcpDoPeriodo({ plCents: null, tjlp: null }, { escopo: "GRUPO", dataBase: new Date(Date.UTC(2025, 11, 31)), patrimonioLiquido: "9000000" }, "AZ", { mediaAa: 0.0915, atualAa: 0.0929, meses: 12 });
    conferir("sem o balanço da empresa, o do grupo — e a tela diz", [doGrupo.plCents, doGrupo.tjlp, doGrupo.fontePl, doGrupo.fonteTjlp], [
      900_000_000,
      0.0915,
      "PL do balanço de 31/12/2025 lançado em Indicadores — o do grupo, falta o da AZ",
      "TJLP média dos 12 meses, Banco Central (a mesma do BNDES); hoje em 9,29% a.a.",
    ]);
  } finally {
    await limpar();
    for (const t of criadas) await sql(`DROP TABLE public."${t}"`);
    await prisma.$disconnect();
  }
}

(async () => {
  pura();
  await banco();
  console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
})();
