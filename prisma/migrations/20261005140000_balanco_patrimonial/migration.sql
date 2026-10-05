-- Balanço por data-base, para os indicadores de retorno.
CREATE TABLE "BalancoPatrimonial" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "escopo" TEXT NOT NULL DEFAULT 'GRUPO',
    "dataBase" DATE NOT NULL,
    "caixa" DECIMAL(18,2) NOT NULL,
    "contasReceber" DECIMAL(18,2) NOT NULL,
    "ativoCirculante" DECIMAL(18,2) NOT NULL,
    "imobilizadoLiquido" DECIMAL(18,2) NOT NULL,
    "ativoTotal" DECIMAL(18,2) NOT NULL,
    "fornecedores" DECIMAL(18,2) NOT NULL,
    "passivoCirculante" DECIMAL(18,2) NOT NULL,
    "dividaCurtoPrazo" DECIMAL(18,2) NOT NULL,
    "dividaLongoPrazo" DECIMAL(18,2) NOT NULL,
    "patrimonioLiquido" DECIMAL(18,2) NOT NULL,
    "depreciacaoAno" DECIMAL(18,2),
    "lucroLiquidoAno" DECIMAL(18,2),
    "custoCapitalAa" DECIMAL(8,6) NOT NULL DEFAULT 0.18,
    "frotaVeiculos" INTEGER,
    "kmAno" DECIMAL(18,2),
    "observacao" TEXT,
    "autorNome" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BalancoPatrimonial_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BalancoPatrimonial_companyId_escopo_dataBase_key" ON "BalancoPatrimonial"("companyId", "escopo", "dataBase");
