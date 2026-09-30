-- Turnos por dia e uso administrativo (veículo à disposição) da rota do estudo.
ALTER TABLE "SimRota" ADD COLUMN "turnos" INTEGER;
ALTER TABLE "SimRota" ADD COLUMN "administrativo" BOOLEAN NOT NULL DEFAULT false;
