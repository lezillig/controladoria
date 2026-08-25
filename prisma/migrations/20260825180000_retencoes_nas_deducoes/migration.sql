-- RETENÇÕES NA FONTE DENTRO DAS DEDUÇÕES DO DRE — ligado/desligado.
--
-- A empresa confirmou que a Omie guarda os tributos retidos separados dos
-- títulos de imposto, o que significa que os dois se COMPLETAM: o retido o
-- cliente recolheu, o do título a empresa recolhe. Somados, dão a carga
-- tributária real do faturamento.
--
-- Fica como interruptor, e não embutido, porque a alternativa é indistinguível
-- pelo dado: se em algum momento a empresa passar a lançar o imposto cheio e
-- abater a retenção ao recolher, somar as duas coisas contaria o mesmo imposto
-- duas vezes — e o erro apareceria como margem pior, que é o tipo de número que
-- ninguém questiona. Um interruptor deixa a conferência do contador virar um
-- clique em vez de uma publicação.
--
-- Padrão LIGADO: é a leitura correta para o arranjo atual.

-- AlterTable
ALTER TABLE "ControladoriaConfig" ADD COLUMN "retencoesNasDeducoes" BOOLEAN NOT NULL DEFAULT true;
