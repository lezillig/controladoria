-- CreateTable
CREATE TABLE "FalhaDeServidor" (
    "id" TEXT NOT NULL,
    "digest" TEXT,
    "origem" TEXT,
    "rota" TEXT,
    "metodo" TEXT,
    "mensagem" TEXT NOT NULL,
    "pilha" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FalhaDeServidor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FalhaDeServidor_criadoEm_idx" ON "FalhaDeServidor"("criadoEm");

-- CreateIndex
CREATE INDEX "FalhaDeServidor_digest_idx" ON "FalhaDeServidor"("digest");
