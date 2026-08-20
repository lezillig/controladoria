import { requireRole } from "@/lib/auth";
import type { SessionPayload } from "@/lib/auth";
import { dataReferenciaPadrao } from "@/lib/controladoria/ciclo";
import { carregarContexto } from "@/lib/controladoria/contexto";
import type { ContextoAuditoria } from "@/lib/controladoria/types";
import { prisma } from "@/lib/prisma";

// Porta de entrada única das telas.
//
// Duas coisas ficam aqui, e não repetidas em cada página: (1) a checagem de
// permissão — esquecer o requireRole numa única rota abriria o financeiro do
// grupo para qualquer usuário autenticado; (2) o carregamento do contexto, que
// é exatamente o MESMO que os agentes e o relatório usam. Se a tela montasse os
// números por conta própria, uma divergência entre o painel e o e-mail seria só
// questão de tempo — e bastaria uma para o usuário perder a confiança no
// sistema inteiro.

export type EscopoEmpresa = { conexaoId: string | null; apelido: string | null };

// Resolve o filtro de empresa vindo da querystring. Um id inexistente ou de
// outra empresa cai no consolidado em vez de erro: link velho ou colado errado
// não deve quebrar a tela, e mostrar o grupo inteiro nunca é resposta errada —
// só mais ampla.
export async function resolverEscopo(companyId: string, empresaParam?: string): Promise<EscopoEmpresa> {
  if (!empresaParam) return { conexaoId: null, apelido: null };
  const conexao = await prisma.omieConexao.findFirst({
    where: { id: empresaParam, companyId },
    select: { id: true, apelido: true },
  });
  return conexao ? { conexaoId: conexao.id, apelido: conexao.apelido } : { conexaoId: null, apelido: null };
}

export async function contextoDaPagina(empresaParam?: string): Promise<{
  session: SessionPayload;
  ctx: ContextoAuditoria;
  escopo: EscopoEmpresa;
}> {
  const session = await requireRole("ADMIN", "GESTOR", "CONTROLADORIA");
  const escopo = await resolverEscopo(session.companyId, empresaParam);
  const ctx = await carregarContexto(session.companyId, dataReferenciaPadrao(), escopo.conexaoId ?? undefined);
  return { session, ctx, escopo };
}

// Páginas que só precisam da sessão (listagens que consultam o banco direto,
// como relatórios e histórico) usam esta, evitando o custo de montar o contexto
// inteiro.
export async function sessaoControladoria(): Promise<SessionPayload> {
  return requireRole("ADMIN", "GESTOR", "CONTROLADORIA");
}
