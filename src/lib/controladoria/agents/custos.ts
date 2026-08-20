import { fmtBRL, fmtPercent, variacaoPercent } from "../format";
import { inicioDoMes, rotuloMes } from "../periodos";
import type { AchadoNovo, Agente, ContextoAuditoria } from "../types";
import {
  agrupar,
  chaveAchado,
  chaveMes,
  chaveParceiro,
  materialidadeCents,
  nomeParceiro,
  refTitulo,
  severidadePorValor,
  somar,
  titulosAtivos,
} from "./comum";

// AGENTE DE CUSTOS
// Olha o custo como TENDENCIA, nao como lancamento: o que subiu, contra o
// que, e o que dava para economizar. Um lancamento caro isolado e assunto do
// agente de contas a pagar; aqui interessa o padrao que se repete todo mes e
// que ninguem mais percebe porque ja virou paisagem.

// Quantos meses de historico entram na base de comparacao. Tres meses e o
// minimo para uma media nao ser refem de um mes atipico e o maximo que uma
// base iniciada em janeiro/2026 oferece nos primeiros meses de uso.
const MESES_BASE_COMPARACAO = 3;

export const agenteCustos: Agente = {
  id: "custos",
  nome: "Custos e despesas",
  area: "Controladoria",
  descricao:
    "Analisa a evolução do custo por categoria e por fornecedor, detecta variações fora da tolerância, despesas novas, gastos recorrentes sem contrato, valores fora do padrão histórico e divergência entre o combustível pago na Omie e o extrato do cartão de frota.",
  executar: auditarCustos,
};

function auditarCustos(ctx: ContextoAuditoria): AchadoNovo[] {
  const achados: AchadoNovo[] = [];
  const materialidade = materialidadeCents(ctx);

  achados.push(...variacaoPorCategoria(ctx, materialidade));
  achados.push(...despesaNova(ctx, materialidade));
  achados.push(...recorrenciaSemContrato(ctx, materialidade));
  achados.push(...valorForaDoPadrao(ctx, materialidade));
  achados.push(...divergenciaCombustivel(ctx, materialidade));
  achados.push(...concentracaoDeFornecedor(ctx, materialidade));

  return achados;
}

// Custo do mes por categoria, considerando o titulo pela data de vencimento
// (regime de competencia aproximado). Deliberadamente NAO usa data de
// pagamento: o custo pertence ao mes em que foi incorrido, e comparar meses
// por caixa faria o custo "mudar de mes" so porque o pagamento atrasou.
function custoPorCategoriaNoMes(ctx: ContextoAuditoria, inicio: Date, fim: Date): Map<string, number> {
  const titulos = titulosAtivos(ctx, "PAGAR").filter(
    (t) => t.dataVencimento >= inicio && t.dataVencimento <= fim
  );
  const mapa = new Map<string, number>();
  for (const t of titulos) {
    const chave = t.categoriaCodigo ?? "SEM_CATEGORIA";
    mapa.set(chave, (mapa.get(chave) ?? 0) + t.valorDocumentoCents);
  }
  return mapa;
}

function nomeCategoria(ctx: ContextoAuditoria, codigo: string): string {
  if (codigo === "SEM_CATEGORIA") return "Sem categoria";
  return ctx.categorias.find((c) => c.codigo === codigo)?.descricao ?? `Categoria ${codigo}`;
}

function mesesAnteriores(ctx: ContextoAuditoria, quantidade: number): { inicio: Date; fim: Date }[] {
  const meses: { inicio: Date; fim: Date }[] = [];
  for (let i = 1; i <= quantidade; i++) {
    const inicio = new Date(ctx.dataReferencia.getFullYear(), ctx.dataReferencia.getMonth() - i, 1);
    const fim = new Date(ctx.dataReferencia.getFullYear(), ctx.dataReferencia.getMonth() - i + 1, 0, 23, 59, 59, 999);
    meses.push({ inicio, fim });
  }
  return meses;
}

