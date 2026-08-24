-- REPARO DOS CADASTROS ESPELHADOS QUE FICARAM NA VERSÃO ANTERIOR ÀS CONEXÕES.
--
-- A tela de resultado morria com `column cat.conexaoId does not exist`. A
-- consulta estava certa: ela roda limpa em qualquer banco criado do zero pelas
-- migrações deste repositório. O banco que atende a produção é que tem
-- `OmieCategoria` na forma anterior à migração das conexões Omie — de quando
-- ainda havia uma única conta, antes de AZUL e MCZ existirem separadas.
--
-- Como isso escapa: `prisma migrate deploy` só aplica o que ainda não está
-- marcado como aplicado. Um banco cuja tabela veio de outra origem — um `db
-- push` antigo, uma cópia, um servidor trocado no meio do caminho — passa por
-- ele em silêncio, com a migração marcada e a tabela velha.
--
-- POR QUE APAGAR E RECRIAR, E NÃO ACRESCENTAR A COLUNA
--
-- `conexaoId` é obrigatória e tem chave estrangeira. Acrescentá-la exigiria
-- decidir, linha a linha, de qual das duas contas Omie cada cadastro veio — e
-- essa informação não existe mais na tabela antiga. Qualquer preenchimento
-- seria um chute gravado como se fosse dado.
--
-- Estas cinco tabelas são ESPELHO SOMENTE-LEITURA de cadastro, e são a primeira
-- fase do ciclo diário: recriá-las vazias custa uma varredura de páginas da API
-- na próxima sincronização, que roda de qualquer forma. Nenhum dado próprio do
-- sistema mora aqui — achado de auditoria, conformidade e configuração ficam em
-- outras tabelas e não são tocados.
--
-- O QUE NÃO É TOCADO, DE PROPÓSITO
--
-- Título, baixa, movimento e nota ficam de fora. São 46 mil títulos e 45 mil
-- baixas, resultado de 38 janelas mensais de carga histórica — horas de
-- sincronização. Se alguma dessas tabelas também estiver atrasada, o relatório
-- de diferenças na tela de sincronização vai continuar apontando, e o reparo
-- delas merece uma migração própria, escrita com o caso na mão. Apagar carga
-- histórica por precaução seria trocar um defeito visível por um prejuízo.
--
-- IDEMPOTENTE: em banco íntegro, cada bloco abaixo é um no-op. A condição é a
-- ausência da coluna `conexaoId`, não a existência da tabela.

-- ---------- OmieParceiro ----------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_name = 'OmieParceiro'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'OmieParceiro'
       AND column_name = 'conexaoId'
  ) THEN
    RAISE NOTICE 'Reparando OmieParceiro: tabela na forma anterior às conexões, será recriada vazia.';
    DROP TABLE "OmieParceiro";
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "OmieParceiro" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "conexaoId" TEXT NOT NULL,
    "conexaoApelido" TEXT NOT NULL,
    "codigoOmie" TEXT NOT NULL,
    "codigoIntegracao" TEXT,
    "nome" TEXT NOT NULL,
    "nomeFantasia" TEXT,
    "documento" TEXT,
    "ehCliente" BOOLEAN NOT NULL DEFAULT false,
    "ehFornecedor" BOOLEAN NOT NULL DEFAULT false,
    "email" TEXT,
    "cidade" TEXT,
    "estado" TEXT,
    "inativo" BOOLEAN NOT NULL DEFAULT false,
    "bloqueado" BOOLEAN NOT NULL DEFAULT false,
    "contaBancariaHash" TEXT,
    "contaBancariaAlteradaEm" TIMESTAMP(3),
    "sincronizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OmieParceiro_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OmieParceiro_companyId_documento_idx" ON "OmieParceiro"("companyId", "documento");
CREATE UNIQUE INDEX IF NOT EXISTS "OmieParceiro_conexaoId_codigoOmie_key" ON "OmieParceiro"("conexaoId", "codigoOmie");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OmieParceiro_conexaoId_fkey') THEN
    ALTER TABLE "OmieParceiro" ADD CONSTRAINT "OmieParceiro_conexaoId_fkey"
      FOREIGN KEY ("conexaoId") REFERENCES "OmieConexao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ---------- OmieCategoria ----------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_name = 'OmieCategoria'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'OmieCategoria'
       AND column_name = 'conexaoId'
  ) THEN
    RAISE NOTICE 'Reparando OmieCategoria: tabela na forma anterior às conexões, será recriada vazia.';
    DROP TABLE "OmieCategoria";
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "OmieCategoria" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "conexaoId" TEXT NOT NULL,
    "conexaoApelido" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "natureza" TEXT,
    "categoriaSuperior" TEXT,
    "totalizadora" BOOLEAN NOT NULL DEFAULT false,
    "inativa" BOOLEAN NOT NULL DEFAULT false,
    "sincronizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OmieCategoria_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OmieCategoria_companyId_idx" ON "OmieCategoria"("companyId");
