-- ICMS do transporte intermunicipal de passageiros em SP: 12% com crédito
-- outorgado de 20% do imposto = 9,6% de carga efetiva (até 31/12/2026;
-- confirmar a prorrogação). Só troca a base que está nos 12% cheios; abre
-- nova vigência e mantém o histórico, como a tela Custos base.
WITH encerrados AS (
  UPDATE "SimParametro" p
     SET "vigenciaFim" = now()
   WHERE p.chave = 'icms_sp'
     AND p."vigenciaFim" IS NULL
     AND p.valor IN (0.12, 12)
  RETURNING p."companyId", p.entidade, p.chave, p.rotulo, p.unidade, p.texto, p.valor
)
INSERT INTO "SimParametro" (id, "companyId", entidade, chave, rotulo, unidade, valor, texto, "vigenciaInicio", fonte, "atualizadoPorNome", "criadoEm")
SELECT 'icms-' || md5(e."companyId" || clock_timestamp()::text),
       e."companyId", e.entidade, e.chave, e.rotulo, e.unidade,
       CASE WHEN e.valor = 12 THEN 9.6 ELSE 0.096 END, e.texto, now(),
       'Varredura do modelo de custos (out/2026): 12% com crédito outorgado de 20% (carga efetiva até 31/12/2026)', 'Revisão do modelo de custos', now()
  FROM encerrados e;
