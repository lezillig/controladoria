// A CONFERÊNCIA DE OS: o custo de cada projeto contra a cobrança dele.
//
// Neste grupo o PROJETO da Omie é a ordem de serviço da operação: o terceiro
// (Transcomin), o combustível e o pedágio da viagem são lançados nele, e a
// cobrança ao cliente sai nele. Projeto com custo e sem cobrança é serviço
// prestado e não faturado — ou custo lançado no projeto errado. A ORDEM DE
// SERVIÇO da Omie (aba Diversos, `cNumOS`) é a segunda chave: a mesma OS em
// dois projetos diferentes é lançamento trocado.
//
// Sem banco: a tela soma no banco e manda os grupos para cá.

export type GrupoOs = {
  conexaoId: string;
  natureza: "PAGAR" | "RECEBER";
  projeto: string | null;
  os: string | null;
  // A descrição da categoria (os grupos vêm somados por categoria também).
  categoria?: string | null;
  titulos: number;
  cents: number;
  ultimaCompetencia: Date | null;
  parceiros: string[];
};

// O QUE É OS NESTA CONFERÊNCIA (pedido da operação): o projeto cujo nome é
// SÓ NÚMERO, com 4 a 6 dígitos (14638). Projeto com nome de texto é contrato (SMPED, Escolar
// Cajamar) ou veículo (SSB0F16), não ordem de serviço — mesmo quando tem
// compra ou receita de serviços — e o resultado dele não é o de uma viagem.
// E, dentro de qualquer OS, multa e despesa da diretoria NÃO entram: não são
// custo da viagem. Tudo o que fica de fora vai para a lista "fora da
// conferência", para ser visto.
// De 4 a 6 dígitos: a numeração das OS (14638). Número comprido
// (5935413299) é outra coisa lançada como projeto — fatura, cadastro.
export const PROJETO_NUMERICO = /^\d{4,6}$/;
export const CATEGORIA_FORA_DA_OS = /multa|diretoria/i;
// A categoria das comissões sobre vendas ("Comissões sobre Vendas", "Comissões").
export const CATEGORIA_COMISSAO = /comiss/i;
// Placa de veículo, no padrão antigo (ABC1234) e no Mercosul (GIY7E76).
export const DOCUMENTO_PLACA = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;

export type ForaDaConferencia = { nome: string; empresas: string[]; custoCents: number; receitaCents: number; titulos: number; categorias: string[] };
export type LancamentoExcluido = { projeto: string; categoria: string; natureza: string; cents: number; titulos: number };

export type PagarSemProjeto = { conexaoId: string; parceiro: string; categoria: string; titulos: number; cents: number; ultimaCompetencia: Date | null };

export type ProjetoConferido = {
  chave: string;
  // A empresa e o código da Omie de cada lado, para a investigação.
  codigos: string[];
  nome: string;
  empresas: string[];
  custoCents: number;
  receitaCents: number;
  margemCents: number;
  // Tributos sobre a receita, pela taxa efetiva de deduções da empresa no
  // período (ISS, PIS, COFINS lançados no DRE sobre a receita bruta).
  impostosCents: number;
  // Receita − impostos − custo: o resultado da OS.
  resultadoCents: number;
  resultadoPercent: number | null;
  titulosDeCusto: number;
  titulosDeReceita: number;
  fornecedores: string[];
  clientes: string[];
  ultimoCusto: Date | null;
  ultimaReceita: Date | null;
  osDoPagar: string[];
  osDoReceber: string[];
};

export type OsEmProjetos = { os: string; empresa: string; projetos: { nome: string; natureza: string; cents: number }[] };

export type Duplicidade = { natureza: string; empresa: string; parceiro: string; documento: string; valorCents: number; vezes: number; projetos: string[] };
export type ForaDoPadrao = { projeto: ProjetoConferido; cliente: string; medianaPercent: number; osDoCliente: number };

