import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { tabela } from "@/lib/esquemaDoBanco";
import { competenciaSql } from "./competencia";
import { comparativoDoEscopo } from "./analytics";
import { montarDreAnualNoBanco, montarDreNoBanco } from "./dreNoBanco";
import { analisarEstrategiaNoBanco } from "./estrategiaCustoNoBanco";
import { rankingNoBanco, resumoDoPeriodoNoBanco } from "./resumoNoBanco";
import { filtroConexaoTitulo, filtroSoConexaoTitulo } from "./escopoSql";
import { LINHAS_DE_GRUPO, mesesDoHorizonte, projetar, sensibilidade, type Premissa } from "./projecao";
import { baseHistoricaNoBanco, contratosDoEscopo } from "./projecaoNoBanco";
import { dataReferenciaPadrao } from "./ciclo";
import { fmtBRL, fmtData, fmtPercent } from "./format";
import { fimDoMes, inicioDoMes, rotuloMes } from "./periodos";
import { AGENTES } from "./registry";
import type { ConsultaFeita } from "./investigador";

// AS FERRAMENTAS DE ANÁLISE — o que os especialistas de IA consultam.
//
// O investigador (investigador.ts) responde perguntas de AUDITORIA e por isso
// olha registro a registro: achado, título, baixa, cadastro. Os especialistas
// (controller, custos, orçamento) respondem perguntas de RESULTADO e de
// PLANEJAMENTO, e para elas o registro é ruído: o que decide é a soma por
// linha do DRE, a série de doze meses, a variação contra o mesmo mês do ano
// passado. Estas ferramentas devolvem exatamente isso — e devolvem SOMADO NO
// BANCO, pelas mesmas funções que as telas usam. Um número citado num parecer
// é o mesmo número que está na tela de Custos e DRE, porque saiu da mesma
// consulta.
//
// As garantias do investigador continuam: só leitura, escopo por fechamento
// (o modelo não escolhe de que empresa lê), toda consulta registrada.

const REGIME = z.enum(["competencia", "caixa"]).optional().describe("Padrão: competência (pela data de emissão).");
const COMPETENCIA = z
  .string()
  .regex(/^\d{4}-\d{2}$/)
  .optional()
  .describe("Mês no formato AAAA-MM. Padrão: o mês da data de referência (D-1).");

// A JANELA dos especialistas: a mesma da tela de Custos e DRE — treze meses
// atrás da referência, mais tudo que está em aberto. Para o DRE anual, o ano.
function janelaMensal(referencia: Date) {
  return { desde: new Date(referencia.getFullYear() - 1, referencia.getMonth(), 1), ate: null };
}

function mesDe(competencia: string | undefined, referencia: Date) {
  if (!competencia) {
    const inicio = inicioDoMes(referencia);
    return { inicio, fim: fimDoMes(inicio), rotulo: rotuloMes(inicio) };
  }
  const [ano, mes] = competencia.split("-").map(Number);
  const inicio = new Date(ano, mes - 1, 1);
  return { inicio, fim: fimDoMes(inicio), rotulo: rotuloMes(inicio) };
}

function mesAnteriorA(mes: { inicio: Date }) {
  const inicio = new Date(mes.inicio.getFullYear(), mes.inicio.getMonth() - 1, 1);
  return { inicio, fim: fimDoMes(inicio), rotulo: rotuloMes(inicio) };
}

function mesmoMesAnoAnterior(mes: { inicio: Date }) {
  const inicio = new Date(mes.inicio.getFullYear() - 1, mes.inicio.getMonth(), 1);
  return { inicio, fim: fimDoMes(inicio), rotulo: rotuloMes(inicio) };
}

async function classificacoesDe(companyId: string) {
  const guardadas = await prisma.dreClassificacao.findMany({
    where: { companyId },
    select: { categoriaCodigo: true, linha: true, subgrupo: true, origem: true },
  });
  return new Map(
    guardadas.map((c) => [c.categoriaCodigo, { linha: c.linha, subgrupo: c.subgrupo, confirmada: c.origem === "CONFIRMADA" }])
  );
}

