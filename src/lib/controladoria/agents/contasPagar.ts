import { fmtBRL, fmtData, fmtPercent } from "../format";
import { diasEntre, ehDiaNaoUtil } from "../periodos";
import type { AchadoNovo, Agente, ContextoAuditoria } from "../types";
import {
  agravar,
  agrupar,
  chaveAchado,
  chaveParceiro,
  diasDeAtraso,
  emAberto,
  materialidadeCents,
  nomeParceiro,
  refTitulo,
  referenciaTitulo,
  saldoAberto,
  severidadePorValor,
  somar,
  titulosAtivos,
} from "./comum";

// AGENTE DE CONTAS A PAGAR
// Responde a pergunta que mais custa dinheiro numa empresa de servicos:
// "quanto a nossa propria desorganizacao esta pagando de juros, multa e
// tarifa que nao deveriamos estar pagando?" — e, ao lado dela, "o que
// estamos prestes a pagar de novo pelo mesmo motivo?".

// Antecipar pagamento sem desconto e custo de capital jogado fora. 5 dias e
// o limiar a partir do qual isso deixa de ser arredondamento de rotina de
// pagamento (lote semanal) e passa a ser decisao que vale revisar.
const DIAS_ANTECIPACAO_RELEVANTE = 5;
// Titulo vencido ha mais de 6 meses e ainda aberto quase nunca e divida viva:
// costuma ser lancamento esquecido, duplicado ou ja pago por fora e nao
// baixado — passivo fantasma que distorce todo o fluxo de caixa projetado.
const DIAS_TITULO_FANTASMA = 180;
// Tolerancia de centavos ao comparar valor pago x valor devido: arredondamento
// de juros diario do proprio banco entra nessa faixa e nao e divergencia.
const TOLERANCIA_CENTAVOS = 50;

export const agenteContasPagar: Agente = {
  id: "contas-pagar",
  nome: "Contas a pagar",
  area: "Financeiro",
  descricao:
    "Audita títulos a pagar: juros e multa por atraso, duplicidade, pagamento acima do documento, títulos vencidos em aberto, antecipação sem desconto e falhas de classificação que impedem o custo por contrato.",
  executar: auditarContasPagar,
};

function auditarContasPagar(ctx: ContextoAuditoria): AchadoNovo[] {
  const achados: AchadoNovo[] = [];
  const materialidade = materialidadeCents(ctx);
  const titulos = titulosAtivos(ctx, "PAGAR");

  achados.push(...jurosEMulta(ctx, titulos, materialidade));
  achados.push(...vencidosEmAberto(ctx, titulos, materialidade));
  achados.push(...duplicidades(ctx, titulos, materialidade));
  achados.push(...pagamentoAcimaDoDevido(ctx, titulos, materialidade));
  achados.push(...antecipacaoSemDesconto(ctx, titulos, materialidade));
  achados.push(...classificacaoIncompleta(ctx, titulos, materialidade));
  achados.push(...titulosFantasma(ctx, titulos, materialidade));
  achados.push(...vencimentoEmDiaNaoUtil(ctx, titulos));
  achados.push(...divergenciaDeBaixa(ctx, titulos, materialidade));

  return achados;
}

