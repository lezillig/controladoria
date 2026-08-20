import { fmtBRL, fmtPercent } from "../format";
import { inicioDoAno } from "../periodos";
import { analisarEstrategiaDeCusto, ROTULO_CLASSIFICACAO } from "../estrategiaCusto";
import type { AchadoNovo, Agente, ContextoAuditoria } from "../types";
import { agrupar, chaveAchado, chaveParceiro, materialidadeCents, nomeParceiro, somar, titulosAtivos } from "./comum";

// AGENTE DE OPORTUNIDADES
// Os outros agentes procuram o que esta errado. Este procura o que esta
// certo mas poderia ser melhor — e sempre com tres coisas juntas: o numero,
// a acao e quanto ela vale por ano. Economia sem acao e so lamento; acao sem
// numero nao entra na fila de prioridade de ninguem.
//
// Regra de estilo de todo achado daqui: o impacto e ANUALIZADO. "R$ 800 por
// mes" nao muda comportamento; "R$ 9.600 por ano" muda.

export const agenteOportunidades: Agente = {
  id: "oportunidades",
  nome: "Oportunidades de economia",
  area: "Controladoria",
  descricao:
    "Quantifica economias possíveis e diz ONDE cortar: separa o custo que acompanha a entrega do custo que cresceu sozinho, prioriza os alvos pelo peso no total, e ainda aponta juros evitáveis, tarifas bancárias, consolidação de fornecedores e a política de alçadas adequada ao tamanho da operação.",
  executar: buscarOportunidades,
};

function buscarOportunidades(ctx: ContextoAuditoria): AchadoNovo[] {
  const achados: AchadoNovo[] = [];
  const materialidade = materialidadeCents(ctx);

  achados.push(...jurosEvitaveisNoAno(ctx, materialidade));
  achados.push(...tarifasBancarias(ctx, materialidade));
  achados.push(...consolidacaoDeFornecedores(ctx, materialidade));
  achados.push(...politicaDeAlcadas(ctx));
  achados.push(...ondeReduzirCusto(ctx));

  return achados;
}

// OP-ONDE-REDUZIR — a capacidade ESTRATEGICA do agente.
//
// Reduzir custo e meta; saber onde reduzir e estrategia. Corte linear ("todo
// mundo corta 10%") trata igual o que e desigual: corta o combustivel que
// leva o passageiro (destruindo entrega) na mesma proporcao do contrato de
// software que ninguem usa mais. Esta regra separa os dois.
//
// O metodo esta em src/lib/controladoria/estrategiaCusto.ts: cruza o PESO da
// categoria (Pareto) com o ACOPLAMENTO dela a receita (o custo acompanha o
// faturamento, ou segue seu proprio caminho?). O que cresce sem a receita
// crescer e o alvo seguro; o que acompanha a entrega so deve ser atacado por
// eficiencia, nunca por corte direto.
function ondeReduzirCusto(ctx: ContextoAuditoria): AchadoNovo[] {
  const analise = analisarEstrategiaDeCusto(ctx);

  // Sem historico suficiente, o agente diz isso em vez de recomendar corte a
  // partir de dois meses de dado — uma recomendacao errada de onde cortar
  // custa muito mais caro que a ausencia dela.
  if (!analise.baseSuficiente) return [];

  const alvos = analise.linhas
    .filter((l) => l.dentroDosPrimeiros80 && l.economiaAnualEstimadaCents > 0)
    .slice(0, 5);
  if (alvos.length === 0) return [];

  const economiaTotal = somar(alvos, (l) => l.economiaAnualEstimadaCents);
  const descolados = alvos.filter((l) => l.classificacao === "DESACOPLADO_CRESCENTE");

  const descricao =
    `Analisando ${analise.mesesAnalisados} meses de custo contra a receita do mesmo período, as categorias que concentram ` +
    `a maior parte do gasto se dividem assim:\n\n` +
    alvos
      .map(
        (l, i) =>
          `${i + 1}. ${l.descricao} — ${fmtBRL(l.custoMedioMensalCents)}/mês (${fmtPercent(l.participacaoPercent)} do custo). ` +
          `${ROTULO_CLASSIFICACAO[l.classificacao]}. ${l.racional}`
      )
      .join("\n\n");

  return [
    {
      regra: "OP-ONDE-REDUZIR",
      tipo: "ESTADO",
      severidade: "ALTA",
      categoria: "OPORTUNIDADE",
      titulo: `Onde reduzir custo: ${alvos.length} alvos priorizados, ${fmtBRL(economiaTotal)}/ano`,
      descricao,
      recomendacao:
        (descolados.length > 0
          ? `Comece por ${descolados[0].descricao}: ${descolados[0].acao} `
          : `Comece por ${alvos[0].descricao}: ${alvos[0].acao} `) +
        `Não aplique corte linear: as categorias marcadas como "acompanha a entrega" sobem e descem com o faturamento — ` +
        `cortá-las significa entregar menos, e o ganho ali vem de eficiência (custo por km, por hora, por passageiro), ` +
        `não de redução de valor absoluto.`,
      valorCents: analise.custoTotalMensalCents,
      impactoCents: economiaTotal,
      dataReferencia: ctx.dataReferencia,
      evidencia: {
        mesesAnalisados: analise.mesesAnalisados,
        alvos: alvos.map((l) => ({
          categoria: l.descricao,
          custoMensal: l.custoMedioMensalCents,
          participacao: l.participacaoPercent,
          classificacao: l.classificacao,
          descolamentoPontos: l.descolamentoPontos,
          economiaAnual: l.economiaAnualEstimadaCents,
          acao: l.acao,
        })),
      },
      chave: chaveAchado("OP-ONDE-REDUZIR", String(ctx.dataReferencia.getFullYear()), String(ctx.dataReferencia.getMonth() + 1)),
    },
  ];
}

