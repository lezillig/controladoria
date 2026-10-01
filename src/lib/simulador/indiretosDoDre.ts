import { prisma } from "@/lib/prisma";
import { tabela } from "@/lib/esquemaDoBanco";
import { competenciaSql } from "@/lib/controladoria/competencia";
import { Prisma } from "@prisma/client";
import { categoriaSql, ehCorporativoSql, filtroConexaoTitulo, naJanela } from "@/lib/controladoria/escopoSql";
import { LINHAS_DRE } from "@/lib/controladoria/dre";
import { ultimoMesFechado } from "@/lib/controladoria/periodos";
import type { BaseValor, BaseVigente } from "./baseDeCustos";
import type { DreDosMeses } from "./custosReais";

// OS CUSTOS INDIRETOS DA BASE, VINDOS DO DRE CONSOLIDADO. Enquanto a base não
// tem o valor digitado, cada indireto da aba 4 (administração central) é a
// média mensal da linha do DRE que o representa, nos doze meses fechados, na
// visão do grupo — Azul + MCZ, sem as operações entre elas, com a folha da
// empresa corporativa na linha própria. O que se classifica no DRE passa a
// ser o padrão do simulador; digitar um valor na base continua valendo acima.
//
// Oficina própria não tem linha no DRE (a manutenção está em Despesas com
// veículos, que é custo direto) e fica como está.
//
// CONTABILIDADE E JURÍDICO são um FORNECEDOR, não uma linha: o que se paga ao
// escritório contratado (parâmetro `contabilidade_fornecedor`, padrão JL
// Business). Com pagamentos a ele na janela, o valor é o deles, e o que eles
// ocupavam na linha do DRE onde estão classificados sai dessa linha — o resto
// das despesas administrativas vai para "despesas gerais". A soma dos
// indiretos continua a mesma do DRE: nada conta duas vezes, nada some.

//
// OFICINA PRÓPRIA é um CENTRO DE CUSTO: a folha da empresa corporativa
// lançada no departamento da Omie cujo nome tem "oficina". Sai da folha
// administrativa, que fica com o resto da linha corporativa.

export const CHAVE_FORNECEDOR_CONTABILIDADE = "contabilidade_fornecedor";
// Contabilidade (JL Business) e jurídico (Joel): um ou mais nomes, separados
// por ";". O valor é a soma dos pagamentos a todos.
export const FORNECEDOR_CONTABILIDADE_PADRAO = "JL Business; Joel";

// FORA DA ADMINISTRAÇÃO CENTRAL: o que está nas linhas de estrutura do DRE
// mas não é estrutura — e por isso não se rateia nos contratos. Por
// FORNECEDOR (pagamentos no Omie, como a contabilidade; padrão: o advogado
// Manoel) e por CATEGORIA (a descrição da categoria contém o texto; padrão:
// Compra de Serviços, a terceirização com outras empresas de transporte, que
// é custo da operação). Nomes separados por ";". Sai do custo e não entra em
// nenhum outro.
export const CHAVE_FORNECEDORES_FORA = "fornecedores_fora_adm";
// A parte das despesas com sócios que entra na administração central.
export const CHAVE_SOCIOS_PCT = "socios_pct_adm";
export const CHAVE_CATEGORIAS_FORA = "categorias_fora_adm";
export const FORNECEDORES_FORA_PADRAO = "Manoel";
export const CATEGORIAS_FORA_PADRAO = "Compra de Serviços";

export type ForaDaAdministracao = {
  // Pagamentos aos fornecedores excluídos, por categoria e mês.
  fornecedores: PagamentosDoFornecedor | null;
  // Textos que, contidos na descrição da categoria, a excluem.
  categorias: string[];
};

const normalizar = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

