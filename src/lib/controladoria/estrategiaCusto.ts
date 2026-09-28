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
// Seis, e não quatro: a medida de acoplamento compara duas metades, e com
// quatro meses são duas contra duas — qualquer fatura bimestral (IPVA, seguro)
// vira "descolado". Três contra três é o mínimo para a comparação dizer algo.
const MINIMO_MESES_ANALISE = 6;
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

// AS SÉRIES QUE A ANÁLISE CONSOME, separadas de onde elas são lidas.
//
// Mesma separação do DRE, e pela mesma medida: a análise precisa de doze meses
// de custo por categoria, e lê-los como LINHAS custa cinquenta vezes o que
// custa somá-los no banco. `seriesMensais` colhe da memória (é o que o agente
// de oportunidades usa, dentro do ciclo, sobre o contexto já carregado);
// `estrategiaCustoNoBanco.ts` colhe em SQL, para a tela. A análise em si é uma
// função só, e há teste diferencial exigindo o mesmo resultado das duas.
export type SeriesDeCusto = {
  meses: string[];
  porCategoria: Map<string, Map<string, number>>;
  // A receita POR CATEGORIA e mês, e não só por mês: é o que permite medir o
  // acoplamento contra a receita de SERVIÇO (linha RECEITA_BRUTA do DRE) em
  // vez de contra tudo que entra — venda de veículo e resgate de consórcio
  // inflavam a "receita" contra a qual o custo era medido.
  receitaPorCategoria: Map<string, Map<string, number>>;
};

// AS LINHAS DO DRE QUE NÃO SE CORTAM POR NEGOCIAÇÃO. Parcela de consórcio,
// financiamento e tributo entravam no Pareto como "custo" — e a parcela do
// ônibus, uma das maiores categorias, saía rotulada "estrutura: renegociar,
// cote com dois concorrentes". Ficam fora da fila e são listadas à parte.
const LINHAS_FORA_DO_CORTE = new Set([
  "FINANCIAMENTO_INVESTIMENTO",
  "TRIBUTO_SOBRE_LUCRO",
  "DEDUCOES",
  "RECEITA_BRUTA",
  "RECEITA_FINANCEIRA",
  "OUTRAS_RECEITAS",
]);

export const chaveMes = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

// A JANELA DA ANÁLISE: doze meses terminando no mês da data de referência, e o
// último mês vai só até o dia da referência. Uma função só, usada pelas duas
// colheitas — duas contagens de mês divergiriam na virada do ano.
//
// O MÊS EM CURSO FICA DE FORA. Ele entrava pela metade, encurtava a segunda
// metade da comparação e fazia todo custo parecer em queda — ou, no dia 3,
// desaparecido. A janela termina no último mês fechado; quando a referência é
// o último dia do mês, o próprio mês conta.
export function janelaDeAnalise(dataReferencia: Date): { primeiroMes: Date; meses: string[]; fim: Date } {
  const ultimoDia = new Date(dataReferencia.getFullYear(), dataReferencia.getMonth() + 1, 0).getDate();
  const mesFechado =
    dataReferencia.getDate() >= ultimoDia
      ? inicioDoMes(dataReferencia)
      : inicioDoMes(new Date(dataReferencia.getFullYear(), dataReferencia.getMonth() - 1, 1));
  const primeiroMes = inicioDoMes(new Date(mesFechado.getFullYear(), mesFechado.getMonth() - (MESES_ANALISE - 1), 1));
  const meses: string[] = [];
  for (let i = 0; i < MESES_ANALISE; i++) {
    const d = new Date(primeiroMes.getFullYear(), primeiroMes.getMonth() + i, 1);
    if (d > mesFechado) break;
    meses.push(chaveMes(d));
  }
  // Fim da janela: o último instante do último mês fechado.
  const fim = new Date(mesFechado.getFullYear(), mesFechado.getMonth() + 1, 0, 23, 59, 59, 999);
  return { primeiroMes, meses, fim };
}

