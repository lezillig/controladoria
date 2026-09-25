import { prisma } from "@/lib/prisma";
import { tabela } from "@/lib/esquemaDoBanco";
import { competenciaSql } from "./competencia";
import {
  CATEGORIA_SQL as CATEGORIA,
  filtroConexaoBaixa,
  filtroConexaoTitulo,
  naJanela,
  type EscopoSql,
} from "./escopoSql";
import type { Periodo } from "./periodos";
import {
  LINHAS_DRE,
  RETENCOES_ZERADAS,
  TITULOS_POR_CATEGORIA_NA_TELA,
  montarDreDeInsumos,
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

type LinhaSoma = { categoria: string; cents: bigint };
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
  total: bigint;
};
type LinhaSomaMes = { categoria: string; mes: number; cents: bigint };


function mapaDeSomas(linhas: LinhaSoma[]): Map<string, number> {
  return new Map(linhas.map((l) => [l.categoria, Number(l.cents)]));
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
async function somaPorCategoriaCompetencia(escopo: EscopoDre, periodo: Periodo): Promise<Map<string, number>> {
  const linhas = await prisma.$queryRaw<LinhaSoma[]>`
    SELECT ${CATEGORIA} AS categoria,
           COALESCE(SUM(t."valorDocumentoCents"), 0)::bigint AS cents
      FROM ${tabela("OmieTitulo")} t
     WHERE t."companyId" = ${escopo.companyId}
       AND t.cancelado = false
       AND ${competenciaSql("t")} >= ${periodo.inicio}
       AND ${competenciaSql("t")} <= ${periodo.fim}
       ${filtroConexaoTitulo(escopo.conexaoId)}
       ${naJanela(escopo.janela)}
     GROUP BY 1
  `;
  return mapaDeSomas(linhas);
}

// NO CAIXA O FATO É A BAIXA — data e valor do movimento do dinheiro —, e a
// categoria continua vindo do TÍTULO, que é quem sabe do que aquele dinheiro
// se trata. Título cancelado fica fora, como ficaria na competência.
async function somaPorCategoriaCaixa(escopo: EscopoDre, periodo: Periodo): Promise<Map<string, number>> {
  const linhas = await prisma.$queryRaw<LinhaSoma[]>`
    SELECT ${CATEGORIA} AS categoria,
           COALESCE(SUM(b."valorCents"), 0)::bigint AS cents
      FROM ${tabela("OmieBaixa")} b
      JOIN ${tabela("OmieTitulo")} t ON t.id = b."tituloId"
     WHERE b."companyId" = ${escopo.companyId}
       AND b."dataBaixa" >= ${periodo.inicio}
       AND b."dataBaixa" <= ${periodo.fim}
       AND t.cancelado = false
       ${filtroConexaoBaixa(escopo.conexaoId)}
       ${naJanela(escopo.janela)}
     GROUP BY 1
  `;
  return mapaDeSomas(linhas);
}

function somaPorCategoria(escopo: EscopoDre, periodo: Periodo, regime: "competencia" | "caixa") {
  return regime === "caixa" ? somaPorCategoriaCaixa(escopo, periodo) : somaPorCategoriaCompetencia(escopo, periodo);
}

// DE QUE LADO CADA CATEGORIA VIVE — sobre TODA a janela, não sobre o mês.
// Restringir ao mês foi um defeito com efeito visível (ver o comentário no
// original): categoria sem movimento no mês ficava sem lado e caía no ramo de
// despesa, e uma ENTRADA aparecia como saída.
async function movimentoPorCategoria(escopo: EscopoDre) {
  const linhas = await prisma.$queryRaw<LinhaMovimento[]>`
    SELECT ${CATEGORIA} AS categoria,
           t.natureza::text AS natureza,
           COALESCE(SUM(ABS(t."valorDocumentoCents")), 0)::bigint AS cents
      FROM ${tabela("OmieTitulo")} t
     WHERE t."companyId" = ${escopo.companyId}
       AND t.cancelado = false
       ${filtroConexaoTitulo(escopo.conexaoId)}
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
       AND ${competenciaSql("t")} >= ${periodo.inicio}
       AND ${competenciaSql("t")} <= ${periodo.fim}
       ${filtroConexaoTitulo(escopo.conexaoId)}
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
         ${filtroConexaoBaixa(escopo.conexaoId)}
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
         ${filtroConexaoTitulo(escopo.conexaoId)}
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

function retencoes(escopo: EscopoDre, periodo: Periodo, regime: "competencia" | "caixa") {
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
             ${CATEGORIA} AS categoria,
             t.natureza::text AS natureza,
             COALESCE(t."parceiroNome", '(sem parceiro)') AS parceiro,
             t."numeroDocumento" AS documento,
             ${competenciaSql("t")} AS data,
             t."valorDocumentoCents" AS cents,
             t."conexaoApelido" AS empresa,
             ROW_NUMBER() OVER (
               PARTITION BY ${CATEGORIA}
               ORDER BY ABS(t."valorDocumentoCents") DESC, t.natureza::text DESC, t."dataVencimento" ASC, t.id ASC
             ) AS pos,
             COUNT(*) OVER (PARTITION BY ${CATEGORIA})::bigint AS total
        FROM ${tabela("OmieTitulo")} t
       WHERE t."companyId" = ${escopo.companyId}
         AND t.cancelado = false
         AND ${competenciaSql("t")} >= ${periodo.inicio}
         AND ${competenciaSql("t")} <= ${periodo.fim}
         ${filtroConexaoTitulo(escopo.conexaoId)}
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
             ${CATEGORIA} AS categoria,
             t.natureza::text AS natureza,
             COALESCE(t."parceiroNome", '(sem parceiro)') AS parceiro,
             t."numeroDocumento" AS documento,
             b."dataBaixa" AS data,
             b."valorCents" AS cents,
             t."conexaoApelido" AS empresa,
             ROW_NUMBER() OVER (
               PARTITION BY ${CATEGORIA}
               ORDER BY ABS(b."valorCents") DESC, b."dataBaixa" ASC, b.id ASC
             ) AS pos,
             COUNT(*) OVER (PARTITION BY ${CATEGORIA})::bigint AS total
        FROM ${tabela("OmieBaixa")} b
        JOIN ${tabela("OmieTitulo")} t ON t.id = b."tituloId"
       WHERE b."companyId" = ${escopo.companyId}
         AND b."dataBaixa" >= ${periodo.inicio}
         AND b."dataBaixa" <= ${periodo.fim}
         AND t.cancelado = false
         ${filtroConexaoBaixa(escopo.conexaoId)}
         ${naJanela(escopo.janela)}
    ) x
     WHERE x.pos <= ${TITULOS_POR_CATEGORIA_NA_TELA}
  `;
  return agruparDrill(linhas);
}

function agruparDrill(linhas: LinhaDrill[]) {
  const titulos = new Map<string, TituloDoDre[]>();
  const totais = new Map<string, number>();
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
    });
    titulos.set(l.categoria, lista);
    totais.set(l.categoria, Number(l.total));
  }
  return { titulos, totais };
}

