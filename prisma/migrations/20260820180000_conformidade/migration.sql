-- CreateEnum
CREATE TYPE "ConformidadeOrigem" AS ENUM ('CONSULTORIA', 'CONTABILIDADE', 'AUDITORIA_EXTERNA', 'FISCALIZACAO', 'JURIDICO', 'INTERNO');

-- CreateEnum
CREATE TYPE "ConformidadeArea" AS ENUM ('FISCAL', 'TRABALHISTA', 'PREVIDENCIARIO', 'CONTABIL', 'FINANCEIRO', 'SOCIETARIO', 'REGULATORIO', 'CONTRATUAL', 'LGPD', 'OUTRO');

-- CreateEnum
CREATE TYPE "ConformidadeExtracao" AS ENUM ('PENDENTE', 'EXTRAIDO', 'MANUAL', 'ERRO');

-- CreateEnum
CREATE TYPE "ConformidadeStatus" AS ENUM ('ABERTO', 'EM_TRATATIVA', 'RESOLVIDO', 'ACEITO_COM_RISCO', 'NAO_SE_APLICA');

-- CreateTable
CREATE TABLE "ConformidadeDocumento" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "conexaoId" TEXT,
    "conexaoApelido" TEXT,
    "titulo" TEXT NOT NULL,
    "origem" "ConformidadeOrigem" NOT NULL DEFAULT 'CONSULTORIA',
    "emissor" TEXT,
    "competencia" TIMESTAMP(3) NOT NULL,
    "dataDocumento" TIMESTAMP(3),
    "arquivoNome" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "tamanhoBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "conteudo" BYTEA NOT NULL,
    "textoExtraido" TEXT,
    "extracao" "ConformidadeExtracao" NOT NULL DEFAULT 'PENDENTE',
    "extracaoErro" TEXT,
    "extraidoEm" TIMESTAMP(3),
    "resumo" TEXT,
    "enviadoPorUserId" TEXT,
    "enviadoPorNome" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConformidadeDocumento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConformidadeApontamento" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "conexaoId" TEXT,
    "conexaoApelido" TEXT,
    "documentoId" TEXT,
    "competencia" TIMESTAMP(3) NOT NULL,
    "area" "ConformidadeArea" NOT NULL DEFAULT 'OUTRO',
    "severidade" "AuditSeveridade" NOT NULL DEFAULT 'MEDIA',
    "titulo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "recomendacao" TEXT,
    "trechoOrigem" TEXT,
    "paginaOrigem" TEXT,
    "valorEnvolvidoCents" INTEGER,
    "status" "ConformidadeStatus" NOT NULL DEFAULT 'ABERTO',
    "responsavel" TEXT,
    "prazo" TIMESTAMP(3),
    "observacaoTratativa" TEXT,
    "tratadoPorUserId" TEXT,
    "resolvidoEm" TIMESTAMP(3),
    "propostoPorIa" BOOLEAN NOT NULL DEFAULT false,
    "validado" BOOLEAN NOT NULL DEFAULT false,
    "validadoPorUserId" TEXT,
    "validadoEm" TIMESTAMP(3),
    "chaveRecorrencia" TEXT NOT NULL,
    "primeiraCompetencia" TIMESTAMP(3) NOT NULL,
    "ocorrencias" INTEGER NOT NULL DEFAULT 1,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConformidadeApontamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConformidadeVinculo" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "apontamentoId" TEXT NOT NULL,
    "achadoId" TEXT NOT NULL,
    "achadoChave" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'CONFIRMA',
    "automatico" BOOLEAN NOT NULL DEFAULT true,
    "pontuacao" INTEGER NOT NULL DEFAULT 0,
    "confirmadoPorUserId" TEXT,
    "confirmadoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConformidadeVinculo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConformidadeDocumento_companyId_competencia_idx" ON "ConformidadeDocumento"("companyId", "competencia");

-- CreateIndex
CREATE UNIQUE INDEX "ConformidadeDocumento_companyId_sha256_key" ON "ConformidadeDocumento"("companyId", "sha256");

-- CreateIndex
CREATE INDEX "ConformidadeApontamento_companyId_status_severidade_idx" ON "ConformidadeApontamento"("companyId", "status", "severidade");

-- CreateIndex
CREATE INDEX "ConformidadeApontamento_companyId_competencia_idx" ON "ConformidadeApontamento"("companyId", "competencia");

-- CreateIndex
CREATE INDEX "ConformidadeApontamento_companyId_chaveRecorrencia_idx" ON "ConformidadeApontamento"("companyId", "chaveRecorrencia");

-- CreateIndex
CREATE INDEX "ConformidadeApontamento_documentoId_idx" ON "ConformidadeApontamento"("documentoId");

-- CreateIndex
CREATE INDEX "ConformidadeVinculo_companyId_idx" ON "ConformidadeVinculo"("companyId");

-- CreateIndex
CREATE INDEX "ConformidadeVinculo_achadoId_idx" ON "ConformidadeVinculo"("achadoId");

-- CreateIndex
CREATE UNIQUE INDEX "ConformidadeVinculo_apontamentoId_achadoId_key" ON "ConformidadeVinculo"("apontamentoId", "achadoId");

-- AddForeignKey
ALTER TABLE "ConformidadeDocumento" ADD CONSTRAINT "ConformidadeDocumento_conexaoId_fkey" FOREIGN KEY ("conexaoId") REFERENCES "OmieConexao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConformidadeApontamento" ADD CONSTRAINT "ConformidadeApontamento_conexaoId_fkey" FOREIGN KEY ("conexaoId") REFERENCES "OmieConexao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConformidadeApontamento" ADD CONSTRAINT "ConformidadeApontamento_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "ConformidadeDocumento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConformidadeVinculo" ADD CONSTRAINT "ConformidadeVinculo_apontamentoId_fkey" FOREIGN KEY ("apontamentoId") REFERENCES "ConformidadeApontamento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConformidadeVinculo" ADD CONSTRAINT "ConformidadeVinculo_achadoId_fkey" FOREIGN KEY ("achadoId") REFERENCES "AuditFinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

