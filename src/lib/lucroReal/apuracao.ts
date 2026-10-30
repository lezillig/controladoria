import { LINHAS_DRE, type TituloDoDre } from "../controladoria/dre";
import type { HorasDeOperacao } from "../gestao/leitura";
import { ALIQUOTAS, tipoDaCategoria, type TipoDeGasto } from "./catalogo";

// A APURAÇÃO ESTIMADA DO LUCRO REAL — a conta, sem banco.
//
// Do resultado gerencial (o mesmo da tela de Custos e DRE) ao lucro real, em
// três degraus, como no e-Lalur:
//
//   1. o LUCRO CONTÁBIL que a contabilidade de competência apuraria: tira o
//      que o gerencial lança como despesa e não é (IRPJ/CSLL, bem do ativo,
//      parcela de financiamento) e põe o que ele não lança (a depreciação da
//      frota, os encargos da folha que sai do Simples);
//   2. as ADIÇÕES: despesa real que a lei não aceita (multa de trânsito,
//      brinde, provisão, despesa de sócio, doação acima do limite);
//   3. o LUCRO REAL, e sobre ele IRPJ (15% + 10% acima de R$ 240 mil no ano) e
//      CSLL (9%).
//
// E o Presumido da mesma receita ao lado, para a comparação que decide.
//
// É ESTIMATIVA PARA DECIDIR, NÃO APURAÇÃO. A base é o espelho da Omie por
// competência dos títulos, sem os lançamentos que só a contabilidade faz. O
// número que vale é o do e-Lalur que a contabilidade fechar; este diz para onde
// ele vai e o que mexe nele.

export type ItemApuracao = {
  // Os maiores títulos da categoria no período (os do DRE), para o drill-down.
  titulos?: TituloDoDre[];
  totalDeTitulos?: number;
  chave: string;
  descricao: string;
  linha: string;
  valorCents: number;
  ehReceita: boolean;
  // De onde veio: da Azul, ou o custo de pessoas da MCZ, que passa para a Azul.
  origem: "EMPRESA" | "PESSOAS_CORPORATIVA";
};

export type DocumentacaoAgregada = {
  chave: string;
  descricao: string;
  pj: boolean;
  pf: boolean;
  semDocumentoFiscal: boolean;
  semBeneficiario: boolean;
  semRetencao: boolean;
  cents: number;
  quantidade: number;
};

export type TituloComPendencia = {
  id: string;
  data: Date;
  parceiro: string | null;
  documento: string | null;
  chave: string;
  descricao: string;
  numeroDocumento: string | null;
  valorCents: number;
  retencaoCents: number;
};

export type MovimentoSemCausa = { data: Date; valorCents: number; texto: string };

export type FaixaDeCredito = { cents: number; quantidade: number };

export type InsumosLucroReal = {
  empresa: string;
  corporativa: string | null;
  itens: ItemApuracao[];
  // Da corporativa, o que não é pessoas e por isso fica fora.
  corporativaForaCents: number;
  intercompanyEliminado: { receitaCents: number; despesaCents: number };
  documentacao: DocumentacaoAgregada[];
  titulosComPendencia: TituloComPendencia[];
  extratoSemCausa: { cents: number; quantidade: number; maiores: MovimentoSemCausa[] };
  recebiveisVencidos: { ate15mil: FaixaDeCredito; de15a100mil: FaixaDeCredito; acima100mil: FaixaDeCredito };
  frota: {
    veiculos: number;
    semValor: number;
    custoCents: number;
    depreciacao20Cents: number;
    depreciacao25Cents: number;
    // Veículo a veículo, para o drill-down da depreciação (e a lista do que falta).
    detalhe?: VeiculoDepreciado[];
    placasSemValor?: string[];
  } | null;
  horas: HorasDeOperacao | null;
  // De onde vieram: o balanço lançado em Indicadores e a TJLP do Banco
  // Central, ou o que alguém digitou na tela por cima.
  jcp: { plCents: number | null; tjlp: number | null; fontePl?: string | null; fonteTjlp?: string | null };
};

export type VeiculoDepreciado = { placa: string; dataCompra: Date; custoCents: number; depreciacaoCents: number };

// Uma categoria aberta até os títulos: o degrau do drill-down.
export type CategoriaDetalhada = {
  descricao: string;
  cents: number;
  origem: ItemApuracao["origem"];
  titulos: TituloDoDre[];
  totalDeTitulos: number;
};

export type Ajuste = {
  codigo: string;
  rotulo: string;
  cents: number;
  explicacao: string;
  // O que compõe o ajuste: as categorias (até os títulos) ou os veículos.
  categorias?: CategoriaDetalhada[];
  veiculos?: VeiculoDepreciado[];
  placasSemValor?: string[];
};

export type GastoPorTipo = {
  tipo: TipoDeGasto;
  cents: number;
  categorias: CategoriaDetalhada[];
};

export type Pendencia = {
  codigo: string;
  titulo: string;
  risco: string;
  baseLegal: string;
  cents: number;
  quantidade: number;
  maiores: { data: Date; parceiro: string | null; categoria: string; valorCents: number; detalhe: string }[];
};

