-- Retomada da sincronização do dia que caiu por erro de execução.
ALTER TABLE "OmieSyncRun" ADD COLUMN "retomadas" INTEGER NOT NULL DEFAULT 0;
