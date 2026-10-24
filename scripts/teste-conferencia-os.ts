// A CONFERÊNCIA DE OS — `npm run teste:conferencia-os`.
//
// 1. A conta pura: custo sem cobrança, custo acima da cobrança, a mesma OS em
//    projetos diferentes, o mesmo projeto nas duas empresas, cobertura.
// 2. A fase `projetos` da sincronização: o plano das etapas e a leitura do
//    item da listagem das contas a pagar.
// 3. Com Postgres (TESTE_DATABASE_URL): a colheita no banco.
import { PrismaClient } from "@prisma/client";
import { chaveDoProjeto, conferirOs, type GrupoOs } from "../src/lib/controladoria/conferenciaDeOs";
import { planejarEtapasProjetos, projetoDoItem } from "../src/lib/omie/sync";

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "  ok  " : "FALHA "} ${nome}${ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         veio     ${JSON.stringify(real)}`}`);
}

function pura() {
  console.log("\nConta");
  const d = new Date(2026, 8, 10);
  const g = (x: Partial<GrupoOs>): GrupoOs => ({ conexaoId: "AZ", natureza: "PAGAR", projeto: null, os: null, titulos: 1, cents: 0, ultimaCompetencia: d, parceiros: [], ...x });
  const grupos = [
    g({ projeto: "P1", cents: 300_00, parceiros: ["TRANSCOMIN"], os: "100" }),
    g({ natureza: "RECEBER", projeto: "P1", cents: 500_00, parceiros: ["SMPED"], os: "100" }),
    // Custo sem cobrança.
    g({ projeto: "P2", cents: 700_00, parceiros: ["TRANSCOMIN"] }),
    // Custo acima da cobrança.
    g({ projeto: "P3", cents: 900_00, parceiros: ["TRANSCOMIN"] }),
    g({ natureza: "RECEBER", projeto: "P3", cents: 400_00, parceiros: ["FEMSA"], categoria: "Clientes - Serviços Prestados" }),
    // Mesmo projeto pelo nome nas duas empresas: custo na MCZ, cobrança na Azul.
    g({ conexaoId: "MC", projeto: "Q9", cents: 200_00, parceiros: ["OFICINA"], categoria: "Compra de Serviços" }),
    g({ natureza: "RECEBER", projeto: "P4", cents: 250_00 }),
    // A mesma OS 555 no projeto P1 (a pagar) e P2 (a receber): lançamento trocado.
    g({ projeto: "P1", cents: 10_00, os: "555" }),
    g({ natureza: "RECEBER", projeto: "P2b", cents: 10_00, os: "555" }),
    // Sem projeto.
    g({ cents: 1000_00, titulos: 4 }),
    g({ natureza: "RECEBER", cents: 50_00 }),
  ];
  const nomes = new Map([
    ["AZ|P1", "14638"],
    ["AZ|P2", "14641"],
    ["AZ|P2b", "14700"],
    ["AZ|P3", "14650"],
    ["AZ|P4", "15077"],
    ["MC|Q9", " 15077 "],
  ]);
  const r = conferirOs({ grupos, pagarSemProjeto: [], nomeDoProjeto: nomes, empresa: new Map([["AZ", "AZUL"], ["MC", "MCZ"]]), taxaImpostos: new Map([["AZ", 0.1]]) });
  conferir("custo sem cobrança", r.custoSemReceita.map((p) => [p.nome, p.custoCents]), [["14641", 700_00]]);
  conferir("custo acima da cobrança", r.custoAcimaDaReceita.map((p) => [p.nome, p.margemCents]), [["14650", -500_00]]);
  const v77 = r.projetos.find((p) => p.chave === chaveDoProjeto("15077"));
  conferir("mesmo projeto nas duas empresas vira um", [v77?.empresas, v77?.custoCents, v77?.receitaCents], [["MCZ", "AZUL"], 200_00, 250_00]);
  conferir("OS em projetos diferentes", r.osEmProjetosDiferentes.map((o) => [o.os, o.projetos.map((p) => p.nome).sort()]), [["555", ["14638", "14700"]]]);
  conferir("cobrança sem custo", r.receitaSemCusto.map((p) => p.nome), ["14700"]);
  conferir("cobertura do a pagar", [r.cobertura.pagar.titulos, r.cobertura.pagar.comProjeto, r.cobertura.pagar.comOs], [9, 5, 2]);
  const os1 = r.projetos.find((p) => p.nome === "14638")!;
  conferir("resultado = receita − tributos − custo", [os1.impostosCents, os1.resultadoCents], [50_00, 500_00 - 50_00 - 310_00]);
  conferir("faturada com prejuízo", r.comPrejuizo.map((p) => [p.nome, p.resultadoCents]), [["14650", 400_00 - 40_00 - 900_00]]);
  // Fora do padrão: 4 OS do mesmo cliente com ~50% e uma com -20%.
  const padrao = ["9001", "9002", "9003", "9004", "9005"].map((x, i) => [
    g({ projeto: x, cents: i === 4 ? 120_00 : 50_00 }),
    g({ natureza: "RECEBER", projeto: x, cents: 100_00, parceiros: ["CLIENTE Z"] }),
  ]).flat();
  const fp = conferirOs({ grupos: padrao, pagarSemProjeto: [], nomeDoProjeto: new Map(), empresa: new Map() });
  conferir("resultado fora do padrão do cliente", fp.foraDoPadrao.map((f) => [f.projeto.nome, f.medianaPercent]), [["9005", 50]]);
  // A regra do que é OS: só números, ou compra/receita de serviços; multa e
  // diretoria fora.
  const regra = conferirOs({
    grupos: [
      g({ projeto: "D1", cents: 900_00, categoria: "Despesas da Diretoria" }),
      g({ projeto: "M1", cents: 300_00, categoria: "Multas de Trânsito" }),
      g({ projeto: "N1", cents: 500_00, categoria: "Combustível" }),
      g({ projeto: "N1", cents: 80_00, categoria: "Multas de Trânsito" }),
      g({ projeto: "S1", cents: 100_00, categoria: "Compra de Serviços" }),
      g({ projeto: "E1", cents: 40_00, categoria: "Aluguel de imóveis" }),
      g({ projeto: "L1", cents: 60_00, categoria: "Estacionamento" }),
    ],
    pagarSemProjeto: [],
    nomeDoProjeto: new Map([["AZ|D1", "DIRETORIA"], ["AZ|M1", "MULTAS"], ["AZ|N1", "15001"], ["AZ|S1", "SMPED"], ["AZ|E1", "ESCRITORIO"], ["AZ|L1", "5935413299"]]),
    empresa: new Map([["AZ", "AZUL"]]),
  });
  conferir("só nome numérico entra como OS (SMPED com compra de serviços fica fora)", regra.projetos.map((p) => p.nome).sort(), ["15001"]);
  conferir("multa sai da OS numérica", regra.projetos.find((p) => p.nome === "15001")?.custoCents, 500_00);
  conferir("fora da conferência: o projeto de texto sem serviço", regra.foraDaConferencia.map((f) => f.nome).sort(), ["5935413299", "ESCRITORIO", "SMPED"]);
  conferir("multas e diretoria listadas", regra.lancamentosExcluidos.map((e) => [e.projeto, e.cents]).sort(), [["15001", 80_00], ["DIRETORIA", 900_00], ["MULTAS", 300_00]].sort());
  conferir("OS do projeto", r.projetos.find((p) => p.nome === "14638")?.osDoPagar, ["100", "555"]);
}

