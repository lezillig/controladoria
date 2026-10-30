-- Multas: ciclo fechado com o pagamento (Omie) e o desconto (folha). Só
-- colunas e tabela novas.
-- AlterTable
ALTER TABLE "FrotaMulta" ADD COLUMN     "descontoConferidoEm" TIMESTAMP(3),
ADD COLUMN     "descontoConferidoValorCents" INTEGER,
ADD COLUMN     "descontoEnviadoEm" TIMESTAMP(3),
ADD COLUMN     "recursoFase" TEXT,
ADD COLUMN     "recursoProtocoladoEm" TIMESTAMP(3),
ADD COLUMN     "recursoResultado" TEXT,
ADD COLUMN     "responsabilidadeInfracao" TEXT NOT NULL DEFAULT 'condutor',
ADD COLUMN     "semDesconto" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "semDescontoMotivo" TEXT,
ADD COLUMN     "valorPagoCents" INTEGER;

-- CreateTable
CREATE TABLE "PesFolhaEventoMulta" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "competencia" TIMESTAMP(3) NOT NULL,
    "matricula" TEXT,
    "nome" TEXT NOT NULL,
    "pessoaId" TEXT,
    "evento" TEXT NOT NULL,
    "valorCents" INTEGER NOT NULL,
    "arquivoNome" TEXT NOT NULL,
    "importadoPor" TEXT,
    "importadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PesFolhaEventoMulta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PesFolhaEventoMulta_companyId_competencia_idx" ON "PesFolhaEventoMulta"("companyId", "competencia");
