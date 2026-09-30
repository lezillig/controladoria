import type { OmieContrato } from "@prisma/client";
import { LINHAS_DRE, type ChaveDre } from "./dre";
import { ultimoMesFechado } from "./periodos";
import { contratoAtivo } from "@/lib/omie/mapping";
import { mediana } from "./agents/comum";

// PROJEÇÃO, CENÁRIOS E ORÇAMENTO — a parte pura.
//
// O sistema projetava caixa (títulos já lançados, até 90 dias) e nunca
// resultado. Este módulo projeta o DRE gerencial doze meses à frente, na
// mesma estrutura de LINHAS_DRE que as telas já mostram, a partir de três
// coisas que já existem: a série realizada por linha do DRE, os contratos de
// serviço da Omie e premissas declaradas por uma pessoa.
//
// Três regras sustentam tudo e valem estar escritas:
//
// 1. SÓ MÊS FECHADO É BASE. O mês em curso está pela metade e, somado como
//    se fosse inteiro, puxa qualquer média para baixo e qualquer tendência
//    para a queda. A base termina no último mês fechado; o mês corrente é o
//    primeiro mês PROJETADO, e a tela diz isso.
//
// 2. SAZONALIDADE ANTES DE TENDÊNCIA. Transporte escolar e fretamento têm
//    janeiro e julho diferentes do resto do ano; uma média de doze meses
//    erraria justamente nesses. O ponto de partida de cada mês é o MESMO MÊS
//    DO ANO ANTERIOR, corrigido pela tendência dos últimos doze meses fechados
//    contra os doze anteriores. Um mês fora da curva na base é aparado pelo
//    MAD antes de servir de referência — o pico não vira previsão.
//
// 3. PREMISSA É DECLARADA, NUNCA EMBUTIDA. Cada ajuste é uma linha do DRE, um
//    percentual e um mês de início (e fim, opcional). O resultado carrega a
//    lista do que foi aplicado, e um cenário sem premissa é a projeção base.
//
// Nada aqui toca o banco. `projecaoNoBanco.ts` colhe a série; os testes em
// scripts/teste-projecao.ts exercitam cada regra número a número.

export type Competencia = string; // "AAAA-MM"