function fase() {
  console.log("\nFase projetos da sincronização");
  const e = planejarEtapasProjetos({ janelaInicio: new Date(2026, 9, 1), janelaFim: new Date(2026, 9, 24), backfill: false, mesesPendentes: [new Date(2025, 0, 1), new Date(2025, 1, 1)] });
  conferir("diário: recentes e os meses pendentes", e.map((x) => x.chave), ["recentes", "mes:2025-01", "mes:2025-02"]);
  conferir("recentes: alterados nos últimos 10 dias", e[0].param, { filtrar_por_data_de: "14/10/2026", filtrar_por_data_ate: "24/10/2026" });
  conferir("mês por emissão", e[2].param, { filtrar_por_emissao_de: "01/02/2025", filtrar_por_emissao_ate: "28/02/2025" });
  const b = planejarEtapasProjetos({ janelaInicio: new Date(2025, 4, 1), janelaFim: new Date(2025, 4, 31), backfill: true, mesesPendentes: [] });
  conferir("carga histórica: a janela", [b.length, b[0].param], [1, { filtrar_por_emissao_de: "01/05/2025", filtrar_por_emissao_ate: "31/05/2025" }]);
  conferir("item com projeto", projetoDoItem({ codigo_lancamento_omie: 123456, codigo_projeto: 789 }), { codigo: "123456", projeto: "789" });
  conferir("projeto 0 é sem projeto", projetoDoItem({ codigo_lancamento_omie: "1", codigo_projeto: 0 }), { codigo: "1", projeto: null });
  conferir("sem código", projetoDoItem({ codigo_projeto: 5 }).codigo, null);
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
  const { comissoesNoBanco, conferenciaDeOsNoBanco, titulosDaConferencia } = await import("../src/lib/controladoria/conferenciaDeOsNoBanco");
  const E = "empresa-conferencia-os";
  const limpar = async () => {
    await prisma.omieTitulo.deleteMany({ where: { companyId: E } });
    await prisma.omieProjeto.deleteMany({ where: { companyId: E } });
    await prisma.omieCategoria.deleteMany({ where: { companyId: E } });
    await prisma.omieConexao.deleteMany({ where: { companyId: E } });
  };
  await limpar();
  try {
    const az = await prisma.omieConexao.create({ data: { companyId: E, nome: "Azul OS", apelido: "AZ", credencialRef: "AZ", cnpj: "55555555000191" } });
    await prisma.omieCategoria.createMany({
      data: [
        { companyId: E, conexaoId: az.id, conexaoApelido: "AZ", codigo: "R1", descricao: "Clientes - Serviços Prestados", contaReceita: true },
        { companyId: E, conexaoId: az.id, conexaoApelido: "AZ", codigo: "T1", descricao: "Compra de Serviços", contaDespesa: true },
        { companyId: E, conexaoId: az.id, conexaoApelido: "AZ", codigo: "M1", descricao: "Multa de Trânsito", contaDespesa: true },
        { companyId: E, conexaoId: az.id, conexaoApelido: "AZ", codigo: "C1", descricao: "Comissões sobre Vendas", contaDespesa: true },
      ],
    });
    await prisma.omieProjeto.createMany({ data: [{ companyId: E, conexaoId: az.id, conexaoApelido: "AZ", codigo: "901", nome: "14638" }, { companyId: E, conexaoId: az.id, conexaoApelido: "AZ", codigo: "902", nome: "14641" }, { companyId: E, conexaoId: az.id, conexaoApelido: "AZ", codigo: "903", nome: "SMPED" }] });
    let n = 0;
    const t = (x: { natureza: "PAGAR" | "RECEBER"; categoriaCodigo: string; valorDocumentoCents: number } & Record<string, unknown>) => ({
      companyId: E, conexaoId: az.id, conexaoApelido: "AZ", codigoLancamento: `L${++n}`, status: "ABERTO",
      dataEmissao: new Date(2026, 8, 5), dataVencimento: new Date(2026, 8, 25), ...x,
    });
    await prisma.omieTitulo.createMany({
      data: [
        t({ natureza: "PAGAR", categoriaCodigo: "T1", projetoCodigo: "901", parceiroNome: "TRANSCOMIN", valorDocumentoCents: 300_00, projetoConferidoEm: new Date() }),
        t({ natureza: "RECEBER", categoriaCodigo: "R1", projetoCodigo: "901", ordemServicoNumero: "11972", parceiroNome: "SMPED", valorDocumentoCents: 500_00 }),
        t({ natureza: "PAGAR", categoriaCodigo: "T1", projetoCodigo: "902", parceiroNome: "TRANSCOMIN", valorDocumentoCents: 700_00, projetoConferidoEm: new Date() }),
        t({ natureza: "PAGAR", categoriaCodigo: "T1", parceiroNome: "TRANSCOMIN", valorDocumentoCents: 120_00 }),
        t({ natureza: "PAGAR", categoriaCodigo: "T1", projetoCodigo: "902", parceiroNome: "TRANSCOMIN", valorDocumentoCents: 999_00, cancelado: true }),
        // O mesmo documento pago duas vezes, em projetos diferentes.
        t({ natureza: "PAGAR", categoriaCodigo: "T1", projetoCodigo: "901", parceiroNome: "TRANSCOMIN", parceiroDocumento: "12345678000199", numeroDocumento: "18953", numeroParcela: "001/001", valorDocumentoCents: 80_00 }),
        t({ natureza: "PAGAR", categoriaCodigo: "T1", projetoCodigo: "902", parceiroNome: "TRANSCOMIN", parceiroDocumento: "12345678000199", numeroDocumento: "18953", numeroParcela: "001/001", valorDocumentoCents: 80_00 }),
        // Comissões: uma na OS 14638 (receita 500), uma sem OS.
        t({ natureza: "PAGAR", categoriaCodigo: "C1", projetoCodigo: "901", parceiroNome: "VENDEDOR A", valorDocumentoCents: 25_00, valorPagoCents: 25_00 }),
        t({ natureza: "PAGAR", categoriaCodigo: "C1", parceiroNome: "VENDEDOR A", valorDocumentoCents: 10_00 }),
        // Documento repetido em projeto que não é OS (SMPED): não entra.
        t({ natureza: "PAGAR", categoriaCodigo: "T1", projetoCodigo: "903", parceiroNome: "AFX", parceiroDocumento: "99999999000199", numeroDocumento: "777", valorDocumentoCents: 50_00 }),
        t({ natureza: "PAGAR", categoriaCodigo: "T1", projetoCodigo: "903", parceiroNome: "AFX", parceiroDocumento: "99999999000199", numeroDocumento: "777", valorDocumentoCents: 50_00 }),
        // Documento que é placa, repetido: não é duplicidade.
        t({ natureza: "PAGAR", categoriaCodigo: "T1", projetoCodigo: "901", parceiroNome: "SEM PARAR", numeroDocumento: "GIY-7E76", valorDocumentoCents: 15_00 }),
        t({ natureza: "PAGAR", categoriaCodigo: "T1", projetoCodigo: "902", parceiroNome: "SEM PARAR", numeroDocumento: "GIY7E76", valorDocumentoCents: 15_00 }),
        // Multa de trânsito repetida: desconsiderada (não é duplicidade de OS).
        t({ natureza: "PAGAR", categoriaCodigo: "M1", projetoCodigo: "901", parceiroNome: "DETRAN", numeroDocumento: "AIT1", valorDocumentoCents: 30_00 }),
        t({ natureza: "PAGAR", categoriaCodigo: "M1", projetoCodigo: "902", parceiroNome: "DETRAN", numeroDocumento: "AIT1", valorDocumentoCents: 30_00 }),
      ],
    });
    const r = await conferenciaDeOsNoBanco({ companyId: E, conexaoId: null, desde: new Date(2026, 8, 1), ate: new Date(2026, 8, 30) });
    conferir("custo sem cobrança no banco", r.custoSemReceita.map((p) => [p.nome, p.custoCents, p.fornecedores]), [["14641", 795_00, ["SEM PARAR", "TRANSCOMIN"]]]);
    conferir("OS do a receber", r.projetos.find((p) => p.nome === "14638")?.osDoReceber, ["11972"]);
    conferir("custo de operação sem projeto", r.pagarSemProjeto.map((s) => [s.parceiro, s.categoria, s.cents]), [["TRANSCOMIN", "Compra de Serviços", 120_00], ["VENDEDOR A", "Comissões sobre Vendas", 10_00]]);
    conferir("conferidos do a pagar", r.pagarConferidos, { total: 13, conferidos: 2 });
    conferir("multa fora do custo da OS", r.custoSemReceita.find((p) => p.nome === "14641")?.custoCents, 795_00);
    const det = await titulosDaConferencia({ companyId: E, conexaoId: null, desde: new Date(2026, 8, 1), ate: new Date(2026, 8, 30), projetoNome: "14641" });
    conferir("drill-down da OS pelo nome (mostra a multa também)", [det.total, det.titulos.map((x) => x.valorCents).sort((a, b) => a - b)], [4, [15_00, 30_00, 80_00, 700_00]]);
    const sem = await titulosDaConferencia({ companyId: E, conexaoId: null, desde: new Date(2026, 8, 1), ate: new Date(2026, 8, 30), semProjeto: "PAGAR", fornecedor: "TRANSCOMIN" });
    conferir("drill-down do a pagar sem projeto", [sem.total, sem.titulos[0]?.valorCents], [1, 120_00]);
    const com = await comissoesNoBanco({ companyId: E, conexaoId: null, desde: new Date(2026, 8, 1), ate: new Date(2026, 8, 30) });
    conferir("comissões por recebedor", com.recebedores.map((c) => [c.recebedor, c.cents, c.pagoCents, c.oss, c.receitaDasOsCents, c.semOsCents]), [["VENDEDOR A", 35_00, 25_00, 1, 500_00, 10_00]]);
    conferir("comissões por OS", com.oss.map((o) => [o.projeto, o.ehOs, o.cents, o.receitaCents]), [["14638", true, 25_00, 500_00], [null, false, 10_00, 0]]);
    const detC = await titulosDaConferencia({ companyId: E, conexaoId: null, desde: new Date(2026, 8, 1), ate: new Date(2026, 8, 30), comissoes: true, fornecedor: "VENDEDOR A" });
    conferir("drill-down das comissões", detC.total, 2);
    conferir("documento em duplicidade", r.duplicidades.map((d) => [d.documento, d.vezes, d.projetos.sort()]), [["18953", 2, ["14638", "14641"]]]);
  } finally {
    await limpar();
    await prisma.$disconnect();
  }
}

(async () => {
  pura();
  fase();
  await banco();
  console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
})();
