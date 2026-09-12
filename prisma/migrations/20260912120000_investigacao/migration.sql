-- INVESTIGAÇÃO DA IA GRAVADA PASSO A PASSO.
--
-- A primeira pergunta ao investigador morreu no teto de 60 segundos da
-- hospedagem: a resposta chegou à tela como "An unexpected response was
-- received from the server", sem resultado e sem trilha. Uma investigação são
-- várias chamadas ao modelo, cada uma de dezenas de segundos, e não cabem numa
-- requisição só.
--
-- A tabela é o que permite quebrar a investigação em rodadas: cada requisição
-- avança o que cabe no tempo, grava a conversa e as consultas feitas, e a
-- seguinte continua de onde parou. É a mesma máquina de estados que a
-- sincronização usa — e, de quebra, o que a IA consultou fica consultável
-- depois, por quem não estava na tela.

CREATE TABLE "Investigacao" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "conexaoId" TEXT,
    "empresa" TEXT NOT NULL,
    "userId" TEXT,
    "userNome" TEXT,
    "pergunta" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'EXECUTANDO',
    "mensagens" JSONB NOT NULL,
    "consultas" JSONB NOT NULL,
    "iteracoes" INTEGER NOT NULL DEFAULT 0,
    "resposta" TEXT,
    "erro" TEXT,
    "modelo" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "concluidaEm" TIMESTAMP(3),

    CONSTRAINT "Investigacao_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Investigacao_companyId_criadoEm_idx" ON "Investigacao"("companyId", "criadoEm");
