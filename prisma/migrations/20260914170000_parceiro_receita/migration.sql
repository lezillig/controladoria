-- O QUE A RECEITA FEDERAL DIZ DE CADA CNPJ QUE O GRUPO PAGA.
--
-- Situação cadastral, abertura, CNAE, porte, capital social e sócios, lidos da
-- base pública (BrasilAPI, sem autenticação). É o dado que o espelho da Omie
-- não tem e que separa "fornecedor novo" de "empresa aberta há três meses",
-- "cadastro com CNPJ" de "CNPJ baixado recebendo", e nome de sócio de nome de
-- motorista da folha.
--
-- SEM companyId, de propósito: dado público, igual para qualquer empresa, e o
-- mesmo CNPJ é fornecedor da Azul e da MCZ. A mesma exceção consciente ao
-- multi-tenant que a gestão faz com AnpPrecoReferencia. Ver o comentário do
-- modelo em schema.prisma.
--
-- Nasce vazia e enche aos poucos (~15 s por ciclo, mais o botão da tela de
-- sincronização), em ordem de maior valor pago. As regras que dependem dela
-- ficam caladas para o CNPJ que ainda não foi consultado — nunca inventam.

CREATE TABLE "ParceiroReceita" (
    "id" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "razaoSocial" TEXT,
    "situacao" TEXT,
    "situacaoEm" TIMESTAMP(3),
    "inicioAtividade" TIMESTAMP(3),
    "cnaeCodigo" TEXT,
    "cnaeDescricao" TEXT,
    "porte" TEXT,
    "capitalSocialCents" INTEGER,
    "naturezaJuridica" TEXT,
    "municipio" TEXT,
    "uf" TEXT,
    "mei" BOOLEAN,
    "simples" BOOLEAN,
    "socios" JSONB NOT NULL,
    "consultadoEm" TIMESTAMP(3) NOT NULL,
    "erro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParceiroReceita_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ParceiroReceita_cnpj_key" ON "ParceiroReceita"("cnpj");

CREATE INDEX "ParceiroReceita_consultadoEm_idx" ON "ParceiroReceita"("consultadoEm");
