-- QUAL VERSÃO ESTAVA NO AR QUANDO A FALHA ACONTECEU.
--
-- O painel de falhas mostrou o mesmo erro de `/resultados` três vezes, e o
-- usuário voltou a reportá-lo duas vezes — depois de a correção já estar no
-- ar. Os registros eram de 16:10 e 16:19; o conserto subiu às 20:56 do mesmo
-- dia. A informação que faltava para saber isso de olho não estava na tela.
--
-- Um painel de erros que não distingue "já corrigido" de "acontecendo agora"
-- gasta a atenção de quem lê e, pior, ensina a ignorá-lo. Guardar o commit do
-- build torna a distinção um fato, não uma conta de cabeça entre o horário do
-- registro e o horário da última publicação.
--
-- Nulo nas linhas antigas, de propósito: elas foram gravadas antes desta
-- coluna existir, e inventar um valor seria pior que a ausência. A tela usa a
-- data como critério de reserva nesses casos.

-- AlterTable
ALTER TABLE "FalhaDeServidor" ADD COLUMN     "commitDoBuild" TEXT;
