import { cache } from "react";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import type { SessionPayload } from "@/lib/auth";
import { dataReferenciaPadrao } from "@/lib/controladoria/ciclo";
import { fimDoMes, inicioDoDia, rotuloMes } from "@/lib/controladoria/periodos";
import { carregarContexto, janelaDeAuditoria } from "@/lib/controladoria/contexto";
import type { ContextoAuditoria } from "@/lib/controladoria/types";
import { prisma } from "@/lib/prisma";
import { resolverAcesso, type AcessoResolvido, type Permissao } from "@/lib/acessos";

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
  // A PERMISSÃO VEM PRIMEIRO, e é obrigatória. Podia ser o último parâmetro,
  // opcional, e aí uma tela nova nasceria sem controle de acesso sem que nada
  // reclamasse. Sendo o primeiro e obrigatório, esquecer é erro de compilação.
  permissao: Permissao,
  empresaParam?: string,
  competenciaParam?: string,
  // Janela de leitura, quando a tela precisa de mais que a padrão. O DRE anual
  // é o caso: ele mostra doze meses, e a janela de auditoria não os cobre.
  // Fica como parâmetro, e não como padrão maior para todo mundo, porque
  // carregar um ano de títulos em toda tela foi o que já esgotou a franquia de
  // transferência do banco uma vez.
  desdeParam?: Date
): Promise<{
  session: SessionPayload;
  ctx: ContextoAuditoria;
  escopo: EscopoEmpresa;
  periodo: EscopoPeriodo;
}> {
  const session = await exigirPermissao(permissao);
  const escopo = await resolverEscopo(session.companyId, empresaParam);
  const periodo = resolverPeriodo(competenciaParam);
  const ctx = await carregarContexto(session.companyId, periodo.dataReferencia, escopo.conexaoId ?? undefined, {
    desde: desdeParam ?? janelaDeAuditoria(periodo.dataReferencia),
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

// OS ANOS que a base cobre, do mais recente para o mais antigo.
//
// Derivados da data de início configurada, e não das competências mensais:
// listar anos a partir da lista de meses obrigaria a montá-la só para
// descartá-la, e ela tem teto de 240 entradas por outro motivo.
//
// O ano CORRENTE não entra na lista — ele é a opção padrão do seletor, como o
// mês corrente é na visão mensal.
export function anosDisponiveis(dataInicioBase: Date, agora = new Date()): { valor: string; rotulo: string }[] {
  const anoAtual = agora.getFullYear();
  const opcoes: { valor: string; rotulo: string }[] = [];
  for (let ano = anoAtual - 1; ano >= dataInicioBase.getFullYear() && opcoes.length < 20; ano--) {
    opcoes.push({ valor: String(ano), rotulo: String(ano) });
  }
  return opcoes;
}

// Ano escolhido no seletor. Fora da faixa plausível cai no corrente, pelo mesmo
// motivo do filtro de mês: link velho ou colado errado não pode quebrar a tela.
export function resolverAno(param: string | undefined, agora = new Date()): number {
  const casa = /^(\d{4})$/.exec(param ?? "");
  if (!casa) return agora.getFullYear();
  const ano = Number(casa[1]);
  return ano >= 2000 && ano <= agora.getFullYear() ? ano : agora.getFullYear();
}

// O ACESSO EFETIVO da sessão — perfil quando há, papel quando não há.
//
// Uma resolução só, usada nas duas pontas: o menu decide o que MOSTRAR e a
// página decide se ABRE, ambos a partir daqui. Duas implementações da mesma
// regra divergem com o tempo, e as duas formas de divergir são ruins — item de
// menu que leva a "sem acesso" ensina a ignorar o menu; página que abre sem
// estar no menu é o buraco que a tela de perfis existe para fechar.
//
// `cache` do React: layout e página resolvem o acesso na mesma requisição, e
// sem isso seriam duas idas ao banco por tela carregada. A chave são os três
// campos em string, e não o objeto da sessão — `cache` compara por identidade,
// e bastaria alguém montar o objeto de novo num lugar para o cache virar
// enfeite silencioso.
const resolverAcessoDe = cache(async function resolverAcessoDe(
  userId: string,
  companyId: string,
  role: string
): Promise<AcessoResolvido> {
  const session = { userId, companyId, role };
  try {
    const atribuido = await prisma.usuarioPerfil.findUnique({
      where: { companyId_userId: { companyId: session.companyId, userId: session.userId } },
      select: { perfil: { select: { nome: true, permissoes: true } } },
    });
    if (atribuido?.perfil) return resolverAcesso(session.role, atribuido.perfil);

    // Sem perfil próprio, o padrão da empresa, se houver um marcado.
    const padrao = await prisma.perfilAcesso.findFirst({
      where: { companyId: session.companyId, padrao: true },
      select: { nome: true, permissoes: true },
    });
    return resolverAcesso(session.role, padrao);
  } catch {
    // Banco indisponível não pode virar apagão de acesso nem porta aberta: cai
    // nas regras de papel, que é exatamente o comportamento anterior a esta
    // camada existir.
    return resolverAcesso(session.role, null);
  }
});

export async function acessoDaSessao(session: {
  userId: string;
  companyId: string;
  role: string;
}): Promise<AcessoResolvido> {
  return resolverAcessoDe(session.userId, session.companyId, session.role);
}

// A PÁGINA SÓ ABRE PARA QUEM ALCANÇA AQUELA PERMISSÃO.
//
// Esconder o item do menu não é controle de acesso: a rota continua digitável,
// e num sistema que mostra o caixa do grupo isso é a diferença entre um recorte
// de perfil e uma sugestão de recorte. Toda página desta pasta chama isto ou
// `contextoDaPagina`, que chama por dentro.
//
// Destino é /sem-acesso, que não exige permissão nenhuma — redirecionar para
// uma rota que também exige criaria loop infinito, bug já visto neste código
// quando o destino era o painel.
export async function exigirPermissao(permissao: Permissao): Promise<SessionPayload> {
  const session = await sessaoControladoria();
  const acesso = await acessoDaSessao(session);
  if (!acesso.permissoes.has(permissao)) redirect("/sem-acesso");
  return session;
}

// A MESMA PERGUNTA, SEM DERRUBAR A PÁGINA — para decidir se um botão aparece.
//
// Botão e ação consultam esta função e a anterior, que leem a mesma resolução:
// é o que impede o par mais irritante que um sistema de permissão produz —
// botão visível que responde "sem acesso" ao ser clicado, ou botão escondido
// cuja ação continua aceitando o formulário de quem souber montá-lo.
export async function podeAcao(session: SessionPayload, permissao: Permissao): Promise<boolean> {
  const acesso = await acessoDaSessao(session);
  return acesso.permissoes.has(permissao);
}