// As categorias excluídas (fora da linha corporativa de pessoas) e o que os
// fornecedores excluídos têm nas demais, por categoria e mês (centavos).
export function exclusoesDoDre(dre: DreDosMeses, fora: ForaDaAdministracao | null | undefined) {
  const textos = (fora?.categorias ?? []).map(normalizar).filter(Boolean);
  const categorias = dre.categorias.filter((c) => c.linha !== "DESPESA_SALARIOS_CORPORATIVO" && textos.some((t) => normalizar(c.descricao).includes(t)));
  const codigos = new Set(categorias.map((c) => c.codigo));
  const fornecedorPorCategoria = new Map<string, number[]>();
  for (const [codigo, porMes] of fora?.fornecedores?.porCategoria ?? []) if (!codigos.has(codigo)) fornecedorPorCategoria.set(codigo, porMes);
  return { categorias, codigos, fornecedorPorCategoria, nomeFornecedores: fora?.fornecedores?.nome ?? null };
}

export const LINHAS_DOS_INDIRETOS: Record<string, string[]> = {
  folha_adm: ["DESPESA_SALARIOS_CORPORATIVO"],
  // Sem pagamento ao fornecedor na janela, a linha inteira (ver acima).
  contabilidade: ["DESPESA_ADMINISTRATIVA"],
  sistemas: ["DESPESA_INFORMATICA"],
  sede_garagem_sp: ["DESPESA_ESTRUTURA"],
  gerais: ["DESPESA_COMERCIAL", "DESPESA_GERAL"],
  // Pró-labore e despesas com sócios: estrutura, na parte que a base disser
  // (CHAVE_SOCIOS_PCT, padrão 100%).
  socios: ["DESPESA_SOCIOS"],
  faturamento_medio: ["RECEITA_BRUTA"],
};

export type IndiretoDoDre = {
  // R$ por mês (a unidade da base), média dos meses com receita.
  valor: number;
  fonte: string;
  // As categorias que compõem o valor, as maiores primeiro.
  composicao: { descricao: string; valorMes: number }[];
  linhas: string[];
};

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotuloMes = (chave: string) => {
  const [ano, mes] = chave.split("-");
  return `${MESES[Number(mes) - 1]}/${ano.slice(2)}`;
};

// Os pagamentos ao fornecedor, por categoria e mês (centavos, alinhados com
// `DreDosMeses.meses`).
export type PagamentosDoFornecedor = {
  nome: string;
  // Todos os fornecedores somados, por categoria (para tirar da linha do DRE).
  porCategoria: Map<string, number[]>;
  // Cada fornecedor, por mês (para a composição).
  porNome?: Map<string, number[]>;
};

// Com o fornecedor: contabilidade = o que se pagou a ele; as linhas onde ele
// está classificado perdem essa parte; as despesas administrativas que sobram
// vão para "gerais".
const LINHAS_COM_FORNECEDOR: Record<string, string[]> = {
  ...LINHAS_DOS_INDIRETOS,
  contabilidade: [],
  gerais: ["DESPESA_ADMINISTRATIVA", "DESPESA_COMERCIAL", "DESPESA_GERAL"],
};

// Média dos meses COM RECEITA: mês antes do início da base (sem título
// nenhum) não pode puxar a média para baixo.
// A folha da oficina por mês (centavos, alinhados com `DreDosMeses.meses`) e
// o nome dos centros de custo que a formam.
export type FolhaDaOficina = { centros: string[]; porMes: number[] };

