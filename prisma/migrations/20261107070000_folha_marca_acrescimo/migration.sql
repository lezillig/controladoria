-- Checklist da folha: as marcas passam a ser só de acréscimo (marcar e
-- desmarcar são linhas novas; o estado é a última linha do item), com quem
-- marcou por id. E os itens do Financeiro e da Contabilidade ganham permissão
-- própria (marcar "salário pago" não é do RH).

DROP INDEX IF EXISTS "FolhaFechamentoMarca_companyId_conexaoId_competencia_chave_key";
ALTER TABLE "FolhaFechamentoMarca" ADD COLUMN "acao" TEXT NOT NULL DEFAULT 'feito';
ALTER TABLE "FolhaFechamentoMarca" ADD COLUMN "feitoPorId" TEXT;
CREATE INDEX "FolhaFechamentoMarca_companyId_conexaoId_competencia_chave__idx"
  ON "FolhaFechamentoMarca"("companyId", "conexaoId", "competencia", "chave", "feitoEm");

CREATE OR REPLACE FUNCTION folha_marca_imutavel() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'FolhaFechamentoMarca e so de acrescimo: % nao e permitido', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER folha_marca_sem_alteracao
  BEFORE UPDATE OR DELETE ON "FolhaFechamentoMarca"
  FOR EACH ROW EXECUTE FUNCTION folha_marca_imutavel();

-- As permissões novas para quem já marcava esses itens: o perfil que opera
-- tudo (tem "gerir-modelo") ganha as duas; o do Financeiro (tem
-- "conciliacao" e não é o de leitura) ganha a do Financeiro e a tela.
UPDATE "PerfilAcesso"
   SET "permissoes" = array(SELECT DISTINCT unnest("permissoes" || ARRAY['marcar-folha-financeiro', 'marcar-folha-contabilidade']))
 WHERE 'gerir-modelo' = ANY("permissoes");
UPDATE "PerfilAcesso"
   SET "permissoes" = array(SELECT DISTINCT unnest("permissoes" || ARRAY['folha', 'marcar-folha-financeiro']))
 WHERE 'conciliacao' = ANY("permissoes") AND 'informar-saldo' = ANY("permissoes") AND NOT ('gerir-modelo' = ANY("permissoes"));
