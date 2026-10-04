import { categoriasEmColisao, categoriasPorChave, descreverColisoes } from "./chaveCategoria";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tabela } from "@/lib/esquemaDoBanco";
import { competenciaSql, semProvisaoFuturaSql } from "./competencia";
import {
  categoriaSql,
  ehCorporativoSql,
  ehIntercompanySql,
  filtroConexaoBaixa,
  filtroConexaoTitulo,
  filtroSoConexaoBaixa,
  naJanela,
  type EscopoSql,
} from "./escopoSql";
import { montarJanelas, ultimoMesFechado, type Periodo } from "./periodos";
import {
  LINHAS_DRE,
  RETENCOES_ZERADAS,
  TITULOS_POR_CATEGORIA_NA_TELA,
  montarDreDeInsumos,
  resumirDre,
  rotulosDosMeses,
  type ResumoDre,
  type CategoriaParaDre,
  type InsumosDre,
  type LinhaDreAnual,
  type OpcoesDre,
  type ResultadoDre,
  type ResultadoDreAnual,
  type Retencoes,
  type TituloDoDre,
} from "./dre";

// A COLHEITA DO DRE, SOMADA NO BANCO.
//
// Gêmeo de `insumosDoContexto` (em dre.ts), que colhe os mesmos números de
// títulos já carregados na memória. A conta em si — linhas, subtotais,
// percentuais — é a MESMA função nos dois caminhos (`montarDreDeInsumos`), então
// não existe uma segunda implementação da demonstração para divergir da
// primeira. O que existe em dois caminhos é só a colheita.
//
// POR QUE OS DOIS EXISTEM, medido em Postgres local com 50 mil títulos:
//
//   ler as linhas da janela (13 meses)  1.040 ms   50.000 linhas
//   somar por categoria (GROUP BY)         24 ms         40 linhas
//
// Pela rede a diferença cresce: são dezenas de megabytes contra alguns
// kilobytes. A tela de Custos e DRE lia treze meses de títulos para exibir
// quarenta linhas de soma, e trocar de menu levava segundos.
//
// Os AGENTES continuam precisando das linhas — "fornecedor cujo CPF é de um
// motorista da folha" não sai de uma soma —, e por isso o caminho em memória
// não sai de cena.
//
// A JANELA CONTINUA SENDO PASSADA, e isto é deliberado: ela reproduz
// exatamente o recorte que `carregarContexto` aplicaria: janela de datas OU
// título em aberto. Sem ela, o regime de caixa passaria a somar pagamentos de
// títulos antigos que a leitura em memória não vê, e esta refatoração — que é
// de desempenho — mudaria números de tela em silêncio. Corrigir esse recorte é
// uma decisão à parte, visível, não um efeito colateral.
//
// O que garante a equivalência não é este comentário: é `scripts/teste-dre-banco.ts`,
// que roda as duas colheitas sobre o MESMO banco e exige a mesma demonstração,
// linha a linha, nos dois regimes.

// O escopo é o compartilhado (ver escopoSql.ts): empresa, conexão e janela.
export type EscopoDre = EscopoSql;

// `corp`: a parcela da soma que vem de empresa de papel CORPORATIVO — separa as
// duas linhas de pessoas (ver LINHAS_DRE em dre.ts).
type LinhaSoma = { categoria: string; cents: bigint; corp: bigint };
type LinhaMovimento = { categoria: string; natureza: string; cents: bigint };
type LinhaRetencao = {
  iss: bigint | null;
  pis: bigint | null;
  cofins: bigint | null;
  csll: bigint | null;
  ir: bigint | null;
  inss: bigint | null;
  quantidade: bigint | null;
};
type LinhaDrill = {
  id: string;
  categoria: string;
  natureza: string;
  parceiro: string;
  documento: string | null;
  data: Date;
  cents: number;
  empresa: string;
  corporativo: boolean;
  total: bigint;
};
type LinhaSomaMes = { categoria: string; mes: number; cents: bigint; corp: bigint };

type Somas = { mapa: Map<string, number>; corp: Map<string, number> };

function mapaDeSomas(linhas: LinhaSoma[]): Somas {
  return {
    mapa: new Map(linhas.map((l) => [l.categoria, Number(l.cents)])),
    corp: new Map(linhas.filter((l) => Number(l.corp) !== 0).map((l) => [l.categoria, Number(l.corp)])),
  };
}

function retencaoDaLinha(linha: LinhaRetencao | undefined): Retencoes {
  if (!linha) return RETENCOES_ZERADAS;
  const issCents = Number(linha.iss ?? 0);
  const pisCents = Number(linha.pis ?? 0);
  const cofinsCents = Number(linha.cofins ?? 0);
  const csllCents = Number(linha.csll ?? 0);
  const irCents = Number(linha.ir ?? 0);
  const inssCents = Number(linha.inss ?? 0);
  return {
    issCents,
    pisCents,
    cofinsCents,
    csllCents,
    irCents,
    inssCents,
    totalCents: issCents + pisCents + cofinsCents + csllCents + irCents + inssCents,
    titulosComRetencao: Number(linha.quantidade ?? 0),
  };
}

// ---------------------------------------------------------------------------
// As consultas
// ---------------------------------------------------------------------------

// SOMA POR CATEGORIA no regime de COMPETÊNCIA. Receita e despesa entram no
// mesmo mapa, somadas sem módulo — como no original: é o total da categoria, e
// o sinal dela na demonstração sai do lado em que ela vive.
async function somaPorCategoriaCompetencia(escopo: EscopoDre, periodo: Periodo): Promise<Somas> {
  const linhas = await prisma.$queryRaw<LinhaSoma[]>`
    SELECT ${categoriaSql()} AS categoria,
           COALESCE(SUM(t."valorDocumentoCents"), 0)::bigint AS cents,
           COALESCE(SUM(t."valorDocumentoCents") FILTER (WHERE ${ehCorporativoSql(escopo.companyId)}), 0)::bigint AS corp
      FROM ${tabela("OmieTitulo")} t
     WHERE t."companyId" = ${escopo.companyId}
       AND t.cancelado = false
       AND ${semProvisaoFuturaSql("t")}
       AND ${competenciaSql("t")} >= ${periodo.inicio}
       AND ${competenciaSql("t")} <= ${periodo.fim}
       ${filtroConexaoTitulo(escopo.conexaoId, escopo.companyId)}
       ${naJanela(escopo.janela)}
     GROUP BY 1
  `;
  return mapaDeSomas(linhas);
}

