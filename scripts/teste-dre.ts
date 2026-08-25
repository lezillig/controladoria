// TESTES DO DRE — `npm run teste:dre`.
//
// A aritmética de um DRE é a parte que ninguém confere de olho: os subtotais
// encadeiam, e um sinal trocado no meio fecha o resultado líquido certo com o
// lucro bruto errado. É exatamente o erro que passa numa reunião.
import { montarDre, proporLinha } from "../src/lib/controladoria/dre";
import type { ContextoAuditoria } from "../src/lib/controladoria/types";

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
const MES = { inicio: d("2026-07-01"), fim: d("2026-07-31T23:59:59"), rotulo: "jul" };
const ANT = { inicio: d("2026-06-01"), fim: d("2026-06-30T23:59:59"), rotulo: "jun" };

let seq = 0;
const tit = (natureza: "PAGAR" | "RECEBER", cat: string, reais: number, mes = "07") =>
  ({
    id: `t${++seq}`, companyId: "c", conexaoId: "x", conexaoApelido: "AZUL",
    natureza, codigoLancamento: `L${seq}`, cancelado: false, status: "Pago",
    categoriaCodigo: cat, parceiroNome: "X", parceiroDocumento: null, parceiroCodigo: null,
    contaCorrenteCodigo: null, numeroDocumento: null, tipoDocumento: null,
    dataEmissao: d(`2026-${mes}-10`), dataVencimento: d(`2026-${mes}-20`),
    valorDocumentoCents: Math.round(reais * 100), valorPagoCents: 0,
    jurosCents: 0, multaCents: 0, descontoCents: 0, tarifaCents: 0,
  }) as unknown as ContextoAuditoria["titulos"][number];

const cat = (codigo: string, descricao: string, receita = false) =>
  ({ codigo, descricao, natureza: receita ? "R" : "D", contaReceita: receita, contaDespesa: !receita,
     totalizadora: false, inativa: false, codigoDre: null, tipoCategoria: null }) as unknown as
    ContextoAuditoria["categorias"][number];

const ctx = (titulos: unknown[], categorias: unknown[]) =>
  ({ companyId: "c", conexaoId: null, dataReferencia: d("2026-08-01"), agora: d("2026-08-01"),
     janelaDesde: d("2026-01-01"), titulos, categorias, baixas: [], movimentos: [], notas: [],
     parceiros: [], departamentos: [], contasCorrentes: [], vinculos: [], motoristas: [],
     config: {} }) as unknown as ContextoAuditoria;

const cls = (m: Record<string, [string, string | null, boolean]>) =>
  new Map(Object.entries(m).map(([k, [linha, subgrupo, confirmada]]) => [k, { linha, subgrupo, confirmada }]));

