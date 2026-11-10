-- IA: o que cada chamada custou (IaUso), os pedidos em lote (IaLote), o
-- parecer mensal do controller (ParecerMensal), e o que a investigação passa
-- a guardar para retomar com segurança, mostrar o andamento e servir de
-- triagem automática. Tudo de acréscimo: nenhuma coluna existente muda.

ALTER TABLE "Investigacao" ADD COLUMN "origem" TEXT NOT NULL DEFAULT 'PESSOA';
ALTER TABLE "Investigacao" ADD COLUMN "achadoId" TEXT;
ALTER TABLE "Investigacao" ADD COLUMN "origemId" TEXT;
ALTER TABLE "Investigacao" ADD COLUMN "recomendacao" TEXT;
ALTER TABLE "Investigacao" ADD COLUMN "avisadaEm" TIMESTAMP(3);
ALTER TABLE "Investigacao" ADD COLUMN "prefixoHash" TEXT;
ALTER TABLE "Investigacao" ADD COLUMN "reinicios" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Investigacao" ADD COLUMN "esforco" TEXT;
ALTER TABLE "Investigacao" ADD COLUMN "andamento" TEXT;
CREATE INDEX "Investigacao_companyId_origem_status_idx" ON "Investigacao"("companyId", "origem", "status");
CREATE INDEX "Investigacao_achadoId_idx" ON "Investigacao"("achadoId");

ALTER TABLE "ControladoriaConfig" ADD COLUMN "iaTetoMensalUsdCents" INTEGER DEFAULT 10000;
ALTER TABLE "ControladoriaConfig" ADD COLUMN "iaTriagemAutomatica" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ControladoriaConfig" ADD COLUMN "iaTriagemPorDia" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "ControladoriaConfig" ADD COLUMN "iaParecerMensalAutomatico" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ControladoriaConfig" ADD COLUMN "iaOrcamentoTokensParecer" INTEGER;

ALTER TABLE "ConformidadeDocumento" ADD COLUMN "conferidoEm" TIMESTAMP(3);
ALTER TABLE "ConformidadeDocumento" ADD COLUMN "conferenciaModelo" TEXT;
ALTER TABLE "ConformidadeDocumento" ADD COLUMN "conferenciaResumo" TEXT;
ALTER TABLE "ConformidadeApontamento" ADD COLUMN "conferencia" TEXT;

CREATE TABLE "IaUso" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "origem" TEXT NOT NULL,
    "referenciaTipo" TEXT,
    "referenciaId" TEXT,
    "modelo" TEXT NOT NULL,
    "userId" TEXT,
    "userNome" TEXT,
    "entradaTokens" INTEGER NOT NULL,
    "cacheLidoTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheGravadoTokens" INTEGER NOT NULL DEFAULT 0,
    "saidaTokens" INTEGER NOT NULL,
    "custoMicroUsd" INTEGER NOT NULL,
    "precoEstimado" BOOLEAN NOT NULL DEFAULT false,
    "lote" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IaUso_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "IaUso_companyId_criadoEm_idx" ON "IaUso"("companyId", "criadoEm");
CREATE INDEX "IaUso_companyId_origem_criadoEm_idx" ON "IaUso"("companyId", "origem", "criadoEm");

CREATE TABLE "IaLote" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "referenciaId" TEXT NOT NULL,
    "batchId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ENVIADO',
    "erro" TEXT,
    "userId" TEXT,
    "userNome" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidoEm" TIMESTAMP(3),

    CONSTRAINT "IaLote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "IaLote_companyId_status_idx" ON "IaLote"("companyId", "status");
CREATE INDEX "IaLote_tipo_referenciaId_idx" ON "IaLote"("tipo", "referenciaId");

CREATE TABLE "ParecerMensal" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "recorte" TEXT NOT NULL,
    "empresa" TEXT NOT NULL,
    "competencia" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AGUARDANDO',
    "briefing" TEXT NOT NULL,
    "parecer" JSONB,
    "modelo" TEXT,
    "erro" TEXT,
    "pedidoPor" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidoEm" TIMESTAMP(3),

    CONSTRAINT "ParecerMensal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ParecerMensal_companyId_recorte_competencia_key" ON "ParecerMensal"("companyId", "recorte", "competencia");
CREATE INDEX "ParecerMensal_companyId_competencia_idx" ON "ParecerMensal"("companyId", "competencia");
