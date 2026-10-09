-- Varredura do modelo de custos (out/2026), decisão da diretoria: lucro alvo
-- de 7% do preço e contingência de 1% do custo direto. O retorno do veículo já
-- vem da remuneração do capital (agora real); 12% + 3% somados a ela punham
-- ~44% de margem EBITDA no preço, contra 23–24% da operação.
--
-- Como a tela Custos base faz: encerra a vigência do valor atual e abre uma
-- nova, sem apagar o histórico. Só baixa (nunca sobe) o que está na base, e a
-- margem mínima só quando passaria do novo alvo (vai à metade dele).
WITH alvo(chave, valor) AS (
  VALUES ('margem_alvo', 0.07::numeric), ('contingencia_pct', 0.01::numeric), ('margem_minima', 0.035::numeric)
),
encerrados AS (
  UPDATE "SimParametro" p
     SET "vigenciaFim" = now()
    FROM alvo a
   WHERE p.chave = a.chave
     AND p."vigenciaFim" IS NULL
     AND p.valor IS NOT NULL
     AND CASE WHEN a.chave = 'margem_minima' THEN p.valor >= 0.07 ELSE p.valor > a.valor END
  RETURNING p."companyId", p.entidade, p.chave, p.rotulo, p.unidade, p.texto, a.valor AS novo
)
INSERT INTO "SimParametro" (id, "companyId", entidade, chave, rotulo, unidade, valor, texto, "vigenciaInicio", fonte, "atualizadoPorNome", "criadoEm")
SELECT 'varredura-' || md5(e."companyId" || e.chave || clock_timestamp()::text),
       e."companyId", e.entidade, e.chave, e.rotulo, e.unidade, e.novo, e.texto, now(),
       'Varredura do modelo de custos (out/2026) — decisão da diretoria', 'Revisão do modelo de custos', now()
  FROM encerrados e;
