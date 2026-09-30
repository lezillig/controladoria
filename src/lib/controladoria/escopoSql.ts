import { Prisma } from "@prisma/client";
import { tabela } from "@/lib/esquemaDoBanco";

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

// ELIMINAÇÃO DAS OPERAÇÕES ENTRE EMPRESAS DO GRUPO (intercompany).
//
// Na visão do GRUPO, o que a MCZ fatura contra a Azul não é receita — é
// dinheiro trocando de bolso dentro da mesma casa —, e o título espelho, a
// Azul pagando a MCZ, não é despesa. Somados, os dois inflam receita e despesa
// na mesma medida: o resultado fecha, e toda margem e todo percentual do DRE
// ficam errados. Foi o que a tela de Custos mostrou: "Clientes — Serviços
// Prestados" do grupo com títulos da MCZ cujo cliente era a própria Azul.
//
// O CRITÉRIO é a RAIZ DO CNPJ (8 primeiros dígitos, que identificam a empresa
// e não o estabelecimento): o parceiro do título tem a mesma raiz do CNPJ de
// alguma conexão Omie da instalação — ativa ou não, porque título antigo de
// uma conexão desativada continua sendo operação dentro do grupo. Conexão sem
// CNPJ cadastrado não contribui com raiz nenhuma: adivinhar pelo nome
// eliminaria receita verdadeira de cliente homônimo, e isso é pior que deixar
// uma operação interna à vista (a tela de conexões é onde se conserta).
//
// SÓ NA VISÃO DO GRUPO. Com uma empresa filtrada, o título contra a outra é
// receita e despesa de verdade daquela empresa, e fica. E só nos números de
// RESULTADO — os agentes de auditoria não passam por aqui: título entre as
// empresas vencido e não pago continua sendo fato a auditar.
//
// A expressão nunca é nula (COALESCE): um documento nulo dentro de `NOT (...)`
// faria o título sumir em vez de ficar, que é o erro silencioso clássico.
export function ehIntercompanySql(companyId: string, alias = "t"): Prisma.Sql {
  const doc = Prisma.raw(`${alias}."parceiroDocumento"`);
  return Prisma.sql`COALESCE(
      char_length(${doc}) = 14
      AND LEFT(${doc}, 8) IN (
        SELECT LEFT(regexp_replace(cx.cnpj, '[^0-9]', '', 'g'), 8)
          FROM ${tabela("OmieConexao")} cx
         WHERE cx."companyId" = ${companyId}
           AND char_length(regexp_replace(cx.cnpj, '[^0-9]', '', 'g')) = 14
      ),
      false)`;
}

// Sempre parametrizado, nunca interpolação de texto: o id da conexão vem da
// querystring, e concatenar valor de requisição dentro de SQL é como se escreve
// uma injeção.
//
// Sem conexão (visão do grupo), elimina as operações entre as empresas — ver
// `ehIntercompanySql`. O `companyId` é obrigatório por isso: é dele que saem as
// raízes de CNPJ do grupo.
export function filtroConexaoTitulo(conexaoId: string | null | undefined, companyId: string) {
  return conexaoId
    ? Prisma.sql`AND t."conexaoId" = ${conexaoId}`
    : Prisma.sql`AND NOT ${ehIntercompanySql(companyId)}`;
}

// Para consultas de BAIXA que juntam o título como `t`. Com LEFT JOIN, baixa
// sem título fica (documento nulo → não é intercompany).
export function filtroConexaoBaixa(conexaoId: string | null | undefined, companyId: string) {
  return conexaoId
    ? Prisma.sql`AND b."conexaoId" = ${conexaoId}`
    : Prisma.sql`AND NOT ${ehIntercompanySql(companyId)}`;
}

// Só a conexão do título, SEM eliminação: para leitura de posição (em aberto,
// aging) que as telas fazem pelo contexto dos agentes — onde o título entre
// as empresas continua contando, porque dívida vencida entre elas é fato.
export function filtroSoConexaoTitulo(conexaoId?: string | null) {
  return conexaoId ? Prisma.sql`AND t."conexaoId" = ${conexaoId}` : Prisma.empty;
}

// Só a conexão da baixa, para consulta que ainda não juntou o título (a
// eliminação acontece adiante, onde o título entra).
export function filtroSoConexaoBaixa(conexaoId?: string | null) {
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
