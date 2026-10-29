-- A fase de exclusões passou a conferir o a pagar pelo VENCIMENTO e a limpar
-- as baixas que a Omie não tem mais (estornos e baixas em dobro). Zerar a
-- marca da varredura faz o próximo ciclo diário revarrer desde jan/2025.
UPDATE "OmieConexao" SET "exclusoesVarridasEm" = NULL;
