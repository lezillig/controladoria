import type { BscPerspectiva, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { estaEmAberto, estaVencido } from "@/lib/conformidade/panorama";
import { dentro, inicioDoMes, montarJanelas } from "./periodos";
import { emAberto, saldoAberto, somar, titulosAtivos } from "./agents/comum";
import { calcularCiclo } from "./agents/fluxoCaixa";
import { saldoAtualCents } from "./agents/conciliacao";
import { custoTotalPeriodo, rentabilidadePorContrato } from "./unitEconomics";
import type { ContextoAuditoria } from "./types";
// Competência pela data de EMISSÃO — ver competencia.ts. Só o resultado DO MÊS
// muda de critério; atraso, "vence em 30 dias" e pontualidade de pagamento
// continuam pelo vencimento, que é a pergunta que eles fazem.
import { dataDeCompetencia } from "./competencia";

// BALANCED SCORECARD
//
// O catalogo de indicadores vive aqui, em codigo, e nao no banco: a formula de
// um indicador e regra de negocio versionada e revisavel em diff. O banco
// guarda apenas a META (decisao da empresa, muda sem deploy) e o SNAPSHOT
// diario (historico, que da tendencia e permite auditar depois "o indicador
// estava mesmo verde naquele dia?").
//
// As quatro perspectivas seguem Kaplan e Norton, mas os indicadores foram
// escolhidos por um criterio pratico: so entra o que este sistema consegue
// MEDIR SOZINHO, todo dia, sem digitacao manual. Indicador de BSC que depende
// de alguem preencher uma planilha para de ser preenchido no segundo mes — e
// um scorecard com metade dos farois cinza nao e usado por ninguem.
//
// A cadeia de causa e efeito e a de uma operacao de fretamento:
//   Aprendizado/Processos (conciliar, classificar, tratar achado, controlar
//   hora extra) -> Cliente (contratos rentaveis, receita saudavel) ->
//   Financeira (margem, caixa, ciclo).

export type DirecaoIndicador = "MAIOR_MELHOR" | "MENOR_MELHOR";
export type UnidadeIndicador = "PERCENTUAL" | "DIAS" | "REAIS" | "QUANTIDADE";

export type IndicadorBsc = {
  codigo: string;
  nome: string;
  perspectiva: BscPerspectiva;
  unidade: UnidadeIndicador;
  direcao: DirecaoIndicador;
  descricao: string;
  // Meta sugerida quando a empresa ainda nao definiu a sua. Aparece na tela
  // como "sugerida", nunca como decidida.
  metaSugerida: number | null;
  calcular: (ctx: ContextoAuditoria) => { valor: number | null; detalhes?: Record<string, unknown> };
};

const pct = (parte: number, total: number): number | null => (total > 0 ? (parte / total) * 100 : null);

export const INDICADORES_BSC: IndicadorBsc[] = [
  // ---------------- Perspectiva FINANCEIRA ----------------
  {
    codigo: "FIN-MARGEM",
    nome: "Margem do mês",
    perspectiva: "FINANCEIRA",
    unidade: "PERCENTUAL",
    direcao: "MAIOR_MELHOR",
    descricao: "Resultado (receita − despesa, por competência) sobre a receita do mês corrente.",
    metaSugerida: 15,
    calcular: (ctx) => {
      const janelas = montarJanelas(ctx.dataReferencia);
      const receita = somar(
        titulosAtivos(ctx, "RECEBER").filter((t) => dentro(dataDeCompetencia(t), janelas.mesAtual)),
        (t) => t.valorDocumentoCents
      );
      const despesa = somar(
        titulosAtivos(ctx, "PAGAR").filter((t) => dentro(dataDeCompetencia(t), janelas.mesAtual)),
        (t) => t.valorDocumentoCents
      );
      return { valor: pct(receita - despesa, receita), detalhes: { receita, despesa } };
    },
  },
  {
    codigo: "FIN-CICLO",
    nome: "Ciclo financeiro",
    perspectiva: "FINANCEIRA",
    unidade: "DIAS",
    direcao: "MENOR_MELHOR",
    descricao: "PMR − PMP: dias em que a empresa banca a operação com capital próprio.",
    metaSugerida: 10,
    calcular: (ctx) => {
      const ciclo = calcularCiclo(ctx);
      return { valor: ciclo.cicloFinanceiroDias, detalhes: { pmr: ciclo.pmrDias, pmp: ciclo.pmpDias } };
    },
  },
  {
    codigo: "FIN-PERDA-ENCARGOS",
    nome: "Perda com juros, multas e tarifas (mês)",
    perspectiva: "FINANCEIRA",
    unidade: "REAIS",
    direcao: "MENOR_MELHOR",
    descricao: "Encargos pagos por atraso e tarifas bancárias no mês — dinheiro que não comprou nada.",
    metaSugerida: 0,
    calcular: (ctx) => {
      const inicio = inicioDoMes(ctx.dataReferencia);
      const baixas = ctx.baixas.filter((b) => b.dataBaixa >= inicio && b.dataBaixa <= ctx.dataReferencia);
      return { valor: somar(baixas, (b) => b.jurosCents + b.multaCents + b.tarifaCents) / 100 };
    },
  },
  {
    codigo: "FIN-COBERTURA-CAIXA",
    nome: "Cobertura de caixa",
    perspectiva: "FINANCEIRA",
    unidade: "PERCENTUAL",
    direcao: "MAIOR_MELHOR",
    descricao: "Saldo atual sobre os pagamentos a vencer nos próximos 30 dias.",
    metaSugerida: 100,
    calcular: (ctx) => {
      const limite = new Date(ctx.dataReferencia);
      limite.setDate(limite.getDate() + 30);
      const aPagar = somar(
        titulosAtivos(ctx, "PAGAR").filter(emAberto).filter((t) => t.dataVencimento <= limite),
        saldoAberto
      );
      return { valor: pct(saldoAtualCents(ctx), aPagar), detalhes: { saldo: saldoAtualCents(ctx), aPagar } };
    },
  },

  // ---------------- Perspectiva CLIENTE ----------------
  {
    codigo: "CLI-INADIMPLENCIA",
    nome: "Inadimplência",
    perspectiva: "CLIENTE",
    unidade: "PERCENTUAL",
    direcao: "MENOR_MELHOR",
    descricao: "Recebíveis vencidos sobre o total de recebíveis em aberto.",
    metaSugerida: 5,
    calcular: (ctx) => {
      const abertos = titulosAtivos(ctx, "RECEBER").filter(emAberto);
      const total = somar(abertos, saldoAberto);
      const vencido = somar(
        abertos.filter((t) => t.dataVencimento < ctx.dataReferencia),
        saldoAberto
      );
      return { valor: pct(vencido, total), detalhes: { vencido, total } };
    },
  },
  {
    codigo: "CLI-CONCENTRACAO",
    nome: "Concentração no maior cliente",
    perspectiva: "CLIENTE",
    unidade: "PERCENTUAL",
    direcao: "MENOR_MELHOR",
    descricao: "Participação do maior cliente na receita do mês — risco de dependência.",
    metaSugerida: 30,
    calcular: (ctx) => {
      const janelas = montarJanelas(ctx.dataReferencia);
      const titulos = titulosAtivos(ctx, "RECEBER").filter((t) => dentro(dataDeCompetencia(t), janelas.mesAtual));
      const total = somar(titulos, (t) => t.valorDocumentoCents);
      if (total <= 0) return { valor: null };
      const porCliente = new Map<string, number>();
      for (const t of titulos) {
        const k = t.parceiroCodigo ?? t.parceiroNome ?? "?";
        porCliente.set(k, (porCliente.get(k) ?? 0) + t.valorDocumentoCents);
      }
      const maior = Math.max(...porCliente.values());
      return { valor: pct(maior, total), detalhes: { maior, total, clientes: porCliente.size } };
    },
  },
  {
    codigo: "CLI-CONTRATOS-RENTAVEIS",
    nome: "Contratos com margem positiva",
    perspectiva: "CLIENTE",
    unidade: "PERCENTUAL",
    direcao: "MAIOR_MELHOR",
    descricao: "Percentual dos contratos com receita alocada que fecham o mês com margem positiva.",
    metaSugerida: 90,
    calcular: (ctx) => {
      const janelas = montarJanelas(ctx.dataReferencia);
      const nomes = new Map(ctx.clientes.map((c) => [c.id, c.nome]));
      const resultado = rentabilidadePorContrato(ctx, janelas.mesAtual, nomes);
      const comReceita = resultado.linhas.filter((l) => l.receitaCents > 0);
      if (comReceita.length === 0) return { valor: null };
      const positivos = comReceita.filter((l) => l.margemCents > 0).length;
      return {
        valor: pct(positivos, comReceita.length),
        detalhes: { positivos, total: comReceita.length, cobertura: resultado.coberturaPercent },
      };
    },
  },

  // ---------------- Perspectiva PROCESSOS INTERNOS ----------------
  {
    codigo: "PRO-CONCILIACAO",
    nome: "Conciliação bancária em dia",
    perspectiva: "PROCESSOS_INTERNOS",
    unidade: "PERCENTUAL",
    direcao: "MAIOR_MELHOR",
    descricao: "Movimentos bancários conciliados no mês — o controle que fecha o circuito do dinheiro.",
    metaSugerida: 98,
    calcular: (ctx) => {
      const inicio = inicioDoMes(ctx.dataReferencia);
      const movimentos = ctx.movimentos.filter((m) => m.data >= inicio && m.data <= ctx.dataReferencia);
      if (movimentos.length === 0) return { valor: null };
      return {
        valor: pct(movimentos.filter((m) => m.conciliado).length, movimentos.length),
        detalhes: { conciliados: movimentos.filter((m) => m.conciliado).length, total: movimentos.length },
      };
    },
  },
  {
    codigo: "PRO-CLASSIFICACAO",
    nome: "Lançamentos classificados",
    perspectiva: "PROCESSOS_INTERNOS",
    unidade: "PERCENTUAL",
    direcao: "MAIOR_MELHOR",
    descricao: "Títulos do mês com categoria financeira preenchida — base de todo o DRE gerencial.",
    metaSugerida: 100,
    calcular: (ctx) => {
      const janelas = montarJanelas(ctx.dataReferencia);
      const titulos = ctx.titulos.filter((t) => !t.cancelado && dentro(dataDeCompetencia(t), janelas.mesAtual));
      if (titulos.length === 0) return { valor: null };
      return { valor: pct(titulos.filter((t) => t.categoriaCodigo).length, titulos.length) };
    },
  },
  {
    codigo: "PRO-COBERTURA-RATEIO",
    nome: "Custo alocado a centro de custo",
    perspectiva: "PROCESSOS_INTERNOS",
    unidade: "PERCENTUAL",
    direcao: "MAIOR_MELHOR",
    descricao: "Percentual do custo do mês atribuído a um contrato, veículo ou funcionário.",
    metaSugerida: 85,
    calcular: (ctx) => {
      const janelas = montarJanelas(ctx.dataReferencia);
      const nomes = new Map(ctx.clientes.map((c) => [c.id, c.nome]));
      const resultado = rentabilidadePorContrato(ctx, janelas.mesAtual, nomes);
      const total = custoTotalPeriodo(ctx, janelas.mesAtual);
      if (total <= 0) return { valor: null };
      return { valor: resultado.coberturaPercent, detalhes: { total, naoAlocado: resultado.naoAlocadoCents } };
    },
  },
  {
    codigo: "PRO-PAGAMENTO-EM-DIA",
    nome: "Pagamentos em dia",
    perspectiva: "PROCESSOS_INTERNOS",
    unidade: "PERCENTUAL",
    direcao: "MAIOR_MELHOR",
    descricao: "Títulos pagos até a data de vencimento, sobre o total pago no mês.",
    metaSugerida: 98,
    calcular: (ctx) => {
      const inicio = inicioDoMes(ctx.dataReferencia);
      const pagos = titulosAtivos(ctx, "PAGAR").filter(
        (t) => t.dataUltimaBaixa !== null && t.dataUltimaBaixa >= inicio && t.dataUltimaBaixa <= ctx.dataReferencia
      );
      if (pagos.length === 0) return { valor: null };
      const emDia = pagos.filter((t) => t.dataUltimaBaixa! <= t.dataVencimento).length;
      return { valor: pct(emDia, pagos.length), detalhes: { emDia, total: pagos.length } };
    },
  },

  // Os dois indicadores de conformidade ficam em PROCESSOS INTERNOS, e nao na
  // perspectiva financeira, por uma razao de causa e efeito: risco apontado por
  // uma revisao externa vira custo (multa, autuacao, contingencia) meses depois
  // — o que se controla hoje e a DISCIPLINA de tratar o apontamento, nao o
  // valor, que quando aparece no resultado ja e tarde.
  {
    codigo: "PRO-CONFORMIDADE-PRAZO",
    nome: "Apontamentos de conformidade no prazo",
    perspectiva: "PROCESSOS_INTERNOS",
    unidade: "PERCENTUAL",
    direcao: "MAIOR_MELHOR",
    descricao: "Apontamentos externos em aberto com prazo definido que ainda estão dentro dele.",
    metaSugerida: 100,
    calcular: (ctx) => {
      const abertos = ctx.conformidade.apontamentos.filter(estaEmAberto);
      const comPrazo = abertos.filter((a) => a.prazo !== null);
      // Sem prazo cadastrado nao ha o que medir. Devolver 100% aqui seria pior
      // que devolver "sem dado": pintaria de verde justamente a empresa que
      // ainda nao combinou prazo nenhum.
      if (comPrazo.length === 0) return { valor: null };
      const noPrazo = comPrazo.filter((a) => !estaVencido(a, ctx.dataReferencia)).length;
      return { valor: pct(noPrazo, comPrazo.length), detalhes: { noPrazo, comPrazo: comPrazo.length, semPrazo: abertos.length - comPrazo.length } };
    },
  },
  {
    codigo: "PRO-CONFORMIDADE-GRAVES",
    nome: "Riscos externos graves em aberto",
    perspectiva: "PROCESSOS_INTERNOS",
    unidade: "QUANTIDADE",
    direcao: "MENOR_MELHOR",
    descricao: "Apontamentos críticos ou altos de consultoria, contabilidade ou auditoria ainda sem tratativa concluída.",
    metaSugerida: 0,
    calcular: (ctx) => {
      if (ctx.conformidade.apontamentos.length === 0) return { valor: null };
      const graves = ctx.conformidade.apontamentos.filter(
        (a) => estaEmAberto(a) && (a.severidade === "CRITICA" || a.severidade === "ALTA")
      );
      return {
        valor: graves.length,
        detalhes: { reincidentes: graves.filter((a) => a.ocorrencias >= 3).length },
      };
    },
  },

  // ---------------- Perspectiva APRENDIZADO E CRESCIMENTO ----------------
  // Aqui o BSC encontra os modulos que ja existiam neste sistema (frota,
  // ponto, motoristas): sao os indicadores que explicam POR QUE o custo do
  // proximo mes vai subir ou cair, antes de ele subir ou cair.
  {
    codigo: "APR-RECEITA-POR-MOTORISTA",
    nome: "Receita por motorista ativo",
    perspectiva: "APRENDIZADO_CRESCIMENTO",
    unidade: "REAIS",
    direcao: "MAIOR_MELHOR",
    descricao: "Receita do mês dividida pelo número de motoristas ativos — produtividade da estrutura.",
    metaSugerida: null,
    calcular: (ctx) => {
      const janelas = montarJanelas(ctx.dataReferencia);
      const receita = somar(
        titulosAtivos(ctx, "RECEBER").filter((t) => dentro(dataDeCompetencia(t), janelas.mesAtual)),
        (t) => t.valorDocumentoCents
      );
      const ativos = ctx.motoristas.filter((m) => m.active).length;
      if (ativos === 0) return { valor: null };
      return { valor: receita / 100 / ativos, detalhes: { receita, motoristasAtivos: ativos } };
    },
  },
  {
    codigo: "APR-CUSTO-POR-VEICULO",
    nome: "Custo médio por veículo (mês)",
    perspectiva: "APRENDIZADO_CRESCIMENTO",
    unidade: "REAIS",
    direcao: "MENOR_MELHOR",
    descricao: "Custo alocado do mês dividido pela frota ativa — base para decidir renovação de frota.",
    metaSugerida: null,
    calcular: (ctx) => {
      const janelas = montarJanelas(ctx.dataReferencia);
      const custo = custoTotalPeriodo(ctx, janelas.mesAtual);
      const frota = ctx.veiculos.filter((v) => v.status === "ATIVO").length;
      if (frota === 0) return { valor: null };
      return { valor: custo / 100 / frota, detalhes: { custo, frota } };
    },
  },
  {
    codigo: "APR-COMBUSTIVEL-RECEITA",
    nome: "Combustível sobre receita",
    perspectiva: "APRENDIZADO_CRESCIMENTO",
    unidade: "PERCENTUAL",
    direcao: "MENOR_MELHOR",
    descricao: "Gasto com combustível do cartão de frota sobre a receita do mês.",
    metaSugerida: 20,
    calcular: (ctx) => {
      const janelas = montarJanelas(ctx.dataReferencia);
      const combustivel = somar(
        ctx.abastecimentos.filter((a) => dentro(a.dataHora, janelas.mesAtual)),
        (a) => a.valorCents
      );
      const receita = somar(
        titulosAtivos(ctx, "RECEBER").filter((t) => dentro(dataDeCompetencia(t), janelas.mesAtual)),
        (t) => t.valorDocumentoCents
      );
      return { valor: pct(combustivel, receita), detalhes: { combustivel, receita } };
    },
  },
];

export type Farol = "VERDE" | "AMARELO" | "VERMELHO" | "SEM_META" | "SEM_DADO";

export type IndicadorMedido = {
  indicador: IndicadorBsc;
  valor: number | null;
  meta: number | null;
  metaEhSugerida: boolean;
  farol: Farol;
  detalhes: Record<string, unknown> | null;
  // Valor da medicao anterior guardada, para a seta de tendencia.
  valorAnterior: number | null;
};

export function calcularFarol(
  valor: number | null,
  meta: number | null,
  direcao: DirecaoIndicador,
  toleranciaPercent: number
): Farol {
  if (valor === null) return "SEM_DADO";
  if (meta === null) return "SEM_META";

  const folga = Math.abs(meta) * (toleranciaPercent / 100);
  if (direcao === "MAIOR_MELHOR") {
    if (valor >= meta) return "VERDE";
    return valor >= meta - folga ? "AMARELO" : "VERMELHO";
  }
  if (valor <= meta) return "VERDE";
  return valor <= meta + folga ? "AMARELO" : "VERMELHO";
}

export async function medirBsc(ctx: ContextoAuditoria): Promise<IndicadorMedido[]> {
  const metas = await prisma.bscMeta.findMany({ where: { companyId: ctx.companyId, ativo: true } });
  const metaPorCodigo = new Map(metas.map((m) => [m.codigo, m]));

  const anteriores = await prisma.bscSnapshot.findMany({
    where: { companyId: ctx.companyId, dataReferencia: { lt: ctx.dataReferencia } },
    orderBy: { dataReferencia: "desc" },
    take: INDICADORES_BSC.length * 3,
  });
  const anteriorPorCodigo = new Map<string, number | null>();
  for (const snap of anteriores) {
    if (!anteriorPorCodigo.has(snap.codigo)) anteriorPorCodigo.set(snap.codigo, snap.valor);
  }

  return INDICADORES_BSC.map((indicador) => {
    let valor: number | null = null;
    let detalhes: Record<string, unknown> | null = null;
    try {
      const resultado = indicador.calcular(ctx);
      valor = resultado.valor;
      detalhes = resultado.detalhes ?? null;
    } catch {
      // Indicador que quebra vira SEM_DADO: um scorecard incompleto e melhor
      // que um scorecard que nao abre.
      valor = null;
    }

    const metaCadastrada = metaPorCodigo.get(indicador.codigo);
    const meta = metaCadastrada?.meta ?? indicador.metaSugerida;
    const tolerancia = metaCadastrada?.toleranciaPercent ?? 10;

    return {
      indicador,
      valor,
      meta,
      metaEhSugerida: !metaCadastrada && indicador.metaSugerida !== null,
      farol: calcularFarol(valor, meta, indicador.direcao, tolerancia),
      detalhes,
      valorAnterior: anteriorPorCodigo.get(indicador.codigo) ?? null,
    };
  });
}

// Grava a medicao do dia. Um snapshot por (empresa, data, indicador) — reexecutar
// o dia sobrescreve em vez de duplicar, para o historico nunca contar o mesmo
// dia duas vezes numa media.
export async function gravarSnapshotBsc(ctx: ContextoAuditoria, medidos: IndicadorMedido[]): Promise<void> {
  for (const m of medidos) {
    await prisma.bscSnapshot.upsert({
      where: {
        companyId_dataReferencia_codigo: {
          companyId: ctx.companyId,
          dataReferencia: ctx.dataReferencia,
          codigo: m.indicador.codigo,
        },
      },
      create: {
        companyId: ctx.companyId,
        dataReferencia: ctx.dataReferencia,
        codigo: m.indicador.codigo,
        perspectiva: m.indicador.perspectiva,
        valor: m.valor,
        meta: m.meta,
        farol: m.farol,
        detalhes: (m.detalhes ?? undefined) as Prisma.InputJsonValue | undefined,
      },
      update: {
        valor: m.valor,
        meta: m.meta,
        farol: m.farol,
        detalhes: (m.detalhes ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }
}

export const PERSPECTIVAS: { chave: BscPerspectiva; nome: string; explicacao: string }[] = [
  {
    chave: "FINANCEIRA",
    nome: "Financeira",
    explicacao: "O resultado que a operação entrega: margem, ciclo de caixa e perdas financeiras.",
  },
  {
    chave: "CLIENTE",
    nome: "Cliente e mercado",
    explicacao: "Qualidade da carteira: quem paga, quem atrasa e o quanto a receita depende de poucos contratos.",
  },
  {
    chave: "PROCESSOS_INTERNOS",
    nome: "Processos internos",
    explicacao: "A disciplina que sustenta o número: conciliar, classificar, pagar em dia, alocar custo.",
  },
  {
    chave: "APRENDIZADO_CRESCIMENTO",
    nome: "Aprendizado e crescimento",
    explicacao: "Produtividade da estrutura — o que explica o custo do próximo mês antes de ele acontecer.",
  },
];