// NO CAIXA O FATO É A BAIXA — data e valor do movimento do dinheiro —, e a
// categoria continua vindo do TÍTULO, que é quem sabe do que aquele dinheiro
// se trata. Título cancelado fica fora, como ficaria na competência.
async function somaPorCategoriaCaixa(escopo: EscopoDre, periodo: Periodo): Promise<Somas> {
  const linhas = await prisma.$queryRaw<LinhaSoma[]>`
    SELECT ${categoriaSql()} AS categoria,
           COALESCE(SUM(b."valorCents"), 0)::bigint AS cents,
           COALESCE(SUM(b."valorCents") FILTER (WHERE ${ehCorporativoSql(escopo.companyId)}), 0)::bigint AS corp
      FROM ${tabela("OmieBaixa")} b
      JOIN ${tabela("OmieTitulo")} t ON t.id = b."tituloId"
     WHERE b."companyId" = ${escopo.companyId}
       AND b."dataBaixa" >= ${periodo.inicio}
       AND b."dataBaixa" <= ${periodo.fim}
       AND t.cancelado = false
       ${filtroConexaoBaixa(escopo.conexaoId, escopo.companyId)}
       ${naJanela(escopo.janela)}
     GROUP BY 1
  `;
  return mapaDeSomas(linhas);
}

// O QUE A VISÃO DO GRUPO ELIMINOU, para a tela dizer. As duas consultas acima
// com o filtro invertido — o mesmo recorte (empresa, janela, cancelado, data do
// regime) e o mesmo critério de operação entre as empresas (escopoSql.ts) —,
// somadas por natureza. Com uma empresa filtrada nada é eliminado, e nem se
// consulta.
export async function intercompanyEliminado(
  escopo: EscopoDre,
  periodo: Periodo,
  regime: "competencia" | "caixa"
): Promise<{ receitaCents: number; despesaCents: number; titulos: number }> {
  if (escopo.conexaoId) return { receitaCents: 0, despesaCents: 0, titulos: 0 };
  const ehInterna = ehIntercompanySql(escopo.companyId);
  const linhas =
    regime === "caixa"
      ? await prisma.$queryRaw<{ natureza: string; cents: bigint; quantidade: bigint }[]>`
          SELECT t.natureza::text AS natureza,
                 COALESCE(SUM(b."valorCents"), 0)::bigint AS cents,
                 COUNT(DISTINCT t.id)::bigint AS quantidade
            FROM ${tabela("OmieBaixa")} b
            JOIN ${tabela("OmieTitulo")} t ON t.id = b."tituloId"
           WHERE b."companyId" = ${escopo.companyId}
             AND b."dataBaixa" >= ${periodo.inicio}
             AND b."dataBaixa" <= ${periodo.fim}
             AND t.cancelado = false
             AND ${ehInterna}
             ${naJanela(escopo.janela)}
           GROUP BY 1
        `
      : await prisma.$queryRaw<{ natureza: string; cents: bigint; quantidade: bigint }[]>`
          SELECT t.natureza::text AS natureza,
                 COALESCE(SUM(t."valorDocumentoCents"), 0)::bigint AS cents,
                 COUNT(*)::bigint AS quantidade
            FROM ${tabela("OmieTitulo")} t
           WHERE t."companyId" = ${escopo.companyId}
             AND t.cancelado = false
             AND ${semProvisaoFuturaSql("t")}
             AND ${competenciaSql("t")} >= ${periodo.inicio}
             AND ${competenciaSql("t")} <= ${periodo.fim}
             AND ${ehInterna}
             ${naJanela(escopo.janela)}
           GROUP BY 1
        `;
  const de = (n: string) => linhas.find((l) => l.natureza === n);
  return {
    receitaCents: Number(de("RECEBER")?.cents ?? 0),
    despesaCents: Number(de("PAGAR")?.cents ?? 0),
    titulos: linhas.reduce((a, l) => a + Number(l.quantidade), 0),
  };
}

function somaPorCategoria(escopo: EscopoDre, periodo: Periodo, regime: "competencia" | "caixa") {
  return regime === "caixa" ? somaPorCategoriaCaixa(escopo, periodo) : somaPorCategoriaCompetencia(escopo, periodo);
}

// DE QUE LADO CADA CATEGORIA VIVE — sobre TODA a janela, não sobre o mês.
// Restringir ao mês foi um defeito com efeito visível (ver o comentário no
// original): categoria sem movimento no mês ficava sem lado e caía no ramo de
// despesa, e uma ENTRADA aparecia como saída.
export async function movimentoPorCategoria(escopo: EscopoDre) {
  const linhas = await prisma.$queryRaw<LinhaMovimento[]>`
    SELECT ${categoriaSql()} AS categoria,
           t.natureza::text AS natureza,
           COALESCE(SUM(ABS(t."valorDocumentoCents")), 0)::bigint AS cents
      FROM ${tabela("OmieTitulo")} t
     WHERE t."companyId" = ${escopo.companyId}
       AND t.cancelado = false
       ${filtroConexaoTitulo(escopo.conexaoId, escopo.companyId)}
       ${naJanela(escopo.janela)}
     GROUP BY 1, 2
  `;
  const mapa = new Map<string, { receberCents: number; pagarCents: number }>();
  for (const l of linhas) {
    const m = mapa.get(l.categoria) ?? { receberCents: 0, pagarCents: 0 };
    if (l.natureza === "RECEBER") m.receberCents += Number(l.cents);
    else m.pagarCents += Number(l.cents);
    mapa.set(l.categoria, m);
  }
  return mapa;
}

// RETENÇÕES NA FONTE, competência: os títulos a receber emitidos no período.
async function retencoesCompetencia(escopo: EscopoDre, periodo: Periodo): Promise<Retencoes> {
  const [linha] = await prisma.$queryRaw<LinhaRetencao[]>`
    SELECT COALESCE(SUM(t."retencaoIssCents"), 0)::bigint    AS iss,
           COALESCE(SUM(t."retencaoPisCents"), 0)::bigint    AS pis,
           COALESCE(SUM(t."retencaoCofinsCents"), 0)::bigint AS cofins,
           COALESCE(SUM(t."retencaoCsllCents"), 0)::bigint   AS csll,
           COALESCE(SUM(t."retencaoIrCents"), 0)::bigint     AS ir,
           COALESCE(SUM(t."retencaoInssCents"), 0)::bigint   AS inss,
           COUNT(*) FILTER (
             WHERE t."retencaoIssCents" + t."retencaoPisCents" + t."retencaoCofinsCents"
                 + t."retencaoCsllCents" + t."retencaoIrCents" + t."retencaoInssCents" > 0
           )::bigint AS quantidade
      FROM ${tabela("OmieTitulo")} t
     WHERE t."companyId" = ${escopo.companyId}
       AND t.cancelado = false
       AND t.natureza = 'RECEBER'
       AND ${semProvisaoFuturaSql("t")}
       AND ${competenciaSql("t")} >= ${periodo.inicio}
       AND ${competenciaSql("t")} <= ${periodo.fim}
       ${filtroConexaoTitulo(escopo.conexaoId, escopo.companyId)}
       ${naJanela(escopo.janela)}
  `;
  return retencaoDaLinha(linha);
}

