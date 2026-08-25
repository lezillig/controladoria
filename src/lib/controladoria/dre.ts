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
  // OUTRAS RECEITAS OPERACIONAIS — a linha que faltava, e a tela mostrou por
  // quê: "Venda de Veículos", "Resgate Consórcio", "Lucros Cessantes",
  // "Reembolso de multa de trânsito" e "Pagamento Convênio Médico" estavam
  // todas dentro da RECEITA OPERACIONAL BRUTA.
  //
  // Nenhuma delas é receita de serviço. Venda de veículo é baixa de
  // imobilizado; resgate de consórcio é recuperação de aplicação; reembolso é
  // devolução de despesa. Somá-las ao faturamento infla a base sobre a qual
  // TODO percentual do DRE é calculado — a margem bruta cai, a carga
  // tributária efetiva parece menor, e o faturamento deixa de bater com a
  // declaração da contabilidade sem que nada aponte onde.
  //
  // Depois das despesas operacionais e antes do EBIT, que é onde a prática
  // contábil brasileira as colocou depois de a Lei 11.941/09 extinguir o
  // "resultado não operacional".
  { chave: "OUTRAS_RECEITAS", rotulo: "(+) Outras receitas operacionais", tipo: "GRUPO", sinal: 1 },
  { chave: "EBIT", rotulo: "= Resultado antes do financeiro (EBIT)", tipo: "SUBTOTAL", sinal: 1 },
  { chave: "RECEITA_FINANCEIRA", rotulo: "(+) Receitas financeiras", tipo: "GRUPO", sinal: 1 },
  { chave: "DESPESA_FINANCEIRA", rotulo: "(-) Despesas financeiras", tipo: "GRUPO", sinal: -1 },
  // "RESULTADO ANTES DOS INVESTIMENTOS", e não "antes dos tributos".
  //
  // Os tributos sobre o lucro subiram para as deduções da receita — no Lucro
  // Presumido eles são percentual do faturamento —, então já não há tributo
  // nenhum abaixo desta linha, e o nome antigo apontava para uma conta que
  // deixou de existir ali.
  //
  // O nome novo é o da decisão que a linha separa: acima dela está o que a
  // OPERAÇÃO gerou; abaixo, o que a empresa gasta para RENOVAR A FROTA —
  // financiamento e consórcio. Numa transportadora essa é a fronteira que
  // importa, porque a operação pode ir bem e o caixa sumir na prestação do
  // ônibus, e nenhum dos dois números sozinho conta isso.
  { chave: "LAIR", rotulo: "= Resultado antes dos investimentos", tipo: "SUBTOTAL", sinal: 1 },
  // FINANCIAMENTOS E CONSÓRCIOS.
  //
  // Ressalva registrada: a amortização do principal de um financiamento NÃO é
  // despesa em contabilidade — é baixa de passivo, e não passa pelo DRE
  // oficial. Aqui ela passa de propósito, porque esta demonstração responde
  // "quanto sobrou depois de tudo que sai", e a prestação sai. Os juros
  // continuam em despesas financeiras, onde a contabilidade os coloca.
  { chave: "FINANCIAMENTO_INVESTIMENTO", rotulo: "(-) Financiamentos e consórcios", tipo: "GRUPO", sinal: -1 },
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
const PADRAO_RECEITA_FINANCEIRA = /rendimento|juros recebidos|receita financeira/i;
// Entrada que NÃO é faturamento de serviço. Cada uma destas apareceu dentro da
// receita operacional bruta na primeira leitura real da tela — somadas ao
// faturamento, deslocam a base de todo percentual do DRE.
// Saída ligada à AQUISIÇÃO de bem, não à operação do mês. Numa transportadora
// é quase toda a renovação de frota.
const PADRAO_FINANCIAMENTO =
  /financiamento|cons[óo]rcio|leasing|arrendamento mercantil|presta[çc][ãa]o de ve[íi]culo|finame|cdc\b/i;