export function indiretosDoDre(
  dre: DreDosMeses,
  fornecedor?: PagamentosDoFornecedor | null,
  oficina?: FolhaDaOficina | null,
  fora?: ForaDaAdministracao | null
): Map<string, IndiretoDoDre> {
  const resultado = new Map<string, IndiretoDoDre>();
  const receita = dre.linhasDre.RECEITA_BRUTA ?? [];
  const meses = dre.meses.map((_, i) => i).filter((i) => (receita[i] ?? 0) > 0);
  if (meses.length === 0) return resultado;
  const periodo =
    meses.length === 1 ? rotuloMes(dre.meses[meses[0]]) : `${rotuloMes(dre.meses[meses[0]])} a ${rotuloMes(dre.meses[meses[meses.length - 1]])}`;
  const fonte = `DRE consolidado — média de ${meses.length} ${meses.length === 1 ? "mês fechado" : "meses fechados"} (${periodo})`;
  const mediaCents = (valores: number[]) => meses.reduce((a, i) => a + Math.abs(valores[i] ?? 0), 0) / meses.length;

  // O fornecedor por categoria (média) e por linha do DRE.
  const doFornecedor = new Map<string, number>();
  for (const [codigo, porMes] of fornecedor?.porCategoria ?? []) doFornecedor.set(codigo, mediaCents(porMes));
  const totalFornecedor = [...doFornecedor.values()].reduce((a, v) => a + v, 0);
  const comFornecedor = fornecedor != null && totalFornecedor > 0;
  const linhaDaCategoria = new Map(dre.categorias.filter((c) => c.linha !== "DESPESA_SALARIOS_CORPORATIVO").map((c) => [c.codigo, c]));
  const fornecedorNaLinha = (linha: string) => [...doFornecedor].reduce((a, [codigo, v]) => a + (linhaDaCategoria.get(codigo)?.linha === linha ? v : 0), 0);
  const mapa = comFornecedor ? LINHAS_COM_FORNECEDOR : LINHAS_DOS_INDIRETOS;
  // O que sai da administração: as categorias excluídas inteiras e a parte
  // dos fornecedores excluídos nas outras.
  const ex = exclusoesDoDre(dre, fora);
  const foraPorCategoria = new Map<string, number>();
  for (const c of ex.categorias) foraPorCategoria.set(c.codigo, mediaCents(c.porMesCents));
  for (const [codigo, porMes] of ex.fornecedorPorCategoria) foraPorCategoria.set(codigo, (foraPorCategoria.get(codigo) ?? 0) + mediaCents(porMes));
  const foraNaLinha = (linha: string) => [...foraPorCategoria].reduce((a, [codigo, v]) => a + (linhaDaCategoria.get(codigo)?.linha === linha ? v : 0), 0);
  const nomesFora = [...ex.categorias.map((c) => c.descricao), ...(ex.fornecedorPorCategoria.size ? [ex.nomeFornecedores ?? ""] : [])].filter(Boolean);

  if (comFornecedor) {
    resultado.set("contabilidade", {
      valor: Math.round(totalFornecedor) / 100,
      fonte: `${fornecedor.nome} — pagamentos no Omie, ${fonte.replace(/^DRE consolidado — /, "")}`,
      composicao: (fornecedor.porNome && fornecedor.porNome.size > 0
        ? [...fornecedor.porNome].map(([nome, porMes]) => ({ descricao: nome, valorMes: Math.round(mediaCents(porMes)) / 100 }))
        : [...doFornecedor].map(([codigo, v]) => ({ descricao: linhaDaCategoria.get(codigo)?.descricao ?? `Categoria ${codigo}`, valorMes: Math.round(v) / 100 }))
      )
        .filter((c) => c.valorMes > 0)
        .sort((a, b) => b.valorMes - a.valorMes),
      linhas: [`Pagamentos a ${fornecedor.nome}`],
    });
  }

  const oficinaCents = oficina ? mediaCents(oficina.porMes) : 0;
  if (oficina && oficinaCents > 0.5) {
    resultado.set("oficina", {
      valor: Math.round(oficinaCents) / 100,
      fonte: `centro de custo ${oficina.centros.join(", ")} — ${fonte.replace(/^DRE consolidado — /, "")}`,
      composicao: [],
      linhas: [`Despesas com pessoas — corporativo, centro de custo ${oficina.centros.join(", ")}`],
    });
  }

  for (const [chave, linhas] of Object.entries(mapa)) {
    if (linhas.length === 0) continue;
    const semOficina = chave === "folha_adm" ? oficinaCents : 0;
    const cents = linhas.reduce((a, l) => a + mediaCents(dre.linhasDre[l] ?? []) - (comFornecedor ? fornecedorNaLinha(l) : 0) - foraNaLinha(l), 0) - semOficina;
    const tirouAlgo = linhas.some((l) => foraNaLinha(l) > 0.5);
    if (!(cents > 0.5)) continue;
    // Na composição, a categoria do fornecedor aparece sem a parte dele.
    const composicao = dre.categorias
      .filter((c) => linhas.includes(c.linha) && !ex.codigos.has(c.codigo))
      .map((c) => ({
        descricao: c.descricao,
        valorMes:
          Math.round(
            mediaCents(c.porMesCents) -
              (comFornecedor && c.linha !== "DESPESA_SALARIOS_CORPORATIVO" ? (doFornecedor.get(c.codigo) ?? 0) : 0) -
              (c.linha !== "DESPESA_SALARIOS_CORPORATIVO" ? (foraPorCategoria.get(c.codigo) ?? 0) : 0)
          ) / 100,
      }))
      .filter((c) => c.valorMes > 0)
      .sort((a, b) => b.valorMes - a.valorMes);
    resultado.set(chave, {
      valor: Math.round(cents) / 100,
      fonte: `${fonte}${semOficina > 0.5 ? ", sem a oficina" : ""}${tirouAlgo ? `, sem ${nomesFora.join(" e ")} (fora da administração)` : ""}`,
      composicao,
      linhas: linhas.map((l) => LINHAS_DRE.find((x) => x.chave === l)?.rotulo.replace(/^\(-\) |^= /, "") ?? l),
    });
  }
  return resultado;
}