// CP-JUROS — dinheiro que ja saiu por atraso. EVENTO: e fato consumado e
// datado, nao some da base; so uma pessoa encerra depois de tratar a causa.
function jurosEMulta(ctx: ContextoAuditoria, titulos: ReturnType<typeof titulosAtivos>, materialidade: number): AchadoNovo[] {
  return titulos
    .filter((t) => t.jurosCents + t.multaCents > 0)
    .map((t) => {
      const perda = t.jurosCents + t.multaCents + t.tarifaCents;
      const atraso = t.dataUltimaBaixa ? diasEntre(t.dataVencimento, t.dataUltimaBaixa) : null;
      const percentual = t.valorDocumentoCents > 0 ? (perda / t.valorDocumentoCents) * 100 : 0;

      return {
        regra: "CP-JUROS",
        tipo: "EVENTO" as const,
        severidade: severidadePorValor(perda, materialidade),
        categoria: "PERDA_FINANCEIRA" as const,
        titulo: `Juros/multa pagos a ${nomeParceiro(ctx, t)}`,
        descricao:
          `Título ${referenciaTitulo(t)} de ${fmtBRL(t.valorDocumentoCents)} (venc. ${fmtData(t.dataVencimento)}) ` +
          `foi pago em ${fmtData(t.dataUltimaBaixa)}${atraso !== null ? `, ${atraso} dia(s) após o vencimento` : ""}, ` +
          `com ${fmtBRL(t.jurosCents)} de juros, ${fmtBRL(t.multaCents)} de multa e ${fmtBRL(t.tarifaCents)} de tarifa — ` +
          `${fmtPercent(percentual)} do valor do título jogado fora.`,
        recomendacao:
          "Levantar a causa do atraso (falta de saldo, aprovação parada ou nota recebida fora do prazo). " +
          "Se for recorrente com o mesmo fornecedor, renegociar data de vencimento para o ciclo de pagamento da empresa " +
          "e programar o pagamento em lote com 3 dias de folga.",
        valorCents: perda,
        impactoCents: perda,
        dataReferencia: t.dataUltimaBaixa ?? t.dataVencimento,
        entidadeTipo: "OmieTitulo",
        entidadeId: t.id,
        entidadeRef: referenciaTitulo(t),
        evidencia: {
          fornecedor: nomeParceiro(ctx, t),
          valorTitulo: t.valorDocumentoCents,
          juros: t.jurosCents,
          multa: t.multaCents,
          tarifa: t.tarifaCents,
          vencimento: t.dataVencimento.toISOString(),
          pagamento: t.dataUltimaBaixa?.toISOString() ?? null,
        },
        chave: chaveAchado("CP-JUROS", refTitulo(t)),
      };
    });
}

// CP-VENCIDO — ESTADO: some sozinho quando o titulo e pago.
function vencidosEmAberto(ctx: ContextoAuditoria, titulos: ReturnType<typeof titulosAtivos>, materialidade: number): AchadoNovo[] {
  return titulos
    .filter((t) => emAberto(t) && diasDeAtraso(t, ctx.dataReferencia) > 0)
    .filter((t) => diasDeAtraso(t, ctx.dataReferencia) <= DIAS_TITULO_FANTASMA)
    .map((t) => {
      const atraso = diasDeAtraso(t, ctx.dataReferencia);
      const saldo = saldoAberto(t);
      let severidade = severidadePorValor(saldo, materialidade);
      if (atraso >= ctx.config.diasAtrasoCritico) severidade = agravar(severidade);

      return {
        regra: "CP-VENCIDO",
        tipo: "ESTADO" as const,
        severidade,
        categoria: "RISCO_FINANCEIRO" as const,
        titulo: `Título vencido em aberto — ${nomeParceiro(ctx, t)}`,
        descricao:
          `${referenciaTitulo(t)} venceu em ${fmtData(t.dataVencimento)} (${atraso} dia(s) atrás) e ainda tem ` +
          `${fmtBRL(saldo)} em aberto. Cada dia adicional acumula juros e desgasta a relação com o fornecedor.`,
        recomendacao:
          "Confirmar se o pagamento foi feito por fora e não baixado (erro de processo) ou se está realmente em aberto. " +
          "Estando em aberto, negociar a quitação sem encargos antes que o título entre em régua de cobrança.",
        valorCents: saldo,
        dataReferencia: t.dataVencimento,
        entidadeTipo: "OmieTitulo",
        entidadeId: t.id,
        entidadeRef: referenciaTitulo(t),
        evidencia: { fornecedor: nomeParceiro(ctx, t), saldo, atraso, status: t.status },
        chave: chaveAchado("CP-VENCIDO", refTitulo(t)),
      };
    });
}

