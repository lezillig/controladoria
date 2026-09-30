// O MÊS SE FORMANDO — `npm run teste:mes-em-formacao`. Sem banco: contexto e
// DRE montados à mão para a prontidão do fechamento, o alerta de margem, a
// cobrança do dia e a previsão de fechamento.
import type { ContextoAuditoria } from "../src/lib/controladoria/types";
import {
  cobrancaDoDia,
  margemEmQueda,
  mesDoFechamento,
  previsaoDoMes,
  prontidaoDoFechamento,
  type DreDoMes,
  type SerieDoDre,
} from "../src/lib/controladoria/mesEmFormacao";

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "  ok  " : "FALHA "} ${nome}` + (ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         obtido   ${JSON.stringify(real)}`));
}
const perto = (nome: string, real: number | null | undefined, alvo: number, tol = 1e-6) => conferir(nome, real !== null && real !== undefined && Math.abs(real - alvo) < tol ? alvo : real, alvo);

const d = (iso: string) => new Date(`${iso}T00:00:00`);
const REF = d("2026-09-22"); // D-1; "hoje" é 23/09

let seq = 0;
function titulo(p: Record<string, unknown>) {
  seq++;
  return {
    id: `t${seq}`,
    natureza: "RECEBER",
    cancelado: false,
    liquidado: false,
    saldoCents: null,
    valorDocumentoCents: 100_000,
    valorPagoCents: 0,
    dataEmissao: d("2026-09-05"),
    dataVencimento: d("2026-09-30"),
    parceiroNome: "Cliente A",
    parceiroCodigo: "A",
    parceiroDocumento: "11111111000191",
    conexaoId: "cx1",
    conexaoApelido: "AZUL",
    numeroDocumento: `${seq}`,
    tipoDocumento: "NFS",
    chaveNfe: null,
    ...p,
  };
}

function contexto(p: Partial<Record<keyof ContextoAuditoria, unknown>>): ContextoAuditoria {
  return {
    companyId: "c",
    conexaoId: null,
    dataReferencia: REF,
    agora: REF,
    janelaDesde: d("2026-01-01"),
    titulos: [],
    baixas: [],
    parceiros: [],
    movimentos: [],
    ctes: [],
    raizesCnpjDoGrupo: ["99999999"],
    ...p,
  } as unknown as ContextoAuditoria;
}

