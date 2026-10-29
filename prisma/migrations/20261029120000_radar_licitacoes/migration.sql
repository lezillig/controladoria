-- Radar de licitações do PNCP (spec 07 do plano azul-gestao).
CREATE TABLE "RadarLicitacao" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "numeroControle" TEXT NOT NULL,
    "orgaoCnpj" TEXT NOT NULL,
    "orgaoNome" TEXT NOT NULL,
    "unidadeNome" TEXT,
    "uf" TEXT,
    "municipio" TEXT,
    "modalidade" TEXT NOT NULL,
    "numeroCompra" TEXT,
    "processo" TEXT,
    "objeto" TEXT NOT NULL,
    "valorEstimadoCents" BIGINT,
    "srp" BOOLEAN NOT NULL DEFAULT false,
    "publicadaEm" TIMESTAMP(3) NOT NULL,
    "aberturaPropostaEm" TIMESTAMP(3),
    "encerramentoPropostaEm" TIMESTAMP(3),
    "urlPncp" TEXT NOT NULL,
    "urlOrigem" TEXT,
    "aderencia" TEXT NOT NULL,
    "termos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'NOVA',
    "motivoDescarte" TEXT,
    "decididoPor" TEXT,
    "decididoEm" TIMESTAMP(3),
    "estudoId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RadarLicitacao_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RadarLicitacao_companyId_numeroControle_key" ON "RadarLicitacao"("companyId", "numeroControle");
CREATE INDEX "RadarLicitacao_companyId_status_encerramentoPropostaEm_idx" ON "RadarLicitacao"("companyId", "status", "encerramentoPropostaEm");

CREATE TABLE "RadarVarredura" (
    "companyId" TEXT NOT NULL,
    "ultimoDia" TIMESTAMP(3) NOT NULL,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RadarVarredura_pkey" PRIMARY KEY ("companyId")
);
