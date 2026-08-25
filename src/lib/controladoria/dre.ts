import type { Periodo } from "./periodos";
import { dentro } from "./periodos";
import { dataDeCompetencia } from "./competencia";
import { titulosAtivos, somar } from "./agents/comum";
import type { ContextoAuditoria } from "./types";

// DEMONSTRAÇÃO DO RESULTADO DO EXERCÍCIO.
//
// A estrutura abaixo é a do art. 187 da Lei 6.404/76, na ordem em que a lei a
// define. Ela é FIXA e vive no código; o que é configurável é a ligação entre
// o plano de categorias real da empresa e estas linhas (ver DreClassificacao).
//
// A razão de a estrutura ser fixa: um DRE não é um relatório de agrupamento
// livre. A ordem das linhas É a demonstração — receita bruta menos deduções dá
// receita líquida, e nenhuma outra sequência responde "a operação deu lucro?".
// Deixar a ordem configurável produziria demonstrações que somam certo e não
// significam nada, e ninguém notaria.
//
// O que O USUÁRIO monta por cima são SUBGRUPOS dentro de cada linha — "Frota",
// "Pessoal operacional", "Sede" — que viram subtotais sem alterar a espinha.
//
// COMO ISTO SE DIFERENCIA DO DRE CONTÁBIL OFICIAL, e por que a tela precisa
// dizer: aqui o regime é o de COMPETÊNCIA dos títulos, pela data de emissão do
// documento. Não há provisão, não há apropriação de despesa antecipada, não há
// depreciação — a depreciação não passa por título e este sistema espelha
// títulos. É uma demonstração GERENCIAL na estrutura legal: serve para decidir
// no dia 5, não para assinar balanço.

export const LINHAS_DRE = [
  { chave: "RECEITA_BRUTA", rotulo: "Receita operacional bruta", tipo: "GRUPO", sinal: 1 },
  { chave: "DEDUCOES", rotulo: "(-) Deduções da receita bruta", tipo: "GRUPO", sinal: -1 },
  { chave: "RECEITA_LIQUIDA", rotulo: "= Receita operacional líquida", tipo: "SUBTOTAL", sinal: 1 },
  { chave: "CUSTO_SERVICO", rotulo: "(-) Custo dos serviços prestados", tipo: "GRUPO", sinal: -1 },
  { chave: "LUCRO_BRUTO", rotulo: "= Lucro bruto", tipo: "SUBTOTAL", sinal: 1 },
  { chave: "DESPESA_COMERCIAL", rotulo: "(-) Despesas comerciais", tipo: "GRUPO", sinal: -1 },
  { chave: "DESPESA_ADMINISTRATIVA", rotulo: "(-) Despesas administrativas", tipo: "GRUPO", sinal: -1 },
  { chave: "DESPESA_GERAL", rotulo: "(-) Outras despesas operacionais", tipo: "GRUPO", sinal: -1 },
  { chave: "EBIT", rotulo: "= Resultado antes do financeiro (EBIT)", tipo: "SUBTOTAL", sinal: 1 },
  { chave: "RECEITA_FINANCEIRA", rotulo: "(+) Receitas financeiras", tipo: "GRUPO", sinal: 1 },
  { chave: "DESPESA_FINANCEIRA", rotulo: "(-) Despesas financeiras", tipo: "GRUPO", sinal: -1 },
  { chave: "LAIR", rotulo: "= Resultado antes dos tributos", tipo: "SUBTOTAL", sinal: 1 },
  { chave: "TRIBUTO_SOBRE_LUCRO", rotulo: "(-) IRPJ e CSLL", tipo: "GRUPO", sinal: -1 },
  { chave: "RESULTADO_LIQUIDO", rotulo: "= Resultado líquido do período", tipo: "SUBTOTAL", sinal: 1 },
] as const;

export type ChaveDre = (typeof LINHAS_DRE)[number]["chave"];

// As linhas em que uma CATEGORIA pode ser classificada. Os subtotais saem de
// conta, nunca de classificação — oferecê-los na tela de classificação seria
// convidar alguém a jogar uma categoria dentro de "Lucro bruto".
export const LINHAS_CLASSIFICAVEIS = LINHAS_DRE.filter((l) => l.tipo === "GRUPO").map((l) => l.chave);

export const ROTULO_LINHA: Record<string, string> = Object.fromEntries(
  LINHAS_DRE.map((l) => [l.chave, l.rotulo])
);

