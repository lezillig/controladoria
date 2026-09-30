-- O papel de cada empresa no grupo: OPERACAO (roda a frota) ou CORPORATIVO
-- (estrutura administrativa). Decide em qual das duas linhas de "Despesas com
-- pessoas" do DRE cai a folha de cada título.
ALTER TABLE "OmieConexao" ADD COLUMN "papelNoGrupo" TEXT NOT NULL DEFAULT 'OPERACAO';

-- A MCZ é a empresa corporativa do grupo, dito pela diretoria; a Azul e
-- qualquer outra ficam em OPERACAO até alguém mudar na tela de conexões.
UPDATE "OmieConexao" SET "papelNoGrupo" = 'CORPORATIVO' WHERE UPPER("apelido") LIKE 'MCZ%';
