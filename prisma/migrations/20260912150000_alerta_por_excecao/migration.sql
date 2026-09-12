-- ALERTA POR EXCEÇÃO.
--
-- O relatório diário existe para ser lido todo dia. O alerta existe para o
-- contrário: ficar em silêncio enquanto nada muda, e interromper alguém no
-- dia em que surge um achado crítico ou o caixa projetado fica negativo.
--
-- Duas marcas sustentam o silêncio: cada achado guarda quando foi alertado
-- (alerta uma vez, no dia em que surge, e não todo dia enquanto aberto), e o
-- modelo de gestão guarda quando o alerta de caixa saiu pela última vez
-- (caixa negativo é estado, e estado repetido todo dia vira ruído).

ALTER TABLE "AuditFinding" ADD COLUMN "alertadoEm" TIMESTAMP(3);
ALTER TABLE "ControladoriaConfig" ADD COLUMN "alertaPorExcecao" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ControladoriaConfig" ADD COLUMN "ultimoAlertaCaixaEm" TIMESTAMP(3);
