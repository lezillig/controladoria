import { canManageControladoria, canViewControladoria } from "./permissions";

// O QUE CADA PESSOA ALCANÇA DENTRO DA CONTROLADORIA.
//
// A IDENTIDADE continua vindo do sistema de gestão — quem entra, com que senha
// e se ainda está ativo. Este arquivo trata só de AUTORIZAÇÃO: quais telas e
// quais ações. São coisas diferentes e a separação é o que mantém a segurança:
// desativar alguém na gestão continua tirando o acesso ao financeiro no mesmo
// ato, inclusive de sessão já aberta.
//
// POR QUE OS PAPÉIS DA FROTA NÃO BASTAM. São cinco — ADMIN, GESTOR,
// CONTROLADORIA, FOLHA, MOTORISTA — e descrevem a operação de transporte, não a
// controladoria. Não há como expressar "vê o DRE mas não trata achado" ou "só
// olha conformidade" criando papel de motorista. Perfil é a peça que faltava.
//
// SEM PERFIL ATRIBUÍDO, VALEM AS REGRAS DE PAPEL de sempre. Ninguém perde nem
// ganha acesso no dia em que isto sobe — o que passa a existir é a
// possibilidade de ajustar.

export type Permissao = (typeof PERMISSOES)[number]["chave"];

// O catálogo. Uma entrada por tela, mais as AÇÕES que mudam estado — e as
// ações ficam separadas da tela de propósito: num sistema de auditoria, "ver o
// achado" e "poder desligar o alerta" não podem ser a mesma permissão, senão
// dar acesso de leitura a alguém dá junto o poder de apagar o que incomoda.
export const PERMISSOES = [
  { chave: "painel", rotulo: "Painel financeiro", grupo: "Telas" },
  { chave: "resultados", rotulo: "Resultado mês a mês", grupo: "Telas" },
  { chave: "custos", rotulo: "Custos e DRE", grupo: "Telas" },
  { chave: "titulos", rotulo: "Contas a pagar e receber", grupo: "Telas" },
  { chave: "fluxo-caixa", rotulo: "Fluxo de caixa", grupo: "Telas" },
  { chave: "conciliacao", rotulo: "Conciliação bancária", grupo: "Telas" },
  { chave: "rentabilidade", rotulo: "Rentabilidade por contrato", grupo: "Telas" },
  { chave: "auditoria", rotulo: "Auditoria e achados", grupo: "Telas" },
  { chave: "conformidade", rotulo: "Conformidade", grupo: "Telas" },
  { chave: "cte", rotulo: "Conferência de CT-e", grupo: "Telas" },
  { chave: "bsc", rotulo: "Balanced Scorecard", grupo: "Telas" },
  { chave: "relatorios", rotulo: "Relatórios diários", grupo: "Telas" },
  { chave: "sincronizacao", rotulo: "Sincronização", grupo: "Telas" },
  { chave: "conexoes", rotulo: "Conexões Omie", grupo: "Telas" },

  { chave: "tratar-achado", rotulo: "Tratar achado de auditoria", grupo: "Ações" },
  { chave: "classificar-dre", rotulo: "Classificar categorias do DRE", grupo: "Ações" },
  { chave: "conferir-cte", rotulo: "Conferir lista de CT-e", grupo: "Ações" },
  { chave: "gerir-bsc", rotulo: "Definir metas do Balanced Scorecard", grupo: "Ações" },
  { chave: "gerir-rentabilidade", rotulo: "Editar custos e premissas por contrato", grupo: "Ações" },
  { chave: "gerir-conformidade", rotulo: "Lançar e tratar conformidade", grupo: "Ações" },
  { chave: "sincronizar", rotulo: "Disparar sincronização e relatório", grupo: "Ações" },
  { chave: "gerir-conexoes", rotulo: "Cadastrar conexões Omie", grupo: "Ações" },
  { chave: "gerir-modelo", rotulo: "Alterar o modelo de gestão", grupo: "Ações" },
  { chave: "gerir-usuarios", rotulo: "Criar usuários e definir perfis", grupo: "Ações" },
] as const;

export const ROTULO_PERMISSAO: Record<string, string> = Object.fromEntries(
  PERMISSOES.map((p) => [p.chave, p.rotulo])
);

export const GRUPOS_DE_PERMISSAO = ["Telas", "Ações"] as const;

// AS PERMISSÕES QUE UM PAPEL DA FROTA CONCEDE, quando não há perfil.
//
// Reproduz exatamente o que o sistema já fazia antes de existir perfil — é o
// contrato de "nada muda no dia em que isto sobe". Qualquer diferença aqui
// seria uma mudança de acesso silenciosa, aplicada a todo mundo de uma vez, e
// numa tela de financeiro isso é a pior categoria de defeito.
export function permissoesDoPapel(role: string): Permissao[] {
  if (!canViewControladoria(role)) return [];

  const telas = PERMISSOES.filter((p) => p.grupo === "Telas").map((p) => p.chave);
  if (!canManageControladoria(role)) {
    // GESTOR: lê tudo, não muda nada. Era assim antes e continua.
    return [...telas];
  }
  return [...telas, ...PERMISSOES.filter((p) => p.grupo === "Ações").map((p) => p.chave)];
}

export type AcessoResolvido = {
  permissoes: Set<string>;
  // De onde veio a autorização. A tela de usuários mostra isso porque "por que
  // fulano não vê o DRE?" tem duas respostas possíveis — o perfil dele ou o
  // papel dele —, e sem dizer qual, a pergunta volta.
  origem: "perfil" | "papel";
  perfilNome: string | null;
};

export function resolverAcesso(
  role: string,
  perfil: { nome: string; permissoes: string[] } | null
): AcessoResolvido {
  // PAPEL SEM ACESSO NENHUM VENCE O PERFIL. FOLHA e MOTORISTA não entram na
  // Controladoria, e um perfil generoso não pode virar a porta dos fundos:
  // quem administra pessoas é a gestão, e a decisão de lá sobre quem é do
  // financeiro tem de continuar valendo aqui.
  if (!canViewControladoria(role)) {
    return { permissoes: new Set(), origem: "papel", perfilNome: null };
  }
  if (perfil) {
    return { permissoes: new Set(perfil.permissoes), origem: "perfil", perfilNome: perfil.nome };
  }
  return { permissoes: new Set(permissoesDoPapel(role)), origem: "papel", perfilNome: null };
}

export function pode(acesso: AcessoResolvido, permissao: Permissao): boolean {
  return acesso.permissoes.has(permissao);
}

// PERFIS SUGERIDOS na criação — os três recortes que aparecem em qualquer
// controladoria de PME. Não são obrigatórios nem imutáveis: são um ponto de
// partida, porque tela de permissão que começa vazia costuma terminar vazia.
export const PERFIS_SUGERIDOS: { nome: string; descricao: string; permissoes: Permissao[] }[] = [
  {
    nome: "Controladoria",
    descricao: "Opera o módulo inteiro: trata achado, classifica DRE, sincroniza e configura.",
    permissoes: PERMISSOES.map((p) => p.chave),
  },
  {
    nome: "Diretoria",
    descricao: "Vê tudo, não altera nada. O recorte de quem decide sem operar.",
    permissoes: PERMISSOES.filter((p) => p.grupo === "Telas").map((p) => p.chave),
  },
  {
    nome: "Financeiro",
    descricao: "O dia a dia da tesouraria: caixa, títulos, conciliação e conferência de CT-e.",
    permissoes: [
      "painel",
      "titulos",
      "fluxo-caixa",
      "conciliacao",
      "cte",
      "conferir-cte",
      "resultados",
    ],
  },
];
