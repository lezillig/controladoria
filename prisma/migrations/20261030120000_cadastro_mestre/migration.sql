-- PLATAFORMA ÚNICA, FASE 0 — CADASTRO MESTRE (docs/plataforma/specs/01).
-- Só tabelas novas: nada do que existe é alterado ou apagado.

CREATE TABLE "CadFornecedor" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "razaoSocial" TEXT NOT NULL,
    "nomeFantasia" TEXT,
    "categoria" TEXT,
    "idsOmie" JSONB NOT NULL DEFAULT '{}',
    "origens" JSONB NOT NULL DEFAULT '{}',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CadFornecedor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CadCliente" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "razaoSocial" TEXT NOT NULL,
    "nomeFantasia" TEXT,
    "tipo" TEXT NOT NULL DEFAULT 'privado',
    "contato" JSONB,
    "idsOmie" JSONB NOT NULL DEFAULT '{}',
    "origens" JSONB NOT NULL DEFAULT '{}',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CadCliente_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CadVeiculo" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "placa" TEXT NOT NULL,
    "renavam" TEXT,
    "chassi" TEXT,
    "tipo" TEXT NOT NULL DEFAULT 'outro',
    "marca" TEXT,
    "modelo" TEXT,
    "anoFab" INTEGER,
    "anoMod" INTEGER,
    "capacidade" INTEGER,
    "categoriaUso" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ativo',
    "empresa" TEXT,
    "dataCompra" TIMESTAMP(3),
    "valorCompraCents" BIGINT,
    "fornecedorId" TEXT,
    "dataVenda" TIMESTAMP(3),
    "valorVendaCents" BIGINT,
    "vidaUtilMeses" INTEGER NOT NULL DEFAULT 120,
    "idIturan" TEXT,
    "observacoes" TEXT,
    "origens" JSONB NOT NULL DEFAULT '{}',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CadVeiculo_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CadPessoa" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "dataNasc" TIMESTAMP(3),
    "cargo" TEXT NOT NULL,
    "dataAdmissao" TIMESTAMP(3),
    "dataDesligamento" TIMESTAMP(3),
    "matriculaPonto" TEXT,
    "telefone" TEXT,
    "email" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "origens" JSONB NOT NULL DEFAULT '{}',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CadPessoa_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CadContrato" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "numeroContrato" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "segmento" TEXT,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3),
    "valorMensalCents" BIGINT,
    "indiceReajuste" TEXT,
    "dataBaseReajuste" TIMESTAMP(3),
    "sla" JSONB,
    "calendario" JSONB,
    "origem" TEXT,
    "licitacaoId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'vigente',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CadContrato_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CadLinha" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contratoId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT,
    "turno" TEXT,
    "kmPlanejado" INTEGER,
    "horarioSaida" TEXT,
    "horarioChegada" TEXT,
    "veiculoPadraoId" TEXT,
    "motoristaPadraoId" TEXT,
    "idIturanRota" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CadLinha_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CadPontoParada" (
    "id" TEXT NOT NULL,
    "linhaId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "nome" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "horarioPrevisto" TEXT,

    CONSTRAINT "CadPontoParada_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CadCentroCusto" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "veiculoId" TEXT,
    "contratoId" TEXT,
    "idsOmie" JSONB NOT NULL DEFAULT '{}',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CadCentroCusto_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FrotaFinanciamento" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "veiculoId" TEXT NOT NULL,
    "instituicao" TEXT NOT NULL,
    "tipo" TEXT,
    "parcelas" INTEGER,
    "parcelasPagas" INTEGER,
    "valorParcelaCents" BIGINT,
    "saldoDevedorCents" BIGINT,
    "vencimentoDia" INTEGER,
    "contratoNumero" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FrotaFinanciamento_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AudLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "dataHora" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuario" TEXT,
    "agente" TEXT,
    "tabela" TEXT NOT NULL,
    "registroId" TEXT NOT NULL,
    "operacao" TEXT NOT NULL,
    "antes" JSONB,
    "depois" JSONB,

    CONSTRAINT "AudLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AudPendencia" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "agente" TEXT,
    "tipo" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "severidade" TEXT NOT NULL DEFAULT 'media',
    "evidencias" JSONB,
    "acaoProposta" JSONB,
    "perfilAprovador" TEXT NOT NULL,
    "chaveExcecao" TEXT,
    "status" TEXT NOT NULL DEFAULT 'aguardando_aprovacao',
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decididaPor" TEXT,
    "decididaEm" TIMESTAMP(3),
    "comentario" TEXT,
    "executadaEm" TIMESTAMP(3),
    "erro" TEXT,

    CONSTRAINT "AudPendencia_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CadFornecedor_companyId_cnpj_key" ON "CadFornecedor"("companyId", "cnpj");

