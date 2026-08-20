import { fmtBRL, fmtPercent } from "../format";
import { diasEntre, inicioDoMes } from "../periodos";
import type { AchadoNovo, Agente, ContextoAuditoria } from "../types";
import {
  agravar,
  agrupar,
  chaveAchado,
  chaveMes,
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

// AGENTE DE CONTAS A RECEBER
// O lado que a maioria das empresas de fretamento audita menos e onde o
// dinheiro some mais devagar: recebimento a menor, desconto concedido sem
// politica, cliente que atrasa sistematicamente e receita que envelhece ate
// virar perda.

// Faixas de aging usadas no relatorio e nas regras. Sao as mesmas faixas
// classicas de credito e cobranca — trocar por faixas proprias so
// dificultaria comparar com qualquer referencia de mercado.
export const FAIXAS_AGING = [
  { rotulo: "A vencer", min: -Infinity, max: 0 },
  { rotulo: "1 a 30 dias", min: 1, max: 30 },
  { rotulo: "31 a 60 dias", min: 31, max: 60 },
  { rotulo: "61 a 90 dias", min: 61, max: 90 },
  { rotulo: "Acima de 90 dias", min: 91, max: Infinity },
];

// Acima disso, a chance real de receber cai muito e o titulo ja deveria
// estar provisionado como perda (e nao inflando o ativo).
const DIAS_PERDA_PROVAVEL = 180;

export const agenteContasReceber: Agente = {
  id: "contas-receber",
  nome: "Contas a receber",
  area: "Financeiro",
  descricao:
    "Audita títulos a receber: inadimplência por faixa de atraso, clientes com atraso recorrente, descontos concedidos, recebimento a menor, concentração de receita e créditos que já deveriam estar provisionados como perda.",
  executar: auditarContasReceber,
};

function auditarContasReceber(ctx: ContextoAuditoria): AchadoNovo[] {
  const achados: AchadoNovo[] = [];
  const materialidade = materialidadeCents(ctx);
  const titulos = titulosAtivos(ctx, "RECEBER");

  achados.push(...inadimplenciaPorCliente(ctx, titulos, materialidade));
  achados.push(...perdaProvavel(ctx, titulos, materialidade));
  achados.push(...descontosConcedidos(ctx, titulos, materialidade));
  achados.push(...recebimentoAMenor(ctx, titulos, materialidade));
  achados.push(...concentracaoDeReceita(ctx, titulos, materialidade));
  achados.push(...atrasoRecorrente(ctx, titulos, materialidade));

  return achados;
}

// CR-INADIMPLENCIA — um achado por cliente com titulo vencido, nao um por
// titulo: cobranca se faz por cliente.
function inadimplenciaPorCliente(
  ctx: ContextoAuditoria,
  titulos: ReturnType<typeof titulosAtivos>,
  materialidade: number
): AchadoNovo[] {
  const vencidos = titulos.filter(
    (t) => emAberto(t) && diasDeAtraso(t, ctx.dataReferencia) > 0 && diasDeAtraso(t, ctx.dataReferencia) <= DIAS_PERDA_PROVAVEL
  );
  const porCliente = agrupar(vencidos, (t) => chaveParceiro(t));

  const achados: AchadoNovo[] = [];
  for (const [codigo, grupo] of porCliente) {
    const valor = somar(grupo, saldoAberto);
    if (valor < materialidade / 2) continue;

    const atrasoMaximo = Math.max(...grupo.map((t) => diasDeAtraso(t, ctx.dataReferencia)));
    let severidade = severidadePorValor(valor, materialidade);
    if (atrasoMaximo > 90) severidade = agravar(severidade);

    achados.push({
      regra: "CR-INADIMPLENCIA",
      tipo: "ESTADO",
      severidade,
      categoria: "RISCO_FINANCEIRO",
      titulo: `${nomeParceiro(ctx, grupo[0])} com ${fmtBRL(valor)} vencidos`,
      descricao:
        `${grupo.length} título(s) vencido(s) e em aberto, somando ${fmtBRL(valor)}, com atraso máximo de ${atrasoMaximo} dia(s). ` +
        `É caixa que a operação já entregou (motorista rodou, combustível foi pago) e ainda não voltou.`,
      recomendacao:
        atrasoMaximo > 60
          ? "Escalar para cobrança formal: notificação com prazo, protesto ou suspensão de novos serviços enquanto houver título vencido acima de 60 dias."
          : "Acionar a régua de cobrança (contato, reenvio de boleto e confirmação de agendamento) e conferir se houve falha no envio da nota ou do boleto.",
      valorCents: valor,
      impactoCents: valor,
      dataReferencia: ctx.dataReferencia,
      entidadeTipo: "OmieParceiro",
      entidadeRef: nomeParceiro(ctx, grupo[0]),
      evidencia: {
        cliente: nomeParceiro(ctx, grupo[0]),
        titulos: grupo.map((t) => ({
          lancamento: t.codigoLancamento,
          vencimento: t.dataVencimento.toISOString(),
          saldo: saldoAberto(t),
          atraso: diasDeAtraso(t, ctx.dataReferencia),
        })),
      },
      chave: chaveAchado("CR-INADIMPLENCIA", codigo),
    });
  }
  return achados;
}

// CR-PERDA-PROVAVEL — credito velho demais. Nao e so cobranca: e ajuste
// contabil (provisao) que a empresa precisa fazer para o balanco parar de
// mostrar um ativo que nao existe.
function perdaProvavel(
  ctx: ContextoAuditoria,
  titulos: ReturnType<typeof titulosAtivos>,
  materialidade: number
): AchadoNovo[] {
  const antigos = titulos.filter((t) => emAberto(t) && diasDeAtraso(t, ctx.dataReferencia) > DIAS_PERDA_PROVAVEL);
  if (antigos.length === 0) return [];

  const valor = somar(antigos, saldoAberto);
  return [
    {
      regra: "CR-PERDA-PROVAVEL",
      tipo: "ESTADO",
      severidade: agravar(severidadePorValor(valor, materialidade)),
      categoria: "RISCO_FINANCEIRO",
      titulo: `${fmtBRL(valor)} a receber vencidos há mais de ${DIAS_PERDA_PROVAVEL} dias`,
      descricao:
        `${antigos.length} título(s) vencidos há mais de seis meses seguem no ativo como se fossem recebíveis. ` +
        `Sem provisão, o resultado do período está superestimado nesse valor e a decisão baseada nele fica errada.`,
      recomendacao:
        "Classificar caso a caso: em cobrança judicial, negociação ativa ou perda. O que for perda deve ser provisionado " +
        "(e, atendidos os requisitos da Lei 9.430/96, deduzido) — decidir com a contabilidade antes do fechamento do trimestre.",
      valorCents: valor,
      dataReferencia: ctx.dataReferencia,
      evidencia: {
        titulos: antigos.slice(0, 50).map((t) => ({
          cliente: nomeParceiro(ctx, t),
          lancamento: t.codigoLancamento,
          saldo: saldoAberto(t),
          atraso: diasDeAtraso(t, ctx.dataReferencia),
        })),
        total: antigos.length,
      },
      chave: chaveAchado("CR-PERDA-PROVAVEL", "atual"),
    },
  ];
}

// CR-DESCONTO — desconto concedido no recebimento. Sozinho nao e problema
// (pode ser politica comercial); virar rotina sem politica escrita e.
const PERCENTUAL_DESCONTO_RELEVANTE = 2;

function descontosConcedidos(
  ctx: ContextoAuditoria,
  titulos: ReturnType<typeof titulosAtivos>,
  materialidade: number
): AchadoNovo[] {
  const comDesconto = titulos.filter((t) => t.descontoCents > 0);
  const porCliente = agrupar(comDesconto, (t) => chaveParceiro(t));

  const achados: AchadoNovo[] = [];
  for (const [codigo, grupo] of porCliente) {
    const desconto = somar(grupo, (t) => t.descontoCents);
    const bruto = somar(grupo, (t) => t.valorDocumentoCents);
    const percentual = bruto > 0 ? (desconto / bruto) * 100 : 0;
    if (desconto < materialidade / 2 && percentual < PERCENTUAL_DESCONTO_RELEVANTE) continue;

    achados.push({
      regra: "CR-DESCONTO",
      tipo: "ESTADO",
      severidade: severidadePorValor(desconto, materialidade),
      categoria: "PERDA_FINANCEIRA",
      titulo: `${fmtBRL(desconto)} em descontos concedidos a ${nomeParceiro(ctx, grupo[0])}`,
      descricao:
        `${grupo.length} recebimento(s) desse cliente tiveram desconto, somando ${fmtBRL(desconto)} — ` +
        `${fmtPercent(percentual)} do valor faturado a ele. Em serviço de fretamento, essa margem raramente é recuperável no volume.`,
      recomendacao:
        "Verificar se há política de desconto aprovada e quem autorizou cada um. Sem política, definir alçada e percentual máximo; " +
        "havendo política, checar se o desconto por antecipação está sendo dado para pagamentos que não foram antecipados.",
      valorCents: desconto,
      impactoCents: desconto,
      dataReferencia: ctx.dataReferencia,
      entidadeTipo: "OmieParceiro",
      entidadeRef: nomeParceiro(ctx, grupo[0]),
      evidencia: { cliente: nomeParceiro(ctx, grupo[0]), desconto, faturado: bruto, titulos: grupo.length },
      chave: chaveAchado("CR-DESCONTO", codigo, chaveMes(ctx.dataReferencia)),
    });
  }
  return achados;
}

// CR-RECEBIDO-MENOR — titulo marcado como liquidado, mas com recebimento
// abaixo do devido. E o "sumico silencioso": ninguem cobra a diferenca
// porque o titulo aparece como quitado.
const TOLERANCIA_CENTAVOS = 50;

function recebimentoAMenor(
  ctx: ContextoAuditoria,
  titulos: ReturnType<typeof titulosAtivos>,
  materialidade: number
): AchadoNovo[] {
  return titulos
    .filter((t) => t.liquidado && t.valorPagoCents > 0)
    .map((t) => {
      const devido = t.valorDocumentoCents - t.descontoCents;
      const falta = devido - t.valorPagoCents;
      return { t, falta, devido };
    })
    .filter(({ falta }) => falta > TOLERANCIA_CENTAVOS)
    .map(({ t, falta, devido }) => ({
      regra: "CR-RECEBIDO-MENOR",
      tipo: "EVENTO" as const,
      severidade: agravar(severidadePorValor(falta, materialidade)),
      categoria: "PERDA_FINANCEIRA" as const,
      titulo: `Recebimento a menor — ${nomeParceiro(ctx, t)}`,
      descricao:
        `${referenciaTitulo(t)} está liquidado, mas entraram ${fmtBRL(t.valorPagoCents)} de ${fmtBRL(devido)} devidos ` +
        `(descontos já considerados). Faltam ${fmtBRL(falta)} que ninguém vai cobrar, porque o título consta como quitado.`,
      recomendacao:
        "Conferir o comprovante do cliente. Sendo diferença real, reabrir a cobrança do saldo; sendo tarifa bancária, " +
        "lançar como despesa financeira em vez de reduzir a receita — a margem do contrato está sendo subestimada.",
      valorCents: falta,
      impactoCents: falta,
      dataReferencia: t.dataUltimaBaixa ?? t.dataVencimento,
      entidadeTipo: "OmieTitulo",
      entidadeId: t.id,
      entidadeRef: referenciaTitulo(t),
      evidencia: { devido, recebido: t.valorPagoCents, desconto: t.descontoCents },
      chave: chaveAchado("CR-RECEBIDO-MENOR", refTitulo(t)),
    }));
}

// CR-CONCENTRACAO — dependencia de poucos clientes. Nao e erro nenhum: e o
// risco estrutural mais comum em fretamento (perder um contrato grande
// inviabiliza a operacao inteira) e precisa estar visivel na mesa da
// diretoria, nao so na intuicao de quem vende.
function concentracaoDeReceita(
  ctx: ContextoAuditoria,
  titulos: ReturnType<typeof titulosAtivos>,
  materialidade: number
): AchadoNovo[] {
  const inicio = inicioDoMes(new Date(ctx.dataReferencia.getFullYear(), ctx.dataReferencia.getMonth() - 2, 1));
  const recentes = titulos.filter((t) => t.dataVencimento >= inicio);
  const total = somar(recentes, (t) => t.valorDocumentoCents);
  if (total <= 0) return [];

  const porCliente = agrupar(recentes, (t) => chaveParceiro(t));
  const achados: AchadoNovo[] = [];

  for (const [codigo, grupo] of porCliente) {
    const valor = somar(grupo, (t) => t.valorDocumentoCents);
    const participacao = (valor / total) * 100;
    if (participacao < ctx.config.limiteConcentracaoFornecedorPercent) continue;

    achados.push({
      regra: "CR-CONCENTRACAO",
      tipo: "ESTADO",
      severidade: participacao >= 50 ? "ALTA" : "MEDIA",
      categoria: "RISCO_FINANCEIRO",
      titulo: `${nomeParceiro(ctx, grupo[0])} representa ${fmtPercent(participacao)} da receita`,
      descricao:
        `Nos últimos 3 meses, esse cliente respondeu por ${fmtBRL(valor)} de ${fmtBRL(total)} faturados ` +
        `(${fmtPercent(participacao)}). A perda desse contrato deixaria a estrutura fixa descoberta nessa proporção.`,
      recomendacao:
        "Tratar como risco de continuidade: confirmar vigência e cláusula de rescisão do contrato, mapear o custo fixo " +
        "dedicado a ele (motoristas e veículos alocados) e definir um plano comercial de diluição antes da próxima renovação.",
      valorCents: valor,
      dataReferencia: ctx.dataReferencia,
      entidadeTipo: "OmieParceiro",
      entidadeRef: nomeParceiro(ctx, grupo[0]),
      evidencia: { cliente: nomeParceiro(ctx, grupo[0]), valor, total, participacao },
      chave: chaveAchado("CR-CONCENTRACAO", codigo, chaveMes(ctx.dataReferencia)),
    });
  }

  // Materialidade nao entra aqui: concentracao e risco estrutural, nao valor
  // isolado — mas o parametro segue sendo usado pelos demais achados do
  // agente, e mante-lo na assinatura evita uma excecao de estilo.
  void materialidade;
  return achados;
}

// CR-ATRASO-RECORRENTE — cliente que SEMPRE paga atrasado, mesmo quando paga.
// Nao aparece na inadimplencia (ele quita), mas destroi o ciclo de caixa: e a
// diferenca entre a empresa financiar o cliente ou nao.
const MINIMO_TITULOS_PARA_PADRAO = 3;
const DIAS_ATRASO_MEDIO_RELEVANTE = 7;

function atrasoRecorrente(
  ctx: ContextoAuditoria,
  titulos: ReturnType<typeof titulosAtivos>,
  materialidade: number
): AchadoNovo[] {
  const pagos = titulos.filter((t) => t.dataUltimaBaixa !== null && t.liquidado);
  const porCliente = agrupar(pagos, (t) => chaveParceiro(t));
  const achados: AchadoNovo[] = [];

  for (const [codigo, grupo] of porCliente) {
    if (grupo.length < MINIMO_TITULOS_PARA_PADRAO) continue;
    const atrasos = grupo.map((t) => diasEntre(t.dataVencimento, t.dataUltimaBaixa!));
    const atrasoMedio = Math.round(somar(atrasos, (a) => a) / atrasos.length);
    if (atrasoMedio < DIAS_ATRASO_MEDIO_RELEVANTE) continue;

    const volume = somar(grupo, (t) => t.valorPagoCents);
    // Custo de financiar o cliente pelo periodo medio de atraso, ao mesmo
    // custo de capital usado no agente de contas a pagar.
    const custo = Math.round(volume * 0.01 * (atrasoMedio / 30));

    achados.push({
      regra: "CR-ATRASO-RECORRENTE",
      tipo: "ESTADO",
      severidade: severidadePorValor(custo, materialidade),
      categoria: "OPORTUNIDADE",
      titulo: `${nomeParceiro(ctx, grupo[0])} paga em média ${atrasoMedio} dias após o vencimento`,
      descricao:
        `${grupo.length} títulos quitados desse cliente, somando ${fmtBRL(volume)}, foram pagos em média ${atrasoMedio} dia(s) ` +
        `depois do vencimento. Ele não é inadimplente — mas a empresa está financiando o capital de giro dele, ` +
        `a um custo estimado de ${fmtBRL(custo)}.`,
      recomendacao:
        "Ajustar o vencimento contratual ao comportamento real de pagamento dele (ex.: mudar para o dia fixo em que ele efetivamente paga) " +
        "ou cobrar juros de mora previstos em contrato. As duas opções resolvem; deixar como está é a única que custa caro.",
      valorCents: volume,
      impactoCents: custo,
      dataReferencia: ctx.dataReferencia,
      entidadeTipo: "OmieParceiro",
      entidadeRef: nomeParceiro(ctx, grupo[0]),
      evidencia: { cliente: nomeParceiro(ctx, grupo[0]), titulos: grupo.length, atrasoMedio, volume },
      chave: chaveAchado("CR-ATRASO-RECORRENTE", codigo, chaveMes(ctx.dataReferencia)),
    });
  }
  return achados;
}

// Aging exposto para o relatorio e o painel usarem a MESMA definicao das
// regras acima — faixa de aging divergente entre a tela e o alerta e uma
// forma barata de perder a confianca do usuario no modulo inteiro.
export function calcularAging(ctx: ContextoAuditoria, natureza: "PAGAR" | "RECEBER") {
  const abertos = titulosAtivos(ctx, natureza).filter(emAberto);
  return FAIXAS_AGING.map((faixa) => {
    const doGrupo = abertos.filter((t) => {
      const atraso = diasDeAtraso(t, ctx.dataReferencia);
      return atraso >= faixa.min && atraso <= faixa.max;
    });
    return {
      rotulo: faixa.rotulo,
      quantidade: doGrupo.length,
      valorCents: somar(doGrupo, saldoAberto),
    };
  });
}

export function resumoAging(ctx: ContextoAuditoria, natureza: "PAGAR" | "RECEBER") {
  const faixas = calcularAging(ctx, natureza);
  const total = somar(faixas, (f) => f.valorCents);
  const vencido = somar(
    faixas.filter((f) => f.rotulo !== "A vencer"),
    (f) => f.valorCents
  );
  return { faixas, totalCents: total, vencidoCents: vencido, fmt: { total: fmtBRL(total), vencido: fmtBRL(vencido) } };
}
