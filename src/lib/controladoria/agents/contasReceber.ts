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

export function auditarContasReceber(ctx: ContextoAuditoria): AchadoNovo[] {
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
//
// UM ACHADO POR CLIENTE, como a inadimplência — e não um só para a empresa
// inteira, como era. O agregado escondia o cliente: a Cajamar tinha R$ 1,19
// milhão vencido há mais de seis meses dentro de um achado "R$ X a receber
// vencidos há mais de 180 dias" sem entidade, e quem investigava a Cajamar
// não o encontrava. A recomendação ("classificar caso a caso") já era por
// cliente; o achado agora também é.
function perdaProvavel(
  ctx: ContextoAuditoria,
  titulos: ReturnType<typeof titulosAtivos>,
  materialidade: number
): AchadoNovo[] {
  const antigos = titulos.filter((t) => emAberto(t) && diasDeAtraso(t, ctx.dataReferencia) > DIAS_PERDA_PROVAVEL);
  const porCliente = agrupar(antigos, (t) => chaveParceiro(t));

  const achados: AchadoNovo[] = [];
  for (const [codigo, grupo] of porCliente) {
    const valor = somar(grupo, saldoAberto);
    // Sem piso de materialidade: crédito velho é ajuste contábil, e o balanço
    // não tem "pequeno demais para provisionar".
    const atrasoMaximo = Math.max(...grupo.map((t) => diasDeAtraso(t, ctx.dataReferencia)));
    achados.push({
      regra: "CR-PERDA-PROVAVEL",
      tipo: "ESTADO",
      severidade: agravar(severidadePorValor(valor, materialidade)),
      categoria: "RISCO_FINANCEIRO",
      titulo: `${nomeParceiro(ctx, grupo[0])} com ${fmtBRL(valor)} vencidos há mais de ${DIAS_PERDA_PROVAVEL} dias`,
      descricao:
        `${grupo.length} título(s) vencidos há mais de seis meses (o mais antigo há ${atrasoMaximo} dias) seguem no ativo como se fossem recebíveis. ` +
        `Sem provisão, o resultado do período está superestimado nesse valor e a decisão baseada nele fica errada.`,
      recomendacao:
        "Classificar: em cobrança judicial, negociação ativa ou perda. O que for perda deve ser provisionado " +
        "(e, atendidos os requisitos da Lei 9.430/96, deduzido) — decidir com a contabilidade antes do fechamento do trimestre.",
      valorCents: valor,
      dataReferencia: ctx.dataReferencia,
      entidadeTipo: "OmieParceiro",
      entidadeRef: nomeParceiro(ctx, grupo[0]),
      evidencia: {
        cliente: nomeParceiro(ctx, grupo[0]),
        titulos: grupo.slice(0, 50).map((t) => ({
          lancamento: t.codigoLancamento,
          documento: t.numeroDocumento,
          vencimento: t.dataVencimento.toISOString(),
          saldo: saldoAberto(t),
          atraso: diasDeAtraso(t, ctx.dataReferencia),
        })),
        quantidade: grupo.length,
      },
      chave: chaveAchado("CR-PERDA-PROVAVEL", codigo),
    });
  }
  return achados;
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

    // DESCONTO QUASE IGUAL AO FATURADO NÃO É DESCONTO. Ame Digital com 96,7%
    // e SPAL com 96,8%: ninguém dá 97% de desconto a uma engarrafadora. É o
    // campo "desconto" da Omie sendo usado para outra coisa — a parte
    // liquidada por compensação ou crédito, a taxa da plataforma, uma baixa
    // registrada errado. O dinheiro pode até ter entrado; o que sumiu foi a
    // trilha. A regra continua apontando, mas diz o que é: registro, não
    // política comercial. Os 15% da Kontak (203 títulos) são o outro caso —
    // comissão de agência lançada como desconto, recorrente, e é esse que
    // precisa de política escrita.
    const registroSuspeito = percentual >= 50;
    const cliente = nomeParceiro(ctx, grupo[0]);

    achados.push({
      regra: "CR-DESCONTO",
      tipo: "ESTADO",
      severidade: severidadePorValor(desconto, materialidade),
      categoria: registroSuspeito ? "ERRO_PROCESSO" : "PERDA_FINANCEIRA",
      titulo: registroSuspeito
        ? `${fmtBRL(desconto)} lançados como desconto para ${cliente} (${fmtPercent(percentual)} do faturado)`
        : `${fmtBRL(desconto)} em descontos concedidos a ${cliente}`,
      descricao:
        `${grupo.length} recebimento(s) desse cliente tiveram desconto, somando ${fmtBRL(desconto)} — ` +
        `${fmtPercent(percentual)} do valor faturado a ele. ` +
        (registroSuspeito
          ? "Desconto quase igual ao faturado não é desconto comercial: o campo está registrando outra coisa — baixa por " +
            "compensação ou crédito, taxa de plataforma, ou lançamento errado. A receita some do DRE sem trilha do que aconteceu."
          : "Em serviço de fretamento, essa margem raramente é recuperável no volume."),
      recomendacao: registroSuspeito
        ? "Abrir as baixas desses títulos na Omie e ver como foram liquidadas. O que foi compensação ou crédito deve ser baixa " +
          "própria, não desconto; o que foi taxa é despesa financeira. Corrigir para a receita bruta voltar ao DRE."
        : "Verificar se há política de desconto aprovada e quem autorizou cada um. Sem política, definir alçada e percentual máximo; " +
          "havendo política, checar se o desconto por antecipação está sendo dado para pagamentos que não foram antecipados.",
      valorCents: desconto,
      impactoCents: registroSuspeito ? undefined : desconto,
      dataReferencia: ctx.dataReferencia,
      entidadeTipo: "OmieParceiro",
      entidadeRef: cliente,
      evidencia: {
        cliente,
        desconto,
        faturado: bruto,
        percentual: fmtPercent(percentual),
        titulos: grupo.length,
        lista: [...grupo]
          .sort((a, b) => b.descontoCents - a.descontoCents)
          .slice(0, 50)
          .map((t) => ({
            documento: t.numeroDocumento ?? t.codigoLancamento,
            vencimento: t.dataVencimento.toISOString(),
            faturado: t.valorDocumentoCents,
            desconto: t.descontoCents,
            recebido: t.valorPagoCents,
            status: t.status,
          })),
      },
      chave: chaveAchado("CR-DESCONTO", codigo, chaveMes(ctx.dataReferencia)),
    });
  }
  return achados;
}