// CP-DUPLICIDADE — mesmo fornecedor, mesmo valor, mesmo vencimento. E o furo
// classico de contas a pagar: a nota chega por dois caminhos (e-mail do
// fornecedor e portal) e e lancada duas vezes. Quando as duas ja foram
// PAGAS, deixa de ser risco e vira dinheiro a recuperar — por isso a
// categoria muda conforme o estado.
function duplicidades(ctx: ContextoAuditoria, titulos: ReturnType<typeof titulosAtivos>, materialidade: number): AchadoNovo[] {
  const achados: AchadoNovo[] = [];
  const grupos = agrupar(titulos, (t) =>
    [chaveParceiro(t), t.valorDocumentoCents, t.dataVencimento.toISOString().slice(0, 10)].join("|")
  );

  for (const [, grupo] of grupos) {
    if (grupo.length < 2) continue;
    // Parcelas diferentes do mesmo carne coincidem em valor mas nao em
    // vencimento; ja o mesmo numero de documento repetido no mesmo
    // vencimento e duplicidade real. Documentos distintos com mesmo valor e
    // vencimento ainda sao suspeitos, mas com severidade menor.
    const documentos = new Set(grupo.map((t) => t.numeroDocumento ?? ""));
    const mesmoDocumento = documentos.size === 1 && grupo[0].numeroDocumento !== null;
    const parcelas = new Set(grupo.map((t) => t.numeroParcela ?? ""));
    if (!mesmoDocumento && parcelas.size === grupo.length && parcelas.size > 1) continue;

    const valorTotal = somar(grupo, (t) => t.valorDocumentoCents);
    const excedente = valorTotal - grupo[0].valorDocumentoCents;
    const todosPagos = grupo.every((t) => !emAberto(t));

    let severidade = severidadePorValor(excedente, materialidade);
    if (mesmoDocumento) severidade = agravar(severidade);

    achados.push({
      regra: "CP-DUPLICIDADE",
      tipo: todosPagos ? "EVENTO" : "ESTADO",
      severidade,
      categoria: todosPagos ? "PERDA_FINANCEIRA" : "FRAUDE",
      titulo: `${grupo.length} títulos idênticos — ${nomeParceiro(ctx, grupo[0])}`,
      descricao:
        `${grupo.length} títulos do mesmo fornecedor com valor idêntico (${fmtBRL(grupo[0].valorDocumentoCents)}) e ` +
        `mesmo vencimento (${fmtData(grupo[0].dataVencimento)})` +
        `${mesmoDocumento ? `, todos com o mesmo número de documento (${grupo[0].numeroDocumento})` : ""}. ` +
        `${todosPagos ? "Todos já foram pagos" : "Ao menos um ainda está em aberto"} — exposição de ${fmtBRL(excedente)}.`,
      recomendacao: todosPagos
        ? "Confrontar com a nota fiscal do fornecedor. Confirmada a duplicidade, solicitar devolução ou compensação no próximo faturamento e registrar o crédito."
        : "Bloquear o pagamento em aberto até conferir a nota fiscal. Se for duplicidade, cancelar o título antes da data de pagamento.",
      valorCents: excedente,
      impactoCents: excedente,
      dataReferencia: grupo[0].dataVencimento,
      entidadeTipo: "OmieTitulo",
      entidadeId: grupo[0].id,
      entidadeRef: referenciaTitulo(grupo[0]),
      evidencia: {
        fornecedor: nomeParceiro(ctx, grupo[0]),
        lancamentos: grupo.map((t) => t.codigoLancamento),
        documentos: [...documentos],
        valorUnitario: grupo[0].valorDocumentoCents,
      },
      chave: chaveAchado("CP-DUPLICIDADE", ...grupo.map(refTitulo).sort()),
    });
  }

  return achados;
}