// PROPOSTA AUTOMÁTICA a partir do que a Omie informa.
//
// Deliberadamente conservadora, e o motivo é o defeito que ela evita: um
// palpite errado sobre custo-versus-despesa não deixa o DRE inconsistente —
// ele fecha igual no resultado líquido — mas move o LUCRO BRUTO, que é o
// número pelo qual se julga a operação. Um DRE que fecha e mente sobre a
// margem é pior que um DRE incompleto.
//
// Por isso: receita e tributo sobre faturamento são propostos (a Omie
// distingue os dois com segurança), e TODA despesa cai em "outras despesas
// operacionais" até que alguém diga se é custo. É a única linha que não
// desloca lucro bruto por engano — quem classificar vai TER que olhar.
const PADRAO_TRIBUTO_FATURAMENTO = /\b(iss|pis|cofins|icms|simples|das)\b/i;
const PADRAO_TRIBUTO_LUCRO = /\b(irpj|csll|imposto de renda|contribui[çc][ãa]o social)\b/i;
const PADRAO_FINANCEIRA = /juros|multa|tarifa|banc[áa]ri|iof|encargo financeiro|desconto concedido/i;
const PADRAO_RECEITA_FINANCEIRA = /rendimento|aplica[çc][ãa]o|juros recebidos|receita financeira/i;

export function proporLinha(
  cat: {
    descricao: string;
    natureza: string | null;
    contaReceita: boolean;
    contaDespesa: boolean;
  },
  // De que lado a categoria APARECE nos títulos do período. É o sinal
  // primário, e a razão é dura: a primeira versão desta função confiava em
  // `contaReceita`/`natureza` do cadastro, e a tela mostrou "Clientes —
  // Serviços Prestados", R$ 7,3 milhões, dentro de "outras despesas
  // operacionais", com a receita bruta zerada.
  //
  // Os dois campos estavam vazios: `contaReceita` é coluna nova, com padrão
  // falso até a próxima sincronização de cadastros, e `natureza` o diagnóstico
  // JÁ TINHA REPORTADO como não preenchida nas duas empresas — eu tinha a
  // informação e construí em cima dela assim mesmo.
  //
  // A natureza do TÍTULO não depende de cadastro nenhum: se o dinheiro entra,
  // é receita. É o dado que o sistema tem com certeza, e por isso decide.
  movimento?: { receberCents: number; pagarCents: number }
): ChaveDre {
  const d = cat.descricao;
  const ehReceita =
    movimento && movimento.receberCents + movimento.pagarCents > 0
      ? movimento.receberCents > movimento.pagarCents
      : cat.contaReceita || /^r/i.test(cat.natureza ?? "");

  if (ehReceita) {
    return PADRAO_RECEITA_FINANCEIRA.test(d) ? "RECEITA_FINANCEIRA" : "RECEITA_BRUTA";
  }
  if (PADRAO_TRIBUTO_FATURAMENTO.test(d)) return "DEDUCOES";
  if (PADRAO_TRIBUTO_LUCRO.test(d)) return "TRIBUTO_SOBRE_LUCRO";
  if (PADRAO_FINANCEIRA.test(d)) return "DESPESA_FINANCEIRA";
  return "DESPESA_GERAL";
}

export type TituloDoDre = {
  id: string;
  natureza: "RECEBER" | "PAGAR";
  parceiro: string;
  documento: string | null;
  data: Date;
  valorCents: number;
  empresa: string;
};

// Teto de títulos por categoria levados à tela. Vinte cobre a pergunta que o
// clique faz — "de onde vem esse número?" — sem transformar a página numa
// cópia da base: uma categoria de folha tem centenas de títulos no mês, e
// mandar todos ao navegador em cada uma das quarenta categorias é o que
// derruba a tela justamente na empresa maior. A lista completa está na
// planilha.
export const TITULOS_POR_CATEGORIA_NA_TELA = 20;

export type ItemDre = {
  categoriaCodigo: string;
  descricao: string;
  subgrupo: string | null;
  confirmada: boolean;
  valorCents: number;
  valorAnteriorCents: number;
  // Os maiores títulos da categoria no mês, para o drill-down.
  titulos: TituloDoDre[];
  totalDeTitulos: number;
};

export type LinhaDreCalculada = {
  chave: string;
  rotulo: string;
  tipo: "GRUPO" | "SUBTOTAL";
  valorCents: number;
  valorAnteriorCents: number;
  // Percentual sobre a RECEITA OPERACIONAL LÍQUIDA — a base de comparação
  // usual da análise vertical. Sobre a bruta, toda margem apareceria melhor do
  // que é, na exata proporção dos impostos.
  percentReceitaLiquida: number | null;
  itens: ItemDre[];
  // Subtotais de subgrupo dentro da linha, quando houver.
  subgrupos: { nome: string; valorCents: number; valorAnteriorCents: number }[];
};

