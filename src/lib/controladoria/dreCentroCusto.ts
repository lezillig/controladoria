import { LINHA_PESSOAS_CORPORATIVO } from "./dre";
import { ehNomeDeApoio, normalizar } from "./quadroDePessoal";

// O DRE POR CENTRO DE CUSTO — a conta, sem banco.
//
// O ponto de partida é o MESMO DRE da tela de Custos (competência, o mesmo
// recorte, a mesma linha por categoria): os títulos do mês chegam somados por
// origem — empresa, categoria, natureza, departamento, projeto e parceiro — e
// cada soma vai para um centro de custo por uma destas regras, nesta ordem:
//
//   1. VÍNCULO: a origem foi ligada a um centro (projeto > departamento >
//      parceiro > categoria). Origem ligada a vários centros: com percentuais,
//      pelo percentual (o que faltar para 100% fica não alocado); com 100% em
//      todos, pela folha dos centros.
//   2. DEPARTAMENTO DA OMIE: título com departamento (o "centro de custo" da
//      Omie) e sem vínculo vai para um centro com o nome do departamento — a
//      mesma regra com que a tela de Custos já abre "Despesas com pessoas —
//      corporativo". É o que deixa o relatório de pé antes de qualquer ajuste;
//      ligar o departamento a um centro da folha junta os dois.
//   3. FOLHA: despesa com pessoas sem vínculo nem departamento é dividida entre os centros da
//      empresa do título pelo salário do quadro de pessoal importado — a folha
//      da Omie chega por categoria (salários, INSS, FGTS, VT), não por pessoa,
//      e o salário de quem está em cada centro é a melhor régua que existe.
//   4. NÃO ALOCADO: o resto, à vista, por origem, para ser ligado.
//
// Só o resultado OPERACIONAL (até o EBIT) é dividido. Resultado financeiro,
// financiamentos, tributo sobre o lucro e distribuição ficam fora — são da
// empresa, não de um contrato. Categoria em branco fica fora como no DRE.
//
// O SINAL: cada valor entra como EFEITO NO RESULTADO (receita +, custo −), o
// mesmo que a demonstração aplica — o lado da categoria e o sinal do total
// dela —, para que a soma dos centros mais o não alocado feche com o EBIT do
// DRE ao centavo.
//
// RATEIO DO APOIO (opcional): o resultado dos centros de apoio (oficina, RH,
// financeiro — quase sempre só custo) é distribuído entre os operacionais pela
// receita ou pela folha. A margem direta de cada centro continua à vista ao
// lado: o rateio é uma opinião sobre quem consome o apoio, a margem direta é
// fato.

export const LINHAS_OPERACIONAIS = [
  "RECEITA_BRUTA",
  "DEDUCOES",
  "OUTRAS_RECEITAS",
  "CUSTO_SERVICO",
  "DESPESA_VEICULOS",
  "DESPESA_SERVICOS_TERCEIROS",
  "DESPESA_SALARIOS",
  LINHA_PESSOAS_CORPORATIVO,
  "DESPESA_SOCIOS",
  "DESPESA_ESTRUTURA",
  "DESPESA_INFORMATICA",
  "DESPESA_COMERCIAL",
  "DESPESA_ADMINISTRATIVA",
  "DESPESA_GERAL",
] as const;
const OPERACIONAIS = new Set<string>(LINHAS_OPERACIONAIS);
const LINHAS_DE_PESSOAS = new Set(["DESPESA_SALARIOS", LINHA_PESSOAS_CORPORATIVO]);
const LINHAS_DE_RECEITA = new Set(["RECEITA_BRUTA", "OUTRAS_RECEITAS"]);

export type TipoOrigem = "PROJETO" | "DEPARTAMENTO" | "PARCEIRO" | "CATEGORIA";
export const TIPOS_ORIGEM: TipoOrigem[] = ["PROJETO", "DEPARTAMENTO", "PARCEIRO", "CATEGORIA"];
export type Rateio = "NENHUM" | "RECEITA" | "FOLHA";