// CU-VARIACAO — categoria que estourou a tolerancia contra a media dos meses
// anteriores. A comparacao e feita no MESMO DIA do mes (dia 1 ao dia N) para
// nao acusar alta so porque o mes corrente ainda esta no comeco — erro que
// derrubaria a credibilidade do alerta logo na primeira semana.
function variacaoPorCategoria(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const diaDoMes = ctx.dataReferencia.getDate();
  const atual = custoPorCategoriaNoMes(ctx, inicioDoMes(ctx.dataReferencia), ctx.dataReferencia);

  const bases = mesesAnteriores(ctx, MESES_BASE_COMPARACAO).map(({ inicio }) => {
    const fimEquivalente = new Date(inicio.getFullYear(), inicio.getMonth(), diaDoMes, 23, 59, 59, 999);
    return custoPorCategoriaNoMes(ctx, inicio, fimEquivalente);
  });
  if (bases.length === 0) return [];

  const achados: AchadoNovo[] = [];
  for (const [codigo, valorAtual] of atual) {
    const historico = bases.map((b) => b.get(codigo) ?? 0).filter((v) => v > 0);
    if (historico.length < 2) continue; // sem base minima nao ha do que variar

    const media = Math.round(somar(historico, (v) => v) / historico.length);
    const variacao = variacaoPercent(valorAtual, media);
    if (variacao === null || variacao < ctx.config.toleranciaVariacaoPercent) continue;

    const excedente = valorAtual - media;
    if (excedente < materialidade) continue;

    achados.push({
      regra: "CU-VARIACAO",
      tipo: "ESTADO",
      severidade: severidadePorValor(excedente, materialidade),
      categoria: "RISCO_FINANCEIRO",
      titulo: `${nomeCategoria(ctx, codigo)} subiu ${fmtPercent(variacao)} no mês`,
      descricao:
        `Até o dia ${diaDoMes}, essa categoria acumula ${fmtBRL(valorAtual)} contra uma média de ${fmtBRL(media)} ` +
        `nos mesmos dias dos ${historico.length} meses anteriores — ${fmtBRL(excedente)} acima do padrão ` +
        `(tolerância configurada: ${fmtPercent(ctx.config.toleranciaVariacaoPercent)}).`,
      recomendacao:
        "Abrir os lançamentos da categoria no mês e identificar se a alta vem de volume (mais serviço prestado, custo variável saudável), " +
        "de preço (renegociar com o fornecedor) ou de um lançamento não recorrente que deveria estar em outra categoria.",
      valorCents: excedente,
      impactoCents: excedente,
      dataReferencia: ctx.dataReferencia,
      entidadeTipo: "OmieCategoria",
      entidadeRef: nomeCategoria(ctx, codigo),
      evidencia: { categoria: nomeCategoria(ctx, codigo), valorAtual, media, historico, variacao },
      chave: chaveAchado("CU-VARIACAO", codigo, chaveMes(ctx.dataReferencia)),
    });
  }
  return achados;
}

// CU-DESPESA-NOVA — categoria que nao existia no historico e apareceu com
// valor relevante. Pode ser negocio novo (legitimo) ou despesa que entrou sem
// passar por decisao nenhuma.
function despesaNova(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const atual = custoPorCategoriaNoMes(ctx, inicioDoMes(ctx.dataReferencia), ctx.dataReferencia);
  const historico = new Set<string>();
  for (const { inicio, fim } of mesesAnteriores(ctx, MESES_BASE_COMPARACAO)) {
    for (const codigo of custoPorCategoriaNoMes(ctx, inicio, fim).keys()) historico.add(codigo);
  }

  const achados: AchadoNovo[] = [];
  for (const [codigo, valor] of atual) {
    if (historico.has(codigo) || codigo === "SEM_CATEGORIA") continue;
    if (valor < materialidade * 2) continue;

    achados.push({
      regra: "CU-DESPESA-NOVA",
      tipo: "ESTADO",
      severidade: severidadePorValor(valor, materialidade),
      categoria: "RISCO_FINANCEIRO",
      titulo: `Nova despesa: ${nomeCategoria(ctx, codigo)} — ${fmtBRL(valor)}`,
      descricao:
        `Essa categoria não teve lançamento nos ${MESES_BASE_COMPARACAO} meses anteriores e já soma ${fmtBRL(valor)} neste mês. ` +
        `Despesa nova relevante deveria ter dono, justificativa e previsão de recorrência.`,
      recomendacao:
        "Confirmar quem autorizou, se é pontual ou recorrente e se está no orçamento. Sendo recorrente, incluir no custo fixo " +
        "projetado para o fluxo de caixa não ser surpreendido nos próximos meses.",
      valorCents: valor,
      dataReferencia: ctx.dataReferencia,
      entidadeTipo: "OmieCategoria",
      entidadeRef: nomeCategoria(ctx, codigo),
      evidencia: { categoria: nomeCategoria(ctx, codigo), valor, mes: rotuloMes(ctx.dataReferencia) },
      chave: chaveAchado("CU-DESPESA-NOVA", codigo, chaveMes(ctx.dataReferencia)),
    });
  }
  return achados;
}

