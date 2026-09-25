import { Prisma } from "@prisma/client";

// O RECORTE DA LEITURA, ESCRITO UMA VEZ EM SQL.
//
// Três telas passaram a somar no banco em vez de carregar linhas (DRE, ranking
// de fornecedores, estratégia de custo). Todas precisam do MESMO recorte: a
// empresa, a conexão quando há filtro, e a janela — que não é um simples
// "entre duas datas", e é aí que mora o erro fácil.
//
// A janela do contexto é "dentro do período OU ainda em aberto": um título
// vencido há dois anos é o registro mais grave da base e não pode sumir da
// leitura por ser antigo. Escrever essa condição de novo em cada consulta é
// convidar uma delas a divergir — e a que divergir vai mostrar um número
// diferente do das outras na mesma tela.
//
// SOBRE O FUSO: as datas de calendário desta base são gravadas à meia-noite do
// fuso do servidor (UTC na Vercel), e é essa premissa que permite extrair o mês
// direto da coluna no banco. É a mesma premissa de `fmtData`, que formata data
// de calendário em UTC — se um dia ela deixar de valer, os dois lugares mudam
// juntos.

export type EscopoSql = {
  companyId: string;
  conexaoId?: string | null;
  // O mesmo recorte que `carregarContexto` aplicaria: `desde` obrigatório,
  // `ate` opcional ("até hoje").
  janela: { desde: Date; ate?: Date | null };
};

// Sempre parametrizado, nunca interpolação de texto: o id da conexão vem da
// querystring, e concatenar valor de requisição dentro de SQL é como se escreve
// uma injeção.
export function filtroConexaoTitulo(conexaoId?: string | null) {
  return conexaoId ? Prisma.sql`AND t."conexaoId" = ${conexaoId}` : Prisma.empty;
}

export function filtroConexaoBaixa(conexaoId?: string | null) {
  return conexaoId ? Prisma.sql`AND b."conexaoId" = ${conexaoId}` : Prisma.empty;
}

// A janela do contexto, cláusula por cláusula igual à de `carregarContexto`.
// Espera o alias `t` para a tabela de títulos.
export function naJanela(janela: { desde: Date; ate?: Date | null }) {
  const { desde, ate } = janela;
  return Prisma.sql`
    AND (
         (t."dataVencimento" >= ${desde} ${ate ? Prisma.sql`AND t."dataVencimento" <= ${ate}` : Prisma.empty})
      OR (t."dataEmissao"    >= ${desde} ${ate ? Prisma.sql`AND t."dataEmissao"    <= ${ate}` : Prisma.empty})
      OR (t.liquidado = false AND t.cancelado = false)
    )`;
}

// Categoria do título, com o mesmo nome que a conta em memória usa para o
// "sem categoria" — que aparece como aviso, fora da demonstração.
export const CATEGORIA_SQL = Prisma.sql`COALESCE(t."categoriaCodigo", 'SEM_CATEGORIA')`;
