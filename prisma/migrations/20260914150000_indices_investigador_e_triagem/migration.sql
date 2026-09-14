-- ÍNDICES MEDIDOS, NÃO SUPOSTOS.
--
-- Cada um abaixo veio de um EXPLAIN ANALYZE sobre uma base sintética de 50 e
-- 100 mil títulos, com o tempo antes e depois. O que não mudou o plano ficou
-- de fora: um índice em (companyId, dataVencimento) para a consulta do
-- contexto, por exemplo, não ajuda — metade das linhas satisfaz a janela e o
-- Postgres prefere varrer a tabela (42 ms → 43 ms).

-- O investigador (IA) busca título por documento do parceiro, por número do
-- documento e por projeto (ordem de serviço). Sem índice, cada pergunta era
-- uma varredura de 50 mil linhas (8–9 ms, crescendo com a base); com ele,
-- 0,04 ms. A conferência de CT-e usa o número do documento pelo mesmo caminho.
CREATE INDEX IF NOT EXISTS "OmieTitulo_companyId_parceiroDocumento_idx"
    ON "OmieTitulo" ("companyId", "parceiroDocumento");
CREATE INDEX IF NOT EXISTS "OmieTitulo_companyId_numeroDocumento_idx"
    ON "OmieTitulo" ("companyId", "numeroDocumento");
CREATE INDEX IF NOT EXISTS "OmieTitulo_companyId_projetoCodigo_idx"
    ON "OmieTitulo" ("companyId", "projetoCodigo");

-- A triagem por regra (filtro ?regra=, tratativa em lote, exportação CSV):
-- 15 ms → 9 ms na varredura de achados, e cresce linearmente sem isto.
CREATE INDEX IF NOT EXISTS "AuditFinding_companyId_regra_status_idx"
    ON "AuditFinding" ("companyId", "regra", "status");

-- O resumo mensal por competência SEM natureza (recalcularDimensao,
-- serieMensal, resumoDoPeriodoNoBanco). O índice de competência existente
-- começa por (companyId, natureza, expr) e não serve a uma consulta sem
-- predicado de natureza: o planejador varria a tabela — 20,7 ms por
-- competência, vezes 136 competências, vezes duas dimensões, a cada
-- recálculo. Com o índice sem natureza: 11,8 ms.
CREATE INDEX IF NOT EXISTS "OmieTitulo_competencia_sem_natureza_idx"
    ON "OmieTitulo" ("companyId", (COALESCE("dataEmissao", "dataVencimento")));

-- O schema declara @@index([companyId, dataEmissao]) desde a migração dos
-- índices do contexto, mas aquela migração o criou com outro nome
-- ("OmieTitulo_emissao_idx"). Fica o nome que o Prisma espera, para o
-- próximo `migrate dev` não criar um duplicado — e o antigo sai, porque os
-- dois seriam o mesmo índice cobrando duas vezes a cada escrita.
CREATE INDEX IF NOT EXISTS "OmieTitulo_companyId_dataEmissao_idx"
    ON "OmieTitulo" ("companyId", "dataEmissao");
DROP INDEX IF EXISTS "OmieTitulo_emissao_idx";