// OP-JUROS-ANO — soma tudo que ja se pagou de juros/multa/tarifa no ano e
// projeta o ano inteiro. Individualmente cada atraso parece pequeno; junto,
// costuma ser o custo de um funcionario.
function jurosEvitaveisNoAno(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const inicio = inicioDoAno(ctx.dataReferencia);
  const baixas = ctx.baixas.filter((b) => b.dataBaixa >= inicio);
  const encargos = somar(baixas, (b) => b.jurosCents + b.multaCents + b.tarifaCents);
  if (encargos < materialidade) return [];

  // Projecao linear pelo ritmo do ano corrente. Simples de propósito: uma
  // projecao sofisticada nao mudaria a decisao, e uma regra de tres e
  // conferivel de cabeca por quem le o relatorio.
  const diaDoAno = Math.max(1, Math.round((ctx.dataReferencia.getTime() - inicio.getTime()) / 86_400_000) + 1);
  const projecaoAnual = Math.round((encargos / diaDoAno) * 365);
  const titulosComEncargo = titulosAtivos(ctx, "PAGAR").filter((t) => t.jurosCents + t.multaCents > 0).length;

  return [
    {
      regra: "OP-JUROS-ANO",
      tipo: "ESTADO",
      severidade: "ALTA",
      categoria: "OPORTUNIDADE",
      titulo: `${fmtBRL(encargos)} em juros, multas e tarifas no ano`,
      descricao:
        `Em ${titulosComEncargo} título(s), a empresa já pagou ${fmtBRL(encargos)} de encargos por atraso e tarifas neste ano. ` +
        `No ritmo atual, o ano fecha em ${fmtBRL(projecaoAnual)}. É dinheiro que não comprou nada — nem serviço, nem veículo, nem hora de motorista.`,
      recomendacao:
        "Três medidas resolvem a maior parte disso, na ordem: (1) calendário fixo de pagamento em lote, com 3 dias de folga antes do vencimento; " +
        "(2) débito automático para as contas recorrentes de valor previsível (energia, telefonia, seguros); " +
        "(3) alerta de vencimento em 5 dias para os títulos acima da alçada. Meta realista: reduzir 80% no próximo trimestre.",
      valorCents: encargos,
      impactoCents: Math.round(projecaoAnual * 0.8),
      dataReferencia: ctx.dataReferencia,
      evidencia: { encargosNoAno: encargos, projecaoAnual, titulosComEncargo, diasDecorridos: diaDoAno },
      chave: chaveAchado("OP-JUROS-ANO", String(ctx.dataReferencia.getFullYear())),
    },
  ];
}