export type Cobertura = { titulos: number; cents: number; comProjeto: number; comProjetoCents: number; comOs: number };

export type ResultadoConferenciaOs = {
  cobertura: { pagar: Cobertura; receber: Cobertura };
  projetos: ProjetoConferido[];
  custoSemReceita: ProjetoConferido[];
  custoAcimaDaReceita: ProjetoConferido[];
  receitaSemCusto: ProjetoConferido[];
  // Faturada e com resultado negativo depois dos impostos.
  comPrejuizo: ProjetoConferido[];
  foraDoPadrao: ForaDoPadrao[];
  duplicidades: Duplicidade[];
  osEmProjetosDiferentes: OsEmProjetos[];
  pagarSemProjeto: PagarSemProjeto[];
  // Projetos que não são OS pela regra (PROJETO_NUMERICO; antes também as categorias de
  // serviço), e os lançamentos de multa e diretoria tirados das OS.
  foraDaConferencia: ForaDaConferencia[];
  lancamentosExcluidos: LancamentoExcluido[];
};

// A mesma OS escrita como projeto nas duas empresas ("14638" na Azul e na
// MCZ) é um projeto só: o terceiro pode ser pago por uma e a cobrança sair da
// outra. O nome do projeto, sem caixa nem espaço, é a chave.
export const chaveDoProjeto = (nome: string) => nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

const maisRecente = (a: Date | null, b: Date | null) => (!a ? b : !b ? a : a > b ? a : b);
const unicos = (l: string[]) => [...new Set(l.filter(Boolean))];