// ------------------------------------------------------ encadeamento
console.log("\n1. A cadeia de subtotais");
{
  const r = montarDre(
    ctx(
      [
        tit("RECEBER", "1", 1_000_000),  // receita bruta
        tit("PAGAR", "2", 150_000),      // deduções (impostos s/ faturamento)
        tit("PAGAR", "3", 400_000),      // custo do serviço
        tit("PAGAR", "4", 100_000),      // despesa administrativa
        tit("RECEBER", "5", 10_000),     // receita financeira
        tit("PAGAR", "6", 30_000),       // despesa financeira
        tit("PAGAR", "7", 50_000),       // IRPJ/CSLL
      ],
      [cat("1", "Serviços", true), cat("2", "ISS"), cat("3", "Combustível"), cat("4", "Contabilidade"),
       cat("5", "Rendimento de aplicação", true), cat("6", "Juros bancários"), cat("7", "IRPJ")]
    ),
    MES, ANT,
    cls({
      "1": ["RECEITA_BRUTA", null, true], "2": ["DEDUCOES", null, true],
      "3": ["CUSTO_SERVICO", "Frota", true], "4": ["DESPESA_ADMINISTRATIVA", "Sede", true],
      "5": ["RECEITA_FINANCEIRA", null, true], "6": ["DESPESA_FINANCEIRA", null, true],
      "7": ["TRIBUTO_SOBRE_LUCRO", null, true],
    })
  );
  const v = (c: string) => r.linhas.find((l) => l.chave === c)?.valorCents;

  conferir("receita bruta", v("RECEITA_BRUTA"), 100_000_000);
  conferir("deduções", v("DEDUCOES"), 15_000_000);
  conferir("receita líquida = bruta − deduções", v("RECEITA_LIQUIDA"), 85_000_000);
  conferir("lucro bruto = líquida − custo", v("LUCRO_BRUTO"), 45_000_000);
  conferir("EBIT = lucro bruto − despesas", v("EBIT"), 35_000_000);
  conferir("resultado antes dos investimentos = EBIT + rec.fin − desp.fin", v("LAIR"), 33_000_000);
  conferir("resultado líquido = − financiamentos − IRPJ/CSLL", v("RESULTADO_LIQUIDO"), 28_000_000);
  conferir("margem líquida sobre a RECEITA LÍQUIDA", Math.round(r.margemLiquidaPercent!  * 100) / 100, 32.94);
  conferir("nada por confirmar", r.naoConfirmadoCents, 0);
}

// ------------------------------------------------------ estorno
console.log("\n2. Estorno: despesa com valor negativo");
{
  const r = montarDre(
    ctx([tit("RECEBER", "1", 100_000), tit("PAGAR", "3", 50_000), tit("PAGAR", "3", -20_000)],
        [cat("1", "Serviços", true), cat("3", "Combustível")]),
    MES, ANT,
    cls({ "1": ["RECEITA_BRUTA", null, true], "3": ["CUSTO_SERVICO", null, true] })
  );
  const v = (c: string) => r.linhas.find((l) => l.chave === c)?.valorCents;
  // 50.000 e −20.000 somam 30.000 na categoria; o módulo é aplicado no TOTAL
  // da linha, não em cada título — senão o estorno viraria mais custo.
  conferir("estorno reduz o custo, não aumenta", v("CUSTO_SERVICO"), 3_000_000);
  conferir("lucro bruto reflete o estorno", v("LUCRO_BRUTO"), 7_000_000);
}

// ------------------------------------------------------ sem categoria
console.log("\n3. Título sem categoria fica FORA da demonstração");
{
  const r = montarDre(
    ctx([tit("RECEBER", "1", 100_000), { ...tit("PAGAR", "1", 40_000), categoriaCodigo: null } as never],
        [cat("1", "Serviços", true)]),
    MES, ANT,
    cls({ "1": ["RECEITA_BRUTA", null, true] })
  );
  conferir("não entra em nenhuma linha", r.linhas.find((l) => l.chave === "DESPESA_GERAL")?.valorCents, 0);
  conferir("mas é reportado à parte", r.semCategoriaCents, 4_000_000);
}

// ------------------------------------------------------ não confirmado
console.log("\n4. Categoria sem classificação humana");
{
  const r = montarDre(
    ctx([tit("RECEBER", "1", 100_000), tit("PAGAR", "9", 30_000)],
        [cat("1", "Serviços", true), cat("9", "Peças e manutenção")]),
    MES, ANT,
    cls({ "1": ["RECEITA_BRUTA", null, true] })
  );
  conferir("proposta cai em 'outras despesas', que não move lucro bruto",
    r.linhas.find((l) => l.chave === "DESPESA_GERAL")?.valorCents, 3_000_000);
  conferir("lucro bruto intacto", r.linhas.find((l) => l.chave === "LUCRO_BRUTO")?.valorCents, 10_000_000);
  conferir("e o volume por confirmar é anunciado", r.naoConfirmadoCents, 3_000_000);
}