// CU-RECORRENTE — fornecedor pago todo mes, valor parecido. Assinatura,
// mensalidade, aluguel, servico continuado. Nao e problema; e a maior fonte
// de economia rapida numa empresa: contrato antigo que ninguem revisa,
// servico que ninguem usa mais, reajuste automatico que ninguem contestou.
const MESES_PARA_RECORRENCIA = 3;

function recorrenciaSemContrato(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const inicio = new Date(ctx.dataReferencia.getFullYear(), ctx.dataReferencia.getMonth() - MESES_PARA_RECORRENCIA, 1);
  const titulos = titulosAtivos(ctx, "PAGAR").filter((t) => t.dataVencimento >= inicio);
  const porFornecedor = agrupar(titulos, (t) => chaveParceiro(t));

  const achados: AchadoNovo[] = [];
  for (const [codigo, grupo] of porFornecedor) {
    const meses = new Set(grupo.map((t) => chaveMes(t.dataVencimento)));
    if (meses.size < MESES_PARA_RECORRENCIA) continue;

    const total = somar(grupo, (t) => t.valorDocumentoCents);
    const mensal = Math.round(total / meses.size);
    if (mensal < materialidade) continue;

    // Anualizado: e assim que um gasto mensal "pequeno" mostra o tamanho real
    // dele numa mesa de decisao.
    const anual = mensal * 12;

    achados.push({
      regra: "CU-RECORRENTE",
      tipo: "ESTADO",
      severidade: "BAIXA",
      categoria: "OPORTUNIDADE",
      titulo: `Gasto recorrente com ${nomeParceiro(ctx, grupo[0])}: ${fmtBRL(mensal)}/mês`,
      descricao:
        `Pagamentos em ${meses.size} meses seguidos, somando ${fmtBRL(total)} — equivalente a ${fmtBRL(anual)} por ano. ` +
        `Gasto recorrente é onde mora a economia mais fácil: quase nunca é revisado depois de contratado.`,
      recomendacao:
        "Revisar o contrato: escopo ainda necessário, reajuste aplicado no período, e cotação com pelo menos dois concorrentes. " +
        "Uma redução de 10% aqui vale " +
        fmtBRL(Math.round(anual * 0.1)) +
        " por ano, sem afetar a operação.",
      valorCents: total,
      impactoCents: Math.round(anual * 0.1),
      dataReferencia: ctx.dataReferencia,
      entidadeTipo: "OmieParceiro",
      entidadeRef: nomeParceiro(ctx, grupo[0]),
      evidencia: { fornecedor: nomeParceiro(ctx, grupo[0]), meses: meses.size, mensal, anual },
      chave: chaveAchado("CU-RECORRENTE", codigo, chaveMes(ctx.dataReferencia)),
    });
  }
  return achados;
}

// CU-OUTLIER — titulo muito acima do que aquele fornecedor costuma cobrar.
// Usa mediana (nao media) justamente para o proprio outlier nao contaminar a
// base de comparacao.
const FATOR_OUTLIER = 3;
const MINIMO_HISTORICO_OUTLIER = 4;

