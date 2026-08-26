-- ÍNDICE SOBRE A DATA DE COMPETÊNCIA.
--
-- A competência de um título é COALESCE("dataEmissao", "dataVencimento") — ver
-- src/lib/controladoria/competencia.ts, e a razão de ser assim está lá. O
-- efeito colateral é que todo filtro por período vira uma EXPRESSÃO no WHERE, e
-- expressão não usa índice de coluna: o índice
-- ("companyId", natureza, "dataVencimento") existe e fica parado, enquanto o
-- banco varre a tabela inteira e calcula o COALESCE linha a linha.
--
-- Passava despercebido enquanto as telas liam um mês. Apareceu na conferência
-- de CT-e com o ano inteiro colado: a consulta cruza o período com uma lista de
-- centenas de valores, a varredura estourou o tempo limite da função na
-- hospedagem, e a tela não mostrou nada — nem resultado, nem erro.
--
-- Índice por EXPRESSÃO, que é o que casa com a consulta como ela é escrita.
-- Trocar a consulta para caber no índice existente seria mudar a semântica
-- (vencimento no lugar de emissão), e essa distinção custou uma conferência
-- contra a declaração da contabilidade para ser acertada.
--
-- NOTA PARA QUEM RODAR `prisma migrate dev`: o Prisma não modela índice por
-- expressão, então ele não aparece no schema e pode ser relatado como drift.
-- É esperado — o índice é objeto de banco, não de modelo.

CREATE INDEX IF NOT EXISTS "OmieTitulo_competencia_idx"
    ON "OmieTitulo" ("companyId", natureza, (COALESCE("dataEmissao", "dataVencimento")));

-- Mesma consulta, segunda condição: o casamento por VALOR, usado quando o
-- título está sem número de documento fiscal (o que, na base real, era o caso
-- de 24 dos 56 títulos de CT-e).
CREATE INDEX IF NOT EXISTS "OmieTitulo_valor_idx"
    ON "OmieTitulo" ("companyId", natureza, "valorDocumentoCents");
