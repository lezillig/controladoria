-- QUANDO O FORNECEDOR PASSOU A EXISTIR.
--
-- `sincronizadoEm` é reescrito a cada sincronização, então a regra que procura
-- empresa de fachada (FR-FORNECEDOR-NOVO-ALTO) via TODO fornecedor como
-- cadastrado hoje — e, na prática, deixava de ser uma regra sobre cadastro novo
-- para virar uma regra sobre volume alto.
--
-- Duas colunas, e as duas NULAS por padrão de propósito:
--
--   dataCadastroOmie — a data real, vinda do `info.dInc` da Omie. Preenche na
--   próxima sincronização de cadastros, para todos os parceiros.
--
--   primeiraVezEm — quando o espelho viu a linha pela primeira vez. Gravada só
--   na criação e nunca atualizada.
--
-- NÃO se faz backfill com NOW() aqui. Seria transformar toda a base em
-- "fornecedor novo hoje" e disparar a regra para todo mundo de uma vez — que é
-- justamente o defeito que esta migração existe para corrigir. Linha antiga
-- fica NULA, e a regra se cala sobre ela.

ALTER TABLE "OmieParceiro" ADD COLUMN "dataCadastroOmie" TIMESTAMP(3);
ALTER TABLE "OmieParceiro" ADD COLUMN "primeiraVezEm" TIMESTAMP(3);
