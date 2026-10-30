-- Fluxo de compra de veículo: o pedido e a ligação do veículo ao pedido. Só
-- tabela e coluna novas.
-- AlterTable
ALTER TABLE "CadVeiculo" ADD COLUMN     "compraId" TEXT;

-- CreateTable
CREATE TABLE "FrotaCompra" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'solicitada',
    "tipo" TEXT NOT NULL,
    "marca" TEXT,
    "modelo" TEXT,
    "anoMod" INTEGER,
    "capacidade" INTEGER,
    "categoriaUso" TEXT,
    "quantidade" INTEGER NOT NULL DEFAULT 1,
    "valorUnitarioCents" BIGINT,
    "formaPagamento" TEXT NOT NULL,
    "instituicao" TEXT,
    "fornecedorNome" TEXT,
    "fornecedorDocumento" TEXT,
    "destino" TEXT,
    "justificativa" TEXT NOT NULL,
    "solicitadoPor" TEXT NOT NULL,
    "pendenciaId" TEXT,
    "decididoPor" TEXT,
    "decididoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FrotaCompra_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FrotaCompra_companyId_status_idx" ON "FrotaCompra"("companyId", "status");

-- AddForeignKey
ALTER TABLE "CadVeiculo" ADD CONSTRAINT "CadVeiculo_compraId_fkey" FOREIGN KEY ("compraId") REFERENCES "FrotaCompra"("id") ON DELETE SET NULL ON UPDATE CASCADE;
