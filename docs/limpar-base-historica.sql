-- ===========================================================================
-- LIMPAR A BASE ATÉ 31/12/2024
-- ===========================================================================
--
-- Remove do ESPELHO os lançamentos até 31/12/2024, mantendo 2025 e 2026.
-- Rode conectado ao banco da CONTROLADORIA (não ao da gestão).
--
-- PREFIRA O BOTÃO. A mesma sequência existe na tela Sincronização → "Limpar
-- a base até 31/12/2024" (permissão de alterar o modelo de gestão), com a
-- medida antes, a ordem garantida pelo código, transação única e trilha de
-- auditoria. Este arquivo fica como referência do que o botão faz e para o
-- caso de precisar rodar por fora — com o schema certo no search_path.
--
-- ---------------------------------------------------------------------------
-- LEIA ISTO ANTES, PORQUE A ORDEM DECIDE SE O TRABALHO SERVE PARA ALGUMA COISA
-- ---------------------------------------------------------------------------
--
-- A carga histórica é AUTOCURÁVEL de propósito: a cada ciclo ela caminha da
-- data de início da base para frente e baixa o primeiro mês que estiver
-- faltando. Enquanto a data de início for 31/12/2020, apagar 2021 a 2024 é
-- instruir o sistema a baixar 2021 a 2024 de novo — horas de carga, consumo de
-- API e de banco, para voltar exatamente ao ponto de partida.
--
-- Por isso o PASSO 1 é mover a data de início. Ele não é preparação: é o que
-- torna a exclusão permanente. Sem ele, o resto é desperdício.
--
-- ISTO NÃO É PERDA DEFINITIVA. O espelho é uma cópia; a Omie continua com
-- tudo. Para trazer de volta, basta mover a data de início para trás e rodar a
-- carga — ela reconhece o que falta e preenche sozinha.
--
-- ---------------------------------------------------------------------------
-- O QUE VOCÊ PERDE, DITO SEM RODEIO
-- ---------------------------------------------------------------------------
--
--   1. O comparativo 2025 × 2024 no DRE e no Resultado mês a mês. Depois desta
--      limpeza, 2025 passa a ser o primeiro ano e não tem contra o que ser
--      comparado.
--
--   2. Três meses da janela dos agentes de padrão. Eles comparam cada
--      fornecedor com os 24 meses anteriores; sobram 21 (jan/2025 a set/2026).
--      Continua acima do mínimo das quatro regras, que é 6 meses para o desvio
--      e 12 para reajuste e prazo de pagamento. Nenhuma regra para de
--      funcionar; a base de comparação fica um pouco mais curta.
--
--   3. Se você escolher a OPÇÃO A abaixo: os títulos anteriores a 2025 que
--      AINDA ESTÃO EM ABERTO somem da visão do sistema. Um recebível de 2024
--      nunca cobrado deixa de ser apontado — ele continua existindo na Omie, e
--      passa a depender de alguém lembrar dele. É por isso que a opção B
--      existe e é a recomendada.

-- ---------------------------------------------------------------------------
-- PASSO 0 — Descobrir o schema e MEDIR antes de apagar
-- ---------------------------------------------------------------------------
-- As tabelas da Controladoria podem não estar em `public`: o schema vem do
-- parâmetro `?schema=` da DATABASE_URL. Confira e ajuste o search_path abaixo.

SELECT table_schema, COUNT(*) AS tabelas
  FROM information_schema.tables
 WHERE table_name IN ('OmieTitulo', 'HistoricoMensal')
 GROUP BY table_schema;

-- Ajuste se o resultado acima não for `public`:
SET search_path TO public;

-- Quanto será removido, por tabela. Rode e ANOTE os números: são eles que
-- você vai conferir no passo 5.
SELECT 'titulos ate 2024'        AS o_que, COUNT(*) AS linhas FROM "OmieTitulo"
 WHERE COALESCE("dataEmissao", "dataVencimento") < DATE '2025-01-01'
UNION ALL
SELECT 'destes, ainda em aberto', COUNT(*) FROM "OmieTitulo"
 WHERE COALESCE("dataEmissao", "dataVencimento") < DATE '2025-01-01'
   AND liquidado = false AND cancelado = false
