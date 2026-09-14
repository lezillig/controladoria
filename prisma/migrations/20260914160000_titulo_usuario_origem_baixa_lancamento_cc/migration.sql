-- O QUE A OMIE JÁ DEVOLVE E O ESPELHO NÃO GUARDAVA.
--
-- No título: quem incluiu e quem alterou (bloco `info`, com `lDadosCad`), a
-- data real de inclusão, a chave da NF-e/CT-e de origem, a origem do
-- lançamento (manual x nota x extrato), contrato e ordem de serviço. É o dado
-- da segregação de funções e do "alterado depois de pago".
--
-- Na baixa: `nIdLancCC`, o lançamento na conta corrente que ela gerou — a
-- ligação exata com a linha do extrato, que dispensa casar por valor e data.
--
-- Todas nulas: as linhas já espelhadas só ganham o dado quando a janela
-- delas for relida (ciclo diário para as recentes; "Reler um período" para as
-- antigas).

ALTER TABLE "OmieTitulo"
    ADD COLUMN IF NOT EXISTS "usuarioInclusao" TEXT,
    ADD COLUMN IF NOT EXISTS "usuarioAlteracao" TEXT,
    ADD COLUMN IF NOT EXISTS "dataInclusaoOmie" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "chaveNfe" TEXT,
    ADD COLUMN IF NOT EXISTS "origemLancamento" TEXT,
    ADD COLUMN IF NOT EXISTS "contratoCodigo" TEXT,
    ADD COLUMN IF NOT EXISTS "ordemServicoCodigo" TEXT;

ALTER TABLE "OmieBaixa"
    ADD COLUMN IF NOT EXISTS "lancamentoCCCodigo" TEXT;
