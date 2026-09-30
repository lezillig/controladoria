import type { ContextoAuditoria } from "./types";

// ELIMINAÇÃO DAS OPERAÇÕES ENTRE EMPRESAS DO GRUPO — o gêmeo em memória de
// `ehIntercompanySql` (escopoSql.ts). O porquê está lá; aqui só a regra, que
// tem de ser caractere por caractere a mesma, porque há teste diferencial
// exigindo que as colheitas em memória e em SQL devolvam o mesmo DRE:
//
//   - raiz = 8 primeiros dígitos do CNPJ de cada conexão (ativa ou não), só
//     quando o CNPJ cadastrado tem 14 dígitos; conexão sem CNPJ não contribui;
//   - o título é intercompany quando o documento do parceiro, como gravado
//     (a sincronização já grava só dígitos), tem 14 caracteres e começa por
//     uma dessas raízes;
//   - só vale na visão do GRUPO (`ctx.conexaoId` nulo) e só para números de
//     resultado — nunca para os agentes de auditoria.

export function raizesDoGrupo(conexoes: { cnpj: string | null }[]): string[] {
  const raizes = new Set<string>();
  for (const c of conexoes) {
    const digitos = (c.cnpj ?? "").replace(/\D/g, "");
    if (digitos.length === 14) raizes.add(digitos.slice(0, 8));
  }
  return [...raizes].sort();
}

export function ehIntercompany(documento: string | null | undefined, raizes: readonly string[]): boolean {
  return !!documento && documento.length === 14 && raizes.includes(documento.slice(0, 8));
}

// O predicado "este título entra no resultado desta leitura". Com uma empresa
// filtrada, todo título entra: a operação contra a outra empresa é receita e
// despesa de verdade daquela empresa.
export function entraNoResultado(ctx: Pick<ContextoAuditoria, "conexaoId" | "raizesCnpjDoGrupo">) {
  const raizes = ctx.conexaoId ? [] : (ctx.raizesCnpjDoGrupo ?? []);
  if (raizes.length === 0) return () => true;
  return (t: { parceiroDocumento: string | null }) => !ehIntercompany(t.parceiroDocumento, raizes);
}
