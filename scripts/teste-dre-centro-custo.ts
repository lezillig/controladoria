// O DRE POR CENTRO DE CUSTO — `npm run teste:dre-centro-custo`.
//
// Três partes:
//   1. a leitura da lista de empregados (planilha sintética, com CPF/RG/PIS
//      que NÃO podem ser lidos);
//   2. o motor: vínculo, folha, percentual, retenção, rateio do apoio, sinal;
//   3. com Postgres (TESTE_DATABASE_URL): a soma dos centros mais o não
//      alocado fecha com o EBIT do DRE da tela de Custos, no grupo e por
//      empresa.
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import { lerListaDeEmpregados, lerSalarioCents, porEmpresa, tipoSugerido } from "../src/lib/controladoria/quadroDePessoal";
import { montarDreCentroCusto, sugerirCentros, type GrupoDeTitulos } from "../src/lib/controladoria/dreCentroCusto";

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "  ok  " : "FALHA "} ${nome}${ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         veio     ${JSON.stringify(real)}`}`);
}

async function planilha() {
  console.log("\nLeitura da lista de empregados");
  const livro = new ExcelJS.Workbook();
  const ws = livro.addWorksheet("Empregados");
  ws.addRow(["Cód Emp", "Cód Epr", "Nome", "Cód eSocial", "Admissão", "Fim Determinado", "Fim Prorrogação", "Salário", "Categoria", "Cód Cargo", "Descrição cargo", "CBO", "Cód Função", "Descrição Função", "Cód Ccusto", "Descrição Ccusto", "Cód Serviço", "Descrição Serviço", "Cód Dpto", "Descrição Dpto", "Cód Sind", "Sindicato", "CPF", "PIS", "RG"]);
  ws.addRow(["164", "10", "Pessoa A", "x", "02/03/2020", "", "", "2500.000000", "Mensalista", "1", "MOTORISTA", "", "", "", "40", "FRETAMENTO", "1", "CLIENTE X LTDA", "1", "OPERACIONAL", "1", "SIND", "111.111.111-11", "123", "RG1"]);
  ws.addRow(["164", "11", "Pessoa B", "x", "15/01/2024", "", "", "1.874,36", "Mensalista", "2", "MONITORA", "", "", "", "40", "FRETAMENTO", "1", "CLIENTE X LTDA", "1", "OPERACIONAL", "1", "SIND", "222.222.222-22", "456", "RG2"]);
  ws.addRow(["164", "12", "Pessoa C", "x", "", "", "", 3000, "Mensalista", "3", "ANALISTA", "", "", "", "69", "RECURSOS HUMANOS", "1", "AZUL", "2", "ADMINISTRATIVO", "1", "SIND", "333.333.333-33", "789", "RG3"]);
  ws.addRow([]);
  const buf = await livro.xlsx.writeBuffer();
  const lida = await lerListaDeEmpregados(buf as ArrayBuffer);
  conferir("três pessoas lidas", lida.pessoas.length, 3);
  conferir("salário no formato da folha e no brasileiro", lida.pessoas.map((p) => p.salarioCents), [250_000, 187_436, 300_000]);
  conferir("centro de custo e serviço", [lida.pessoas[0].centroCustoCodigo, lida.pessoas[0].centroCustoDescricao, lida.pessoas[0].servico], ["40", "FRETAMENTO", "CLIENTE X LTDA"]);
  conferir("admissão dd/mm/aaaa", lida.pessoas[0].admissao?.toISOString().slice(0, 10), "2020-03-02");
  const texto = JSON.stringify(lida);
  conferir("CPF, PIS e RG não são lidos", ["111.111.111-11", "RG1", '"123"', "cpf", "pis"].some((x) => texto.toLowerCase().includes(x.toLowerCase())), false);
  conferir("por empresa", [...porEmpresa(lida.pessoas).keys()], ["164"]);
  conferir("salário numérico do Excel", lerSalarioCents(1874.36), 187_436);
  conferir("tipo sugerido: RH é apoio", tipoSugerido({ conexaoCorporativa: false, descricao: "RECURSOS HUMANOS", pessoas: [] }), "APOIO");
  conferir("tipo sugerido: contrato é operacional", tipoSugerido({ conexaoCorporativa: false, descricao: "FEMSA - OSASCO", pessoas: [{ departamento: "OPERACIONAL" }] }), "OPERACIONAL");
  conferir("tipo sugerido: empresa corporativa é apoio", tipoSugerido({ conexaoCorporativa: true, descricao: "LOGISTICO - ESCOLAR", pessoas: [] }), "APOIO");
  let erro = "";
  try {
    const outro = new ExcelJS.Workbook();
    outro.addWorksheet("x").addRow(["a", "b"]);
    await lerListaDeEmpregados((await outro.xlsx.writeBuffer()) as ArrayBuffer);
  } catch (e) {
    erro = (e as Error).message;
  }
  conferir("planilha errada explica o que falta", erro.includes("Cód Ccusto"), true);
}

