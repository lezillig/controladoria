-- Quem responde a cada investigação: investigador (o de sempre), auditor,
-- controller, custos ou orcamento. As gravadas até aqui foram todas do
-- investigador, que é o padrão.
ALTER TABLE "Investigacao" ADD COLUMN "especialista" TEXT NOT NULL DEFAULT 'investigador';
