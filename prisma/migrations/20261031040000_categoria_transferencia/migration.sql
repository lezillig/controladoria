-- A marca de "categoria de transferência" da Omie. Só coluna nova; a próxima
-- sincronização diária dos cadastros preenche.
-- AlterTable
ALTER TABLE "OmieCategoria" ADD COLUMN     "transferencia" BOOLEAN NOT NULL DEFAULT false;