// CR-RECEBIDO-MENOR — titulo marcado como liquidado, mas com recebimento
// abaixo do devido. E o "sumico silencioso": ninguem cobra a diferenca
// porque o titulo aparece como quitado.
const TOLERANCIA_CENTAVOS = 50;

// RETENÇÃO PRESUMIDA — o padrão que separa imposto retido de perda real.
//
// A calibragem anterior descontava a retenção REGISTRADA no título. Só que
// a Omie do cliente não registra retenção em título nenhum: os campos vêm
// zerados e o órgão público paga líquido do mesmo jeito. As evidências
// mostraram a assinatura: a Secretaria da Educação "recebeu a menor"
// exatamente 7,70% em cinco títulos de valores diferentes, e a Secretaria
// de Direitos Humanos exatamente 10,70% em todos os dela. Perda de verdade
// não tem alíquota. Tarifa bancária, glosa e erro de digitação produzem
// diferenças de valor variado; imposto retido produz sempre o mesmo
// percentual, ao centavo, para o mesmo cliente.
//
// A regra passa a olhar o CLIENTE, não o título: quando dois ou mais títulos
// liquidados do mesmo cliente faltam o mesmo percentual — ou quando o
// percentual é uma alíquota conhecida de retenção —, o conjunto vira UM
// achado de retenção não registrada (ESTADO, baixo), e os títulos saem do
// "recebido a menor". O que sobra ali é diferença sem padrão: o que merece
// cobrança.
//
// Percentuais em CENTÉSIMOS de ponto percentual (770 = 7,70%). Alíquotas
// típicas de retenção sobre serviço no Brasil: IR 1,5% e 1,2% (transporte),
// CSLL 1%, PIS 0,65%, COFINS 3%, PCC 4,65%, IN 1234 (IR 1,2% + PCC) 5,85%,
// ISS 2/3/5%, INSS 11% e 3,5% (desoneração). Combinações são cobertas pelo
// padrão entre títulos, não por lista — inventar combinações aqui seria
// chutar, e o dado já mostra qual é.
const ALIQUOTAS_DE_RETENCAO = new Set([65, 100, 120, 150, 200, 300, 350, 465, 480, 500, 585, 615, 705, 945, 1100]);
// Fora desta faixa não é retenção: abaixo de 0,5% é arredondamento ou tarifa;
// acima de 20% é glosa, desconto ou erro — e isso PRECISA aparecer.
const RETENCAO_MINIMA = 50;
const RETENCAO_MAXIMA = 2000;
// Cada imposto é arredondado separadamente pelo pagador; a soma pode
// desviar alguns centavos do percentual exato.
const TOLERANCIA_DE_ARREDONDAMENTO = 5;
const MAXIMO_DE_TITULOS_NA_EVIDENCIA = 50;