export function conferirOs(params: {
  grupos: GrupoOs[];
  pagarSemProjeto: PagarSemProjeto[];
  // Nome do projeto por "conexaoId|codigo"; sem nome, vale o código.
  nomeDoProjeto: Map<string, string>;
  empresa: Map<string, string>;
  // Taxa efetiva de tributos sobre a receita, por empresa (0,0865 = 8,65%).
  taxaImpostos?: Map<string, number>;
  duplicidades?: Duplicidade[];
}): ResultadoConferenciaOs {
  const { nomeDoProjeto, empresa } = params;
  const taxa = (conexaoId: string) => params.taxaImpostos?.get(conexaoId) ?? 0;
  const cobertura = (natureza: "PAGAR" | "RECEBER"): Cobertura => {
    // Multa e diretoria fora também da cobertura: são desconsideradas aqui.
    const l = params.grupos.filter((g) => g.natureza === natureza && !CATEGORIA_FORA_DA_OS.test(g.categoria ?? ""));
    const com = l.filter((g) => g.projeto);
    return {
      titulos: l.reduce((s, g) => s + g.titulos, 0),
      cents: l.reduce((s, g) => s + g.cents, 0),
      comProjeto: com.reduce((s, g) => s + g.titulos, 0),
      comProjetoCents: com.reduce((s, g) => s + g.cents, 0),
      comOs: l.filter((g) => g.os).reduce((s, g) => s + g.titulos, 0),
    };
  };

  const nome = (g: GrupoOs) => nomeDoProjeto.get(`${g.conexaoId}|${g.projeto}`) ?? g.projeto!;

  // 1. Multa e diretoria saem de qualquer OS.
  const excluidos = new Map<string, LancamentoExcluido>();
  const semExcluidos = params.grupos.filter((g) => {
    if (!g.projeto || !CATEGORIA_FORA_DA_OS.test(g.categoria ?? "")) return true;
    const k = `${chaveDoProjeto(nome(g))}|${g.categoria}|${g.natureza}`;
    const e = excluidos.get(k) ?? { projeto: nome(g), categoria: g.categoria ?? "", natureza: g.natureza === "PAGAR" ? "a pagar" : "a receber", cents: 0, titulos: 0 };
    e.cents += g.cents;
    e.titulos += g.titulos;
    excluidos.set(k, e);
    return false;
  });
  // 2. É OS: o nome do projeto é só número.
  const ehOs = new Set<string>();
  for (const g of semExcluidos) if (g.projeto && PROJETO_NUMERICO.test(nome(g).trim())) ehOs.add(chaveDoProjeto(nome(g)));
  const fora = new Map<string, ForaDaConferencia & { cats: Map<string, number> }>();
  const grupos = semExcluidos.filter((g) => {
    if (!g.projeto || ehOs.has(chaveDoProjeto(nome(g)))) return true;
    const k = chaveDoProjeto(nome(g));
    const f = fora.get(k) ?? { nome: nome(g), empresas: [], custoCents: 0, receitaCents: 0, titulos: 0, categorias: [], cats: new Map() };
    f.empresas = unicos([...f.empresas, empresa.get(g.conexaoId) ?? "?"]);
    if (g.natureza === "PAGAR") f.custoCents += g.cents;
    else f.receitaCents += g.cents;
    f.titulos += g.titulos;
    if (g.categoria) f.cats.set(g.categoria, (f.cats.get(g.categoria) ?? 0) + Math.abs(g.cents));
    fora.set(k, f);
    return false;
  });
  const foraDaConferencia: ForaDaConferencia[] = [...fora.values()]
    .map(({ cats, ...f }) => ({ ...f, categorias: [...cats.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c) }))
    .sort((a, b) => b.custoCents + b.receitaCents - (a.custoCents + a.receitaCents));
  const porChave = new Map<string, ProjetoConferido>();
  for (const g of grupos) {
    if (!g.projeto) continue;
    const n = nome(g);
    const k = chaveDoProjeto(n);
    const p =
      porChave.get(k) ??
      ({ chave: k, codigos: [], nome: n, empresas: [], impostosCents: 0, resultadoCents: 0, resultadoPercent: null, custoCents: 0, receitaCents: 0, margemCents: 0, titulosDeCusto: 0, titulosDeReceita: 0, fornecedores: [], clientes: [], ultimoCusto: null, ultimaReceita: null, osDoPagar: [], osDoReceber: [] } as ProjetoConferido);
    p.empresas = unicos([...p.empresas, empresa.get(g.conexaoId) ?? "?"]);
    p.codigos = unicos([...p.codigos, g.projeto]);
    if (g.natureza === "PAGAR") {
      p.custoCents += g.cents;
      p.titulosDeCusto += g.titulos;
      p.fornecedores = unicos([...p.fornecedores, ...g.parceiros]);
      p.ultimoCusto = maisRecente(p.ultimoCusto, g.ultimaCompetencia);
      if (g.os) p.osDoPagar = unicos([...p.osDoPagar, g.os]);
    } else {
      p.receitaCents += g.cents;
      p.impostosCents += Math.round(g.cents * taxa(g.conexaoId));
      p.titulosDeReceita += g.titulos;
      p.clientes = unicos([...p.clientes, ...g.parceiros]);
      p.ultimaReceita = maisRecente(p.ultimaReceita, g.ultimaCompetencia);
      if (g.os) p.osDoReceber = unicos([...p.osDoReceber, g.os]);
    }
    p.margemCents = p.receitaCents - p.custoCents;
    p.resultadoCents = p.receitaCents - p.impostosCents - p.custoCents;
    p.resultadoPercent = p.receitaCents > 0 ? (p.resultadoCents / p.receitaCents) * 100 : null;
    porChave.set(k, p);
  }
  const projetos = [...porChave.values()].sort((a, b) => b.custoCents + b.receitaCents - (a.custoCents + a.receitaCents));

  // A MESMA OS EM PROJETOS DIFERENTES, dentro da mesma empresa (o número da OS
  // é da conta Omie).
  const porOs = new Map<string, { os: string; conexaoId: string; projetos: Map<string, { nome: string; natureza: Set<string>; cents: number }> }>();
  for (const g of grupos) {
    if (!g.os || !g.projeto) continue;
    const k = `${g.conexaoId}|${g.os}`;
    const o = porOs.get(k) ?? { os: g.os, conexaoId: g.conexaoId, projetos: new Map() };
    const n = nome(g);
    const p = o.projetos.get(chaveDoProjeto(n)) ?? { nome: n, natureza: new Set<string>(), cents: 0 };
    p.natureza.add(g.natureza === "PAGAR" ? "a pagar" : "a receber");
    p.cents += g.cents;
    o.projetos.set(chaveDoProjeto(n), p);
    porOs.set(k, o);
  }
  const osEmProjetosDiferentes: OsEmProjetos[] = [...porOs.values()]
    .filter((o) => o.projetos.size > 1)
    .map((o) => ({ os: o.os, empresa: empresa.get(o.conexaoId) ?? "?", projetos: [...o.projetos.values()].map((p) => ({ nome: p.nome, natureza: [...p.natureza].join(" e "), cents: p.cents })) }));

  // MARGEM FORA DO PADRÃO DO CLIENTE: as OS de um mesmo cliente costumam ter
  // margem parecida (mesmo contrato, mesma rota). A que fica 30 pontos abaixo
  // da mediana dele, com pelo menos 4 OS para comparar, pede explicação.
  const porCliente = new Map<string, ProjetoConferido[]>();
  for (const p of projetos) if (p.receitaCents > 0 && p.custoCents > 0 && p.clientes[0]) porCliente.set(p.clientes[0], [...(porCliente.get(p.clientes[0]) ?? []), p]);
  const foraDoPadrao: ForaDoPadrao[] = [];
  for (const [cliente, l] of porCliente) {
    if (l.length < 4) continue;
    const ordenadas = l.map((p) => p.resultadoPercent ?? 0).sort((a, b) => a - b);
    const meio = Math.floor(ordenadas.length / 2);
    const mediana = ordenadas.length % 2 ? ordenadas[meio] : (ordenadas[meio - 1] + ordenadas[meio]) / 2;
    for (const p of l) if ((p.resultadoPercent ?? 0) < mediana - 30) foraDoPadrao.push({ projeto: p, cliente, medianaPercent: mediana, osDoCliente: l.length });
  }
  foraDoPadrao.sort((a, b) => (a.projeto.resultadoPercent ?? 0) - a.medianaPercent - ((b.projeto.resultadoPercent ?? 0) - b.medianaPercent));

  return {
    cobertura: { pagar: cobertura("PAGAR"), receber: cobertura("RECEBER") },
    projetos,
    custoSemReceita: projetos.filter((p) => p.custoCents > 0 && p.receitaCents === 0).sort((a, b) => b.custoCents - a.custoCents),
    custoAcimaDaReceita: projetos.filter((p) => p.receitaCents > 0 && p.custoCents > p.receitaCents).sort((a, b) => a.margemCents - b.margemCents),
    comPrejuizo: projetos.filter((p) => p.receitaCents > 0 && p.custoCents > 0 && p.resultadoCents < 0).sort((a, b) => a.resultadoCents - b.resultadoCents),
    foraDoPadrao,
    foraDaConferencia,
    lancamentosExcluidos: [...excluidos.values()].sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents)),
    duplicidades: (params.duplicidades ?? []).filter((d) => d.projetos.some((p) => ehOs.has(chaveDoProjeto(p)))).sort((a, b) => b.valorCents * (b.vezes - 1) - a.valorCents * (a.vezes - 1)),
    receitaSemCusto: projetos.filter((p) => p.receitaCents > 0 && p.custoCents === 0).sort((a, b) => b.receitaCents - a.receitaCents),
    osEmProjetosDiferentes,
    pagarSemProjeto: [...params.pagarSemProjeto].sort((a, b) => b.cents - a.cents),
  };
}

