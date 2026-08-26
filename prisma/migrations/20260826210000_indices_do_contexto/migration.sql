-- OS ÍNDICES DO CONTEXTO — a consulta que toda tela dispara.
--
-- Toda página do módulo monta o mesmo contexto, e o pedaço mais caro dele é a
-- busca de títulos, que tem três condições em OU:
--
--   dataVencimento >= janela   OR   dataEmissao >= janela   OR   (em aberto)
--
-- A primeira já tinha índice. As outras duas não tinham nenhum, e é isso que
-- fica caro: o Postgres não consegue combinar índices para um OU em que um dos
-- ramos não tem índice nenhum — ele desiste e varre a tabela inteira. Com oito
-- meses de base isso passava; com cinco anos, cada abertura de tela varreria
-- anos de títulos.
--
-- O TERCEIRO RAMO É O QUE MAIS IMPORTA, e por que ele existe: título EM ABERTO
-- entra no contexto por mais velho que seja. É deliberado — um título vencido
-- há dois anos é o registro mais grave da base, e recortá-lo pela janela o
-- faria sumir da tela de atrasos justamente por ser antigo. Ele fica; o que
-- muda aqui é o custo de encontrá-lo.
--
-- Índice PARCIAL para esse ramo: ele indexa só as linhas em aberto, que são uma
-- fração da tabela. Um índice comum sobre (liquidado, cancelado) teria o
-- tamanho da tabela inteira para responder sobre uma minoria das linhas.

CREATE INDEX IF NOT EXISTS "OmieTitulo_em_aberto_idx"
    ON "OmieTitulo" ("companyId", "conexaoId", "dataVencimento")
    WHERE liquidado = false AND cancelado = false;

-- O ramo da emissão. A competência de um título é a emissão (ver
-- competencia.ts), então este é também o índice que serve a quase toda leitura
-- de resultado por mês.
CREATE INDEX IF NOT EXISTS "OmieTitulo_emissao_idx"
    ON "OmieTitulo" ("companyId", "dataEmissao");

-- A busca do próximo mês de carga histórica, feita uma vez por conexão a CADA
-- invocação do ciclo. Numa carga de cinco anos são centenas de invocações, e
-- sem o `backfill` no índice cada uma varria todas as execuções da conexão.
CREATE INDEX IF NOT EXISTS "OmieSyncRun_backfill_idx"
    ON "OmieSyncRun" ("conexaoId", "backfill", "status");
