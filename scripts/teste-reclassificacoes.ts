// RECLASSIFICAÇÕES SUGERIDAS E CATÁLOGO DE SUBGRUPOS — `npm run teste:reclassificacoes`.
//
// Os casos são categorias reais do DRE da Azul (out/2025–set/2026): cada um
// confere de onde a categoria sai, para onde vai e com que subgrupo, e os
// casos de ordem em que a primeira regra que casa decide.
import { sugestoesDeReclassificacao, acoesNoOmie, regraPara, type CategoriaParaRevisao } from "../src/lib/controladoria/reclassificacoes";
import { CATALOGO_SUBGRUPOS, naturezaDoSubgrupo, sugerirSubgrupo } from "../src/lib/controladoria/subgrupos";
import { LINHAS_CLASSIFICAVEIS } from "../src/lib/controladoria/dre";

let falhas = 0;
function ok(nome: string, passou: boolean, detalhe = "") {
  if (!passou) falhas++;
  console.log(`  ${passou ? "ok  " : "FALHA"} ${nome}${passou || !detalhe ? "" : ` — ${detalhe}`}`);
}

const cat = (codigo: string, descricao: string, linha: string, valor = 100_000, subgrupo: string | null = null): CategoriaParaRevisao => ({
  codigo,
  descricao,
  linha,
  subgrupo,
  confirmada: true,
  valorCents: valor,
});
const para = (descricao: string, linha: string) => {
  const r = regraPara({ descricao, linha });
  return r ? r.para : linha;
};

console.log("MUDANÇAS DE LINHA (de → para)");
const casos: [string, string, string][] = [
  ["Capital de Giro", "RECEITA_BRUTA", "FINANCIAMENTO_INVESTIMENTO"],
  ["Devolução de empréstimo", "RECEITA_BRUTA", "FINANCIAMENTO_INVESTIMENTO"],
  ["Desconto de Duplicatas", "RECEITA_BRUTA", "FINANCIAMENTO_INVESTIMENTO"],
  ["Venda de pneu · AZUL", "RECEITA_BRUTA", "OUTRAS_RECEITAS"],
  ["Dividendos Recebidos", "RECEITA_BRUTA", "RECEITA_FINANCEIRA"],
  ["Venda de Veículos · AZUL", "OUTRAS_RECEITAS", "FINANCIAMENTO_INVESTIMENTO"],
  ["Empréstimo · AZUL", "OUTRAS_RECEITAS", "FINANCIAMENTO_INVESTIMENTO"],
  ["Empréstimo", "DESPESA_FINANCEIRA", "FINANCIAMENTO_INVESTIMENTO"],
  ["Capital de Giro · AZUL", "DESPESA_FINANCEIRA", "FINANCIAMENTO_INVESTIMENTO"],
  ["Sócios - Retirada de Valor", "DESPESA_SOCIOS", "DISTRIBUICAO_LUCROS"],
  ["Adiantamento de Distribuição de Lucro · AZUL", "DESPESA_SOCIOS", "DISTRIBUICAO_LUCROS"],
  ["Transformação de veículos", "DESPESA_VEICULOS", "FINANCIAMENTO_INVESTIMENTO"],
  ["Advogados", "DESPESA_SERVICOS_TERCEIROS", "DESPESA_ADMINISTRATIVA"],
  ["Baixa 100% de Desconto", "CUSTO_SERVICO", "DEDUCOES"],
  ["1124 - Parcelamento Simplificado", "DESPESA_GERAL", "FINANCIAMENTO_INVESTIMENTO"],
  ["Aluguel de Veículo", "DESPESA_VEICULOS", "DESPESA_SERVICOS_TERCEIROS"],
  ["Aluguel Garagem", "DESPESA_SALARIOS", "DESPESA_VEICULOS"],
  ["Uber - Táxi", "DESPESA_GERAL", "DESPESA_SALARIOS"],
  ["Taxa DTP · AZUL", "DEDUCOES", "DESPESA_VEICULOS"],
  ["Contabilidade", "DESPESA_ESTRUTURA", "DESPESA_ADMINISTRATIVA"],
];
for (const [descricao, de, esperado] of casos) ok(`${descricao}: ${de} → ${esperado}`, para(descricao, de) === esperado, para(descricao, de));

console.log("\nO QUE NÃO MUDA");
ok("juros sobre empréstimos continuam despesa financeira", para("Juros sobre Empréstimos", "DESPESA_FINANCEIRA") === "DESPESA_FINANCEIRA");
ok("cartão de crédito não muda de linha (pede ação no Omie)", para("Cartão de Crédito", "DESPESA_FINANCEIRA") === "DESPESA_FINANCEIRA");
ok("receita de serviço continua receita", para("Clientes - Serviços Prestados", "RECEITA_BRUTA") === "RECEITA_BRUTA");
ok("comissão do contrato da Enforce é custo direto de contrato (não se rateia)", para("Comissão · AZUL", "DESPESA_VEICULOS") === "CUSTO_SERVICO");
ok("toldos e gerador são de contratos específicos, não estrutura", para("Toldos e Coberturas", "DESPESA_VEICULOS") === "CUSTO_SERVICO" && para("Aluguel de Gerador", "DESPESA_VEICULOS") === "CUSTO_SERVICO");
ok("vistoria de garagem continua estrutura", para("Vistoria de Garagem e/ou instalações da Empresa", "DESPESA_VEICULOS") === "DESPESA_ESTRUTURA");
ok("natureza: custo direto de contrato", naturezaDoSubgrupo("CUSTO_SERVICO", "Custo direto de contrato específico") === "C");
ok("pró-labore continua em sócios", para("Pró-labore", "DESPESA_SOCIOS") === "DESPESA_SOCIOS");
ok("regra só vale para a linha de origem dela: combustível em veículos fica", para("Combustível", "DESPESA_VEICULOS") === "DESPESA_VEICULOS");
ok("venda de veículo já em financiamentos não gera sugestão", regraPara({ descricao: "Venda de Veículos", linha: "FINANCIAMENTO_INVESTIMENTO" }) === null);

