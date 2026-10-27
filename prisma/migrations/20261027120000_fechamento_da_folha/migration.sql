-- Fechamento da folha: marcas do checklist mensal (fluxograma validado).
CREATE TABLE "FolhaFechamentoMarca" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "conexaoId" TEXT NOT NULL,
    "competencia" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "feitoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "feitoPor" TEXT,
    "observacao" TEXT,

    CONSTRAINT "FolhaFechamentoMarca_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FolhaFechamentoMarca_companyId_conexaoId_competencia_chave_key" ON "FolhaFechamentoMarca"("companyId", "conexaoId", "competencia", "chave");
CREATE INDEX "FolhaFechamentoMarca_companyId_competencia_idx" ON "FolhaFechamentoMarca"("companyId", "competencia");