export type Natureza = "PERMANENTE" | "ANTECIPA" | "DIRECIONA" | "PROTEGE" | "REDUZ_CUSTO" | "CUSTO_NOVO";
export const ROTULO_NATUREZA: Record<Natureza, string> = {
  PERMANENTE: "Economia permanente",
  ANTECIPA: "Antecipa dedução",
  DIRECIONA: "Direciona imposto devido",
  PROTEGE: "Protege dedução",
  REDUZ_CUSTO: "Reduz o gasto",
  CUSTO_NOVO: "Custo novo",
};

export type Oportunidade = {
  codigo: string;
  titulo: string;
  natureza: Natureza;
  // Imposto (IRPJ + CSLL) a menos por ano, quando dá para estimar.
  economiaCents: number | null;
  como: string;
  requisitos: string[];
  baseLegal: string;
  conferir: boolean;
};

export type Impostos = { baseCents: number; irpjCents: number; adicionalCents: number; csllCents: number; totalCents: number };

export type RelatorioLucroReal = {
  receitaBrutaCents: number;
  outrasReceitasCents: number;
  lucroGerencialCents: number;
  ajustesDaBase: Ajuste[];
  lucroContabilCents: number;
  adicoes: Ajuste[];
  lucroRealCents: number;
  real: Impostos;
  presumido: Impostos & { disponivel: boolean; baseCsllCents: number };
  porTipo: GastoPorTipo[];
  // O resultado gerencial aberto pelas linhas do DRE, com sinal (receita
  // soma, despesa subtrai), cada uma até as categorias e os títulos.
  composicaoGerencial: { chave: string; rotulo: string; cents: number; categorias: CategoriaDetalhada[] }[];
  emDiscussao: GastoPorTipo[];
  pendencias: Pendencia[];
  oportunidades: Oportunidade[];
  coberturaDocumental: { comNotaCents: number; exigeNotaCents: number } | null;
};

const LINHAS_ACIMA_DO_LAIR = new Set(
  LINHAS_DRE.slice(0, LINHAS_DRE.findIndex((l) => l.chave === "LAIR"))
    .filter((l) => l.tipo === "GRUPO")
    .map((l) => l.chave as string)
);
const LINHAS_DE_RECEITA_OUTRAS = new Set(["OUTRAS_RECEITAS", "RECEITA_FINANCEIRA"]);

const efeito = (i: ItemApuracao) => (i.ehReceita ? Math.abs(i.valorCents) : -Math.abs(i.valorCents));
const pct = (cents: number, p: number) => Math.round(cents * p);

export function impostosDoReal(baseCents: number): Impostos {
  const base = Math.max(0, baseCents);
  const irpjCents = pct(base, ALIQUOTAS.irpj);
  const adicionalCents = pct(Math.max(0, base - ALIQUOTAS.limiteAdicionalAnoCents), ALIQUOTAS.adicionalIrpj);
  const csllCents = pct(base, ALIQUOTAS.csll);
  return { baseCents, irpjCents, adicionalCents, csllCents, totalCents: irpjCents + adicionalCents + csllCents };
}

// O Presumido do transporte de passageiros, com o acréscimo da LC 224/2025
// sobre a receita do ano acima de R$ 5 milhões. As demais receitas
// (financeiras, outras) entram inteiras na base.
export function impostosDoPresumido(receitaBrutaCents: number, outrasCents: number) {
  const receita = Math.max(0, receitaBrutaCents);
  const excesso = Math.max(0, receita - ALIQUOTAS.limiteAcrescimoAnoCents);
  const outras = Math.max(0, outrasCents);
  const baseIrpj = pct(receita, ALIQUOTAS.presuncaoIrpj) + pct(excesso, ALIQUOTAS.presuncaoIrpj * ALIQUOTAS.acrescimoPresuncao) + outras;
  const baseCsll = pct(receita, ALIQUOTAS.presuncaoCsll) + pct(excesso, ALIQUOTAS.presuncaoCsll * ALIQUOTAS.acrescimoPresuncao) + outras;
  const irpjCents = pct(baseIrpj, ALIQUOTAS.irpj);
  const adicionalCents = pct(Math.max(0, baseIrpj - ALIQUOTAS.limiteAdicionalAnoCents), ALIQUOTAS.adicionalIrpj);
  const csllCents = pct(baseCsll, ALIQUOTAS.csll);
  return { baseCents: baseIrpj, baseCsllCents: baseCsll, irpjCents, adicionalCents, csllCents, totalCents: irpjCents + adicionalCents + csllCents };
}

// O coeficiente do art. 323 do RIR/2018 pelas horas diárias.
export function coeficienteDeTurnos(horas: number): number {
  if (horas > 16) return 2;
  if (horas > 8) return 1.5;
  return 1;
}

const PESSOAS_SALARIO = /sal[áa]rio|folha|f[ée]rias|13[ºo°]?|d[ée]cimo|rescis|horas? extra|adicional|pr[óo][- ]?labore|aviso pr[ée]vio/i;
const ENCARGO_PATRONAL = /\binss\b|\bcpp\b|previd|\bgps\b|patronal/i;
const ALIMENTACAO = /aliment|refei|\bv[ar]\b|cesta/i;
const TIPOS_PF_COM_RETENCAO = new Set(["SERVICOS_TERCEIROS", "ALUGUEL", "MANUTENCAO", "OUTRAS_OPERACIONAIS", "TI_MATERIAL", "PROPAGANDA"]);

