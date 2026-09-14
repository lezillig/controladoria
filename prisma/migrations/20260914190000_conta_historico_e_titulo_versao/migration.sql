-- HISTÓRICO DE TROCAS DE CONTA BANCÁRIA E VERSÕES DO TÍTULO.
--
-- Duas tabelas append-only escritas pelo sync. A primeira guarda cada troca de
-- conta bancária de fornecedor (só hashes) — o cadastro guardava apenas a
-- última, e o padrão que interessa é a sequência (trocar, receber, voltar).
-- A segunda guarda, campo a campo, o que mudou num título já espelhado —
-- "alterado depois de pago" passa a dizer o quê, não só quem e quando.

CREATE TABLE IF NOT EXISTS "OmieParceiroContaHistorico" (
    "id"           TEXT NOT NULL,
    "companyId"    TEXT NOT NULL,
    "conexaoId"    TEXT NOT NULL,
    "codigoOmie"   TEXT NOT NULL,
    "hashAnterior" TEXT NOT NULL,
    "hashNovo"     TEXT NOT NULL,
    "detectadoEm"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OmieParceiroContaHistorico_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "OmieParceiroContaHistorico_companyId_detectadoEm_idx"
    ON "OmieParceiroContaHistorico" ("companyId", "detectadoEm");
CREATE INDEX IF NOT EXISTS "OmieParceiroContaHistorico_conexaoId_codigoOmie_idx"
    ON "OmieParceiroContaHistorico" ("conexaoId", "codigoOmie");

CREATE TABLE IF NOT EXISTS "OmieTituloVersao" (
    "id"        TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tituloId"  TEXT NOT NULL,
    "vistoEm"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "campo"     TEXT NOT NULL,
    "de"        TEXT,
    "para"      TEXT,
    CONSTRAINT "OmieTituloVersao_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OmieTituloVersao_tituloId_fkey" FOREIGN KEY ("tituloId")
        REFERENCES "OmieTitulo"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "OmieTituloVersao_tituloId_idx" ON "OmieTituloVersao" ("tituloId");
CREATE INDEX IF NOT EXISTS "OmieTituloVersao_companyId_vistoEm_idx" ON "OmieTituloVersao" ("companyId", "vistoEm");
