-- Lucros deliberados a pagar e as linhas do DRE contábil no balanço dos indicadores.
ALTER TABLE "BalancoPatrimonial" ADD COLUMN "dividendosAPagar" DECIMAL(18,2),
ADD COLUMN "receitaLiquidaAno" DECIMAL(18,2),
ADD COLUMN "ebitAno" DECIMAL(18,2),
ADD COLUMN "irCsllAno" DECIMAL(18,2);