console.log("\nSUGESTÕES");
const lista = sugestoesDeReclassificacao([
  cat("1.01.02", "Clientes - Serviços Prestados", "RECEITA_BRUTA", 78_000_000),
  cat("2.04.78", "Sócios - Retirada de Valor", "DESPESA_SOCIOS", 2_400_000),
  cat("2.10.99", "Combustível", "DESPESA_VEICULOS", 7_000_000),
  cat("2.10.90", "Peças, Equipamentos e Acessórios", "DESPESA_VEICULOS", 1_500_000, "Manutenção e peças"),
  cat("RETENCAO_NA_FONTE", "Tributos retidos na fonte pelos clientes", "DEDUCOES", 5_000_000),
]);
ok("mudança de linha vem antes de subgrupo", lista[0]?.tipo === "LINHA" && lista[0].codigo === "2.04.78");
ok("de e para com subgrupo", lista[0]?.de.linha === "DESPESA_SOCIOS" && lista[0]?.para.linha === "DISTRIBUICAO_LUCROS" && lista[0]?.para.subgrupo === "Retiradas dos sócios");
ok("sem subgrupo ganha o do catálogo", lista.some((s) => s.codigo === "2.10.99" && s.tipo === "SUBGRUPO" && s.para.subgrupo === "Combustível"));
ok("quem já tem subgrupo não é tocado", !lista.some((s) => s.codigo === "2.10.90"));
ok("retenção calculada não é categoria", !lista.some((s) => s.codigo === "RETENCAO_NA_FONTE"));
ok("receita genérica sem segmento não ganha subgrupo inventado", !lista.some((s) => s.codigo === "1.01.02"));
const omie = acoesNoOmie([cat("a", "Cartão de Crédito", "DESPESA_FINANCEIRA"), cat("b", "Estorno de Cartão de Crédito", "OUTRAS_RECEITAS"), cat("c", "Compra de Serviços", "DESPESA_SERVICOS_TERCEIROS")]);
ok("ação no Omie: cartão e compra de serviços, não o estorno", omie.map((o) => o.codigo).sort().join() === "a,c");

console.log("\nCATÁLOGO");
ok("todo subgrupo do catálogo está numa linha classificável", CATALOGO_SUBGRUPOS.every((c) => (LINHAS_CLASSIFICAVEIS as readonly string[]).includes(c.linha)));
ok("nomes únicos por linha", CATALOGO_SUBGRUPOS.every((c, i) => CATALOGO_SUBGRUPOS.findIndex((x) => x.linha === c.linha && x.nome === c.nome) === i));
ok("FGTS rescisório é rescisão antes de ser encargo", sugerirSubgrupo("DESPESA_SALARIOS", "FGTS Rescisório") === "13º, férias e rescisões");
ok("FGTS é encargo", sugerirSubgrupo("DESPESA_SALARIOS", "FGTS") === "Encargos (INSS e FGTS)");
ok("licenciamento+DPVAT+IPVA+multas é IPVA, não multa", sugerirSubgrupo("DESPESA_VEICULOS", "Licenciamento+DPVAT+IPVA+Multas") === "IPVA, licenciamento e despachante");
ok("sistema de multas é monitoramento", sugerirSubgrupo("DESPESA_VEICULOS", "Sistema de multas Frota") === "Monitoramento e sistemas de frota");
ok("seguro de vida é benefício, seguro de veículo é frota", sugerirSubgrupo("DESPESA_SALARIOS", "Seguro de Vida") === "Benefícios" && sugerirSubgrupo("DESPESA_VEICULOS", "Seguro Veículos APP") === "Seguro de frota");
ok("natureza: combustível é variável por km", naturezaDoSubgrupo("DESPESA_VEICULOS", "Combustível") === "V");
ok("natureza: salários na operação é mão de obra direta", naturezaDoSubgrupo("DESPESA_SALARIOS", "Salários e horas extras") === "M");
ok("natureza: salários no corporativo é indireto", naturezaDoSubgrupo("DESPESA_SALARIOS_CORPORATIVO", "Salários e horas extras") === "I");
ok("natureza: subgrupo fora do catálogo não tem", naturezaDoSubgrupo("DESPESA_VEICULOS", "Frota leve") === null);

console.log(falhas === 0 ? "\nTodos os testes passaram." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
