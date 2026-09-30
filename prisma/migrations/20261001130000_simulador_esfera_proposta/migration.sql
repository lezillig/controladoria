-- Público ou privado, e os dados da proposta comercial (estudos privados).
ALTER TABLE "SimEstudo" ADD COLUMN "esfera" TEXT NOT NULL DEFAULT 'PRIVADO';
ALTER TABLE "SimEstudo" ADD COLUMN "clienteDocumento" TEXT;
ALTER TABLE "SimEstudo" ADD COLUMN "contatoCliente" TEXT;
ALTER TABLE "SimEstudo" ADD COLUMN "validadeProposta" TIMESTAMP(3);
ALTER TABLE "SimEstudo" ADD COLUMN "inicioPrevisto" TIMESTAMP(3);
ALTER TABLE "SimEstudo" ADD COLUMN "formaFaturamento" TEXT;
ALTER TABLE "SimEstudo" ADD COLUMN "avisoRescisaoDias" INTEGER;

-- Estudos já criados: licitação é público; o resto, privado.
UPDATE "SimEstudo" SET "esfera" = 'PUBLICO' WHERE "tipo" = 'LICITACAO';