// ------------------------------------------------------ subgrupos
console.log("\n5. Subgrupos dentro da linha");
{
  const r = montarDre(
    ctx([tit("PAGAR", "3", 40_000), tit("PAGAR", "4", 25_000), tit("PAGAR", "5", 10_000)],
        [cat("3", "Combustível"), cat("4", "Pneus"), cat("5", "Motoristas")]),
    MES, ANT,
    cls({ "3": ["CUSTO_SERVICO", "Frota", true], "4": ["CUSTO_SERVICO", "Frota", true],
          "5": ["CUSTO_SERVICO", "Pessoal operacional", true] })
  );
  const linha = r.linhas.find((l) => l.chave === "CUSTO_SERVICO")!;
  conferir("dois subgrupos", linha.subgrupos.map((s) => s.nome), ["Frota", "Pessoal operacional"]);
  conferir("Frota soma combustível + pneus", linha.subgrupos[0].valorCents, 6_500_000);
  conferir("subgrupos somam a linha", linha.subgrupos.reduce((a, s) => a + s.valorCents, 0), linha.valorCents);
}

// ------------------------------------------- financiamentos e consórcios
console.log("\n10. Financiamento e consórcio abaixo do resultado da operação");
{
  const r = montarDre(
    ctx([tit("RECEBER", "1", 100_000), tit("PAGAR", "2", 30_000), tit("PAGAR", "3", 5_000)],
        [cat("1", "Serviços", true), cat("2", "Consórcio de Veículos"), cat("3", "Juros de financiamento")]),
    MES, ANT, cls({})
  );
  const v = (c: string) => r.linhas.find((l) => l.chave === c)?.valorCents;
  conferir("consórcio não afeta o resultado da operação", v("LAIR"), 10_000_000 - 500_000);
  conferir("mas entra no resultado líquido", v("RESULTADO_LIQUIDO"), 10_000_000 - 500_000 - 3_000_000);
  conferir("e os juros ficaram em financeiras", v("DESPESA_FINANCEIRA"), 500_000);
}

// -------------------------------------------- outras receitas operacionais
console.log("\n9. Entrada que NÃO é faturamento");
{
  // Os cinco casos reais do print: todos estavam dentro da receita bruta.
  const cats = [
    cat("1", "Clientes - Serviços Prestados", true),
    cat("2", "Venda de Veículos", true),
    cat("3", "Resgate Consórcio", true),
    cat("4", "Lucros Cessantes", true),
    cat("5", "Reembolso de multa de trânsito", true),
    cat("6", "Pagamento Convênio Médico", true),
  ];
  const r = montarDre(
    ctx([tit("RECEBER", "1", 7_039_183.80), tit("RECEBER", "2", 5_000), tit("RECEBER", "3", 47_575),
         tit("RECEBER", "4", 4_508), tit("RECEBER", "5", 703.68), tit("RECEBER", "6", 770.70)], cats),
    MES, ANT, cls({})
  );
  const v = (c: string) => r.linhas.find((l) => l.chave === c)?.valorCents;
  conferir("só o serviço fica na receita bruta", v("RECEITA_BRUTA"), 703_918_380);
  conferir("as outras cinco saem para outras receitas", v("OUTRAS_RECEITAS"), 5_855_738);
  // 5.000 + 47.575 + 4.508 + 703,68 + 770,70 = 58.557,38
  conferir("e o EBIT continua somando todas", v("EBIT"), 703_918_380 + 5_855_738);
}