export function competenciaDe(d: Date): Competencia {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function somarMeses(c: Competencia, n: number): Competencia {
  const [ano, mes] = c.split("-").map(Number);
  return competenciaDe(new Date(ano, mes - 1 + n, 1));
}

export function inicioDaCompetencia(c: Competencia): Date {
  const [ano, mes] = c.split("-").map(Number);
  return new Date(ano, mes - 1, 1);
}

export function fimDaCompetencia(c: Competencia): Date {
  const [ano, mes] = c.split("-").map(Number);
  return new Date(ano, mes, 0, 23, 59, 59, 999);
}

const ROTULO_MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export function rotuloDaCompetencia(c: Competencia): string {
  const [ano, mes] = c.split("-").map(Number);
  return `${ROTULO_MES[mes - 1]}/${String(ano).slice(2)}`;
}

// A ÚLTIMA COMPETÊNCIA FECHADA na data de referência: no dia 22 de setembro
// é agosto; no dia 30 de setembro é o próprio setembro.
export function ultimaCompetenciaFechada(dataReferencia: Date): Competencia {
  return competenciaDe(ultimoMesFechado(dataReferencia).inicio);
}

// Os meses do horizonte: do mês seguinte ao último fechado (que é o mês em
// curso, ou o seguinte se a referência é o último dia) por `quantidade` meses.
export function mesesDoHorizonte(dataReferencia: Date, quantidade = 12): Competencia[] {
  const primeiro = somarMeses(ultimaCompetenciaFechada(dataReferencia), 1);
  return Array.from({ length: quantidade }, (_, i) => somarMeses(primeiro, i));
}

// ---------------------------------------------------------------- base

// A série realizada de UMA linha do DRE: competência → centavos, no sinal da
// linha (despesa positiva, como LinhaDreAnual.porMes).
export type SerieDaLinha = Map<Competencia, number>;

export type BaseHistorica = {
  porLinha: Map<ChaveDre, SerieDaLinha>;
  ultimaCompetenciaFechada: Competencia;
  // Todas as competências fechadas presentes na base, em ordem.
  competencias: Competencia[];
};

// Corta tudo depois do último mês fechado. É a regra 1 aplicada de uma vez,
// na entrada, para nenhuma leitura abaixo precisar lembrar dela.
export function apenasFechadas(porLinha: Map<ChaveDre, SerieDaLinha>, dataReferencia: Date): BaseHistorica {
  const ultima = ultimaCompetenciaFechada(dataReferencia);
  const competencias = new Set<Competencia>();
  const cortada = new Map<ChaveDre, SerieDaLinha>();
  for (const [linha, serie] of porLinha) {
    const s: SerieDaLinha = new Map();
    for (const [c, v] of serie) {
      if (c <= ultima) {
        s.set(c, v);
        competencias.add(c);
      }
    }
    cortada.set(linha, s);
  }
  return { porLinha: cortada, ultimaCompetenciaFechada: ultima, competencias: [...competencias].sort() };
}

// ---------------------------------------------------------------- baseline

export type MetodoBaseline = "SAZONAL_COM_TENDENCIA" | "SAZONAL" | "MEDIANA" | "SEM_BASE";

export type Baseline = {
  valorCents: number;
  metodo: MetodoBaseline;
  // O que entrou na conta, para a tela e o parecer mostrarem de onde veio.
  mesmoMesAnoAnteriorCents: number | null;
  aparadoCents: number | null; // o mesmo mês depois do corte pelo MAD
  tendencia: number | null; // 1,08 = os últimos doze fechados somam 8% mais que os doze anteriores
  mesesDeBase: number;
};

const MESES_PARA_SAZONALIDADE = 12;
const MESES_MINIMOS_PARA_MEDIANA = 3;
const LARGURA_DO_CORTE_EM_MAD = 3;

// Os últimos `n` meses fechados até `ate` (inclusive), do mais antigo ao mais
// recente. Mês sem linha na série vale zero: mês sem movimento é zero, não é
// buraco — o DRE anual faz o mesmo.
function janela(serie: SerieDaLinha, ate: Competencia, n: number): number[] {
  return Array.from({ length: n }, (_, i) => serie.get(somarMeses(ate, -(n - 1 - i))) ?? 0);
}

// Aparar um valor pela faixa mediana ± k·MAD da janela. MAD zero (série
// constante) não apara nada — não há dispersão para medir extremo.
function aparar(valor: number, janelaDeReferencia: number[]): number {
  if (janelaDeReferencia.length === 0) return valor;
  const med = mediana(janelaDeReferencia);
  const mad = mediana(janelaDeReferencia.map((v) => Math.abs(v - med)));
  if (mad === 0) return valor;
  const teto = med + LARGURA_DO_CORTE_EM_MAD * mad;
  const piso = med - LARGURA_DO_CORTE_EM_MAD * mad;
  return Math.min(teto, Math.max(piso, valor));
}

export function baselineSazonal(serie: SerieDaLinha, mesAlvo: Competencia, base: Pick<BaseHistorica, "ultimaCompetenciaFechada" | "competencias">): Baseline {
  const ultima = base.ultimaCompetenciaFechada;
  const primeira = base.competencias[0];
  const mesesDeBase = primeira ? mesesEntre(primeira, ultima) + 1 : 0;
  const semBase: Baseline = { valorCents: 0, metodo: "SEM_BASE", mesmoMesAnoAnteriorCents: null, aparadoCents: null, tendencia: null, mesesDeBase };

  // Linha sem nenhum movimento na base não tem padrão a repetir: é SEM_BASE,
  // e não "sazonal igual a zero" — a tela precisa distinguir "não há dado" de
  // "o dado é zero".
  let temMovimento = false;
  for (const [c, v] of serie) {
    if (c <= ultima && v !== 0) {
      temMovimento = true;
      break;
    }
  }
  if (!temMovimento) return semBase;

  const mesmoMes = somarMeses(mesAlvo, -12);
  const temMesmoMes = primeira !== undefined && mesmoMes >= primeira && mesmoMes <= ultima;

  if (temMesmoMes && mesesDeBase >= MESES_PARA_SAZONALIDADE) {
    const ultimos12 = janela(serie, ultima, 12);
    const bruto = serie.get(mesmoMes) ?? 0;
    // O corte usa os doze meses fechados mais recentes como faixa — é neles
    // que o padrão atual está.
    const aparado = Math.round(aparar(bruto, ultimos12));

    const anteriores12 = janela(serie, somarMeses(ultima, -12), 12);
    const temDoisAnos = mesesDeBase >= 24;
    const somaAnterior = anteriores12.reduce((a, b) => a + b, 0);
    const somaAtual = ultimos12.reduce((a, b) => a + b, 0);
    const tendencia = temDoisAnos && somaAnterior > 0 ? somaAtual / somaAnterior : null;

    return {
      valorCents: Math.round(aparado * (tendencia ?? 1)),
      metodo: tendencia === null ? "SAZONAL" : "SAZONAL_COM_TENDENCIA",
      mesmoMesAnoAnteriorCents: bruto,
      aparadoCents: aparado,
      tendencia,
      mesesDeBase,
    };
  }

  if (mesesDeBase >= MESES_MINIMOS_PARA_MEDIANA) {
    const n = Math.min(mesesDeBase, MESES_PARA_SAZONALIDADE);
    return {
      valorCents: Math.round(mediana(janela(serie, ultima, n))),
      metodo: "MEDIANA",
      mesmoMesAnoAnteriorCents: null,
      aparadoCents: null,
      tendencia: null,
      mesesDeBase,
    };
  }

  return semBase;
}

export function mesesEntre(de: Competencia, ate: Competencia): number {
  const [a1, m1] = de.split("-").map(Number);
  const [a2, m2] = ate.split("-").map(Number);
  return (a2 - a1) * 12 + (m2 - m1);
}

// ---------------------------------------------------------------- contratos

export type ReceitaContratada = { cents: number; contratos: number };

// A RECEITA CONTRATADA DE CADA MÊS: a soma do valor mensal dos contratos
// ativos cuja vigência cobre o mês inteiro. Vigência sem fim é contrato em
// curso. A periodicidade de FATURAMENTO (bimestral, trimestral...) não muda a
// receita de COMPETÊNCIA: o serviço é prestado todo mês e `nValTotMes` já é o
// valor mensal — o que muda é o caixa, e caixa não é o que esta projeção
// mostra. Contrato sem valor não projeta nada.
export function receitaContratadaPorMes(contratos: OmieContrato[], meses: Competencia[]): Map<Competencia, ReceitaContratada> {
  const resultado = new Map<Competencia, ReceitaContratada>();
  for (const mes of meses) {
    const inicio = inicioDaCompetencia(mes);
    // O fim da vigência vem da Omie como DATA (meia-noite do último dia), então
    // "cobre o mês" é: começa até o dia 1º e termina no último dia ou depois.
    const ultimoDia = new Date(inicio.getFullYear(), inicio.getMonth() + 1, 0);
    let cents = 0;
    let quantos = 0;
    for (const c of contratos) {
      if (!contratoAtivo(c.situacao) || c.valorMensalCents <= 0) continue;
      if (c.vigenciaInicio !== null && c.vigenciaInicio > inicio) continue;
      if (c.vigenciaFim !== null && c.vigenciaFim < ultimoDia) continue;
      cents += c.valorMensalCents;
      quantos += 1;
    }
    resultado.set(mes, { cents, contratos: quantos });
  }
  return resultado;
}

// ---------------------------------------------------------------- cenário

export type Premissa = {
  linha: ChaveDre;
  // +15 = a linha sobe 15% a partir de `desde`; -10 = cai 10%.
  percentual: number;
  desde: Competencia;
  ate?: Competencia | null;
  descricao?: string | null;
};

export type BaseReceita = "HISTORICA" | "CONTRATADA";

export type Cenario = {
  premissas: Premissa[];
  // De onde sai a RECEITA_BRUTA projetada: da série (sazonal) ou dos
  // contratos ativos. Com CONTRATADA, um mês sem contrato ativo cai na série
  // — e a linha diz de onde veio cada mês.
  baseReceita: BaseReceita;
};

const CENARIO_BASE: Cenario = { premissas: [], baseReceita: "HISTORICA" };

export const LINHAS_DE_GRUPO = LINHAS_DRE.filter((l) => l.tipo === "GRUPO").map((l) => l.chave) as ChaveDre[];

export function ehLinhaDeGrupo(linha: string): linha is ChaveDre {
  return (LINHAS_DE_GRUPO as string[]).includes(linha);
}

export type LinhaProjetada = {
  chave: ChaveDre;
  rotulo: string;
  tipo: "GRUPO" | "SUBTOTAL";
  porMes: number[];
  totalCents: number;
  // Por mês: como o valor foi obtido. Subtotal não tem método.
  metodos: (MetodoBaseline | "CONTRATADA")[];
  // Por mês: o valor antes das premissas (a projeção base), para a tela
  // mostrar base, cenário e diferença lado a lado.
  basePorMes: number[];
};

export type Projecao = {
  meses: { competencia: Competencia; rotulo: string }[];
  linhas: LinhaProjetada[];
  receitaContratada: ReceitaContratada[];
  baselineReceita: Baseline[];
  premissasAplicadas: Premissa[];
  baseReceita: BaseReceita;
  base: { ultimaCompetenciaFechada: Competencia; mesesDeBase: number; primeiraCompetencia: Competencia | null };
  // Os três números que decidem, somados no horizonte.
  receitaLiquidaCents: number;
  ebitCents: number;
  resultadoLiquidoCents: number;
};

function fatorDasPremissas(premissas: Premissa[], linha: ChaveDre, mes: Competencia): number {
  let fator = 1;
  for (const p of premissas) {
    if (p.linha !== linha) continue;
    if (mes < p.desde) continue;
    if (p.ate && mes > p.ate) continue;
    fator *= 1 + p.percentual / 100;
  }
  return fator;
}

// Os subtotais pela ordem e pelo sinal de LINHAS_DRE — a mesma conta de
// montarDreDeInsumos, escrita como soma acumulada: grupo soma com o sinal,
// subtotal lê o acumulado.
export function subtotaisDe(grupos: Map<ChaveDre, number>): Map<ChaveDre, number> {
  const valores = new Map<ChaveDre, number>();
  let acumulado = 0;
  for (const def of LINHAS_DRE) {
    if (def.tipo === "GRUPO") {
      const v = grupos.get(def.chave) ?? 0;
      valores.set(def.chave, v);
      acumulado += def.sinal * v;
    } else {
      valores.set(def.chave, acumulado);
    }
  }
  return valores;
}

export function projetar(
  base: BaseHistorica,
  contratos: OmieContrato[],
  meses: Competencia[],
  cenario: Cenario = CENARIO_BASE
): Projecao {
  const contratada = receitaContratadaPorMes(contratos, meses);
  const serieReceita = base.porLinha.get("RECEITA_BRUTA") ?? new Map();
  const baselineReceita = meses.map((m) => baselineSazonal(serieReceita, m, base));

  const gruposBase: Map<ChaveDre, number>[] = [];
  const metodos = new Map<ChaveDre, (MetodoBaseline | "CONTRATADA")[]>();
  for (const linha of LINHAS_DE_GRUPO) metodos.set(linha, []);

  meses.forEach((mes, i) => {
    const grupos = new Map<ChaveDre, number>();
    for (const linha of LINHAS_DE_GRUPO) {
      const serie = base.porLinha.get(linha) ?? new Map();
      let b: Baseline | null = null;
      let valor: number;
      let metodo: MetodoBaseline | "CONTRATADA";
      if (linha === "RECEITA_BRUTA") {
        b = baselineReceita[i];
        const c = contratada.get(mes);
        if (cenario.baseReceita === "CONTRATADA" && c && c.cents > 0) {
          valor = c.cents;
          metodo = "CONTRATADA";
        } else {
          valor = b.valorCents;
          metodo = b.metodo;
        }
      } else {
        b = baselineSazonal(serie, mes, base);
        valor = b.valorCents;
        metodo = b.metodo;
      }
      grupos.set(linha, valor);
      metodos.get(linha)!.push(metodo);
    }
    gruposBase.push(grupos);
  });

  const gruposCenario = gruposBase.map((grupos, i) => {
    const ajustados = new Map<ChaveDre, number>();
    for (const [linha, v] of grupos) ajustados.set(linha, Math.round(v * fatorDasPremissas(cenario.premissas, linha, meses[i])));
    return ajustados;
  });

  const porMesBase = gruposBase.map(subtotaisDe);
  const porMesCenario = gruposCenario.map(subtotaisDe);

  const linhas: LinhaProjetada[] = LINHAS_DRE.map((def) => {
    const porMes = porMesCenario.map((m) => m.get(def.chave) ?? 0);
    return {
      chave: def.chave,
      rotulo: def.rotulo,
      tipo: def.tipo,
      porMes,
      totalCents: porMes.reduce((a, b) => a + b, 0),
      metodos: def.tipo === "GRUPO" ? metodos.get(def.chave)! : [],
      basePorMes: porMesBase.map((m) => m.get(def.chave) ?? 0),
    };
  });

  const total = (chave: ChaveDre) => linhas.find((l) => l.chave === chave)?.totalCents ?? 0;

  return {
    meses: meses.map((m) => ({ competencia: m, rotulo: rotuloDaCompetencia(m) })),
    linhas,
    receitaContratada: meses.map((m) => contratada.get(m) ?? { cents: 0, contratos: 0 }),
    baselineReceita,
    premissasAplicadas: cenario.premissas,
    baseReceita: cenario.baseReceita,
    base: {
      ultimaCompetenciaFechada: base.ultimaCompetenciaFechada,
      mesesDeBase: base.competencias.length,
      primeiraCompetencia: base.competencias[0] ?? null,
    },
    receitaLiquidaCents: total("RECEITA_LIQUIDA"),
    ebitCents: total("EBIT"),
    resultadoLiquidoCents: total("RESULTADO_LIQUIDO"),
  };
}

// ---------------------------------------------------------------- sensibilidade

export type Sensibilidade = {
  linha: ChaveDre;
  rotulo: string;
  percentual: number;
  efeitoEbitCents: number;
  efeitoResultadoCents: number;
};

// Quanto o EBIT e o resultado do horizonte mudam se UMA linha variar `p`%
// desde o primeiro mês, mantido o resto do cenário. As linhas de sinal
// negativo têm efeito oposto ao percentual, e é isso que a tabela mostra.
export function sensibilidade(
  base: BaseHistorica,
  contratos: OmieContrato[],
  meses: Competencia[],
  cenario: Cenario,
  linhas: ChaveDre[],
  percentuais: number[] = [-10, 10]
): Sensibilidade[] {
  const referencia = projetar(base, contratos, meses, cenario);
  const saida: Sensibilidade[] = [];
  for (const linha of linhas) {
    const rotulo = LINHAS_DRE.find((l) => l.chave === linha)?.rotulo ?? linha;
    for (const p of percentuais) {
      const variante = projetar(base, contratos, meses, {
        ...cenario,
        premissas: [...cenario.premissas, { linha, percentual: p, desde: meses[0] }],
      });
      saida.push({
        linha,
        rotulo,
        percentual: p,
        efeitoEbitCents: variante.ebitCents - referencia.ebitCents,
        efeitoResultadoCents: variante.resultadoLiquidoCents - referencia.resultadoLiquidoCents,
      });
    }
  }
  return saida;
}

// ---------------------------------------------------------------- orçado × realizado

export type LinhaOrcada = { linha: string; competencia: Competencia; valorCents: number };

export type ComparacaoOrcamento = {
  chave: ChaveDre;
  rotulo: string;
  tipo: "GRUPO" | "SUBTOTAL";
  orcadoCents: number;
  realizadoCents: number;
  desvioCents: number;
  desvioPercent: number | null;
  // Meses fechados do ano que têm orçamento E realizado — é sobre eles que a
  // comparação vale. Orçamento gravado para um mês que ainda não fechou não
  // entra: comparar o mês inteiro orçado com dez dias realizados seria desvio
  // de calendário.
  meses: Competencia[];
};

export function orcadoVersusRealizado(orcamento: LinhaOrcada[], base: BaseHistorica, ano: number): ComparacaoOrcamento[] {
  const orcadoPorLinha = new Map<string, SerieDaLinha>();
  for (const o of orcamento) {
    const s = orcadoPorLinha.get(o.linha) ?? new Map();
    s.set(o.competencia, (s.get(o.competencia) ?? 0) + o.valorCents);
    orcadoPorLinha.set(o.linha, s);
  }
  const mesesComOrcamento = new Set<Competencia>();
  for (const s of orcadoPorLinha.values()) for (const c of s.keys()) mesesComOrcamento.add(c);
  const meses = [...mesesComOrcamento]
    .filter((c) => c.startsWith(`${ano}-`) && c <= base.ultimaCompetenciaFechada)
    .sort();
  if (meses.length === 0) return [];

  const somaNosMeses = (s: SerieDaLinha | undefined) => meses.reduce((a, c) => a + (s?.get(c) ?? 0), 0);
  const gruposOrcado = new Map<ChaveDre, number>();
  const gruposRealizado = new Map<ChaveDre, number>();
  for (const linha of LINHAS_DE_GRUPO) {
    gruposOrcado.set(linha, somaNosMeses(orcadoPorLinha.get(linha)));
    gruposRealizado.set(linha, somaNosMeses(base.porLinha.get(linha)));
  }
  // ORÇAMENTO GRAVADO ANTES DA SEPARAÇÃO DAS PESSOAS. Até a linha de pessoas
  // virar duas (operação e corporativo), toda a folha era
  // orçada em DESPESA_SALARIOS. Comparar esse orçado com o realizado só da
  // operação mostraria uma economia que não existe — do tamanho da folha
  // corporativa. Versão sem nenhuma linha corporativa orçada: o realizado das
  // duas é comparado com o orçado da linha antiga, que é o que ele cobria.
  if (!orcadoPorLinha.has("DESPESA_SALARIOS_CORPORATIVO")) {
    gruposRealizado.set(
      "DESPESA_SALARIOS",
      (gruposRealizado.get("DESPESA_SALARIOS") ?? 0) + (gruposRealizado.get("DESPESA_SALARIOS_CORPORATIVO") ?? 0)
    );
    gruposRealizado.set("DESPESA_SALARIOS_CORPORATIVO", 0);
  }
  const orcado = subtotaisDe(gruposOrcado);
  const realizado = subtotaisDe(gruposRealizado);

  return LINHAS_DRE.map((def) => {
    const o = orcado.get(def.chave) ?? 0;
    const r = realizado.get(def.chave) ?? 0;
    // Desvio no sentido do resultado: numa linha de despesa, gastar menos que
    // o orçado é desvio favorável (positivo).
    const desvio = def.sinal * (r - o);
    return {
      chave: def.chave,
      rotulo: def.rotulo,
      tipo: def.tipo,
      orcadoCents: o,
      realizadoCents: r,
      desvioCents: desvio,
      desvioPercent: o !== 0 ? (desvio / Math.abs(o)) * 100 : null,
      meses,
    };
  });
}
