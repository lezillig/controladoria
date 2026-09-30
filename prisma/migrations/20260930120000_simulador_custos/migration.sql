-- Simulador de custos: base de custos versionada (parâmetros, modelos de
-- veículo, funções, pedágios, referências) e estudos de custo de qualquer
-- operação (licitação, contrato privado, renovação, orçamento interno), com
-- regras, itens, rotas, versões de simulação com snapshot, lances e realizado.
-- Ver docs/simulador_custos/DECISOES.md.
-- CreateTable
CREATE TABLE "SimParametro" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "entidade" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "rotulo" TEXT NOT NULL,
    "unidade" TEXT,
    "valor" DECIMAL(18,6),
    "texto" TEXT,
    "vigenciaInicio" TIMESTAMP(3) NOT NULL,
    "vigenciaFim" TIMESTAMP(3),
    "fonte" TEXT NOT NULL,
    "atualizadoPorNome" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimParametro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimVeiculoModelo" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,
    "ano" INTEGER,
    "quantidade" INTEGER,
    "lotacao" INTEGER,
    "acessivel" BOOLEAN,
    "kmAtualMedio" INTEGER,
    "valorCompra" DECIMAL(18,6),
    "valorFipe" DECIMAL(18,6),
    "formaAquisicao" TEXT,
    "parcelaMensal" DECIMAL(18,6),
    "taxaAa" DECIMAL(18,6),
    "parcelasRestantes" INTEGER,
    "consumoKmL" DECIMAL(18,6),
    "combustivel" TEXT,
    "manutencaoKm" DECIMAL(18,6),
    "pneusDescricao" TEXT,
    "pneusQtde" INTEGER,
    "pneuPreco" DECIMAL(18,6),
    "pneuVidaKm" INTEGER,
    "seguroAnual" DECIMAL(18,6),
    "ipvaLicenciamentoAnual" DECIMAL(18,6),
    "licencasAnual" DECIMAL(18,6),
    "rastreadorMensal" DECIMAL(18,6),
    "idadeVenda" INTEGER,
    "revendaPctFipe" DECIMAL(18,6),
    "reservaTecnicaPct" DECIMAL(18,6),
    "observacoes" TEXT,
    "vigenciaInicio" TIMESTAMP(3) NOT NULL,
    "vigenciaFim" TIMESTAMP(3),
    "fonte" TEXT NOT NULL,
    "atualizadoPorNome" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimVeiculoModelo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimFuncao" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "funcao" TEXT NOT NULL,
    "cct" TEXT,
    "regiao" TEXT,
    "salarioBase" DECIMAL(18,6),
    "adicionaisFixos" DECIMAL(18,6),
    "hePct" DECIMAL(18,6),
    "noturnoPct" DECIMAL(18,6),
    "encargosPct" DECIMAL(18,6),
    "vrVa" DECIMAL(18,6),
    "cesta" DECIMAL(18,6),
    "valeTransporte" DECIMAL(18,6),
    "planoSaude" DECIMAL(18,6),
    "seguroVida" DECIMAL(18,6),
    "uniformeEpi" DECIMAL(18,6),
    "examesCursos" DECIMAL(18,6),
    "absenteismoPct" DECIMAL(18,6),
    "rotatividadePct" DECIMAL(18,6),
    "custoTotalPosto" DECIMAL(18,6),
    "observacoes" TEXT,
    "vigenciaInicio" TIMESTAMP(3) NOT NULL,
    "vigenciaFim" TIMESTAMP(3),
    "fonte" TEXT NOT NULL,
    "atualizadoPorNome" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimFuncao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimPedagioPraca" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "praca" TEXT NOT NULL,
    "concessionaria" TEXT,
    "tarifaVan" DECIMAL(18,6),
    "tarifaMicro" DECIMAL(18,6),
    "tarifaOnibus2" DECIMAL(18,6),
    "tarifaOnibus3" DECIMAL(18,6),
    "descontoTagPct" DECIMAL(18,6),
    "operacoes" TEXT,
    "dataTarifa" TEXT,
    "observacoes" TEXT,
    "vigenciaInicio" TIMESTAMP(3) NOT NULL,
    "vigenciaFim" TIMESTAMP(3),
    "fonte" TEXT NOT NULL,
    "atualizadoPorNome" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimPedagioPraca_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimReferencia" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "aba" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "dados" JSONB NOT NULL,
    "vigenciaInicio" TIMESTAMP(3) NOT NULL,
    "vigenciaFim" TIMESTAMP(3),
    "fonte" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimReferencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimEstudo" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'LICITACAO',
    "nome" TEXT NOT NULL,
    "cliente" TEXT,
    "tipoServico" TEXT NOT NULL,
    "uf" TEXT,
    "municipio" TEXT,
    "descricao" TEXT,
    "criterioJulgamento" TEXT NOT NULL DEFAULT 'ITEM',
    "unidadePreco" TEXT NOT NULL DEFAULT 'KM',
    "vigenciaMeses" INTEGER,
    "prazoPagamentoDias" INTEGER,
    "dataOrcamento" TIMESTAMP(3),
    "indiceReajuste" TEXT,
    "orgao" TEXT,
    "numeroEdital" TEXT,
    "modalidade" TEXT,
    "plataforma" TEXT,
    "dataSessao" TIMESTAMP(3),
    "srp" BOOLEAN NOT NULL DEFAULT false,
    "valorTotalMaximo" DECIMAL(18,6),
    "prorrogavelAte" TEXT,
    "garantiaPct" DECIMAL(18,6),
    "status" TEXT NOT NULL DEFAULT 'EM_ESTUDO',
    "resultadoPosicao" INTEGER,
    "resultadoVencedor" TEXT,
    "resultadoPrecoKm" DECIMAL(18,6),
    "resultadoValorTotal" DECIMAL(18,6),
    "resultadoData" TIMESTAMP(3),
    "resultadoObservacao" TEXT,
    "omieContratoId" TEXT,
    "fonte" TEXT,
    "observacoes" TEXT,
    "criadoPorNome" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimEstudo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimRegra" (
    "id" TEXT NOT NULL,
    "estudoId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "tema" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "fonte" TEXT,
    "impacto" TEXT,
    "campoAfetado" TEXT,

    CONSTRAINT "SimRegra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimItem" (
    "id" TEXT NOT NULL,
    "estudoId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "codigo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "shareIntermunicipal" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "precoMaximoKm" DECIMAL(18,6),
    "precoReferenciaKm" DECIMAL(18,6),
    "comMotorista" BOOLEAN NOT NULL DEFAULT true,
    "combustivelPorContaDoCliente" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SimItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimRota" (
    "id" TEXT NOT NULL,
    "estudoId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "itemCodigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "kmReferencia" DECIMAL(18,6) NOT NULL,
    "kmDia" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "kmTerraDia" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "diasMes" INTEGER,
    "veiculos" DECIMAL(18,6) NOT NULL,
    "motoristas" DECIMAL(18,6) NOT NULL,
    "monitoras" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "noturno" BOOLEAN NOT NULL DEFAULT false,
    "passagensPedagioMes" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "tarifaPedagio" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "viagensDia" DECIMAL(18,6),
    "periodos" TEXT,
    "horarioInicio" TEXT,
    "horarioFim" TEXT,
    "tipoVeiculoExigido" TEXT,
    "lotacaoMinima" INTEGER,
    "idadeMaxima" INTEGER,
    "kmMaximo" INTEGER,
    "acessivel" BOOLEAN,
    "horasDia" DECIMAL(18,6),
    "perfilVeiculo" TEXT,

    CONSTRAINT "SimRota_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimSimulacao" (
    "id" TEXT NOT NULL,
    "estudoId" TEXT NOT NULL,
    "versao" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RASCUNHO',
    "entrada" JSONB NOT NULL,
    "origem" JSONB,
    "resultado" JSONB NOT NULL,
    "utilizacao" DECIMAL(18,6) NOT NULL,
    "precoKm" DECIMAL(18,6),
    "custoTotal" DECIMAL(18,6) NOT NULL,
    "faturamento" DECIMAL(18,6) NOT NULL,
    "lucro" DECIMAL(18,6) NOT NULL,
    "margem" DECIMAL(18,6),
    "baseEm" TIMESTAMP(3),
    "motorVersao" TEXT NOT NULL,
    "autorNome" TEXT,
    "observacoes" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimSimulacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimLance" (
    "id" TEXT NOT NULL,
    "estudoId" TEXT NOT NULL,
    "simulacaoId" TEXT,
    "fase" TEXT NOT NULL,
    "dataHora" TIMESTAMP(3) NOT NULL,
    "precos" JSONB NOT NULL,
    "valorTotal" DECIMAL(18,6),
    "observacao" TEXT,
    "registradoPorNome" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimLance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimContratoRealizado" (
    "id" TEXT NOT NULL,
    "estudoId" TEXT NOT NULL,
    "competencia" TEXT NOT NULL,
    "kmPrevisto" DECIMAL(18,6),
    "kmRealizado" DECIMAL(18,6),
    "faturamento" DECIMAL(18,6),
    "custoFolha" DECIMAL(18,6),
    "custoCombustivel" DECIMAL(18,6),
    "custoManutencao" DECIMAL(18,6),
    "custoVeiculo" DECIMAL(18,6),
    "custoPedagio" DECIMAL(18,6),
    "custoIndiretos" DECIMAL(18,6),
    "custoOutros" DECIMAL(18,6),
    "fonte" TEXT NOT NULL,
    "registradoPorNome" TEXT,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimContratoRealizado_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SimParametro_companyId_chave_vigenciaInicio_idx" ON "SimParametro"("companyId", "chave", "vigenciaInicio");

-- CreateIndex
CREATE INDEX "SimVeiculoModelo_companyId_chave_vigenciaInicio_idx" ON "SimVeiculoModelo"("companyId", "chave", "vigenciaInicio");

-- CreateIndex
CREATE INDEX "SimFuncao_companyId_chave_vigenciaInicio_idx" ON "SimFuncao"("companyId", "chave", "vigenciaInicio");

-- CreateIndex
CREATE INDEX "SimPedagioPraca_companyId_chave_vigenciaInicio_idx" ON "SimPedagioPraca"("companyId", "chave", "vigenciaInicio");

-- CreateIndex
CREATE INDEX "SimReferencia_companyId_aba_chave_idx" ON "SimReferencia"("companyId", "aba", "chave");

-- CreateIndex
CREATE INDEX "SimEstudo_companyId_tipo_status_idx" ON "SimEstudo"("companyId", "tipo", "status");

-- CreateIndex
CREATE INDEX "SimEstudo_companyId_criadoEm_idx" ON "SimEstudo"("companyId", "criadoEm");

-- CreateIndex
CREATE INDEX "SimRegra_estudoId_ordem_idx" ON "SimRegra"("estudoId", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "SimItem_estudoId_codigo_key" ON "SimItem"("estudoId", "codigo");

-- CreateIndex
CREATE INDEX "SimRota_estudoId_ordem_idx" ON "SimRota"("estudoId", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "SimSimulacao_estudoId_versao_key" ON "SimSimulacao"("estudoId", "versao");

-- CreateIndex
CREATE INDEX "SimLance_estudoId_dataHora_idx" ON "SimLance"("estudoId", "dataHora");

-- CreateIndex
CREATE UNIQUE INDEX "SimContratoRealizado_estudoId_competencia_key" ON "SimContratoRealizado"("estudoId", "competencia");

-- AddForeignKey
ALTER TABLE "SimRegra" ADD CONSTRAINT "SimRegra_estudoId_fkey" FOREIGN KEY ("estudoId") REFERENCES "SimEstudo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimItem" ADD CONSTRAINT "SimItem_estudoId_fkey" FOREIGN KEY ("estudoId") REFERENCES "SimEstudo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimRota" ADD CONSTRAINT "SimRota_estudoId_fkey" FOREIGN KEY ("estudoId") REFERENCES "SimEstudo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimSimulacao" ADD CONSTRAINT "SimSimulacao_estudoId_fkey" FOREIGN KEY ("estudoId") REFERENCES "SimEstudo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimLance" ADD CONSTRAINT "SimLance_estudoId_fkey" FOREIGN KEY ("estudoId") REFERENCES "SimEstudo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimLance" ADD CONSTRAINT "SimLance_simulacaoId_fkey" FOREIGN KEY ("simulacaoId") REFERENCES "SimSimulacao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimContratoRealizado" ADD CONSTRAINT "SimContratoRealizado_estudoId_fkey" FOREIGN KEY ("estudoId") REFERENCES "SimEstudo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

