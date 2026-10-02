-- A migração 20261001120000 criou a coluna com padrão mas sem NOT NULL; o
-- schema a declara obrigatória (String[] @default([])), e o painel de esquema
-- da Sincronização apontava a diferença. Nulo, se houver, vira lista vazia.
UPDATE "SimEstudo" SET "tiposVeiculo" = ARRAY[]::TEXT[] WHERE "tiposVeiculo" IS NULL;
ALTER TABLE "SimEstudo" ALTER COLUMN "tiposVeiculo" SET NOT NULL;