export function apurarLucroReal(ins: InsumosLucroReal): RelatorioLucroReal {
  const tipoDe = new Map<string, TipoDeGasto>();
  const linhaDe = new Map<string, string>();
  for (const i of ins.itens) {
    linhaDe.set(i.chave, i.linha);
    if (!tipoDe.has(i.chave)) tipoDe.set(i.chave, tipoDaCategoria(i.descricao, i.linha));
  }
  const tipoDaChave = (chave: string, descricao: string) => tipoDe.get(chave) ?? tipoDaCategoria(descricao, linhaDe.get(chave) ?? null);

  const acima = ins.itens.filter((i) => LINHAS_ACIMA_DO_LAIR.has(i.linha));
  const soma = (lista: ItemApuracao[]) => lista.reduce((a, i) => a + efeito(i), 0);
  const receitaBrutaCents = soma(acima.filter((i) => i.linha === "RECEITA_BRUTA"));
  const outrasReceitasCents = soma(acima.filter((i) => LINHAS_DE_RECEITA_OUTRAS.has(i.linha)));
  const lucroGerencialCents = soma(acima);

  // Despesas (lado de saída) acima do LAIR, por tipo.
  const despesasAcima = acima.filter((i) => !i.ehReceita);
  const doTipo = (codigos: string[]) => despesasAcima.filter((i) => codigos.includes(tipoDaChave(i.chave, i.descricao).codigo));
  const somaDoTipo = (codigos: string[]) => doTipo(codigos).reduce((a, i) => a + Math.abs(i.valorCents), 0);

  const composicaoGerencial = LINHAS_DRE.filter((l) => LINHAS_ACIMA_DO_LAIR.has(l.chave))
    .map((l) => {
      const daLinha = acima.filter((i) => i.linha === l.chave);
      return { chave: l.chave as string, rotulo: l.rotulo as string, cents: soma(daLinha), categorias: detalhar(daLinha, true) };
    })
    .filter((l) => l.categorias.length > 0);

  // ---- 1. Do gerencial ao contábil ----
  const ajustesDaBase: Ajuste[] = [];
  const empurrar = (lista: Ajuste[], a: Ajuste) => {
    if (a.cents !== 0) lista.push(a);
  };
  empurrar(ajustesDaBase, {
    codigo: "IRPJ_CSLL",
    rotulo: "(+) IRPJ e CSLL lançados como despesa",
    cents: somaDoTipo(["IRPJ_CSLL"]),
    categorias: detalhar(doTipo(["IRPJ_CSLL"])),
    explicacao: "No Presumido a empresa os mostra como dedução da receita; no Real saem da base e voltam calculados sobre o lucro.",
  });
  empurrar(ajustesDaBase, {
    codigo: "IMOBILIZADO",
    rotulo: "(+) Compra de bens do ativo lançada como despesa",
    cents: somaDoTipo(["IMOBILIZADO"]),
    categorias: detalhar(doTipo(["IMOBILIZADO"])),
    explicacao: "Veículo, máquina e bem durável acima de R$ 1.200 vão para o ativo e entram pela depreciação.",
  });
  empurrar(ajustesDaBase, {
    codigo: "FINANCIAMENTO",
    rotulo: "(+) Parcelas de financiamento lançadas como despesa",
    cents: somaDoTipo(["FINANCIAMENTO", "DISTRIBUICAO"]),
    categorias: detalhar(doTipo(["FINANCIAMENTO", "DISTRIBUICAO"])),
    explicacao: "O principal da dívida e a distribuição de lucro não são despesa. Os juros das parcelas são — ver a oportunidade de separar.",
  });
  if (ins.frota && ins.frota.depreciacao20Cents > 0) {
    ajustesDaBase.push({
      codigo: "DEPRECIACAO",
      rotulo: "(−) Depreciação da frota (20% ao ano)",
      cents: -ins.frota.depreciacao20Cents,
      veiculos: ins.frota.detalhe,
      placasSemValor: ins.frota.placasSemValor,
      explicacao: `${ins.frota.veiculos} veículo(s) com valor de compra na gestão, depreciados a 20% ao ano até o custo.${
        ins.frota.semValor > 0 ? ` ${ins.frota.semValor} sem valor de compra ficaram fora — cada um é depreciação perdida.` : ""
      }`,
    });
  }
  // A folha da corporativa passa para a empresa em 2027 e sai do Simples:
  // se o custo de pessoas dela não traz o INSS patronal, ele passa a existir.
  const pessoasCorp = ins.itens.filter((i) => i.origem === "PESSOAS_CORPORATIVA" && !i.ehReceita);
  const temPatronal = pessoasCorp.some((i) => ENCARGO_PATRONAL.test(i.descricao));
  const salariosCorp = pessoasCorp.filter((i) => PESSOAS_SALARIO.test(i.descricao));
  const baseSalarialCorp = salariosCorp.reduce((a, i) => a + Math.abs(i.valorCents), 0);
  const encargosNovosCents = !temPatronal && baseSalarialCorp > 0 ? pct(baseSalarialCorp, ALIQUOTAS.encargosPatronais) : 0;
  empurrar(ajustesDaBase, {
    codigo: "ENCARGOS_TRANSFERENCIA",
    rotulo: `(−) Encargos patronais da folha que vem da ${ins.corporativa ?? "corporativa"} (estimativa)`,
    cents: -encargosNovosCents,
    categorias: detalhar(salariosCorp),
    explicacao: `Base salarial de ${reais(baseSalarialCorp)} (abaixo). Fora do Simples, a folha paga INSS de 20%, RAT ajustado pelo FAP e terceiros (FPAS 612): cerca de ${decimal(ALIQUOTAS.encargosPatronais * 100)}% sobre a base salarial. Não encontrei INSS patronal no custo de pessoas da ${ins.corporativa ?? "corporativa"}; conferir com a contabilidade.`,
  });
  const lucroContabilCents = lucroGerencialCents + ajustesDaBase.reduce((a, x) => a + x.cents, 0);

  // ---- 2. Adições ----
  const adicoes: Ajuste[] = [];
  const porTipo = agruparPorTipo(despesasAcima, tipoDaChave);
  for (const g of porTipo) {
    if (g.tipo.tratamento !== "ADICAO" || g.tipo.codigo === "IRPJ_CSLL") continue;
    adicoes.push({ codigo: g.tipo.codigo, rotulo: `(+) ${g.tipo.nome}`, cents: g.cents, explicacao: `${g.tipo.baseLegal}.`, categorias: g.categorias });
  }
  const doacoes = somaDoTipo(["DOACOES"]);
  if (doacoes > 0) {
    const limite = pct(Math.max(0, lucroContabilCents + doacoes), 0.02);
    empurrar(adicoes, {
      codigo: "DOACOES",
      rotulo: "(+) Doações acima do limite",
      cents: Math.max(0, doacoes - limite),
      categorias: detalhar(doTipo(["DOACOES"])),
      explicacao: "Lei 9.249/1995, art. 13, § 2º: até 2% do lucro operacional, e só para entidades qualificadas — conferir cada entidade.",
    });
  }
  const lucroRealCents = lucroContabilCents + adicoes.reduce((a, x) => a + x.cents, 0);
  const real = impostosDoReal(lucroRealCents);
  const presumido = {
    ...impostosDoPresumido(receitaBrutaCents, outrasReceitasCents),
    disponivel: receitaBrutaCents + Math.max(0, outrasReceitasCents) <= ALIQUOTAS.limiteObrigatoriedadeCents,
  };

  // Os tipos que dependem do fato: valor exposto, sem ajuste automático.
  const emDiscussao = porTipo.filter((g) => g.tipo.tratamento === "VERIFICAR");

  const { pendencias, coberturaDocumental } = montarPendencias(ins, tipoDaChave);
  const oportunidades = montarOportunidades(ins, {
    real,
    lucroContabilCents,
    multasCents: somaDoTipo(["MULTA_TRANSITO"]),
    alimentacaoCents: despesasAcima
      .filter((i) => tipoDaChave(i.chave, i.descricao).codigo === "BENEFICIOS" && ALIMENTACAO.test(i.descricao))
      .reduce((a, i) => a + Math.abs(i.valorCents), 0),
    parcelasCents: ins.itens
      .filter((i) => i.linha === "FINANCIAMENTO_INVESTIMENTO" && !i.ehReceita)
      .reduce((a, i) => a + Math.abs(i.valorCents), 0),
    encargosNovosCents,
    pendenciasCents: pendencias.reduce((a, p) => a + p.cents, 0),
  });

  return {
    receitaBrutaCents,
    outrasReceitasCents,
    lucroGerencialCents,
    ajustesDaBase,
    lucroContabilCents,
    adicoes,
    lucroRealCents,
    real,
    presumido,
    porTipo,
    composicaoGerencial,
    emDiscussao,
    pendencias,
    oportunidades,
    coberturaDocumental,
  };
}

