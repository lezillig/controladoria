// POR QUE A LEITURA DA GESTÃO FALHOU — dito na tela, não adivinhado.
//
// A tela de financiamentos dizia "a gestão não respondeu (ou o papel de leitura
// não tem acesso…)" para qualquer falha: conexão caída, permissão faltando,
// tabela inexistente. São três consertos diferentes, feitos por pessoas
// diferentes (esperar; rodar um GRANT no Neon; publicar a gestão), e a tela
// não dizia qual. O erro do Postgres diz: o código vem na mensagem do Prisma
// ("Code: `42501`").
//
// A mensagem já chega redigida (sem host nem senha) de quem chama.

export type MotivoDaFalha = {
  tipo: "permissao" | "credencial" | "tabela" | "coluna" | "conexao" | "outro";
  titulo: string;
  texto: string;
  // O comando que resolve, quando há um — para copiar e colar no editor SQL.
  sql?: string;
};

export function motivoDaFalhaNaGestao(mensagem: string, tabelas: string[], modo: "separado" | "mesmo-banco"): MotivoDaFalha {
  const lista = tabelas.map((t) => `public."${t}"`).join(", ");
  const conexao = modo === "separado" ? "a conexão GESTAO_DATABASE_URL" : "a conexão principal (sem GESTAO_DATABASE_URL, a controladoria lê a gestão no próprio banco)";
  // Credencial recusada: a mensagem do Prisma traz o NOME DO USUÁRIO do banco
  // ("credentials for `<usuário>`") — não vai para a tela, e o conserto é
  // outro (a senha da variável, não um GRANT).
  if (/P1000|P1010|authentication failed|password authentication|credentials for/i.test(mensagem)) {
    return {
      tipo: "credencial",
      titulo: "O banco da gestão recusou a credencial",
      texto: `O usuário ou a senha de ${conexao} não foram aceitos pelo banco da gestão. Confira a variável na Vercel (usuário e senha do papel de leitura, ver docs/papel-leitura-gestao.sql).`,
    };
  }
  if (/42501|permission denied/i.test(mensagem)) {
    return {
      tipo: "permissao",
      titulo: "Falta permissão de leitura na gestão",
      texto: `O banco da gestão respondeu, mas recusou a leitura: o papel usado n${conexao} não tem SELECT em ${tabelas.join(" e ")}. Essas tabelas entraram depois que o papel foi criado. Rode o comando abaixo no editor SQL do Neon, no banco da GESTÃO, com o papel dono do projeto (troque controladoria_leitura pelo nome do papel, se for outro).`,
      sql: `GRANT SELECT ON ${lista} TO controladoria_leitura;`,
    };
  }
  if (/42P01|relation .* does not exist/i.test(mensagem)) {
    return {
      tipo: "tabela",
      titulo: "A tabela não existe no banco lido",
      texto:
        modo === "separado"
          ? `O banco apontado por GESTAO_DATABASE_URL não tem ${tabelas.join(" nem ")}: a gestão publicada ainda não tem os financiamentos (falta publicar a versão com a migração), ou a variável aponta para outro banco.`
          : `Sem GESTAO_DATABASE_URL, a controladoria procura ${tabelas.join(" e ")} no próprio banco — e lá elas não existem. Se a gestão está em outro banco, cadastre GESTAO_DATABASE_URL na Vercel (ver docs/papel-leitura-gestao.sql).`,
    };
  }
  if (/42703|column .* does not exist/i.test(mensagem)) {
    const coluna = /column "?([\w.]+)"? does not exist/i.exec(mensagem)?.[1];
    return {
      tipo: "coluna",
      titulo: "A gestão publicada é de outra versão",
      texto: `A tabela existe, mas sem a coluna ${coluna ?? "esperada"}: a gestão em produção está numa versão anterior à que a controladoria lê. Publicar a gestão (com a migração) resolve.`,
    };
  }
  if (/P1001|P1002|P1008|P1017|timed? ?out|ECONN|ETIMEDOUT|ENOTFOUND|Can't reach|connection/i.test(mensagem)) {
    return {
      tipo: "conexao",
      titulo: "A gestão não respondeu",
      texto: "O banco da gestão não respondeu agora (fora do ar, suspenso ou lento para acordar). As ligações com a Omie continuam gravadas; tente de novo em instantes.",
    };
  }
  // O texto do erro NÃO vai para a tela: mensagem de banco carrega nome de
  // usuário, de tabela e às vezes trecho de dado. Ele está no log do servidor
  // (leitura.ts registra a mensagem redigida).
  return {
    tipo: "outro",
    titulo: "Não foi possível ler a gestão",
    texto: `A leitura de ${tabelas.join(" e ")} falhou por um motivo que não é permissão, versão nem conexão. O erro completo está no log do servidor da Vercel, com "[gestao] leitura dos contratos falhou".`,
  };
}

