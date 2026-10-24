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
// SÓ NÚMERO (14638). Projeto com nome de texto é contrato (SMPED, Escolar
// Cajamar) ou veículo (SSB0F16), não ordem de serviço — mesmo quando tem
// compra ou receita de serviços — e o resultado dele não é o de uma viagem.
// E, dentro de qualquer OS, multa e despesa da diretoria NÃO entram: não são
// custo da viagem. Tudo o que fica de fora vai para a lista "fora da
// conferência", para ser visto.
export const PROJETO_NUMERICO = /^\d+$/;
export const CATEGORIA_FORA_DA_OS = /multa|diretoria/i;

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
    const l = params.grupos.filter((g) => g.natureza === natureza);
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