async function categoriasDoEscopo(escopo: EscopoDre): Promise<Map<string, CategoriaParaDre>> {
  const linhas = await prisma.omieCategoria.findMany({
    where: { companyId: escopo.companyId, ...(escopo.conexaoId ? { conexaoId: escopo.conexaoId } : {}) },
    select: { codigo: true, descricao: true, natureza: true, contaReceita: true, contaDespesa: true },
  });
  return new Map(linhas.map((c) => [c.codigo, c]));
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
        : Promise.resolve({ titulos: new Map<string, TituloDoDre[]>(), totais: new Map<string, number>() }),
      retencoes(escopo, periodo, regime),
      retencoes(escopo, periodoAnterior, regime),
      periodoAnoAnterior ? retencoes(escopo, periodoAnoAnterior, regime) : Promise.resolve(null),
      categoriasDoEscopo(escopo),
    ]);

  return {
    atual,
    anterior,
    anoAnterior,
    movimento,
    titulos: drill.titulos,
    totalDeTitulosPorCategoria: drill.totais,
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
): Promise<Map<number, Map<string, number>>> {
  const inicio = new Date(ano, 0, 1, 0, 0, 0, 0);
  const fim = new Date(ano, 11, 31, 23, 59, 59, 999);

  const linhas =
    regime === "caixa"
      ? await prisma.$queryRaw<LinhaSomaMes[]>`
          SELECT ${CATEGORIA} AS categoria,
                 (EXTRACT(MONTH FROM b."dataBaixa") - 1)::int AS mes,
                 COALESCE(SUM(b."valorCents"), 0)::bigint AS cents
            FROM ${tabela("OmieBaixa")} b
            JOIN ${tabela("OmieTitulo")} t ON t.id = b."tituloId"
           WHERE b."companyId" = ${escopo.companyId}
             AND b."dataBaixa" >= ${inicio}
             AND b."dataBaixa" <= ${fim}
             AND t.cancelado = false
             ${filtroConexaoBaixa(escopo.conexaoId)}
             ${naJanela(escopo.janela)}
           GROUP BY 1, 2
        `
      : await prisma.$queryRaw<LinhaSomaMes[]>`
          SELECT ${CATEGORIA} AS categoria,
                 (EXTRACT(MONTH FROM ${competenciaSql("t")}) - 1)::int AS mes,
                 COALESCE(SUM(t."valorDocumentoCents"), 0)::bigint AS cents
            FROM ${tabela("OmieTitulo")} t
           WHERE t."companyId" = ${escopo.companyId}
             AND t.cancelado = false
             AND ${competenciaSql("t")} >= ${inicio}
             AND ${competenciaSql("t")} <= ${fim}
             ${filtroConexaoTitulo(escopo.conexaoId)}
             ${naJanela(escopo.janela)}
           GROUP BY 1, 2
        `;

  const porMes = new Map<number, Map<string, number>>();
  for (const l of linhas) {
    const mapa = porMes.get(l.mes) ?? new Map<string, number>();
    mapa.set(l.categoria, (mapa.get(l.categoria) ?? 0) + Number(l.cents));
    porMes.set(l.mes, mapa);
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
  const meses = Array.from({ length: ultimoMes + 1 }, (_, i) => ({ indice: i, rotulo: ROTULO_MES[i] }));

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
        atual: porMesAgregado.get(m.indice) ?? vazio,
        // O MÊS ANTERIOR SÓ DENTRO DO ANO — em janeiro ele fica vazio, que é
        // exatamente o que a versão em memória vê: o contexto da visão anual
        // começa em 1º de janeiro. A visão anual não exibe a coluna do mês
        // anterior; ela existe aqui porque a conta é a mesma dos dois lados.
        anterior: porMesAgregado.get(m.indice - 1) ?? vazio,
        anoAnterior: null,
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