// EM QUE VERSÃO ESTÁ A GESTÃO QUE A CONTROLADORIA LÊ.
//
// "A tabela não existe no banco lido" tem duas causas com consertos opostos:
// a gestão em produção ainda não publicou a tabela, ou a controladoria está
// lendo OUTRO banco — uma cópia antiga da gestão, que continua respondendo
// pelas tabelas de sempre (usuários, motoristas, veículos) e por isso nunca
// deu erro. Em produção apareceu a segunda: sem GESTAO_DATABASE_URL, a
// controladoria procurava os financiamentos num banco que não os tinha,
// semanas depois de a gestão tê-los publicado.
//
// O que separa as duas é um fato do próprio banco: a última migração da
// gestão aplicada nele (tabela `_prisma_migrations` do schema da gestão) e
// quando. Banco de produção da gestão acompanha a `main` de lá; cópia antiga
// parou no dia em que foi feita.

// A migração da gestão que cria Financiamento e FinanciamentoVeiculo.
export const MIGRACAO_DOS_FINANCIAMENTOS = "20261016120000";

export type VersaoDaGestao = { migracao: string; aplicadaEm: Date; total: number };

const dataBr = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

/** A frase que acompanha "tabela não existe": o que a versão do banco lido prova. */
export function leituraDaVersaoDaGestao(versao: VersaoDaGestao | null, modo: "separado" | "mesmo-banco"): string {
  if (!versao) {
    return modo === "separado"
      ? "Não foi possível ver em que versão está o banco da gestão (o papel de leitura não enxerga o histórico de migrações)."
      : "Este banco não tem o histórico de migrações da gestão no schema public: ele não é o banco onde a gestão publica as mudanças dela.";
  }
  const carimbo = versao.migracao.slice(0, 14);
  const quando = `${versao.migracao} (aplicada em ${dataBr(versao.aplicadaEm)})`;
  if (carimbo < MIGRACAO_DOS_FINANCIAMENTOS) {
    return `O banco lido como gestão parou na migração ${quando}. Os financiamentos entraram na gestão em 16/10/2026, depois disso. Se a tela de financiamentos da gestão funciona, este NÃO é o banco de produção dela: é uma cópia antiga, e os usuários, motoristas, veículos e abastecimentos que a controladoria lê também estão parados no dia em que a cópia foi feita. O conserto é apontar a controladoria para o banco de produção da gestão (GESTAO_DATABASE_URL na Vercel, com o papel somente leitura de docs/papel-leitura-gestao.sql).`;
  }
  return `O banco lido como gestão está na migração ${quando}, que já é posterior à dos financiamentos (16/10/2026): a tabela deveria existir. Confira no banco da gestão se ela foi criada no schema public.`;
}

/** A controladoria lê uma gestão anterior à versão de que precisa? */
export function gestaoLidaEstaAtrasada(versao: VersaoDaGestao | null): boolean {
  return versao !== null && versao.migracao.slice(0, 14) < MIGRACAO_DOS_FINANCIAMENTOS;
}

/** A versão em uma linha, para a tela de sincronização. */
export function resumoDaVersaoDaGestao(versao: VersaoDaGestao): string {
  return `${versao.migracao}, aplicada em ${dataBr(versao.aplicadaEm)} (${versao.total} migrações no total)`;
}
