// PAINEL DE INDICADORES — `npm run teste:indicadores`.
//
// Parte pura: as contas (ROIC, EVA, alavancagem, cobertura, margens, payout,
// concentração, faróis) sobre um DRE montado à mão. Parte com banco (só com
// TESTE_DATABASE_URL): a colheita — receita por cliente pela regra de
// categoria do DRE, raiz do CNPJ, eliminação entre as empresas do grupo,
// empréstimo fora da receita, prazos ponderados e o balanço da data-base.
import { PrismaClient, Prisma } from "@prisma/client";
import {
  calcularIndicadores,
  competenciaDoBalanco,
  dreDaJanela,
  farolPorFaixa,
  janelaDe12,
  somarMeses,
  type BalancoIndicadores,
  type SerieDre,
} from "../src/lib/controladoria/indicadores";
import { subtotaisDoDre } from "../src/lib/controladoria/dre";

let falhas = 0;
const perto = (a: number | null | undefined, b: number, tol = 1e-6) => a !== null && a !== undefined && Math.abs(a - b) < tol;
function ok(nome: string, passou: boolean, detalhe = "") {
  if (!passou) falhas++;
  console.log(`  ${passou ? "ok  " : "FALHA"} ${nome}${passou || !detalhe ? "" : ` — ${detalhe}`}`);
}

// ------------------------------------------------------------------ puro
console.log("DATAS");
ok("somarMeses atravessa o ano", somarMeses("2025-11", 3) === "2026-02" && somarMeses("2026-01", -1) === "2025-12");
ok("balanço no último dia do mês: o próprio mês", competenciaDoBalanco(new Date("2025-12-31T00:00:00Z")) === "2025-12");
ok("balanço no meio do mês: o mês anterior", competenciaDoBalanco(new Date("2026-06-15T00:00:00Z")) === "2026-05");
const disponiveis = Array.from({ length: 20 }, (_, i) => somarMeses("2025-01", i));
ok("janela de 12 dentro da base", janelaDe12("2025-12", disponiveis)?.join() === disponiveis.slice(0, 12).join());
ok("janela de 12 fora da base: nula", janelaDe12("2025-06", disponiveis) === null);

console.log("\nFARÓIS");
ok("maior melhor", farolPorFaixa(25, 20, 15, true) === "VERDE" && farolPorFaixa(17, 20, 15, true) === "AMARELO" && farolPorFaixa(10, 20, 15, true) === "VERMELHO");
ok("menor melhor", farolPorFaixa(2, 2.5, 3.5, false) === "VERDE" && farolPorFaixa(3, 2.5, 3.5, false) === "AMARELO" && farolPorFaixa(4, 2.5, 3.5, false) === "VERMELHO");
ok("sem dado", farolPorFaixa(null, 1, 2, true) === "SEM_DADO");

// Um DRE de 12 meses, por mês (centavos): receita 1.000, deduções 100,
// veículos 300, pessoas 300 (+50 corporativo), sócios 50, financeiro 20,
// parcelas 100, IRPJ 10. Janeiro com receita 300 (escolar sem aula).
const competencias = Array.from({ length: 12 }, (_, i) => somarMeses("2025-09", i));
const dre: SerieDre = new Map();
const por = (chave: string, f: (c: string) => number) => dre.set(chave, new Map(competencias.map((c) => [c, f(c)])));
por("RECEITA_BRUTA", (c) => (c.endsWith("-01") ? 300 : 1000));
por("DEDUCOES", (c) => (c.endsWith("-01") ? 30 : 100));
por("DESPESA_VEICULOS", () => 300);
por("DESPESA_SALARIOS", () => 300);
por("DESPESA_SALARIOS_CORPORATIVO", () => 50);
por("DESPESA_SOCIOS", () => 50);
por("DESPESA_FINANCEIRA", () => 20);
por("FINANCIAMENTO_INVESTIMENTO", () => 100);
por("TRIBUTO_SOBRE_LUCRO", () => 10);