console.log("\n1. PRONTIDÃO DO FECHAMENTO");
{
  conferir("até o dia 10, o mês fechando é o anterior", [mesDoFechamento(d("2026-10-05")).periodo.rotulo, mesDoFechamento(d("2026-10-05")).momento], ["set/26", "FECHANDO"]);
  conferir("depois do dia 10, o próprio mês", [mesDoFechamento(REF).periodo.rotulo, mesDoFechamento(REF).momento], ["set/26", "EM_CURSO"]);
  const { periodo } = mesDoFechamento(REF);
  const ctx = contexto({
    titulos: [
      titulo({ valorDocumentoCents: 300_000 }),
      titulo({ valorDocumentoCents: 100_000, tipoDocumento: "BOL", numeroDocumento: null }), // sem nota
      titulo({ valorDocumentoCents: 500_000, parceiroDocumento: "99999999000100" }), // intercompany: fora
      titulo({ valorDocumentoCents: 200_000, dataEmissao: d("2026-08-20") }), // outro mês
      titulo({ valorDocumentoCents: 50_000, numeroDocumento: "CT-777", tipoDocumento: "CTE" }),
    ],
    movimentos: [
      { data: d("2026-09-10"), conciliado: true, valorCents: 10_000, conexaoId: "cx1" },
      { data: d("2026-09-11"), conciliado: false, valorCents: -30_000, conexaoId: "cx1" },
      { data: d("2026-09-12"), conciliado: true, valorCents: 5_000, conexaoId: "cx1" },
      { data: d("2026-09-13"), conciliado: false, valorCents: 7_000, conexaoId: "cx1" },
      { data: d("2026-08-13"), conciliado: false, valorCents: 7_000, conexaoId: "cx1" }, // outro mês
    ],
    ctes: [
      { id: "c1", chave: null, numero: "777", dataEmissao: d("2026-09-05"), valorCents: 50_000, status: "00", cancelado: false, conexaoId: "cx1" },
      { id: "c2", chave: null, numero: "888", dataEmissao: d("2026-09-06"), valorCents: 80_000, status: "00", cancelado: false, conexaoId: "cx1" },
      { id: "c3", chave: null, numero: "999", dataEmissao: d("2026-09-06"), valorCents: 80_000, status: "00", cancelado: true, conexaoId: "cx1" },
    ],
  });
  const dre: DreDoMes = {
    linhas: [
      { chave: "RECEITA_BRUTA", tipo: "GRUPO", valorCents: 800_000 },
      { chave: "DESPESA_VEICULOS", tipo: "GRUPO", valorCents: 150_000 },
      { chave: "RECEITA_LIQUIDA", tipo: "SUBTOTAL", valorCents: 800_000 },
    ],
    naoConfirmadoCents: 50_000,
    semCategoriaCents: 50_000,
  };
  const p = prontidaoDoFechamento(ctx, dre, periodo, "EM_CURSO");
  const item = (c: string) => p.itens.find((i) => i.chave === c)!;
  perto("classificação: 1 − 100 mil ÷ 1 milhão de movimento", item("CLASSIFICACAO").pronto, 0.9);
  perto("conciliação: 2 de 4 lançamentos do mês", item("CONCILIACAO").pronto, 0.5);
  conferir("conciliação: valor que falta em módulo", item("CONCILIACAO").faltaCents, 37_000);
  perto("documento fiscal: R$ 1 mil sem nota em R$ 4,5 mil (sem o intercompany)", item("DOCUMENTO_FISCAL").pronto, 1 - 100_000 / 450_000);
  perto("CT-e: 1 de 2 autorizados casa (cancelado fora)", item("CTE").pronto, 0.5);
  conferir("CT-e solto em valor", item("CTE").faltaCents, 80_000);
  perto("pronto geral = média dos itens", p.pronto, (0.9 + 0.5 + (1 - 100_000 / 450_000) + 0.5) / 4);
  const porItens = prontidaoDoFechamento(
    contexto({}),
    {
      linhas: [
        // Linha que mistura receita e despesa: total 60, categorias 100 + 40.
        { chave: "OUTRAS_RECEITAS", tipo: "GRUPO", valorCents: 60, itens: [{ categoriaCodigo: "1", valorCents: 100, confirmada: true }, { categoriaCodigo: "2", valorCents: -40, confirmada: false }] },
        { chave: "DEDUCOES", tipo: "GRUPO", valorCents: 50, itens: [{ categoriaCodigo: "RETENCAO_NA_FONTE", valorCents: 50, confirmada: true }] },
      ],
      naoConfirmadoCents: 40,
      semCategoriaCents: 0,
    },
    periodo,
    "EM_CURSO"
  );
  perto("classificação pelas categorias (sem a retenção): 100 de 140", porItens.itens[0].pronto, 100 / 140);
  const vazio = prontidaoDoFechamento(contexto({}), { linhas: [], naoConfirmadoCents: 0, semCategoriaCents: 0 }, periodo, "EM_CURSO");
  conferir("sem movimento nenhum: nada a medir, sem CT-e", [vazio.pronto, vazio.itens.map((i) => i.chave)], [null, ["CLASSIFICACAO", "CONCILIACAO", "DOCUMENTO_FISCAL"]]);
}

console.log("\n2. VENDEU MAIS E GANHOU MENOS");
{
  const serie = (receitas: number[], resultados: number[], veiculos: number[]): SerieDoDre => ({
    meses: receitas.map((_, i) => `2026-0${i + 5}`),
    linhasDre: { RECEITA_LIQUIDA: receitas, RESULTADO_LIQUIDO: resultados, DESPESA_VEICULOS: veiculos, DESPESA_SALARIOS: receitas.map((r) => r * 0.3) },
  });
  const alerta = margemEmQueda(serie([100, 100, 100, 105], [10, 10, 10, 5], [30, 30, 30, 36]));
  conferir("receita subiu, margem caiu de 10% para 4,8%: alerta", [alerta?.mes, alerta?.receitaMediaCents, Math.round((alerta?.margem ?? 0) * 1000)], ["2026-08", 100, 48]);
  conferir("a linha que mais cresceu sobre a receita", alerta?.culpados.map((c) => c.chave), ["DESPESA_VEICULOS"]);
  conferir("receita caiu: não é este alerta", margemEmQueda(serie([100, 100, 100, 90], [10, 10, 10, 4], [30, 30, 30, 30])), null);
  conferir("margem caiu menos de 2 p.p.: sem alerta", margemEmQueda(serie([100, 100, 100, 100], [10, 10, 10, 8.5], [30, 30, 30, 31])), null);
  conferir("menos de quatro meses: sem comparação", margemEmQueda(serie([100, 100, 105], [10, 10, 5], [30, 30, 36])), null);
}

