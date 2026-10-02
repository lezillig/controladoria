-- Título excluído na Omie: visto na listagem do mês, exclusão confirmada, e
-- a varredura histórica por conexão.
ALTER TABLE "OmieTitulo" ADD COLUMN "vistoNaListagemEm" TIMESTAMP(3);
ALTER TABLE "OmieTitulo" ADD COLUMN "excluidoNaOmieEm" TIMESTAMP(3);
ALTER TABLE "OmieConexao" ADD COLUMN "exclusoesVarridasEm" TIMESTAMP(3);