// OP-TARIFAS — tarifa bancaria isolada e invisivel; somada e negociavel.
// Banco reduz tarifa de cliente que chega com o numero na mao.
function tarifasBancarias(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const inicio = inicioDoAno(ctx.dataReferencia);
  const tarifas = somar(
    ctx.baixas.filter((b) => b.dataBaixa >= inicio),
    (b) => b.tarifaCents
  );
  if (tarifas < materialidade) return [];

  const diaDoAno = Math.max(1, Math.round((ctx.dataReferencia.getTime() - inicio.getTime()) / 86_400_000) + 1);
  const anual = Math.round((tarifas / diaDoAno) * 365);

  return [
    {
      regra: "OP-TARIFAS",
      tipo: "ESTADO",
      severidade: "BAIXA",
      categoria: "OPORTUNIDADE",
      titulo: `${fmtBRL(tarifas)} em tarifas bancárias no ano`,
      descricao:
        `Projeção de ${fmtBRL(anual)} no ano fechado. Tarifa de boleto, TED e manutenção de conta raramente é revisada ` +
        `depois que a conta é aberta — e é um dos itens em que o banco tem mais margem para ceder.`,
      recomendacao:
        "Levar o volume anual de tarifas e o saldo médio da empresa para a mesa do gerente e pedir revisão do pacote. " +
        "Comparar com pelo menos um banco digital: em contas PJ com volume de boletos, a diferença costuma pagar o esforço da migração.",
      valorCents: tarifas,
      impactoCents: Math.round(anual * 0.4),
      dataReferencia: ctx.dataReferencia,
      evidencia: { tarifasNoAno: tarifas, projecaoAnual: anual },
      chave: chaveAchado("OP-TARIFAS", String(ctx.dataReferencia.getFullYear())),
    },
  ];
}

// OP-CONSOLIDACAO — varios fornecedores para a mesma categoria. Cada um com
// seu preco, seu prazo e nenhum com volume suficiente para negociar.
const MINIMO_FORNECEDORES_PARA_CONSOLIDAR = 4;

function consolidacaoDeFornecedores(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const inicio = inicioDoAno(ctx.dataReferencia);
  const titulos = titulosAtivos(ctx, "PAGAR").filter((t) => t.dataVencimento >= inicio && t.categoriaCodigo);
  const porCategoria = agrupar(titulos, (t) => t.categoriaCodigo!);

  const achados: AchadoNovo[] = [];
  for (const [codigo, grupo] of porCategoria) {
    const fornecedores = new Set(grupo.map((t) => chaveParceiro(t)));
    if (fornecedores.size < MINIMO_FORNECEDORES_PARA_CONSOLIDAR) continue;

    const total = somar(grupo, (t) => t.valorDocumentoCents);
    if (total < materialidade * 5) continue;

    const nomeCategoria =
      ctx.categorias.find((c) => c.codigo === codigo)?.descricao ?? grupo[0].categoriaDescricao ?? `categoria ${codigo}`;

    // Ranking interno da categoria, para a recomendacao ser acionavel
    // (com quem falar primeiro) em vez de generica.
    const ranking = [...agrupar(grupo, (t) => chaveParceiro(t))]
      .map(([, itens]) => ({ nome: nomeParceiro(ctx, itens[0]), valor: somar(itens, (t) => t.valorDocumentoCents) }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 5);

    achados.push({
      regra: "OP-CONSOLIDACAO",
      tipo: "ESTADO",
      severidade: "BAIXA",
      categoria: "OPORTUNIDADE",
      titulo: `${fornecedores.size} fornecedores diferentes em ${nomeCategoria}`,
      descricao:
        `${fmtBRL(total)} gastos no ano nessa categoria, distribuídos entre ${fornecedores.size} fornecedores. ` +
        `Maiores: ${ranking.map((r) => `${r.nome} (${fmtBRL(r.valor)})`).join(", ")}. ` +
        `Volume pulverizado é volume sem poder de negociação — e sem parâmetro de preço entre os próprios fornecedores.`,
      recomendacao:
        "Levantar o preço unitário praticado por cada um e fazer uma cotação única com o volume anual consolidado. " +
        "Concentrar em dois fornecedores (um principal e um reserva) costuma render de 5% a 15% sem perder segurança de fornecimento.",
      valorCents: total,
      impactoCents: Math.round(total * 0.07),
      dataReferencia: ctx.dataReferencia,
      entidadeTipo: "OmieCategoria",
      entidadeRef: nomeCategoria,
      evidencia: { categoria: nomeCategoria, fornecedores: fornecedores.size, total, ranking },
      chave: chaveAchado("OP-CONSOLIDACAO", codigo, String(ctx.dataReferencia.getFullYear())),
    });
  }
  return achados;
}

// OP-ALCADA — proposta de politica de alcadas calculada a partir da
// DISTRIBUICAO REAL dos pagamentos da empresa.
//
// O usuario pediu explicitamente uma sugestao de alcadas "conforme melhor
// pratica diante do tamanho da nossa operacao". Uma tabela generica de
// mercado (R$ 5 mil / R$ 20 mil / R$ 100 mil) erra nos dois sentidos: alta
// demais, nao controla nada; baixa demais, trava a operacao e todo mundo
// aprende a contornar. Percentis do proprio historico resolvem isso:
//   - P50 (mediana): metade dos pagamentos passa direto, sem burocracia;
//   - P90: o topo da rotina — exige um segundo par de olhos;
//   - P99: o excepcional — exige a diretoria.
// A conta e transparente e reprodutivel, e reprocessa sozinha conforme a
// empresa cresce.
const MINIMO_PAGAMENTOS_PARA_SUGERIR_ALCADA = 30;

export function sugerirAlcadas(ctx: ContextoAuditoria): {
  amostra: number;
  operacional: number;
  gerencial: number;
  diretoria: number;
  cobertura: { operacionalPercent: number; gerencialPercent: number; diretoriaPercent: number };
} | null {
  const inicio = inicioDoAno(ctx.dataReferencia);
  const valores = titulosAtivos(ctx, "PAGAR")
    .filter((t) => t.dataVencimento >= inicio)
    .map((t) => t.valorDocumentoCents)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);

  if (valores.length < MINIMO_PAGAMENTOS_PARA_SUGERIR_ALCADA) return null;

  const percentil = (p: number) => valores[Math.min(valores.length - 1, Math.floor((valores.length - 1) * p))];
  // Arredonda para o milhar de reais mais proximo: alcada e politica, e
  // politica com centavos ("aprovação acima de R$ 9.847,32") nao e levada a
  // serio por ninguem.
  const arredondar = (cents: number) => Math.max(100_000, Math.round(cents / 100_000) * 100_000);

  const operacional = arredondar(percentil(0.5));
  const gerencial = arredondar(percentil(0.9));
  const diretoria = arredondar(percentil(0.99));

  const acima = (limite: number) => (valores.filter((v) => v > limite).length / valores.length) * 100;

  return {
    amostra: valores.length,
    operacional,
    gerencial,
    diretoria,
    cobertura: {
      operacionalPercent: acima(operacional),
      gerencialPercent: acima(gerencial),
      diretoriaPercent: acima(diretoria),
    },
  };
}