UNION ALL
SELECT 'movimentos ate 2024',     COUNT(*) FROM "OmieMovimento" WHERE data < DATE '2025-01-01'
UNION ALL
SELECT 'notas ate 2024',          COUNT(*) FROM "OmieNota" WHERE "dataEmissao" < DATE '2025-01-01'
UNION ALL
SELECT 'resumo mensal ate 2024',  COUNT(*) FROM "HistoricoMensal" WHERE competencia < '2025-01';

-- A SEGUNDA LINHA É A QUE DECIDE ENTRE A E B. Se vier zero, as duas opções são
-- idênticas e você pode usar a A sem pensar. Se vier um número relevante, são
-- títulos de 2024 ou antes que o sistema ainda considera não pagos — vale
-- olhar quais antes de apagar:

SELECT "conexaoApelido", natureza::text, "parceiroNome", "numeroDocumento",
       "dataVencimento"::date, "valorDocumentoCents" / 100.0 AS valor
  FROM "OmieTitulo"
 WHERE COALESCE("dataEmissao", "dataVencimento") < DATE '2025-01-01'
   AND liquidado = false AND cancelado = false
 ORDER BY "valorDocumentoCents" DESC
 LIMIT 40;

-- ---------------------------------------------------------------------------
-- PASSO 1 — Mover a data de início da base  ← FAÇA ISTO PRIMEIRO
-- ---------------------------------------------------------------------------
-- Pela tela: Modelo de gestão → data de início da base → 01/01/2025.
-- Ou aqui, que dá no mesmo:

UPDATE "ControladoriaConfig"
   SET "dataInicioBase" = DATE '2025-01-01'
 WHERE "dataInicioBase" < DATE '2025-01-01';

-- Confirme antes de seguir. Se esta linha não mudou, PARE: a carga vai
-- rebaixar tudo o que você apagar a seguir.
SELECT "companyId", "dataInicioBase"::date FROM "ControladoriaConfig";

-- ---------------------------------------------------------------------------
-- PASSO 2 — Escolher A ou B, e rodar SÓ UMA
-- ---------------------------------------------------------------------------
-- As duas estão em transação: se algo der errado no meio, nada é gravado.
-- Troque o COMMIT final por ROLLBACK se quiser apenas ensaiar.

-- ······························ OPÇÃO A ····································
-- Apaga tudo até 31/12/2024, inclusive o que ainda está em aberto.
-- Use quando a contagem de "ainda em aberto" tiver vindo zero, ou quando você
-- já souber que aqueles títulos são resíduo de baixa que ninguém deu.

-- BEGIN;
--
-- DELETE FROM "OmieTitulo"
--  WHERE COALESCE("dataEmissao", "dataVencimento") < DATE '2025-01-01';
--
-- COMMIT;

-- ······························ OPÇÃO B ····································
-- RECOMENDADA. Apaga o que já se encerrou e PRESERVA o que ainda está em
-- aberto, por mais antigo que seja.
--
-- O raciocínio é o mesmo que rege o contexto dos agentes: título liquidado é
-- história, e história pode ser resumida; título em aberto é dinheiro que
-- alguém ainda deve, e some da tela justamente por ser antigo — que é o
-- contrário do que uma auditoria deve fazer. São poucas linhas a mais e
-- eliminam o único risco real desta limpeza.

BEGIN;

DELETE FROM "OmieTitulo"
 WHERE COALESCE("dataEmissao", "dataVencimento") < DATE '2025-01-01'
   AND (liquidado = true OR cancelado = true);

COMMIT;

-- As BAIXAS somem junto: a chave estrangeira para o título é ON DELETE
-- CASCADE. Não há DELETE separado para elas, e não deve haver — baixa sem
-- título é registro órfão.

-- ---------------------------------------------------------------------------
-- PASSO 3 — Movimentos, notas e o resumo mensal
-- ---------------------------------------------------------------------------
-- Estes não dependem da opção escolhida: não são dinheiro em aberto, são
-- registro de algo que aconteceu.

BEGIN;

DELETE FROM "OmieMovimento" WHERE data < DATE '2025-01-01';
DELETE FROM "OmieNota"      WHERE "dataEmissao" < DATE '2025-01-01';

