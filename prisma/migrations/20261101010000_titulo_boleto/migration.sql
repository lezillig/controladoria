-- O boleto do título a pagar (antifraude de boleto frio). Sem o código
-- inteiro: o campo livre traz agência e conta do beneficiário.
ALTER TABLE "OmieTitulo" ADD COLUMN "boletoHash" TEXT;
ALTER TABLE "OmieTitulo" ADD COLUMN "boletoBanco" TEXT;
ALTER TABLE "OmieTitulo" ADD COLUMN "boletoValorCents" INTEGER;
ALTER TABLE "OmieTitulo" ADD COLUMN "boletoVencimento" TIMESTAMP(3);
ALTER TABLE "OmieTitulo" ADD COLUMN "boletoDigitoValido" BOOLEAN;

CREATE INDEX "OmieTitulo_companyId_boletoHash_idx" ON "OmieTitulo"("companyId", "boletoHash");
