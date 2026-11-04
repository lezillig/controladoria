-- RadarLicitacao.termos nasceu aceitando vazio (lista do Prisma); o sistema
-- exige valor, e a conferência do esquema na Sincronização apontou a
-- diferença. Linha sem termos vira lista vazia antes da restrição.
UPDATE "RadarLicitacao" SET "termos" = ARRAY[]::TEXT[] WHERE "termos" IS NULL;
ALTER TABLE "RadarLicitacao" ALTER COLUMN "termos" SET NOT NULL;