// NO CAIXA a retenção acompanha o RECEBIMENTO, e ela é gravada no título, não
// na baixa: um título recebido pela metade teve metade da retenção. Daí a
// proporção — é aproximação, e está dita no original: a Omie não devolve a
// retenção por baixa.
//
// `ROUND` do Postgres sobre `numeric` e `Math.round` do JavaScript concordam em
// valor positivo, que é o caso de toda retenção; os dois arredondam 0,5 para
// longe do zero.
async function retencoesCaixa(escopo: EscopoDre, periodo: Periodo): Promise<Retencoes> {
  const [linha] = await prisma.$queryRaw<LinhaRetencao[]>`
    WITH pago AS (
      SELECT b."tituloId" AS titulo, SUM(ABS(b."valorCents"))::numeric AS pago
        FROM ${tabela("OmieBaixa")} b
       WHERE b."companyId" = ${escopo.companyId}
         AND b."dataBaixa" >= ${periodo.inicio}
         AND b."dataBaixa" <= ${periodo.fim}
         ${filtroSoConexaoBaixa(escopo.conexaoId)}
       GROUP BY 1
    ), proporcional AS (
      SELECT ROUND(t."retencaoIssCents"    * LEAST(1, p.pago / ABS(t."valorDocumentoCents"))) AS iss,
             ROUND(t."retencaoPisCents"    * LEAST(1, p.pago / ABS(t."valorDocumentoCents"))) AS pis,
             ROUND(t."retencaoCofinsCents" * LEAST(1, p.pago / ABS(t."valorDocumentoCents"))) AS cofins,
             ROUND(t."retencaoCsllCents"   * LEAST(1, p.pago / ABS(t."valorDocumentoCents"))) AS csll,
             ROUND(t."retencaoIrCents"     * LEAST(1, p.pago / ABS(t."valorDocumentoCents"))) AS ir,
             ROUND(t."retencaoInssCents"   * LEAST(1, p.pago / ABS(t."valorDocumentoCents"))) AS inss
        FROM pago p
        JOIN ${tabela("OmieTitulo")} t ON t.id = p.titulo
       WHERE t."companyId" = ${escopo.companyId}
         AND t.cancelado = false
         AND t.natureza = 'RECEBER'
         AND t."valorDocumentoCents" > 0
         ${filtroConexaoTitulo(escopo.conexaoId, escopo.companyId)}
         ${naJanela(escopo.janela)}
    )
    SELECT COALESCE(SUM(iss), 0)::bigint    AS iss,
           COALESCE(SUM(pis), 0)::bigint    AS pis,
           COALESCE(SUM(cofins), 0)::bigint AS cofins,
           COALESCE(SUM(csll), 0)::bigint   AS csll,
           COALESCE(SUM(ir), 0)::bigint     AS ir,
           COALESCE(SUM(inss), 0)::bigint   AS inss,
           COUNT(*) FILTER (WHERE iss + pis + cofins + csll + ir + inss > 0)::bigint AS quantidade
      FROM proporcional
  `;
  return retencaoDaLinha(linha);
}

export function retencoes(escopo: EscopoDre, periodo: Periodo, regime: "competencia" | "caixa") {
  return regime === "caixa" ? retencoesCaixa(escopo, periodo) : retencoesCompetencia(escopo, periodo);
}

// OS MAIORES REGISTROS DE CADA CATEGORIA, para o drill-down — e a CONTAGEM de
// todos eles, que é outro número na tela ("20 de 4.312").
//
// A ordem de desempate é a mesma do original no que ela pode ser: valor
// absoluto decrescente e, dentro do mesmo valor, o lado a receber antes do a
// pagar. Empate exato de valor entre dois títulos da mesma natureza pode trocar
// as posições entre as duas colheitas — é a lista de exemplos, não a soma, e a
// soma não depende dela.
async function drillCompetencia(escopo: EscopoDre, periodo: Periodo) {
  const linhas = await prisma.$queryRaw<LinhaDrill[]>`
    SELECT * FROM (
      SELECT t.id,
             ${categoriaSql()} AS categoria,
             t.natureza::text AS natureza,
             COALESCE(t."parceiroNome", '(sem parceiro)') AS parceiro,
             t."numeroDocumento" AS documento,
             ${competenciaSql("t")} AS data,
             t."valorDocumentoCents" AS cents,
             t."conexaoApelido" AS empresa,
             ${ehCorporativoSql(escopo.companyId)} AS corporativo,
             -- Por categoria E papel da empresa: cada linha de pessoas mostra
             -- os seus maiores e conta os seus (ver LINHAS_DRE em dre.ts). Nas
             -- demais linhas os dois pedaços se juntam de novo, e os vinte
             -- maiores da categoria estão sempre entre os vinte de cada lado.
             ROW_NUMBER() OVER (
               PARTITION BY ${categoriaSql()}, ${ehCorporativoSql(escopo.companyId)}
               ORDER BY ABS(t."valorDocumentoCents") DESC, t.natureza::text DESC, t."dataVencimento" ASC, t.id ASC
             ) AS pos,
             COUNT(*) OVER (PARTITION BY ${categoriaSql()}, ${ehCorporativoSql(escopo.companyId)})::bigint AS total
        FROM ${tabela("OmieTitulo")} t
       WHERE t."companyId" = ${escopo.companyId}
         AND t.cancelado = false
         AND ${semProvisaoFuturaSql("t")}
         AND ${competenciaSql("t")} >= ${periodo.inicio}
         AND ${competenciaSql("t")} <= ${periodo.fim}
         ${filtroConexaoTitulo(escopo.conexaoId, escopo.companyId)}
         ${naJanela(escopo.janela)}
    ) x
     WHERE x.pos <= ${TITULOS_POR_CATEGORIA_NA_TELA}
  `;
  return agruparDrill(linhas);
}

// No caixa o drill-down mostra os PAGAMENTOS, com a data e o valor de cada um:
// mostrar o título cheio faria a soma da lista não bater com a linha.
async function drillCaixa(escopo: EscopoDre, periodo: Periodo) {
  const linhas = await prisma.$queryRaw<LinhaDrill[]>`
    SELECT * FROM (
      SELECT b.id,
             ${categoriaSql()} AS categoria,
             t.natureza::text AS natureza,
             COALESCE(t."parceiroNome", '(sem parceiro)') AS parceiro,
             t."numeroDocumento" AS documento,
             b."dataBaixa" AS data,
             b."valorCents" AS cents,
             t."conexaoApelido" AS empresa,
             ${ehCorporativoSql(escopo.companyId)} AS corporativo,
             ROW_NUMBER() OVER (
               PARTITION BY ${categoriaSql()}, ${ehCorporativoSql(escopo.companyId)}
               ORDER BY ABS(b."valorCents") DESC, b."dataBaixa" ASC, b.id ASC
             ) AS pos,
             COUNT(*) OVER (PARTITION BY ${categoriaSql()}, ${ehCorporativoSql(escopo.companyId)})::bigint AS total
        FROM ${tabela("OmieBaixa")} b
        JOIN ${tabela("OmieTitulo")} t ON t.id = b."tituloId"
       WHERE b."companyId" = ${escopo.companyId}
         AND b."dataBaixa" >= ${periodo.inicio}
         AND b."dataBaixa" <= ${periodo.fim}
         AND t.cancelado = false
         ${filtroConexaoBaixa(escopo.conexaoId, escopo.companyId)}
         ${naJanela(escopo.janela)}
    ) x
     WHERE x.pos <= ${TITULOS_POR_CATEGORIA_NA_TELA}
  `;
  return agruparDrill(linhas);
}