// ------------------------------------------------------ regressão
console.log("\n7. REGRESSÃO — a receita que foi parar em despesas");
{
  // O caso real: "Clientes - Serviços Prestados", R$ 7,3 milhões, apareceu em
  // "outras despesas operacionais" com a receita bruta zerada. Cadastro sem
  // `natureza` e sem `conta_receita` — que é o estado da base antes da próxima
  // sincronização de cadastros, e o estado que o diagnóstico já reportava.
  const semSinal = { codigo: "1", descricao: "Clientes - Serviços Prestados", natureza: null,
    contaReceita: false, contaDespesa: false, totalizadora: false, inativa: false,
    codigoDre: null, tipoCategoria: null } as unknown as ContextoAuditoria["categorias"][number];

  const r = montarDre(
    ctx([tit("RECEBER", "1", 7_355_783.80), tit("PAGAR", "2", 738_486.80)],
        [semSinal, cat("2", "Combustível")]),
    MES, ANT, cls({})
  );
  const v = (c: string) => r.linhas.find((l) => l.chave === c)?.valorCents;
  conferir("receita bruta reconhecida pelo LADO DO TÍTULO", v("RECEITA_BRUTA"), 735_578_380);
  conferir("não foi parar em despesas", v("DESPESA_GERAL"), 73_848_680);
  conferir("e a receita líquida deixa de ser negativa", v("RECEITA_LIQUIDA")! > 0, true);
}

// ------------------------------------------------------ drill-down
console.log("\n8. Drill-down");
{
  const r = montarDre(
    ctx([tit("PAGAR", "2", 1_000), tit("PAGAR", "2", 5_000), tit("PAGAR", "2", 300)],
        [cat("2", "Combustível")]),
    MES, ANT, cls({ "2": ["CUSTO_SERVICO", null, true] })
  );
  const item = r.linhas.find((l) => l.chave === "CUSTO_SERVICO")!.itens[0];
  conferir("traz os títulos da categoria", item.titulos.length, 3);
  conferir("do maior para o menor", item.titulos.map((t) => t.valorCents), [500_000, 100_000, 30_000]);
  conferir("e diz o total", item.totalDeTitulos, 3);
}

// ------------------------------------------------------ proposta
console.log("\n6. Proposta automática — conservadora de propósito");
{
  const p = (desc: string, receita = false) =>
    proporLinha({ descricao: desc, natureza: receita ? "R" : "D", contaReceita: receita, contaDespesa: !receita });
  conferir("receita de serviço", p("Serviços prestados", true), "RECEITA_BRUTA");
  conferir("o MOVIMENTO manda sobre o cadastro",
    proporLinha({ descricao: "Clientes - Serviços Prestados", natureza: null, contaReceita: false, contaDespesa: true },
      { receberCents: 100, pagarCents: 0 }), "RECEITA_BRUTA");
  conferir("rendimento de aplicação é financeira", p("Rendimento de Aplicação", true), "RECEITA_FINANCEIRA");
  conferir("ISS é dedução", p("ISS sobre serviços"), "DEDUCOES");
  // Lucro Presumido: a base é presumida sobre a receita, então os dois se
  // comportam como percentual do faturamento — decisão da empresa, registrada.
  conferir("IRPJ é dedução da receita (lucro presumido)", p("IRPJ a recolher"), "DEDUCOES");
  conferir("CSLL também", p("CSLL"), "DEDUCOES");
  conferir("consórcio de frota é investimento", p("Consórcio de Veículos"), "FINANCIAMENTO_INVESTIMENTO");
  conferir("parcela de financiamento também", p("Financiamento de Veículos"), "FINANCIAMENTO_INVESTIMENTO");
  // A ordem importa: juros de financiamento é despesa financeira, não
  // investimento — é onde a contabilidade os coloca.
  conferir("mas os JUROS ficam em financeiras", p("Juros de financiamento"), "DESPESA_FINANCEIRA");
  conferir("tarifa bancária é financeira", p("Tarifas Bancárias"), "DESPESA_FINANCEIRA");
  conferir("COMBUSTÍVEL NÃO é adivinhado como custo", p("Combustível"), "DESPESA_GERAL");
  conferir("nem folha", p("Salários e ordenados"), "DESPESA_GERAL");
}

console.log(falhas === 0 ? "\nTodos os testes passaram.\n" : `\n${falhas} FALHA(S).\n`);
process.exit(falhas === 0 ? 0 : 1);