// Cada item como categoria aberta, do maior para o menor. Com sinal, a receita
// soma e a despesa subtrai (a composição do resultado); sem, o valor em módulo.
function detalhar(itens: ItemApuracao[], comSinal = false): CategoriaDetalhada[] {
  return itens
    .map((i) => ({
      descricao: i.descricao,
      cents: comSinal ? efeito(i) : Math.abs(i.valorCents),
      origem: i.origem,
      titulos: i.titulos ?? [],
      totalDeTitulos: i.totalDeTitulos ?? i.titulos?.length ?? 0,
    }))
    .sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents));
}

function agruparPorTipo(itens: ItemApuracao[], tipoDaChave: (chave: string, descricao: string) => TipoDeGasto): GastoPorTipo[] {
  const grupos = new Map<string, GastoPorTipo>();
  for (const i of itens) {
    const tipo = tipoDaChave(i.chave, i.descricao);
    const g = grupos.get(tipo.codigo) ?? { tipo, cents: 0, categorias: [] };
    g.cents += Math.abs(i.valorCents);
    g.categorias.push(...detalhar([i]));
    grupos.set(tipo.codigo, g);
  }
  for (const g of grupos.values()) g.categorias.sort((a, b) => b.cents - a.cents);
  return [...grupos.values()].filter((g) => g.cents !== 0).sort((a, b) => b.cents - a.cents);
}