function valorForaDoPadrao(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const inicioMes = inicioDoMes(ctx.dataReferencia);
  const porFornecedor = agrupar(titulosAtivos(ctx, "PAGAR"), (t) => chaveParceiro(t));
  const achados: AchadoNovo[] = [];

  for (const [, grupo] of porFornecedor) {
    const historicos = grupo.filter((t) => t.dataVencimento < inicioMes);
    if (historicos.length < MINIMO_HISTORICO_OUTLIER) continue;

    const valores = historicos.map((t) => t.valorDocumentoCents).sort((a, b) => a - b);
    const mediana = valores[Math.floor(valores.length / 2)];
    if (mediana <= 0) continue;

    for (const t of grupo.filter((x) => x.dataVencimento >= inicioMes)) {
      if (t.valorDocumentoCents < mediana * FATOR_OUTLIER) continue;
      const excedente = t.valorDocumentoCents - mediana;
      if (excedente < materialidade) continue;

      achados.push({
        regra: "CU-OUTLIER",
        tipo: "ESTADO",
        severidade: severidadePorValor(excedente, materialidade),
        categoria: "RISCO_FINANCEIRO",
        titulo: `Valor fora do padrão — ${nomeParceiro(ctx, t)}`,
        descricao:
          `Título de ${fmtBRL(t.valorDocumentoCents)} contra uma mediana histórica de ${fmtBRL(mediana)} ` +
          `para esse fornecedor (${historicos.length} títulos anteriores) — ${FATOR_OUTLIER}x acima do usual.`,
        recomendacao:
          "Conferir a nota antes do pagamento: escopo maior, reajuste, cobrança acumulada de meses anteriores ou erro de digitação. " +
          "Se for reajuste, verificar se está previsto em contrato e no índice correto.",
        valorCents: t.valorDocumentoCents,
        impactoCents: excedente,
        dataReferencia: t.dataVencimento,
        entidadeTipo: "OmieTitulo",
        entidadeId: t.id,
        entidadeRef: t.numeroDocumento ?? t.codigoLancamento,
        evidencia: { fornecedor: nomeParceiro(ctx, t), valor: t.valorDocumentoCents, mediana, historico: historicos.length },
        chave: chaveAchado("CU-OUTLIER", refTitulo(t)),
      });
    }
  }
  return achados;
}

// CU-COMBUSTIVEL — cruzamento entre o que a Omie registra de combustivel e o
// extrato do cartao de frota ja importado neste sistema (FuelTransaction).
// Este e o tipo de checagem que NENHUM dos dois sistemas faz sozinho, e e
// exatamente onde some dinheiro em transportadora: abastecimento que nao
// virou despesa, ou despesa lancada sem abastecimento correspondente.
const PALAVRAS_COMBUSTIVEL = /combust|diesel|gasolina|arla|posto|abastec/i;
const TOLERANCIA_DIVERGENCIA_PERCENT = 5;