// TODOS OS TÍTULOS DO MÊS, para a planilha de conferência.
//
// A tela mostra os vinte maiores de cada categoria e diz "a lista completa
// está na planilha de conferência" — e a planilha trazia só as categorias.
// Quem fecha o mês contra a Omie precisa da lista inteira: no setembro/2026 da
// Azul, o DRE tinha 131 títulos em "Clientes - Serviços Prestados" e a
// exportação da Omie 130, com R$ 9.190,00 de diferença, e só a lista título a
// título diz qual.
//
// O MESMO recorte da soma (empresa, janela, cancelado, data do regime) e a
// mesma chave de categoria: a soma desta lista por categoria é o valor da
// linha (teste do banco). No caixa, uma linha por BAIXA, com a data e o valor
// do pagamento, como o drill-down da tela.
export type TituloDaConferencia = {
  categoria: string;
  natureza: "RECEBER" | "PAGAR";
  parceiro: string;
  parceiroDocumento: string | null;
  documento: string | null;
  parcela: string | null;
  tipoDocumento: string | null;
  data: Date;
  vencimento: Date;
  valorCents: number;
  status: string;
  empresa: string;
  codigoLancamento: string;
  corporativo: boolean;
};

type LinhaConferencia = Omit<TituloDaConferencia, "valorCents" | "natureza"> & { natureza: string; cents: bigint | number };

export async function titulosDaConferencia(escopo: EscopoDre, periodo: Periodo, regime: "competencia" | "caixa"): Promise<TituloDaConferencia[]> {
  const linhas =
    regime === "caixa"
      ? await prisma.$queryRaw<LinhaConferencia[]>`
          SELECT ${categoriaSql()} AS categoria, t.natureza::text AS natureza,
                 COALESCE(t."parceiroNome", '(sem parceiro)') AS parceiro, t."parceiroDocumento" AS "parceiroDocumento",
                 t."numeroDocumento" AS documento, t."numeroParcela" AS parcela, t."tipoDocumento" AS "tipoDocumento",
                 b."dataBaixa" AS data, t."dataVencimento" AS vencimento, b."valorCents" AS cents,
                 t.status, t."conexaoApelido" AS empresa, t."codigoLancamento" AS "codigoLancamento",
                 ${ehCorporativoSql(escopo.companyId)} AS corporativo
            FROM ${tabela("OmieBaixa")} b
            JOIN ${tabela("OmieTitulo")} t ON t.id = b."tituloId"
           WHERE b."companyId" = ${escopo.companyId}
             AND b."dataBaixa" >= ${periodo.inicio}
             AND b."dataBaixa" <= ${periodo.fim}
             AND t.cancelado = false
             ${filtroConexaoBaixa(escopo.conexaoId, escopo.companyId)}
             ${naJanela(escopo.janela)}
           ORDER BY 1, ABS(b."valorCents") DESC, b."dataBaixa", b.id
        `
      : await prisma.$queryRaw<LinhaConferencia[]>`
          SELECT ${categoriaSql()} AS categoria, t.natureza::text AS natureza,
                 COALESCE(t."parceiroNome", '(sem parceiro)') AS parceiro, t."parceiroDocumento" AS "parceiroDocumento",
                 t."numeroDocumento" AS documento, t."numeroParcela" AS parcela, t."tipoDocumento" AS "tipoDocumento",
                 ${competenciaSql("t")} AS data, t."dataVencimento" AS vencimento, t."valorDocumentoCents" AS cents,
                 t.status, t."conexaoApelido" AS empresa, t."codigoLancamento" AS "codigoLancamento",
                 ${ehCorporativoSql(escopo.companyId)} AS corporativo
            FROM ${tabela("OmieTitulo")} t
           WHERE t."companyId" = ${escopo.companyId}
             AND t.cancelado = false
             AND ${semProvisaoFuturaSql("t")}
             AND ${competenciaSql("t")} >= ${periodo.inicio}
             AND ${competenciaSql("t")} <= ${periodo.fim}
             ${filtroConexaoTitulo(escopo.conexaoId, escopo.companyId)}
             ${naJanela(escopo.janela)}
           ORDER BY 1, ABS(t."valorDocumentoCents") DESC, t."dataVencimento", t.id
        `;
  return linhas.map((l) => ({ ...l, natureza: l.natureza === "RECEBER" ? "RECEBER" : "PAGAR", valorCents: Number(l.cents) }));
}

function agruparDrill(linhas: LinhaDrill[]) {
  const titulos = new Map<string, TituloDoDre[]>();
  // A contagem vem por (categoria, papel): soma-se por categoria, e a parte
  // corporativa fica também à parte.
  const porParte = new Map<string, number>();
  const totais = new Map<string, number>();
  const totaisCorporativos = new Map<string, number>();
  for (const l of linhas) {
    const lista = titulos.get(l.categoria) ?? [];
    lista.push({
      id: l.id,
      natureza: l.natureza === "RECEBER" ? "RECEBER" : "PAGAR",
      parceiro: l.parceiro,
      documento: l.documento,
      data: l.data,
      valorCents: Number(l.cents),
      empresa: l.empresa,
      corporativo: l.corporativo,
    });
    titulos.set(l.categoria, lista);
    porParte.set(`${l.corporativo ? "C" : "O"}:${l.categoria}`, Number(l.total));
  }
  for (const [chave, total] of porParte) {
    const categoria = chave.slice(2);
    totais.set(categoria, (totais.get(categoria) ?? 0) + total);
    if (chave.startsWith("C:")) totaisCorporativos.set(categoria, total);
  }
  return { titulos, totais, totaisCorporativos };
}

// Pela CHAVE (chaveCategoria.ts): na colisão entre empresas, uma entrada por
// empresa. A colisão é apurada sobre todas as categorias da empresa, mesmo com
// a visão filtrada — a chave do título não muda com o filtro.
export async function categoriasDoEscopo(escopo: EscopoDre): Promise<Map<string, CategoriaParaDre>> {
  const todas = await prisma.omieCategoria.findMany({
    where: { companyId: escopo.companyId },
    select: { codigo: true, descricao: true, natureza: true, contaReceita: true, contaDespesa: true, conexaoId: true, conexaoApelido: true },
  });
  const colisoes = categoriasEmColisao(todas);
  return categoriasPorChave(escopo.conexaoId ? todas.filter((c) => c.conexaoId === escopo.conexaoId) : todas, colisoes);
}