const PADRAO_OUTRA_RECEITA =
  /venda de ve[íi]culo|aliena[çc][ãa]o|resgate|cons[óo]rcio|lucros cessantes|reembolso|recupera[çc][ãa]o|indeniza[çc][ãa]o|sinistro|conv[êe]nio m[ée]dico|sobra|doa[çc][ãa]o/i;

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
    if (PADRAO_RECEITA_FINANCEIRA.test(d)) return "RECEITA_FINANCEIRA";
    if (PADRAO_OUTRA_RECEITA.test(d)) return "OUTRAS_RECEITAS";
    return "RECEITA_BRUTA";
  }
  if (PADRAO_TRIBUTO_FATURAMENTO.test(d)) return "DEDUCOES";
  // IRPJ E CSLL COMO DEDUÇÃO DA RECEITA BRUTA — decisão da empresa, e ela tem
  // razão de negócio.
  //
  // No LUCRO PRESUMIDO os dois não dependem do lucro apurado: a base é uma
  // presunção sobre a RECEITA (16% para transporte de passageiros, 12% de
  // CSLL), então na prática são um percentual do faturamento, exatamente como
  // PIS, COFINS e ISS. Deixá-los embaixo do LAIR faria a receita líquida e a
  // margem bruta ignorarem um custo que varia com a receita e com nada mais.
  //
  // A RESSALVA, que a tela precisa dizer: isto DIVERGE da estrutura do art.
  // 187, onde IRPJ e CSLL vêm depois do resultado antes dos tributos. O
  // resultado líquido final é o mesmo pelos dois caminhos; o que muda é a
  // receita líquida e, com ela, todo percentual do DRE. Quem comparar esta
  // demonstração com a da contabilidade vai encontrar essa diferença, e
  // precisa saber de onde ela vem.
  //
  // A linha "IRPJ e CSLL" continua existindo: se a empresa migrar para lucro
  // real, os dois voltam a depender do resultado e o lugar deles é lá — e
  // classificar uma categoria nela continua possível a qualquer momento.
  if (PADRAO_TRIBUTO_LUCRO.test(d)) return "DEDUCOES";
  // Juros e tarifas ficam em despesa FINANCEIRA — é onde a contabilidade os
  // coloca, e o teste vem antes por isso: "juros de financiamento" é despesa
  // financeira, "parcela de financiamento" é investimento.
  if (PADRAO_FINANCEIRA.test(d)) return "DESPESA_FINANCEIRA";
  if (PADRAO_FINANCIAMENTO.test(d)) return "FINANCIAMENTO_INVESTIMENTO";
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
  // RETENÇÕES NA FONTE do período, por tributo. Mostradas ao lado das
  // deduções e NUNCA somadas a elas — ver `retencoesDoPeriodo` abaixo.
  retencoes: {
    issCents: number;
    pisCents: number;
    cofinsCents: number;
    csllCents: number;
    irCents: number;
    inssCents: number;
    totalCents: number;
    titulosComRetencao: number;
  };
  // Se as retenções acima entraram na linha de deduções. A tela precisa dizer
  // qual das duas leituras está no ar — um total de impostos sem essa
  // informação não dá para conferir contra nada.
  retencoesSomadas: boolean;
};

