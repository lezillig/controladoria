import { chaveParceiro } from "./agents/comum";
import { competenciaAnterior, lerSeries } from "./historico";
import type { HistoricoDeCliente } from "./previsaoCaixa";
import type { ContextoAuditoria } from "./types";

// A SEGUNDA FONTE DA PREVISÃO DE CAIXA: 24 meses de resumo mensal por cliente.
//
// Separado de previsaoCaixa.ts de propósito: aquele arquivo é puro (recebe
// listas, devolve números) e é assim que os testes o exercitam. Este é o
// único que toca o banco, e traduz a chave do resumo (código do parceiro na
// conta Omie) para a chave que a previsão usa (CNPJ/CPF, que junta o mesmo
// cliente das duas empresas).

const MESES_DE_HISTORICO = 24;

export async function carregarHistoricoDeClientes(ctx: ContextoAuditoria): Promise<Map<string, HistoricoDeCliente>> {
  const ref = ctx.dataReferencia;
  const ate = `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, "0")}`;
  const series = await lerSeries({
    companyId: ctx.companyId,
    conexaoId: ctx.conexaoId,
    dimensao: "PARCEIRO",
    natureza: "RECEBER",
    de: competenciaAnterior(ate, MESES_DE_HISTORICO),
    ate,
  });
  if (series.length === 0) return new Map();

  // Código do parceiro → chave da previsão, pelos títulos do contexto. Um
  // código sem título no contexto não tem como ser traduzido e fica de fora —
  // e não faz falta: sem título em aberto, não há o que prever para ele.
  const chavePorCodigo = new Map<string, string>();
  for (const t of ctx.titulos) {
    if (t.natureza !== "RECEBER" || !t.parceiroCodigo) continue;
    chavePorCodigo.set(`${t.conexaoId}|${t.parceiroCodigo}`, chaveParceiro(t));
  }
  // O resumo não traz a conexão na série lida aqui; quando o mesmo código
  // existe nas duas contas com clientes diferentes, o segundo sobrescreveria
  // o primeiro. Traduzir por código sem conexão só quando o código é único.
  const porCodigo = new Map<string, string[]>();
  for (const [k, chave] of chavePorCodigo) {
    const codigo = k.split("|")[1];
    porCodigo.set(codigo, [...(porCodigo.get(codigo) ?? []), chave]);
  }

  const historico = new Map<string, HistoricoDeCliente>();
  for (const s of series) {
    const chaves = porCodigo.get(s.chave);
    if (!chaves || new Set(chaves).size !== 1) continue;
    const chave = chaves[0];
    const atual = historico.get(chave) ?? { nome: s.rotulo, baixas: 0, diasSoma: 0 };
    atual.baixas += s.baixas;
    atual.diasSoma += s.diasPagamentoSoma;
    if (!atual.nome && s.rotulo) atual.nome = s.rotulo;
    historico.set(chave, atual);
  }
  return historico;
}