// CP-PAGO-ACIMA — pagou mais do que devia, alem do que juros/multa
// justificam. Ou e erro de digitacao na baixa, ou e pagamento indevido.
function pagamentoAcimaDoDevido(
  ctx: ContextoAuditoria,
  titulos: ReturnType<typeof titulosAtivos>,
  materialidade: number
): AchadoNovo[] {
  return titulos
    .filter((t) => t.valorPagoCents > 0)
    .map((t) => {
      const devido = t.valorDocumentoCents + t.jurosCents + t.multaCents + t.tarifaCents - t.descontoCents;
      const excedente = t.valorPagoCents - devido;
      return { t, excedente };
    })
    .filter(({ excedente }) => excedente > TOLERANCIA_CENTAVOS)
    .map(({ t, excedente }) => ({
      regra: "CP-PAGO-ACIMA",
      tipo: "EVENTO" as const,
      severidade: agravar(severidadePorValor(excedente, materialidade)),
      categoria: "PERDA_FINANCEIRA" as const,
      titulo: `Pagamento acima do devido — ${nomeParceiro(ctx, t)}`,
      descricao:
        `${referenciaTitulo(t)}: pago ${fmtBRL(t.valorPagoCents)} contra ${fmtBRL(
          t.valorDocumentoCents + t.jurosCents + t.multaCents + t.tarifaCents - t.descontoCents
        )} devidos (documento + encargos − desconto). Excedente de ${fmtBRL(excedente)} sem justificativa no título.`,
      recomendacao:
        "Conferir o comprovante de pagamento contra o título. Sendo erro de digitação na baixa, corrigir na Omie; " +
        "sendo pagamento a maior de fato, cobrar a devolução do fornecedor.",
      valorCents: excedente,
      impactoCents: excedente,
      dataReferencia: t.dataUltimaBaixa ?? t.dataVencimento,
      entidadeTipo: "OmieTitulo",
      entidadeId: t.id,
      entidadeRef: referenciaTitulo(t),
      evidencia: {
        pago: t.valorPagoCents,
        documento: t.valorDocumentoCents,
        juros: t.jurosCents,
        multa: t.multaCents,
        desconto: t.descontoCents,
      },
      chave: chaveAchado("CP-PAGO-ACIMA", refTitulo(t)),
    }));
}

// CP-ANTECIPACAO — pagou muito antes do vencimento sem ganhar desconto.
// Nao e erro, e OPORTUNIDADE: o dinheiro poderia ter rendido (ou evitado
// juros de capital de giro) ate a data certa. O impacto e estimado pelo
// custo de oportunidade do periodo antecipado.
const CUSTO_CAPITAL_MENSAL = 0.01; // 1% a.m. — piso conservador para capital de giro no Brasil

function antecipacaoSemDesconto(
  ctx: ContextoAuditoria,
  titulos: ReturnType<typeof titulosAtivos>,
  materialidade: number
): AchadoNovo[] {
  const porFornecedor = agrupar(
    titulos.filter((t) => {
      if (!t.dataUltimaBaixa || t.descontoCents > 0) return false;
      const antecipacao = diasEntre(t.dataUltimaBaixa, t.dataVencimento);
      return antecipacao >= DIAS_ANTECIPACAO_RELEVANTE;
    }),
    (t) => chaveParceiro(t)
  );

  const achados: AchadoNovo[] = [];
  for (const [codigo, grupo] of porFornecedor) {
    // Achado por fornecedor, nao por titulo: um alerta por nota antecipada
    // seria ruido; o que interessa e o padrao ("sempre pagamos a Transportes
    // X com 12 dias de antecedencia").
    const diasMedios = Math.round(
      somar(grupo, (t) => diasEntre(t.dataUltimaBaixa!, t.dataVencimento)) / grupo.length
    );
    const volume = somar(grupo, (t) => t.valorPagoCents);
    const custoOportunidade = Math.round(volume * CUSTO_CAPITAL_MENSAL * (diasMedios / 30));
    if (custoOportunidade < materialidade / 4) continue;

    achados.push({
      regra: "CP-ANTECIPACAO",
      tipo: "ESTADO",
      severidade: severidadePorValor(custoOportunidade, materialidade),
      categoria: "OPORTUNIDADE",
      titulo: `Pagamentos antecipados sem desconto — ${nomeParceiro(ctx, grupo[0])}`,
      descricao:
        `${grupo.length} título(s) desse fornecedor, somando ${fmtBRL(volume)}, foram pagos em média ${diasMedios} dia(s) ` +
        `antes do vencimento, sem nenhum desconto registrado. Ao custo de capital de ${fmtPercent(
          CUSTO_CAPITAL_MENSAL * 100
        )} ao mês, isso equivale a ${fmtBRL(custoOportunidade)} de caixa antecipado sem contrapartida.`,
      recomendacao:
        "Ou pagar na data de vencimento (mantendo o caixa aplicado), ou negociar desconto de antecipação com o fornecedor — " +
        "o desconto deve ser no mínimo igual ao custo de capital do período antecipado.",
      valorCents: volume,
      impactoCents: custoOportunidade,
      dataReferencia: ctx.dataReferencia,
      entidadeTipo: "OmieParceiro",
      entidadeRef: nomeParceiro(ctx, grupo[0]),
      evidencia: { fornecedor: nomeParceiro(ctx, grupo[0]), titulos: grupo.length, diasMedios, volume },
      chave: chaveAchado("CP-ANTECIPACAO", codigo),
    });
  }
  return achados;
}

