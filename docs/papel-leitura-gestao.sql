-- PAPEL SOMENTE LEITURA PARA A CONTROLADORIA, NO BANCO DA GESTÃO.
--
-- Rode este script CONECTADO AO BANCO DA GESTÃO, com um papel que tenha
-- permissão de administração (no Neon, o papel dono do projeto).
--
-- POR QUE ELE EXISTE
--
-- Com os dois sistemas em bancos separados, a Controladoria precisa continuar
-- lendo seis tabelas da gestão. Duas delas sustentam o login e a reconferência
-- de sessão a cada requisição; as outras quatro sustentam os cruzamentos que
-- dão valor à auditoria.
--
-- Dar a ela a string de conexão principal resolveria — e seria o erro. Aquela
-- conexão pode escrever, apagar e alterar estrutura em todo o banco. Um bug
-- num `$queryRaw`, uma migração disparada por engano ou uma credencial vazada
-- passariam a alcançar a operação inteira: motorista, veículo, ponto, folha.
--
-- Este papel torna a separação uma propriedade do BANCO, e não uma promessa de
-- quem escreve o código. Com ele, a Controladoria fisicamente não consegue
-- escrever na gestão, nem ler tabela que não lhe diz respeito.
--
-- ---------------------------------------------------------------------------
-- 1. Criar o papel
-- ---------------------------------------------------------------------------
-- Troque a senha por uma longa e aleatória, gerada no seu gerenciador de
-- senhas. Ela vai para a variável GESTAO_DATABASE_URL do projeto controladoria
-- na Vercel, e para mais lugar nenhum.

CREATE ROLE controladoria_leitura WITH LOGIN PASSWORD 'TROQUE-POR-UMA-SENHA-LONGA-E-ALEATORIA';

-- ---------------------------------------------------------------------------
-- 2. Permitir chegar ao banco e enxergar o schema
-- ---------------------------------------------------------------------------
-- CONNECT sozinho não dá acesso a dado nenhum; USAGE no schema permite
-- referenciar as tabelas, mas ainda não lê-las.

GRANT CONNECT ON DATABASE current_database() TO controladoria_leitura;
GRANT USAGE ON SCHEMA public TO controladoria_leitura;

-- ---------------------------------------------------------------------------
-- 3. Conceder SELECT nas SEIS tabelas, e só nelas
-- ---------------------------------------------------------------------------
-- A lista é fechada de propósito. `GRANT SELECT ON ALL TABLES` seria mais
-- curto e daria à Controladoria acesso a ponto, folha, ocorrência disciplinar
-- e tudo o mais que a gestão guarda — dado trabalhista e pessoal que ela não
-- tem motivo para enxergar. Menos privilégio não é rigor: é o que limita o
-- estrago quando algo dá errado.
--
-- Se a gestão criar uma tabela nova que a Controladoria precise ler, este
-- arquivo é o lugar de acrescentar — e a falta da permissão aparece como erro
-- claro na tela de sincronização, não como dado sumindo em silêncio.

GRANT SELECT ON public."User"            TO controladoria_leitura;  -- login e reconferência de sessão
GRANT SELECT ON public."Company"         TO controladoria_leitura;  -- empresas do grupo, e o ciclo diário
GRANT SELECT ON public."Driver"          TO controladoria_leitura;  -- fornecedor cujo CPF é de motorista
GRANT SELECT ON public."Vehicle"         TO controladoria_leitura;  -- custo por veículo
GRANT SELECT ON public."Cliente"         TO controladoria_leitura;  -- rentabilidade por contrato
GRANT SELECT ON public."FuelTransaction" TO controladoria_leitura;  -- combustível do cartão x título do posto

-- ---------------------------------------------------------------------------
-- 4. Garantir que continue somente leitura no futuro
-- ---------------------------------------------------------------------------
-- Sem isto, uma tabela criada amanhã poderia nascer com permissão de escrita
-- para este papel, dependendo da configuração do banco. A regra passa a valer
-- para o que ainda não existe.

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM controladoria_leitura;

-- ---------------------------------------------------------------------------
-- 5. Conferir — antes de confiar
-- ---------------------------------------------------------------------------
-- Deve listar exatamente as seis tabelas, todas com privilege_type = SELECT.
-- Qualquer INSERT, UPDATE ou DELETE nesta lista é erro.

SELECT table_name, privilege_type
  FROM information_schema.table_privileges
 WHERE grantee = 'controladoria_leitura'
 ORDER BY table_name, privilege_type;

-- ---------------------------------------------------------------------------
-- 6. Montar a string de conexão
-- ---------------------------------------------------------------------------
-- Pegue a string do banco da GESTÃO no Neon e troque usuário e senha pelos
-- deste papel. Cadastre na Vercel, no projeto controladoria, como:
--
--   GESTAO_DATABASE_URL
--
-- Marque como Sensitive. Sem essa variável, a Controladoria continua lendo a
-- gestão pela conexão principal — o que só está correto enquanto os dois
-- sistemas dividirem o mesmo banco. A tela de sincronização diz qual dos dois
-- modos está valendo, para isso nunca ser uma suposição.
--
-- ---------------------------------------------------------------------------
-- PARA DESFAZER, se precisar
-- ---------------------------------------------------------------------------
--   REVOKE ALL ON ALL TABLES IN SCHEMA public FROM controladoria_leitura;
--   REVOKE ALL ON SCHEMA public FROM controladoria_leitura;
--   DROP ROLE controladoria_leitura;
