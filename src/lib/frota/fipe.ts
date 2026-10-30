// A TABELA FIPE, pela API pública do Parallelum (fipe.parallelum.com.br, sem
// cadastro: 1.000 consultas por dia; com FIPE_TOKEN no ambiente, o limite do
// plano). O modelo é escolhido UMA vez por veículo (tipo → marca → modelo →
// ano) e gravado pelo código FIPE + o código do ano; daí em diante o valor é
// relido pelo código, todo mês, pelo agente da frota.
//
// Vans e utilitários (Master, Sprinter, Transit, Ducato) estão em "carros";
// micro-ônibus e ônibus (Volare, Marcopolo, Agrale) em "caminhões". O que a
// FIPE não tem (carroceria escolar adaptada, unidade móvel) vai para o preço
// ajustado, que prevalece.

export const TIPOS_FIPE = ["cars", "trucks"] as const;
export type TipoFipe = (typeof TIPOS_FIPE)[number];
export const ROTULO_TIPO_FIPE: Record<TipoFipe, string> = { cars: "Carros e utilitários (vans)", trucks: "Caminhões, micro-ônibus e ônibus" };
export const ehTipoFipe = (x: unknown): x is TipoFipe => (TIPOS_FIPE as readonly unknown[]).includes(x);

export type ItemFipe = { codigo: string; nome: string };
export type PrecoFipe = { codigoFipe: string; modelo: string; marca: string; anoModelo: number; combustivel: string; valorCents: number; referencia: string };

const BASE = () => (process.env.FIPE_URL || "https://fipe.parallelum.com.br/api/v2").replace(/\/+$/, "");

export class FipeErro extends Error {}

async function consultar<T>(caminho: string): Promise<T> {
  const token = process.env.FIPE_TOKEN;
  let r: Response;
  try {
    r = await fetch(`${BASE()}${caminho}`, { headers: token ? { "X-Subscription-Token": token } : {}, signal: AbortSignal.timeout(15_000), cache: "no-store" });
  } catch {
    throw new FipeErro("A consulta à FIPE não respondeu. Tente de novo em instantes.");
  }
  if (r.status === 429) throw new FipeErro("Limite diário de consultas à FIPE atingido. O agente tenta de novo amanhã.");
  const corpo = (await r.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!r.ok || !corpo || (typeof corpo === "object" && "error" in corpo && corpo.error)) {
    throw new FipeErro(corpo && typeof corpo === "object" && "error" in corpo && corpo.error ? `FIPE: ${corpo.error}` : `FIPE respondeu ${r.status}.`);
  }
  return corpo;
}

const seg = (x: string) => encodeURIComponent(x);
const itens = (lista: { code: string; name: string }[]): ItemFipe[] => lista.map((x) => ({ codigo: String(x.code), nome: String(x.name) }));

export const listarMarcas = async (tipo: TipoFipe) => itens(await consultar(`/${tipo}/brands`));
export const listarModelos = async (tipo: TipoFipe, marca: string) => itens(await consultar(`/${tipo}/brands/${seg(marca)}/models`));
export const listarAnos = async (tipo: TipoFipe, marca: string, modelo: string) => itens(await consultar(`/${tipo}/brands/${seg(marca)}/models/${seg(modelo)}/years`));

type DetalheApi = { price: string; brand: string; model: string; modelYear: number; fuel: string; codeFipe: string; referenceMonth: string };
const lerDetalhe = (d: DetalheApi): PrecoFipe => {
  const valor = lerPrecoFipe(d.price);
  if (valor === null) throw new FipeErro(`Preço da FIPE ilegível: ${d.price}`);
  return { codigoFipe: d.codeFipe, modelo: d.model, marca: d.brand, anoModelo: d.modelYear, combustivel: d.fuel, valorCents: valor, referencia: d.referenceMonth };
};
export const consultarPreco = async (tipo: TipoFipe, marca: string, modelo: string, ano: string) => lerDetalhe(await consultar(`/${tipo}/brands/${seg(marca)}/models/${seg(modelo)}/years/${seg(ano)}`));
// A releitura mensal: pelo código FIPE e o código do ano, sem marca/modelo.
export const consultarPorCodigo = async (tipo: TipoFipe, codigoFipe: string, ano: string) => lerDetalhe(await consultar(`/${tipo}/${seg(codigoFipe)}/years/${seg(ano)}`));

