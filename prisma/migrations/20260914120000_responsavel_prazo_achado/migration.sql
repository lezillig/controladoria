-- RESPONSÁVEL E PRAZO NO ACHADO.
--
-- Com a lista calibrada, o que sobra é trabalho de gente: cada achado precisa
-- de alguém e de uma data, senão "em análise" vira o lugar onde os achados
-- envelhecem. O responsável é texto livre (nome ou área), porque quem trata
-- nem sempre tem usuário no sistema — o RH e o jurídico recebem a lista
-- exportada, não fazem login.

ALTER TABLE "AuditFinding" ADD COLUMN "responsavel" TEXT;
ALTER TABLE "AuditFinding" ADD COLUMN "prazo" TIMESTAMP(3);