function motor() {
  console.log("\nMotor");
  const g = (x: Partial<GrupoDeTitulos>): GrupoDeTitulos => ({ conexaoId: "AZ", categoria: "R1", natureza: "RECEBER", departamento: null, projeto: null, parceiro: null, parceiroNome: null, cents: 0, retencaoCents: 0, titulos: 1, ...x });
  const linhas: Record<string, string> = { R1: "RECEITA_BRUTA", D1: "DESPESA_VEICULOS", S1: "DESPESA_SALARIOS", F1: "DESPESA_FINANCEIRA" };
  const centros = [
    { id: "c1", conexaoId: "AZ", codigo: "40", descricao: "FRETAMENTO", tipo: "OPERACIONAL", empresa: "AZUL" },
    { id: "c2", conexaoId: "AZ", codigo: "31", descricao: "FEMSA - OSASCO", tipo: "OPERACIONAL", empresa: "AZUL" },
    { id: "c3", conexaoId: "AZ", codigo: "69", descricao: "RECURSOS HUMANOS", tipo: "APOIO", empresa: "AZUL" },
    { id: "m1", conexaoId: "MC", codigo: "4", descricao: "MANUTENCAO DE FROTA", tipo: "APOIO", empresa: "MCZ" },
  ];
  const quadros = [
    { conexaoId: "AZ", competencia: new Date(Date.UTC(2026, 8, 1)), porCentro: new Map([["c1", { pessoas: 3, salarioCents: 600_000 }], ["c2", { pessoas: 1, salarioCents: 300_000 }], ["c3", { pessoas: 1, salarioCents: 100_000 }]]) },
    { conexaoId: "MC", competencia: new Date(Date.UTC(2026, 8, 1)), porCentro: new Map([["m1", { pessoas: 2, salarioCents: 500_000 }]]) },
  ];
  const grupos = [
    // Receita da FEMSA pelo projeto; a do fretamento pelo cliente, com 60% — o resto fica sem centro.
    g({ projeto: "OS1", parceiro: "111", parceiroNome: "SPAL", cents: 1_000_000, retencaoCents: 20_000 }),
    g({ parceiro: "222", parceiroNome: "SEC MUNI DIREITOS HUMANOS", cents: 500_000 }),
    // Cliente sem vínculo: não alocado, com sugestão pelo nome do serviço.
    g({ parceiro: "333", parceiroNome: "CONS INTER DE SAUDE NA REGIAO METRO CAMP", cents: 200_000 }),
    // Diesel pelo departamento.
    g({ categoria: "D1", natureza: "PAGAR", departamento: "DEP7", cents: 300_000 }),
    // Estorno de diesel (valor negativo) no mesmo departamento.
    g({ categoria: "D1", natureza: "PAGAR", departamento: "DEP7", cents: -50_000 }),
    // Folha da Azul sem vínculo: pela folha (60/30/10).
    g({ categoria: "S1", natureza: "PAGAR", cents: 1_000_000 }),
    // Folha da MCZ: linha corporativa, toda na oficina.
    g({ conexaoId: "MC", categoria: "S1", natureza: "PAGAR", cents: 400_000 }),
    // Juros: abaixo do EBIT, fora dos centros.
    g({ categoria: "F1", natureza: "PAGAR", cents: 30_000 }),
    g({ categoria: "SEM_CATEGORIA", natureza: "PAGAR", cents: 9_000 }),
  ];
  const vinculos = [
    { centroCustoId: "c2", conexaoId: "AZ", tipoOrigem: "PROJETO", valorOrigem: "OS1", percentual: 100 },
    // O parceiro também ligado a outro centro: o projeto vem antes.
    { centroCustoId: "c1", conexaoId: "AZ", tipoOrigem: "PARCEIRO", valorOrigem: "111", percentual: 100 },
    { centroCustoId: "c1", conexaoId: "AZ", tipoOrigem: "PARCEIRO", valorOrigem: "222", percentual: 60 },
    // Departamento ligado a dois centros com 100%: divide pela folha (2:1).
    { centroCustoId: "c1", conexaoId: "AZ", tipoOrigem: "DEPARTAMENTO", valorOrigem: "DEP7", percentual: 100 },
    { centroCustoId: "c2", conexaoId: "AZ", tipoOrigem: "DEPARTAMENTO", valorOrigem: "DEP7", percentual: 100 },
  ];
  const base = {
    grupos,
    linhaDaCategoria: (c: string) => linhas[c] ?? "DESPESA_GERAL",
    ehReceita: (c: string) => c === "R1",
    descricaoDaCategoria: (c: string) => c,
    conexoesCorporativas: new Set(["MC"]),
    centros,
    vinculos,
    quadros,
    somarRetencoes: true,
  };
  const servicos = new Map([["c2", ["SPAL IND BRAS DE BEBIDAS SA OSASCO"]], ["c1", ["CONS INTER DE SAUDE NA REGIAO METRO CAMP"]]]);
  const r = montarDreCentroCusto({ ...base, rateio: "NENHUM" }, servicos);
  const de = (id: string) => r.centros.find((c) => c.id === id)!;
  conferir("FEMSA: receita pelo projeto, menos a retenção", [de("c2").porLinha.RECEITA_BRUTA, de("c2").porLinha.DEDUCOES], [1_000_000, -20_000]);
  conferir("fretamento: 60% da receita do cliente", de("c1").porLinha.RECEITA_BRUTA, 300_000);
  conferir("diesel líquido do estorno, 2:1 pela folha", [de("c1").porLinha.DESPESA_VEICULOS, de("c2").porLinha.DESPESA_VEICULOS], [-166_667, -83_333]);
  conferir("folha da Azul 60/30/10", [de("c1").porLinha.DESPESA_SALARIOS, de("c2").porLinha.DESPESA_SALARIOS, de("c3").porLinha.DESPESA_SALARIOS], [-600_000, -300_000, -100_000]);
  conferir("folha da MCZ na linha corporativa", de("m1").porLinha.DESPESA_SALARIOS_CORPORATIVO, -400_000);
  conferir("detalhe diz por onde veio", de("c1").detalhes.find((d) => d.linha === "DESPESA_SALARIOS")?.via, "FOLHA");
  conferir("não alocado: 40% do cliente e o cliente sem vínculo", r.naoAlocado.totalCents, 200_000 + 200_000);
  const semVinculo = r.naoAlocado.origens.find((o) => o.valor === "333");
  conferir("sugestão pelo nome do serviço do quadro", semVinculo?.sugestoes, ["c1"]);
  conferir("juros fora dos centros", r.foraDoCentro.porLinha.DESPESA_FINANCEIRA, -30_000);
  conferir("sem categoria fora", r.semCategoriaCents, 9_000);
  const ebit = 1_000_000 - 20_000 + 500_000 + 200_000 - 250_000 - 1_000_000 - 400_000;
  conferir("centros + não alocado = EBIT", [r.ebitCents, r.alocadoCents + r.naoAlocado.totalCents], [ebit, ebit]);

  const pelaReceita = montarDreCentroCusto({ ...base, rateio: "RECEITA" }, servicos);
  const c = (id: string) => pelaReceita.centros.find((x) => x.id === id)!;
  const apoio = de("c3").margemCents + de("m1").margemCents;
  conferir("apoio zerado depois do rateio", [c("c3").resultadoCents, c("m1").resultadoCents], [0, 0]);
  conferir("rateio pela receita (FEMSA 1.000.000 : fretamento 300.000)", [c("c2").rateioCents, c("c1").rateioCents], [Math.round((apoio * 10) / 13), apoio - Math.round((apoio * 10) / 13)]);
  conferir("rateio não muda o total", pelaReceita.centros.reduce((s, x) => s + x.resultadoCents, 0), r.alocadoCents);
  const pelaFolha = montarDreCentroCusto({ ...base, rateio: "FOLHA" }, servicos);
  conferir("rateio pela folha (600 : 300)", pelaFolha.centros.find((x) => x.id === "c1")!.rateioCents, Math.round((apoio * 2) / 3));

  // Sem quadro de uma empresa: a folha dela fica não alocada, com aviso.
  const semMcz = montarDreCentroCusto({ ...base, quadros: [quadros[0]], rateio: "NENHUM" });
  conferir("sem quadro: folha não alocada e aviso", [semMcz.naoAlocado.porLinha.DESPESA_SALARIOS_CORPORATIVO, semMcz.avisos.length], [-400_000, 1]);
  conferir("sugerirCentros ignora palavras vazias", sugerirCentros("SPAL IND BRAS DE BEBIDAS SA OSASCO", [{ id: "x", nomes: ["FEMSA - OSASCO", "SPAL IND BRAS DE BEBIDAS SA OSASCO"] }, { id: "y", nomes: ["BANCO DE ALIMENTOS"] }]), ["x"]);
}

