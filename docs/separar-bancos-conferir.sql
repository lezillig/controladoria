-- =============================================================================
-- CONFERÊNCIA DA CÓPIA — rode nos DOIS bancos e compare a saída.
--
-- Use este arquivo em vez de conferir tabela a tabela na mão. A lista escrita
-- por uma pessoa esquece justamente a tabela que ninguém lembra que existe — e
-- a que some numa migração de banco costuma ser exatamente essa.
--
-- Como usar:
--
--   psql "$ORIGEM"  -f docs/separar-bancos-conferir.sql > antes.txt
--   psql "$DESTINO" -f docs/separar-bancos-conferir.sql > depois.txt
--   diff antes.txt depois.txt
--
-- `diff` sem saída = cópia íntegra. Qualquer linha de diferença: PARE, não
-- troque as variáveis de ambiente, e refaça a cópia.
-- =============================================================================

\echo '=== 1. Contagem exata de TODAS as tabelas do schema ==='

-- `query_to_xml` roda um COUNT(*) de verdade em cada tabela, sem precisar
-- escrever a lista. Não é `reltuples`: aquela é estimativa do planejador e pode
-- estar desatualizada em horas — para decidir se a cópia veio inteira, só a
-- contagem exata serve.
--
-- `format` com %I escapa o identificador. Os nomes vêm do catálogo do próprio
-- banco, não de entrada de usuário, mas montar SQL com nome sem escapar é
-- hábito que uma hora custa caro.
SELECT tabela,
       (xpath('/row/cnt/text()', contagem))[1]::text::bigint AS linhas
  FROM (
    SELECT c.relname AS tabela,
           query_to_xml(
             format('SELECT count(*) AS cnt FROM %I.%I', n.nspname, c.relname),
             false, true, ''
           ) AS contagem
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'controladoria'
       AND c.relkind = 'r'
  ) t
 ORDER BY tabela;

\echo ''
\echo '=== 2. Histórico de migrações ==='

-- Sem isto, a próxima publicação tenta aplicar as migrações de novo no banco
-- novo. Elas falhariam em cima de tabelas que já existem, e o build quebraria —
-- barulhento, mas no pior momento possível.
SELECT count(*) FILTER (WHERE finished_at IS NOT NULL) AS aplicadas,
       count(*) FILTER (WHERE finished_at IS NULL)     AS incompletas,
       max(migration_name)                             AS ultima
  FROM controladoria._prisma_migrations;

\echo ''
\echo '=== 3. Índices e chaves estrangeiras ==='

-- Contagem de tabelas igual com índice faltando é a falha silenciosa desta
-- operação: tudo funciona, tudo fica lento, e ninguém liga uma coisa à outra.
-- Chave estrangeira faltando é pior — deixa entrar dado órfão.
SELECT 'índices' AS objeto, count(*) AS total
  FROM pg_indexes WHERE schemaname = 'controladoria'
UNION ALL
SELECT 'chaves estrangeiras', count(*)
  FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace
 WHERE n.nspname = 'controladoria' AND c.contype = 'f'
UNION ALL
SELECT 'restrições únicas', count(*)
  FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace
 WHERE n.nspname = 'controladoria' AND c.contype = 'u'
ORDER BY 1;

\echo ''
\echo '=== 4. Marcos do negócio — os números que você reconhece ==='

-- As contagens acima provam que a cópia veio inteira. Estas provam que ela veio
-- CERTA: são valores que você já viu na tela e reconhece de olho. Uma cópia
-- truncada no meio pode ter todas as tabelas e metade dos títulos.
SELECT 'títulos'                  AS o_que, count(*)::text AS quanto FROM controladoria."OmieTitulo"
UNION ALL SELECT 'baixas',              count(*)::text FROM controladoria."OmieBaixa"
UNION ALL SELECT 'achados abertos',     count(*)::text FROM controladoria."AuditFinding" WHERE status = 'ABERTO'
UNION ALL SELECT 'janelas concluídas',  count(*)::text FROM controladoria."OmieSyncRun"
            WHERE backfill = true AND status = 'CONCLUIDO'
UNION ALL SELECT 'receita jul/2026',
            to_char(COALESCE(sum("valorDocumentoCents"), 0) / 100.0, 'FM999G999G999D00')
       FROM controladoria."OmieTitulo"
      WHERE cancelado = false
        AND natureza::text = 'RECEBER'
        AND COALESCE("dataEmissao", "dataVencimento") >= DATE '2026-07-01'
        AND COALESCE("dataEmissao", "dataVencimento") <  DATE '2026-08-01'
ORDER BY 1;

\echo ''
\echo 'Compare as quatro seções entre os dois bancos. Qualquer diferença: refaça a cópia.'
