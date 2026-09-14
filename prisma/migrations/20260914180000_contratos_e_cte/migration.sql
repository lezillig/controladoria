-- CONTRATOS DE SERVIÇO E CT-e — duas entidades que o espelho não tinha.
--
-- Contrato (servicos/contrato/ListarContratos): o valor que DEVERIA ser
-- faturado por mês. `hashCampos` + `versoes` guardam o histórico que a Omie
-- não devolve — é o que permite dizer "o valor deste contrato caiu, e foi
-- fulano quem alterou".
--
-- CT-e (contador/xml/ListarDocumentos, modelos 57 e 67): o documento fiscal
-- do frete, que até aqui só entrava por colagem manual na tela de conferência.
-- Depende do painel do contador estar habilitado na conta; sem ele a tabela
-- fica vazia e as regras ficam caladas.

CREATE TABLE IF NOT EXISTS "OmieContrato" (
    "id"                TEXT NOT NULL,
    "companyId"         TEXT NOT NULL,
    "conexaoId"         TEXT NOT NULL,
    "conexaoApelido"    TEXT NOT NULL,
    "codigoOmie"        TEXT NOT NULL,
    "codigoIntegracao"  TEXT,
    "numero"            TEXT,
    "parceiroCodigo"    TEXT,
    "parceiroNome"      TEXT,
    "situacao"          TEXT,
    "situacaoDescricao" TEXT,
    "vigenciaInicio"    TIMESTAMP(3),
    "vigenciaFim"       TIMESTAMP(3),
    "diaFaturamento"    INTEGER,
    "valorMensalCents"  INTEGER NOT NULL DEFAULT 0,
    "periodicidade"     TEXT,
    "categoriaCodigo"   TEXT,
    "itens"             JSONB,
    "usuarioInclusao"   TEXT,
    "usuarioAlteracao"  TEXT,
    "dataInclusaoOmie"  TIMESTAMP(3),
    "alteradoEmOmie"    TIMESTAMP(3),
    "hashCampos"        TEXT NOT NULL,
    "versoes"           JSONB,
    "sincronizadoEm"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OmieContrato_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OmieContrato_conexaoId_codigoOmie_key" ON "OmieContrato"("conexaoId", "codigoOmie");
CREATE INDEX IF NOT EXISTS "OmieContrato_companyId_situacao_idx" ON "OmieContrato"("companyId", "situacao");
CREATE INDEX IF NOT EXISTS "OmieContrato_companyId_parceiroCodigo_idx" ON "OmieContrato"("companyId", "parceiroCodigo");
CREATE INDEX IF NOT EXISTS "OmieContrato_companyId_numero_idx" ON "OmieContrato"("companyId", "numero");

ALTER TABLE "OmieContrato"
    ADD CONSTRAINT "OmieContrato_conexaoId_fkey"
    FOREIGN KEY ("conexaoId") REFERENCES "OmieConexao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "OmieCte" (
    "id"             TEXT NOT NULL,
    "companyId"      TEXT NOT NULL,
    "conexaoId"      TEXT NOT NULL,
    "conexaoApelido" TEXT NOT NULL,
    "chave"          TEXT NOT NULL,
    "numero"         TEXT,
    "serie"          TEXT,
    "modelo"         TEXT NOT NULL,
    "dataEmissao"    TIMESTAMP(3) NOT NULL,
    "valorCents"     INTEGER NOT NULL,
    "status"         TEXT,
    "cancelado"      BOOLEAN NOT NULL DEFAULT false,
    "idOmie"         TEXT,
    "sincronizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OmieCte_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OmieCte_conexaoId_chave_key" ON "OmieCte"("conexaoId", "chave");
CREATE INDEX IF NOT EXISTS "OmieCte_companyId_dataEmissao_idx" ON "OmieCte"("companyId", "dataEmissao");
CREATE INDEX IF NOT EXISTS "OmieCte_companyId_numero_idx" ON "OmieCte"("companyId", "numero");

ALTER TABLE "OmieCte"
    ADD CONSTRAINT "OmieCte_conexaoId_fkey"
    FOREIGN KEY ("conexaoId") REFERENCES "OmieConexao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