console.log("\nDRE DA JANELA");
const d = dreDaJanela(dre, competencias);
const g = (chave: string) => [...(dre.get(chave)?.values() ?? [])].reduce((a, v) => a + v, 0);
const sub = subtotaisDoDre(g);
ok("EBITDA = EBIT da demonstração (mesma conta)", d.ebitda === sub.EBIT, `${d.ebitda} × ${sub.EBIT}`);
ok("resultado = resultado líquido da demonstração", d.resultado === sub.RESULTADO_LIQUIDO, `${d.resultado} × ${sub.RESULTADO_LIQUIDO}`);
ok("receita líquida 11×900 + 270", d.receitaLiquida === 11 * 900 + 270);

const balanco: BalancoIndicadores = {
  dataBase: new Date("2026-08-31T00:00:00Z"),
  caixaCents: 1_000,
  contasReceberCents: 1_500,
  ativoCirculanteCents: 3_000,
  imobilizadoLiquidoCents: 20_000,
  ativoTotalCents: 24_000,
  fornecedoresCents: 800,
  passivoCirculanteCents: 2_500,
  dividaCurtoPrazoCents: 2_000,
  dividaLongoPrazoCents: 8_000,
  patrimonioLiquidoCents: 10_000,
  depreciacaoAnoCents: 1_200,
  lucroLiquidoAnoCents: 1_500,
  custoCapitalAa: 0.18,
  frotaVeiculos: 4,
  kmAno: 48_000,
};

console.log("\nRETORNO");
const lista = calcularIndicadores({ dre, competencias, competenciasDoBalanco: competencias, balanco, balancoAnterior: null, recebiveis: null });
const ind = (chave: string) => lista.find((i) => i.chave === chave);
const capital = 2_000 + 8_000 + 10_000 - 1_000;
const nopat = d.ebitda - 1_200 - d.tributoLucro;
ok("ROIC = (EBITDA − depreciação − IRPJ) ÷ (dívida + PL − caixa)", perto(ind("ROIC")?.valor, (nopat / capital) * 100), `${ind("ROIC")?.valor}`);
ok("EVA = NOPAT − 18% × capital", perto(ind("EVA")?.valor, nopat - 0.18 * capital));
ok("ROE = lucro contábil ÷ PL", perto(ind("ROE")?.valor, 15));
ok("dívida líquida ÷ EBITDA", perto(ind("DL_EBITDA")?.valor, 9_000 / d.ebitda));
ok("liquidez 3.000 ÷ 2.500 = 1,2 → verde", perto(ind("LIQUIDEZ")?.valor, 1.2) && ind("LIQUIDEZ")?.farol === "VERDE");
ok("cobertura = EBITDA ÷ (financeiro + parcelas)", perto(ind("COBERTURA")?.valor, d.ebitda / (12 * 120)));
ok("margem EBITDA sobre a receita líquida", perto(ind("MARGEM_EBITDA")?.valor, (d.ebitda / d.receitaLiquida) * 100));
ok("payout = sócios ÷ (resultado + sócios)", perto(ind("PAYOUT")?.valor, (600 / (d.resultado + 600)) * 100));
ok("janeiro negativo conta como mês no vermelho", ind("MESES_NEGATIVOS")?.valor === 1 && ind("MESES_NEGATIVOS")?.farol === "VERDE");
ok("frota: receita por veículo por mês", perto(ind("RECEITA_VEICULO")?.valor, g("RECEITA_BRUTA") / 12 / 4));
ok("frota: custo por km = despesas operacionais ÷ km", perto(ind("CUSTO_KM")?.valor, d.despesasOperacionais / 48_000));

const semDepreciacao = calcularIndicadores({
  dre, competencias, competenciasDoBalanco: competencias, recebiveis: null, balancoAnterior: null,
  balanco: { ...balanco, depreciacaoAnoCents: null },
});
ok("sem depreciação: estima 12% do imobilizado e diz", /estimada/.test(semDepreciacao.find((i) => i.chave === "ROIC")!.formula) &&
  perto(semDepreciacao.find((i) => i.chave === "ROIC")?.valor, ((d.ebitda - 2_400 - d.tributoLucro) / capital) * 100));
const comAnterior = calcularIndicadores({
  dre, competencias, competenciasDoBalanco: competencias, recebiveis: null, balanco,
  balancoAnterior: { ...balanco, patrimonioLiquidoCents: 6_000 },
});
ok("com o balanço anterior: capital médio", perto(comAnterior.find((i) => i.chave === "ROIC")?.valor, (nopat / ((capital + capital - 4_000) / 2)) * 100));