export type GrupoDeTitulos = {
  conexaoId: string;
  categoria: string;
  natureza: string;
  departamento: string | null;
  projeto: string | null;
  // Documento (CPF/CNPJ só dígitos) do cliente/fornecedor; sem ele, o nome.
  parceiro: string | null;
  parceiroNome: string | null;
  cents: number;
  // Tributo retido pelo cliente no título a receber (entra nas deduções
  // quando a configuração manda somar).
  retencaoCents: number;
  titulos: number;
};

// `departamentoOmie`: centro que não está cadastrado — nasceu de um
// departamento da Omie sem vínculo (regra 2) e existe só no relatório.
export type CentroDoDre = { id: string; conexaoId: string; codigo: string; descricao: string; tipo: string; empresa: string; departamentoOmie?: boolean };
export type VinculoDoDre = { id?: string; centroCustoId: string; conexaoId: string; tipoOrigem: string; valorOrigem: string; percentual: number };
// O quadro de pessoal de uma empresa: por centro, pessoas e salário.
export type QuadroDoDre = { conexaoId: string; competencia: Date; porCentro: Map<string, { pessoas: number; salarioCents: number }> };

export type EntradaDreCentro = {
  grupos: GrupoDeTitulos[];
  linhaDaCategoria: (categoria: string) => string;
  ehReceita: (categoria: string) => boolean;
  descricaoDaCategoria: (categoria: string) => string;
  conexoesCorporativas: Set<string>;
  centros: CentroDoDre[];
  vinculos: VinculoDoDre[];
  quadros: QuadroDoDre[];
  rateio: Rateio;
  somarRetencoes: boolean;
  // Nome de departamento e projeto por "conexaoId|codigo", para a tela.
  nomes?: { departamentos?: Map<string, string>; projetos?: Map<string, string> };
  // O apelido de cada empresa (conexão), para os avisos e os centros da Omie.
  empresas?: Map<string, string>;
  // Regra 2 ligada (padrão).
  departamentoComoCentro?: boolean;
};

export type Via = "VINCULO" | "DEPARTAMENTO" | "FOLHA";
export type DetalheDoCentro = { linha: string; categoria: string; descricao: string; via: Via; efeitoCents: number };

export type ResultadoDoCentro = CentroDoDre & {
  pessoas: number;
  salarioQuadroCents: number;
  porLinha: Record<string, number>;
  detalhes: DetalheDoCentro[];
  receitaCents: number;
  deducoesCents: number;
  pessoasCents: number;
  demaisCents: number;
  margemCents: number;
  rateioCents: number;
  resultadoCents: number;
  // Para o centro do departamento da Omie: centros da folha com nome parecido.
  sugestoes: string[];
};

export type OrigemNaoAlocada = {
  tipo: TipoOrigem;
  conexaoId: string;
  valor: string;
  rotulo: string;
  efeitoCents: number;
  titulos: number;
  linhas: Record<string, number>;
  // Centros de custo prováveis, pelo nome (cliente do quadro, descrição).
  sugestoes: string[];
};

export type ResultadoDreCentro = {
  centros: ResultadoDoCentro[];
  naoAlocado: { porLinha: Record<string, number>; totalCents: number; origens: OrigemNaoAlocada[] };
  foraDoCentro: { porLinha: Record<string, number>; totalCents: number };
  semCategoriaCents: number;
  ebitCents: number;
  alocadoCents: number;
  // Fração do volume operacional (em módulo) que chegou a um centro.
  cobertura: number;
  avisos: string[];
};

const somar = (r: Record<string, number>, k: string, v: number) => (r[k] = (r[k] ?? 0) + v);

// A ORIGEM DE CADA GRUPO, nas quatro formas que um vínculo pode ter.
function chavesDoGrupo(g: GrupoDeTitulos): [TipoOrigem, string | null][] {
  return [
    ["PROJETO", g.projeto],
    ["DEPARTAMENTO", g.departamento],
    ["PARCEIRO", g.parceiro],
    ["CATEGORIA", g.categoria],
  ];
}