function montarPendencias(ins: InsumosLucroReal, tipoDaChave: (chave: string, descricao: string) => TipoDeGasto) {
  const regras: {
    codigo: string;
    titulo: string;
    risco: string;
    baseLegal: string;
    casa: (d: { pj: boolean; pf: boolean; semDocumentoFiscal: boolean; semBeneficiario: boolean; semRetencao: boolean }, tipo: TipoDeGasto) => boolean;
    detalhe: (t: TituloComPendencia) => string;
  }[] = [
    {
      codigo: "SEM_NOTA",
      titulo: "Despesa com pessoa jurídica sem número de nota fiscal no título",
      risco: "Sem a nota, a despesa não se comprova e é glosada: o valor volta para a base, com multa de ofício de 75% sobre o imposto.",
      baseLegal: "RIR/2018, art. 311; Decreto-Lei 1.598/1977, art. 9º, § 1º",
      casa: (d, tipo) => !!tipo.exigeNota && d.pj && d.semDocumentoFiscal,
      detalhe: () => "sem número de documento fiscal",
    },
    {
      codigo: "SEM_BENEFICIARIO",
      titulo: "Pagamento sem CPF ou CNPJ do beneficiário",
      risco: "Pagamento a beneficiário não identificado: além de indedutível, sujeito a IRRF de 35% sobre a base reajustada (efetivo de 53,8%).",
      baseLegal: "Lei 8.981/1995, art. 61",
      casa: (d, tipo) => !tipo.semBeneficiarioProprio && d.semBeneficiario,
      detalhe: () => "sem documento do beneficiário",
    },
    {
      codigo: "PF_SEM_RETENCAO",
      titulo: "Serviço ou aluguel de pessoa física sem retenção",
      risco: "Serviço de pessoa física exige RPA com INSS (11% retido e 20% da empresa) e IRRF; aluguel, IRRF pela tabela. Sem isso, a empresa responde pelos tributos que deixou de reter.",
      baseLegal: "Lei 8.212/1991, arts. 22 e 30; RIR/2018 (IRRF de rendimentos do trabalho e de aluguel)",
      casa: (d, tipo) => d.pf && d.semRetencao && TIPOS_PF_COM_RETENCAO.has(tipo.codigo),
      detalhe: (t) => (t.retencaoCents > 0 ? "retenção parcial" : "sem retenção de INSS e IRRF"),
    },
  ];
  const pendencias: Pendencia[] = [];
  for (const r of regras) {
    let cents = 0;
    let quantidade = 0;
    for (const d of ins.documentacao) {
      if (!r.casa(d, tipoDaChave(d.chave, d.descricao))) continue;
      cents += d.cents;
      quantidade += d.quantidade;
    }
    if (quantidade === 0) continue;
    const maiores = ins.titulosComPendencia
      .filter((t) => {
        const doc = (t.documento ?? "").replace(/\D/g, "");
        const flags = {
          pj: doc.length === 14,
          pf: doc.length === 11,
          semDocumentoFiscal: !(t.numeroDocumento ?? "").trim(),
          semBeneficiario: doc.length === 0,
          semRetencao: t.retencaoCents === 0,
        };
        return r.casa(flags, tipoDaChave(t.chave, t.descricao));
      })
      .sort((a, b) => b.valorCents - a.valorCents)
      .slice(0, 15)
      .map((t) => ({ data: t.data, parceiro: t.parceiro, categoria: t.descricao, valorCents: t.valorCents, detalhe: r.detalhe(t) }));
    pendencias.push({ codigo: r.codigo, titulo: r.titulo, risco: r.risco, baseLegal: r.baseLegal, cents, quantidade, maiores });
  }
  if (ins.extratoSemCausa.quantidade > 0) {
    pendencias.push({
      codigo: "EXTRATO_SEM_CAUSA",
      titulo: "Saída do banco sem título e sem categoria",
      risco: "Dinheiro que saiu sem lançamento que diga para quem e por quê: indedutível e, sem causa comprovada, sujeito a IRRF de 35% sobre a base reajustada.",
      baseLegal: "Lei 8.981/1995, art. 61, § 1º",
      cents: ins.extratoSemCausa.cents,
      quantidade: ins.extratoSemCausa.quantidade,
      maiores: ins.extratoSemCausa.maiores.map((m) => ({ data: m.data, parceiro: null, categoria: "—", valorCents: m.valorCents, detalhe: m.texto || "sem descrição" })),
    });
  }

  let exigeNotaCents = 0;
  let comNotaCents = 0;
  for (const d of ins.documentacao) {
    if (!tipoDaChave(d.chave, d.descricao).exigeNota || !d.pj) continue;
    exigeNotaCents += d.cents;
    if (!d.semDocumentoFiscal) comNotaCents += d.cents;
  }
  return { pendencias, coberturaDocumental: exigeNotaCents > 0 ? { comNotaCents, exigeNotaCents } : null };
}

