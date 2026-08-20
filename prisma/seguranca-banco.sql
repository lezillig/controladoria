-- Usuário Postgres exclusivo para o sistema de Controladoria.
--
-- OPCIONAL. O sistema funciona sem este script, usando o mesmo usuário do
-- banco que o sistema de gestão de motoristas. Rode-o quando quiser mais
-- isolamento entre os dois: com um usuário próprio e permissões mínimas, mesmo
-- que a credencial DESTE sistema vaze, ninguém consegue alterar nada da gestão
-- — nem ler tabela que a auditoria não precisa (ponto, escalas, afastamentos,
-- que carregam dado trabalhista e de saúde).
--
-- Rode no console SQL do banco (Neon, Supabase, etc.) com um usuário que tenha
-- permissão para criar role e schema. Depois, use a nova credencial na
-- DATABASE_URL deste sistema — sempre com `?schema=controladoria` no fim.

-- 1. O usuário. Troque a senha por uma gerada aleatoriamente e guarde-a
--    direto nas variáveis de ambiente da hospedagem.
CREATE ROLE controladoria_app LOGIN PASSWORD 'TROQUE-POR-UMA-SENHA-FORTE';

-- 2. O schema próprio, do qual ele é dono. É aqui que ficam as tabelas deste
--    sistema e o histórico de migrações dele — separado do da gestão, para que
--    um `prisma migrate deploy` nunca dispute o histórico do outro.
CREATE SCHEMA IF NOT EXISTS controladoria AUTHORIZATION controladoria_app;

-- 3. Leitura das tabelas da operação — apenas as que a auditoria realmente
--    consulta. A ausência das demais é deliberada: não há motivo para o
--    sistema financeiro conseguir ler marcação de ponto ou atestado médico.
GRANT USAGE ON SCHEMA public TO controladoria_app;
GRANT SELECT ON
  public."Driver",           -- fornecedor que é funcionário; custo por pessoa
  public."Vehicle",          -- custo por veículo
  public."Cliente",          -- contratos, para o rateio por centro de custo
  public."FuelTransaction",  -- combustível do cartão de frota x Omie
  public."User",             -- autenticação (login compartilhado)
  public."Company"           -- nome da empresa e escopo multiempresa
TO controladoria_app;

-- 4. Garantia explícita de que é só leitura. Redundante com o passo 3 (não
--    concedemos escrita), mas deixa a intenção registrada no próprio banco:
--    se alguém rodar um GRANT ALL distraído no futuro, este revoke documenta
--    qual era o desenho.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM controladoria_app;

-- 5. Tabela nova criada pela gestão no futuro NÃO fica legível por padrão.
--    É o comportamento correto: o acesso deve ser concedido conscientemente,
--    tabela a tabela, e não herdado por acidente.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM controladoria_app;

-- Conferir depois de rodar:
--   \dn+ controladoria
--   SELECT table_name, privilege_type
--     FROM information_schema.role_table_grants
--    WHERE grantee = 'controladoria_app';
