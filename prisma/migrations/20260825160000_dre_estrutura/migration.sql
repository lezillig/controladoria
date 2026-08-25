-- ESTRUTURA DE DRE.
--
-- Duas coisas, e a ordem entre elas importa.
--
-- 1. A CLASSIFICAÇÃO QUE A OMIE JÁ MANDAVA E NÓS JOGÁVAMOS FORA.
--    `ListarCategorias` devolve `codigo_dre`, `conta_receita`, `conta_despesa`
--    e `tipo_categoria` em toda categoria — o diagnóstico mostrou os quatro
--    chegando nas duas empresas. Nada disso era guardado, e por isso o "DRE"
--    da tela era uma lista de categorias em duas metades: sem receita líquida,
--    sem lucro bruto, sem resultado operacional. Guardar o que já vem é o
--    caminho mais curto para um DRE que bate com a contabilidade, porque é a
--    classificação que a própria empresa usa.
--
-- 2. O MAPEAMENTO EDITÁVEL. A classificação da Omie diz se a categoria é
--    receita ou despesa; não diz se uma despesa é CUSTO do serviço ou DESPESA
--    operacional — e essa é justamente a linha que separa lucro bruto de
--    resultado operacional. Combustível é custo; contabilidade é despesa. A
--    Omie não tem como saber, e adivinhar por nome daria um DRE que parece
--    certo e não é.
--
--    Por isso a linha do DRE de cada categoria é um DADO, não uma regra no
--    código: o sistema propõe pelo que a Omie informa, e uma pessoa confirma
--    ou corrige uma vez. O histórico de quem classificou fica junto, porque a
--    pergunta "por que combustível está em despesa?" precisa de resposta.

-- AlterTable
ALTER TABLE "OmieCategoria" ADD COLUMN     "codigoDre" TEXT,
ADD COLUMN     "contaDespesa" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "contaReceita" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tipoCategoria" TEXT;

-- CreateTable
CREATE TABLE "DreClassificacao" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    -- Sem conexaoId: o plano de categorias é o mesmo nas duas empresas do
    -- grupo, e classificar duas vezes o mesmo código seria a forma mais rápida
    -- de as duas divergirem sem ninguém notar.
    "categoriaCodigo" TEXT NOT NULL,
    "linha" TEXT NOT NULL,
    -- Subgrupo livre, para a análise que a empresa quiser montar por cima da
    -- estrutura legal (ex.: "Frota", "Pessoal operacional", "Sede"). Nulo =
    -- aparece direto na linha do DRE, sem subtotal intermediário.
    "subgrupo" TEXT,
    -- Como esta classificação chegou: PROPOSTA (deduzida do que a Omie
    -- informa) ou CONFIRMADA (uma pessoa olhou). A tela mostra a diferença,
    -- porque um DRE montado só com palpite não pode ser apresentado como se
    -- tivesse sido conferido.
    "origem" TEXT NOT NULL DEFAULT 'PROPOSTA',
    "userNome" TEXT,
    "observacao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DreClassificacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DreClassificacao_companyId_categoriaCodigo_key" ON "DreClassificacao"("companyId", "categoriaCodigo");
CREATE INDEX "DreClassificacao_companyId_linha_idx" ON "DreClassificacao"("companyId", "linha");