async function banco() {
  const url = process.env.TESTE_DATABASE_URL;
  if (!url) {
    console.log("\nTESTE_DATABASE_URL não definida — pulando o fechamento com o DRE no banco.");
    return;
  }
  console.log("\nNo banco: fecha com o EBIT do DRE");
  process.env.DATABASE_URL = url;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const { fixarHojeParaTeste } = await import("../src/lib/controladoria/competencia");
  fixarHojeParaTeste(new Date(2027, 0, 1));
  const { montarDreNoBanco, recorteMensalDoDre } = await import("../src/lib/controladoria/dreNoBanco");
  const { dreCentroCustoNoBanco } = await import("../src/lib/controladoria/dreCentroCustoNoBanco");
  const { classificacoesDoDre } = await import("../src/lib/controladoria/projecaoNoBanco");
  const EMPRESA = "empresa-dre-centro-custo";
  const limpar = async () => {
    await prisma.centroCustoVinculo.deleteMany({ where: { companyId: EMPRESA } });
    await prisma.centroCusto.deleteMany({ where: { companyId: EMPRESA } });
    await prisma.folhaQuadro.deleteMany({ where: { companyId: EMPRESA } });
    await prisma.omieTitulo.deleteMany({ where: { companyId: EMPRESA } });
    await prisma.omieCategoria.deleteMany({ where: { companyId: EMPRESA } });
    await prisma.omieConexao.deleteMany({ where: { companyId: EMPRESA } });
    await prisma.controladoriaConfig.deleteMany({ where: { companyId: EMPRESA } });
  };
  await limpar();
  try {
    const az = await prisma.omieConexao.create({ data: { companyId: EMPRESA, nome: "Azul CC", apelido: "AZ", credencialRef: "AZ", cnpj: "33333333000191" } });
    const mc = await prisma.omieConexao.create({ data: { companyId: EMPRESA, nome: "MCZ CC", apelido: "MC", credencialRef: "MC", cnpj: "44444444000191", papelNoGrupo: "CORPORATIVO" } });
    await prisma.controladoriaConfig.create({ data: { companyId: EMPRESA, dataInicioBase: new Date(2025, 0, 1), retencoesNasDeducoes: true } });
    await prisma.omieCategoria.createMany({
      data: [
        { companyId: EMPRESA, conexaoId: az.id, conexaoApelido: "AZ", codigo: "R1", descricao: "Clientes — Serviços Prestados", contaReceita: true },
        { companyId: EMPRESA, conexaoId: az.id, conexaoApelido: "AZ", codigo: "D1", descricao: "Combustível e diesel", contaDespesa: true },
        { companyId: EMPRESA, conexaoId: az.id, conexaoApelido: "AZ", codigo: "D5", descricao: "Folha de pagamento", contaDespesa: true },
        { companyId: EMPRESA, conexaoId: mc.id, conexaoApelido: "MC", codigo: "D5", descricao: "Folha de pagamento", contaDespesa: true },
        { companyId: EMPRESA, conexaoId: az.id, conexaoApelido: "AZ", codigo: "J1", descricao: "Juros bancários", contaDespesa: true },
      ],
    });
    type Extra = { natureza: "PAGAR" | "RECEBER"; valorDocumentoCents: number; categoriaCodigo: string | null } & Record<string, unknown>;
    const t = (cx: { id: string }, apelido: string, n: number, x: Extra) => ({
      companyId: EMPRESA,
      conexaoId: cx.id,
      conexaoApelido: apelido,
      codigoLancamento: `T${n}`,
      status: "ABERTO",
      dataEmissao: new Date(2026, 8, 3 + n),
      dataVencimento: new Date(2026, 8, 20),
      ...x,
    });
    await prisma.omieTitulo.createMany({
      data: [
        t(az, "AZ", 1, { natureza: "RECEBER", categoriaCodigo: "R1", projetoCodigo: "OS1", parceiroDocumento: "55555555000191", parceiroNome: "Cliente Um", valorDocumentoCents: 1_000_100, retencaoIssCents: 20_000 }),
        t(az, "AZ", 2, { natureza: "RECEBER", categoriaCodigo: "R1", parceiroDocumento: "66666666000191", parceiroNome: "Cliente Dois", valorDocumentoCents: 400_300 }),
        t(az, "AZ", 3, { natureza: "PAGAR", categoriaCodigo: "D1", departamentoCodigo: "7", valorDocumentoCents: 250_700 }),
        t(az, "AZ", 4, { natureza: "PAGAR", categoriaCodigo: "D5", valorDocumentoCents: 600_900 }),
        t(mc, "MC", 5, { natureza: "PAGAR", categoriaCodigo: "D5", valorDocumentoCents: 300_500 }),
        t(az, "AZ", 6, { natureza: "PAGAR", categoriaCodigo: "J1", valorDocumentoCents: 10_100 }),
        t(az, "AZ", 7, { natureza: "PAGAR", categoriaCodigo: null, valorDocumentoCents: 7_700 }),
        t(az, "AZ", 8, { natureza: "PAGAR", categoriaCodigo: "D1", valorDocumentoCents: 99_900, cancelado: true }),
      ],
    });
    const c1 = await prisma.centroCusto.create({ data: { companyId: EMPRESA, conexaoId: az.id, codigo: "31", descricao: "FEMSA" } });
    const c2 = await prisma.centroCusto.create({ data: { companyId: EMPRESA, conexaoId: az.id, codigo: "40", descricao: "FRETAMENTO" } });
    const m1 = await prisma.centroCusto.create({ data: { companyId: EMPRESA, conexaoId: mc.id, codigo: "4", descricao: "OFICINA", tipo: "APOIO" } });
    await prisma.centroCustoVinculo.create({ data: { companyId: EMPRESA, centroCustoId: c1.id, conexaoId: az.id, tipoOrigem: "PROJETO", valorOrigem: "OS1" } });
    await prisma.centroCustoVinculo.create({ data: { companyId: EMPRESA, centroCustoId: c2.id, conexaoId: az.id, tipoOrigem: "DEPARTAMENTO", valorOrigem: "7" } });
    const quadro = await prisma.folhaQuadro.create({ data: { companyId: EMPRESA, conexaoId: az.id, empresaCodigo: "164", competencia: new Date(Date.UTC(2026, 8, 1)), arquivoNome: "x.xlsx", pessoas: 3, salarioCents: 900_000 } });
    await prisma.folhaPessoa.createMany({
      data: [
        { quadroId: quadro.id, matricula: "1", nome: "A", salarioCents: 300_000, centroCustoCodigo: "31", centroCustoDescricao: "FEMSA" },
        { quadroId: quadro.id, matricula: "2", nome: "B", salarioCents: 600_000, centroCustoCodigo: "40", centroCustoDescricao: "FRETAMENTO" },
      ],
    });
    // MCZ com quadro de AGOSTO: usado, com aviso.
    const qm = await prisma.folhaQuadro.create({ data: { companyId: EMPRESA, conexaoId: mc.id, empresaCodigo: "165", competencia: new Date(Date.UTC(2026, 7, 1)), arquivoNome: "y.xlsx", pessoas: 1, salarioCents: 500_000 } });
    await prisma.folhaPessoa.create({ data: { quadroId: qm.id, matricula: "9", nome: "C", salarioCents: 500_000, centroCustoCodigo: "4", centroCustoDescricao: "OFICINA" } });

    const referencia = new Date(2026, 8, 30);
    const classificacoes = await classificacoesDoDre(EMPRESA);
    for (const conexaoId of [null, az.id]) {
      const rec = recorteMensalDoDre({ companyId: EMPRESA, conexaoId, dataReferencia: referencia });
      const dre = await montarDreNoBanco(rec.escopo, rec.periodo, rec.periodoAnterior, classificacoes, { somarRetencoes: true, incluirTitulos: false });
      const ebitDre = dre.linhas.find((l) => l.chave === "EBIT")!.valorCents;
      const { resultado } = await dreCentroCustoNoBanco({ companyId: EMPRESA, conexaoId, dataReferencia: referencia, rateio: "RECEITA", somarRetencoes: true });
      conferir(`${conexaoId ? "Azul" : "grupo"}: centros + não alocado = EBIT do DRE`, resultado.ebitCents, ebitDre);
      if (!conexaoId) {
        const de = (id: string) => resultado.centros.find((c) => c.id === id)!;
        conferir("FEMSA: receita e retenção pelo projeto", [de(c1.id).porLinha.RECEITA_BRUTA, de(c1.id).porLinha.DEDUCOES], [1_000_100, -20_000]);
        conferir("folha da Azul 1:2 pelo quadro", [de(c1.id).porLinha.DESPESA_SALARIOS, de(c2.id).porLinha.DESPESA_SALARIOS], [-200_300, -400_600]);
        conferir("oficina com a folha da MCZ", de(m1.id).margemCents, -300_500);
        conferir("cliente sem vínculo não alocado", resultado.naoAlocado.totalCents, 400_300);
        conferir("aviso do quadro de outro mês", resultado.avisos.some((a) => a.includes("agosto")), true);
        conferir("juros fora dos centros", resultado.foraDoCentro.porLinha.DESPESA_FINANCEIRA, -10_100);
      }
    }
  } finally {
    await limpar();
    await prisma.$disconnect();
  }
}

(async () => {
  await planilha();
  motor();
  await banco();
  console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
})();