// O QUE O CLIENTE RETEVE, e por que isto NÃO entra na conta.
//
// A pergunta que originou esta função foi a certa: "podemos colocar as
// retenções nos impostos, ou vai duplicar a informação?". Vai depender de como
// a empresa lança, e há dois regimes possíveis:
//
//   1. O cliente retém R$ 1.000 de ISS e recolhe no lugar da empresa. A empresa
//      não gera título a pagar desse valor. Aqui as retenções COMPLETAM os
//      títulos de imposto, e somá-las é o certo.
//   2. A empresa lança o imposto cheio como título a pagar e abate a retenção
//      no momento de recolher. Aqui o título JÁ CONTÉM o valor retido, e somar
//      contaria o mesmo imposto duas vezes.
//
// Não há como distinguir os dois pelo dado sozinho — a diferença está na
// prática de lançamento, não no registro. Então o sistema não escolhe: mostra
// os dois lados separados, nomeados, e diz o que cada leitura significaria.
// Somar por conta própria seria arriscar inflar a carga tributária do DRE em
// centenas de milhares de reais, e o erro apareceria como margem pior — que é
// o tipo de número que ninguém questiona.
function retencoesDoPeriodo(ctx: ContextoAuditoria, periodo: Periodo) {
  const receber = titulosAtivos(ctx, "RECEBER").filter((t) => dentro(dataDeCompetencia(t), periodo));
  const soma = (campo: (t: (typeof receber)[number]) => number) => somar(receber, campo);

  const issCents = soma((t) => t.retencaoIssCents);
  const pisCents = soma((t) => t.retencaoPisCents);
  const cofinsCents = soma((t) => t.retencaoCofinsCents);
  const csllCents = soma((t) => t.retencaoCsllCents);
  const irCents = soma((t) => t.retencaoIrCents);
  const inssCents = soma((t) => t.retencaoInssCents);

  return {
    issCents,
    pisCents,
    cofinsCents,
    csllCents,
    irCents,
    inssCents,
    totalCents: issCents + pisCents + cofinsCents + csllCents + irCents + inssCents,
    titulosComRetencao: receber.filter(
      (t) =>
        t.retencaoIssCents +
          t.retencaoPisCents +
          t.retencaoCofinsCents +
          t.retencaoCsllCents +
          t.retencaoIrCents +
          t.retencaoInssCents >
        0
    ).length,
  };
}

type Classificacao = { linha: string; subgrupo: string | null; confirmada: boolean };

export function montarDre(
  ctx: ContextoAuditoria,
  periodo: Periodo,
  periodoAnterior: Periodo,
  classificacoes: Map<string, Classificacao>,
  // Somar as retenções na fonte às deduções da receita. Ver
  // `retencoesDoPeriodo` e a coluna `retencoesNasDeducoes` na configuração.
  somarRetencoes = false
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
      lucroBruto -
      g("DESPESA_COMERCIAL") -
      g("DESPESA_ADMINISTRATIVA") -
      g("DESPESA_GERAL") +
      g("OUTRAS_RECEITAS");
    const lair = ebit + g("RECEITA_FINANCEIRA") - g("DESPESA_FINANCEIRA");
    return {
      RECEITA_LIQUIDA: receitaLiquida,
      LUCRO_BRUTO: lucroBruto,
      EBIT: ebit,
      LAIR: lair,
      RESULTADO_LIQUIDO: lair - g("FINANCIAMENTO_INVESTIMENTO") - g("TRIBUTO_SOBRE_LUCRO"),
    } as Record<string, number>;
  };

  // A RETENÇÃO ENTRA COMO ITEM PRÓPRIO, e não somada ao total da linha em
  // silêncio. Nomeada, ela aparece no drill-down das deduções ao lado dos
  // títulos de imposto — e se um dia passar a duplicar, a duplicidade fica
  // visível como duas entradas do mesmo tributo, em vez de um total que
  // simplesmente dobrou sem explicação.
  const retencoes = retencoesDoPeriodo(ctx, periodo);
  const retencoesAnteriores = retencoesDoPeriodo(ctx, periodoAnterior);
  if (somarRetencoes && retencoes.totalCents > 0) {
    const lista = itensPorLinha.get("DEDUCOES") ?? [];
    lista.push({
      categoriaCodigo: "RETENCAO_NA_FONTE",
      descricao: "Tributos retidos na fonte pelos clientes",
      subgrupo: null,
      // Não é classificável: não é categoria da Omie, é um agregado calculado.
      // Marcada como confirmada para não contar como "por classificar" — o que
      // mandaria alguém procurar na tela uma categoria que não existe.
      confirmada: true,
      valorCents: retencoes.totalCents,
      valorAnteriorCents: retencoesAnteriores.totalCents,
      titulos: [],
      totalDeTitulos: 0,
    });
    itensPorLinha.set("DEDUCOES", lista);
  }

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
    retencoes,
    retencoesSomadas: somarRetencoes,
  };
}
