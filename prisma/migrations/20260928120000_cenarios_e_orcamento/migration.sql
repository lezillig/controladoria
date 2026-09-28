-- Cenários (premissas declaradas sobre a projeção base) e orçamento por linha
-- do DRE e mês, para o orçado × realizado. Ver projecao.ts.
CREATE TABLE "Cenario" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "escopo" TEXT NOT NULL DEFAULT 'GRUPO',
    "nome" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'SIMULACAO',
    "baseReceita" TEXT NOT NULL DEFAULT 'HISTORICA',
    "premissas" JSONB NOT NULL DEFAULT '[]',
    "observacao" TEXT,
    "criadoPorNome" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cenario_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Cenario_companyId_escopo_idx" ON "Cenario"("companyId", "escopo");

CREATE TABLE "OrcamentoLinha" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "escopo" TEXT NOT NULL DEFAULT 'GRUPO',
    "ano" INTEGER NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "linha" TEXT NOT NULL,
    "competencia" TEXT NOT NULL,
    "valorCents" INTEGER NOT NULL,
    "origem" TEXT NOT NULL DEFAULT 'CENARIO',
    "cenarioId" TEXT,
    "criadoPorNome" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrcamentoLinha_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrcamentoLinha_companyId_escopo_ano_versao_linha_competencia_key" ON "OrcamentoLinha"("companyId", "escopo", "ano", "versao", "linha", "competencia");
CREATE INDEX "OrcamentoLinha_companyId_escopo_ano_idx" ON "OrcamentoLinha"("companyId", "escopo", "ano");

ALTER TABLE "OrcamentoLinha" ADD CONSTRAINT "OrcamentoLinha_cenarioId_fkey" FOREIGN KEY ("cenarioId") REFERENCES "Cenario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