const semBalanco = calcularIndicadores({ dre, competencias, competenciasDoBalanco: null, balanco: null, balancoAnterior: null, recebiveis: null });
ok("sem balanço: ROIC sem dado, margens calculadas", semBalanco.find((i) => i.chave === "ROIC")?.farol === "SEM_DADO" && semBalanco.find((i) => i.chave === "MARGEM_EBITDA")?.valor !== null);

const retirandoDemais = new Map(dre);
retirandoDemais.set("DESPESA_SOCIOS", new Map(competencias.map((c) => [c, 900])));
const payout = calcularIndicadores({ dre: retirandoDemais, competencias, competenciasDoBalanco: null, balanco: null, balancoAnterior: null, recebiveis: null });
ok("resultado antes das retiradas negativo: payout vermelho", payout.find((i) => i.chave === "PAYOUT")?.farol === "VERMELHO");

console.log("\nCLIENTES");
const clientes = calcularIndicadores({
  dre, competencias, competenciasDoBalanco: null, balanco: null, balancoAnterior: null,
  recebiveis: { receitaPorClienteCents: [100, 600, 300], pmrDias: 40, pmpDias: 20, vencidoMais30Cents: 50 },
});
const cli = (chave: string) => clientes.find((i) => i.chave === chave);
ok("maior cliente 60% → vermelho", perto(cli("TOP1")?.valor, 60) && cli("TOP1")?.farol === "VERMELHO");
ok("três maiores 100%", perto(cli("TOP3")?.valor, 100));
ok("ciclo = PMR − PMP = 20 → amarelo", cli("CICLO")?.valor === 20 && cli("CICLO")?.farol === "AMARELO");
ok("vencido > 30 dias ÷ receita média do mês", perto(cli("INADIMPLENCIA")?.valor, (50 / (g("RECEITA_BRUTA") / 12)) * 100));