function divergenciaCombustivel(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const inicio = inicioDoMes(new Date(ctx.dataReferencia.getFullYear(), ctx.dataReferencia.getMonth() - 1, 1));
  const fim = new Date(ctx.dataReferencia.getFullYear(), ctx.dataReferencia.getMonth(), 0, 23, 59, 59, 999);
  if (fim < inicio) return [];

  const categoriasCombustivel = new Set(
    ctx.categorias.filter((c) => PALAVRAS_COMBUSTIVEL.test(c.descricao)).map((c) => c.codigo)
  );

  const naOmie = titulosAtivos(ctx, "PAGAR").filter(
    (t) =>
      t.dataVencimento >= inicio &&
      t.dataVencimento <= fim &&
      ((t.categoriaCodigo && categoriasCombustivel.has(t.categoriaCodigo)) ||
        PALAVRAS_COMBUSTIVEL.test(t.parceiroNome ?? "") ||
        PALAVRAS_COMBUSTIVEL.test(t.categoriaDescricao ?? ""))
  );
  const totalOmie = somar(naOmie, (t) => t.valorDocumentoCents);

  const noCartao = ctx.abastecimentos.filter((f) => f.dataHora >= inicio && f.dataHora <= fim);
  const totalCartao = somar(noCartao, (f) => f.valorCents);

  // Sem um dos dois lados nao ha comparacao possivel — e apontar "divergencia
  // de 100%" nesse caso seria alarme falso puro.
  if (totalOmie === 0 || totalCartao === 0) return [];

  const diferenca = Math.abs(totalOmie - totalCartao);
  const percentual = (diferenca / Math.max(totalOmie, totalCartao)) * 100;
  if (percentual < TOLERANCIA_DIVERGENCIA_PERCENT || diferenca < materialidade) return [];

  return [
    {
      regra: "CU-COMBUSTIVEL",
      tipo: "ESTADO",
      severidade: severidadePorValor(diferenca, materialidade),
      categoria: "ERRO_PROCESSO",
      titulo: `Combustível: ${fmtBRL(diferenca)} de diferença entre Omie e cartão de frota`,
      descricao:
        `No mês fechado anterior, a Omie registra ${fmtBRL(totalOmie)} em combustível e o extrato do cartão de frota ` +
        `importado neste sistema registra ${fmtBRL(totalCartao)} — diferença de ${fmtPercent(percentual)}. ` +
        `Um dos dois lados está incompleto, e o custo por veículo sai errado nos dois casos.`,
      recomendacao:
        "Conferir se todas as notas do cartão foram lançadas na Omie e se há abastecimento pago por fora do cartão " +
        "(dinheiro ou cartão pessoal com reembolso). A diferença recorrente costuma ser abastecimento fora da política.",
      valorCents: diferenca,
      dataReferencia: fim,
      evidencia: { totalOmie, totalCartao, diferenca, percentual, titulos: naOmie.length, transacoes: noCartao.length },
      chave: chaveAchado("CU-COMBUSTIVEL", chaveMes(fim)),
    },
  ];
}

// CU-CONCENTRACAO-FORNECEDOR — dependencia de um unico fornecedor. Espelho da
// concentracao de clientes, com consequencia diferente: aqui o risco e perder
// poder de negociacao e ficar exposto a uma parada de fornecimento.
function concentracaoDeFornecedor(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const inicio = new Date(ctx.dataReferencia.getFullYear(), ctx.dataReferencia.getMonth() - 2, 1);
  const titulos = titulosAtivos(ctx, "PAGAR").filter((t) => t.dataVencimento >= inicio);
  const total = somar(titulos, (t) => t.valorDocumentoCents);
  if (total <= 0) return [];

  const achados: AchadoNovo[] = [];
  for (const [codigo, grupo] of agrupar(titulos, (t) => chaveParceiro(t))) {
    const valor = somar(grupo, (t) => t.valorDocumentoCents);
    const participacao = (valor / total) * 100;
    if (participacao < ctx.config.limiteConcentracaoFornecedorPercent) continue;

    achados.push({
      regra: "CU-CONCENTRACAO-FORNECEDOR",
      tipo: "ESTADO",
      severidade: participacao >= 50 ? "MEDIA" : "BAIXA",
      categoria: "OPORTUNIDADE",
      titulo: `${nomeParceiro(ctx, grupo[0])} concentra ${fmtPercent(participacao)} dos custos`,
      descricao:
        `Nos últimos 3 meses, esse fornecedor recebeu ${fmtBRL(valor)} de ${fmtBRL(total)} em títulos a pagar. ` +
        `Volume dessa ordem dá poder de negociação — e, sem alternativa mapeada, também dá risco de dependência.`,
      recomendacao:
        "Usar o volume como argumento: renegociar preço ou prazo de pagamento com base no histórico anual. " +
        "Em paralelo, homologar um segundo fornecedor para reduzir risco de parada e ter parâmetro de preço.",
      valorCents: valor,
      impactoCents: Math.round(valor * 0.05),
      dataReferencia: ctx.dataReferencia,
      entidadeTipo: "OmieParceiro",
      entidadeRef: nomeParceiro(ctx, grupo[0]),
      evidencia: { fornecedor: nomeParceiro(ctx, grupo[0]), valor, total, participacao },
      chave: chaveAchado("CU-CONCENTRACAO-FORNECEDOR", codigo, chaveMes(ctx.dataReferencia)),
    });
  }

  void materialidade;
  return achados;
}