function montarOportunidades(
  ins: InsumosLucroReal,
  c: { real: Impostos; lucroContabilCents: number; multasCents: number; alimentacaoCents: number; parcelasCents: number; encargosNovosCents: number; pendenciasCents: number }
): Oportunidade[] {
  const marginal = ALIQUOTAS.irpj + ALIQUOTAS.csll + (c.real.baseCents > ALIQUOTAS.limiteAdicionalAnoCents ? ALIQUOTAS.adicionalIrpj : 0);
  const irpjNormal = c.real.irpjCents;
  const r: Oportunidade[] = [];

  // Juros sobre capital próprio.
  const { plCents, tjlp, fontePl, fonteTjlp } = ins.jcp;
  const fontes = [fontePl, fonteTjlp].filter(Boolean).join("; ");
  const limiteJcp = Math.max(0, Math.round(c.lucroContabilCents * 0.5));
  const jcpCents = plCents && tjlp ? Math.min(Math.round(plCents * tjlp), limiteJcp) : null;
  r.push({
    codigo: "JCP",
    titulo: "Remunerar o capital dos sócios por juros sobre capital próprio",
    natureza: "PERMANENTE",
    economiaCents: jcpCents !== null ? Math.round(jcpCents * marginal) : null,
    como:
      jcpCents !== null
        ? `JCP de ${reais(jcpCents)} no ano: PL de ${reais(plCents!)} × TJLP de ${(tjlp! * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}% a.a.${
            jcpCents < Math.round(plCents! * tjlp!) ? ", limitado a 50% do lucro" : ""
          }${fontes ? ` (${fontes})` : ""}. A empresa deduz e deixa de pagar ${Math.round(marginal * 100)}%; o sócio paga 17,5% retido na fonte, definitivo. Ganho líquido para o grupo: cerca de ${decimal((marginal - ALIQUOTAS.irrfJcp) * 100)} pontos sobre o valor pago.`
        : `${!plCents ? "Falta o patrimônio líquido: lance o balanço da empresa em Indicadores (ou digite abaixo). " : ""}${!tjlp ? "A TJLP do Banco Central não respondeu: digite abaixo. " : ""} A conta: PL × TJLP do período, limitado a 50% do lucro do exercício ou dos lucros acumulados e reservas. A empresa deduz ${Math.round(marginal * 100)}% e o sócio paga 17,5% na fonte — é a forma mais barata de levar lucro ao sócio dentro do limite.`,
    requisitos: [
      "Patrimônio líquido apurado em balanço (ECD) — sem contabilidade completa não há JCP. Só entram capital social, reservas de capital e de lucros, ações em tesouraria e prejuízos acumulados (Lei 9.249/1995, art. 9º, § 8º)",
      "Deliberação em ata ou alteração contratual e crédito individualizado a cada sócio",
      "IRRF de 17,5% recolhido até o terceiro dia útil do decêndio seguinte",
      "Respeitar o limite de 50% do lucro do período ou dos lucros acumulados e reservas, o maior",
    ],
    baseLegal: "Lei 9.249/1995, art. 9º, com a alíquota de 17,5% da LC 224/2025",
    conferir: true,
  });

  // Depreciação da frota e aceleração por turnos.
  if (ins.frota) {
    const dep = ins.frota.depreciacao20Cents;
    const coefViagem = ins.horas ? coeficienteDeTurnos(ins.horas.medianaEmViagem) : 1;
    const coefJanela = ins.horas ? coeficienteDeTurnos(ins.horas.medianaJanela) : 1;
    r.push({
      codigo: "DEPRECIACAO_TURNOS",
      titulo: "Depreciação acelerada da frota por turnos de operação",
      natureza: "ANTECIPA",
      economiaCents: coefViagem > 1 ? Math.round(dep * (coefViagem - 1) * marginal) : coefJanela > 1 ? 0 : null,
      como: ins.horas
        ? `Pela Ituran, a mediana é de ${decimal(ins.horas.medianaEmViagem)} h/dia rodando e ${decimal(ins.horas.medianaJanela)} h/dia entre a primeira saída e a última chegada (${ins.horas.veiculos} veículos, ${ins.horas.veiculoDias} veículo-dias). Pelas horas rodando, o coeficiente é ${coefViagem.toLocaleString("pt-BR")}; pela janela de operação, ${coefJanela.toLocaleString("pt-BR")}. A depreciação de ${reais(dep)} no ano ${coefViagem > 1 ? `vira ${reais(Math.round(dep * coefViagem))}` : "não muda pelas horas rodando"}${coefJanela > coefViagem ? ` (ou ${reais(Math.round(dep * coefJanela))} pela janela, tese mais agressiva)` : ""}. Antecipa a dedução — o total depreciado não passa do custo do veículo.`
        : "Sem as viagens da Ituran não dá para medir as horas. Com dois turnos de oito horas o coeficiente é 1,5; com três, 2,0.",
      requisitos: [
        "Registro das horas diárias de operação de cada veículo (relatório da Ituran guardado por exercício)",
        "Controle patrimonial do veículo (NF de compra, data, valor, taxa)",
        "Depreciação contabilizada — a acelerada por turnos é contábil, não só fiscal",
      ],
      baseLegal: "RIR/2018, art. 323; IN RFB 1.700/2017, Anexo III (taxa de 20% ou 25% conforme o tipo de veículo)",
      conferir: true,
    });
    if (ins.frota.depreciacao25Cents > ins.frota.depreciacao20Cents) {
      r.push({
        codigo: "TAXA_25",
        titulo: "Taxa de 25% para veículos de transporte de dez ou mais pessoas",
        natureza: "ANTECIPA",
        economiaCents: Math.round((ins.frota.depreciacao25Cents - ins.frota.depreciacao20Cents) * marginal),
        como: `A estimativa usa 20% ao ano para toda a frota. Vans e micro-ônibus de dez lugares ou mais estão no código 8702 da tabela, com 25% ao ano: a depreciação iria a ${reais(
          ins.frota.depreciacao25Cents
        )}.`,
        requisitos: ["Conferir no CRLV a lotação e a classificação de cada veículo", "Aplicar a taxa do código do bem no Anexo III"],
        baseLegal: "IN RFB 1.700/2017, Anexo III",
        conferir: true,
      });
    }
    if (ins.frota.semValor > 0) {
      r.push({
        codigo: "FROTA_SEM_VALOR",
        titulo: "Veículos sem valor de compra no cadastro",
        natureza: "PROTEGE",
        economiaCents: null,
        como: `${ins.frota.semValor} veículo(s) da gestão sem valor ou data de compra. Sem isso não há depreciação — nem a contábil, nem a fiscal.`,
        requisitos: ["Lançar a NF de compra de cada veículo na ficha da gestão (Cadastros › Veículos)"],
        baseLegal: "RIR/2018, arts. 317 e seguintes",
        conferir: false,
      });
    }
  }

  // Perdas no recebimento de créditos.
  const v = ins.recebiveisVencidos;
  const perdas = v.ate15mil.cents + v.de15a100mil.cents + v.acima100mil.cents;
  if (perdas > 0) {
    r.push({
      codigo: "PERDAS_CREDITO",
      titulo: "Deduzir os créditos vencidos que a lei já considera perdidos",
      natureza: "PERMANENTE",
      economiaCents: Math.round(perdas * marginal),
      como: `A receber vencido há mais de seis meses, até R$ 15 mil: ${reais(v.ate15mil.cents)} (${v.ate15mil.quantidade} título(s)). De R$ 15 mil a R$ 100 mil, vencido há mais de um ano: ${reais(v.de15a100mil.cents)} (${v.de15a100mil.quantidade}). Acima de R$ 100 mil, vencido há mais de um ano: ${reais(v.acima100mil.cents)} (${v.acima100mil.quantidade}). A receita foi tributada; a perda pode ser deduzida quando cumpre os critérios. Se recuperar depois, volta a ser receita.`,
      requisitos: [
        "Até R$ 15 mil por operação: vencido há mais de seis meses, sem exigência de cobrança judicial",
        "De R$ 15 mil a R$ 100 mil: vencido há mais de um ano, com cobrança administrativa mantida (e-mails, notificações guardadas)",
        "Acima de R$ 100 mil: vencido há mais de um ano, com procedimento judicial de cobrança iniciado",
        "Créditos cuja receita foi tributada no Presumido: conferir com a assessoria antes de deduzir no Real",
      ],
      baseLegal: "Lei 9.430/1996, arts. 9º a 14",
      conferir: true,
    });
  }

  // Juros embutidos nas parcelas.
  if (c.parcelasCents > 0) {
    r.push({
      codigo: "JUROS_PARCELAS",
      titulo: "Separar juros e principal das parcelas de financiamento",
      natureza: "PERMANENTE",
      economiaCents: null,
      como: `${reais(c.parcelasCents)} de parcelas no período ficaram fora da base inteiras. Os juros dentro delas são despesa financeira dedutível: cada R$ 100 mil de juros identificados reduzem cerca de R$ ${Math.round(
        marginal * 100
      )} mil de imposto. A conferência de parcelas de Financiamentos e consórcios já casa cada contrato; falta lançar juros e amortização em categorias separadas.`,
      requisitos: ["Planilha do banco com juros e amortização por parcela", "Juros apropriados por competência, mês a mês"],
      baseLegal: "RIR/2018, art. 311",
      conferir: false,
    });
  }

  // PAT.
  r.push({
    codigo: "PAT",
    titulo: "Alimentação dos empregados pelo PAT",
    natureza: "PERMANENTE",
    economiaCents: irpjNormal > 0 && c.alimentacaoCents > 0 ? Math.min(Math.round(irpjNormal * 0.04), Math.round(c.alimentacaoCents * ALIQUOTAS.irpj)) : null,
    como: `Além de deduzir a despesa, a empresa no Real abate do IRPJ 15% do que gasta no PAT, até 4% do imposto (sem o adicional). Gasto com alimentação identificado no período: ${reais(c.alimentacaoCents)}.`,
    requisitos: ["Inscrição da empresa no PAT", "Fornecedora de VR/VA registrada no PAT", "Regras do Decreto 10.854/2021 (prioridade a quem ganha até cinco salários mínimos)"],
    baseLegal: "Lei 6.321/1976; Decreto 10.854/2021",
    conferir: true,
  });

  // Incentivos que direcionam imposto.
  r.push({
    codigo: "INCENTIVOS",
    titulo: "Direcionar parte do IRPJ a projetos incentivados",
    natureza: "DIRECIONA",
    economiaCents: null,
    como:
      irpjNormal > 0
        ? `Não reduz o total pago: escolhe para onde vai parte do IRPJ normal (${reais(irpjNormal)} na estimativa). Limites sobre o IRPJ de 15%: Fundo da Criança e do Adolescente 1% (${reais(Math.round(irpjNormal * 0.01))}), Fundo do Idoso 1%, Lei Rouanet e audiovisual 4% (${reais(
            Math.round(irpjNormal * 0.04)
          )}), esporte, Pronon e Pronas/PCD. Ganha marca e relação com a comunidade, sem custo adicional.`
        : "Sem IRPJ devido na estimativa, não há o que direcionar.",
    requisitos: ["Lucro Real (o Presumido não pode)", "Doação no próprio ano-calendário, com recibo do fundo ou do projeto aprovado", "Limites de cada lei e o limite conjunto"],
    baseLegal: "Lei 8.069/1990, art. 260; Lei 12.213/2010; Lei 8.313/1991; Lei 11.438/2006; Lei 12.715/2012",
    conferir: true,
  });

  r.push({
    codigo: "SUSPENSAO",
    titulo: "Apuração anual com balancetes de suspensão ou redução",
    natureza: "ANTECIPA",
    economiaCents: null,
    como: "No Real anual, a empresa recolhe estimativa mensal, mas pode suspendê-la ou reduzi-la quando o balancete acumulado mostra imposto menor. Mês de prejuízo compensa mês de lucro dentro do ano, o que o trimestral não faz.",
    requisitos: ["Balancete mensal transcrito no Livro Diário", "Fechamento contábil mensal no prazo da estimativa"],
    baseLegal: "Lei 8.981/1995, art. 35; Lei 9.430/1996, art. 2º",
    conferir: false,
  });

  r.push({
    codigo: "COMPETENCIA",
    titulo: "Lançar por competência o que hoje entra pelo pagamento",
    natureza: "ANTECIPA",
    economiaCents: null,
    como: "Provisão mensal de férias e 13º (dedutível no mês em que o direito nasce), juros por competência, despesas do mês pagas no mês seguinte. Bem de até R$ 1.200 ou com vida útil de até um ano vai direto para a despesa.",
    requisitos: ["Fechamento contábil mensal", "Provisão de férias e 13º por empregado"],
    baseLegal: "Lei 9.249/1995, art. 13, I; RIR/2018, art. 313",
    conferir: false,
  });

  if (c.multasCents > 0) {
    r.push({
      codigo: "MULTAS",
      titulo: "Multas de trânsito: cobrar do responsável",
      natureza: "REDUZ_CUSTO",
      economiaCents: null,
      como: `${reais(c.multasCents)} em multas de trânsito suportadas pela empresa no período, adicionadas à base. O caminho legal não é deduzir: é não suportar — o fechamento de multas da gestão já identifica o condutor e desconta em folha dentro do teto.`,
      requisitos: ["Termo de responsabilidade assinado pelo condutor", "Desconto previsto em contrato e dentro do limite"],
      baseLegal: "CLT, art. 462, § 1º",
      conferir: false,
    });
  }

  if (c.encargosNovosCents > 0) {
    r.push({
      codigo: "TRANSFERENCIA",
      titulo: `Transferência da folha da ${ins.corporativa ?? "corporativa"} para a ${ins.empresa}`,
      natureza: "CUSTO_NOVO",
      economiaCents: -Math.round(c.encargosNovosCents * (1 - marginal)),
      como: `Os encargos patronais estimados (${reais(c.encargosNovosCents)} no ano) passam a existir, e são dedutíveis — o custo líquido de imposto é de ${reais(
        Math.round(c.encargosNovosCents * (1 - marginal))
      )}. Em troca, sai o risco de a fiscalização tratar a empresa do Simples como interposta só para a folha (desconsideração com cobrança da contribuição patronal e multa), que é a autuação típica desse arranjo.`,
      requisitos: ["Sucessão trabalhista formalizada (CLT, arts. 10 e 448)", "eSocial: transferência entre empresas do grupo, sem rescisão"],
      baseLegal: "Lei 8.212/1991, art. 22; CTN, art. 116, parágrafo único",
      conferir: true,
    });
  }

  if (c.pendenciasCents > 0) {
    r.push({
      codigo: "DOCUMENTACAO",
      titulo: "Regularizar a documentação antes de 2027",
      natureza: "PROTEGE",
      economiaCents: Math.round(c.pendenciasCents * marginal),
      como: `${reais(c.pendenciasCents)} em despesas com pendência de documento (lista abaixo). No Real cada real sem documento é base glosada; regularizar é a economia mais barata que existe.`,
      requisitos: ["Pedir a nota ao fornecedor e lançar o número no título da Omie", "CPF ou CNPJ em todo beneficiário", "RPA e retenções nos pagamentos a pessoa física"],
      baseLegal: "RIR/2018, art. 311; Lei 8.981/1995, art. 61",
      conferir: false,
    });
  }

  return r;
}

function decimal(v: number): string {
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function reais(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}
