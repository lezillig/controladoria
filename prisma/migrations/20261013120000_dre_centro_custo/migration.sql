-- DRE por centro de custo: quadro de pessoal mensal (sem CPF/RG/PIS),
-- centros de custo e vínculos com as origens da Omie.
CREATE TABLE "FolhaQuadro" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "conexaoId" TEXT NOT NULL,
    "empresaCodigo" TEXT NOT NULL,
    "competencia" DATE NOT NULL,
    "arquivoNome" TEXT NOT NULL,
    "pessoas" INTEGER NOT NULL,
    "salarioCents" INTEGER NOT NULL,
    "importadoPorNome" TEXT,
    "importadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FolhaQuadro_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FolhaQuadro_conexaoId_competencia_key" ON "FolhaQuadro"("conexaoId", "competencia");
CREATE INDEX "FolhaQuadro_companyId_competencia_idx" ON "FolhaQuadro"("companyId", "competencia");

CREATE TABLE "FolhaPessoa" (
    "id" TEXT NOT NULL,
    "quadroId" TEXT NOT NULL,
    "matricula" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cargo" TEXT,
    "categoria" TEXT,
    "admissao" DATE,
    "salarioCents" INTEGER NOT NULL,
    "centroCustoCodigo" TEXT NOT NULL,
    "centroCustoDescricao" TEXT NOT NULL,
    "servico" TEXT,
    "departamento" TEXT,
    "sindicato" TEXT,

    CONSTRAINT "FolhaPessoa_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FolhaPessoa_quadroId_centroCustoCodigo_idx" ON "FolhaPessoa"("quadroId", "centroCustoCodigo");
ALTER TABLE "FolhaPessoa" ADD CONSTRAINT "FolhaPessoa_quadroId_fkey" FOREIGN KEY ("quadroId") REFERENCES "FolhaQuadro"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CentroCusto" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "conexaoId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'OPERACIONAL',
    "observacao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CentroCusto_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CentroCusto_conexaoId_codigo_key" ON "CentroCusto"("conexaoId", "codigo");
CREATE INDEX "CentroCusto_companyId_idx" ON "CentroCusto"("companyId");

CREATE TABLE "CentroCustoVinculo" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "centroCustoId" TEXT NOT NULL,
    "conexaoId" TEXT NOT NULL,
    "tipoOrigem" TEXT NOT NULL,
    "valorOrigem" TEXT NOT NULL,
    "rotuloOrigem" TEXT,
    "percentual" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "criadoPorNome" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CentroCustoVinculo_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CentroCustoVinculo_centroCustoId_tipoOrigem_conexaoId_valorOrigem_key" ON "CentroCustoVinculo"("centroCustoId", "tipoOrigem", "conexaoId", "valorOrigem");
CREATE INDEX "CentroCustoVinculo_companyId_conexaoId_idx" ON "CentroCustoVinculo"("companyId", "conexaoId");
ALTER TABLE "CentroCustoVinculo" ADD CONSTRAINT "CentroCustoVinculo_centroCustoId_fkey" FOREIGN KEY ("centroCustoId") REFERENCES "CentroCusto"("id") ON DELETE CASCADE ON UPDATE CASCADE;
