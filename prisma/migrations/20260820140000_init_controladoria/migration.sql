-- CreateEnum
CREATE TYPE "OmieNaturezaTitulo" AS ENUM ('PAGAR', 'RECEBER');

-- CreateEnum
CREATE TYPE "OmieSyncStatus" AS ENUM ('EXECUTANDO', 'CONCLUIDO', 'ERRO');

-- CreateEnum
CREATE TYPE "AuditSeveridade" AS ENUM ('CRITICA', 'ALTA', 'MEDIA', 'BAIXA', 'INFO');

-- CreateEnum
CREATE TYPE "AuditCategoria" AS ENUM ('FRAUDE', 'ERRO_PROCESSO', 'PERDA_FINANCEIRA', 'RISCO_FINANCEIRO', 'CONFORMIDADE', 'OPORTUNIDADE');

-- CreateEnum
CREATE TYPE "AuditStatus" AS ENUM ('ABERTO', 'EM_ANALISE', 'RESOLVIDO', 'IGNORADO', 'OBSOLETO');

-- CreateEnum
CREATE TYPE "RelatorioStatus" AS ENUM ('GERADO', 'ENVIADO', 'ERRO_ENVIO');

-- CreateEnum
CREATE TYPE "BscPerspectiva" AS ENUM ('FINANCEIRA', 'CLIENTE', 'PROCESSOS_INTERNOS', 'APRENDIZADO_CRESCIMENTO');

-- CreateTable
CREATE TABLE "OmieConexao" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "apelido" TEXT NOT NULL,
    "cnpj" TEXT,
    "credencialRef" TEXT NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OmieConexao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OmieParceiro" (
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

