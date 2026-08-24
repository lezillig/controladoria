import { requireRole } from "@/lib/auth";
import type { SessionPayload } from "@/lib/auth";
import { dataReferenciaPadrao } from "@/lib/controladoria/ciclo";
import { fimDoMes, inicioDoDia, rotuloMes } from "@/lib/controladoria/periodos";
import { carregarContexto, janelaDeAuditoria } from "@/lib/controladoria/contexto";
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

// Competência escolhida na tela, no formato AAAA-MM. `null` significa a
// leitura corrente — D-1, o mesmo recorte que o ciclo diário e o relatório
// usam.
export type EscopoPeriodo = { competencia: string | null; dataReferencia: Date };

// Resolve o mês/ano vindo da querystring.
//
// Valor inválido, mês inexistente ou competência que ainda não terminou caem
// na leitura corrente em vez de erro — pelo mesmo motivo do filtro de empresa:
// link velho ou colado errado não deve quebrar a tela.
//
// A competência do mês CORRENTE cai no padrão de propósito. Apontar a data de
// referência para o fim de um mês que ainda não acabou produziria uma janela
// com metade dos dias vazia, e o painel mostraria isso como queda de receita —
// um número errado que parece um número certo, que é o pior tipo de erro num
// sistema de controladoria.
export function resolverPeriodo(competenciaParam?: string, agora = new Date()): EscopoPeriodo {
  const padrao = dataReferenciaPadrao(agora);
  const casa = /^(\d{4})-(\d{2})$/.exec(competenciaParam ?? "");
  if (!casa) return { competencia: null, dataReferencia: padrao };

  const ano = Number(casa[1]);
  const mes = Number(casa[2]);
  if (mes < 1 || mes > 12) return { competencia: null, dataReferencia: padrao };

  const fim = inicioDoDia(fimDoMes(new Date(ano, mes - 1, 1)));
  if (fim >= padrao) return { competencia: null, dataReferencia: padrao };
  return { competencia: `${casa[1]}-${casa[2]}`, dataReferencia: fim };
}

// As competências que a tela oferece: do início da base até o último mês
// FECHADO. O mês corrente não entra na lista porque ele já é a leitura padrão.
export function competenciasDisponiveis(
  dataInicioBase: Date,
  agora = new Date()
): { valor: string; rotulo: string }[] {
  const padrao = dataReferenciaPadrao(agora);
  const opcoes: { valor: string; rotulo: string }[] = [];

  let cursor = new Date(dataInicioBase.getFullYear(), dataInicioBase.getMonth(), 1);
  const limite = new Date(padrao.getFullYear(), padrao.getMonth(), 1);
  // Teto de segurança: base com data de início absurda (digitada errada na
  // configuração) não pode gerar um seletor com mil linhas.
  while (cursor < limite && opcoes.length < 240) {
    opcoes.push({
      valor: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`,
      rotulo: rotuloMes(cursor),
    });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return opcoes.reverse();
}

export async function contextoDaPagina(
  empresaParam?: string,
  competenciaParam?: string
): Promise<{
  session: SessionPayload;
  ctx: ContextoAuditoria;
  escopo: EscopoEmpresa;
  periodo: EscopoPeriodo;
}> {
  const session = await requireRole("ADMIN", "GESTOR", "CONTROLADORIA");
  const escopo = await resolverEscopo(session.companyId, empresaParam);
  const periodo = resolverPeriodo(competenciaParam);
  const ctx = await carregarContexto(session.companyId, periodo.dataReferencia, escopo.conexaoId ?? undefined, {
    desde: janelaDeAuditoria(periodo.dataReferencia),
  });
  return { session, ctx, escopo, periodo };
}

// Páginas que só precisam da sessão (listagens que consultam o banco direto,
// como relatórios e histórico) usam esta, evitando o custo de montar o contexto
// inteiro.
export async function sessaoControladoria(): Promise<SessionPayload> {
  return requireRole("ADMIN", "GESTOR", "CONTROLADORIA");
}

// REGIME DA LEITURA — competência ou caixa.
//
// Competência é o padrão: é a pergunta "a operação deu lucro no mês?", que é a
// razão de existir de um módulo de controladoria. Caixa responde "sobrou
// dinheiro?" — igualmente legítima, e é por isso que existe o seletor em vez de
// uma escolha embutida.
//
// Qualquer valor diferente de "caixa" cai em competência, inclusive lixo na
// querystring: um parâmetro digitado errado não pode virar uma terceira
// leitura silenciosa.
export function resolverRegime(param?: string): "competencia" | "caixa" {
  return param === "caixa" ? "caixa" : "competencia";
}