// ------------------------------------------------------------------ banco
async function comBanco() {
  const url = process.env.TESTE_DATABASE_URL;
  if (!url) {
    console.log("\nTESTE_DATABASE_URL não definida — pulando a parte com banco.");
    return;
  }
  process.env.DATABASE_URL = url;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const EMPRESA = "empresa-indicadores";
  const limpar = async () => {
    await prisma.balancoPatrimonial.deleteMany({ where: { companyId: EMPRESA } });
    await prisma.omieTitulo.deleteMany({ where: { companyId: EMPRESA } });
    await prisma.omieCategoria.deleteMany({ where: { companyId: EMPRESA } });
    await prisma.omieConexao.deleteMany({ where: { companyId: EMPRESA } });
    await prisma.controladoriaConfig.deleteMany({ where: { companyId: EMPRESA } });
  };
  try {
    const { fixarHojeParaTeste } = await import("../src/lib/controladoria/competencia");
    fixarHojeParaTeste(new Date(2027, 0, 1));
    const { painelDeIndicadores } = await import("../src/lib/controladoria/indicadoresNoBanco");
    await limpar();
    const az = await prisma.omieConexao.create({ data: { companyId: EMPRESA, nome: "Azul Ind", apelido: "AZ", credencialRef: "AZI", cnpj: "11111111000191" } });
    const mc = await prisma.omieConexao.create({ data: { companyId: EMPRESA, nome: "MCZ Ind", apelido: "MC", credencialRef: "MCI", cnpj: "22222222000191" } });
    await prisma.controladoriaConfig.create({ data: { companyId: EMPRESA, dataInicioBase: new Date(2025, 0, 1) } });
    await prisma.omieCategoria.createMany({
      data: [
        { companyId: EMPRESA, conexaoId: az.id, conexaoApelido: "AZ", codigo: "R1", descricao: "Clientes — Serviços Prestados", contaReceita: true },
        { companyId: EMPRESA, conexaoId: az.id, conexaoApelido: "AZ", codigo: "E1", descricao: "Empréstimo de terceiros", contaReceita: true },
        { companyId: EMPRESA, conexaoId: az.id, conexaoApelido: "AZ", codigo: "D1", descricao: "Combustível e diesel", contaDespesa: true },
        { companyId: EMPRESA, conexaoId: az.id, conexaoApelido: "AZ", codigo: "D2", descricao: "Salários e folha", contaDespesa: true },
        { companyId: EMPRESA, conexaoId: mc.id, conexaoApelido: "MC", codigo: "R1", descricao: "Clientes — Serviços Prestados", contaReceita: true },
      ],
    });

    const dia = (base: Date, n: number) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + n);
    const titulos: Prisma.OmieTituloCreateManyInput[] = [];
    let n = 0;
    const titulo = (t: Partial<Prisma.OmieTituloCreateManyInput> & { natureza: "RECEBER" | "PAGAR"; dataEmissao: Date; valorDocumentoCents: number }) =>
      titulos.push({
        companyId: EMPRESA,
        conexaoId: az.id,
        conexaoApelido: "AZ",
        codigoLancamento: `T${++n}`,
        status: t.liquidado ? "PAGO" : "ABERTO",
        dataVencimento: dia(t.dataEmissao, 10),
        ...t,
      });
    // Jan/2025 a ago/2026: cliente A (duas filiais) 60 mil pago em 30 dias,
    // B 30 mil pago em 60, C 10 mil nunca pago; diesel 40 mil pago em 20
    // dias; folha 30 mil em aberto (vencida: entra no DRE).
    for (let i = 0; i < 20; i++) {
      const emissao = new Date(2025, i, 5);
      titulo({ natureza: "RECEBER", categoriaCodigo: "R1", parceiroDocumento: i % 2 ? "33333333000272" : "33333333000191", parceiroNome: "Cliente A",
        dataEmissao: emissao, valorDocumentoCents: 6_000_000, liquidado: true, dataUltimaBaixa: dia(emissao, 30) });
      titulo({ natureza: "RECEBER", categoriaCodigo: "R1", parceiroDocumento: "44444444000191", parceiroNome: "Cliente B",
        dataEmissao: emissao, valorDocumentoCents: 3_000_000, liquidado: true, dataUltimaBaixa: dia(emissao, 60) });
      titulo({ natureza: "RECEBER", categoriaCodigo: "R1", parceiroDocumento: "55555555000191", parceiroNome: "Cliente C",
        dataEmissao: emissao, valorDocumentoCents: 1_000_000 });
      titulo({ natureza: "PAGAR", categoriaCodigo: "D1", parceiroDocumento: "66666666000191", dataEmissao: emissao, valorDocumentoCents: 4_000_000,
        liquidado: true, dataUltimaBaixa: dia(emissao, 20) });
      titulo({ natureza: "PAGAR", categoriaCodigo: "D2", parceiroDocumento: "77777777000191", dataEmissao: emissao, valorDocumentoCents: 3_000_000 });
      // A MCZ faturando a Azul: operação dentro do grupo, fora na visão do grupo.
      titulo({ natureza: "RECEBER", categoriaCodigo: "R1", conexaoId: mc.id, conexaoApelido: "MC", parceiroDocumento: "11111111000191",
        dataEmissao: emissao, valorDocumentoCents: 50_000_000, liquidado: true, dataUltimaBaixa: dia(emissao, 5) });
    }
    // Empréstimo recebido: entra pelo contas a receber, mas não é cliente.
    titulo({ natureza: "RECEBER", categoriaCodigo: "E1", parceiroDocumento: "88888888000191", parceiroNome: "Banco",
      dataEmissao: new Date(2026, 2, 10), valorDocumentoCents: 90_000_000, liquidado: true, dataUltimaBaixa: new Date(2026, 2, 10) });
    await prisma.omieTitulo.createMany({ data: titulos });

    const reais = (v: number) => new Prisma.Decimal(v);
    const base = {
      companyId: EMPRESA, escopo: "GRUPO", contasReceber: reais(0), ativoCirculante: reais(150_000), imobilizadoLiquido: reais(500_000),
      ativoTotal: reais(700_000), fornecedores: reais(0), passivoCirculante: reais(100_000), dividaCurtoPrazo: reais(100_000),
      dividaLongoPrazo: reais(150_000), caixa: reais(50_000), depreciacaoAno: reais(30_000),
    };
    await prisma.balancoPatrimonial.create({ data: { ...base, dataBase: new Date("2025-12-31T00:00:00Z"), patrimonioLiquido: reais(200_000) } });
    await prisma.balancoPatrimonial.create({ data: { ...base, dataBase: new Date("2024-12-31T00:00:00Z"), patrimonioLiquido: reais(100_000) } });
    // Um balanço velho demais para ser o "anterior" de ninguém, e o de outra empresa.
    await prisma.balancoPatrimonial.create({ data: { ...base, dataBase: new Date("2021-12-31T00:00:00Z"), patrimonioLiquido: reais(1) } });
    await prisma.balancoPatrimonial.create({ data: { ...base, escopo: az.id, dataBase: new Date("2026-06-30T00:00:00Z"), patrimonioLiquido: reais(1) } });

    console.log("\nCOM BANCO (grupo)");
    const p = await painelDeIndicadores({ companyId: EMPRESA, conexaoId: null }, new Date(2026, 8, 22));
    const v = (chave: string) => p.indicadores.find((i) => i.chave === chave);
    ok("12 meses fechados: set/2025 a ago/2026", p.competencias[0] === "2025-09" && p.competencias.at(-1) === "2026-08", p.competencias.join());
    ok("receita bruta 12 × 100 mil (sem a MCZ faturando a Azul, sem o empréstimo)", v("RECEITA_12M")?.valor === 120_000_000, `${v("RECEITA_12M")?.valor}`);
    ok("maior cliente: as duas filiais de A somadas = 60%", perto(v("TOP1")?.valor, 60), `${v("TOP1")?.valor}`);
    ok("PMR ponderado: (30×60 + 60×30) ÷ 90 = 40 dias", perto(v("PMR")?.valor, 40, 0.05), `${v("PMR")?.valor}`);
    ok("PMP: 20 dias", perto(v("PMP")?.valor, 20, 0.05), `${v("PMP")?.valor}`);
    ok("vencido > 30 dias: os 20 títulos de C ÷ receita do mês", perto(v("INADIMPLENCIA")?.valor, (20_000_000 / 10_000_000) * 100, 0.01), `${v("INADIMPLENCIA")?.valor}`);
    ok("balanço mais recente do grupo (dez/2025), anterior dez/2024; o de 2021 e o da empresa ficam fora",
      p.balanco?.dataBase.toISOString().slice(0, 10) === "2025-12-31" && p.balancoAnterior?.dataBase.toISOString().slice(0, 10) === "2024-12-31");
    ok("DRE do retorno: jan a dez/2025", p.competenciasDoBalanco?.[0] === "2025-01" && p.competenciasDoBalanco?.[11] === "2025-12");
    // EBITDA de 2025: 12 × (100 − 40 − 30) mil = 360 mil; NOPAT = 360 − 30.
    // Capital: dez/2025 = 100 + 150 + 200 − 50 = 400 mil; dez/2024 = 300 mil.
    ok("ROIC = 330 mil ÷ 350 mil", perto(v("ROIC")?.valor, (330_000 / 350_000) * 100, 0.01), `${v("ROIC")?.valor}`);
    ok("dívida líquida ÷ EBITDA = 200 ÷ 360", perto(v("DL_EBITDA")?.valor, 200 / 360, 0.001), `${v("DL_EBITDA")?.valor}`);

    console.log("\nCOM BANCO (só a MCZ)");
    const pm = await painelDeIndicadores({ companyId: EMPRESA, conexaoId: mc.id }, new Date(2026, 8, 22));
    ok("na MCZ, o faturamento contra a Azul é receita (cliente único, 100%)",
      pm.indicadores.find((i) => i.chave === "RECEITA_12M")?.valor === 600_000_000 && perto(pm.indicadores.find((i) => i.chave === "TOP1")?.valor, 100));
    ok("sem balanço da MCZ", pm.balanco === null && pm.indicadores.find((i) => i.chave === "ROIC")?.farol === "SEM_DADO");
  } finally {
    await limpar();
    await prisma.$disconnect();
  }
}

comBanco()
  .catch((e) => {
    falhas++;
    console.error(e);
  })
  .finally(() => {
    console.log(falhas === 0 ? "\nTodos os testes passaram." : `\n${falhas} falha(s).`);
    process.exit(falhas === 0 ? 0 : 1);
  });
