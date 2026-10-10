-- Arquivos do estudo (edital, ata, contrato) e participantes da disputa.
CREATE TABLE "SimArquivo" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "estudoId" TEXT,
    "tipo" TEXT NOT NULL DEFAULT 'EDITAL',
    "nome" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "tamanhoBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "conteudo" BYTEA NOT NULL,
    "enviadoPorNome" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimArquivo_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SimArquivo_estudoId_idx" ON "SimArquivo"("estudoId");
CREATE INDEX "SimArquivo_companyId_estudoId_criadoEm_idx" ON "SimArquivo"("companyId", "estudoId", "criadoEm");
ALTER TABLE "SimArquivo" ADD CONSTRAINT "SimArquivo_estudoId_fkey" FOREIGN KEY ("estudoId") REFERENCES "SimEstudo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SimParticipante" (
    "id" TEXT NOT NULL,
    "estudoId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "empresa" TEXT NOT NULL,
    "cnpj" TEXT,
    "posicao" INTEGER,
    "preco" DECIMAL(18,6),
    "valorTotal" DECIMAL(18,2),
    "situacao" TEXT NOT NULL DEFAULT 'CLASSIFICADA',
    "ehNossa" BOOLEAN NOT NULL DEFAULT false,
    "observacao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimParticipante_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SimParticipante_estudoId_ordem_idx" ON "SimParticipante"("estudoId", "ordem");
CREATE INDEX "SimParticipante_empresa_idx" ON "SimParticipante"("empresa");
ALTER TABLE "SimParticipante" ADD CONSTRAINT "SimParticipante_estudoId_fkey" FOREIGN KEY ("estudoId") REFERENCES "SimEstudo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