// CP-SEM-CLASSIFICACAO — titulo sem categoria ou sem centro de custo. Esta e
// a regra que sustenta TODO o resto do modulo: sem classificacao nao ha DRE
// por natureza, nao ha custo por contrato, nao ha comparativo confiavel.
// Agregada por mes (nao por titulo) para virar uma acao de processo e nao
// centenas de alertas.
function classificacaoIncompleta(
  ctx: ContextoAuditoria,
  titulos: ReturnType<typeof titulosAtivos>,
  materialidade: number
): AchadoNovo[] {
  const achados: AchadoNovo[] = [];
  const doMes = titulos.filter(
    (t) => t.dataVencimento >= new Date(ctx.dataReferencia.getFullYear(), ctx.dataReferencia.getMonth(), 1)
  );
  if (doMes.length === 0) return achados;

  const semCategoria = doMes.filter((t) => !t.categoriaCodigo);
  const semCentroCusto = doMes.filter((t) => !t.departamentoCodigo && !t.projetoCodigo);
  const semDocumento = doMes.filter((t) => !t.numeroDocumento);
  const mes = `${ctx.dataReferencia.getFullYear()}-${String(ctx.dataReferencia.getMonth() + 1).padStart(2, "0")}`;

  if (semCategoria.length > 0) {
    const valor = somar(semCategoria, (t) => t.valorDocumentoCents);
    achados.push({
      regra: "CP-SEM-CATEGORIA",
      tipo: "ESTADO",
      severidade: severidadePorValor(valor, materialidade),
      categoria: "ERRO_PROCESSO",
      titulo: `${semCategoria.length} títulos a pagar sem categoria no mês`,
      descricao:
        `${semCategoria.length} de ${doMes.length} títulos do mês (${fmtPercent(
          (semCategoria.length / doMes.length) * 100
        )}), somando ${fmtBRL(valor)}, estão sem categoria financeira. Esse valor não aparece em nenhuma linha do DRE gerencial ` +
        `e some das comparações de custo por natureza.`,
      recomendacao:
        "Classificar os títulos listados na Omie e, para evitar reincidência, tornar a categoria obrigatória no cadastro de contas a pagar.",
      valorCents: valor,
      dataReferencia: ctx.dataReferencia,
      evidencia: { titulos: semCategoria.slice(0, 50).map((t) => t.codigoLancamento), total: semCategoria.length },
      chave: chaveAchado("CP-SEM-CATEGORIA", mes),
    });
  }

  if (semCentroCusto.length > 0) {
    const valor = somar(semCentroCusto, (t) => t.valorDocumentoCents);
    achados.push({
      regra: "CP-SEM-CENTRO-CUSTO",
      tipo: "ESTADO",
      severidade: severidadePorValor(valor, materialidade),
      categoria: "ERRO_PROCESSO",
      titulo: `${fmtBRL(valor)} em custos do mês sem centro de custo`,
      descricao:
        `${semCentroCusto.length} títulos do mês não têm departamento nem projeto informado. Enquanto isso, não é possível ` +
        `apurar custo por contrato, por veículo ou por funcionário — que é exatamente o que permite saber qual contrato dá lucro.`,
      recomendacao:
        "Definir departamento/projeto obrigatório no lançamento e fazer o de-para dos existentes em Controladoria → Rentabilidade. " +
        "Começar pelos maiores valores: os 10 primeiros títulos costumam cobrir a maior parte do valor não alocado.",
      valorCents: valor,
      dataReferencia: ctx.dataReferencia,
      evidencia: { titulos: semCentroCusto.slice(0, 50).map((t) => t.codigoLancamento), total: semCentroCusto.length },
      chave: chaveAchado("CP-SEM-CENTRO-CUSTO", mes),
    });
  }

  if (semDocumento.length > 0) {
    const valor = somar(semDocumento, (t) => t.valorDocumentoCents);
    achados.push({
      regra: "CP-SEM-DOCUMENTO",
      tipo: "ESTADO",
      severidade: severidadePorValor(valor, materialidade),
      categoria: "CONFORMIDADE",
      titulo: `${semDocumento.length} títulos a pagar sem número de documento`,
      descricao:
        `${fmtBRL(valor)} em títulos do mês sem número de documento fiscal. Pagamento sem nota é despesa não dedutível, ` +
        `risco fiscal e o cenário em que um pagamento indevido passa despercebido — não há o que conferir contra.`,
      recomendacao:
        "Exigir nota fiscal antes da liberação do pagamento. Para os títulos já lançados, cobrar o documento do fornecedor e anexá-lo na Omie.",
      valorCents: valor,
      dataReferencia: ctx.dataReferencia,
      evidencia: { titulos: semDocumento.slice(0, 50).map((t) => t.codigoLancamento), total: semDocumento.length },
      chave: chaveAchado("CP-SEM-DOCUMENTO", mes),
    });
  }

  return achados;
}

