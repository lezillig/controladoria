-- Azul Mob — Plataforma de Gestão
-- DDL inicial (Fase 0). Detalhes de cada tabela em docs/02-modelo-de-dados.md.
-- Convenções: snake_case sem acento; timestamptz em UTC; numeric(14,2) para dinheiro; sem delete físico.

CREATE SCHEMA IF NOT EXISTS cadastro;
CREATE SCHEMA IF NOT EXISTS compliance;
CREATE SCHEMA IF NOT EXISTS pessoas;
CREATE SCHEMA IF NOT EXISTS operacao;
CREATE SCHEMA IF NOT EXISTS frota;
CREATE SCHEMA IF NOT EXISTS financeiro;
CREATE SCHEMA IF NOT EXISTS comercial;
CREATE SCHEMA IF NOT EXISTS auditoria;

-- ---------- função utilitária: atualizado_em ----------
CREATE OR REPLACE FUNCTION public.set_atualizado_em() RETURNS trigger AS $$
BEGIN NEW.atualizado_em = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

-- =====================================================================
-- CADASTRO (mestre)
-- =====================================================================
CREATE TABLE cadastro.fornecedor (
  id            bigserial PRIMARY KEY,
  cnpj          char(14) NOT NULL UNIQUE,
  razao_social  text NOT NULL,
  categoria     text,                -- combustivel | pecas | seguro | financiamento | servicos | outros
  id_omie       bigint,
  ativo         boolean NOT NULL DEFAULT true,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cadastro.cliente (
  id            bigserial PRIMARY KEY,
  cnpj          char(14) NOT NULL UNIQUE,
  razao_social  text NOT NULL,
  nome_fantasia text,
  tipo          text NOT NULL CHECK (tipo IN ('privado','publico')),
  contato       jsonb,
  id_omie       bigint,
  ativo         boolean NOT NULL DEFAULT true,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cadastro.veiculo (
  id             bigserial PRIMARY KEY,
  placa          char(7) NOT NULL UNIQUE,     -- normalizada: maiúscula, sem hífen
  renavam        text, chassi text,
  tipo           text NOT NULL CHECK (tipo IN ('van','micro','onibus','outro')),
  marca text, modelo text, ano_fab int, ano_mod int,
  capacidade     int,
  categoria_uso  text CHECK (categoria_uso IN ('fretamento','escolar','cargas','misto')),
  status         text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','manutencao','reserva','vendido','baixado')),
  data_compra date, valor_compra numeric(14,2), fornecedor_id bigint REFERENCES cadastro.fornecedor(id),
  data_venda  date, valor_venda  numeric(14,2),
  vida_util_meses int DEFAULT 120,             -- para depreciação linear
  id_ituran      text,
  observacoes    text,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cadastro.pessoa (
  id              bigserial PRIMARY KEY,
  cpf             char(11) NOT NULL UNIQUE,
  nome            text NOT NULL,
  data_nasc       date,
  cargo           text NOT NULL,              -- motorista | monitor | mecanico | adm | gestor
  data_admissao   date, data_desligamento date,
  matricula_ponto text UNIQUE,
  telefone text, email text,
  ativo           boolean NOT NULL DEFAULT true,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cadastro.contrato (
  id                 bigserial PRIMARY KEY,
  numero_contrato    text NOT NULL UNIQUE,
  cliente_id         bigint NOT NULL REFERENCES cadastro.cliente(id),
  tipo               text NOT NULL CHECK (tipo IN ('fretamento_continuo','escolar','eventual','locacao')),
  segmento           text,
  inicio date NOT NULL, fim date,
  valor_mensal       numeric(14,2),
  indice_reajuste    text,                    -- IPCA | IGPM | planilha | ...
  data_base_reajuste date,
  sla                jsonb,                   -- {"pontualidade_min_pct":95,"tolerancia_atraso_min":10}
  calendario         jsonb,                   -- feriados, recesso escolar
  origem             text CHECK (origem IN ('licitacao','privado')),
  licitacao_id       bigint,                  -- FK adicionada após comercial.licitacao
  status             text NOT NULL DEFAULT 'vigente' CHECK (status IN ('vigente','encerrado','suspenso')),
  criado_em          timestamptz NOT NULL DEFAULT now(),
  atualizado_em      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cadastro.linha (
  id                   bigserial PRIMARY KEY,
  contrato_id          bigint NOT NULL REFERENCES cadastro.contrato(id),
  codigo               text NOT NULL,
  nome                 text,
  turno                text,                  -- manha | tarde | noite | integral
  km_planejado         int,
  horario_saida time, horario_chegada time,
  veiculo_padrao_id    bigint REFERENCES cadastro.veiculo(id),
  motorista_padrao_id  bigint REFERENCES cadastro.pessoa(id),
  id_ituran_rota       text,
  ativo                boolean NOT NULL DEFAULT true,
  UNIQUE (contrato_id, codigo)
);

CREATE TABLE cadastro.ponto_parada (
  id               bigserial PRIMARY KEY,
  linha_id         bigint NOT NULL REFERENCES cadastro.linha(id),
  ordem            int NOT NULL,
  nome             text,
  lat double precision, lng double precision,
  horario_previsto time,
  UNIQUE (linha_id, ordem)
);

CREATE TABLE cadastro.centro_custo (
  id            bigserial PRIMARY KEY,
  codigo        text NOT NULL UNIQUE,         -- V-ABC1D23 | C-0123/2026 | ADM
  tipo          text NOT NULL CHECK (tipo IN ('veiculo','contrato','administrativo')),
  veiculo_id    bigint REFERENCES cadastro.veiculo(id),
  contrato_id   bigint REFERENCES cadastro.contrato(id),
  id_omie       bigint,
  ativo         boolean NOT NULL DEFAULT true
);

-- =====================================================================
-- COMPLIANCE
-- =====================================================================
CREATE TABLE compliance.tipo_documento (
  id                 bigserial PRIMARY KEY,
  codigo             text NOT NULL UNIQUE,     -- CNH, EAR, CURSO_ESCOLAR, CRLV, ARTESP, ...
  nome               text NOT NULL,
  aplica_a           text NOT NULL CHECK (aplica_a IN ('veiculo','pessoa','empresa')),
  obrigatorio_para   text[],                   -- {'escolar','fretamento'}
  antecedencia_dias  int NOT NULL DEFAULT 30
);

CREATE TABLE compliance.documento (
  id                 bigserial PRIMARY KEY,
  tipo_documento_id  bigint NOT NULL REFERENCES compliance.tipo_documento(id),
  veiculo_id         bigint REFERENCES cadastro.veiculo(id),
  pessoa_id          bigint REFERENCES cadastro.pessoa(id),
  contrato_id        bigint REFERENCES cadastro.contrato(id),
  numero             text, orgao text,
  emissao date, vencimento date,
  arquivo_url        text,
  status             text NOT NULL DEFAULT 'vigente' CHECK (status IN ('vigente','a_vencer','vencido','renovando','cancelado')),
  criado_em          timestamptz NOT NULL DEFAULT now(),
  atualizado_em      timestamptz NOT NULL DEFAULT now(),
  CHECK (veiculo_id IS NOT NULL OR pessoa_id IS NOT NULL OR contrato_id IS NOT NULL OR true)
);
CREATE INDEX ON compliance.documento (vencimento);

CREATE TABLE compliance.vistoria (
  id             bigserial PRIMARY KEY,
  veiculo_id     bigint NOT NULL REFERENCES cadastro.veiculo(id),
  data           timestamptz NOT NULL,
  tipo           text NOT NULL CHECK (tipo IN ('diaria','interna','orgao')),
  checklist      jsonb,
  aprovado       boolean,
  pendencias     text,
  responsavel_id bigint REFERENCES cadastro.pessoa(id)
);

CREATE TABLE compliance.apolice (
  id            bigserial PRIMARY KEY,
  seguradora    text NOT NULL, numero text NOT NULL UNIQUE,
  segmento      text,                          -- fretamento | escolar | cargas | antt
  vigencia_ini date NOT NULL, vigencia_fim date NOT NULL,
  corretora     text, valor numeric(14,2),
  ativo         boolean NOT NULL DEFAULT true
);
CREATE TABLE compliance.apolice_veiculo (
  apolice_id bigint REFERENCES compliance.apolice(id),
  veiculo_id bigint REFERENCES cadastro.veiculo(id),
  PRIMARY KEY (apolice_id, veiculo_id)
);

-- =====================================================================
-- PESSOAS
-- =====================================================================
CREATE TABLE pessoas.escala (
  id          bigserial PRIMARY KEY,
  pessoa_id   bigint NOT NULL REFERENCES cadastro.pessoa(id),
  data        date NOT NULL,
  linha_id    bigint REFERENCES cadastro.linha(id),
  veiculo_id  bigint REFERENCES cadastro.veiculo(id),
  turno       text,
  origem      text NOT NULL DEFAULT 'planejada' CHECK (origem IN ('planejada','realizada'))
);
CREATE INDEX ON pessoas.escala (data, pessoa_id);

CREATE TABLE pessoas.marcacao_ponto (
  id             bigserial PRIMARY KEY,
  pessoa_id      bigint NOT NULL REFERENCES cadastro.pessoa(id),
  data_hora      timestamptz NOT NULL,
  tipo           text,                         -- entrada | saida | intervalo_ini | intervalo_fim
  origem_api_id  text UNIQUE,
  valida         boolean,
  erro           jsonb
);
CREATE INDEX ON pessoas.marcacao_ponto (pessoa_id, data_hora);

CREATE TABLE pessoas.jornada_dia (
  pessoa_id          bigint REFERENCES cadastro.pessoa(id),
  data               date,
  horas_trabalhadas  numeric(5,2), horas_extras numeric(5,2),
  intervalo_ok       boolean, interjornada_ok boolean, excedeu_limite boolean,
  observacao         text,
  PRIMARY KEY (pessoa_id, data)
);

CREATE TABLE pessoas.ocorrencia_rh (
  id bigserial PRIMARY KEY, pessoa_id bigint NOT NULL REFERENCES cadastro.pessoa(id),
  data date NOT NULL, tipo text NOT NULL, descricao text, criado_em timestamptz DEFAULT now()
);

-- =====================================================================
-- OPERACAO
-- =====================================================================
CREATE TABLE operacao.viagem (
  id               bigserial PRIMARY KEY,
  linha_id         bigint NOT NULL REFERENCES cadastro.linha(id),
  data             date NOT NULL,
  veiculo_id       bigint REFERENCES cadastro.veiculo(id),
  motorista_id     bigint REFERENCES cadastro.pessoa(id),
  status           text NOT NULL DEFAULT 'planejada' CHECK (status IN ('planejada','em_curso','realizada','cancelada')),
  saida_prevista timestamptz, saida_real timestamptz,
  chegada_prevista timestamptz, chegada_real timestamptz,
  km_realizado     int,
  UNIQUE (linha_id, data)
);

CREATE TABLE operacao.posicao (
  veiculo_id  bigint NOT NULL REFERENCES cadastro.veiculo(id),
  data_hora   timestamptz NOT NULL,
  lat double precision, lng double precision,
  velocidade  smallint, odometro int, ignicao boolean,
  id_ituran   text,
  PRIMARY KEY (veiculo_id, data_hora)
) PARTITION BY RANGE (data_hora);
-- criar partições mensais via migração, ex.: operacao.posicao_2026_10

CREATE TABLE operacao.evento_viagem (
  id            bigserial PRIMARY KEY,
  viagem_id     bigint REFERENCES operacao.viagem(id),
  veiculo_id    bigint REFERENCES cadastro.veiculo(id),
  tipo          text NOT NULL,                -- atraso | desvio | veiculo_errado | parada_nao_prevista | excesso_velocidade | frenagem_brusca | inicio | fim
  data_hora     timestamptz NOT NULL,
  severidade    text CHECK (severidade IN ('baixa','media','alta','critica')),
  detalhe       jsonb,
  origem_agente text
);
CREATE INDEX ON operacao.evento_viagem (data_hora, tipo);

CREATE TABLE operacao.ocorrencia_operacional (
  id bigserial PRIMARY KEY, viagem_id bigint REFERENCES operacao.viagem(id),
  tipo text NOT NULL, descricao text, responsavel_id bigint REFERENCES cadastro.pessoa(id),
  criado_em timestamptz DEFAULT now(), resolvido_em timestamptz
);

CREATE TABLE operacao.aluno (
  id bigserial PRIMARY KEY, contrato_id bigint NOT NULL REFERENCES cadastro.contrato(id),
  nome text NOT NULL, responsavel jsonb, ponto_parada_id bigint REFERENCES cadastro.ponto_parada(id),
  ativo boolean NOT NULL DEFAULT true
);
CREATE TABLE operacao.frequencia_aluno (
  viagem_id bigint REFERENCES operacao.viagem(id), aluno_id bigint REFERENCES operacao.aluno(id),
  embarque timestamptz, desembarque timestamptz, PRIMARY KEY (viagem_id, aluno_id)
);

-- =====================================================================
-- FROTA
-- =====================================================================
CREATE TABLE frota.plano_manutencao (
  id bigserial PRIMARY KEY, tipo_veiculo text NOT NULL, item text NOT NULL,
  intervalo_km int, intervalo_dias int, UNIQUE (tipo_veiculo, item)
);
CREATE TABLE frota.ordem_servico (
  id bigserial PRIMARY KEY, veiculo_id bigint NOT NULL REFERENCES cadastro.veiculo(id),
  tipo text NOT NULL CHECK (tipo IN ('preventiva','corretiva')),
  abertura timestamptz NOT NULL DEFAULT now(), fechamento timestamptz, km int,
  fornecedor_id bigint REFERENCES cadastro.fornecedor(id),
  itens jsonb, valor_pecas numeric(14,2), valor_mao_obra numeric(14,2),
  nota_fiscal_id bigint, status text NOT NULL DEFAULT 'aberta'
);
CREATE TABLE frota.abastecimento (
  id bigserial PRIMARY KEY, veiculo_id bigint NOT NULL REFERENCES cadastro.veiculo(id),
  motorista_id bigint REFERENCES cadastro.pessoa(id), data_hora timestamptz NOT NULL,
  litros numeric(8,2) NOT NULL, valor numeric(14,2), km int,
  posto_id bigint REFERENCES cadastro.fornecedor(id),
  origem text CHECK (origem IN ('cartao','manual','api')), anomalia boolean DEFAULT false, detalhe jsonb
);
CREATE INDEX ON frota.abastecimento (veiculo_id, data_hora);
CREATE TABLE frota.pneu (
  id bigserial PRIMARY KEY, numero_fogo text NOT NULL UNIQUE, marca text, medida text,
  vida text CHECK (vida IN ('novo','R1','R2','sucata')), status text, custo numeric(14,2)
);
CREATE TABLE frota.pneu_posicao (
  id bigserial PRIMARY KEY, pneu_id bigint NOT NULL REFERENCES frota.pneu(id),
  veiculo_id bigint NOT NULL REFERENCES cadastro.veiculo(id), posicao text,
  instalado_em date, removido_em date, km_instalacao int, km_remocao int
);
CREATE TABLE frota.multa (
  id bigserial PRIMARY KEY, veiculo_id bigint NOT NULL REFERENCES cadastro.veiculo(id),
  motorista_id bigint REFERENCES cadastro.pessoa(id), auto_infracao text UNIQUE,
  data_infracao timestamptz, data_notificacao date, prazo_indicacao date, prazo_recurso date,
  valor numeric(14,2), pontos smallint,
  status text NOT NULL DEFAULT 'recebida' CHECK (status IN ('recebida','indicada','recorrida','paga','descontada','cancelada'))
);
CREATE TABLE frota.sinistro (
  id bigserial PRIMARY KEY, veiculo_id bigint NOT NULL REFERENCES cadastro.veiculo(id),
  motorista_id bigint REFERENCES cadastro.pessoa(id), data timestamptz NOT NULL,
  descricao text, terceiros jsonb, apolice_id bigint REFERENCES compliance.apolice(id),
  franquia numeric(14,2), status text
);
CREATE TABLE frota.financiamento (
  id bigserial PRIMARY KEY, veiculo_id bigint NOT NULL REFERENCES cadastro.veiculo(id),
  instituicao text NOT NULL, tipo text CHECK (tipo IN ('CDC','consorcio','leasing')),
  parcelas int, parcelas_pagas int, valor_parcela numeric(14,2), saldo_devedor numeric(14,2),
  vencimento_dia smallint, contrato_numero text, ativo boolean NOT NULL DEFAULT true
);

-- =====================================================================
-- FINANCEIRO
-- =====================================================================
CREATE TABLE financeiro.nota_fiscal (
  id bigserial PRIMARY KEY, chave text UNIQUE, numero text, emitente_cnpj char(14),
  valor numeric(14,2), data date, arquivo_url text,
  origem text CHECK (origem IN ('email','omie','manual')), validada boolean DEFAULT false, dados jsonb
);
CREATE TABLE financeiro.lancamento (
  id bigserial PRIMARY KEY, id_omie bigint UNIQUE,
  tipo text NOT NULL CHECK (tipo IN ('pagar','receber')),
  fornecedor_id bigint REFERENCES cadastro.fornecedor(id), cliente_id bigint REFERENCES cadastro.cliente(id),
  centro_custo_id bigint REFERENCES cadastro.centro_custo(id), categoria text,
  competencia date, vencimento date, pagamento date, valor numeric(14,2) NOT NULL,
  status text, nota_fiscal_id bigint REFERENCES financeiro.nota_fiscal(id),
  descricao text, atualizado_em timestamptz DEFAULT now()
);
CREATE INDEX ON financeiro.lancamento (competencia, centro_custo_id);
CREATE TABLE financeiro.faturamento_contrato (
  contrato_id bigint REFERENCES cadastro.contrato(id), competencia date,
  valor_previsto numeric(14,2), valor_faturado numeric(14,2), medicao jsonb, status text,
  PRIMARY KEY (contrato_id, competencia)
);
-- views materializadas custo_veiculo_mes e margem_contrato_mes: criadas na Fase 5 (specs/06)

-- =====================================================================
-- COMERCIAL
-- =====================================================================
CREATE TABLE comercial.licitacao (
  id bigserial PRIMARY KEY, orgao text NOT NULL, numero text, uf char(2), objeto text,
  modalidade text, data_abertura timestamptz, prazo_proposta timestamptz, prazo_recurso timestamptz,
  valor_estimado numeric(14,2), aderencia text CHECK (aderencia IN ('alta','media','baixa')),
  status text NOT NULL DEFAULT 'radar' CHECK (status IN ('radar','analisando','participando','vencida','perdida','descartada')),
  url_pncp text UNIQUE, resumo jsonb, criado_em timestamptz DEFAULT now()
);
ALTER TABLE cadastro.contrato ADD CONSTRAINT fk_contrato_licitacao FOREIGN KEY (licitacao_id) REFERENCES comercial.licitacao(id);
CREATE TABLE comercial.proposta (
  id bigserial PRIMARY KEY, licitacao_id bigint REFERENCES comercial.licitacao(id),
  cliente_id bigint REFERENCES cadastro.cliente(id), versao int NOT NULL DEFAULT 1,
  composicao_custos jsonb, preco numeric(14,2), margem_prevista numeric(5,2),
  status text, criado_em timestamptz DEFAULT now()
);
CREATE TABLE comercial.reajuste (
  id bigserial PRIMARY KEY, contrato_id bigint NOT NULL REFERENCES cadastro.contrato(id),
  data_prevista date NOT NULL, indice text, percentual numeric(6,3), aplicado boolean DEFAULT false, data_aplicacao date
);
CREATE TABLE comercial.parametros_custo (
  competencia date PRIMARY KEY, dados jsonb NOT NULL   -- custos reais médios publicados pela controladoria
);

-- =====================================================================
-- AUDITORIA
-- =====================================================================
CREATE TABLE auditoria.log (
  id bigserial PRIMARY KEY, data_hora timestamptz NOT NULL DEFAULT now(),
  usuario text, agente text, tabela text NOT NULL, registro_id bigint,
  operacao text NOT NULL, antes jsonb, depois jsonb
);
CREATE INDEX ON auditoria.log (tabela, registro_id);
CREATE INDEX ON auditoria.log (data_hora);

CREATE TABLE auditoria.pendencia (
  id bigserial PRIMARY KEY, agente text, tipo text NOT NULL, titulo text NOT NULL, descricao text,
  severidade text CHECK (severidade IN ('baixa','media','alta','critica')),
  evidencias jsonb, acao_proposta jsonb, perfil_aprovador text NOT NULL,
  chave_excecao text,                           -- para idempotência: agente:tipo:referencia
  status text NOT NULL DEFAULT 'aguardando_aprovacao'
    CHECK (status IN ('aguardando_aprovacao','aprovada','rejeitada','executada','erro')),
  criada_em timestamptz DEFAULT now(), decidida_por text, decidida_em timestamptz,
  comentario text, executada_em timestamptz, erro text
);
CREATE UNIQUE INDEX ON auditoria.pendencia (chave_excecao) WHERE status = 'aguardando_aprovacao';

CREATE TABLE auditoria.execucao_agente (
  id bigserial PRIMARY KEY, agente text NOT NULL, inicio timestamptz NOT NULL, fim timestamptz,
  registros_lidos int, excecoes int, pendencias_criadas int, alertas_enviados int, erro text
);
CREATE TABLE auditoria.alerta (
  id bigserial PRIMARY KEY, tipo text NOT NULL, destinatarios text[], assunto text, corpo text,
  enviado_em timestamptz DEFAULT now(), referencia jsonb, chave_excecao text
);
CREATE INDEX ON auditoria.alerta (chave_excecao, enviado_em);

-- ---------- triggers atualizado_em ----------
DO $$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cadastro.fornecedor','cadastro.cliente','cadastro.veiculo','cadastro.pessoa','cadastro.contrato','compliance.documento']
  LOOP EXECUTE format('CREATE TRIGGER trg_atualizado BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION public.set_atualizado_em()', t);
  END LOOP;
END $$;
