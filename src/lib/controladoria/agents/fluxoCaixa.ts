import { fmtBRL, fmtData, fmtNumero, fmtPercent } from "../format";
import { diasEntre, somarDias } from "../periodos";
import type { AchadoNovo, Agente, ContextoAuditoria } from "../types";
import { chaveAchado, emAberto, materialidadeCents, saldoAberto, somar, titulosAtivos } from "./comum";
import { saldoAtualCents } from "./conciliacao";

// AGENTE DE FLUXO DE CAIXA (TESOURARIA)
// O unico agente que olha para FRENTE. Todos os outros auditam o que ja
// aconteceu; este projeta o saldo a partir dos titulos em aberto e avisa
// ANTES de faltar dinheiro — que e a diferenca entre negociar com
// antecedencia e pagar juros de conta garantida.

const HORIZONTES_DIAS = [7, 15, 30, 60, 90];

export type PontoProjecao = {
  dias: number;
  data: Date;
  entradasCents: number;
  saidasCents: number;
  saldoProjetadoCents: number;
};

// Projecao simples e explicita: saldo atual + recebiveis em aberto com
// vencimento ate a data − contas a pagar em aberto com vencimento ate a data.
//
// Premissa declarada (e o motivo de a projecao ser conservadora de proposito):
// titulo vencido e ainda em aberto conta como saida imediata, mas recebivel
// vencido NAO conta como entrada — quem ja nao pagou tende a nao pagar no
// prazo, e uma projecao otimista de caixa e pior que projecao nenhuma.
export function projetarFluxoCaixa(ctx: ContextoAuditoria): PontoProjecao[] {
  const saldo = saldoAtualCents(ctx);
  const pagar = titulosAtivos(ctx, "PAGAR").filter(emAberto);
  const receber = titulosAtivos(ctx, "RECEBER").filter(emAberto);

  return HORIZONTES_DIAS.map((dias) => {
    const limite = somarDias(ctx.dataReferencia, dias);
    const saidas = somar(
      pagar.filter((t) => t.dataVencimento <= limite),
      saldoAberto
    );
    const entradas = somar(
      receber.filter((t) => t.dataVencimento <= limite && t.dataVencimento >= ctx.dataReferencia),
      saldoAberto
    );
    return {
      dias,
      data: limite,
      entradasCents: entradas,
      saidasCents: saidas,
      saldoProjetadoCents: saldo + entradas - saidas,
    };
  });
}

// Indicadores de ciclo financeiro. PMR/PMP em dias, calculados sobre os
// titulos efetivamente liquidados — nao sobre o prazo contratado, que e o que
// a empresa gostaria que acontecesse, e nao o que acontece.
export type IndicadoresCiclo = {
  pmrDias: number | null;
  pmpDias: number | null;
  cicloFinanceiroDias: number | null;
};

export function calcularCiclo(ctx: ContextoAuditoria): IndicadoresCiclo {
  const media = (natureza: "PAGAR" | "RECEBER"): number | null => {
    const liquidados = titulosAtivos(ctx, natureza).filter(
      (t) => t.liquidado && t.dataUltimaBaixa !== null && t.dataEmissao !== null
    );
    if (liquidados.length === 0) return null;
    // Ponderado por valor: um titulo de R$ 200 mil pago em 60 dias pesa muito
    // mais no caixa do que dez de R$ 500 pagos a vista. Media simples aqui
    // esconderia exatamente o que importa.
    const valorTotal = somar(liquidados, (t) => t.valorPagoCents);
    if (valorTotal <= 0) return null;
    const soma = somar(liquidados, (t) => diasEntre(t.dataEmissao!, t.dataUltimaBaixa!) * t.valorPagoCents);
    return Math.round(soma / valorTotal);
  };

  const pmr = media("RECEBER");
  const pmp = media("PAGAR");
  return {
    pmrDias: pmr,
    pmpDias: pmp,
    // Sem estoque relevante em servico de fretamento, o ciclo financeiro e
    // simplesmente PMR − PMP: quantos dias a empresa banca a operacao com
    // dinheiro proprio.
    cicloFinanceiroDias: pmr !== null && pmp !== null ? pmr - pmp : null,
  };
}

export const agenteFluxoCaixa: Agente = {
  id: "fluxo-caixa",
  nome: "Fluxo de caixa e tesouraria",
  area: "Tesouraria",
  descricao:
    "Projeta o saldo de caixa em 7, 15, 30, 60 e 90 dias a partir dos títulos em aberto, aponta descasamento entre pagamentos e recebimentos da semana e acompanha o ciclo financeiro (PMR, PMP).",
  executar: auditarFluxoCaixa,
};

