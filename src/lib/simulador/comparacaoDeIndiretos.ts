// A COMPARAÇÃO DOS INDIRETOS (regra nova × regra antiga), como a tela mostra.
//
// O mapa que vem do DRE (indiretosDoDre.ts) traz, lado a lado, as despesas
// indiretas e o FATURAMENTO médio — que não é despesa: é o divisor do rateio
// da administração central. A tabela somava as linhas todas, e o "Total"
// saía maior que a receita inteira: os indiretos mais o faturamento. Um
// número que não é custo nem receita, com cara de total.
//
// Aqui as duas coisas ficam separadas: o total é só das despesas, o
// faturamento aparece à parte, e a conta que interessa — indiretos ÷
// faturamento, que é o que vira o percentual de administração do preço —
// sai escrita, nas duas regras.

// A chave do faturamento médio no catálogo da base (catalogo.ts).
export const CHAVE_DO_FATURAMENTO = "faturamento_medio";

export type LinhaDeIndireto = { chave: string; rotulo: string; atual: number; antiga: number | null };

export type ComparacaoDeIndiretos = {
  // Só despesas: o faturamento não está aqui.
  linhas: LinhaDeIndireto[];
  total: { atual: number; antiga: number; diferenca: number };
  // Nulo quando o DRE não trouxe receita no período.
  faturamento: { atual: number; antiga: number | null } | null;
  // Indiretos ÷ faturamento, em fração (0,066 = 6,6%). Nulo sem faturamento.
  sobreFaturamento: { atual: number; antiga: number | null } | null;
};

// O catálogo guarda o rótulo cortado ("Sistemas (gestão de motoristas") porque
// ele é o prefixo que casa com a linha do Gabarito na importação. Na tela, o
// parêntese que ficou aberto é fechado.
export function rotuloParaTela(rotulo: string): string {
  const abertos = (rotulo.match(/\(/g) ?? []).length - (rotulo.match(/\)/g) ?? []).length;
  return abertos > 0 ? `${rotulo}…${")".repeat(abertos)}` : rotulo;
}

export function compararIndiretos(
  atual: Map<string, { valor: number }>,
  antiga: Map<string, { valor: number }>,
  rotuloDe: (chave: string) => string
): ComparacaoDeIndiretos {
  const linhas: LinhaDeIndireto[] = [...atual.entries()]
    .filter(([chave]) => chave !== CHAVE_DO_FATURAMENTO)
    .map(([chave, v]) => ({ chave, rotulo: rotuloParaTela(rotuloDe(chave)), atual: v.valor, antiga: antiga.get(chave)?.valor ?? null }));
  const totalAtual = linhas.reduce((a, l) => a + l.atual, 0);
  const totalAntiga = linhas.reduce((a, l) => a + (l.antiga ?? 0), 0);
  // Linha sem valor na regra antiga não entra na diferença: não há com o que
  // comparar, e contá-la inteira faria a regra nova parecer mais cara.
  const diferenca = linhas.reduce((a, l) => a + (l.antiga === null ? 0 : l.atual - l.antiga), 0);
  const fatAtual = atual.get(CHAVE_DO_FATURAMENTO)?.valor ?? null;
  const fatAntiga = antiga.get(CHAVE_DO_FATURAMENTO)?.valor ?? null;
  const temFaturamento = fatAtual !== null && fatAtual > 0;
  return {
    linhas,
    total: { atual: totalAtual, antiga: totalAntiga, diferenca },
    faturamento: temFaturamento ? { atual: fatAtual, antiga: fatAntiga } : null,
    sobreFaturamento: temFaturamento ? { atual: totalAtual / fatAtual, antiga: fatAntiga !== null && fatAntiga > 0 ? totalAntiga / fatAntiga : null } : null,
  };
}