-- CreateTable
CREATE TABLE "OmieCategoria" (
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

-- CreateTable
CREATE TABLE "OmieDepartamento" (
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

-- CreateTable
CREATE TABLE "OmieProjeto" (
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

-- CreateTable
CREATE TABLE "OmieContaCorrente" (
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

-- CreateTable
CREATE TABLE "OmieTitulo" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "conexaoId" TEXT NOT NULL,
    "conexaoApelido" TEXT NOT NULL,
    "natureza" "OmieNaturezaTitulo" NOT NULL,
    "codigoLancamento" TEXT NOT NULL,
    "codigoIntegracao" TEXT,
    "parceiroCodigo" TEXT,
    "parceiroNome" TEXT,
    "parceiroDocumento" TEXT,
    "numeroDocumento" TEXT,
    "numeroParcela" TEXT,
    "tipoDocumento" TEXT,
    "categoriaCodigo" TEXT,
    "categoriaDescricao" TEXT,
    "departamentoCodigo" TEXT,
    "projetoCodigo" TEXT,
    "contaCorrenteCodigo" TEXT,
    "dataEmissao" TIMESTAMP(3),
    "dataVencimento" TIMESTAMP(3) NOT NULL,
    "dataPrevisao" TIMESTAMP(3),
    "dataRegistro" TIMESTAMP(3),
    "dataEntrada" TIMESTAMP(3),
    "valorDocumentoCents" INTEGER NOT NULL,
    "saldoCents" INTEGER,
    "valorPagoCents" INTEGER NOT NULL DEFAULT 0,
    "jurosCents" INTEGER NOT NULL DEFAULT 0,
    "multaCents" INTEGER NOT NULL DEFAULT 0,
    "descontoCents" INTEGER NOT NULL DEFAULT 0,
    "tarifaCents" INTEGER NOT NULL DEFAULT 0,
    "dataUltimaBaixa" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "liquidado" BOOLEAN NOT NULL DEFAULT false,
    "cancelado" BOOLEAN NOT NULL DEFAULT false,
    "observacao" TEXT,
    "origem" TEXT,
    "alteradoEmOmie" TIMESTAMP(3),
    "sincronizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OmieTitulo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OmieBaixa" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "conexaoId" TEXT NOT NULL,
    "tituloId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "dataBaixa" TIMESTAMP(3) NOT NULL,
    "valorCents" INTEGER NOT NULL,
    "jurosCents" INTEGER NOT NULL DEFAULT 0,
    "multaCents" INTEGER NOT NULL DEFAULT 0,
    "descontoCents" INTEGER NOT NULL DEFAULT 0,
    "tarifaCents" INTEGER NOT NULL DEFAULT 0,
    "contaCorrenteCodigo" TEXT,
    "observacao" TEXT,
    "liquidaTitulo" BOOLEAN NOT NULL DEFAULT true,
    "sincronizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OmieBaixa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OmieMovimento" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "conexaoId" TEXT NOT NULL,
    "conexaoApelido" TEXT NOT NULL,
    "contaCorrenteCodigo" TEXT NOT NULL,
    "codigoLancamento" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "valorCents" INTEGER NOT NULL,
    "natureza" TEXT,
    "tipo" TEXT,
    "categoriaCodigo" TEXT,
    "parceiroCodigo" TEXT,
    "parceiroNome" TEXT,
    "documento" TEXT,
    "observacao" TEXT,
    "conciliado" BOOLEAN NOT NULL DEFAULT false,
    "dataConciliacao" TIMESTAMP(3),
    "tituloCodigo" TEXT,
    "sincronizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OmieMovimento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OmieNota" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "conexaoId" TEXT NOT NULL,
    "conexaoApelido" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "numero" TEXT,
    "serie" TEXT,
    "chaveAcesso" TEXT,
    "dataEmissao" TIMESTAMP(3) NOT NULL,
    "parceiroCodigo" TEXT,
    "parceiroNome" TEXT,
    "valorCents" INTEGER NOT NULL,
    "valorServicosCents" INTEGER,
    "baseIssCents" INTEGER,
    "valorIssCents" INTEGER,
    "valorPisCents" INTEGER,
    "valorCofinsCents" INTEGER,
    "valorIcmsCents" INTEGER,
    "valorIpiCents" INTEGER,
    "valorIrCents" INTEGER,
    "valorCsllCents" INTEGER,
    "valorInssCents" INTEGER,
    "cancelada" BOOLEAN NOT NULL DEFAULT false,
    "naturezaOperacao" TEXT,
    "cfop" TEXT,
    "sincronizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OmieNota_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OmieSyncRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "conexaoId" TEXT,
    "iniciadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizadoEm" TIMESTAMP(3),
    "status" "OmieSyncStatus" NOT NULL DEFAULT 'EXECUTANDO',
    "fase" TEXT NOT NULL DEFAULT 'cadastros',
    "cursor" TEXT,
    "janelaInicio" TIMESTAMP(3) NOT NULL,
    "janelaFim" TIMESTAMP(3) NOT NULL,
    "backfill" BOOLEAN NOT NULL DEFAULT false,
    "invocacoes" INTEGER NOT NULL DEFAULT 1,
    "cadastros" INTEGER NOT NULL DEFAULT 0,
    "titulosPagar" INTEGER NOT NULL DEFAULT 0,
    "titulosReceber" INTEGER NOT NULL DEFAULT 0,
    "baixas" INTEGER NOT NULL DEFAULT 0,
    "movimentos" INTEGER NOT NULL DEFAULT 0,
    "notas" INTEGER NOT NULL DEFAULT 0,
    "achados" INTEGER NOT NULL DEFAULT 0,
    "erro" TEXT,
    "detalhes" JSONB,

    CONSTRAINT "OmieSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditFinding" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "conexaoId" TEXT,
    "conexaoApelido" TEXT,
    "agente" TEXT NOT NULL,
    "regra" TEXT NOT NULL,
    "severidade" "AuditSeveridade" NOT NULL,
    "categoria" "AuditCategoria" NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "recomendacao" TEXT,
    "valorCents" INTEGER,
    "impactoCents" INTEGER,
    "dataReferencia" TIMESTAMP(3),
    "entidadeTipo" TEXT,
    "entidadeId" TEXT,
    "entidadeRef" TEXT,
    "evidencia" JSONB,
    "chave" TEXT NOT NULL,
    "confianca" INTEGER NOT NULL DEFAULT 100,
    "notaSupervisor" TEXT,
    "chaveRelacionada" TEXT,
    "status" "AuditStatus" NOT NULL DEFAULT 'ABERTO',
    "detectadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "ultimaOcorrencia" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ocorrencias" INTEGER NOT NULL DEFAULT 1,
    "resolvidoEm" TIMESTAMP(3),
    "tratadoPorUserId" TEXT,
    "observacaoTratativa" TEXT,

    CONSTRAINT "AuditFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelatorioDiario" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "dataReferencia" TIMESTAMP(3) NOT NULL,
    "conexaoId" TEXT,
    "conexaoApelido" TEXT,
    "geradoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enviadoEm" TIMESTAMP(3),
    "status" "RelatorioStatus" NOT NULL DEFAULT 'GERADO',
    "destinatarios" TEXT NOT NULL,
    "assunto" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "resumo" JSONB NOT NULL,
    "narrativaIa" JSONB,
    "erro" TEXT,
    "achadosTotal" INTEGER NOT NULL DEFAULT 0,
    "achadosCriticos" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RelatorioDiario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControladoriaConfig" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "emailsRelatorio" TEXT NOT NULL DEFAULT '',
    "dataInicioBase" TIMESTAMP(3) NOT NULL,
    "limiteAlcadaCents" INTEGER,
    "metaMargemPercent" DOUBLE PRECISION,
    "toleranciaVariacaoPercent" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "diasAtrasoCritico" INTEGER NOT NULL DEFAULT 30,
    "saldoMinimoCaixaCents" INTEGER,
    "limiteConcentracaoFornecedorPercent" DOUBLE PRECISION NOT NULL DEFAULT 25,
    "relatorioPorConexao" BOOLEAN NOT NULL DEFAULT false,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ControladoriaConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BscMeta" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "meta" DOUBLE PRECISION NOT NULL,
    "toleranciaPercent" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "observacao" TEXT,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "atualizadoPorUserId" TEXT,

    CONSTRAINT "BscMeta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BscSnapshot" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "dataReferencia" TIMESTAMP(3) NOT NULL,
    "codigo" TEXT NOT NULL,
    "perspectiva" "BscPerspectiva" NOT NULL,
    "valor" DOUBLE PRECISION,
    "meta" DOUBLE PRECISION,
    "farol" TEXT NOT NULL,
    "detalhes" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BscSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OmieVinculoCentroCusto" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tipoOrigem" TEXT NOT NULL,
    "valorOrigem" TEXT NOT NULL,
    "rotuloOrigem" TEXT,
    "conexaoId" TEXT,
    "clienteId" TEXT,
    "vehicleId" TEXT,
    "driverId" TEXT,
    "percentual" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "sugerido" BOOLEAN NOT NULL DEFAULT false,
    "confirmadoPorUserId" TEXT,
    "confirmadoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OmieVinculoCentroCusto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControladoriaEventLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "userNome" TEXT,
    "userEmail" TEXT,
    "acao" TEXT NOT NULL,
    "entidadeTipo" TEXT,
    "entidadeId" TEXT,
    "descricao" TEXT NOT NULL,
    "antes" JSONB,
    "depois" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControladoriaEventLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OmieConexao_companyId_ativa_idx" ON "OmieConexao"("companyId", "ativa");

-- CreateIndex
CREATE UNIQUE INDEX "OmieConexao_companyId_apelido_key" ON "OmieConexao"("companyId", "apelido");

-- CreateIndex
CREATE UNIQUE INDEX "OmieConexao_companyId_credencialRef_key" ON "OmieConexao"("companyId", "credencialRef");

-- CreateIndex
CREATE INDEX "OmieParceiro_companyId_documento_idx" ON "OmieParceiro"("companyId", "documento");

-- CreateIndex
CREATE UNIQUE INDEX "OmieParceiro_conexaoId_codigoOmie_key" ON "OmieParceiro"("conexaoId", "codigoOmie");

-- CreateIndex
CREATE INDEX "OmieCategoria_companyId_idx" ON "OmieCategoria"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "OmieCategoria_conexaoId_codigo_key" ON "OmieCategoria"("conexaoId", "codigo");

-- CreateIndex
CREATE INDEX "OmieDepartamento_companyId_idx" ON "OmieDepartamento"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "OmieDepartamento_conexaoId_codigo_key" ON "OmieDepartamento"("conexaoId", "codigo");

-- CreateIndex
CREATE INDEX "OmieProjeto_companyId_idx" ON "OmieProjeto"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "OmieProjeto_conexaoId_codigo_key" ON "OmieProjeto"("conexaoId", "codigo");

-- CreateIndex
CREATE INDEX "OmieContaCorrente_companyId_idx" ON "OmieContaCorrente"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "OmieContaCorrente_conexaoId_codigo_key" ON "OmieContaCorrente"("conexaoId", "codigo");

-- CreateIndex
CREATE INDEX "OmieTitulo_companyId_natureza_dataVencimento_idx" ON "OmieTitulo"("companyId", "natureza", "dataVencimento");

-- CreateIndex
CREATE INDEX "OmieTitulo_companyId_natureza_status_idx" ON "OmieTitulo"("companyId", "natureza", "status");

-- CreateIndex
CREATE INDEX "OmieTitulo_companyId_dataUltimaBaixa_idx" ON "OmieTitulo"("companyId", "dataUltimaBaixa");

-- CreateIndex
CREATE INDEX "OmieTitulo_companyId_parceiroCodigo_idx" ON "OmieTitulo"("companyId", "parceiroCodigo");

-- CreateIndex
CREATE UNIQUE INDEX "OmieTitulo_conexaoId_natureza_codigoLancamento_key" ON "OmieTitulo"("conexaoId", "natureza", "codigoLancamento");

-- CreateIndex
CREATE INDEX "OmieBaixa_companyId_dataBaixa_idx" ON "OmieBaixa"("companyId", "dataBaixa");

-- CreateIndex
CREATE INDEX "OmieBaixa_tituloId_idx" ON "OmieBaixa"("tituloId");

-- CreateIndex
CREATE UNIQUE INDEX "OmieBaixa_conexaoId_chave_key" ON "OmieBaixa"("conexaoId", "chave");

-- CreateIndex
CREATE INDEX "OmieMovimento_companyId_data_idx" ON "OmieMovimento"("companyId", "data");

-- CreateIndex
CREATE INDEX "OmieMovimento_companyId_contaCorrenteCodigo_data_idx" ON "OmieMovimento"("companyId", "contaCorrenteCodigo", "data");

-- CreateIndex
CREATE UNIQUE INDEX "OmieMovimento_conexaoId_codigoLancamento_key" ON "OmieMovimento"("conexaoId", "codigoLancamento");

-- CreateIndex
CREATE INDEX "OmieNota_companyId_dataEmissao_idx" ON "OmieNota"("companyId", "dataEmissao");

-- CreateIndex
CREATE UNIQUE INDEX "OmieNota_conexaoId_chave_key" ON "OmieNota"("conexaoId", "chave");

-- CreateIndex
CREATE INDEX "OmieSyncRun_companyId_iniciadoEm_idx" ON "OmieSyncRun"("companyId", "iniciadoEm");

-- CreateIndex
CREATE INDEX "OmieSyncRun_companyId_status_idx" ON "OmieSyncRun"("companyId", "status");

-- CreateIndex
CREATE INDEX "OmieSyncRun_conexaoId_status_idx" ON "OmieSyncRun"("conexaoId", "status");

-- CreateIndex
CREATE INDEX "AuditFinding_companyId_status_severidade_idx" ON "AuditFinding"("companyId", "status", "severidade");

-- CreateIndex
CREATE INDEX "AuditFinding_companyId_categoria_status_idx" ON "AuditFinding"("companyId", "categoria", "status");

-- CreateIndex
CREATE INDEX "AuditFinding_companyId_detectadoEm_idx" ON "AuditFinding"("companyId", "detectadoEm");

-- CreateIndex
CREATE INDEX "AuditFinding_conexaoId_status_idx" ON "AuditFinding"("conexaoId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AuditFinding_companyId_chave_key" ON "AuditFinding"("companyId", "chave");

-- CreateIndex
CREATE INDEX "RelatorioDiario_companyId_dataReferencia_idx" ON "RelatorioDiario"("companyId", "dataReferencia");

-- CreateIndex
CREATE UNIQUE INDEX "RelatorioDiario_companyId_dataReferencia_conexaoId_key" ON "RelatorioDiario"("companyId", "dataReferencia", "conexaoId");

-- CreateIndex
CREATE UNIQUE INDEX "ControladoriaConfig_companyId_key" ON "ControladoriaConfig"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "BscMeta_companyId_codigo_key" ON "BscMeta"("companyId", "codigo");

-- CreateIndex
CREATE INDEX "BscSnapshot_companyId_codigo_dataReferencia_idx" ON "BscSnapshot"("companyId", "codigo", "dataReferencia");

-- CreateIndex
CREATE UNIQUE INDEX "BscSnapshot_companyId_dataReferencia_codigo_key" ON "BscSnapshot"("companyId", "dataReferencia", "codigo");

-- CreateIndex
CREATE INDEX "OmieVinculoCentroCusto_companyId_tipoOrigem_idx" ON "OmieVinculoCentroCusto"("companyId", "tipoOrigem");

-- CreateIndex
CREATE INDEX "OmieVinculoCentroCusto_companyId_conexaoId_idx" ON "OmieVinculoCentroCusto"("companyId", "conexaoId");

-- CreateIndex
CREATE INDEX "ControladoriaEventLog_companyId_criadoEm_idx" ON "ControladoriaEventLog"("companyId", "criadoEm");

-- CreateIndex
CREATE INDEX "ControladoriaEventLog_companyId_entidadeTipo_entidadeId_idx" ON "ControladoriaEventLog"("companyId", "entidadeTipo", "entidadeId");

-- AddForeignKey
ALTER TABLE "OmieParceiro" ADD CONSTRAINT "OmieParceiro_conexaoId_fkey" FOREIGN KEY ("conexaoId") REFERENCES "OmieConexao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OmieCategoria" ADD CONSTRAINT "OmieCategoria_conexaoId_fkey" FOREIGN KEY ("conexaoId") REFERENCES "OmieConexao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OmieDepartamento" ADD CONSTRAINT "OmieDepartamento_conexaoId_fkey" FOREIGN KEY ("conexaoId") REFERENCES "OmieConexao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OmieProjeto" ADD CONSTRAINT "OmieProjeto_conexaoId_fkey" FOREIGN KEY ("conexaoId") REFERENCES "OmieConexao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OmieContaCorrente" ADD CONSTRAINT "OmieContaCorrente_conexaoId_fkey" FOREIGN KEY ("conexaoId") REFERENCES "OmieConexao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OmieTitulo" ADD CONSTRAINT "OmieTitulo_conexaoId_fkey" FOREIGN KEY ("conexaoId") REFERENCES "OmieConexao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OmieBaixa" ADD CONSTRAINT "OmieBaixa_conexaoId_fkey" FOREIGN KEY ("conexaoId") REFERENCES "OmieConexao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OmieBaixa" ADD CONSTRAINT "OmieBaixa_tituloId_fkey" FOREIGN KEY ("tituloId") REFERENCES "OmieTitulo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OmieMovimento" ADD CONSTRAINT "OmieMovimento_conexaoId_fkey" FOREIGN KEY ("conexaoId") REFERENCES "OmieConexao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OmieNota" ADD CONSTRAINT "OmieNota_conexaoId_fkey" FOREIGN KEY ("conexaoId") REFERENCES "OmieConexao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OmieSyncRun" ADD CONSTRAINT "OmieSyncRun_conexaoId_fkey" FOREIGN KEY ("conexaoId") REFERENCES "OmieConexao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

