-- NFS-e com ISS retido pelo tomador. Sustenta FI-ISS-RECOLHIDO-A-MENOR: a
-- conta do ISS que a empresa recolhe só pode somar as notas em que o ISS
-- não foi retido. Nulo = a nota não informou.
ALTER TABLE "OmieNota" ADD COLUMN "issRetido" BOOLEAN;