export type ResultadoDre = {
  linhas: LinhaDreCalculada[];
  receitaLiquidaCents: number;
  resultadoLiquidoCents: number;
  margemLiquidaPercent: number | null;
  // Quanto do movimento do período está em categoria ainda não confirmada por
  // uma pessoa. É o número que diz se este DRE pode ser levado a uma reunião.
  naoConfirmadoCents: number;
  semCategoriaCents: number;
};

type Classificacao = { linha: string; subgrupo: string | null; confirmada: boolean };

export function montarDre(
  ctx: ContextoAuditoria,
  periodo: Periodo,
  periodoAnterior: Periodo,
  classificacoes: Map<string, Classificacao>
): ResultadoDre {
  const categorias = new Map(ctx.categorias.map((c) => [c.codigo, c]));

  // Movimento por categoria, nas duas janelas. Título cancelado fica fora: ele
  // não é resultado, e mantê-lo faria a receita do mês incluir documento que
  // não existe mais — que foi exatamente o erro das notas canceladas.
  const porCategoria = (p: Periodo) => {
    const mapa = new Map<string, number>();
    for (const natureza of ["RECEBER", "PAGAR"] as const) {
      for (const t of titulosAtivos(ctx, natureza)) {
        if (!dentro(dataDeCompetencia(t), p)) continue;
        const chave = t.categoriaCodigo ?? "SEM_CATEGORIA";
        mapa.set(chave, (mapa.get(chave) ?? 0) + t.valorDocumentoCents);
      }
    }
    return mapa;
  };

  // De que lado cada categoria aparece, e os títulos por trás dela. O primeiro
  // decide a proposta de linha; o segundo é o que a tela abre quando alguém
  // clica na categoria e pergunta "de onde vem esse número?".
  const movimentoPorCategoria = new Map<string, { receberCents: number; pagarCents: number }>();
  const titulosPorCategoria = new Map<string, TituloDoDre[]>();
  for (const natureza of ["RECEBER", "PAGAR"] as const) {
    for (const t of titulosAtivos(ctx, natureza)) {
      if (!dentro(dataDeCompetencia(t), periodo)) continue;
      const chave = t.categoriaCodigo ?? "SEM_CATEGORIA";
      const m = movimentoPorCategoria.get(chave) ?? { receberCents: 0, pagarCents: 0 };
      if (natureza === "RECEBER") m.receberCents += Math.abs(t.valorDocumentoCents);
      else m.pagarCents += Math.abs(t.valorDocumentoCents);
      movimentoPorCategoria.set(chave, m);

      const lista = titulosPorCategoria.get(chave) ?? [];
      lista.push({
        id: t.id,
        natureza,
        parceiro: t.parceiroNome ?? "(sem parceiro)",
        documento: t.numeroDocumento,
        data: dataDeCompetencia(t),
        valorCents: t.valorDocumentoCents,
        empresa: t.conexaoApelido,
      });
      titulosPorCategoria.set(chave, lista);
    }
  }

  const atual = porCategoria(periodo);
  const anterior = porCategoria(periodoAnterior);

  const itensPorLinha = new Map<string, ItemDre[]>();
  let naoConfirmado = 0;
  let semCategoria = 0;

  for (const codigo of new Set([...atual.keys(), ...anterior.keys()])) {
    const valor = atual.get(codigo) ?? 0;
    const valorAnterior = anterior.get(codigo) ?? 0;
    if (valor === 0 && valorAnterior === 0) continue;

    if (codigo === "SEM_CATEGORIA") {
      semCategoria += valor;
      // Sem categoria não entra em linha nenhuma: colocá-la em "outras
      // despesas" faria o DRE fechar escondendo justamente o que falta
      // classificar. Aparece como aviso, fora da demonstração.
      continue;
    }

    const cat = categorias.get(codigo);
    const guardada = classificacoes.get(codigo);
    const linha =
      guardada?.linha ??
      (cat
        ? proporLinha(cat, movimentoPorCategoria.get(codigo))
        : // Categoria que aparece em título e não existe no cadastro: quase
          // sempre categoria excluída na Omie depois de usada. O lado vem do
          // movimento, pelo mesmo motivo de cima.
          ((movimentoPorCategoria.get(codigo)?.receberCents ?? 0) >
          (movimentoPorCategoria.get(codigo)?.pagarCents ?? 0)
            ? "RECEITA_BRUTA"
            : "DESPESA_GERAL"));

    const confirmada = guardada?.confirmada ?? false;
    if (!confirmada) naoConfirmado += Math.abs(valor);

    const lista = itensPorLinha.get(linha) ?? [];
    const doMes = (titulosPorCategoria.get(codigo) ?? []).sort(
      (a, b) => Math.abs(b.valorCents) - Math.abs(a.valorCents)
    );
    lista.push({
      categoriaCodigo: codigo,
      descricao: cat?.descricao ?? `Categoria ${codigo}`,
      subgrupo: guardada?.subgrupo ?? null,
      confirmada,
      valorCents: valor,
      valorAnteriorCents: valorAnterior,
      titulos: doMes.slice(0, TITULOS_POR_CATEGORIA_NA_TELA),
      totalDeTitulos: doMes.length,
    });
    itensPorLinha.set(linha, lista);
  }

  // ---- Os subtotais, na ordem da lei ----
  //
  // Cada grupo é somado em MÓDULO e o sinal entra aqui, no acumulado. Guardar
  // despesa como número negativo pareceria mais direto e é onde este cálculo
  // costuma errar: bastaria uma categoria de despesa com valor negativo (um
  // estorno, que existe) para ela virar receita silenciosamente.
  const totalDe = (chave: string, campo: "valorCents" | "valorAnteriorCents") =>
    somar(itensPorLinha.get(chave) ?? [], (i) => Math.abs(i[campo]));

  const calc = (campo: "valorCents" | "valorAnteriorCents") => {
    const g = (c: string) => totalDe(c, campo);
    const receitaLiquida = g("RECEITA_BRUTA") - g("DEDUCOES");
    const lucroBruto = receitaLiquida - g("CUSTO_SERVICO");
    const ebit =
      lucroBruto - g("DESPESA_COMERCIAL") - g("DESPESA_ADMINISTRATIVA") - g("DESPESA_GERAL");
    const lair = ebit + g("RECEITA_FINANCEIRA") - g("DESPESA_FINANCEIRA");
    return {
      RECEITA_LIQUIDA: receitaLiquida,
      LUCRO_BRUTO: lucroBruto,
      EBIT: ebit,
      LAIR: lair,
      RESULTADO_LIQUIDO: lair - g("TRIBUTO_SOBRE_LUCRO"),
    } as Record<string, number>;
  };

  const sub = calc("valorCents");
  const subAnterior = calc("valorAnteriorCents");
  const receitaLiquida = sub.RECEITA_LIQUIDA;

  const linhas: LinhaDreCalculada[] = LINHAS_DRE.map((def) => {
    const itens = (itensPorLinha.get(def.chave) ?? []).sort(
      (a, b) => Math.abs(b.valorCents) - Math.abs(a.valorCents)
    );
    const valor = def.tipo === "SUBTOTAL" ? (sub[def.chave] ?? 0) : totalDe(def.chave, "valorCents");
    const valorAnterior =
      def.tipo === "SUBTOTAL" ? (subAnterior[def.chave] ?? 0) : totalDe(def.chave, "valorAnteriorCents");

    const porSubgrupo = new Map<string, { valorCents: number; valorAnteriorCents: number }>();
    for (const i of itens) {
      if (!i.subgrupo) continue;
      const s = porSubgrupo.get(i.subgrupo) ?? { valorCents: 0, valorAnteriorCents: 0 };
      s.valorCents += Math.abs(i.valorCents);
      s.valorAnteriorCents += Math.abs(i.valorAnteriorCents);
      porSubgrupo.set(i.subgrupo, s);
    }

    return {
      chave: def.chave,
      rotulo: def.rotulo,
      tipo: def.tipo,
      valorCents: valor,
      valorAnteriorCents: valorAnterior,
      percentReceitaLiquida: receitaLiquida > 0 ? (valor / receitaLiquida) * 100 : null,
      itens,
      subgrupos: [...porSubgrupo.entries()]
        .map(([nome, v]) => ({ nome, ...v }))
        .sort((a, b) => b.valorCents - a.valorCents),
    };
  });

  return {
    linhas,
    receitaLiquidaCents: receitaLiquida,
    resultadoLiquidoCents: sub.RESULTADO_LIQUIDO,
    margemLiquidaPercent: receitaLiquida > 0 ? (sub.RESULTADO_LIQUIDO / receitaLiquida) * 100 : null,
    naoConfirmadoCents: naoConfirmado,
    semCategoriaCents: semCategoria,
  };
}
