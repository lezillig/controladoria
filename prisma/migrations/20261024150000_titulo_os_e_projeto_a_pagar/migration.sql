-- Número da ordem de serviço (cNumOS) e conferência do projeto dos títulos a pagar.
ALTER TABLE "OmieTitulo" ADD COLUMN "ordemServicoNumero" TEXT;
ALTER TABLE "OmieTitulo" ADD COLUMN "projetoConferidoEm" TIMESTAMP(3);
CREATE INDEX "OmieTitulo_conexaoId_natureza_projetoConferidoEm_idx" ON "OmieTitulo"("conexaoId", "natureza", "projetoConferidoEm");