// Palavras com significado do nome, para comparar "SPAL IND BRAS DE BEBIDAS
// SA OSASCO" com o centro "FEMSA - OSASCO" e o cliente do quadro.
const VAZIAS = new Set(["de", "da", "do", "das", "dos", "e", "ltda", "sa", "me", "epp", "eireli", "ind", "com", "bras", "brasil", "s", "a"]);
const palavras = (s: string) => new Set(normalizar(s).split(" ").filter((p) => p.length >= 3 && !VAZIAS.has(p)));
function semelhanca(a: Set<string>, b: Set<string>) {
  if (a.size === 0 || b.size === 0) return 0;
  let comum = 0;
  for (const p of a) if (b.has(p)) comum++;
  return comum / Math.min(a.size, b.size);
}

export function sugerirCentros(rotulo: string, candidatos: { id: string; nomes: string[] }[], limite = 3): string[] {
  const alvo = palavras(rotulo);
  return candidatos
    .map((c) => ({ id: c.id, nota: Math.max(0, ...c.nomes.map((n) => semelhanca(alvo, palavras(n)))) }))
    .filter((c) => c.nota >= 0.6)
    .sort((a, b) => b.nota - a.nota)
    .slice(0, limite)
    .map((c) => c.id);
}

export function montarDreCentroCusto(e: EntradaDreCentro, servicosPorCentro: Map<string, string[]> = new Map()): ResultadoDreCentro {
  const avisos: string[] = [];
  const quadroDe = new Map(e.quadros.map((q) => [q.conexaoId, q]));
  const centrosPorId = new Map(e.centros.map((c) => [c.id, c]));

  // A linha de cada grupo — pessoas da empresa corporativa vão para a linha
  // corporativa, como no DRE.
  const linhaDoGrupo = (g: GrupoDeTitulos) => {
    const l = e.linhaDaCategoria(g.categoria);
    return l === "DESPESA_SALARIOS" && e.conexoesCorporativas.has(g.conexaoId) ? LINHA_PESSOAS_CORPORATIVO : l;
  };
  // O sinal do total de cada (categoria, linha): é o módulo do total que o DRE
  // soma, então cada parte entra com o sinal dele.
  const totalDaChave = new Map<string, number>();
  for (const g of e.grupos) {
    if (g.categoria === "SEM_CATEGORIA") continue;
    const k = `${g.categoria}|${linhaDoGrupo(g)}`;
    totalDaChave.set(k, (totalDaChave.get(k) ?? 0) + g.cents);
  }
  const efeitoDe = (g: GrupoDeTitulos, linha: string) => {
    const total = totalDaChave.get(`${g.categoria}|${linha}`) ?? 0;
    return (e.ehReceita(g.categoria) ? 1 : -1) * Math.sign(total) * g.cents;
  };

  // Os vínculos por origem.
  const vinculosDe = new Map<string, VinculoDoDre[]>();
  for (const v of e.vinculos) {
    if (!centrosPorId.has(v.centroCustoId)) continue;
    const k = `${v.tipoOrigem}|${v.conexaoId}|${v.valorOrigem}`;
    vinculosDe.set(k, [...(vinculosDe.get(k) ?? []), v]);
  }

  // O peso de folha de cada centro (salário do quadro da empresa dele).
  const salarioDoCentro = (id: string) => {
    const c = centrosPorId.get(id);
    return c ? (quadroDe.get(c.conexaoId)?.porCentro.get(id)?.salarioCents ?? 0) : 0;
  };

  // Divide um valor entre centros por peso, com o resto do arredondamento no
  // maior — a soma das partes é sempre o todo.
  const dividir = (valor: number, pesos: [string, number][]): [string, number][] => {
    const total = pesos.reduce((a, [, p]) => a + p, 0);
    if (total <= 0 || pesos.length === 0) return [];
    const partes = pesos.map(([id, p]) => [id, Math.round((valor * p) / total)] as [string, number]);
    const diferenca = valor - partes.reduce((a, [, v]) => a + v, 0);
    if (diferenca !== 0) {
      const maior = partes.reduce((m, p, i) => (Math.abs(p[1]) > Math.abs(partes[m][1]) ? i : m), 0);
      partes[maior][1] += diferenca;
    }
    return partes;
  };

  // A partilha de uma origem ligada: [centro, fração] — frações somam ≤ 1.
  const partilhaDosVinculos = (lista: VinculoDoDre[]): [string, number][] => {
    if (lista.length === 1) return [[lista[0].centroCustoId, Math.min(100, Math.max(0, lista[0].percentual)) / 100]];
    const soma = lista.reduce((a, v) => a + v.percentual, 0);
    if (soma <= 100.0001) return lista.map((v) => [v.centroCustoId, v.percentual / 100]);
    // 100% em todos (ou soma acima de 100): pela folha; sem folha, igual.
    const pesos = lista.map((v) => salarioDoCentro(v.centroCustoId));
    const totalPesos = pesos.reduce((a, p) => a + p, 0);
    return lista.map((v, i) => [v.centroCustoId, totalPesos > 0 ? pesos[i] / totalPesos : 1 / lista.length]);
  };

  type Acumulado = { porLinha: Record<string, number>; detalhes: Map<string, DetalheDoCentro> };
  const acumulado = new Map<string, Acumulado>(e.centros.map((c) => [c.id, { porLinha: {}, detalhes: new Map() }]));
  const lancar = (centroId: string, linha: string, g: GrupoDeTitulos, via: Via, valor: number) => {
    if (valor === 0) return;
    const a = acumulado.get(centroId)!;
    somar(a.porLinha, linha, valor);
    const k = `${linha}|${g.categoria}|${via}`;
    const d = a.detalhes.get(k) ?? { linha, categoria: g.categoria, descricao: g.categoria === "RETENCAO" ? "Tributos retidos na fonte" : e.descricaoDaCategoria(g.categoria), via, efeitoCents: 0 };
    d.efeitoCents += valor;
    a.detalhes.set(k, d);
  };

  const naoAlocado: Record<string, number> = {};
  const origensNaoAlocadas = new Map<string, OrigemNaoAlocada>();
  const foraDoCentro: Record<string, number> = {};
  let semCategoriaCents = 0;
  let volumeOperacional = 0;
  let volumeAlocado = 0;
  // Folha sem centro por falta de quadro (e de departamento), por empresa.
  const folhaSemQuadro = new Map<string, number>();
  const cadastrados = e.centros;
  const todosCentros = [...e.centros];

  // O centro do departamento da Omie, criado na primeira vez que aparece.
  const centroDoDepartamento = (g: GrupoDeTitulos) => {
    const id = `dep:${g.conexaoId}|${g.departamento}`;
    if (!centrosPorId.has(id)) {
      const descricao = e.nomes?.departamentos?.get(`${g.conexaoId}|${g.departamento}`) ?? `Departamento ${g.departamento}`;
      const c: CentroDoDre = {
        id,
        conexaoId: g.conexaoId,
        codigo: g.departamento!,
        descricao,
        tipo: e.conexoesCorporativas.has(g.conexaoId) || ehNomeDeApoio(descricao) ? "APOIO" : "OPERACIONAL",
        empresa: e.empresas?.get(g.conexaoId) ?? "?",
        departamentoOmie: true,
      };
      centrosPorId.set(id, c);
      acumulado.set(id, { porLinha: {}, detalhes: new Map() });
      todosCentros.push(c);
    }
    return id;
  };

  const rotuloDaOrigem = (tipo: TipoOrigem, g: GrupoDeTitulos, valor: string) => {
    if (tipo === "PROJETO") return `Projeto · ${e.nomes?.projetos?.get(`${g.conexaoId}|${valor}`) ?? valor}`;
    if (tipo === "DEPARTAMENTO") return `Departamento · ${e.nomes?.departamentos?.get(`${g.conexaoId}|${valor}`) ?? valor}`;
    if (tipo === "PARCEIRO") return `${g.natureza === "RECEBER" ? "Cliente" : "Fornecedor"} · ${g.parceiroNome ?? valor}`;
    return valor === "RETENCAO" ? "Tributos retidos na fonte (sem cliente identificado)" : `Categoria · ${e.descricaoDaCategoria(valor)}`;
  };
  const candidatos = cadastrados.map((c) => ({ id: c.id, conexaoId: c.conexaoId, nomes: [c.descricao, ...(servicosPorCentro.get(c.id) ?? [])] }));

  const naoAlocar = (g: GrupoDeTitulos, linha: string, valor: number) => {
    if (valor === 0) return;
    somar(naoAlocado, linha, valor);
    // A origem mais específica que o grupo tem é a que se sugere ligar.
    const [tipo, v] = chavesDoGrupo(g).find(([, x]) => x) as [TipoOrigem, string];
    const k = `${tipo}|${g.conexaoId}|${v}`;
    const o =
      origensNaoAlocadas.get(k) ??
      ({ tipo, conexaoId: g.conexaoId, valor: v, rotulo: rotuloDaOrigem(tipo, g, v), efeitoCents: 0, titulos: 0, linhas: {}, sugestoes: [] } as OrigemNaoAlocada);
    o.efeitoCents += valor;
    o.titulos += g.titulos;
    somar(o.linhas, linha, valor);
    origensNaoAlocadas.set(k, o);
  };

  for (const g of e.grupos) {
    if (g.categoria === "SEM_CATEGORIA") {
      semCategoriaCents += g.cents;
      if (e.somarRetencoes && g.retencaoCents) naoAlocar({ ...g, categoria: "RETENCAO" }, "DEDUCOES", -g.retencaoCents);
      continue;
    }
    const linha = linhaDoGrupo(g);
    const efeito = efeitoDe(g, linha);
    const retencao = e.somarRetencoes ? -g.retencaoCents : 0;
    if (!OPERACIONAIS.has(linha)) {
      somar(foraDoCentro, linha, efeito);
      if (retencao) naoAlocar({ ...g, categoria: "RETENCAO" }, "DEDUCOES", retencao);
      continue;
    }
    volumeOperacional += Math.abs(efeito) + Math.abs(retencao);

    // 1. Vínculo, na ordem de precedência.
    let partilha: [string, number][] | null = null;
    for (const [tipo, valor] of chavesDoGrupo(g)) {
      if (!valor) continue;
      const lista = vinculosDe.get(`${tipo}|${g.conexaoId}|${valor}`);
      if (lista) {
        partilha = partilhaDosVinculos(lista);
        break;
      }
    }
    let via: Via = "VINCULO";
    // 2. O departamento da Omie, como no DRE.
    if (!partilha && g.departamento && e.departamentoComoCentro !== false) {
      partilha = [[centroDoDepartamento(g), 1]];
      via = "DEPARTAMENTO";
    }
    // 3. Folha, para pessoas sem vínculo nem departamento.
    if (!partilha && LINHAS_DE_PESSOAS.has(linha)) {
      const q = quadroDe.get(g.conexaoId);
      if (q) {
        const pesos = [...q.porCentro.entries()].filter(([id]) => centrosPorId.has(id)).map(([id, x]) => [id, x.salarioCents] as [string, number]);
        const total = pesos.reduce((a, [, p]) => a + p, 0);
        if (total > 0) {
          partilha = pesos.map(([id, p]) => [id, p / total]);
          via = "FOLHA";
        }
      } else folhaSemQuadro.set(g.conexaoId, (folhaSemQuadro.get(g.conexaoId) ?? 0) + efeito);
    }
    if (!partilha) {
      naoAlocar(g, linha, efeito);
      if (retencao) naoAlocar({ ...g, categoria: "RETENCAO" }, "DEDUCOES", retencao);
      continue;
    }

    // A parte de cada centro, e o que sobrar (percentuais abaixo de 100%) fica
    // não alocado.
    const distribuir = (valor: number, linhaDoValor: string, grupo: GrupoDeTitulos) => {
      const fracaoTotal = partilha!.reduce((a, [, f]) => a + f, 0);
      const alocavel = Math.round(valor * Math.min(1, fracaoTotal));
      const partes = dividir(alocavel, partilha!.map(([id, f]) => [id, f]));
      for (const [id, v] of partes) lancar(id, linhaDoValor, grupo, via, v);
      volumeAlocado += Math.abs(alocavel);
      if (valor - alocavel !== 0) naoAlocar(grupo, linhaDoValor, valor - alocavel);
    };
    distribuir(efeito, linha, g);
    if (retencao) distribuir(retencao, "DEDUCOES", { ...g, categoria: "RETENCAO" });
  }

  for (const [id, cents] of folhaSemQuadro)
    if (cents !== 0)
      avisos.push(
        `Folha da ${e.empresas?.get(id) ?? cadastrados.find((c) => c.conexaoId === id)?.empresa ?? "empresa"} sem departamento na Omie (${(Math.abs(cents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}) ficou não alocada: importe o quadro de pessoal dela para dividir pelo salário de cada centro.`
      );

  // Os centros, com os totais da margem direta.
  const centros: ResultadoDoCentro[] = todosCentros.map((c) => {
    const a = acumulado.get(c.id)!;
    const q = quadroDe.get(c.conexaoId)?.porCentro.get(c.id);
    const l = a.porLinha;
    const receitaCents = [...LINHAS_DE_RECEITA].reduce((s, k) => s + (l[k] ?? 0), 0);
    const deducoesCents = l.DEDUCOES ?? 0;
    const pessoasCents = [...LINHAS_DE_PESSOAS].reduce((s, k) => s + (l[k] ?? 0), 0);
    const margemCents = Object.values(l).reduce((s, v) => s + v, 0);
    return {
      ...c,
      pessoas: q?.pessoas ?? 0,
      salarioQuadroCents: q?.salarioCents ?? 0,
      porLinha: l,
      detalhes: [...a.detalhes.values()].sort((x, y) => Math.abs(y.efeitoCents) - Math.abs(x.efeitoCents)),
      receitaCents,
      deducoesCents,
      pessoasCents,
      demaisCents: margemCents - receitaCents - deducoesCents - pessoasCents,
      margemCents,
      rateioCents: 0,
      resultadoCents: margemCents,
      sugestoes: [],
    };
  });

  // O rateio do apoio entre os operacionais.
  if (e.rateio !== "NENHUM") {
    const apoio = centros.filter((c) => c.tipo === "APOIO");
    const operacionais = centros.filter((c) => c.tipo !== "APOIO");
    const peso = (c: ResultadoDoCentro) => (e.rateio === "RECEITA" ? Math.max(0, c.receitaCents) : c.salarioQuadroCents);
    const aRatear = apoio.reduce((s, c) => s + c.margemCents, 0);
    const pesos = operacionais.map((c) => [c.id, peso(c)] as [string, number]);
    const partes = dividir(aRatear, pesos);
    if (aRatear !== 0 && partes.length === 0) avisos.push(`Nenhum centro operacional tem ${e.rateio === "RECEITA" ? "receita" : "folha"} no mês: o apoio não foi rateado.`);
    else if (partes.length > 0) {
      for (const c of apoio) {
        c.rateioCents = -c.margemCents;
        c.resultadoCents = 0;
      }
      const porId = new Map(partes);
      for (const c of operacionais) {
        c.rateioCents = porId.get(c.id) ?? 0;
        c.resultadoCents = c.margemCents + c.rateioCents;
      }
    }
  }

  const naoAlocadoTotal = Object.values(naoAlocado).reduce((s, v) => s + v, 0);
  const alocadoCents = centros.reduce((s, c) => s + c.margemCents, 0);
  const origens = [...origensNaoAlocadas.values()]
    .filter((o) => o.efeitoCents !== 0)
    .sort((a, b) => Math.abs(b.efeitoCents) - Math.abs(a.efeitoCents));
  for (const c of centros)
    if (c.departamentoOmie) c.sugestoes = sugerirCentros(c.descricao, candidatos.filter((x) => x.conexaoId === c.conexaoId));
  for (const o of origens.slice(0, 80))
    if (o.tipo !== "CATEGORIA") {
      const daEmpresa = candidatos.filter((c) => c.conexaoId === o.conexaoId);
      o.sugestoes = sugerirCentros(o.rotulo.replace(/^[^·]+·\s*/, ""), daEmpresa.length > 0 ? daEmpresa : candidatos);
    }

  return {
    centros: centros.sort((a, b) => (a.tipo === b.tipo ? b.resultadoCents - a.resultadoCents : a.tipo === "APOIO" ? 1 : -1)),
    naoAlocado: { porLinha: naoAlocado, totalCents: naoAlocadoTotal, origens },
    foraDoCentro: { porLinha: foraDoCentro, totalCents: Object.values(foraDoCentro).reduce((s, v) => s + v, 0) },
    semCategoriaCents,
    ebitCents: alocadoCents + naoAlocadoTotal,
    alocadoCents,
    cobertura: volumeOperacional > 0 ? volumeAlocado / volumeOperacional : 0,
    avisos,
  };
}