-- O resumo mensal é DERIVADO e idempotente: apagá-lo não perde nada que não
-- possa ser refeito pelo botão "Recalcular resumo mensal". Some porque não há
-- mais títulos para sustentá-lo.
DELETE FROM "HistoricoMensal" WHERE competencia < '2025-01';

-- As janelas de carga antigas. Sem isto a barra de "Carga histórica"
-- continuaria contando 134 janelas concluídas de um período que não existe
-- mais — e a porcentagem viraria ficção.
DELETE FROM "OmieSyncRun"
 WHERE backfill = true AND "janelaFim" < DATE '2025-01-01';

COMMIT;

-- ---------------------------------------------------------------------------
-- PASSO 4 — Achados que ficaram sem objeto
-- ---------------------------------------------------------------------------
-- Um achado aponta para a entidade que o originou, sem chave estrangeira
-- (achado sobre o grupo não tem entidade nenhuma, e uma FK obrigaria a
-- inventar uma). Apagados os títulos, os achados que falavam deles passam a
-- apontar para o vazio: continuariam na lista, sem forma de conferir a
-- evidência.
--
-- Este DELETE é preciso — remove só o que perdeu o objeto, e não por data:
-- achado de 2026 sobre um título de 2023 também fica órfão.
--
-- É também aqui que boa parte da pilha de achados em aberto deve desaparecer,
-- porque ela vinha justamente dos títulos antigos nunca baixados.

BEGIN;

DELETE FROM "AuditFinding" f
 WHERE f."entidadeTipo" = 'OmieTitulo'
   AND NOT EXISTS (SELECT 1 FROM "OmieTitulo" t WHERE t.id = f."entidadeId");

COMMIT;

-- ---------------------------------------------------------------------------
-- PASSO 5 — Conferir
-- ---------------------------------------------------------------------------
-- Tudo abaixo deve vir zero, exceto "titulos em aberto preservados" se você
-- escolheu a opção B.

SELECT 'titulos ate 2024'                AS o_que, COUNT(*) AS linhas FROM "OmieTitulo"
 WHERE COALESCE("dataEmissao", "dataVencimento") < DATE '2025-01-01'
   AND liquidado = true
UNION ALL
SELECT 'titulos em aberto preservados',  COUNT(*) FROM "OmieTitulo"
 WHERE COALESCE("dataEmissao", "dataVencimento") < DATE '2025-01-01'
UNION ALL
SELECT 'movimentos ate 2024',            COUNT(*) FROM "OmieMovimento" WHERE data < DATE '2025-01-01'
UNION ALL
SELECT 'notas ate 2024',                 COUNT(*) FROM "OmieNota" WHERE "dataEmissao" < DATE '2025-01-01'
UNION ALL
SELECT 'resumo mensal ate 2024',         COUNT(*) FROM "HistoricoMensal" WHERE competencia < '2025-01'
UNION ALL
SELECT 'achados orfaos',                 COUNT(*) FROM "AuditFinding" f
 WHERE f."entidadeTipo" = 'OmieTitulo'
   AND NOT EXISTS (SELECT 1 FROM "OmieTitulo" t WHERE t.id = f."entidadeId");

-- Espaço em disco só volta de fato depois disto. Sem VACUUM as páginas ficam
-- marcadas como reutilizáveis mas o arquivo não encolhe — e o que se paga no
-- Neon é o arquivo.
VACUUM (ANALYZE) "OmieTitulo";
VACUUM (ANALYZE) "OmieBaixa";
VACUUM (ANALYZE) "OmieMovimento";
VACUUM (ANALYZE) "OmieNota";
VACUUM (ANALYZE) "AuditFinding";

-- ---------------------------------------------------------------------------
-- PASSO 6 — Na tela, depois de tudo
-- ---------------------------------------------------------------------------
--   1. Sincronização → "Recalcular resumo mensal", até zerar. O resumo de 2025
--      e 2026 continua válido, mas o recálculo confirma e limpa sobras.
--   2. Sincronização → "Rodar a auditoria de novo" → "Sincronizar agora".
--      A auditoria refaz a leitura sobre a base enxuta; a contagem de achados
--      em aberto deve cair bastante.
--   3. Confira em "Carga histórica" que a barra mostra o período novo.