// CP-FANTASMA — vencido ha mais de 6 meses e ainda "em aberto".
function titulosFantasma(
  ctx: ContextoAuditoria,
  titulos: ReturnType<typeof titulosAtivos>,
  materialidade: number
): AchadoNovo[] {
  const antigos = titulos.filter(
    (t) => emAberto(t) && diasDeAtraso(t, ctx.dataReferencia) > DIAS_TITULO_FANTASMA
  );
  if (antigos.length === 0) return [];

  const valor = somar(antigos, saldoAberto);
  return [
    {
      regra: "CP-FANTASMA",
      tipo: "ESTADO",
      severidade: severidadePorValor(valor, materialidade),
      categoria: "ERRO_PROCESSO",
      titulo: `${antigos.length} títulos vencidos há mais de ${DIAS_TITULO_FANTASMA} dias ainda em aberto`,
      descricao:
        `${fmtBRL(valor)} em títulos a pagar vencidos há mais de seis meses continuam com saldo em aberto na Omie. ` +
        `Na prática quase sempre são lançamentos já pagos e não baixados, duplicados ou cancelados sem baixa — ` +
        `e enquanto ficam ali, distorcem o fluxo de caixa projetado e o passivo da empresa.`,
      recomendacao:
        "Fazer um mutirão de limpeza: conferir cada um contra o extrato bancário do período e baixar, cancelar ou renegociar. " +
        "Depois disso, incluir na rotina mensal a conferência de títulos vencidos há mais de 60 dias.",
      valorCents: valor,
      dataReferencia: ctx.dataReferencia,
      evidencia: {
        titulos: antigos.slice(0, 50).map((t) => ({
          lancamento: t.codigoLancamento,
          fornecedor: nomeParceiro(ctx, t),
          vencimento: t.dataVencimento.toISOString(),
          saldo: saldoAberto(t),
        })),
        total: antigos.length,
      },
      chave: chaveAchado("CP-FANTASMA", "atual"),
    },
  ];
}

