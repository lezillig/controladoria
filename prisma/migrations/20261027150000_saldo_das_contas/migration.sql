-- Saldo das contas: o que a Omie calcula (cabeçalho do extrato) e o informado à mão.
ALTER TABLE "OmieContaCorrente"
  ADD COLUMN "tipoCodigo" TEXT,
  ADD COLUMN "tipoDescricao" TEXT,
  ADD COLUMN "saldoOmieCents" INTEGER,
  ADD COLUMN "saldoConciliadoOmieCents" INTEGER,
  ADD COLUMN "saldoDisponivelOmieCents" INTEGER,
  ADD COLUMN "limiteCreditoCents" INTEGER,
  ADD COLUMN "saldoOmieEm" TIMESTAMP(3);

CREATE TABLE "SaldoBancarioInformado" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "conexaoId" TEXT NOT NULL,
    "contaCodigo" TEXT,
    "descricao" TEXT NOT NULL,
    "aplicacao" BOOLEAN NOT NULL DEFAULT false,
    "data" DATE NOT NULL,
    "valorCents" BIGINT NOT NULL,
    "autorNome" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaldoBancarioInformado_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SaldoBancarioInformado_companyId_conexaoId_idx" ON "SaldoBancarioInformado"("companyId", "conexaoId");
