-- Frota completa: a ficha do veículo com o que a planilha CONTROLE
-- INFORMAÇÕES GERAIS controla (com valor FIPE/ajustado), adaptações,
-- documentos com validade, apólices, consultas de placa, financiamentos e
-- consórcios ligados a vários veículos e às parcelas das contas a pagar da Omie.
--
-- FrotaFinanciamento nasceu na migração anterior com outro desenho e nenhuma
-- tela grava nela: é recriada. A guarda aborta se, por algum motivo, já houver
-- linha — nada é apagado em silêncio.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "FrotaFinanciamento") THEN
    RAISE EXCEPTION 'FrotaFinanciamento tem dados; recriação abortada';
  END IF;
END $$;

DROP TABLE "FrotaFinanciamento";

ALTER TABLE "CadVeiculo" ADD COLUMN     "adaptacao" TEXT,
ADD COLUMN     "alocacao" TEXT,
ADD COLUMN     "apoliceId" TEXT,
ADD COLUMN     "apoliceVencimento" TIMESTAMP(3),
ADD COLUMN     "categoriaRegistro" TEXT,
ADD COLUMN     "compradorNome" TEXT,
ADD COLUMN     "cor" TEXT,
ADD COLUMN     "crlvExercicio" INTEGER,
ADD COLUMN     "crvSituacao" TEXT,
ADD COLUMN     "dataBaixa" TIMESTAMP(3),
ADD COLUMN     "eletrico" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fipeAnoModelo" TEXT,
ADD COLUMN     "fipeCodigo" TEXT,
ADD COLUMN     "fipeConsultadoEm" TIMESTAMP(3),
ADD COLUMN     "fipeModelo" TEXT,
ADD COLUMN     "fipeReferencia" TEXT,
ADD COLUMN     "fipeValorCents" BIGINT,
ADD COLUMN     "ipvaIsencaoInicio" TIMESTAMP(3),
ADD COLUMN     "ipvaSituacao" TEXT,
ADD COLUMN     "motivoBaixa" TEXT,
ADD COLUMN     "notaFiscalCompra" TEXT,
ADD COLUMN     "prefixo" TEXT,
ADD COLUMN     "tagPedagio" BOOLEAN,
ADD COLUMN     "transferenciaSituacao" TEXT,
ADD COLUMN     "valorAjustadoCents" BIGINT,
ADD COLUMN     "valorAjustadoEm" TIMESTAMP(3),
ADD COLUMN     "valorAjustadoMotivo" TEXT,
ADD COLUMN     "vendedorNome" TEXT,
ALTER COLUMN "placa" DROP NOT NULL,
ALTER COLUMN "vidaUtilMeses" SET DEFAULT 60;

CREATE TABLE "FrotaFinanciamento" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "produto" TEXT NOT NULL,
    "modalidade" TEXT,
    "instituicao" TEXT NOT NULL,
    "instituicaoCnpj" TEXT,
    "empresa" TEXT,
    "contratoNumero" TEXT,
    "celulaCredito" TEXT,
    "garantia" TEXT,
    "grupo" TEXT,
    "cota" TEXT,
    "dataInicio" TIMESTAMP(3),
    "dataFinal" TIMESTAMP(3),
    "valorBensCents" BIGINT,
    "entradaCents" BIGINT,
    "valorFinanciadoCents" BIGINT,
    "valorCreditadoCents" BIGINT,
    "lanceCents" BIGINT,
    "lancePlanejadoPct" DOUBLE PRECISION,
    "taxaPct" DOUBLE PRECISION,
    "vencimentoDia" INTEGER,
    "parcelas" INTEGER,
    "valorParcelaCents" BIGINT,
    "dataPrimeiraParcela" TIMESTAMP(3),
    "parcelasPagas" INTEGER,
    "valorPagoCents" BIGINT,
    "saldoQuitacaoCents" BIGINT,
    "saldoInformadoEm" TIMESTAMP(3),
    "situacaoConsorcio" TEXT,
    "dataContemplacao" TIMESTAMP(3),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "dataQuitacao" TIMESTAMP(3),
    "motivoEncerramento" TEXT,
    "observacoes" TEXT,
    "origem" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FrotaFinanciamento_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FrotaParcelaOmie" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "financiamentoId" TEXT NOT NULL,
    "tituloId" TEXT NOT NULL,
    "numeroParcela" INTEGER,
    "criterio" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FrotaParcelaOmie_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FrotaInstituicaoParceiro" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "instituicao" TEXT NOT NULL,
    "produto" TEXT NOT NULL,
    "conexaoId" TEXT NOT NULL,
    "parceiroCodigo" TEXT NOT NULL,
    "parceiroNome" TEXT,
    "confirmado" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FrotaInstituicaoParceiro_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FrotaFinanciamentoVeiculo" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "financiamentoId" TEXT NOT NULL,
    "veiculoId" TEXT NOT NULL,
    "parcelaCents" BIGINT,
    "saldoCents" BIGINT,
    "alienado" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FrotaFinanciamentoVeiculo_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FrotaAdaptacao" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "veiculoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "data" TIMESTAMP(3),
    "valorCents" BIGINT NOT NULL,
    "fornecedorNome" TEXT,
    "notaFiscal" TEXT,
    "tituloOmieId" TEXT,
    "observacao" TEXT,
    "registradoPor" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FrotaAdaptacao_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FrotaApolice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "segmento" TEXT,
    "numero" TEXT,
    "seguradora" TEXT,
    "vigenciaFim" TIMESTAMP(3),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FrotaApolice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FrotaDocumento" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "veiculoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "numero" TEXT,
    "validade" TIMESTAMP(3),
    "situacao" TEXT NOT NULL DEFAULT 'vigente',
    "observacao" TEXT,
    "atualizadoPor" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FrotaDocumento_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FrotaConsulta" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "veiculoId" TEXT NOT NULL,
    "fonte" TEXT NOT NULL,
    "consultadoEm" TIMESTAMP(3) NOT NULL,
    "resultado" TEXT,
    "registradoPor" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FrotaConsulta_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FrotaFinanciamento_companyId_ativo_idx" ON "FrotaFinanciamento"("companyId", "ativo");