type FaltaApurada = {
  t: ReturnType<typeof titulosAtivos>[number];
  falta: number;
  devido: number;
  retencoes: number;
  // Percentual da falta sobre o devido, em centésimos de ponto; nulo quando
  // a falta não é um percentual limpo do devido (não é retenção).
  pontos: number | null;
};

function apurarFalta(t: ReturnType<typeof titulosAtivos>[number]): FaltaApurada {
  // RETENÇÃO REGISTRADA NÃO É PERDA. Prefeitura, órgão público e empresa
  // grande retêm ISS, IR, PIS/COFINS/CSLL e INSS no pagamento: o que entra é
  // o documento menos o imposto que o cliente recolheu em nome da empresa.
  // O imposto retido não some: vira crédito na apuração.
  const retencoes =
    t.retencaoIrCents + t.retencaoIssCents + t.retencaoPisCents + t.retencaoCofinsCents + t.retencaoCsllCents + t.retencaoInssCents;
  const devido = t.valorDocumentoCents - t.descontoCents - retencoes;
  const falta = devido - t.valorPagoCents;

  let pontos: number | null = null;
  if (devido > 0 && falta > 0) {
    const candidato = Math.round((falta * 10000) / devido);
    const esperado = Math.round((devido * candidato) / 10000);
    if (
      candidato >= RETENCAO_MINIMA &&
      candidato <= RETENCAO_MAXIMA &&
      Math.abs(esperado - falta) <= TOLERANCIA_DE_ARREDONDAMENTO
    ) {
      pontos = candidato;
    }
  }
  return { t, falta, devido, retencoes, pontos };
}