CREATE UNIQUE INDEX "CadCliente_companyId_cnpj_key" ON "CadCliente"("companyId", "cnpj");

CREATE INDEX "CadVeiculo_companyId_status_idx" ON "CadVeiculo"("companyId", "status");

CREATE UNIQUE INDEX "CadVeiculo_companyId_placa_key" ON "CadVeiculo"("companyId", "placa");

CREATE INDEX "CadPessoa_companyId_ativo_idx" ON "CadPessoa"("companyId", "ativo");

CREATE UNIQUE INDEX "CadPessoa_companyId_cpf_key" ON "CadPessoa"("companyId", "cpf");

CREATE UNIQUE INDEX "CadPessoa_companyId_matriculaPonto_key" ON "CadPessoa"("companyId", "matriculaPonto");

CREATE UNIQUE INDEX "CadContrato_companyId_numeroContrato_key" ON "CadContrato"("companyId", "numeroContrato");

CREATE UNIQUE INDEX "CadLinha_contratoId_codigo_key" ON "CadLinha"("contratoId", "codigo");

CREATE UNIQUE INDEX "CadPontoParada_linhaId_ordem_key" ON "CadPontoParada"("linhaId", "ordem");

CREATE UNIQUE INDEX "CadCentroCusto_companyId_codigo_key" ON "CadCentroCusto"("companyId", "codigo");

CREATE INDEX "FrotaFinanciamento_companyId_veiculoId_idx" ON "FrotaFinanciamento"("companyId", "veiculoId");

CREATE INDEX "AudLog_companyId_tabela_registroId_idx" ON "AudLog"("companyId", "tabela", "registroId");

CREATE INDEX "AudLog_companyId_dataHora_idx" ON "AudLog"("companyId", "dataHora");

CREATE INDEX "AudPendencia_companyId_status_criadaEm_idx" ON "AudPendencia"("companyId", "status", "criadaEm");

ALTER TABLE "CadVeiculo" ADD CONSTRAINT "CadVeiculo_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "CadFornecedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CadContrato" ADD CONSTRAINT "CadContrato_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "CadCliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CadLinha" ADD CONSTRAINT "CadLinha_contratoId_fkey" FOREIGN KEY ("contratoId") REFERENCES "CadContrato"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CadLinha" ADD CONSTRAINT "CadLinha_veiculoPadraoId_fkey" FOREIGN KEY ("veiculoPadraoId") REFERENCES "CadVeiculo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CadLinha" ADD CONSTRAINT "CadLinha_motoristaPadraoId_fkey" FOREIGN KEY ("motoristaPadraoId") REFERENCES "CadPessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CadPontoParada" ADD CONSTRAINT "CadPontoParada_linhaId_fkey" FOREIGN KEY ("linhaId") REFERENCES "CadLinha"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CadCentroCusto" ADD CONSTRAINT "CadCentroCusto_veiculoId_fkey" FOREIGN KEY ("veiculoId") REFERENCES "CadVeiculo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CadCentroCusto" ADD CONSTRAINT "CadCentroCusto_contratoId_fkey" FOREIGN KEY ("contratoId") REFERENCES "CadContrato"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FrotaFinanciamento" ADD CONSTRAINT "FrotaFinanciamento_veiculoId_fkey" FOREIGN KEY ("veiculoId") REFERENCES "CadVeiculo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A mesma exceção não abre duas pendências enquanto uma aguarda decisão.
CREATE UNIQUE INDEX "AudPendencia_chaveExcecao_aguardando_key" ON "AudPendencia"("companyId", "chaveExcecao") WHERE "status" = 'aguardando_aprovacao' AND "chaveExcecao" IS NOT NULL;
