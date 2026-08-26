-- RESUMO MENSAL — a memória longa da auditoria.
--
-- Tabela DERIVADA: reconstruível inteira a partir de OmieTitulo e OmieBaixa, e
-- recalculada a cada janela de sincronização que toca a competência. Nada aqui
-- é fonte de verdade, e recálculo errado se conserta rodando de novo.
--
-- Existe porque o contexto dos agentes tem teto de 400 dias (carregar anos de
-- títulos em memória a cada ciclo esgotou a franquia do banco uma vez), e as
-- perguntas que só o histórico responde precisam de anos. Somado por mês, cinco
-- anos de um fornecedor são sessenta linhas em vez de milhares de títulos.

CREATE TABLE "HistoricoMensal" (
    "id"                TEXT NOT NULL,
    "companyId"         TEXT NOT NULL,
    "conexaoId"         TEXT NOT NULL,
    "competencia"       TEXT NOT NULL,
    "natureza"          TEXT NOT NULL,
    "dimensao"          TEXT NOT NULL,
    "chave"             TEXT NOT NULL,
    "rotulo"            TEXT,
    "titulos"           INTEGER NOT NULL DEFAULT 0,
    "valorCents"        INTEGER NOT NULL DEFAULT 0,
    "valorMaximoCents"  INTEGER NOT NULL DEFAULT 0,
    "baixas"            INTEGER NOT NULL DEFAULT 0,
    "valorBaixadoCents" INTEGER NOT NULL DEFAULT 0,
    "diasPagamentoSoma" INTEGER NOT NULL DEFAULT 0,
    "calculadoEm"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistoricoMensal_pkey" PRIMARY KEY ("id")
);

-- A unicidade é o que faz o recálculo ser idempotente: rodar duas vezes a mesma
-- competência atualiza a linha em vez de duplicá-la.
CREATE UNIQUE INDEX "HistoricoMensal_chave_unica"
    ON "HistoricoMensal" ("companyId", "conexaoId", "competencia", "natureza", "dimensao", "chave");

-- A consulta dos agentes: a série de UMA chave ao longo do tempo.
CREATE INDEX "HistoricoMensal_serie_idx"
    ON "HistoricoMensal" ("companyId", "dimensao", "chave", "competencia");

-- E o corte por mês, para o recálculo e para as telas.
CREATE INDEX "HistoricoMensal_competencia_idx"
    ON "HistoricoMensal" ("companyId", "competencia");