function auditarFluxoCaixa(ctx: ContextoAuditoria): AchadoNovo[] {
  const achados: AchadoNovo[] = [];
  const materialidade = materialidadeCents(ctx);
  const projecao = projetarFluxoCaixa(ctx);

  // FC-SALDO-NEGATIVO — o primeiro horizonte em que o caixa fica negativo.
  // Um achado so (o primeiro ponto de ruptura), nao um por horizonte: se
  // falta dinheiro em 30 dias, dizer que tambem falta em 60 e 90 nao
  // acrescenta decisao nenhuma.
  const ruptura = projecao.find((p) => p.saldoProjetadoCents < 0);
  if (ruptura) {
    achados.push({
      regra: "FC-SALDO-NEGATIVO",
      tipo: "ESTADO",
      severidade: ruptura.dias <= 15 ? "CRITICA" : ruptura.dias <= 30 ? "ALTA" : "MEDIA",
      categoria: "RISCO_FINANCEIRO",
      titulo: `Caixa projetado fica negativo em ${ruptura.dias} dias`,
      descricao:
        `Considerando o saldo atual de ${fmtBRL(saldoAtualCents(ctx))}, os recebíveis a vencer até ${fmtData(
          ruptura.data
        )} (${fmtBRL(ruptura.entradasCents)}) e os pagamentos no mesmo período (${fmtBRL(ruptura.saidasCents)}), ` +
        `o saldo chega a ${fmtBRL(ruptura.saldoProjetadoCents)}. A projeção é conservadora: recebível já vencido não é contado como entrada.`,
      recomendacao:
        "Agir nesta ordem, do mais barato para o mais caro: (1) cobrar os recebíveis vencidos de maior valor; " +
        "(2) renegociar vencimento com os fornecedores de maior volume — o histórico de pagamento da empresa é o argumento; " +
        "(3) só então avaliar antecipação de recebíveis ou capital de giro, comparando o custo efetivo dos dois.",
      valorCents: Math.abs(ruptura.saldoProjetadoCents),
      dataReferencia: ruptura.data,
      evidencia: {
        projecao: projecao.map((p) => ({
          dias: p.dias,
          entradas: p.entradasCents,
          saidas: p.saidasCents,
          saldo: p.saldoProjetadoCents,
        })),
        saldoAtual: saldoAtualCents(ctx),
      },
      chave: chaveAchado("FC-SALDO-NEGATIVO", ctx.dataReferencia.toISOString().slice(0, 10)),
    });
  }

  // FC-DESCASAMENTO — na proxima semana sai muito mais do que entra.
  const semana = projecao.find((p) => p.dias === 7);
  if (semana && semana.saidasCents > 0) {
    const cobertura = semana.entradasCents / semana.saidasCents;
    if (cobertura < 0.7 && semana.saidasCents >= materialidade * 3) {
      achados.push({
        regra: "FC-DESCASAMENTO",
        tipo: "ESTADO",
        severidade: cobertura < 0.4 ? "ALTA" : "MEDIA",
        categoria: "RISCO_FINANCEIRO",
        titulo: `Próximos 7 dias: ${fmtBRL(semana.saidasCents)} a pagar contra ${fmtBRL(semana.entradasCents)} a receber`,
        descricao:
          `Os recebimentos previstos cobrem apenas ${fmtPercent(cobertura * 100)} dos pagamentos da semana. ` +
          `A diferença de ${fmtBRL(semana.saidasCents - semana.entradasCents)} sai do saldo em conta.`,
        recomendacao:
          "Distribuir os pagamentos da semana pelos dias de maior entrada e antecipar a cobrança dos boletos que vencem no período. " +
          "Descasamento recorrente na mesma semana do mês indica que o calendário de vencimentos precisa ser redesenhado, não remendado.",
        valorCents: semana.saidasCents - semana.entradasCents,
        dataReferencia: semana.data,
        evidencia: { entradas: semana.entradasCents, saidas: semana.saidasCents, cobertura },
        chave: chaveAchado("FC-DESCASAMENTO", ctx.dataReferencia.toISOString().slice(0, 10)),
      });
    }
  }

  // FC-CICLO — a empresa esta financiando o cliente.
  const ciclo = calcularCiclo(ctx);
  if (ciclo.cicloFinanceiroDias !== null && ciclo.cicloFinanceiroDias > 15) {
    const receberEmAberto = somar(titulosAtivos(ctx, "RECEBER").filter(emAberto), saldoAberto);
    const custoDoCiclo = Math.round(receberEmAberto * 0.01 * (ciclo.cicloFinanceiroDias / 30));

    achados.push({
      regra: "FC-CICLO",
      tipo: "ESTADO",
      severidade: ciclo.cicloFinanceiroDias > 45 ? "ALTA" : "MEDIA",
      categoria: "OPORTUNIDADE",
      titulo: `Ciclo financeiro de ${fmtNumero(ciclo.cicloFinanceiroDias)} dias`,
      descricao:
        `A empresa recebe em média ${fmtNumero(ciclo.pmrDias)} dias após emitir e paga em ${fmtNumero(ciclo.pmpDias)} dias — ` +
        `são ${fmtNumero(ciclo.cicloFinanceiroDias)} dias bancando a operação com capital próprio. ` +
        `Sobre ${fmtBRL(receberEmAberto)} em aberto, isso custa cerca de ${fmtBRL(custoDoCiclo)}.`,
      recomendacao:
        "Cada dia de redução do PMR ou de aumento do PMP libera caixa sem custo nenhum. " +
        "Na prática: negociar prazo com os 3 maiores fornecedores e antecipar o faturamento (emitir no primeiro dia útil, não no fechamento) " +
        "costuma valer mais do que qualquer linha de crédito.",
      valorCents: receberEmAberto,
      impactoCents: custoDoCiclo,
      dataReferencia: ctx.dataReferencia,
      evidencia: { pmr: ciclo.pmrDias, pmp: ciclo.pmpDias, ciclo: ciclo.cicloFinanceiroDias, receberEmAberto },
      chave: chaveAchado("FC-CICLO", `${ctx.dataReferencia.getFullYear()}-${ctx.dataReferencia.getMonth() + 1}`),
    });
  }

  return achados;
}
