-- Onde a varredura histórica de exclusões parou quando a Omie limitou o
-- consumo: o ciclo seguinte continua dali (sync.ts, fase `exclusoes`).
ALTER TABLE "OmieConexao" ADD COLUMN "exclusoesCursor" TEXT;