export function ferramentasDeAnalise(
  escopo: { companyId: string; conexaoId: string | null },
  consultas: ConsultaFeita[],
  dataReferencia: Date = dataReferenciaPadrao()
) {
  const registrar = (ferramenta: string, entrada: Record<string, unknown>, resumo: string) => {
    consultas.push({ ferramenta, entrada, resumo });
  };
  const escopoSql = { companyId: escopo.companyId, conexaoId: escopo.conexaoId, janela: janelaMensal(dataReferencia) };
  const dataInicioBase = async () =>
    (await prisma.controladoriaConfig.findUnique({ where: { companyId: escopo.companyId }, select: { dataInicioBase: true } }))
      ?.dataInicioBase ?? new Date(2000, 0, 1);

  const comparativo = betaZodTool({
    name: "comparativo",
    description:
      "Os totais do painel: dia, mês corrente até a referência, mês anterior fechado, acumulado do ano, ano anterior e o mesmo mês do ano passado — receita, despesa, resultado, margem, recebido, pago e perdas (juros, multa, tarifa, desconto), com as variações. Comece por aqui para uma visão geral.",
    inputSchema: z.object({}),
    run: async () => {
      const c = await comparativoDoEscopo({
        companyId: escopo.companyId,
        conexaoId: escopo.conexaoId,
        dataReferencia,
        dataInicioBase: await dataInicioBase(),
      });
      registrar("comparativo", {}, `mês ${c.mesAtual.rotulo}: receita ${fmtBRL(c.mesAtual.receitaCents)}, resultado ${fmtBRL(c.mesAtual.resultadoCents)}`);
      const periodo = (p: typeof c.mesAtual) => ({
        periodo: p.rotulo,
        receita: fmtBRL(p.receitaCents), despesa: fmtBRL(p.despesaCents), resultado: fmtBRL(p.resultadoCents),
        margem: fmtPercent(p.margemPercent), recebido: fmtBRL(p.recebidoCents), pago: fmtBRL(p.pagoCents),
        fluxoLiquido: fmtBRL(p.fluxoLiquidoCents), perdas: {
          juros: fmtBRL(p.jurosCents), multa: fmtBRL(p.multaCents), tarifa: fmtBRL(p.tarifaCents),
          descontoConcedido: fmtBRL(p.descontoCents), total: fmtBRL(p.perdaTotalCents),
        },
        titulosPagar: p.titulosPagar, titulosReceber: p.titulosReceber,
      });
      return JSON.stringify({
        dataReferencia: fmtData(dataReferencia),
        atencao: c.semBaseAnoAnterior ? "a base não cobre o ano anterior inteiro; comparações anuais não têm base confiável" : undefined,
        dia: periodo(c.dia), mesAtual: periodo(c.mesAtual), mesAnterior: periodo(c.mesAnterior), ano: periodo(c.ano),
        anoAnterior: periodo(c.anoAnterior), mesmoMesAnoAnterior: periodo(c.mesmoMesAnoAnterior),
        variacoes: Object.fromEntries(Object.entries(c.variacoes).map(([k, v]) => [k, fmtPercent(v)])),
      });
    },
  });

  const resultadoDoPeriodo = betaZodTool({
    name: "resultado_do_periodo",
    description: "Receita, despesa, resultado, margem, recebido, pago e perdas de UM mês (competência AAAA-MM). Use para um mês específico que o comparativo não traz.",
    inputSchema: z.object({ competencia: COMPETENCIA }),
    run: async (input) => {
      const mes = mesDe(input.competencia, dataReferencia);
      const r = await resumoDoPeriodoNoBanco({ companyId: escopo.companyId, conexaoId: escopo.conexaoId, periodo: mes });
      registrar("resultado_do_periodo", input, `${mes.rotulo}: receita ${fmtBRL(r.receitaCents)}, resultado ${fmtBRL(r.resultadoCents)}`);
      return JSON.stringify({
        periodo: mes.rotulo, receita: fmtBRL(r.receitaCents), despesa: fmtBRL(r.despesaCents), resultado: fmtBRL(r.resultadoCents),
        margem: fmtPercent(r.margemPercent), recebido: fmtBRL(r.recebidoCents), pago: fmtBRL(r.pagoCents),
        perdas: { juros: fmtBRL(r.jurosCents), multa: fmtBRL(r.multaCents), tarifa: fmtBRL(r.tarifaCents), descontoConcedido: fmtBRL(r.descontoCents) },
        titulosPagar: r.titulosPagar, titulosReceber: r.titulosReceber,
      });
    },
  });

  const serieDeResultado = betaZodTool({
    name: "serie_de_resultado",
    description:
      "Receita, despesa e resultado mês a mês, dos últimos N meses (até 24), terminando no mês da referência. É a base para sazonalidade, tendência e cenários.",
    inputSchema: z.object({ meses: z.number().int().min(3).max(24).optional().describe("Padrão 12.") }),
    run: async (input) => {
      const n = input.meses ?? 12;
      const ultimo = inicioDoMes(dataReferencia);
      const periodos = Array.from({ length: n }, (_, i) => {
        const inicio = new Date(ultimo.getFullYear(), ultimo.getMonth() - (n - 1 - i), 1);
        return { inicio, fim: fimDoMes(inicio), rotulo: rotuloMes(inicio) };
      });
      const linhas = await Promise.all(
        periodos.map((p) => resumoDoPeriodoNoBanco({ companyId: escopo.companyId, conexaoId: escopo.conexaoId, periodo: p }))
      );
      registrar("serie_de_resultado", input, `${n} meses, de ${periodos[0].rotulo} a ${periodos[n - 1].rotulo}`);
      return JSON.stringify({
        atencao: "o último mês vai só até a data de referência; não compare o valor dele com um mês inteiro",
        meses: linhas.map((r) => ({
          mes: r.rotulo, receita: fmtBRL(r.receitaCents), despesa: fmtBRL(r.despesaCents), resultado: fmtBRL(r.resultadoCents),
          margem: fmtPercent(r.margemPercent), recebido: fmtBRL(r.recebidoCents), pago: fmtBRL(r.pagoCents), perdas: fmtBRL(r.perdaTotalCents),
        })),
      });
    },
  });

  const dre = betaZodTool({
    name: "dre",
    description:
      "A demonstração de resultado gerencial de um mês, na estrutura da Lei 6.404 (receita bruta, deduções, receita líquida, custo, lucro bruto, despesas por grupo, EBIT, financeiro, financiamentos, resultado líquido), com o mês anterior e o mesmo mês do ano passado, o percentual sobre a receita líquida, e as categorias que compõem cada linha. Diz também quanto está em categoria ainda não confirmada por uma pessoa e quanto está sem categoria.",
    inputSchema: z.object({
      competencia: COMPETENCIA,
      regime: REGIME,
      categoriasPorLinha: z.number().int().min(0).max(20).optional().describe("Quantas categorias listar por linha (padrão 6)."),
    }),
    run: async (input) => {
      const mes = mesDe(input.competencia, dataReferencia);
      const config = await prisma.controladoriaConfig.findUnique({ where: { companyId: escopo.companyId }, select: { retencoesNasDeducoes: true } });
      const r = await montarDreNoBanco(escopoSql, mes, mesAnteriorA(mes), await classificacoesDe(escopo.companyId), {
        regime: input.regime ?? "competencia",
        somarRetencoes: config?.retencoesNasDeducoes ?? false,
        periodoAnoAnterior: mesmoMesAnoAnterior(mes),
        incluirTitulos: false,
      });
      const teto = input.categoriasPorLinha ?? 6;
      registrar("dre", input, `${mes.rotulo} (${r.regime}): receita líquida ${fmtBRL(r.receitaLiquidaCents)}, resultado ${fmtBRL(r.resultadoLiquidoCents)}`);
      return JSON.stringify({
        periodo: mes.rotulo, regime: r.regime,
        receitaLiquida: fmtBRL(r.receitaLiquidaCents), resultadoLiquido: fmtBRL(r.resultadoLiquidoCents), margemLiquida: fmtPercent(r.margemLiquidaPercent),
        emCategoriaNaoConfirmada: fmtBRL(r.naoConfirmadoCents), semCategoria: fmtBRL(r.semCategoriaCents),
        retencoesNaFonte: { total: fmtBRL(r.retencoes.totalCents), somadasNasDeducoes: r.retencoesSomadas, titulosComRetencao: r.retencoes.titulosComRetencao },
        linhas: r.linhas
          .filter((l) => l.tipo === "SUBTOTAL" || l.valorCents !== 0 || l.valorAnteriorCents !== 0 || l.itens.length > 0)
          .map((l) => ({
            linha: l.rotulo, tipo: l.tipo, valor: fmtBRL(l.valorCents), mesAnterior: fmtBRL(l.valorAnteriorCents),
            mesmoMesAnoAnterior: l.valorAnoAnteriorCents === null ? null : fmtBRL(l.valorAnoAnteriorCents),
            percentReceitaLiquida: fmtPercent(l.percentReceitaLiquida),
            categorias: l.itens.slice(0, teto).map((i) => ({
              codigo: i.categoriaCodigo, descricao: i.descricao, valor: fmtBRL(i.valorCents), mesAnterior: fmtBRL(i.valorAnteriorCents),
              confirmadaPorPessoa: i.confirmada, subgrupo: i.subgrupo,
            })),
            categoriasOmitidas: Math.max(0, l.itens.length - teto),
          })),
      });
    },
  });

  const dreAnual = betaZodTool({
    name: "dre_anual",
    description: "O DRE do ano inteiro, mês a mês, até o mês da referência, com o total e o percentual do ano sobre a receita líquida. Use para tendência ao longo do ano.",
    inputSchema: z.object({ ano: z.number().int().min(2015).max(2100).optional().describe("Padrão: o ano da referência."), regime: REGIME }),
    run: async (input) => {
      const ano = input.ano ?? dataReferencia.getFullYear();
      const config = await prisma.controladoriaConfig.findUnique({ where: { companyId: escopo.companyId }, select: { retencoesNasDeducoes: true } });
      const r = await montarDreAnualNoBanco(
        { ...escopoSql, janela: { desde: new Date(ano, 0, 1), ate: null } },
        ano,
        dataReferencia,
        await classificacoesDe(escopo.companyId),
        { regime: input.regime ?? "competencia", somarRetencoes: config?.retencoesNasDeducoes ?? false }
      );
      registrar("dre_anual", input, `${ano}: ${r.meses.length} mês(es), resultado ${fmtBRL(r.resultadoLiquidoCents)}`);
      return JSON.stringify({
        ano, regime: r.regime, meses: r.meses.map((m) => m.rotulo),
        receitaLiquida: fmtBRL(r.receitaLiquidaCents), resultadoLiquido: fmtBRL(r.resultadoLiquidoCents), margemLiquida: fmtPercent(r.margemLiquidaPercent),
        emCategoriaNaoConfirmada: fmtBRL(r.naoConfirmadoCents), semCategoria: fmtBRL(r.semCategoriaCents),
        linhas: r.linhas
          .filter((l) => l.tipo === "SUBTOTAL" || l.totalCents !== 0)
          .map((l) => ({ linha: l.rotulo, tipo: l.tipo, porMes: l.porMes.map(fmtBRL), total: fmtBRL(l.totalCents), percentReceitaLiquida: fmtPercent(l.percentReceitaLiquida) })),
      });
    },
  });

  const rankingParceiros = betaZodTool({
    name: "ranking_parceiros",
    description: "Os maiores fornecedores (PAGAR) ou clientes (RECEBER) de um mês, por valor de títulos, com a quantidade de títulos de cada um.",
    inputSchema: z.object({ natureza: z.enum(["PAGAR", "RECEBER"]), competencia: COMPETENCIA, limite: z.number().int().min(3).max(40).optional() }),
    run: async (input) => {
      const mes = mesDe(input.competencia, dataReferencia);
      const linhas = await rankingNoBanco(escopoSql, mes, input.natureza, input.limite ?? 15);
      registrar("ranking_parceiros", input, `${linhas.length} ${input.natureza === "PAGAR" ? "fornecedores" : "clientes"} em ${mes.rotulo}`);
      return JSON.stringify({ periodo: mes.rotulo, parceiros: linhas.map((l) => ({ nome: l.nome, valor: fmtBRL(l.valorCents), titulos: l.quantidade })) });
    },
  });

  const estrategiaDeCusto = betaZodTool({
    name: "estrategia_de_custo",
    description:
      "A análise de custo dos últimos doze meses por categoria: peso no custo total (Pareto), classificação em variável (acompanha a receita), fixo estrutural ou desacoplado (cresce sem a receita crescer), custo sobre receita e a economia anual estimada por categoria. É a fila de onde cortar.",
    inputSchema: z.object({ limite: z.number().int().min(5).max(60).optional().describe("Quantas categorias devolver (padrão 20, na ordem de prioridade).") }),
    run: async (input) => {
      const a = await analisarEstrategiaNoBanco(escopoSql, dataReferencia);
      registrar("estrategia_de_custo", input, `${a.mesesAnalisados} meses, custo médio ${fmtBRL(a.custoTotalMensalCents)}/mês, ${a.linhas.length} categorias`);
      return JSON.stringify({
        mesesAnalisados: a.mesesAnalisados, baseSuficiente: a.baseSuficiente,
        custoMedioMensal: fmtBRL(a.custoTotalMensalCents), economiaAnualEstimadaNos80Porcento: fmtBRL(a.economiaAnualTotalCents),
        categorias: a.linhas.slice(0, input.limite ?? 20).map((l) => ({
          codigo: l.codigo, descricao: l.descricao, custoMedioMensal: fmtBRL(l.custoMedioMensalCents), participacao: fmtPercent(l.participacaoPercent),
          dentroDosPrimeiros80: l.dentroDosPrimeiros80, classificacao: l.classificacao, descolamentoPontos: l.descolamentoPontos === null ? null : Math.round(l.descolamentoPontos),
          custoSobreReceita: fmtPercent(l.custoSobreReceitaPercent), economiaAnualEstimada: fmtBRL(l.economiaAnualEstimadaCents), racional: l.racional,
        })),
      });
    },
  });

  const emAberto = betaZodTool({
    name: "em_aberto_por_faixa",
    description:
      "O que está em aberto a pagar e a receber na data de referência, por faixa de atraso (a vencer, 1-30, 31-60, 61-90, mais de 90 dias): quantidade e valor. É o aging.",
    inputSchema: z.object({ natureza: z.enum(["PAGAR", "RECEBER"]).optional().describe("Padrão: as duas.") }),
    run: async (input) => {
      const linhas = await prisma.$queryRaw<{ natureza: string; faixa: string; quantidade: bigint; cents: bigint }[]>`
        SELECT t.natureza::text AS natureza,
               CASE WHEN t."dataVencimento" >= ${dataReferencia} THEN 'a vencer'
                    WHEN t."dataVencimento" >= ${new Date(dataReferencia.getTime() - 30 * 86400000)} THEN '1-30 dias'
                    WHEN t."dataVencimento" >= ${new Date(dataReferencia.getTime() - 60 * 86400000)} THEN '31-60 dias'
                    WHEN t."dataVencimento" >= ${new Date(dataReferencia.getTime() - 90 * 86400000)} THEN '61-90 dias'
                    ELSE 'mais de 90 dias' END AS faixa,
               COUNT(*)::bigint AS quantidade,
               COALESCE(SUM(COALESCE(t."saldoCents", t."valorDocumentoCents" - t."valorPagoCents")), 0)::bigint AS cents
          FROM ${tabela("OmieTitulo")} t
         WHERE t."companyId" = ${escopo.companyId}
           AND t.cancelado = false AND t.liquidado = false
           AND COALESCE(t."saldoCents", t."valorDocumentoCents" - t."valorPagoCents") > 0
           ${filtroSoConexaoTitulo(escopo.conexaoId)}
           ${input.natureza ? Prisma.sql`AND t.natureza::text = ${input.natureza}` : Prisma.empty}
         GROUP BY 1, 2
      `;
      const total = linhas.reduce((a, l) => a + Number(l.cents), 0);
      registrar("em_aberto_por_faixa", input, `${linhas.reduce((a, l) => a + Number(l.quantidade), 0)} título(s) em aberto, ${fmtBRL(total)}`);
      return JSON.stringify({
        dataReferencia: fmtData(dataReferencia),
        faixas: linhas.map((l) => ({ natureza: l.natureza, faixa: l.faixa, titulos: Number(l.quantidade), saldo: fmtBRL(Number(l.cents)) })),
      });
    },
  });

  const emissaoPorTipo = betaZodTool({
    name: "receita_por_tipo_de_documento",
    description: "A receita de um mês separada pelo tipo de documento do título (NFS-e, CT-e, sem documento fiscal, ...). Diz quanto da receita está sem nota.",
    inputSchema: z.object({ competencia: COMPETENCIA }),
    run: async (input) => {
      const mes = mesDe(input.competencia, dataReferencia);
      const linhas = await prisma.$queryRaw<{ tipo: string | null; quantidade: bigint; cents: bigint }[]>`
        SELECT t."tipoDocumento" AS tipo, COUNT(*)::bigint AS quantidade, COALESCE(SUM(t."valorDocumentoCents"), 0)::bigint AS cents
          FROM ${tabela("OmieTitulo")} t
         WHERE t."companyId" = ${escopo.companyId} AND t.cancelado = false AND t.natureza = 'RECEBER'
           AND ${competenciaSql("t")} >= ${mes.inicio} AND ${competenciaSql("t")} <= ${mes.fim}
           ${filtroConexaoTitulo(escopo.conexaoId, escopo.companyId)}
         GROUP BY 1 ORDER BY cents DESC
      `;
      registrar("receita_por_tipo_de_documento", input, `${mes.rotulo}: ${linhas.length} tipo(s)`);
      return JSON.stringify({ periodo: mes.rotulo, tipos: linhas.map((l) => ({ tipo: l.tipo ?? "(sem tipo)", titulos: Number(l.quantidade), valor: fmtBRL(Number(l.cents)) })) });
    },
  });

  // O SISTEMA VISTO POR DENTRO — para o objetivo "revisar o sistema". Só o
  // que descreve o modelo de gestão e a saúde das regras: parâmetros, a lista
  // de agentes, a calibração de cada regra (quantos achados, quantos são só
  // informativos, quantos foram dispensados por pessoas) e o estado das
  // classificações do DRE. Nada de parceiro, valor ou documento.
  const configuracao = betaZodTool({
    name: "configuracao_e_regras",
    description:
      "Como o sistema está configurado e como as regras estão se comportando: parâmetros do modelo de gestão (alçada, tolerâncias, metas), os agentes de auditoria existentes, e para cada regra quantos achados estão em aberto, quantos são só informativos e quantos uma pessoa marcou como 'não se aplica' (regra que gera muito 'não se aplica' está mal calibrada). Também o estado da classificação do DRE. Use para revisar o sistema.",
    inputSchema: z.object({}),
    run: async () => {
      const [config, porRegra, classificacao, conexoes, ultimas] = await Promise.all([
        prisma.controladoriaConfig.findUnique({ where: { companyId: escopo.companyId } }),
        prisma.auditFinding.groupBy({
          by: ["agente", "regra", "severidade", "status"],
          where: { companyId: escopo.companyId },
          _count: true,
        }),
        prisma.dreClassificacao.groupBy({ by: ["origem"], where: { companyId: escopo.companyId }, _count: true }),
        prisma.omieConexao.findMany({ where: { companyId: escopo.companyId, ativa: true }, select: { id: true, apelido: true } }),
        prisma.omieSyncRun.findMany({
          where: { companyId: escopo.companyId, backfill: false, conexaoId: { not: null } },
          orderBy: { iniciadoEm: "desc" },
          take: 10,
          select: { conexaoId: true, status: true, iniciadoEm: true, finalizadoEm: true },
        }),
      ]);
      const regras = new Map<string, { agente: string; abertos: number; informativos: number; naoSeAplica: number; resolvidos: number; total: number }>();
      for (const l of porRegra) {
        const r = regras.get(l.regra) ?? { agente: l.agente, abertos: 0, informativos: 0, naoSeAplica: 0, resolvidos: 0, total: 0 };
        r.total += l._count;
        if (l.status === "ABERTO" || l.status === "EM_ANALISE") {
          r.abertos += l._count;
          if (l.severidade === "INFO") r.informativos += l._count;
        }
        if (l.status === "IGNORADO") r.naoSeAplica += l._count;
        if (l.status === "RESOLVIDO") r.resolvidos += l._count;
        regras.set(l.regra, r);
      }
      const apelido = new Map(conexoes.map((c) => [c.id, c.apelido]));
      registrar("configuracao_e_regras", {}, `${AGENTES.length} agentes, ${regras.size} regras com achado`);
      return JSON.stringify({
        parametros: config
          ? {
              inicioDaBase: fmtData(config.dataInicioBase), alcadaDeAprovacao: config.limiteAlcadaCents ? fmtBRL(config.limiteAlcadaCents) : "não cadastrada",
              metaDeMargem: fmtPercent(config.metaMargemPercent), toleranciaDeVariacao: fmtPercent(config.toleranciaVariacaoPercent),
              diasDeAtrasoCritico: config.diasAtrasoCritico, saldoMinimoDeCaixa: config.saldoMinimoCaixaCents ? fmtBRL(config.saldoMinimoCaixaCents) : "não cadastrado",
              limiteDeConcentracaoPorFornecedor: fmtPercent(config.limiteConcentracaoFornecedorPercent), retencoesSomadasNasDeducoes: config.retencoesNasDeducoes,
              relatorioAutomatico: config.relatorioAutomatico, alertaPorExcecao: config.alertaPorExcecao,
            }
          : "sem configuração",
        agentes: AGENTES.map((a) => ({ id: a.id, nome: a.nome, area: a.area, descricao: a.descricao })),
        regras: [...regras.entries()]
          .map(([regra, r]) => ({ regra, ...r }))
          .sort((a, b) => b.abertos - a.abertos),
        classificacaoDoDre: Object.fromEntries(classificacao.map((c) => [c.origem, c._count])),
        ultimasSincronizacoes: ultimas.map((u) => ({
          empresa: apelido.get(u.conexaoId ?? "") ?? "?", status: u.status, inicio: u.iniciadoEm.toISOString(), fim: u.finalizadoEm?.toISOString() ?? null,
        })),
      });
    },
  });

  // A PROJEÇÃO — a mesma de Cenários e orçamento. O especialista de orçamento
  // não precisa mais montar tendência e sazonalidade à mão a partir do DRE
  // anual: recebe os doze meses projetados na estrutura do DRE, com o método
  // de cada linha, e pode passar as premissas do cenário que a pessoa pediu.
  // Não grava nada: cenário salvo é ato de gente, na tela.
  const projecaoDre = betaZodTool({
    name: "projecao_dre",
    description:
      "A projeção dos próximos doze meses na estrutura do DRE (receita bruta até resultado líquido), a partir dos meses FECHADOS: cada mês parte do mesmo mês do ano anterior, aparado pelo desvio mediano e corrigido pela tendência dos últimos doze meses; a receita bruta pode vir da série ou dos contratos ativos da Omie. Aceita premissas (linha do DRE, variação %, mês de início e fim) e devolve base, cenário e diferença mês a mês, mais a sensibilidade de ±10% nas linhas pedidas. Use para 'como fecha o ano', cenários e orçamento — em vez de projetar à mão a partir do dre_anual.",
    inputSchema: z.object({
      baseReceita: z.enum(["HISTORICA", "CONTRATADA"]).optional().describe("De onde sai a receita bruta: da série (padrão) ou dos contratos de serviço ativos."),
      premissas: z
        .array(
          z.object({
            linha: z.enum(LINHAS_DE_GRUPO as [string, ...string[]]).describe("Chave da linha do DRE, por exemplo DESPESA_VEICULOS."),
            percentual: z.number().min(-500).max(500).describe("+15 = a linha sobe 15%; -10 = cai 10%."),
            desde: z.string().regex(/^\d{4}-\d{2}$/).describe("Primeiro mês da premissa, AAAA-MM."),
            ate: z.string().regex(/^\d{4}-\d{2}$/).optional().describe("Último mês da premissa (opcional; sem fim = até o fim do horizonte)."),
            descricao: z.string().max(160).optional(),
          })
        )
        .max(20)
        .optional(),
      sensibilidadeEm: z.array(z.enum(LINHAS_DE_GRUPO as [string, ...string[]])).max(6).optional().describe("Linhas para medir o efeito de ±10% (padrão: receita bruta, veículos, pessoas — operação e corporativo / administrativo)."),
    }),
    run: async (input) => {
      const [base, contratos] = await Promise.all([baseHistoricaNoBanco(escopo, dataReferencia), contratosDoEscopo(escopo)]);
      const meses = mesesDoHorizonte(dataReferencia, 12);
      const cenario = { baseReceita: input.baseReceita ?? "HISTORICA", premissas: (input.premissas ?? []) as Premissa[] };
      const p = projetar(base, contratos, meses, cenario);
      const referencia = cenario.premissas.length > 0 ? projetar(base, contratos, meses, { ...cenario, premissas: [] }) : p;
      const linhasSens = (input.sensibilidadeEm ?? ["RECEITA_BRUTA", "DESPESA_VEICULOS", "DESPESA_SALARIOS", "DESPESA_SALARIOS_CORPORATIVO"]) as Premissa["linha"][];
      const sens = sensibilidade(base, contratos, meses, cenario, linhasSens);
      registrar("projecao_dre", input, `${p.meses[0].rotulo} a ${p.meses[11].rotulo}: EBIT ${fmtBRL(p.ebitCents)}, ${cenario.premissas.length} premissa(s)`);
      return JSON.stringify({
        base: {
          ultimoMesFechado: p.base.ultimaCompetenciaFechada,
          mesesFechadosNaBase: p.base.mesesDeBase,
          primeiroMesDaBase: p.base.primeiraCompetencia,
          metodo: "mesmo mês do ano anterior, aparado por mediana ± 3 MAD dos últimos 12 fechados, × (soma dos últimos 12 ÷ soma dos 12 anteriores); com menos de 12 meses, mediana; com menos de 3, sem base",
        },
        horizonte: p.meses.map((m) => m.rotulo),
        receitaBrutaDe: p.baseReceita,
        receitaContratadaPorMes: p.receitaContratada.map((r) => ({ valor: fmtBRL(r.cents), contratos: r.contratos })),
        totais12Meses: { receitaLiquida: fmtBRL(p.receitaLiquidaCents), ebit: fmtBRL(p.ebitCents), resultadoLiquido: fmtBRL(p.resultadoLiquidoCents) },
        diferencaContraBase: cenario.premissas.length > 0 ? { ebit: fmtBRL(p.ebitCents - referencia.ebitCents), resultadoLiquido: fmtBRL(p.resultadoLiquidoCents - referencia.resultadoLiquidoCents) } : undefined,
        premissasAplicadas: p.premissasAplicadas,
        linhas: p.linhas
          .filter((l) => l.tipo === "SUBTOTAL" || l.totalCents !== 0 || l.basePorMes.some((v) => v !== 0))
          .map((l) => ({
            linha: l.rotulo,
            tipo: l.tipo,
            porMes: l.porMes.map(fmtBRL),
            basePorMes: l.porMes.some((v, i) => v !== l.basePorMes[i]) ? l.basePorMes.map(fmtBRL) : undefined,
            total: fmtBRL(l.totalCents),
            metodoPorMes: l.tipo === "GRUPO" ? l.metodos : undefined,
          })),
        sensibilidade: sens.map((s) => ({ linha: s.rotulo, variacao: `${s.percentual > 0 ? "+" : ""}${s.percentual}%`, efeitoEbit: fmtBRL(s.efeitoEbitCents), efeitoResultado: fmtBRL(s.efeitoResultadoCents) })),
      });
    },
  });

  return [comparativo, resultadoDoPeriodo, serieDeResultado, dre, dreAnual, rankingParceiros, estrategiaDeCusto, emAberto, emissaoPorTipo, configuracao, projecaoDre];
}

