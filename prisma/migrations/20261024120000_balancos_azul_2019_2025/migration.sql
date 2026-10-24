-- Balanços da AZUL (CNPJ 10.764.533/0001-01) de 2019 a 2025, lidos das ECDs
-- e das demonstrações financeiras enviadas pela empresa. Gravados no escopo da
-- empresa (a conexão Omie da Azul), não do grupo: falta o balanço da MCZ.
--
-- Só cria o que não existe: um balanço já lançado à mão na mesma data-base
-- fica como está. Relançar pela tela substitui (é o caminho para o 2025
-- revisado). Sem a conexão da Azul (bases de teste), não grava nada.
WITH azul AS (
  SELECT DISTINCT ON (cx."companyId") cx."companyId", cx.id
    FROM "OmieConexao" cx
   WHERE regexp_replace(COALESCE(cx.cnpj, ''), '[^0-9]', '', 'g') = '10764533000101'
   ORDER BY cx."companyId", cx.ativa DESC, cx.ordem
), dados (data_base, caixa, receber, ac, imob, at, forn, pc, dcp, dlp, pl, dividendos, dep, ll, rl, ebit, ir, obs) AS (
  VALUES
  (DATE '2019-12-31', 25918.84, 306706.01, 2541400.05, 6300680.74, 10262714.86, 908201.03, 2171200.62, 314167.83, 521547.00, 7322717.86, NULL, 764985.91, 794205.14, 12779559.28, 1812204.63, 678896.50, 'ECD 2019 (livro 11) e abertura do livro 2020. Dívida CP inclui R$ 203.057,83 de saldo bancário negativo (o caixa exclui).'),
  (DATE '2020-12-31', 630124.22, 833467.88, 4352768.49, 6352520.95, 12771459.52, 2131560.48, 3536642.04, 271110.00, 1838878.38, 6764685.05, NULL, 55868.77, -558032.81, 7898998.00, 74429.08, 407954.47, 'ECD 2020 (livro 12). A abertura do livro 2021 traz R$ 350 mil a menos de reservas, devolvidos na abertura de 2022. Fora da dívida: títulos a pagar LP R$ 390.677,91 e tributos LP.'),
  (DATE '2021-12-31', 508884.14, 2251651.46, 5712215.57, 5841938.65, 14007536.38, 1428320.71, 3042702.93, 271110.00, 1682479.18, 8712792.92, NULL, NULL, 2438107.87, 10486295.15, 2699986.61, NULL, 'Abertura do livro 2022 (o livro 2021 difere em R$ 350 mil de reservas). DRE do livro 2021: sem depreciação e sem IRPJ/CSLL em linha própria. Fora da dívida: títulos a pagar LP R$ 350.019,66.'),
  (DATE '2022-12-31', 883431.38, 977322.59, 7435469.71, 6251460.96, 16541285.84, 751103.71, 2909788.97, 271110.00, 698178.11, 12392063.90, NULL, 94535.60, 3930962.52, 31673453.63, 4253133.88, NULL, 'ECD 2022 (livro 14). Sem IRPJ/CSLL em linha própria na DRE. Fora da dívida: títulos a pagar LP R$ 350.019,66.'),
  (DATE '2023-12-31', 1043697.38, 832802.57, 3876499.95, 8493906.44, 16093068.23, 604695.75, 2287618.88, 159417.63, 0, 13805449.35, NULL, NULL, 6133021.61, 33032908.24, 6241271.19, NULL, 'ECD 2023 (livro 15). DRE sem depreciação e sem IRPJ/CSLL em linha própria.'),
  (DATE '2024-12-31', 671200.41, 9179504.90, 18342996.20, 25560720.51, 54202767.03, 9002790.67, 17692559.38, 318436.71, 6183620.89, 29614559.85, NULL, 1682295.80, 17579627, 60364851, 19914083, 1973435, 'Troca de contabilidade: balanço do livro 17 (mai-dez/2024, = abertura de 2025); DRE das DFs da JL Business (jan-abr + mai-dez). Depreciação só mai-dez. Dívida CP inclui banco a descoberto; parcelamentos fora.'),
  (DATE '2025-12-31', 1690248.13, 9461293.75, 18770298.74, 35194213.68, 75038507.90, 779225.76, 16670720.21, 6825528.93, 9133145.60, 10936125.45, 38000000, 4053590.31, 24234505, 71773497, 30128743, 4187982, 'ECD 2025 (livro 18) e DFs da JL Business. Imobilizado da ECD (as DFs somam R$ 18,18 mi de títulos a receber LP; será corrigido no balanço revisado). Dívida CP inclui conta garantida R$ 50 mil; parcelamentos fora.')
)
INSERT INTO "BalancoPatrimonial" (
  "id", "companyId", "escopo", "dataBase", "caixa", "contasReceber", "ativoCirculante", "imobilizadoLiquido",
  "ativoTotal", "fornecedores", "passivoCirculante", "dividaCurtoPrazo", "dividaLongoPrazo", "patrimonioLiquido",
  "dividendosAPagar", "depreciacaoAno", "lucroLiquidoAno", "receitaLiquidaAno", "ebitAno", "irCsllAno",
  "custoCapitalAa", "observacao", "autorNome", "criadoEm", "atualizadoEm"
)
SELECT 'bal' || substr(md5(azul."companyId" || azul.id || d.data_base::text), 1, 22),
       azul."companyId", azul.id, d.data_base, d.caixa, d.receber, d.ac, d.imob, d.at, d.forn, d.pc, d.dcp, d.dlp, d.pl,
       d.dividendos, d.dep, d.ll, d.rl, d.ebit, d.ir, 0.18, d.obs, 'Importado dos PDFs da contabilidade', NOW(), NOW()
  FROM azul CROSS JOIN dados d
ON CONFLICT ("companyId", "escopo", "dataBase") DO NOTHING;
