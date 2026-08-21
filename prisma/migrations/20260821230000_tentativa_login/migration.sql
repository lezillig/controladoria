-- Tentativas de login: freio de forca bruta e trilha de autenticacao.
CREATE TABLE "TentativaLogin" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "ip" TEXT,
    "sucesso" BOOLEAN NOT NULL,
    "motivo" TEXT,
    "userAgent" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TentativaLogin_pkey" PRIMARY KEY ("id")
);

-- Os dois indices sao o que torna a contagem do freio barata: ela roda ANTES
-- do bcrypt, em toda tentativa de login, e uma varredura de tabela ali
-- transformaria a protecao contra forca bruta em vetor de lentidao.
CREATE INDEX "TentativaLogin_email_criadoEm_idx" ON "TentativaLogin"("email", "criadoEm");
CREATE INDEX "TentativaLogin_ip_criadoEm_idx" ON "TentativaLogin"("ip", "criadoEm");