// A COBRANÇA QUE CITA A OS. A fatura pode sair no projeto do contrato (SMPED,
// Fretamento) e não no da viagem; se ela cita o número da OS, o elo existe
// mesmo assim. Onde se procura:
//   - na OBSERVAÇÃO do título a receber: qualquer número de 4 a 6 dígitos;
//   - no NÚMERO DO DOCUMENTO, só depois de "OS" ("OS 14641", "OS: 14641") —
//     o documento em si é o número da nota/RPS ("RPS 10581"), da mesma faixa
//     de numeração das OS, e casar com ele seria coincidência;
//   - na ORDEM DE SERVIÇO (aba Diversos), quando ela é o próprio número.
export type OndeCitou = "observação" | "documento" | "ordem de serviço";
export type CobrancaCitada = {
  id: string;
  empresa: string;
  projeto: string | null;
  cliente: string | null;
  documento: string | null;
  valorCents: number;
  competencia: Date | null;
  onde: OndeCitou;
};

export function numerosCitados(t: { observacao: string | null; documento: string | null; os: string | null }): Map<string, OndeCitou> {
  const achados = new Map<string, OndeCitou>();
  // Número solto: não colado em data (12/10/2026), valor (1.874,36) ou CEP
  // (04776-000); e ano (20xx) não é OS.
  for (const m of (t.observacao ?? "").matchAll(/(?<![\d.,/-])(\d{4,6})(?![\d]|[.,/-]\d)/g)) if (!/^20\d\d$/.test(m[1])) achados.set(m[1], "observação");
  for (const m of (t.documento ?? "").matchAll(/\bO\.?\s?S\.?\s*(?:n[ºo°.]?\s*)?[:#-]?\s*(\d{4,6})\b/gi)) if (!achados.has(m[1])) achados.set(m[1], "documento");
  const os = (t.os ?? "").trim();
  if (PROJETO_NUMERICO.test(os) && !achados.has(os)) achados.set(os, "ordem de serviço");
  return achados;
}

// A FICHA DE UMA OS — tudo o que ela recebeu e gastou, por cliente e por
// fornecedor, e a conta dela. A mesma regra da conferência acima: multa e
// diretoria ficam fora da conta (aparecem à parte), e os tributos sobre a
// receita saem pela taxa efetiva de deduções da empresa de cada cobrança.
export type TituloDaFicha = {
  conexaoId: string;
  natureza: string;
  parceiro: string | null;
  categoria: string | null;
  valorCents: number;
  pagoCents: number;
  competencia: Date | null;
};
export type ParteDaFicha = { nome: string; titulos: number; cents: number; pagoCents: number; categorias: string[]; participacaoPercent: number };
export type FichaDaOs = {
  receitaCents: number;
  tributosCents: number;
  receitaLiquidaCents: number;
  custoCents: number;
  resultadoCents: number;
  // Resultado ÷ receita; nulo sem receita.
  margemPercent: number | null;
  // Receita − custo, antes dos tributos.
  margemBrutaCents: number;
  custoSobreReceitaPercent: number | null;
  recebidoCents: number;
  pagoCents: number;
  clientes: ParteDaFicha[];
  fornecedores: ParteDaFicha[];
  custoPorCategoria: { categoria: string; cents: number; participacaoPercent: number }[];
  foraDaConta: { natureza: string; categoria: string; titulos: number; cents: number }[];
  primeiraCompetencia: Date | null;
  ultimaCompetencia: Date | null;
};

export function fichaDaOs(titulos: TituloDaFicha[], taxaImpostos: Map<string, number>): FichaDaOs {
  const fora = new Map<string, { natureza: string; categoria: string; titulos: number; cents: number }>();
  const contam = titulos.filter((t) => {
    if (!CATEGORIA_FORA_DA_OS.test(t.categoria ?? "")) return true;
    const natureza = t.natureza === "PAGAR" ? "a pagar" : "a receber";
    const k = `${natureza}|${t.categoria}`;
    const f = fora.get(k) ?? { natureza, categoria: t.categoria ?? "", titulos: 0, cents: 0 };
    f.titulos += 1;
    f.cents += t.valorCents;
    fora.set(k, f);
    return false;
  });
  const receber = contam.filter((t) => t.natureza === "RECEBER");
  const pagar = contam.filter((t) => t.natureza === "PAGAR");
  const soma = (l: TituloDaFicha[], f: (t: TituloDaFicha) => number) => l.reduce((s, t) => s + f(t), 0);
  const receitaCents = soma(receber, (t) => t.valorCents);
  const tributosCents = soma(receber, (t) => Math.round(t.valorCents * (taxaImpostos.get(t.conexaoId) ?? 0)));
  const custoCents = soma(pagar, (t) => t.valorCents);
  const resultadoCents = receitaCents - tributosCents - custoCents;

  const porParte = (l: TituloDaFicha[], vazio: string, total: number): ParteDaFicha[] => {
    const m = new Map<string, { nome: string; titulos: number; cents: number; pagoCents: number; cats: Map<string, number> }>();
    for (const t of l) {
      const nome = t.parceiro?.trim() || vazio;
      const p = m.get(nome) ?? { nome, titulos: 0, cents: 0, pagoCents: 0, cats: new Map() };
      p.titulos += 1;
      p.cents += t.valorCents;
      p.pagoCents += t.pagoCents;
      if (t.categoria) p.cats.set(t.categoria, (p.cats.get(t.categoria) ?? 0) + t.valorCents);
      m.set(nome, p);
    }
    return [...m.values()]
      .map(({ cats, ...p }) => ({ ...p, categorias: [...cats.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c), participacaoPercent: total > 0 ? (p.cents / total) * 100 : 0 }))
      .sort((a, b) => b.cents - a.cents || a.nome.localeCompare(b.nome));
  };
  const categorias = new Map<string, number>();
  for (const t of pagar) categorias.set(t.categoria ?? "(sem categoria)", (categorias.get(t.categoria ?? "(sem categoria)") ?? 0) + t.valorCents);
  const datas = contam.map((t) => t.competencia).filter((d): d is Date => d !== null).map((d) => d.getTime());

  return {
    receitaCents,
    tributosCents,
    receitaLiquidaCents: receitaCents - tributosCents,
    custoCents,
    resultadoCents,
    margemPercent: receitaCents > 0 ? (resultadoCents / receitaCents) * 100 : null,
    margemBrutaCents: receitaCents - custoCents,
    custoSobreReceitaPercent: receitaCents > 0 ? (custoCents / receitaCents) * 100 : null,
    recebidoCents: soma(receber, (t) => t.pagoCents),
    pagoCents: soma(pagar, (t) => t.pagoCents),
    clientes: porParte(receber, "(sem cliente)", receitaCents),
    fornecedores: porParte(pagar, "(sem fornecedor)", custoCents),
    custoPorCategoria: [...categorias.entries()]
      .map(([categoria, cents]) => ({ categoria, cents, participacaoPercent: custoCents > 0 ? (cents / custoCents) * 100 : 0 }))
      .sort((a, b) => b.cents - a.cents),
    foraDaConta: [...fora.values()].sort((a, b) => b.cents - a.cents),
    primeiraCompetencia: datas.length ? new Date(Math.min(...datas)) : null,
    ultimaCompetencia: datas.length ? new Date(Math.max(...datas)) : null,
  };
}

// O que se digita na busca: "OS 14641", "os-14641", " 14641 " → "14641".
export function osDigitada(texto: string | undefined | null): string {
  // Só tira o "OS" quando vem um número depois: "OSASCO FRETAMENTO" e "OSNI
  // LOCACOES" são nomes de projeto, não "OS ASCO".
  return (texto ?? "").trim().replace(/^o\.?\s*s\.?\s*[-:nº°#]*\s*(?=\d)/i, "").trim();
}
