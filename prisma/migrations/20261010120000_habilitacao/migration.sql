-- Documentos de habilitação do estudo (lidos do edital ou acrescentados).
CREATE TABLE "SimDocumentoHabilitacao" (
    "id" TEXT NOT NULL,
    "estudoId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "grupo" TEXT NOT NULL,
    "documento" TEXT NOT NULL,
    "exigencia" TEXT,
    "fonte" TEXT,
    "situacao" TEXT NOT NULL DEFAULT 'PENDENTE',
    "validade" DATE,
    "observacao" TEXT,
    "atualizadoPor" TEXT,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimDocumentoHabilitacao_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SimDocumentoHabilitacao_estudoId_grupo_ordem_idx" ON "SimDocumentoHabilitacao"("estudoId", "grupo", "ordem");

ALTER TABLE "SimDocumentoHabilitacao" ADD CONSTRAINT "SimDocumentoHabilitacao_estudoId_fkey" FOREIGN KEY ("estudoId") REFERENCES "SimEstudo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
