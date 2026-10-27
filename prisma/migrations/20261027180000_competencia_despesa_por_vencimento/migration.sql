-- Competência: despesa (a pagar) pelo VENCIMENTO, receita pela EMISSÃO da nota
-- (decisão de 27/10/2026, ver src/lib/controladoria/competencia.ts). Os índices
-- por expressão acompanham a expressão nova; os antigos ficam até não serem
-- mais usados por nenhuma consulta.
CREATE INDEX IF NOT EXISTS "OmieTitulo_competencia_v2_idx"
    ON "OmieTitulo" ("companyId", natureza, (CASE WHEN natureza = 'PAGAR' THEN "dataVencimento" ELSE COALESCE("dataEmissao", "dataVencimento") END));

CREATE INDEX IF NOT EXISTS "OmieTitulo_competencia_empresa_v2_idx"
    ON "OmieTitulo" ("companyId", (CASE WHEN natureza = 'PAGAR' THEN "dataVencimento" ELSE COALESCE("dataEmissao", "dataVencimento") END));

-- O resumo mensal é derivado dos títulos e foi calculado pela regra antiga.
-- Apagado aqui, o ciclo o refaz pela regra nova (recalcularPendentes, do mais
-- recente para o mais antigo) nas rodadas seguintes.
DELETE FROM "HistoricoMensal";