CREATE INDEX "FrotaFinanciamento_companyId_produto_idx" ON "FrotaFinanciamento"("companyId", "produto");

CREATE UNIQUE INDEX "FrotaParcelaOmie_tituloId_key" ON "FrotaParcelaOmie"("tituloId");

CREATE INDEX "FrotaParcelaOmie_companyId_financiamentoId_idx" ON "FrotaParcelaOmie"("companyId", "financiamentoId");

CREATE UNIQUE INDEX "FrotaInstituicaoParceiro_companyId_instituicao_produto_cone_key" ON "FrotaInstituicaoParceiro"("companyId", "instituicao", "produto", "conexaoId", "parceiroCodigo");

CREATE INDEX "FrotaFinanciamentoVeiculo_companyId_veiculoId_idx" ON "FrotaFinanciamentoVeiculo"("companyId", "veiculoId");

CREATE UNIQUE INDEX "FrotaFinanciamentoVeiculo_financiamentoId_veiculoId_key" ON "FrotaFinanciamentoVeiculo"("financiamentoId", "veiculoId");

CREATE INDEX "FrotaAdaptacao_companyId_veiculoId_idx" ON "FrotaAdaptacao"("companyId", "veiculoId");

CREATE UNIQUE INDEX "FrotaApolice_companyId_descricao_key" ON "FrotaApolice"("companyId", "descricao");

CREATE INDEX "FrotaDocumento_companyId_tipo_validade_idx" ON "FrotaDocumento"("companyId", "tipo", "validade");

CREATE UNIQUE INDEX "FrotaDocumento_veiculoId_tipo_key" ON "FrotaDocumento"("veiculoId", "tipo");

CREATE INDEX "FrotaConsulta_companyId_consultadoEm_idx" ON "FrotaConsulta"("companyId", "consultadoEm");

CREATE UNIQUE INDEX "FrotaConsulta_veiculoId_fonte_consultadoEm_key" ON "FrotaConsulta"("veiculoId", "fonte", "consultadoEm");

CREATE UNIQUE INDEX "CadVeiculo_companyId_chassi_key" ON "CadVeiculo"("companyId", "chassi");

ALTER TABLE "CadVeiculo" ADD CONSTRAINT "CadVeiculo_apoliceId_fkey" FOREIGN KEY ("apoliceId") REFERENCES "FrotaApolice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FrotaFinanciamentoVeiculo" ADD CONSTRAINT "FrotaFinanciamentoVeiculo_financiamentoId_fkey" FOREIGN KEY ("financiamentoId") REFERENCES "FrotaFinanciamento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FrotaFinanciamentoVeiculo" ADD CONSTRAINT "FrotaFinanciamentoVeiculo_veiculoId_fkey" FOREIGN KEY ("veiculoId") REFERENCES "CadVeiculo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FrotaAdaptacao" ADD CONSTRAINT "FrotaAdaptacao_veiculoId_fkey" FOREIGN KEY ("veiculoId") REFERENCES "CadVeiculo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FrotaDocumento" ADD CONSTRAINT "FrotaDocumento_veiculoId_fkey" FOREIGN KEY ("veiculoId") REFERENCES "CadVeiculo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FrotaConsulta" ADD CONSTRAINT "FrotaConsulta_veiculoId_fkey" FOREIGN KEY ("veiculoId") REFERENCES "CadVeiculo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