// O NOME NO OMIE, sem caixa nem acento. Com várias palavras, cada uma pelo
// início (três letras) — "JL Business" acha "JL BUSSINESS LTDA". Com uma só,
// a palavra inteira — "Joel" não pode virar "JOE". Vazio = sem fornecedor
// (contabilidade pela linha do DRE).
export function padraoDoNome(nome: string): string | null {
  const palavras = nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  if (palavras.length === 0) return null;
  const partes = palavras.length === 1 ? palavras : palavras.map((p) => p.slice(0, 3));
  return `%${partes.join("%")}%`;
}

// "JL Business; Joel" → ["JL Business", "Joel"].
export const nomesDosFornecedores = (texto: string) =>
  texto
    .split(/[;\n]/)
    .map((n) => n.trim())
    .filter(Boolean);

type LinhaFornecedor = { categoria: string; mes: string; cents: bigint };

// Os pagamentos ao fornecedor nos doze meses fechados, na visão do grupo (sem
// as operações entre as empresas), por categoria e mês de competência — o
// mesmo recorte do DRE.
export async function pagamentosDoFornecedor(companyId: string, nomes: string, dataReferencia: Date, meses: string[]): Promise<PagamentosDoFornecedor | null> {
  const lista = nomesDosFornecedores(nomes).filter((n) => padraoDoNome(n) !== null);
  if (lista.length === 0 || meses.length === 0) return null;
  const porCategoria = new Map<string, number[]>();
  const porNome = new Map<string, number[]>();
  for (const nome of lista) {
    const um = await pagamentosDeUmFornecedor(companyId, nome, dataReferencia, meses);
    const total = new Array<number>(meses.length).fill(0);
    for (const [categoria, v] of um) {
      const acumulado = porCategoria.get(categoria) ?? new Array<number>(meses.length).fill(0);
      v.forEach((x, i) => {
        acumulado[i] += x;
        total[i] += x;
      });
      porCategoria.set(categoria, acumulado);
    }
    porNome.set(nome, total);
  }
  return { nome: lista.join(" e "), porCategoria, porNome };
}

