import { prisma } from "@/lib/prisma";
import { tabela } from "@/lib/esquemaDoBanco";
import { competenciaSql } from "@/lib/controladoria/competencia";
import { Prisma } from "@prisma/client";
import { CATEGORIA_SQL, ehCorporativoSql, filtroConexaoTitulo } from "@/lib/controladoria/escopoSql";
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
export const FORNECEDOR_CONTABILIDADE_PADRAO = "JL Business";

export const LINHAS_DOS_INDIRETOS: Record<string, string[]> = {
  folha_adm: ["DESPESA_SALARIOS_CORPORATIVO"],
  // Sem pagamento ao fornecedor na janela, a linha inteira (ver acima).
  contabilidade: ["DESPESA_ADMINISTRATIVA"],
  sistemas: ["DESPESA_INFORMATICA"],
  sede_garagem_sp: ["DESPESA_ESTRUTURA"],
  gerais: ["DESPESA_COMERCIAL", "DESPESA_GERAL"],
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
export type PagamentosDoFornecedor = { nome: string; porCategoria: Map<string, number[]> };

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

export function indiretosDoDre(dre: DreDosMeses, fornecedor?: PagamentosDoFornecedor | null, oficina?: FolhaDaOficina | null): Map<string, IndiretoDoDre> {
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
  const linhaDaCategoria = new Map(dre.categorias.filter((c) => !c.codigo.includes("@")).map((c) => [c.codigo, c]));
  const fornecedorNaLinha = (linha: string) => [...doFornecedor].reduce((a, [codigo, v]) => a + (linhaDaCategoria.get(codigo)?.linha === linha ? v : 0), 0);
  const mapa = comFornecedor ? LINHAS_COM_FORNECEDOR : LINHAS_DOS_INDIRETOS;

  if (comFornecedor) {
    resultado.set("contabilidade", {
      valor: Math.round(totalFornecedor) / 100,
      fonte: `${fornecedor.nome} — pagamentos no Omie, ${fonte.replace(/^DRE consolidado — /, "")}`,
      composicao: [...doFornecedor]
        .map(([codigo, v]) => ({ descricao: linhaDaCategoria.get(codigo)?.descricao ?? `Categoria ${codigo}`, valorMes: Math.round(v) / 100 }))
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
    const cents = linhas.reduce((a, l) => a + mediaCents(dre.linhasDre[l] ?? []) - (comFornecedor ? fornecedorNaLinha(l) : 0), 0) - semOficina;
    if (!(cents > 0.5)) continue;
    // Na composição, a categoria do fornecedor aparece sem a parte dele.
    const composicao = dre.categorias
      .filter((c) => linhas.includes(c.linha))
      .map((c) => ({ descricao: c.descricao, valorMes: Math.round(mediaCents(c.porMesCents) - (comFornecedor && !c.codigo.includes("@") ? (doFornecedor.get(c.codigo) ?? 0) : 0)) / 100 }))
      .filter((c) => c.valorMes > 0)
      .sort((a, b) => b.valorMes - a.valorMes);
    resultado.set(chave, {
      valor: Math.round(cents) / 100,
      fonte: semOficina > 0.5 ? `${fonte}, sem a oficina` : fonte,
      composicao,
      linhas: linhas.map((l) => LINHAS_DRE.find((x) => x.chave === l)?.rotulo.replace(/^\(-\) |^= /, "") ?? l),
    });
  }
  return resultado;
}

// O NOME NO OMIE: cada palavra do nome cadastrado pelo início (três letras),
// sem caixa — "JL Business" acha "JL BUSSINESS LTDA" e "Jl Business
// Contabilidade". Vazio = sem fornecedor (contabilidade pela linha do DRE).
export function padraoDoNome(nome: string): string | null {
  const partes = nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
    .map((p) => p.slice(0, 3));
  return partes.length === 0 ? null : `%${partes.join("%")}%`;
}

type LinhaFornecedor = { categoria: string; mes: string; cents: bigint };

// Os pagamentos ao fornecedor nos doze meses fechados, na visão do grupo (sem
// as operações entre as empresas), por categoria e mês de competência — o
// mesmo recorte do DRE.
export async function pagamentosDoFornecedor(companyId: string, nome: string, dataReferencia: Date, meses: string[]): Promise<PagamentosDoFornecedor | null> {
  const padrao = padraoDoNome(nome);
  if (!padrao || meses.length === 0) return null;
  const fechado = ultimoMesFechado(dataReferencia);
  const [ano, mes] = meses[0].split("-").map(Number);
  const inicio = new Date(ano, mes - 1, 1, 0, 0, 0, 0);
  const linhas = await prisma.$queryRaw<LinhaFornecedor[]>`
    SELECT ${CATEGORIA_SQL} AS categoria,
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
  return { nome: nome.trim(), porCategoria };
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
       AND ${CATEGORIA_SQL} IN (${Prisma.join(categorias)})
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

// Tudo junto, para as telas: o DRE dos doze meses e o fornecedor.
export async function indiretosDaEmpresa(companyId: string, dataReferencia: Date, base: BaseVigente | null, dre: DreDosMeses): Promise<Map<string, IndiretoDoDre>> {
  const [fornecedor, oficina] = await Promise.all([
    pagamentosDoFornecedor(companyId, fornecedorDaContabilidade(base), dataReferencia, dre.meses),
    folhaDaOficina(companyId, dataReferencia, dre),
  ]);
  return indiretosDoDre(dre, fornecedor, oficina);
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