CREATE UNIQUE INDEX IF NOT EXISTS "OmieCategoria_conexaoId_codigo_key" ON "OmieCategoria"("conexaoId", "codigo");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OmieCategoria_conexaoId_fkey') THEN
    ALTER TABLE "OmieCategoria" ADD CONSTRAINT "OmieCategoria_conexaoId_fkey"
      FOREIGN KEY ("conexaoId") REFERENCES "OmieConexao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ---------- OmieDepartamento ----------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_name = 'OmieDepartamento'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'OmieDepartamento'
       AND column_name = 'conexaoId'
  ) THEN
    RAISE NOTICE 'Reparando OmieDepartamento: tabela na forma anterior às conexões, será recriada vazia.';
    DROP TABLE "OmieDepartamento";
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "OmieDepartamento" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "conexaoId" TEXT NOT NULL,
    "conexaoApelido" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "estrutura" TEXT,
    "inativo" BOOLEAN NOT NULL DEFAULT false,
    "sincronizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OmieDepartamento_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OmieDepartamento_companyId_idx" ON "OmieDepartamento"("companyId");
CREATE UNIQUE INDEX IF NOT EXISTS "OmieDepartamento_conexaoId_codigo_key" ON "OmieDepartamento"("conexaoId", "codigo");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OmieDepartamento_conexaoId_fkey') THEN
    ALTER TABLE "OmieDepartamento" ADD CONSTRAINT "OmieDepartamento_conexaoId_fkey"
      FOREIGN KEY ("conexaoId") REFERENCES "OmieConexao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ---------- OmieProjeto ----------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_name = 'OmieProjeto'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'OmieProjeto'
       AND column_name = 'conexaoId'
  ) THEN
    RAISE NOTICE 'Reparando OmieProjeto: tabela na forma anterior às conexões, será recriada vazia.';
    DROP TABLE "OmieProjeto";
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "OmieProjeto" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "conexaoId" TEXT NOT NULL,
    "conexaoApelido" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "inativo" BOOLEAN NOT NULL DEFAULT false,
    "sincronizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OmieProjeto_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OmieProjeto_companyId_idx" ON "OmieProjeto"("companyId");
CREATE UNIQUE INDEX IF NOT EXISTS "OmieProjeto_conexaoId_codigo_key" ON "OmieProjeto"("conexaoId", "codigo");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OmieProjeto_conexaoId_fkey') THEN
    ALTER TABLE "OmieProjeto" ADD CONSTRAINT "OmieProjeto_conexaoId_fkey"
      FOREIGN KEY ("conexaoId") REFERENCES "OmieConexao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ---------- OmieContaCorrente ----------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_name = 'OmieContaCorrente'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'OmieContaCorrente'
       AND column_name = 'conexaoId'
  ) THEN
    RAISE NOTICE 'Reparando OmieContaCorrente: tabela na forma anterior às conexões, será recriada vazia.';
    DROP TABLE "OmieContaCorrente";
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "OmieContaCorrente" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "conexaoId" TEXT NOT NULL,
    "conexaoApelido" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "tipo" TEXT,
    "banco" TEXT,
    "agencia" TEXT,
    "numeroConta" TEXT,
    "saldoInicialCents" INTEGER NOT NULL DEFAULT 0,
    "inativa" BOOLEAN NOT NULL DEFAULT false,
    "sincronizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OmieContaCorrente_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OmieContaCorrente_companyId_idx" ON "OmieContaCorrente"("companyId");
CREATE UNIQUE INDEX IF NOT EXISTS "OmieContaCorrente_conexaoId_codigo_key" ON "OmieContaCorrente"("conexaoId", "codigo");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OmieContaCorrente_conexaoId_fkey') THEN
    ALTER TABLE "OmieContaCorrente" ADD CONSTRAINT "OmieContaCorrente_conexaoId_fkey"
      FOREIGN KEY ("conexaoId") REFERENCES "OmieConexao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