function recebimentoAMenor(
  ctx: ContextoAuditoria,
  titulos: ReturnType<typeof titulosAtivos>,
  materialidade: number
): AchadoNovo[] {
  const faltas = titulos
    .filter((t) => t.liquidado && t.valorPagoCents > 0)
    .map(apurarFalta)
    .filter(({ falta }) => falta > TOLERANCIA_CENTAVOS);

  // ALÍQUOTAS QUE A PRÓPRIA BASE ENSINA. A lista fixa cobre o Brasil em
  // geral; a base cobre este cliente em particular. Dois lugares de onde
  // aprender:
  //   - títulos que TÊM retenção registrada: a Associação das Pioneiras
  //     entrou com R$ 3.102,54 retidos sobre R$ 37.380,00 — 8,30%. Quando a
  //     Enforce "recebe a menor" exatos 8,30% num título único, é a mesma
  //     retenção, só que não registrada.
  //   - clusters de outros clientes: os 10,70% de Direitos Humanos aparecem
  //     em cinco títulos; a Secretaria Municipal de Educação, com um título
  //     só, falta os mesmos 10,70%.
  // Um título único só é reclassificado quando o percentual já foi visto de
  // um desses jeitos; percentual inédito e único continua sendo recebido a
  // menor, com o percentual na evidência para quem for conferir.
  const aliquotasConhecidas = new Set(ALIQUOTAS_DE_RETENCAO);
  for (const t of titulos) {
    const retencoes =
      t.retencaoIrCents + t.retencaoIssCents + t.retencaoPisCents + t.retencaoCofinsCents + t.retencaoCsllCents + t.retencaoInssCents;
    if (retencoes <= 0 || t.valorDocumentoCents <= 0) continue;
    const pontos = Math.round((retencoes * 10000) / t.valorDocumentoCents);
    if (pontos >= RETENCAO_MINIMA && pontos <= RETENCAO_MAXIMA) aliquotasConhecidas.add(pontos);
  }

  // Padrão por cliente e percentual. Dois títulos com a mesma alíquota, ou
  // um só com alíquota conhecida, é retenção; o resto é diferença real.
  const porClienteEAliquota = agrupar(
    faltas.filter((f) => f.pontos !== null),
    (f) => `${chaveParceiro(f.t)}|${f.pontos}`
  );
  for (const [, grupo] of porClienteEAliquota) {
    if (grupo.length >= 2) aliquotasConhecidas.add(grupo[0].pontos as number);
  }

  const retidos = new Set<string>();
  const achados: AchadoNovo[] = [];

  for (const [, grupo] of porClienteEAliquota) {
    const pontos = grupo[0].pontos as number;
    if (grupo.length < 2 && !aliquotasConhecidas.has(pontos)) continue;
    for (const f of grupo) retidos.add(f.t.id);

    const total = somar(grupo, (f) => f.falta);
    const cliente = nomeParceiro(ctx, grupo[0].t);
    const aliquota = fmtPercent(pontos / 100, 2);
    achados.push({
      regra: "CR-RETENCAO-PRESUMIDA",
      tipo: "ESTADO",
      severidade: "BAIXA",
      categoria: "ERRO_PROCESSO",
      titulo: `Retenção na fonte não registrada — ${cliente}`,
      descricao:
        `${grupo.length} título(s) liquidado(s) entraram com exatamente ${aliquota} a menos (${fmtBRL(total)} no total). ` +
        `Percentual fixo ao centavo é assinatura de imposto retido na fonte (ISS, IR, PIS/COFINS/CSLL ou INSS), não de perda. ` +
        `O título na Omie não registra a retenção: a receita aparece como recebida a menor e o crédito tributário fica ` +
        `invisível para a contabilidade.`,
      recomendacao:
        "Lançar a retenção nos campos próprios do título (ou na baixa) na Omie, para o DRE mostrar receita bruta e imposto " +
        "separados e a contabilidade aproveitar o crédito. Se o cliente não deveria reter esse percentual, cobrar a diferença.",
      valorCents: total,
      dataReferencia: ctx.dataReferencia,
      entidadeTipo: "OmieParceiro",
      entidadeRef: cliente,
      evidencia: {
        cliente,
        aliquota,
        titulos: grupo.length,
        totalRetido: total,
        amostra: grupo.slice(0, MAXIMO_DE_TITULOS_NA_EVIDENCIA).map((f) => ({
          documento: f.t.numeroDocumento ?? f.t.codigoLancamento,
          vencimento: f.t.dataVencimento.toISOString(),
          devido: f.devido,
          recebido: f.t.valorPagoCents,
          retido: f.falta,
        })),
      },
      chave: chaveAchado("CR-RETENCAO-PRESUMIDA", chaveParceiro(grupo[0].t), pontos),
    });
  }

  for (const { t, falta, devido, retencoes, pontos } of faltas) {
    if (retidos.has(t.id)) continue;
    achados.push({
      regra: "CR-RECEBIDO-MENOR",
      tipo: "EVENTO" as const,
      severidade: agravar(severidadePorValor(falta, materialidade)),
      categoria: "PERDA_FINANCEIRA" as const,
      titulo: `Recebimento a menor — ${nomeParceiro(ctx, t)}`,
      descricao:
        `${referenciaTitulo(t)} está liquidado, mas entraram ${fmtBRL(t.valorPagoCents)} de ${fmtBRL(devido)} devidos ` +
        `(descontos${retencoes > 0 ? ` e ${fmtBRL(retencoes)} de retenções na fonte` : ""} já considerados). ` +
        `Faltam ${fmtBRL(falta)} que ninguém vai cobrar, porque o título consta como quitado.`,
      recomendacao:
        "Conferir o comprovante do cliente. Sendo diferença real, reabrir a cobrança do saldo; sendo tarifa bancária, " +
        "lançar como despesa financeira em vez de reduzir a receita — a margem do contrato está sendo subestimada.",
      valorCents: falta,
      impactoCents: falta,
      dataReferencia: t.dataUltimaBaixa ?? t.dataVencimento,
      entidadeTipo: "OmieTitulo",
      entidadeId: t.id,
      entidadeRef: referenciaTitulo(t),
      evidencia: {
        documento: t.valorDocumentoCents,
        desconto: t.descontoCents,
        retencoes,
        devido,
        recebido: t.valorPagoCents,
        percentualDaFalta: fmtPercent(devido > 0 ? (falta / devido) * 100 : 0, 2),
        ...(pontos !== null ? { observacao: "percentual limpo, mas único para este cliente — conferir se é retenção" } : {}),
      },
      chave: chaveAchado("CR-RECEBIDO-MENOR", refTitulo(t)),
    });
  }

  return achados;
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
