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
//
// E uma regra que olha o contrario de todas as outras: a OS que teve custo e
// NUNCA foi faturada. Nao aparece em atraso, em aging nem em inadimplencia,
// porque para esses relatorios ela simplesmente nao existe.

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
  // Esta última não olha os títulos a RECEBER — olha os que não existem. Por
  // isso recebe o contexto inteiro e não a lista filtrada acima.
  achados.push(...osComCustoSemFaturamento(ctx, materialidade));

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

// CR-OS-NAO-FATURADA — a ordem de serviço que custou e nunca virou receita.
//
// Na Omie deste grupo, cada OS é um código de PROJETO (14516, 14517, ...), e é
// nele que o custo da viagem é lançado: motorista, combustível, pedágio,
// terceiro. Quando o mesmo projeto não tem nenhum título a RECEBER, a conta é
// direta — a viagem rodou, foi paga, e ninguém cobrou o cliente.
//
// É o furo que nenhuma outra regra deste sistema pega. Contas a receber olha o
// que foi cobrado e não entrou; esta olha o que nunca chegou a ser cobrado, e
// portanto não aparece em atraso, em aging, nem em inadimplência. Some sem
// deixar rastro em relatório nenhum.
//
// A CARÊNCIA É O QUE SEPARA ACHADO DE ANSIEDADE. Faturar depois da viagem é o
// normal do negócio: o custo entra no dia, a fatura sai no fechamento. Sem
// carência, toda OS da semana viraria alerta e a regra seria desligada no
// primeiro mês. Trinta dias depois do ÚLTIMO custo lançado, a explicação
// "ainda não faturamos" deixa de ser suficiente.
const DIAS_DE_CARENCIA_PARA_FATURAR = 30;

export function osComCustoSemFaturamento(
  ctx: ContextoAuditoria,
  materialidade: number
): AchadoNovo[] {
  const achados: AchadoNovo[] = [];

  // Projeto vazio não é OS — é título sem classificação, e disso já trata
  // CP-SEM-CENTRO-CUSTO. Agrupar os sem-projeto todos juntos criaria um
  // "projeto fantasma" com o custo de meia empresa dentro.
  const comProjeto = ctx.titulos.filter((t) => !t.cancelado && t.projetoCodigo);
  const porProjeto = agrupar(comProjeto, (t) => t.projetoCodigo!);

  const nomeProjeto = new Map(ctx.projetos.map((p) => [p.codigo, p.nome]));

  for (const [projeto, titulos] of porProjeto) {
    const custos = titulos.filter((t) => t.natureza === "PAGAR");
    const receitas = titulos.filter((t) => t.natureza === "RECEBER");
    if (custos.length === 0 || receitas.length > 0) continue;

    const custoCents = somar(custos, (t) => t.valorDocumentoCents);
    if (custoCents < materialidade) continue;

    // A data do último custo é o marco da carência: enquanto ainda entram
    // lançamentos, a OS não terminou, e cobrar por ela seria prematuro.
    const ultimoCusto = custos.reduce(
      (maior, t) => {
        const d = t.dataEmissao ?? t.dataVencimento;
        return d > maior ? d : maior;
      },
      new Date(0)
    );
    const diasParado = diasEntre(ultimoCusto, ctx.dataReferencia);
    if (diasParado < DIAS_DE_CARENCIA_PARA_FATURAR) continue;

    const rotulo = nomeProjeto.get(projeto) ?? projeto;
    achados.push({
      regra: "CR-OS-NAO-FATURADA",
      tipo: "ESTADO",
      // Sem receita, o custo inteiro é a perda — não há margem a calcular.
      severidade: severidadePorValor(custoCents, materialidade),
      categoria: "PERDA_FINANCEIRA",
      titulo: `OS ${rotulo}: ${fmtBRL(custoCents)} de custo e nenhuma cobrança`,
      descricao:
        `O projeto ${projeto}${rotulo !== projeto ? ` (${rotulo})` : ""} acumula ${fmtBRL(custoCents)} em ` +
        `${custos.length} título(s) a pagar e nenhum título a receber. O último custo foi lançado há ` +
        `${diasParado} dias. Custo pago, serviço prestado, receita nunca faturada.`,
      recomendacao:
        "Conferir na Omie se a OS foi concluída e se há CT-e ou nota de serviço emitida para ela. " +
        "Havendo entrega sem cobrança, faturar — e, se o prazo contratual já passou, verificar com o cliente antes. " +
        "Se a OS foi cancelada, o custo lançado nela precisa ser reclassificado, ou continuará aparecendo aqui.",
      valorCents: custoCents,
      impactoCents: custoCents,
      dataReferencia: ctx.dataReferencia,
      entidadeTipo: "OmieProjeto",
      entidadeId: projeto,
      entidadeRef: rotulo,
      evidencia: {
        projeto,
        nome: rotulo,
        custoCents,
        titulosDeCusto: custos.length,
        ultimoCusto: ultimoCusto.toISOString(),
        diasSemFaturar: diasParado,
        maioresCustos: custos
          .sort((a, b) => b.valorDocumentoCents - a.valorDocumentoCents)
          .slice(0, 5)
          .map((t) => ({ parceiro: t.parceiroNome, valor: t.valorDocumentoCents, doc: t.numeroDocumento })),
      },
      chave: chaveAchado("CR-OS-NAO-FATURADA", projeto),
    });
  }

  return achados;
}