async function pagamentosDeUmFornecedor(companyId: string, nome: string, dataReferencia: Date, meses: string[]): Promise<Map<string, number[]>> {
  const padrao = padraoDoNome(nome)!;
  const fechado = ultimoMesFechado(dataReferencia);
  const [ano, mes] = meses[0].split("-").map(Number);
  const inicio = new Date(ano, mes - 1, 1, 0, 0, 0, 0);
  const linhas = await prisma.$queryRaw<LinhaFornecedor[]>`
    SELECT ${categoriaSql()} AS categoria,
           to_char(${competenciaSql("t")}, 'YYYY-MM') AS mes,
           COALESCE(SUM(t."valorDocumentoCents"), 0)::bigint AS cents
      FROM ${tabela("OmieTitulo")} t
     WHERE t."companyId" = ${companyId}
       AND t.natureza = 'PAGAR'
       AND t.cancelado = false
       AND translate(upper(COALESCE(t."parceiroNome", '')), 'ÁÀÂÃÉÊÍÓÔÕÚÇ', 'AAAAEEIOOOUC') LIKE ${padrao}
       AND ${competenciaSql("t")} >= ${inicio}
       AND ${competenciaSql("t")} <= ${fechado.fim}
       ${filtroConexaoTitulo(null, companyId)}
     GROUP BY 1, 2
  `;
  const porCategoria = new Map<string, number[]>();
  for (const l of linhas) {
    const i = meses.indexOf(l.mes);
    if (i < 0) continue;
    const v = porCategoria.get(l.categoria) ?? new Array<number>(meses.length).fill(0);
    v[i] += Number(l.cents);
    porCategoria.set(l.categoria, v);
  }
  return porCategoria;
}

type LinhaOficina = { centro: string; mes: string; cents: bigint };

// A folha da empresa corporativa nos centros de custo de oficina, por mês, no
// recorte do DRE (competência, visão do grupo, doze meses fechados) e nas
// categorias que o DRE pôs na linha corporativa.
export async function folhaDaOficina(companyId: string, dataReferencia: Date, dre: DreDosMeses): Promise<FolhaDaOficina | null> {
  const categorias = [...new Set(dre.categorias.filter((c) => c.linha === "DESPESA_SALARIOS_CORPORATIVO").map((c) => c.codigo.replace(/@corporativo$/, "")))];
  if (categorias.length === 0 || dre.meses.length === 0) return null;
  const fechado = ultimoMesFechado(dataReferencia);
  const [ano, mes] = dre.meses[0].split("-").map(Number);
  const linhas = await prisma.$queryRaw<LinhaOficina[]>`
    SELECT d.descricao AS centro,
           to_char(${competenciaSql("t")}, 'YYYY-MM') AS mes,
           COALESCE(SUM(t."valorDocumentoCents"), 0)::bigint AS cents
      FROM ${tabela("OmieTitulo")} t
      JOIN ${tabela("OmieDepartamento")} d ON d."conexaoId" = t."conexaoId" AND d.codigo = t."departamentoCodigo"
     WHERE t."companyId" = ${companyId}
       AND t.cancelado = false
       AND d.descricao ILIKE '%oficina%'
       AND ${ehCorporativoSql(companyId)}
       AND ${categoriaSql()} IN (${Prisma.join(categorias)})
       AND ${competenciaSql("t")} >= ${new Date(ano, mes - 1, 1, 0, 0, 0, 0)}
       AND ${competenciaSql("t")} <= ${fechado.fim}
       ${filtroConexaoTitulo(null, companyId)}
     GROUP BY 1, 2
  `;
  if (linhas.length === 0) return null;
  const porMes = new Array<number>(dre.meses.length).fill(0);
  for (const l of linhas) {
    const i = dre.meses.indexOf(l.mes);
    if (i >= 0) porMes[i] += Math.abs(Number(l.cents));
  }
  return { centros: [...new Set(linhas.map((l) => l.centro))].sort(), porMes };
}

// O nome do fornecedor da contabilidade: o da base, ou o padrão.
export function fornecedorDaContabilidade(base: BaseVigente | null): string {
  const texto = base?.parametros.get(CHAVE_FORNECEDOR_CONTABILIDADE)?.texto;
  return texto === undefined || texto === null ? FORNECEDOR_CONTABILIDADE_PADRAO : texto.trim();
}

