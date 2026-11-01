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
  tipo: "permissao" | "tabela" | "coluna" | "conexao" | "outro";
  titulo: string;
  texto: string;
  // O comando que resolve, quando há um — para copiar e colar no editor SQL.
  sql?: string;
};

export function motivoDaFalhaNaGestao(mensagem: string, tabelas: string[], modo: "separado" | "mesmo-banco"): MotivoDaFalha {
  const lista = tabelas.map((t) => `public."${t}"`).join(", ");
  const conexao = modo === "separado" ? "a conexão GESTAO_DATABASE_URL" : "a conexão principal (sem GESTAO_DATABASE_URL, a controladoria lê a gestão no próprio banco)";
  if (/42501|permission denied/i.test(mensagem)) {
    return {
      tipo: "permissao",
      titulo: "Falta permissão de leitura na gestão",
      texto: `O banco da gestão respondeu, mas recusou a leitura: o papel usado por ${conexao} não tem SELECT em ${tabelas.join(" e ")}. Essas tabelas entraram depois que o papel foi criado. Rode o comando abaixo no editor SQL do Neon, no banco da GESTÃO, com o papel dono do projeto (troque controladoria_leitura pelo nome do papel, se for outro).`,
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
  return {
    tipo: "outro",
    titulo: "Não foi possível ler a gestão",
    texto: `A leitura de ${tabelas.join(" e ")} falhou: ${mensagem.slice(0, 300)}`,
  };
}
