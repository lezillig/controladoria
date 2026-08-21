-- Batimento da execução do ciclo (OmieSyncRun.atualizadoEm).
--
-- Em três passos, e não num ALTER só, porque a tabela já tem linhas em
-- produção: uma coluna NOT NULL sem default falharia na hora de aplicar.
-- O preenchimento usa o horário real que cada execução já conhece, em vez de
-- carimbar todas com "agora" — o que faria execuções antigas parecerem
-- recém-ativas justamente na tela que existe para distinguir viva de travada.
--
-- Sem DEFAULT ao final, de propósito: quem escreve esta coluna é o
-- @updatedAt do Prisma. Um default no banco divergiria do schema e apareceria
-- como drift na próxima migração.
ALTER TABLE "OmieSyncRun" ADD COLUMN "atualizadoEm" TIMESTAMP(3);

UPDATE "OmieSyncRun" SET "atualizadoEm" = COALESCE("finalizadoEm", "iniciadoEm");

ALTER TABLE "OmieSyncRun" ALTER COLUMN "atualizadoEm" SET NOT NULL;