// Os textos de "fora da administração" da base, ou os padrões.
export function textosForaDaAdministracao(texto: (chave: string) => string | null | undefined): { fornecedores: string; categorias: string } {
  const ou = (v: string | null | undefined, padrao: string) => (v === undefined || v === null ? padrao : v.trim());
  return { fornecedores: ou(texto(CHAVE_FORNECEDORES_FORA), FORNECEDORES_FORA_PADRAO), categorias: ou(texto(CHAVE_CATEGORIAS_FORA), CATEGORIAS_FORA_PADRAO) };
}

export async function foraDaAdministracao(companyId: string, dataReferencia: Date, meses: string[], textos: { fornecedores: string; categorias: string }): Promise<ForaDaAdministracao> {
  return {
    fornecedores: await pagamentosDoFornecedor(companyId, textos.fornecedores, dataReferencia, meses),
    categorias: nomesDosFornecedores(textos.categorias),
  };
}

// Tudo junto, para as telas: o DRE dos doze meses, o fornecedor da
// contabilidade, a oficina e o que fica fora da administração.
export async function indiretosDaEmpresa(companyId: string, dataReferencia: Date, base: BaseVigente | null, dre: DreDosMeses): Promise<Map<string, IndiretoDoDre>> {
  const textos = textosForaDaAdministracao((chave) => base?.parametros.get(chave)?.texto);
  const [fornecedor, oficina, fora] = await Promise.all([
    pagamentosDoFornecedor(companyId, fornecedorDaContabilidade(base), dataReferencia, dre.meses),
    folhaDaOficina(companyId, dataReferencia, dre),
    foraDaAdministracao(companyId, dataReferencia, dre.meses, textos),
  ]);
  return indiretosDoDre(dre, fornecedor, oficina, fora);
}

// A base com os indiretos do DRE onde ela não tem valor. Não grava nada: é a
// leitura com que o estudo novo abre. Sem base nenhuma, nasce uma só com eles.
export function baseComIndiretosDoDre(base: BaseVigente, doDre: Map<string, IndiretoDoDre>): BaseVigente;
export function baseComIndiretosDoDre(base: BaseVigente | null, doDre: Map<string, IndiretoDoDre>): BaseVigente | null;
export function baseComIndiretosDoDre(base: BaseVigente | null, doDre: Map<string, IndiretoDoDre>): BaseVigente | null {
  if (doDre.size === 0) return base;
  const parametros = new Map<string, BaseValor>(base?.parametros ?? []);
  for (const [chave, v] of doDre) {
    if (parametros.get(chave)?.valor != null) continue;
    parametros.set(chave, { valor: v.valor, texto: null, fonte: v.fonte, vigenciaInicio: new Date() });
  }
  return base ? { ...base, parametros } : { em: new Date(), parametros, veiculos: [], funcoes: [], pedagios: [] };
}

// OS LANÇAMENTOS DE CADA CUSTO DE ESTRUTURA — os títulos do Omie que formam
// cada indireto nos doze meses fechados, no recorte do DRE (competência,
// visão do grupo), para a planilha da administração central. A classificação
// é a de indiretosDoDre: a folha corporativa pela parte da MCZ (a oficina
// pelo centro de custo), a contabilidade pelos pagamentos ao fornecedor, o
// resto pela linha do DRE da categoria. O que o DRE tem e não é título
// (movimentos de caixa sem título, ajustes) aparece na planilha como a
// diferença para o subtotal.

// Os lançamentos excluídos ficam na planilha com este "custo", fora das somas.
export const INDIRETO_FORA = "fora_da_administracao";

export type LancamentoIndireto = {
  indireto: string;
  categoria: string;
  categoriaCodigo: string;
  mes: string;
  empresa: string;
  fornecedor: string;
  documento: string;
  centroDeCusto: string;
  emissao: Date | null;
  vencimento: Date;
  // Reais, com o sinal da despesa: positivo pesa, negativo (estorno) alivia.
  valor: number;
};

