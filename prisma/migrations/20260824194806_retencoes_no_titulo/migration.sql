-- RETENÇÕES NA FONTE NO TÍTULO.
--
-- O diagnóstico das duas contas Omie mostrou que `PesquisarLancamentos` devolve
-- `nValorIR`, `nValorISS`, `nValorPIS`, `nValorCOFINS`, `nValorCSLL` e
-- `nValorINSS` em todo título — e que nada disso estava sendo guardado.
--
-- `DEFAULT 0` e não nulo: a Omie omite o campo quando não há retenção, e
-- ausência significa zero, não desconhecido. Os 46 mil títulos já espelhados
-- nascem com zero e recebem o valor real na próxima passagem da sincronização
-- sobre a janela deles — nenhum precisa ser reimportado à mão.

-- AlterTable
ALTER TABLE "OmieTitulo" ADD COLUMN     "retencaoCofinsCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "retencaoCsllCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "retencaoInssCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "retencaoIrCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "retencaoIssCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "retencaoPisCents" INTEGER NOT NULL DEFAULT 0;
