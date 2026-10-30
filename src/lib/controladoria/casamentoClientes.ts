import type { ContextoAuditoria } from "./types";
import type { Periodo } from "./periodos";
import { dentro } from "./periodos";
import { dataDeCompetencia } from "./competencia";
import { entraNoResultado } from "./intercompany";
import { documentoComparavel } from "./unitEconomics";

// CLIENTE DA GESTÃO × PARCEIRO DA OMIE, pelo CNPJ.
//
// O contrato operacional mora na gestão; quem paga mora na Omie. Esta é a
// conferência das duas pontas no mês do rateio: que cliente já casa, qual
// ainda não tem CNPJ (e por isso não recebe a receita sem de-para) e quem
// pagou a Azul sem existir como cliente na gestão. É a lista de trabalho
// para fechar a margem por contrato.

export type ClienteCasado = {
  id: string;
  nome: string;
  cnpj: string | null;
  nomesNaOmie: string[];
  receitaCents: number;
};
export type PagadorSemCliente = { documento: string; nome: string; empresas: string[]; receitaCents: number };

export function casarClientes(ctx: ContextoAuditoria, periodo: Periodo): { clientes: ClienteCasado[]; semCliente: PagadorSemCliente[] } {
  const naoEhIntragrupo = entraNoResultado(ctx);
  const porDocumento = new Map<string, { nomes: Set<string>; empresas: Set<string>; receita: number }>();
  for (const t of ctx.titulos) {
    if (t.natureza !== "RECEBER" || t.cancelado || !dentro(dataDeCompetencia(t), periodo) || !naoEhIntragrupo(t)) continue;
    const d = documentoComparavel(t.parceiroDocumento);
    if (d.length !== 14) continue;
    const g = porDocumento.get(d) ?? { nomes: new Set<string>(), empresas: new Set<string>(), receita: 0 };
    if (t.parceiroNome) g.nomes.add(t.parceiroNome.trim());
    g.empresas.add(t.conexaoApelido);
    g.receita += t.valorDocumentoCents;
    porDocumento.set(d, g);
  }
  // Parceiro cadastrado na Omie e ainda sem título no mês: o nome aparece
  // mesmo assim, para o casamento ser conferível antes da primeira fatura.
  const nomesDoCadastro = new Map<string, Set<string>>();
  for (const p of ctx.parceiros) {
    const d = documentoComparavel(p.documento);
    if (d.length !== 14) continue;
    nomesDoCadastro.set(d, (nomesDoCadastro.get(d) ?? new Set()).add(p.nome.trim()));
  }

  const usados = new Set<string>();
  const clientes = ctx.clientes
    .filter((c) => c.active)
    .map((c) => {
      const d = documentoComparavel(c.cnpj);
      const valido = d.length === 14;
      if (valido) usados.add(d);
      const g = valido ? porDocumento.get(d) : undefined;
      return {
        id: c.id,
        nome: c.nome,
        cnpj: valido ? d : null,
        nomesNaOmie: valido ? [...new Set([...(g?.nomes ?? []), ...(nomesDoCadastro.get(d) ?? [])])] : [],
        receitaCents: g?.receita ?? 0,
      };
    })
    .sort((a, b) => b.receitaCents - a.receitaCents || a.nome.localeCompare(b.nome));

  const semCliente = [...porDocumento]
    .filter(([d]) => !usados.has(d))
    .map(([documento, g]) => ({ documento, nome: [...g.nomes][0] ?? documento, empresas: [...g.empresas], receitaCents: g.receita }))
    .sort((a, b) => b.receitaCents - a.receitaCents);

  return { clientes, semCliente };
}