export type TituloDoIndireto = {
  empresa: string;
  categoria: string;
  categoriaDescricao: string | null;
  mes: string;
  fornecedor: string | null;
  documento: string | null;
  parcela: string | null;
  centroDeCusto: string | null;
  emissao: Date | null;
  vencimento: Date;
  natureza: string;
  cents: number;
  corporativo: boolean;
};

const semAcentoMaiusculo = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
// O padrão LIKE de padraoDoNome ("%JL%BUS%") aplicado em JavaScript.
export function casaComPadrao(nome: string | null, padrao: string): boolean {
  if (!nome) return false;
  const regex = new RegExp(`^${padrao.split("%").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
  return regex.test(semAcentoMaiusculo(nome));
}

// Pura: decide o indireto de cada título (ou nenhum).
export function classificarTitulos(
  titulos: TituloDoIndireto[],
  dre: DreDosMeses,
  fornecedores: string[],
  fora: { fornecedores: string[]; categorias: string[] } = { fornecedores: [], categorias: [] }
): LancamentoIndireto[] {
  const padroesFora = fora.fornecedores.map(padraoDoNome).filter((p): p is string => p !== null);
  const textosFora = fora.categorias.map(normalizar).filter(Boolean);
  const padroes = fornecedores.map(padraoDoNome).filter((p): p is string => p !== null);
  const comFornecedor = padroes.length > 0;
  const mapa = comFornecedor ? LINHAS_COM_FORNECEDOR : LINHAS_DOS_INDIRETOS;
  const indiretoDaLinha = new Map<string, string>();
  for (const [chave, linhas] of Object.entries(mapa)) if (chave !== "faturamento_medio" && chave !== "folha_adm") for (const l of linhas) indiretoDaLinha.set(l, chave);
  // A mesma categoria de pessoal tem duas entradas (operação e corporativo),
  // com o mesmo código: a da linha corporativa é a da folha da MCZ.
  const CORP = "DESPESA_SALARIOS_CORPORATIVO";
  const linhaDaCategoria = new Map(dre.categorias.filter((c) => c.linha !== CORP).map((c) => [c.codigo, c]));
  const corporativas = new Map(dre.categorias.filter((c) => c.linha === CORP).map((c) => [c.codigo, c]));
  const meses = new Set(dre.meses);
  const r: LancamentoIndireto[] = [];
  for (const t of titulos) {
    if (!meses.has(t.mes)) continue;
    let indireto: string | null = null;
    let descricao = t.categoriaDescricao ?? linhaDaCategoria.get(t.categoria)?.descricao ?? t.categoria;
    // Folha corporativa: a parte da MCZ nas categorias de pessoas, ou a
    // categoria inteira quando ela foi classificada direto no corporativo (só
    // existe na linha corporativa — o PJ pago pela Azul).
    if (corporativas.has(t.categoria) && (t.corporativo || !linhaDaCategoria.has(t.categoria))) {
      indireto = /oficina/i.test(t.centroDeCusto ?? "") ? "oficina" : "folha_adm";
      descricao = corporativas.get(t.categoria)?.descricao ?? descricao;
    } else {
      const linha = linhaDaCategoria.get(t.categoria)?.linha;
      if (!linha) continue;
      const foraPorCategoria = textosFora.some((x) => normalizar(linhaDaCategoria.get(t.categoria)?.descricao ?? "").includes(x));
      if ((foraPorCategoria || padroesFora.some((p) => casaComPadrao(t.fornecedor, p))) && indiretoDaLinha.has(linha)) indireto = INDIRETO_FORA;
      else if (comFornecedor && padroes.some((p) => casaComPadrao(t.fornecedor, p)) && indiretoDaLinha.has(linha)) indireto = "contabilidade";
      else indireto = indiretoDaLinha.get(linha) ?? null;
    }
    if (!indireto) continue;
    const valor = (t.natureza === "RECEBER" ? -1 : 1) * Math.abs(t.cents) / 100;
    r.push({
      indireto,
      categoria: descricao,
      categoriaCodigo: t.categoria,
      mes: t.mes,
      empresa: t.empresa,
      fornecedor: t.fornecedor ?? "(sem fornecedor)",
      documento: [t.documento, t.parcela].filter(Boolean).join(" / "),
      centroDeCusto: t.centroDeCusto ?? "",
      emissao: t.emissao,
      vencimento: t.vencimento,
      valor,
    });
  }
  return r.sort((a, b) => a.indireto.localeCompare(b.indireto) || a.categoria.localeCompare(b.categoria) || b.valor - a.valor);
}

type LinhaTitulo = {
  empresa: string;
  categoria: string;
  categoria_descricao: string | null;
  mes: string;
  fornecedor: string | null;
  documento: string | null;
  parcela: string | null;
  centro: string | null;
  emissao: Date | null;
  vencimento: Date;
  natureza: string;
  cents: number;
  corp: boolean;
};

export async function lancamentosDosIndiretos(
  companyId: string,
  dataReferencia: Date,
  dre: DreDosMeses,
  fornecedores: string,
  fora: { fornecedores: string; categorias: string } = { fornecedores: "", categorias: "" }
): Promise<LancamentoIndireto[]> {
  const linhasDosIndiretos = new Set([...Object.values(LINHAS_COM_FORNECEDOR), ...Object.values(LINHAS_DOS_INDIRETOS)].flat());
  const codigos = [...new Set(dre.categorias.filter((c) => linhasDosIndiretos.has(c.linha)).map((c) => c.codigo))];
  if (codigos.length === 0 || dre.meses.length === 0) return [];
  const fechado = ultimoMesFechado(dataReferencia);
  const [ano, mes] = dre.meses[0].split("-").map(Number);
  const linhas = await prisma.$queryRaw<LinhaTitulo[]>`
    SELECT t."conexaoApelido" AS empresa,
           ${categoriaSql()} AS categoria,
           t."categoriaDescricao" AS categoria_descricao,
           to_char(${competenciaSql("t")}, 'YYYY-MM') AS mes,
           t."parceiroNome" AS fornecedor,
           t."numeroDocumento" AS documento,
           t."numeroParcela" AS parcela,
           d.descricao AS centro,
           t."dataEmissao" AS emissao,
           t."dataVencimento" AS vencimento,
           t.natureza::text AS natureza,
           t."valorDocumentoCents" AS cents,
           ${ehCorporativoSql(companyId)} AS corp
      FROM ${tabela("OmieTitulo")} t
      LEFT JOIN ${tabela("OmieDepartamento")} d ON d."conexaoId" = t."conexaoId" AND d.codigo = t."departamentoCodigo"
     WHERE t."companyId" = ${companyId}
       AND t.cancelado = false
       AND ${categoriaSql()} IN (${Prisma.join(codigos)})
       AND ${competenciaSql("t")} >= ${new Date(ano, mes - 1, 1, 0, 0, 0, 0)}
       AND ${competenciaSql("t")} <= ${fechado.fim}
       ${filtroConexaoTitulo(null, companyId)}
       ${naJanela({ desde: new Date(ano, mes - 1, 1, 0, 0, 0, 0), ate: null })}
  `;
  return classificarTitulos(
    linhas.map((l) => ({
      empresa: l.empresa,
      categoria: l.categoria,
      categoriaDescricao: l.categoria_descricao,
      mes: l.mes,
      fornecedor: l.fornecedor,
      documento: l.documento,
      parcela: l.parcela,
      centroDeCusto: l.centro,
      emissao: l.emissao,
      vencimento: l.vencimento,
      natureza: l.natureza,
      cents: Number(l.cents),
      corporativo: Boolean(l.corp),
    })),
    dre,
    nomesDosFornecedores(fornecedores),
    { fornecedores: nomesDosFornecedores(fora.fornecedores), categorias: nomesDosFornecedores(fora.categorias) }
  );
}