// "R$ 40.202,00" → 4020200 centavos.
export function lerPrecoFipe(texto: string | null | undefined): number | null {
  const m = String(texto ?? "").replace(/\s/g, "").match(/^R\$?([\d.]+),(\d{2})$/);
  return m ? Number(m[1].replace(/\./g, "")) * 100 + Number(m[2]) : null;
}

// O TIPO DA FIPE pelo tipo do cadastro.
export const tipoFipeDoVeiculo = (tipo: string | null | undefined): TipoFipe => (["micro", "onibus", "caminhao"].includes(tipo ?? "") ? "trucks" : "cars");

// SUGESTÕES a partir do cadastro (marca, modelo e ano-modelo da planilha),
// para a escolha começar no lugar certo — quem decide é a pessoa.
const limpo = (x: string | null | undefined) =>
  String(x ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
// Como a marca aparece na planilha → como a FIPE a chama.
const APELIDO_MARCA: Record<string, string[]> = {
  MB: ["MERCEDES BENZ"],
  MERCEDES: ["MERCEDES BENZ"],
  "M BENZ": ["MERCEDES BENZ"],
  VW: ["VW VOLKSWAGEN", "VOLKSWAGEN"],
  VOLKS: ["VW VOLKSWAGEN", "VOLKSWAGEN"],
  VOLKSWAGEN: ["VW VOLKSWAGEN", "VOLKSWAGEN"],
  VOLARE: ["MARCOPOLO"],
  GM: ["GM CHEVROLET", "CHEVROLET"],
  CHEVROLET: ["GM CHEVROLET", "CHEVROLET"],
  CITROEN: ["CITROEN"],
};

export function marcaSugerida(marcas: ItemFipe[], marcaDoCadastro: string | null | undefined): ItemFipe | null {
  const alvo = limpo(marcaDoCadastro);
  if (!alvo) return null;
  const candidatos = [alvo, ...(APELIDO_MARCA[alvo] ?? [])];
  for (const c of candidatos) {
    const exata = marcas.find((m) => limpo(m.nome) === c);
    if (exata) return exata;
  }
  for (const c of candidatos) {
    const parcial = marcas.find((m) => limpo(m.nome).split(" ").includes(c) || limpo(m.nome).startsWith(c));
    if (parcial) return parcial;
  }
  return null;
}

// Os modelos que mais se parecem com o do cadastro primeiro (palavras em
// comum), o resto em ordem alfabética. Com o contexto do veículo, entre os
// que casam com o modelo: van, micro e ônibus de passageiros preferem as
// versões de passageiro (minibus, executivo, escolar, "16L") às de carga
// (chassi, furgão, cargo), e a capacidade e o uso do cadastro desempatam.
export type ContextoFipe = { tipo?: string | null; capacidade?: number | null; categoriaUso?: string | null };
const PASSAGEIRO = /\b(MINIBUS|BUS|VAN|EXECUTIVE|EXECUTIVO|EXEC|ESCOLAR|ESCO|STD|VIP|LUXO|STREET|COMBINATO|PASSAGEIRO\w*|LUG|LOTACAO|URBANO|FRETAMENTO|RURAL|\d+\s?L)\b/;
const CARGA = /\b(CHASSI|FURGAO|FURG|CARGO|MAXICARGO|PICK|CABINE|PRO|VITRE|FURGAOTB)\b/;
export function modelosParecidos(modelos: ItemFipe[], modeloDoCadastro: string | null | undefined, ctx: ContextoFipe = {}): (ItemFipe & { pontos: number; casou: boolean })[] {
  const palavras = limpo(modeloDoCadastro).split(" ").filter((p) => p.length >= 2);
  const deGente = ["van", "minivan", "micro", "onibus"].includes(ctx.tipo ?? "");
  const uso = ctx.categoriaUso ?? "";
  return modelos
    .map((m) => {
      const nome = ` ${limpo(m.nome)} `;
      const base = palavras.reduce((s, p) => s + (nome.includes(` ${p} `) ? 2 : nome.includes(p) ? 1 : 0), 0);
      let pontos = base;
      if (base > 0 && deGente) {
        if (PASSAGEIRO.test(nome)) pontos += 3;
        if (CARGA.test(nome)) pontos -= 5;
        if (ctx.capacidade && new RegExp(`\\b${ctx.capacidade}\\s?(L|LUG)`).test(nome)) pontos += 2;
        if (uso.startsWith("escolar") && /\bESCO(LAR)?\b/.test(nome)) pontos += 2;
        if (uso.startsWith("fretamento") && /\b(EXECUTIVE|EXECUTIVO|EXEC|VIP|LUXO|FRETAMENTO)\b/.test(nome)) pontos += 1;
      }
      return { ...m, pontos, casou: base > 0 };
    })
    .sort((a, b) => Number(b.casou) - Number(a.casou) || b.pontos - a.pontos || a.nome.localeCompare(b.nome, "pt-BR"));
}

// O ano: o ano-modelo do cadastro (diesel antes); veículo do ano que vem,
// ainda sem tabela, cai no "Zero KM" (32000).
export function anoSugerido(anos: ItemFipe[], anoModelo: number | null | undefined): ItemFipe | null {
  if (!anoModelo) return null;
  const doAno = anos.filter((a) => a.codigo.startsWith(`${anoModelo}-`));
  if (doAno.length) return doAno.find((a) => a.codigo.endsWith("-3")) ?? doAno[0];
  const zero = anos.filter((a) => a.codigo.startsWith("32000-"));
  const maisNovo = Math.max(0, ...anos.map((a) => Number(a.codigo.split("-")[0])).filter((n) => n < 32000));
  return zero.length && anoModelo > maisNovo ? (zero.find((a) => a.codigo.endsWith("-3")) ?? zero[0]) : null;
}

// A ESCOLHA JÁ SUGERIDA, passo a passo, para a tela abrir pronta: marca,
// modelo e ano tirados do cadastro, e o preço do que foi sugerido. Para onde
// a sugestão não chega (marca ou modelo sem par), a tela pede a escolha.
export type CadeiaFipe = { marcas: ItemFipe[]; marca: string; modelos: ItemFipe[]; modelo: string; anos: ItemFipe[]; ano: string; preco: PrecoFipe | null; erro?: string };
export async function cadeiaSugerida(tipo: TipoFipe, v: { marca: string | null; modelo: string | null; anoMod: number | null } & ContextoFipe): Promise<CadeiaFipe> {
  const c: CadeiaFipe = { marcas: [], marca: "", modelos: [], modelo: "", anos: [], ano: "", preco: null };
  try {
    c.marcas = await listarMarcas(tipo);
    c.marca = marcaSugerida(c.marcas, v.marca)?.codigo ?? "";
    if (!c.marca) return c;
    const modelos = modelosParecidos(await listarModelos(tipo, c.marca), v.modelo, v);
    c.modelos = modelos.map(({ codigo, nome }) => ({ codigo, nome }));
    // Dos mais parecidos, o primeiro que tem o ano do cadastro (uma versão
    // pode ter saído de linha antes do ano do veículo).
    const melhor = modelos[0]?.pontos ?? 0;
    const candidatos = modelos.filter((m) => m.casou && m.pontos >= melhor - 3).slice(0, 10);
    for (const m of candidatos) {
      const anos = await listarAnos(tipo, c.marca, m.codigo);
      const ano = anoSugerido(anos, v.anoMod)?.codigo ?? "";
      if (!c.modelo || ano) Object.assign(c, { modelo: m.codigo, anos, ano });
      if (ano) break;
    }
    if (c.ano) c.preco = await consultarPreco(tipo, c.marca, c.modelo, c.ano);
  } catch (e) {
    c.erro = e instanceof Error ? e.message : "Falha ao consultar a FIPE.";
  }
  return c;
}

// A TABELA DO MÊS: a FIPE publica a nova referência no começo do mês. O agente
// só relê o veículo cuja referência gravada não é a mais recente publicada
// ("outubro/2026" na lista, "outubro de 2026" no preço — a mesma).
export const chaveDaReferencia = (x: string | null | undefined) => limpo(x).replace(/\bDE\b/g, " ").replace(/\s+/g, " ").trim();
export async function ultimaReferencia(): Promise<string> {
  const lista = await consultar<{ code: string; month: string }[]>("/references");
  if (!lista.length) throw new FipeErro("A FIPE não devolveu as referências.");
  return lista[0].month;
}
