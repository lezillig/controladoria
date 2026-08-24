import { fmtBRL, fmtPercent } from "./format";
import { inicioDoMes } from "./periodos";
import { somar, titulosAtivos } from "./agents/comum";
import type { ContextoAuditoria } from "./types";
// Custo POR MÊS é competência: a despesa pertence ao mês em que foi incorrida,
// não ao mês em que a fatura vence. Ver competencia.ts.
import { dataDeCompetencia } from "./competencia";

// ESTRATÉGIA DE REDUÇÃO DE CUSTO — onde cortar, e por quê.
//
// Reduzir custo é meta; saber ONDE reduzir é estratégia. A diferença entre as
// duas é o que separa um corte que melhora o resultado de um corte que
// destrói capacidade de entrega e volta como custo maior no trimestre
// seguinte (motorista desligado que vira hora extra, manutenção adiada que
// vira quebra em rota).
//
// O método aqui é o de análise de custos de uma operação de serviço, e tem
// dois eixos:
//
//   1. PESO — quanto a categoria representa do custo total. Corte em
//      categoria pequena consome a mesma energia política de um corte em
//      categoria grande e devolve uma fração do resultado. Por isso o corte
//      começa pelas categorias que formam os primeiros 80% do custo (Pareto).
//
//   2. ACOPLAMENTO À RECEITA — se o custo sobe e desce junto com o
//      faturamento, ele é VARIÁVEL: acompanha a entrega, e cortá-lo significa
//      entregar menos (combustível, pedágio, manutenção por km). Se o custo
//      segue seu próprio caminho, independente do que a empresa faturou, ele é
//      DESACOPLADO: ali mora a economia de verdade, porque reduzi-lo não tira
//      capacidade de entrega nenhuma.
//
// O cruzamento dos dois eixos dá a fila de prioridade — que é o que este
// módulo devolve, com o valor estimado de cada alvo e a razão pela qual ele
// entrou na fila.

// Mínimo de meses com dado para julgar acoplamento. Abaixo disso, qualquer
// leitura de tendência é ruído — e o módulo diz isso, em vez de recomendar
// corte com base em dois pontos.
const MINIMO_MESES_ANALISE = 4;
const MESES_ANALISE = 12;

export type ClassificacaoCusto =
  // Sobe e desce junto com a receita: é o custo de entregar o serviço.
  // Reduzir aqui é reduzir operação — só faz sentido via eficiência
  // (consumo por km, produtividade), nunca via corte direto.
  | "VARIAVEL_ACOPLADO"
  // Estável, independente do volume: estrutura. Reduzir exige decisão
  // estrutural (renegociar contrato, mudar escopo), com efeito permanente.
  | "FIXO_ESTRUTURAL"
  // Cresce enquanto a receita não cresce (ou cai). É o alvo preferencial:
  // aumento sem contrapartida de entrega.
  | "DESACOPLADO_CRESCENTE"
  // Sem histórico suficiente para classificar.
  | "INDETERMINADO";

export type LinhaEstrategia = {
  codigo: string;
  descricao: string;
  custoMedioMensalCents: number;
  participacaoPercent: number;
  // Posição no Pareto: true enquanto a soma acumulada não passa de 80%.
  dentroDosPrimeiros80: boolean;
  classificacao: ClassificacaoCusto;
  // Variação do custo x variação da receita entre a primeira e a segunda
  // metade do período analisado. É a medida de acoplamento, em pontos
  // percentuais: +30 significa que o custo cresceu 30 p.p. mais que a receita.
  descolamentoPontos: number | null;
  custoSobreReceitaPercent: number | null;
  // Quanto se estima recuperar por ano com uma redução realista naquela
  // classificação (ver PERCENTUAL_REDUCAO_REALISTA).
  economiaAnualEstimadaCents: number;
  prioridade: number;
  racional: string;
  acao: string;
};

// Percentual de redução considerado alcançável por classificação, para
// estimar o retorno. Números conservadores de propósito: uma estimativa
// otimista aqui vira meta impossível na reunião seguinte e desmoraliza o
// resto do relatório.
const PERCENTUAL_REDUCAO_REALISTA: Record<ClassificacaoCusto, number> = {
  DESACOPLADO_CRESCENTE: 0.2,
  FIXO_ESTRUTURAL: 0.08,
  VARIAVEL_ACOPLADO: 0.05,
  INDETERMINADO: 0,
};

