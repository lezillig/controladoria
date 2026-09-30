-- Dados da empresa para as propostas: endereço da sede, cidade e representante legal.
ALTER TABLE "OmieConexao" ADD COLUMN "endereco" TEXT;
ALTER TABLE "OmieConexao" ADD COLUMN "cidade" TEXT;
ALTER TABLE "OmieConexao" ADD COLUMN "representanteNome" TEXT;
ALTER TABLE "OmieConexao" ADD COLUMN "representanteRg" TEXT;
ALTER TABLE "OmieConexao" ADD COLUMN "representanteCpf" TEXT;
ALTER TABLE "OmieConexao" ADD COLUMN "representanteCargo" TEXT;