console.log("\n3. COBRANÇA DO DIA (hoje = 23/09)");
{
  const ctx = contexto({
    parceiros: [{ conexaoId: "cx1", codigoOmie: "A", email: "financeiro@a.com.br" }],
    titulos: [
      titulo({ dataVencimento: d("2026-09-23"), valorDocumentoCents: 10_000 }), // hoje
      titulo({ dataVencimento: d("2026-09-18"), valorDocumentoCents: 20_000 }), // 5 dias
      titulo({ parceiroNome: "Cliente B", parceiroCodigo: "B", dataVencimento: d("2026-09-22"), valorDocumentoCents: 30_000 }), // ontem
      titulo({ parceiroNome: "Cliente C", parceiroCodigo: "C", dataVencimento: d("2026-09-25"), valorDocumentoCents: 40_000 }), // em 2 dias
      titulo({ parceiroNome: "Cliente D", parceiroCodigo: "D", dataVencimento: d("2026-07-01"), valorDocumentoCents: 50_000 }), // 84 dias: aging
      titulo({ parceiroNome: "Cliente E", parceiroCodigo: "E", dataVencimento: d("2026-09-23"), liquidado: true }), // pago
      titulo({ parceiroNome: "MCZ", parceiroCodigo: "M", dataVencimento: d("2026-09-23"), parceiroDocumento: "99999999000100" }), // intercompany
      titulo({ natureza: "PAGAR", parceiroNome: "Fornecedor", dataVencimento: d("2026-09-23") }),
    ],
  });
  const lista = cobrancaDoDia(ctx);
  conferir("clientes na ordem: ontem, atraso 2–7, a vencer", lista.map((c) => [c.cliente, c.faixa]), [
    ["Cliente B", "VENCEU_ONTEM"],
    ["Cliente A", "ATRASO_2_7"],
    ["Cliente C", "VENCE_EM_BREVE"],
  ]);
  const a = lista.find((c) => c.cliente === "Cliente A")!;
  conferir("cliente A: dois títulos, o mais atrasado primeiro, com e-mail", [a.titulos.map((t) => t.dias), a.totalCents, a.email], [[5, 0], 30_000, "financeiro@a.com.br"]);
}

console.log("\n4. PREVISÃO DE FECHAMENTO");
{
  // Três meses fechados: receita 1.000, veículos 400, pessoas 300 → resultado 300.
  const serie: SerieDoDre = {
    meses: ["2026-06", "2026-07", "2026-08"],
    linhasDre: { RECEITA_BRUTA: [1000, 1000, 1000], DESPESA_VEICULOS: [400, 400, 400], DESPESA_SALARIOS: [300, 300, 300], RESULTADO_LIQUIDO: [300, 300, 300] },
  };
  // Lançado em setembro até agora: receita 1.200 (acima da média), veículos
  // 200 (abaixo), pessoas nada ainda.
  const lancado: DreDoMes = {
    linhas: [
      { chave: "RECEITA_BRUTA", tipo: "GRUPO", valorCents: 1200 },
      { chave: "DESPESA_VEICULOS", tipo: "GRUPO", valorCents: 200 },
    ],
    naoConfirmadoCents: 0,
    semCategoriaCents: 0,
  };
  const p = previsaoDoMes(lancado, serie, REF)!;
  conferir("receita prevista = o faturado (acima da média)", p.receitaLiquidaCents, 1200);
  conferir("resultado previsto = 1.200 − 400 − 300", p.resultadoCents, 500);
  conferir("resultado do que já está lançado", p.resultadoLancadoCents, 1000);
  conferir("média dos três meses", p.resultadoMedioCents, 300);
  conferir("dia 22 de 30", [p.mes, p.diaDoMes, p.diasNoMes], ["set/26", 22, 30]);
  conferir("sem histórico nem lançamento: nada", previsaoDoMes({ linhas: [], naoConfirmadoCents: 0, semCategoriaCents: 0 }, { meses: [], linhasDre: {} }, REF), null);
}

console.log(falhas === 0 ? "\nTodos os testes passaram." : `\n${falhas} FALHA(S).`);
process.exit(falhas === 0 ? 0 : 1);
