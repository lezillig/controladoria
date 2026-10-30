-- Motoristas: documentos com validade e férias (src/lib/pessoas). Só tabelas
-- e colunas novas.
-- AlterTable
ALTER TABLE "CadPessoa" ADD COLUMN     "transportaEscolar" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ControladoriaConfig" ADD COLUMN     "emailsPessoas" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "PesDocumento" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "pessoaId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "validade" TIMESTAMP(3),
    "situacao" TEXT NOT NULL DEFAULT 'vigente',
    "categoria" TEXT,
    "ear" BOOLEAN,
    "observacao" TEXT,
    "atualizadoPor" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PesDocumento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PesFerias" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "pessoaId" TEXT NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3) NOT NULL,
    "abonoDias" INTEGER NOT NULL DEFAULT 0,
    "origem" TEXT NOT NULL,
    "origemId" TEXT,
    "observacao" TEXT,
    "registradoPor" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PesFerias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PesDocumento_companyId_tipo_validade_idx" ON "PesDocumento"("companyId", "tipo", "validade");

-- CreateIndex
CREATE UNIQUE INDEX "PesDocumento_pessoaId_tipo_key" ON "PesDocumento"("pessoaId", "tipo");

-- CreateIndex
CREATE INDEX "PesFerias_companyId_inicio_idx" ON "PesFerias"("companyId", "inicio");

-- CreateIndex
CREATE UNIQUE INDEX "PesFerias_pessoaId_inicio_key" ON "PesFerias"("pessoaId", "inicio");

-- AddForeignKey
ALTER TABLE "PesDocumento" ADD CONSTRAINT "PesDocumento_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "CadPessoa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PesFerias" ADD CONSTRAINT "PesFerias_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "CadPessoa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
