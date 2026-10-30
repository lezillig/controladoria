-- Multas: o processo da planilha CONTROLE MULTAS no sistema. Só tabela nova.
-- CreateTable
CREATE TABLE "FrotaMulta" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "veiculoId" TEXT,
    "placa" TEXT NOT NULL,
    "orgao" TEXT NOT NULL,
    "ait" TEXT NOT NULL,
    "dataInfracao" TIMESTAMP(3) NOT NULL,
    "especificacao" TEXT NOT NULL,
    "codigoInfracao" TEXT,
    "pontos" INTEGER,
    "valorCents" INTEGER NOT NULL,
    "incluidaEm" TIMESTAMP(3),
    "origem" TEXT NOT NULL DEFAULT 'manual',
    "condutorPessoaId" TEXT,
    "condutorNome" TEXT,
    "condutorFonte" TEXT,
    "condutorNaoLocalizado" BOOLEAN NOT NULL DEFAULT false,
    "sugeridoPessoaId" TEXT,
    "sugeridoFonte" TEXT,
    "diarioSolicitadoEm" TIMESTAMP(3),
    "diarioRecebidoEm" TIMESTAMP(3),
    "responsavel" TEXT NOT NULL DEFAULT 'a_definir',
    "termoAssinadoEm" TIMESTAMP(3),
    "termoRecusado" BOOLEAN NOT NULL DEFAULT false,
    "prazoIndicacao" TIMESTAMP(3),
    "indicadoEm" TIMESTAMP(3),
    "vencimentoBoleto" TIMESTAMP(3),
    "pagoEm" TIMESTAMP(3),
    "tituloOmieId" TEXT,
    "descontoCompetencia" TIMESTAMP(3),
    "descontoValorCents" INTEGER,
    "ehNic" BOOLEAN NOT NULL DEFAULT false,
    "nicDeId" TEXT,
    "situacao" TEXT NOT NULL DEFAULT 'aberta',
    "observacao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FrotaMulta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FrotaMulta_companyId_situacao_idx" ON "FrotaMulta"("companyId", "situacao");

-- CreateIndex
CREATE INDEX "FrotaMulta_companyId_condutorPessoaId_dataInfracao_idx" ON "FrotaMulta"("companyId", "condutorPessoaId", "dataInfracao");

-- CreateIndex
CREATE UNIQUE INDEX "FrotaMulta_companyId_ait_key" ON "FrotaMulta"("companyId", "ait");

-- AddForeignKey
ALTER TABLE "FrotaMulta" ADD CONSTRAINT "FrotaMulta_veiculoId_fkey" FOREIGN KEY ("veiculoId") REFERENCES "CadVeiculo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FrotaMulta" ADD CONSTRAINT "FrotaMulta_condutorPessoaId_fkey" FOREIGN KEY ("condutorPessoaId") REFERENCES "CadPessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FrotaMulta" ADD CONSTRAINT "FrotaMulta_nicDeId_fkey" FOREIGN KEY ("nicDeId") REFERENCES "FrotaMulta"("id") ON DELETE SET NULL ON UPDATE CASCADE;