function politicaDeAlcadas(ctx: ContextoAuditoria): AchadoNovo[] {
  // Ja existe alcada cadastrada: o agente antifraude usa e este nao precisa
  // sugerir nada.
  if (ctx.config.limiteAlcadaCents) return [];

  const sugestao = sugerirAlcadas(ctx);
  if (!sugestao) return [];

  return [
    {
      regra: "OP-ALCADA",
      tipo: "ESTADO",
      severidade: "MEDIA",
      categoria: "OPORTUNIDADE",
      titulo: "Política de alçadas de pagamento ainda não definida",
      descricao:
        `Com base em ${sugestao.amostra} títulos a pagar deste ano, a distribuição real da operação sugere três níveis: ` +
        `até ${fmtBRL(sugestao.operacional)} — aprovação do financeiro (cobre a maior parte da rotina); ` +
        `de ${fmtBRL(sugestao.operacional)} a ${fmtBRL(sugestao.gerencial)} — dupla aprovação, financeiro + gestor ` +
        `(${fmtPercent(sugestao.cobertura.operacionalPercent)} dos pagamentos); ` +
        `acima de ${fmtBRL(sugestao.gerencial)} — aprovação da diretoria (${fmtPercent(sugestao.cobertura.gerencialPercent)} dos pagamentos). ` +
        `Acima de ${fmtBRL(sugestao.diretoria)} estão os ${fmtPercent(sugestao.cobertura.diretoriaPercent)} maiores, ` +
        `que merecem também contrato formal e conferência de contrato bancário do fornecedor.`,
      recomendacao:
        "Cadastrar o limite escolhido em Controladoria → Configuração. Isso liga a detecção de fracionamento (vários pagamentos " +
        "logo abaixo do teto para evitar aprovação), que hoje está desligada por falta desse parâmetro. " +
        "Regra prática que sustenta o resto: quem cadastra o título nunca pode ser quem aprova o pagamento.",
      dataReferencia: ctx.dataReferencia,
      evidencia: sugestao as unknown as Record<string, unknown>,
      chave: chaveAchado("OP-ALCADA", "atual"),
    },
  ];
}
