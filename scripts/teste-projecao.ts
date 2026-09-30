// TESTES DA PROJEÇÃO E DOS CENÁRIOS — `npm run teste:projecao`.
//
// Base fechada, baseline sazonal com tendência e corte pelo MAD, receita
// contratada, projeção de doze meses com premissas, sensibilidade e orçado
// contra realizado. Cada regra tem o número que precisa dar e o caso em que
// precisa ficar quieta (sem base, sem contrato, mês que ainda não fechou).
//
// Sem banco: as séries são montadas à mão.
import type { OmieContrato } from "@prisma/client";
import type { ChaveDre } from "../src/lib/controladoria/dre";
import {
  apenasFechadas,
  baselineSazonal,
  mesesDoHorizonte,
  orcadoVersusRealizado,
  projetar,
  receitaContratadaPorMes,
  sensibilidade,
  somarMeses,
  subtotaisDe,
  ultimaCompetenciaFechada,
  type SerieDaLinha,
} from "../src/lib/controladoria/projecao";

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(
    `${ok ? "  ok  " : "FALHA "} ${nome}` +
      (ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         obtido   ${JSON.stringify(real)}`)
  );
}

const d = (iso: string) => new Date(iso);
// 22 de setembro de 2026: o último mês fechado é agosto.
const REFERENCIA = d("2026-09-22T00:00:00");

// Série de `n` meses terminando em `ate`, com o valor dado por função do
// índice (0 = o mais antigo).
function serie(ate: string, n: number, valor: (i: number) => number): SerieDaLinha {
  const s: SerieDaLinha = new Map();
  for (let i = 0; i < n; i++) s.set(somarMeses(ate, -(n - 1 - i)), valor(i));
  return s;
}

function base(porLinha: Partial<Record<ChaveDre, SerieDaLinha>>, referencia = REFERENCIA) {
  return apenasFechadas(new Map(Object.entries(porLinha) as [ChaveDre, SerieDaLinha][]), referencia);
}

console.log("BASE FECHADA — o mês em curso nunca é base");
{
  conferir("último mês fechado no dia 22 de setembro", ultimaCompetenciaFechada(REFERENCIA), "2026-08");
  conferir("no último dia do mês, o próprio mês fecha", ultimaCompetenciaFechada(d("2026-09-30T00:00:00")), "2026-09");
  conferir("horizonte começa no mês em curso", mesesDoHorizonte(REFERENCIA, 3), ["2026-09", "2026-10", "2026-11"]);
  const b = base({ RECEITA_BRUTA: serie("2026-09", 14, () => 100) });
  conferir("setembro (parcial) sai da base", b.competencias.at(-1), "2026-08");
  conferir("13 meses ficam", b.competencias.length, 13);
}

console.log("\nBASELINE SAZONAL — mesmo mês do ano anterior, tendência e corte pelo MAD");
{
  // 24 meses: primeiro ano 100 por mês, segundo ano 110 por mês → tendência 1,10.
  const s = serie("2026-08", 24, (i) => (i < 12 ? 100_00 : 110_00));
  const b = base({ RECEITA_BRUTA: s });
  const r = baselineSazonal(s, "2026-09", b);
  conferir("método: sazonal com tendência", r.metodo, "SAZONAL_COM_TENDENCIA");
  conferir("mesmo mês (set/25) = 110, tendência 1,10 → 121", [r.mesmoMesAnoAnteriorCents, r.tendencia, r.valorCents], [110_00, 1.1, 121_00]);

  // Sazonalidade: julho vale metade; a projeção de julho/27 repete o padrão.
  const sazonal = serie("2026-08", 24, (i) => {
    const mes = Number(somarMeses("2026-08", -(23 - i)).slice(5));
    return mes === 7 ? 50_00 : 100_00;
  });
  const bs = base({ RECEITA_BRUTA: sazonal });
  conferir("julho projetado repete o julho anterior", baselineSazonal(sazonal, "2027-07", bs).valorCents, 50_00);
  conferir("agosto projetado é o agosto anterior", baselineSazonal(sazonal, "2027-08", bs).valorCents, 100_00);

  // Um pico no mesmo mês do ano anterior é aparado pela faixa dos últimos 12.
  const comPico = serie("2026-08", 24, (i) => (i === 13 ? 900_00 : 100_00 + (i % 3) * 1_00));
  // i = 13 → competência 2025-10.
  const bp = base({ RECEITA_BRUTA: comPico });
  const pico = baselineSazonal(comPico, "2026-10", bp);
  conferir("o pico de out/25 não vira previsão de out/26", pico.aparadoCents! < 200_00, true);
  conferir("o valor bruto é lembrado", pico.mesmoMesAnoAnteriorCents, 900_00);

  // Só 12 meses: sazonal sem tendência.
  const doze = serie("2026-08", 12, () => 80_00);
  conferir("12 meses: sazonal sem tendência", baselineSazonal(doze, "2026-09", base({ RECEITA_BRUTA: doze })).metodo, "SAZONAL");
  // 6 meses: mediana.
  const seis = serie("2026-08", 6, (i) => [10, 20, 30, 40, 50, 1000][i] * 100);
  const m = baselineSazonal(seis, "2026-09", base({ RECEITA_BRUTA: seis }));
  conferir("6 meses: mediana (o 1000 não puxa)", [m.metodo, m.valorCents], ["MEDIANA", 35_00]);
  // 2 meses: sem base.
  const dois = serie("2026-08", 2, () => 10_00);
  conferir("2 meses: sem base, zero", baselineSazonal(dois, "2026-09", base({ RECEITA_BRUTA: dois })).metodo, "SEM_BASE");
}

console.log("\nRECEITA CONTRATADA — contratos ativos cobrindo o mês inteiro");
{
  const contrato = (p: Partial<OmieContrato>): OmieContrato =>
    ({ situacao: "10", valorMensalCents: 10_000_00, vigenciaInicio: d("2026-01-01T00:00:00"), vigenciaFim: null, periodicidade: "01", ...p }) as OmieContrato;
  const contratos = [
    contrato({}),
    contrato({ valorMensalCents: 5_000_00, vigenciaFim: d("2026-10-31T00:00:00") }), // termina em outubro
    contrato({ valorMensalCents: 3_000_00, vigenciaInicio: d("2026-11-15T00:00:00") }), // começa no meio de novembro
    contrato({ situacao: "99", valorMensalCents: 99_000_00 }), // cancelado
    contrato({ valorMensalCents: 0 }), // sem valor
    contrato({ valorMensalCents: 2_000_00, periodicidade: "03" }), // trimestral: competência mensal mesmo assim
  ];
  const r = receitaContratadaPorMes(contratos, ["2026-10", "2026-11", "2026-12"]);
  conferir("outubro: 10 + 5 + 2 mil, três contratos", r.get("2026-10"), { cents: 17_000_00, contratos: 3 });
  conferir("novembro: o de outubro saiu, o do dia 15 ainda não entrou", r.get("2026-11"), { cents: 12_000_00, contratos: 2 });
  conferir("dezembro: o novo entra inteiro", r.get("2026-12"), { cents: 15_000_00, contratos: 3 });
}

console.log("\nSUBTOTAIS — a mesma conta do DRE");
{
  const g = new Map<ChaveDre, number>([
    ["RECEITA_BRUTA", 1000],
    ["DEDUCOES", 100],
    ["CUSTO_SERVICO", 300],
    ["DESPESA_VEICULOS", 150],
    ["OUTRAS_RECEITAS", 20],
    ["DESPESA_FINANCEIRA", 10],
    ["FINANCIAMENTO_INVESTIMENTO", 60],
    ["TRIBUTO_SOBRE_LUCRO", 40],
  ]);
  const s = subtotaisDe(g);
  conferir("receita líquida", s.get("RECEITA_LIQUIDA"), 900);
  conferir("lucro bruto", s.get("LUCRO_BRUTO"), 600);
  conferir("EBIT soma outras receitas", s.get("EBIT"), 470);
  conferir("LAIR desconta financeira", s.get("LAIR"), 460);
  conferir("resultado líquido", s.get("RESULTADO_LIQUIDO"), 360);
}

console.log("\nPROJEÇÃO — doze meses, premissas e base de receita");
{
  const receita = serie("2026-08", 24, () => 1_000_00);
  const veiculos = serie("2026-08", 24, () => 300_00);
  const pessoas = serie("2026-08", 24, () => 400_00);
  const b = base({ RECEITA_BRUTA: receita, DESPESA_VEICULOS: veiculos, DESPESA_SALARIOS: pessoas });
  const meses = mesesDoHorizonte(REFERENCIA, 12);

  const basePura = projetar(b, [], meses);
  conferir("doze meses, de set/26 a ago/27", [basePura.meses[0].rotulo, basePura.meses[11].rotulo], ["set/26", "ago/27"]);
  conferir("EBIT base: (1000 − 300 − 400) × 12", basePura.ebitCents, 300_00 * 12);
  conferir("linha sem série fica zero e SEM_BASE", basePura.linhas.find((l) => l.chave === "DESPESA_ESTRUTURA")!.metodos[0], "SEM_BASE");
  conferir("a base descreve de onde veio", basePura.base, { ultimaCompetenciaFechada: "2026-08", mesesDeBase: 24, primeiraCompetencia: "2024-09" });

  // Diesel +10% a partir de novembro: só DESPESA_VEICULOS, só de novembro em diante.
  const diesel = projetar(b, [], meses, { baseReceita: "HISTORICA", premissas: [{ linha: "DESPESA_VEICULOS", percentual: 10, desde: "2026-11" }] });
  const v = diesel.linhas.find((l) => l.chave === "DESPESA_VEICULOS")!;
  conferir("set e out inalterados, nov em diante +10%", [v.porMes[0], v.porMes[1], v.porMes[2], v.porMes[11]], [300_00, 300_00, 330_00, 330_00]);
  conferir("a base por mês continua visível", v.basePorMes[2], 300_00);
  conferir("EBIT cai 30 × 10 meses", basePura.ebitCents - diesel.ebitCents, 30_00 * 10);
  conferir("premissa aplicada é devolvida", diesel.premissasAplicadas.length, 1);

  // Premissa com fim: só três meses.
  const temporaria = projetar(b, [], meses, { baseReceita: "HISTORICA", premissas: [{ linha: "DESPESA_SALARIOS", percentual: -50, desde: "2026-10", ate: "2026-12" }] });
  const p = temporaria.linhas.find((l) => l.chave === "DESPESA_SALARIOS")!;
  conferir("out, nov e dez pela metade; jan volta", [p.porMes[1], p.porMes[3], p.porMes[4]], [200_00, 200_00, 400_00]);

  // Receita contratada: substitui a série onde há contrato; onde não há, cai na série.
  const contratos = [{ situacao: "10", valorMensalCents: 1_500_00, vigenciaInicio: d("2026-01-01T00:00:00"), vigenciaFim: d("2026-12-31T00:00:00"), periodicidade: "01" } as OmieContrato];
  const contratada = projetar(b, contratos, meses, { baseReceita: "CONTRATADA", premissas: [] });
  const rb = contratada.linhas.find((l) => l.chave === "RECEITA_BRUTA")!;
  conferir("até dezembro: contratada 1.500; de janeiro: série 1.000", [rb.porMes[3], rb.metodos[3], rb.porMes[4], rb.metodos[4]], [1_500_00, "CONTRATADA", 1_000_00, "SAZONAL_COM_TENDENCIA"]);
  conferir("receita contratada por mês vai junto", contratada.receitaContratada[0], { cents: 1_500_00, contratos: 1 });
  conferir("com base HISTORICA os contratos não entram no número", basePura.linhas.find((l) => l.chave === "RECEITA_BRUTA")!.porMes[0], 1_000_00);

  console.log("\nSENSIBILIDADE — uma linha, ±10%, efeito no EBIT e no resultado");
  const s = sensibilidade(b, [], meses, { baseReceita: "HISTORICA", premissas: [] }, ["RECEITA_BRUTA", "DESPESA_VEICULOS"]);
  conferir("quatro linhas: duas linhas × dois percentuais", s.length, 4);
  conferir("receita −10%: EBIT cai 100 × 12", s[0].efeitoEbitCents, -100_00 * 12);
  conferir("receita +10%: EBIT sobe 100 × 12", s[1].efeitoEbitCents, 100_00 * 12);
  conferir("veículos −10%: EBIT sobe 30 × 12", s[2].efeitoEbitCents, 30_00 * 12);
  conferir("sem financeiro nem tributo, resultado = EBIT", s[3].efeitoResultadoCents, s[3].efeitoEbitCents);
}

console.log("\nORÇADO × REALIZADO — só meses fechados com orçamento");
{
  const receita = serie("2026-08", 8, () => 1_000_00); // jan..ago/26
  const veiculos = serie("2026-08", 8, () => 350_00);
  const b = base({ RECEITA_BRUTA: receita, DESPESA_VEICULOS: veiculos });
  const orcamento = ["2026-07", "2026-08", "2026-09", "2026-10"].flatMap((c) => [
    { linha: "RECEITA_BRUTA", competencia: c, valorCents: 1_100_00 },
    { linha: "DESPESA_VEICULOS", competencia: c, valorCents: 300_00 },
  ]);
  const r = orcadoVersusRealizado(orcamento, b, 2026);
  const rb = r.find((l) => l.chave === "RECEITA_BRUTA")!;
  conferir("compara jul e ago; set e out ainda não fecharam", rb.meses, ["2026-07", "2026-08"]);
  conferir("receita: orçado 2.200, realizado 2.000, desvio −200 (−9,1%)", [rb.orcadoCents, rb.realizadoCents, rb.desvioCents, Math.round(rb.desvioPercent! * 10) / 10], [2_200_00, 2_000_00, -200_00, -9.1]);
  const rv = r.find((l) => l.chave === "DESPESA_VEICULOS")!;
  conferir("despesa acima do orçado é desvio desfavorável", rv.desvioCents, -100_00);
  const ebit = r.find((l) => l.chave === "EBIT")!;
  conferir("EBIT: orçado 1.600, realizado 1.300", [ebit.orcadoCents, ebit.realizadoCents, ebit.desvioCents], [1_600_00, 1_300_00, -300_00]);
  conferir("orçamento de outro ano: nada a comparar", orcadoVersusRealizado(orcamento, b, 2025), []);
}

console.log("\nPESSOAS EM DUAS LINHAS — orçamento gravado antes da separação");
{
  // Até a linha de pessoas virar duas, toda a folha era orçada em
  // DESPESA_SALARIOS. O realizado agora vem em duas linhas; comparar o orçado
  // antigo só com a operação inventaria uma economia do tamanho da folha
  // corporativa.
  const b = base({
    RECEITA_BRUTA: serie("2026-08", 8, () => 1_000_00),
    DESPESA_SALARIOS: serie("2026-08", 8, () => 300_00),
    DESPESA_SALARIOS_CORPORATIVO: serie("2026-08", 8, () => 100_00),
  });
  const antigo = ["2026-07", "2026-08"].flatMap((c) => [{ linha: "DESPESA_SALARIOS", competencia: c, valorCents: 400_00 }]);
  const pessoas = orcadoVersusRealizado(antigo, b, 2026).find((l) => l.chave === "DESPESA_SALARIOS")!;
  conferir("orçado antigo x realizado das duas linhas: sem desvio falso", [pessoas.orcadoCents, pessoas.realizadoCents, pessoas.desvioCents], [800_00, 800_00, 0]);
  const novo = [...antigo.map((o) => ({ ...o, valorCents: 300_00 })),
    ...["2026-07", "2026-08"].map((c) => ({ linha: "DESPESA_SALARIOS_CORPORATIVO", competencia: c, valorCents: 100_00 }))];
  const r = orcadoVersusRealizado(novo, b, 2026);
  conferir("orçamento novo compara linha a linha", [r.find((l) => l.chave === "DESPESA_SALARIOS")!.realizadoCents, r.find((l) => l.chave === "DESPESA_SALARIOS_CORPORATIVO")!.realizadoCents], [600_00, 200_00]);
  conferir("o EBIT é o mesmo pelos dois caminhos",
    orcadoVersusRealizado(antigo, b, 2026).find((l) => l.chave === "EBIT")!.realizadoCents,
    r.find((l) => l.chave === "EBIT")!.realizadoCents);
  conferir("subtotais descontam as duas linhas", subtotaisDe(new Map<ChaveDre, number>([["RECEITA_BRUTA", 1000], ["DESPESA_SALARIOS", 300], ["DESPESA_SALARIOS_CORPORATIVO", 100]])).get("EBIT"), 600);
}

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
