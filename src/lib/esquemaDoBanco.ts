import { Prisma } from "@prisma/client";

// SQL CRU E CLIENTE DO PRISMA TÊM QUE OLHAR PARA O MESMO LUGAR.
//
// O cliente do Prisma QUALIFICA a tabela com o schema da URL de conexão: ele
// emite `"public"."OmieTitulo"`. SQL cru escrito como `FROM "OmieTitulo"` não
// qualifica nada — quem resolve o nome é o `search_path` da conexão, que vem do
// papel ou do banco, e não da URL.
//
// Enquanto os dois coincidem, ninguém percebe a diferença. Quando divergem, o
// sistema passa a ler de DUAS TABELAS diferentes ao mesmo tempo, e nada acusa:
// a tela de títulos (cliente) mostra a base certa, a de resultado (SQL cru)
// soma outra, e as duas parecem plausíveis.
//
// Foi o que aconteceu aqui, e o sintoma foi exatamente esse: o filtro de
// empresa funcionando na tela enquanto o relatório de diferenças jurava que a
// tabela `OmieConexao` não existia. Reproduzido em laboratório com um schema
// antigo à frente no `search_path`: `OmieTitulo` devolveu 0 pelo cliente e 2
// pelo mesmo nome em SQL cru, no mesmo banco, na mesma conexão.
//
// A correção é tirar a ambiguidade: toda consulta em SQL cru passa a nomear a
// tabela com o mesmo schema que o cliente usa. Não é um conserto de banco — é o
// SQL dizendo o que sempre quis dizer.

// Nome de schema seguro para interpolar. `Prisma.raw` não parametriza — e este
// valor vem de variável de ambiente, que é config e não entrada de usuário, mas
// a validação custa uma linha e fecha a porta de vez.
const NOME_VALIDO = /^[A-Za-z_][A-Za-z0-9_$]*$/;

function esquemaDaUrl(url: string | undefined): string {
  if (!url) return "public";
  try {
    const schema = new URL(url).searchParams.get("schema");
    return schema && NOME_VALIDO.test(schema) ? schema : "public";
  } catch {
    // URL ilegível: `public` é o padrão do Prisma quando o parâmetro não vem,
    // então errar para o mesmo lado que ele é o comportamento correto.
    return "public";
  }
}

// O schema do banco da Controladoria — o mesmo que o cliente do Prisma usa.
export function esquemaDaControladoria(): string {
  return esquemaDaUrl(process.env.DATABASE_URL);
}

// O da gestão. `GESTAO_DATABASE_URL` quando existe; senão a leitura cai no
// mesmo banco da Controladoria (ver gestao/cliente.ts), e o schema tem que
// acompanhar essa escolha.
export function esquemaDaGestao(): string {
  return esquemaDaUrl(process.env.GESTAO_DATABASE_URL ?? process.env.DATABASE_URL);
}

// Nome de tabela qualificado, pronto para entrar num template de `$queryRaw`.
//
//   FROM ${tabela("OmieTitulo")} t
//
// vira `FROM "public"."OmieTitulo" t`.
export function tabela(nome: string): Prisma.Sql {
  return Prisma.raw(`"${esquemaDaControladoria()}"."${nome}"`);
}

export function tabelaGestao(nome: string): Prisma.Sql {
  return Prisma.raw(`"${esquemaDaGestao()}"."${nome}"`);
}