// Os códigos que se repetem entre as empresas com nomes diferentes — o aviso
// da tela de Custos e DRE.
export async function colisoesDeCategoria(companyId: string) {
  const todas = await prisma.omieCategoria.findMany({ where: { companyId }, select: { codigo: true, descricao: true, conexaoApelido: true } });
  return descreverColisoes(todas, categoriasEmColisao(todas));
}

// ---------------------------------------------------------------------------
// O RECORTE DA VISÃO MENSAL DE CUSTOS E DRE — escrito uma vez, lido por dois.
//
// A tela e a "planilha de conferência do DRE" mostram o MESMO DRE, e cada uma
// montava o próprio recorte. A planilha lia o contexto a partir do dia 1º do
// mês, com o mês inteiro contra o mês anterior inteiro; a tela soma no banco
// com treze meses de janela, o mês até a referência contra o anterior até o
// mesmo dia. O resultado, conferido contra Postgres: o "mês anterior" da
// planilha perdia todo título de agosto já liquidado (fora da janela de um
// mês), o caixa perdia o pagamento de título emitido antes do mês, e o lado de
// cada categoria (que decide a linha proposta) era apurado sobre um mês só —
// a mesma categoria podia cair em linhas diferentes nos dois arquivos.
//
// Agora os dois pedem o recorte aqui.
// ---------------------------------------------------------------------------

// Mesmo mês, um ano antes. O mês INTEIRO, mesmo quando o atual está pela
// metade: comparar agosto até o dia 26 com agosto inteiro do ano passado daria
// uma queda que é só de calendário. A tela diz que a comparação é com o mês
// fechado, e quem lê decide o que fazer com isso.
export function mesmoMesAnoAnterior(mes: { inicio: Date }): Periodo {
  const inicio = new Date(mes.inicio.getFullYear() - 1, mes.inicio.getMonth(), 1, 0, 0, 0, 0);
  const fim = new Date(mes.inicio.getFullYear() - 1, mes.inicio.getMonth() + 1, 0, 23, 59, 59, 999);
  return { inicio, fim, rotulo: `${inicio.getFullYear()}` };
}

export function recorteMensalDoDre(params: { companyId: string; conexaoId: string | null; dataReferencia: Date }) {
  const { companyId, conexaoId, dataReferencia } = params;
  const janelas = montarJanelas(dataReferencia);
  return {
    janelas,
    // Treze meses: cobre o mesmo mês do ano passado, que a tela compara.
    escopo: {
      companyId,
      conexaoId,
      janela: { desde: new Date(dataReferencia.getFullYear() - 1, dataReferencia.getMonth(), 1), ate: null },
    } satisfies EscopoDre,
    periodo: janelas.mesAtual,
    // O mês anterior e o do ano anterior são sempre o mês fechado (ver
    // periodos.ts).
    periodoAnterior: janelas.mesAnterior,
    periodoAnoAnterior: mesmoMesAnoAnterior(janelas.mesAtual),
  };
}

// ---------------------------------------------------------------------------
// A colheita completa, e o DRE do mês
// ---------------------------------------------------------------------------

export async function insumosDoBanco(
  escopo: EscopoDre,
  periodo: Periodo,
  periodoAnterior: Periodo,
  opcoes: OpcoesDre = {}
): Promise<InsumosDre> {
  const { regime = "competencia", incluirTitulos = true, periodoAnoAnterior } = opcoes;

  const [atual, anterior, anoAnterior, movimento, drill, ret, retAnterior, retAnoAnterior, categorias] =
    await Promise.all([
      somaPorCategoria(escopo, periodo, regime),
      somaPorCategoria(escopo, periodoAnterior, regime),
      periodoAnoAnterior ? somaPorCategoria(escopo, periodoAnoAnterior, regime) : Promise.resolve(null),
      movimentoPorCategoria(escopo),
      incluirTitulos
        ? regime === "caixa"
          ? drillCaixa(escopo, periodo)
          : drillCompetencia(escopo, periodo)
        : Promise.resolve({
            titulos: new Map<string, TituloDoDre[]>(),
            totais: new Map<string, number>(),
            totaisCorporativos: new Map<string, number>(),
          }),
      retencoes(escopo, periodo, regime),
      retencoes(escopo, periodoAnterior, regime),
      periodoAnoAnterior ? retencoes(escopo, periodoAnoAnterior, regime) : Promise.resolve(null),
      categoriasDoEscopo(escopo),
    ]);

  return {
    atual: atual.mapa,
    anterior: anterior.mapa,
    anoAnterior: anoAnterior ? anoAnterior.mapa : null,
    corporativo: { atual: atual.corp, anterior: anterior.corp, anoAnterior: anoAnterior ? anoAnterior.corp : null },
    movimento,
    titulos: drill.titulos,
    totalDeTitulosPorCategoria: drill.totais,
    // Só quando o drill-down foi montado: sem ele, as contagens nem existem.
    totalDeTitulosCorporativosPorCategoria: incluirTitulos ? drill.totaisCorporativos : undefined,
    retencoes: ret,
    retencoesAnteriores: retAnterior,
    retencoesAnoAnterior: retAnoAnterior,
    categorias,
  };
}

export async function montarDreNoBanco(
  escopo: EscopoDre,
  periodo: Periodo,
  periodoAnterior: Periodo,
  classificacoes: Map<string, { linha: string; subgrupo: string | null; confirmada: boolean }>,
  opcoes: OpcoesDre = {}
): Promise<ResultadoDre> {
  const insumos = await insumosDoBanco(escopo, periodo, periodoAnterior, opcoes);
  return montarDreDeInsumos(insumos, classificacoes, opcoes);
}

// ---------------------------------------------------------------------------
// O ANO INTEIRO, MÊS A MÊS — em duas consultas, não em doze
//
// A versão em memória chama `montarDre` doze vezes, e cada chamada varre os
// títulos do contexto de novo. Aqui o ano sai de UMA consulta agrupada por
// (categoria, mês); as doze demonstrações se montam a partir dela, com a mesma
// função de conta.
//
// As RETENÇÕES continuam por mês, porque elas podem entrar nas deduções (ver a
// configuração `retencoesNasDeducoes`) e aí mudam o valor da linha em cada mês.
// Quando a soma está desligada, nem são consultadas.
// ---------------------------------------------------------------------------

const ROTULO_MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