// CP-VENC-NAO-UTIL — vencimento em sabado, domingo ou feriado fixo. Risco
// operacional barato de eliminar e caro de ignorar: o pagamento cai no dia
// util seguinte e o fornecedor cobra juros de um atraso que a empresa nao
// escolheu.
function vencimentoEmDiaNaoUtil(ctx: ContextoAuditoria, titulos: ReturnType<typeof titulosAtivos>): AchadoNovo[] {
  const proximos = titulos.filter(
    (t) =>
      emAberto(t) &&
      t.dataVencimento >= ctx.dataReferencia &&
      diasEntre(ctx.dataReferencia, t.dataVencimento) <= 15 &&
      ehDiaNaoUtil(t.dataVencimento)
  );
  if (proximos.length === 0) return [];

  const valor = somar(proximos, saldoAberto);
  return [
    {
      regra: "CP-VENC-NAO-UTIL",
      tipo: "ESTADO",
      severidade: "BAIXA",
      categoria: "RISCO_FINANCEIRO",
      titulo: `${proximos.length} títulos vencem em dia não útil nos próximos 15 dias`,
      descricao:
        `${fmtBRL(valor)} em títulos têm vencimento em fim de semana ou feriado. Se o pagamento não for antecipado ` +
        `para o dia útil anterior, cai no dia seguinte e pode gerar juros por um atraso puramente de calendário.`,
      recomendacao: "Programar esses pagamentos para o último dia útil anterior ao vencimento.",
      valorCents: valor,
      dataReferencia: ctx.dataReferencia,
      evidencia: {
        titulos: proximos.map((t) => ({
          lancamento: t.codigoLancamento,
          fornecedor: nomeParceiro(ctx, t),
          vencimento: t.dataVencimento.toISOString(),
        })),
      },
      chave: chaveAchado("CP-VENC-NAO-UTIL", ctx.dataReferencia.toISOString().slice(0, 10)),
    },
  ];
}

// CP-DIVERGENCIA-BAIXA — o resumo financeiro do titulo nao bate com a soma
// das baixas dele. Quando as duas fontes da propria Omie discordam, o numero
// do relatorio esta errado de um jeito ou de outro — e isso precisa aparecer
// em vez de ser silenciosamente escolhido pelo codigo.
function divergenciaDeBaixa(
  ctx: ContextoAuditoria,
  titulos: ReturnType<typeof titulosAtivos>,
  materialidade: number
): AchadoNovo[] {
  const baixasPorTitulo = agrupar(ctx.baixas, (b) => b.tituloId);

  return titulos
    .map((t) => {
      const baixas = baixasPorTitulo.get(t.id) ?? [];
      if (baixas.length === 0) return null;
      const somaBaixas = somar(baixas, (b) => b.valorCents);
      const diferenca = t.valorPagoCents - somaBaixas;
      return Math.abs(diferenca) > TOLERANCIA_CENTAVOS
        ? { t, somaBaixas, diferenca, quantidadeBaixas: baixas.length }
        : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .map(({ t, somaBaixas, diferenca, quantidadeBaixas }) => ({
      regra: "CP-DIVERGENCIA-BAIXA",
      tipo: "ESTADO" as const,
      severidade: severidadePorValor(Math.abs(diferenca), materialidade),
      categoria: "ERRO_PROCESSO" as const,
      titulo: `Divergência entre título e baixas — ${nomeParceiro(ctx, t)}`,
      descricao:
        `${referenciaTitulo(t)} registra ${fmtBRL(t.valorPagoCents)} pagos, mas a soma das baixas lançadas é ` +
        `${fmtBRL(somaBaixas)} (diferença de ${fmtBRL(Math.abs(diferenca))}). Uma das duas informações da Omie está incorreta.`,
      recomendacao:
        "Abrir o título na Omie e conferir as baixas contra o extrato bancário. Corrigir a baixa divergente antes do fechamento do mês.",
      valorCents: Math.abs(diferenca),
      dataReferencia: t.dataUltimaBaixa ?? t.dataVencimento,
      entidadeTipo: "OmieTitulo",
      entidadeId: t.id,
      entidadeRef: referenciaTitulo(t),
      evidencia: { valorPagoTitulo: t.valorPagoCents, somaBaixas, baixas: quantidadeBaixas },
      chave: chaveAchado("CP-DIVERGENCIA-BAIXA", refTitulo(t)),
    }));
}
