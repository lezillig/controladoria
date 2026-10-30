-- Sugestão de "quem é o banco na Omie" recusada pelo financeiro: não volta.
ALTER TABLE "FrotaInstituicaoParceiro" ADD COLUMN "rejeitado" BOOLEAN NOT NULL DEFAULT false;

-- Quem recebe os avisos diários da frota (documentos, apólices, parcelas).
ALTER TABLE "ControladoriaConfig" ADD COLUMN "emailsFrota" TEXT NOT NULL DEFAULT '';