async function somaPorCategoriaPorMes(
  escopo: EscopoDre,
  ano: number,
  regime: "competencia" | "caixa"
): Promise<Map<number, Somas>> {
  const inicio = new Date(ano, 0, 1, 0, 0, 0, 0);
  const fim = new Date(ano, 11, 31, 23, 59, 59, 999);

  const linhas =
    regime === "caixa"
      ? await prisma.$queryRaw<LinhaSomaMes[]>`
          SELECT ${categoriaSql()} AS categoria,
                 (EXTRACT(MONTH FROM b."dataBaixa") - 1)::int AS mes,
                 COALESCE(SUM(b."valorCents"), 0)::bigint AS cents,
                 COALESCE(SUM(b."valorCents") FILTER (WHERE ${ehCorporativoSql(escopo.companyId)}), 0)::bigint AS corp
            FROM ${tabela("OmieBaixa")} b
            JOIN ${tabela("OmieTitulo")} t ON t.id = b."tituloId"
           WHERE b."companyId" = ${escopo.companyId}
             AND b."dataBaixa" >= ${inicio}
             AND b."dataBaixa" <= ${fim}
             AND t.cancelado = false
             ${filtroConexaoBaixa(escopo.conexaoId, escopo.companyId)}
             ${naJanela(escopo.janela)}
           GROUP BY 1, 2
        `
      : await prisma.$queryRaw<LinhaSomaMes[]>`
          SELECT ${categoriaSql()} AS categoria,
                 (EXTRACT(MONTH FROM ${competenciaSql("t")}) - 1)::int AS mes,
                 COALESCE(SUM(t."valorDocumentoCents"), 0)::bigint AS cents,
                 COALESCE(SUM(t."valorDocumentoCents") FILTER (WHERE ${ehCorporativoSql(escopo.companyId)}), 0)::bigint AS corp
            FROM ${tabela("OmieTitulo")} t
           WHERE t."companyId" = ${escopo.companyId}
             AND t.cancelado = false
             AND ${semProvisaoFuturaSql("t")}
             AND ${competenciaSql("t")} >= ${inicio}
             AND ${competenciaSql("t")} <= ${fim}
             ${filtroConexaoTitulo(escopo.conexaoId, escopo.companyId)}
             ${naJanela(escopo.janela)}
           GROUP BY 1, 2
        `;

  const porMes = new Map<number, Somas>();
  for (const l of linhas) {
    const somas = porMes.get(l.mes) ?? { mapa: new Map<string, number>(), corp: new Map<string, number>() };
    somas.mapa.set(l.categoria, (somas.mapa.get(l.categoria) ?? 0) + Number(l.cents));
    if (Number(l.corp) !== 0) somas.corp.set(l.categoria, (somas.corp.get(l.categoria) ?? 0) + Number(l.corp));
    porMes.set(l.mes, somas);
  }
  return porMes;
}

export async function montarDreAnualNoBanco(
  escopo: EscopoDre,
  ano: number,
  dataReferencia: Date,
  classificacoes: Map<string, { linha: string; subgrupo: string | null; confirmada: boolean }>,
  opcoes: OpcoesDre = {}
): Promise<ResultadoDreAnual> {
  const { regime = "competencia", somarRetencoes = false } = opcoes;

  // Só até o mês da data de referência: projetar dezembro em agosto encheria a
  // tabela de zeros que parecem queda de receita.
  const ultimoMes = dataReferencia.getFullYear() === ano ? dataReferencia.getMonth() : 11;
  const meses = rotulosDosMeses(ano, ultimoMes, dataReferencia);

  const janelaDoMes = (i: number): Periodo => ({
    inicio: new Date(ano, i, 1, 0, 0, 0, 0),
    fim: new Date(ano, i + 1, 0, 23, 59, 59, 999),
    rotulo: ROTULO_MES[i],
  });

  const [porMesAgregado, movimento, categorias, retencoesPorMes] = await Promise.all([
    somaPorCategoriaPorMes(escopo, ano, regime),
    movimentoPorCategoria(escopo),
    categoriasDoEscopo(escopo),
    // Uma consulta por mês, e só quando a soma às deduções está ligada. Doze
    // agregações de uma linha custam menos que carregar um título.
    somarRetencoes
      ? Promise.all(meses.map((m) => retencoes(escopo, janelaDoMes(m.indice), regime)))
      : Promise.resolve(meses.map(() => RETENCOES_ZERADAS)),
  ]);

  const vazio = new Map<string, number>();
  const porMes = meses.map((m) =>
    montarDreDeInsumos(
      {
        atual: porMesAgregado.get(m.indice)?.mapa ?? vazio,
        // O MÊS ANTERIOR SÓ DENTRO DO ANO — em janeiro ele fica vazio, que é
        // exatamente o que a versão em memória vê: o contexto da visão anual
        // começa em 1º de janeiro. A visão anual não exibe a coluna do mês
        // anterior; ela existe aqui porque a conta é a mesma dos dois lados.
        anterior: porMesAgregado.get(m.indice - 1)?.mapa ?? vazio,
        anoAnterior: null,
        corporativo: {
          atual: porMesAgregado.get(m.indice)?.corp ?? vazio,
          anterior: porMesAgregado.get(m.indice - 1)?.corp ?? vazio,
          anoAnterior: null,
        },
        movimento,
        titulos: new Map(),
        retencoes: retencoesPorMes[m.indice],
        retencoesAnteriores: retencoesPorMes[m.indice - 1] ?? RETENCOES_ZERADAS,
        retencoesAnoAnterior: null,
        categorias,
      },
      classificacoes,
      { somarRetencoes, regime }
    )
  );

  const linhas: LinhaDreAnual[] = LINHAS_DRE.map((def) => {
    const valores = porMes.map((r) => r.linhas.find((l) => l.chave === def.chave)?.valorCents ?? 0);
    return {
      chave: def.chave,
      rotulo: def.rotulo,
      tipo: def.tipo,
      porMes: valores,
      totalCents: valores.reduce((a, v) => a + v, 0),
      percentReceitaLiquida: null,
    };
  });

  const receitaLiquida = linhas.find((l) => l.chave === "RECEITA_LIQUIDA")?.totalCents ?? 0;
  for (const l of linhas) {
    l.percentReceitaLiquida = receitaLiquida > 0 ? (l.totalCents / receitaLiquida) * 100 : null;
  }

  return {
    ano,
    meses,
    linhas,
    receitaLiquidaCents: receitaLiquida,
    resultadoLiquidoCents: linhas.find((l) => l.chave === "RESULTADO_LIQUIDO")?.totalCents ?? 0,
    margemLiquidaPercent:
      receitaLiquida > 0
        ? ((linhas.find((l) => l.chave === "RESULTADO_LIQUIDO")?.totalCents ?? 0) / receitaLiquida) * 100
        : null,
    naoConfirmadoCents: porMes.reduce((a, r) => a + r.naoConfirmadoCents, 0),
    semCategoriaCents: porMes.reduce((a, r) => a + r.semCategoriaCents, 0),
    regime,
  };
}

// ---------------------------------------------------------------------------
// O DRE QUE VAI NO RELATÓRIO DIÁRIO
//
// Dois recortes: o ÚLTIMO MÊS FECHADO, que é o número que se defende numa
// reunião, e o MÊS CORRENTE até a referência, comparado ao anterior até o
// mesmo dia — parcial, e dito assim. Quando a referência é o último dia do
// mês, os dois coincidem e o corrente fica nulo.
//
// Somado no banco, com a mesma função e a mesma janela da tela de Custos e
// DRE: o número do e-mail é o número da tela.
// ---------------------------------------------------------------------------
export type DreDoRelatorio = { mesFechado: ResumoDre; mesCorrente: ResumoDre | null };

