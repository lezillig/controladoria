-- E-mail do radar de licitações: destinatários próprios e marca de aviso.
ALTER TABLE "ControladoriaConfig" ADD COLUMN "emailsRadar" TEXT NOT NULL DEFAULT '';
ALTER TABLE "RadarLicitacao" ADD COLUMN "avisadoEm" TIMESTAMP(3);