type SerieMensal = { mes: string; custo: number; receita: number };

function seriesMensais(ctx: ContextoAuditoria): { meses: string[]; porCategoria: Map<string, Map<string, number>>; receitaPorMes: Map<string, number> } {
  const primeiroMes = inicioDoMes(
    new Date(ctx.dataReferencia.getFullYear(), ctx.dataReferencia.getMonth() - (MESES_ANALISE - 1), 1)
  );

  const meses: string[] = [];
  for (let i = 0; i < MESES_ANALISE; i++) {
    const d = new Date(primeiroMes.getFullYear(), primeiroMes.getMonth() + i, 1);
    if (d > ctx.dataReferencia) break;
    meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  const chaveMes = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

  const porCategoria = new Map<string, Map<string, number>>();
  for (const t of titulosAtivos(ctx, "PAGAR")) {
    const competencia = dataDeCompetencia(t);
    if (competencia < primeiroMes || competencia > ctx.dataReferencia) continue;
    const categoria = t.categoriaCodigo ?? "SEM_CATEGORIA";
    const mes = chaveMes(competencia);
    const serie = porCategoria.get(categoria) ?? new Map<string, number>();
    serie.set(mes, (serie.get(mes) ?? 0) + t.valorDocumentoCents);
    porCategoria.set(categoria, serie);
  }

  const receitaPorMes = new Map<string, number>();
  for (const t of titulosAtivos(ctx, "RECEBER")) {
    const competencia = dataDeCompetencia(t);
    if (competencia < primeiroMes || competencia > ctx.dataReferencia) continue;
    const mes = chaveMes(competencia);
    receitaPorMes.set(mes, (receitaPorMes.get(mes) ?? 0) + t.valorDocumentoCents);
  }

  return { meses, porCategoria, receitaPorMes };
}

// Compara a primeira metade do período com a segunda. Escolhido em vez de
// regressão ou correlação de Pearson por uma razão prática: o resultado
// precisa ser explicável em uma frase para quem vai decidir o corte
// ("o custo subiu 34% enquanto a receita subiu 6%"). Correlação de 0,82 não
// convence ninguém a cancelar um contrato.
function medirDescolamento(serie: SerieMensal[]): { descolamentoPontos: number | null; variacaoCusto: number | null; variacaoReceita: number | null } {
  if (serie.length < MINIMO_MESES_ANALISE) {
    return { descolamentoPontos: null, variacaoCusto: null, variacaoReceita: null };
  }

  const meio = Math.floor(serie.length / 2);
  const somaCusto = (parte: SerieMensal[]) => somar(parte, (p) => p.custo);
  const somaReceita = (parte: SerieMensal[]) => somar(parte, (p) => p.receita);

  const custoAntes = somaCusto(serie.slice(0, meio));
  const custoDepois = somaCusto(serie.slice(meio));
  const receitaAntes = somaReceita(serie.slice(0, meio));
  const receitaDepois = somaReceita(serie.slice(meio));

  if (custoAntes <= 0) return { descolamentoPontos: null, variacaoCusto: null, variacaoReceita: null };

  const variacaoCusto = ((custoDepois - custoAntes) / custoAntes) * 100;
  const variacaoReceita = receitaAntes > 0 ? ((receitaDepois - receitaAntes) / receitaAntes) * 100 : null;
  if (variacaoReceita === null) return { descolamentoPontos: null, variacaoCusto, variacaoReceita };

  return { descolamentoPontos: variacaoCusto - variacaoReceita, variacaoCusto, variacaoReceita };
}

function classificar(descolamentoPontos: number | null, variacaoCusto: number | null): ClassificacaoCusto {
  if (descolamentoPontos === null || variacaoCusto === null) return "INDETERMINADO";
  // Custo que cresceu bem mais que a receita: descolado. 10 p.p. é a faixa a
  // partir da qual a diferença deixa de ser sazonalidade.
  if (descolamentoPontos > 10) return "DESACOPLADO_CRESCENTE";
  // Custo praticamente parado enquanto o faturamento variou: estrutura.
  if (Math.abs(variacaoCusto) < 10) return "FIXO_ESTRUTURAL";
  // Anda junto com a receita: é o custo de entregar.
  return "VARIAVEL_ACOPLADO";
}

export function analisarEstrategiaDeCusto(ctx: ContextoAuditoria): {
  linhas: LinhaEstrategia[];
  custoTotalMensalCents: number;
  economiaAnualTotalCents: number;
  mesesAnalisados: number;
  baseSuficiente: boolean;
} {
  const { meses, porCategoria, receitaPorMes } = seriesMensais(ctx);
  const descricaoPorCodigo = new Map(ctx.categorias.map((c) => [c.codigo, c.descricao]));

  const linhasBrutas = [...porCategoria.entries()].map(([codigo, serieCusto]) => {
    const serie: SerieMensal[] = meses.map((mes) => ({
      mes,
      custo: serieCusto.get(mes) ?? 0,
      receita: receitaPorMes.get(mes) ?? 0,
    }));

    const custoTotal = somar(serie, (p) => p.custo);
    const custoMedioMensal = meses.length > 0 ? Math.round(custoTotal / meses.length) : 0;
    const receitaTotal = somar(serie, (p) => p.receita);

    const { descolamentoPontos, variacaoCusto, variacaoReceita } = medirDescolamento(serie);
    const classificacao = classificar(descolamentoPontos, variacaoCusto);

    return {
      codigo,
      descricao: codigo === "SEM_CATEGORIA" ? "Sem categoria" : descricaoPorCodigo.get(codigo) ?? `Categoria ${codigo}`,
      custoMedioMensalCents: custoMedioMensal,
      custoTotal,
      classificacao,
      descolamentoPontos,
      variacaoCusto,
      variacaoReceita,
      custoSobreReceitaPercent: receitaTotal > 0 ? (custoTotal / receitaTotal) * 100 : null,
    };
  });

  const custoTotalGeral = somar(linhasBrutas, (l) => l.custoTotal);
  const ordenadas = [...linhasBrutas].sort((a, b) => b.custoTotal - a.custoTotal);

  let acumulado = 0;
  const linhas: LinhaEstrategia[] = ordenadas.map((l) => {
    acumulado += l.custoTotal;
    const dentroDosPrimeiros80 = custoTotalGeral > 0 && acumulado - l.custoTotal < custoTotalGeral * 0.8;
    const participacao = custoTotalGeral > 0 ? (l.custoTotal / custoTotalGeral) * 100 : 0;

    const economiaAnual = Math.round(l.custoMedioMensalCents * 12 * PERCENTUAL_REDUCAO_REALISTA[l.classificacao]);

    // Prioridade: peso × oportunidade. Categoria grande e descolada da receita
    // vem primeiro; categoria pequena e acoplada, por último. O número não é
    // exibido — o que importa é a ORDEM da fila.
    const pesoOportunidade = {
      DESACOPLADO_CRESCENTE: 3,
      FIXO_ESTRUTURAL: 2,
      VARIAVEL_ACOPLADO: 1,
      INDETERMINADO: 0.5,
    }[l.classificacao];
    const prioridade = participacao * pesoOportunidade;

    return {
      codigo: l.codigo,
      descricao: l.descricao,
      custoMedioMensalCents: l.custoMedioMensalCents,
      participacaoPercent: participacao,
      dentroDosPrimeiros80,
      classificacao: l.classificacao,
      descolamentoPontos: l.descolamentoPontos,
      custoSobreReceitaPercent: l.custoSobreReceitaPercent,
      economiaAnualEstimadaCents: economiaAnual,
      prioridade,
      racional: montarRacional(l),
      acao: montarAcao(l.classificacao, l.descricao),
    };
  });

  linhas.sort((a, b) => b.prioridade - a.prioridade);

  return {
    linhas,
    custoTotalMensalCents: meses.length > 0 ? Math.round(custoTotalGeral / meses.length) : 0,
    economiaAnualTotalCents: somar(
      linhas.filter((l) => l.dentroDosPrimeiros80),
      (l) => l.economiaAnualEstimadaCents
    ),
    mesesAnalisados: meses.length,
    baseSuficiente: meses.length >= MINIMO_MESES_ANALISE,
  };
}

function montarRacional(l: {
  descricao: string;
  classificacao: ClassificacaoCusto;
  variacaoCusto: number | null;
  variacaoReceita: number | null;
  descolamentoPontos: number | null;
  custoSobreReceitaPercent: number | null;
}): string {
  const relacao =
    l.custoSobreReceitaPercent !== null ? ` Representa ${fmtPercent(l.custoSobreReceitaPercent)} da receita do período.` : "";

  switch (l.classificacao) {
    case "DESACOPLADO_CRESCENTE":
      return (
        `O custo cresceu ${fmtPercent(l.variacaoCusto)} enquanto a receita variou ${fmtPercent(l.variacaoReceita)} — ` +
        `${fmtPercent(l.descolamentoPontos)} de descolamento. Aumento sem contrapartida de entrega é o alvo mais seguro de redução: ` +
        `cortar aqui não tira capacidade de operação.${relacao}`
      );
    case "FIXO_ESTRUTURAL":
      return (
        `Custo estável (${fmtPercent(l.variacaoCusto)}) independentemente do volume faturado — é estrutura, não entrega. ` +
        `Redução exige decisão estrutural, mas o efeito é permanente e se repete todo mês.${relacao}`
      );
    case "VARIAVEL_ACOPLADO":
      return (
        `Acompanha a receita (custo ${fmtPercent(l.variacaoCusto)} contra receita ${fmtPercent(l.variacaoReceita)}) — ` +
        `é o custo de entregar o serviço. Cortar aqui é entregar menos; o ganho vem de eficiência, não de corte.${relacao}`
      );
    default:
      return `Histórico insuficiente para julgar se o custo acompanha a receita.${relacao}`;
  }
}

function montarAcao(classificacao: ClassificacaoCusto, descricao: string): string {
  switch (classificacao) {
    case "DESACOPLADO_CRESCENTE":
      return (
        `Abrir os lançamentos de "${descricao}" dos últimos meses e identificar o que entrou: fornecedor novo, reajuste ` +
        `aplicado sem negociação ou escopo ampliado sem decisão. Esse é o primeiro corte a fazer.`
      );
    case "FIXO_ESTRUTURAL":
      return (
        `Renegociar contrato ou revisar escopo de "${descricao}". Por ser custo fixo, cada real reduzido se repete todos os ` +
        `meses — leve o volume anual para a mesa de negociação e cote com pelo menos dois concorrentes.`
      );
    case "VARIAVEL_ACOPLADO":
      return (
        `Não cortar: buscar eficiência em "${descricao}" (consumo por km, produtividade por hora, retrabalho). ` +
        `A meta certa aqui é reduzir o custo POR UNIDADE ENTREGUE, não o valor absoluto.`
      );
    default:
      return `Classificar e acompanhar "${descricao}" por mais alguns meses antes de decidir qualquer corte.`;
  }
}

export const ROTULO_CLASSIFICACAO: Record<ClassificacaoCusto, string> = {
  DESACOPLADO_CRESCENTE: "Cresce sem a receita crescer",
  FIXO_ESTRUTURAL: "Estrutura (fixo)",
  VARIAVEL_ACOPLADO: "Acompanha a entrega (variável)",
  INDETERMINADO: "Histórico insuficiente",
};

// Texto pronto para o achado do agente de oportunidades.
export function resumirAlvosDeReducao(analise: ReturnType<typeof analisarEstrategiaDeCusto>): string {
  const alvos = analise.linhas
    .filter((l) => l.dentroDosPrimeiros80 && l.economiaAnualEstimadaCents > 0)
    .slice(0, 3);
  if (alvos.length === 0) return "";

  return alvos
    .map(
      (l, i) =>
        `${i + 1}. ${l.descricao} — ${fmtBRL(l.custoMedioMensalCents)}/mês (${fmtPercent(l.participacaoPercent)} do custo). ` +
        `${ROTULO_CLASSIFICACAO[l.classificacao]}. Economia anual estimada: ${fmtBRL(l.economiaAnualEstimadaCents)}.`
    )
    .join(" ");
}