function seriesMensais(ctx: ContextoAuditoria): SeriesDeCusto {
  const { primeiroMes, meses, fim } = janelaDeAnalise(ctx.dataReferencia);

  const porCategoria = new Map<string, Map<string, number>>();
  for (const t of titulosAtivos(ctx, "PAGAR")) {
    const competencia = dataDeCompetencia(t);
    if (competencia < primeiroMes || competencia > fim) continue;
    const categoria = t.categoriaCodigo ?? "SEM_CATEGORIA";
    const mes = chaveMes(competencia);
    const serie = porCategoria.get(categoria) ?? new Map<string, number>();
    serie.set(mes, (serie.get(mes) ?? 0) + t.valorDocumentoCents);
    porCategoria.set(categoria, serie);
  }

  const receitaPorCategoria = new Map<string, Map<string, number>>();
  for (const t of titulosAtivos(ctx, "RECEBER")) {
    const competencia = dataDeCompetencia(t);
    if (competencia < primeiroMes || competencia > fim) continue;
    const categoria = t.categoriaCodigo ?? "SEM_CATEGORIA";
    const mes = chaveMes(competencia);
    const serie = receitaPorCategoria.get(categoria) ?? new Map<string, number>();
    serie.set(mes, (serie.get(mes) ?? 0) + t.valorDocumentoCents);
    receitaPorCategoria.set(categoria, serie);
  }

  return { meses, porCategoria, receitaPorCategoria };
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

  // MÉDIA MENSAL de cada metade, e não a soma: com nove meses são quatro
  // contra cinco, e a soma dizia que um custo perfeitamente fixo subiu 25%.
  const meio = Math.floor(serie.length / 2);
  const mediaCusto = (parte: SerieMensal[]) => (parte.length > 0 ? somar(parte, (p) => p.custo) / parte.length : 0);
  const mediaReceita = (parte: SerieMensal[]) => (parte.length > 0 ? somar(parte, (p) => p.receita) / parte.length : 0);

  const custoAntes = mediaCusto(serie.slice(0, meio));
  const custoDepois = mediaCusto(serie.slice(meio));
  const receitaAntes = mediaReceita(serie.slice(0, meio));
  const receitaDepois = mediaReceita(serie.slice(meio));

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

export type AnaliseDeCusto = {
  linhas: LinhaEstrategia[];
  custoTotalMensalCents: number;
  economiaAnualTotalCents: number;
  mesesAnalisados: number;
  baseSuficiente: boolean;
  // O que saiu da fila por ser financiamento, tributo ou receita — dito, e
  // não escondido: quem lê "onde cortar" precisa saber que a parcela do
  // ônibus não está na lista porque não se negocia por cotação.
  foraDoCorte: { codigo: string; descricao: string; linha: string; custoMedioMensalCents: number }[];
};

// `linhaPorCategoria` é a classificação do DRE (confirmada ou proposta) de
// cada categoria. Sem ela, tudo entra — é o comportamento dos testes de
// função pura; com ela, financiamento, tributo e receita saem da fila e a
// receita de referência passa a ser só a de serviço.
export function analisarEstrategiaDeCusto(ctx: ContextoAuditoria, linhaPorCategoria?: Map<string, string>): AnaliseDeCusto {
  return analisarEstrategiaDeSeries(
    seriesMensais(ctx),
    new Map(ctx.categorias.map((c) => [c.codigo, c.descricao])),
    linhaPorCategoria
  );
}

export function analisarEstrategiaDeSeries(
  series: SeriesDeCusto,
  descricaoPorCodigo: Map<string, string>,
  linhaPorCategoria?: Map<string, string>
): AnaliseDeCusto {
  const { meses, porCategoria, receitaPorCategoria } = series;
  const descricaoDe = (codigo: string) =>
    codigo === "SEM_CATEGORIA" ? "Sem categoria" : descricaoPorCodigo.get(codigo) ?? `Categoria ${codigo}`;

  // A RECEITA DE REFERÊNCIA: só a de serviço quando a classificação é
  // conhecida; tudo que entra quando não é.
  const receitaPorMes = new Map<string, number>();
  for (const [codigo, serie] of receitaPorCategoria) {
    const linha = linhaPorCategoria?.get(codigo);
    if (linhaPorCategoria && linha && linha !== "RECEITA_BRUTA") continue;
    for (const [mes, valor] of serie) receitaPorMes.set(mes, (receitaPorMes.get(mes) ?? 0) + valor);
  }

  const foraDoCorte: AnaliseDeCusto["foraDoCorte"] = [];
  const linhasBrutas = [...porCategoria.entries()]
    .filter(([codigo, serieCusto]) => {
      const custoTotal = somar(meses, (mes) => serieCusto.get(mes) ?? 0);
      // Categoria só com meses fora da janela (o corrente, parcial) não é
      // custo da série: fica de fora em vez de aparecer zerada.
      if (custoTotal === 0) return false;
      const linha = linhaPorCategoria?.get(codigo);
      if (linha && LINHAS_FORA_DO_CORTE.has(linha)) {
        foraDoCorte.push({ codigo, descricao: descricaoDe(codigo), linha, custoMedioMensalCents: Math.round(custoTotal / Math.max(1, meses.length)) });
        return false;
      }
      return true;
    })
    .map(([codigo, serieCusto]) => {
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
      descricao: descricaoDe(codigo),
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
    foraDoCorte: foraDoCorte.sort((a, b) => b.custoMedioMensalCents - a.custoMedioMensalCents),
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