export async function dreParaRelatorio(params: {
  companyId: string;
  conexaoId: string | null;
  dataReferencia: Date;
}): Promise<DreDoRelatorio> {
  const { companyId, conexaoId, dataReferencia } = params;
  const [guardadas, config] = await Promise.all([
    prisma.dreClassificacao.findMany({
      where: { companyId },
      select: { categoriaCodigo: true, linha: true, subgrupo: true, origem: true },
    }),
    prisma.controladoriaConfig.findUnique({ where: { companyId }, select: { retencoesNasDeducoes: true } }),
  ]);
  const classificacoes = new Map(
    guardadas.map((c) => [c.categoriaCodigo, { linha: c.linha, subgrupo: c.subgrupo, confirmada: c.origem === "CONFIRMADA" }])
  );
  const opcoes = { somarRetencoes: config?.retencoesNasDeducoes ?? false, incluirTitulos: false } as const;
  const janelas = montarJanelas(dataReferencia);
  const escopo = {
    companyId,
    conexaoId,
    janela: { desde: new Date(dataReferencia.getFullYear() - 1, dataReferencia.getMonth(), 1), ate: null },
  };

  const fechado = ultimoMesFechado(dataReferencia);
  const anteriorAoFechado = {
    inicio: new Date(fechado.inicio.getFullYear(), fechado.inicio.getMonth() - 1, 1),
    fim: new Date(fechado.inicio.getFullYear(), fechado.inicio.getMonth(), 0, 23, 59, 59, 999),
    rotulo: "",
  };

  const [dreFechado, dreCorrente] = await Promise.all([
    montarDreNoBanco(escopo, fechado, anteriorAoFechado, classificacoes, opcoes),
    janelas.mesParcial
      ? montarDreNoBanco(escopo, janelas.mesAtual, janelas.mesAnterior, classificacoes, opcoes)
      : Promise.resolve(null),
  ]);

  return {
    mesFechado: resumirDre(dreFechado, fechado.rotulo),
    mesCorrente: dreCorrente ? resumirDre(dreCorrente, janelas.mesAtual.rotulo) : null,
  };
}

// ---------------------------------------------------------------------------
// Pessoas da empresa corporativa, por centro de custo
// ---------------------------------------------------------------------------

// A LINHA "Despesas com pessoas — corporativo" ABERTA PELO CENTRO DE CUSTO
// (departamento da Omie) de cada título: oficina, financeiro, diretoria… O
// mesmo recorte da demonstração — regime, empresa, janela, eliminação entre
// as empresas — e as mesmas categorias da linha (as que a tela já colocou
// nela). O departamento é o primeiro da distribuição do título: título
// rateado entre centros de custo fica inteiro no primeiro.
export type CentroDeCustoDaLinha = { codigo: string | null; descricao: string; atualCents: number; anteriorCents: number };

type LinhaCentro = { codigo: string | null; descricao: string | null; atual: bigint; anterior: bigint };

export async function pessoasCorporativoPorCentroDeCusto(
  escopo: EscopoDre,
  periodo: Periodo,
  periodoAnterior: Periodo,
  categorias: string[],
  regime: "competencia" | "caixa"
): Promise<CentroDeCustoDaLinha[]> {
  if (categorias.length === 0) return [];
  const desde = periodoAnterior.inicio < periodo.inicio ? periodoAnterior.inicio : periodo.inicio;
  const ate = periodoAnterior.fim > periodo.fim ? periodoAnterior.fim : periodo.fim;
  const departamento = Prisma.sql`
    LEFT JOIN ${tabela("OmieDepartamento")} d
           ON d."conexaoId" = t."conexaoId" AND d.codigo = t."departamentoCodigo"`;
  const linhas =
    regime === "caixa"
      ? await prisma.$queryRaw<LinhaCentro[]>`
          SELECT t."departamentoCodigo" AS codigo, MAX(d.descricao) AS descricao,
                 COALESCE(SUM(b."valorCents") FILTER (WHERE b."dataBaixa" >= ${periodo.inicio} AND b."dataBaixa" <= ${periodo.fim}), 0)::bigint AS atual,
                 COALESCE(SUM(b."valorCents") FILTER (WHERE b."dataBaixa" >= ${periodoAnterior.inicio} AND b."dataBaixa" <= ${periodoAnterior.fim}), 0)::bigint AS anterior
            FROM ${tabela("OmieBaixa")} b
            JOIN ${tabela("OmieTitulo")} t ON t.id = b."tituloId"
            ${departamento}
           WHERE b."companyId" = ${escopo.companyId}
             AND b."dataBaixa" >= ${desde}
             AND b."dataBaixa" <= ${ate}
             AND t.cancelado = false
             AND ${ehCorporativoSql(escopo.companyId)}
             AND ${categoriaSql()} IN (${Prisma.join(categorias)})
             ${filtroConexaoBaixa(escopo.conexaoId, escopo.companyId)}
             ${naJanela(escopo.janela)}
           GROUP BY 1`
      : await prisma.$queryRaw<LinhaCentro[]>`
          SELECT t."departamentoCodigo" AS codigo, MAX(d.descricao) AS descricao,
                 COALESCE(SUM(t."valorDocumentoCents") FILTER (WHERE ${competenciaSql("t")} >= ${periodo.inicio} AND ${competenciaSql("t")} <= ${periodo.fim}), 0)::bigint AS atual,
                 COALESCE(SUM(t."valorDocumentoCents") FILTER (WHERE ${competenciaSql("t")} >= ${periodoAnterior.inicio} AND ${competenciaSql("t")} <= ${periodoAnterior.fim}), 0)::bigint AS anterior
            FROM ${tabela("OmieTitulo")} t
            ${departamento}
           WHERE t."companyId" = ${escopo.companyId}
             AND t.cancelado = false
             AND ${semProvisaoFuturaSql("t")}
             AND ${competenciaSql("t")} >= ${desde}
             AND ${competenciaSql("t")} <= ${ate}
             AND ${ehCorporativoSql(escopo.companyId)}
             AND ${categoriaSql()} IN (${Prisma.join(categorias)})
             ${filtroConexaoTitulo(escopo.conexaoId, escopo.companyId)}
             ${naJanela(escopo.janela)}
           GROUP BY 1`;
  return linhas
    .map((l) => ({
      codigo: l.codigo,
      descricao: l.descricao ?? (l.codigo ? `Centro de custo ${l.codigo}` : "Sem centro de custo"),
      atualCents: Math.abs(Number(l.atual)),
      anteriorCents: Math.abs(Number(l.anterior)),
    }))
    .filter((l) => l.atualCents !== 0 || l.anteriorCents !== 0)
    .sort((a, b) => b.atualCents - a.atualCents || b.anteriorCents - a.anteriorCents);
}

