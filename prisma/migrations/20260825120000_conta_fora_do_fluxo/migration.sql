-- CONTA CORRENTE FORA DO RESUMO E DO FLUXO DE CAIXA.
--
-- O cadastro de contas correntes da Omie devolve `nao_resumo` e `nao_fluxo`:
-- marcas que EXCLUEM a conta do resumo de caixa e da projeção de fluxo da
-- própria Omie. O diagnóstico das duas empresas mostrou os dois campos
-- chegando em toda conta, e nenhum dos dois estava sendo guardado.
--
-- Para uma controladoria isso não é preferência de exibição: é uma conta por
-- onde entra e sai dinheiro sem aparecer no relatório de caixa que a empresa
-- lê. Existem usos legítimos — aplicação, conta de cartão, conta de
-- transferência interna — e é exatamente por isso que a marca precisa ficar
-- visível em vez de virar regra automática de suspeita.
--
-- DEFAULT FALSE: ausência da marca significa "entra no fluxo", que é o
-- comportamento padrão da Omie. As contas já espelhadas nascem com falso e
-- recebem o valor real na próxima passagem da sincronização de cadastros.

-- AlterTable
ALTER TABLE "OmieContaCorrente" ADD COLUMN     "naoEntraNoFluxo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "naoEntraNoResumo" BOOLEAN NOT NULL DEFAULT false;