// A RECEITA BRUTA POR TIPO DE DOCUMENTO — nota fiscal, CT-e/CT-e OS, recibo,
// reembolso —, no MESMO recorte da demonstração (as categorias da linha,
// competência ou caixa, visão do grupo sem as operações entre as empresas).
// Responde "quanto do faturamento tem documento fiscal": o recibo e o
// reembolso não são faturamento de serviço com nota, e misturados no total
// não aparecem.

export type ReceitaPorDocumento = {
  grupo: string;
  // Os tipos de documento da Omie que caíram no grupo, como vieram.
  tipos: string[];
  atualCents: number;
  anteriorCents: number;
  quantidade: number;
};

const somenteLetras = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// O grupo de um tipo de documento da Omie. Reembolso também pela categoria
// (o título de reembolso costuma vir com tipo genérico).
export function grupoDoDocumento(tipo: string | null | undefined, categoria = ""): string {
  const t = somenteLetras(tipo ?? "");
  if (t.includes("REEMB") || /reembols/i.test(categoria)) return "Reembolso";
  if (t.startsWith("CTE") || t === "CTRC") return "CT-e / CT-e OS";
  if (t.startsWith("NF")) return "Nota fiscal (NF-e / NFS-e)";
  if (t.startsWith("REC") || t === "RPA") return "Recibo";
  if (t === "") return "Sem tipo de documento";
  return `Outros (${(tipo ?? "").trim()})`;
}

type LinhaDocumento = { tipo: string | null; categoria: string; atual: bigint; anterior: bigint; quantidade: bigint };

export async function receitaBrutaPorDocumento(
  escopo: EscopoDre,
  periodo: Periodo,
  periodoAnterior: Periodo,
  categorias: { chave: string; descricao: string }[],
  regime: "competencia" | "caixa"
): Promise<ReceitaPorDocumento[]> {
  if (categorias.length === 0) return [];
  const desde = periodoAnterior.inicio < periodo.inicio ? periodoAnterior.inicio : periodo.inicio;
  const ate = periodoAnterior.fim > periodo.fim ? periodoAnterior.fim : periodo.fim;
  const chaves = categorias.map((c) => c.chave);
  const linhas =
    regime === "caixa"
      ? await prisma.$queryRaw<LinhaDocumento[]>`
          SELECT NULLIF(TRIM(t."tipoDocumento"), '') AS tipo, ${categoriaSql()} AS categoria,
                 COALESCE(SUM(b."valorCents") FILTER (WHERE b."dataBaixa" >= ${periodo.inicio} AND b."dataBaixa" <= ${periodo.fim}), 0)::bigint AS atual,
                 COALESCE(SUM(b."valorCents") FILTER (WHERE b."dataBaixa" >= ${periodoAnterior.inicio} AND b."dataBaixa" <= ${periodoAnterior.fim}), 0)::bigint AS anterior,
                 COUNT(DISTINCT t.id) FILTER (WHERE b."dataBaixa" >= ${periodo.inicio} AND b."dataBaixa" <= ${periodo.fim})::bigint AS quantidade
            FROM ${tabela("OmieBaixa")} b
            JOIN ${tabela("OmieTitulo")} t ON t.id = b."tituloId"
           WHERE b."companyId" = ${escopo.companyId}
             AND b."dataBaixa" >= ${desde}
             AND b."dataBaixa" <= ${ate}
             AND t.cancelado = false
             AND ${categoriaSql()} IN (${Prisma.join(chaves)})
             ${filtroConexaoBaixa(escopo.conexaoId, escopo.companyId)}
             ${naJanela(escopo.janela)}
           GROUP BY 1, 2`
      : await prisma.$queryRaw<LinhaDocumento[]>`
          SELECT NULLIF(TRIM(t."tipoDocumento"), '') AS tipo, ${categoriaSql()} AS categoria,
                 COALESCE(SUM(t."valorDocumentoCents") FILTER (WHERE ${competenciaSql("t")} >= ${periodo.inicio} AND ${competenciaSql("t")} <= ${periodo.fim}), 0)::bigint AS atual,
                 COALESCE(SUM(t."valorDocumentoCents") FILTER (WHERE ${competenciaSql("t")} >= ${periodoAnterior.inicio} AND ${competenciaSql("t")} <= ${periodoAnterior.fim}), 0)::bigint AS anterior,
                 COUNT(*) FILTER (WHERE ${competenciaSql("t")} >= ${periodo.inicio} AND ${competenciaSql("t")} <= ${periodo.fim})::bigint AS quantidade
            FROM ${tabela("OmieTitulo")} t
           WHERE t."companyId" = ${escopo.companyId}
             AND t.cancelado = false
             AND ${semProvisaoFuturaSql("t")}
             AND ${competenciaSql("t")} >= ${desde}
             AND ${competenciaSql("t")} <= ${ate}
             AND ${categoriaSql()} IN (${Prisma.join(chaves)})
             ${filtroConexaoTitulo(escopo.conexaoId, escopo.companyId)}
             ${naJanela(escopo.janela)}
           GROUP BY 1, 2`;
  return agruparPorDocumento(
    linhas.map((l) => ({ tipo: l.tipo, categoria: l.categoria, atualCents: Number(l.atual), anteriorCents: Number(l.anterior), quantidade: Number(l.quantidade) })),
    new Map(categorias.map((c) => [c.chave, c.descricao]))
  );
}

// Pura: soma por grupo. O sinal acompanha o da linha (a soma é em módulo no
// fim, como a linha do DRE).
export function agruparPorDocumento(
  linhas: { tipo: string | null; categoria: string; atualCents: number; anteriorCents: number; quantidade: number }[],
  descricaoDaCategoria: Map<string, string>
): ReceitaPorDocumento[] {
  const grupos = new Map<string, ReceitaPorDocumento>();
  for (const l of linhas) {
    const nome = grupoDoDocumento(l.tipo, descricaoDaCategoria.get(l.categoria) ?? "");
    const g = grupos.get(nome) ?? { grupo: nome, tipos: [], atualCents: 0, anteriorCents: 0, quantidade: 0 };
    g.atualCents += l.atualCents;
    g.anteriorCents += l.anteriorCents;
    g.quantidade += l.quantidade;
    const tipo = l.tipo ?? "(em branco)";
    if (!g.tipos.includes(tipo)) g.tipos.push(tipo);
    grupos.set(nome, g);
  }
  return [...grupos.values()]
    .map((g) => ({ ...g, atualCents: Math.abs(g.atualCents), anteriorCents: Math.abs(g.anteriorCents), tipos: g.tipos.sort() }))
    .filter((g) => g.atualCents !== 0 || g.anteriorCents !== 0)
    .sort((a, b) => b.atualCents - a.atualCents || b.anteriorCents - a.anteriorCents);
}
