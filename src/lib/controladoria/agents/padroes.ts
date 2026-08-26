import { fmtBRL, fmtPercent } from "../format";
import {
  competenciaAnterior,
  desvioDoPadrao,
  lerSeries,
  montarBaselines,
  type SerieMensal,
} from "../historico";
import type { AchadoNovo, Agente, ContextoAuditoria } from "../types";
import { chaveAchado, chaveMes, materialidadeCents, severidadePorValor } from "./comum";

// AGENTE DE PADRÕES — o que só o histórico responde.
//
// Os outros agentes olham o presente contra um limiar. Este olha o presente
// contra o PASSADO DE CADA UM, e a diferença não é de grau:
//
//   "pagamento acima de R$ 50 mil" é uma afirmação sobre o tamanho da empresa.
//   Cresça o dobro e a regra vira ruído; encolha pela metade e ela emudece.
//
//   "este fornecedor cobrou cinco vezes o que cobra há dois anos" é uma
//   afirmação sobre o fornecedor. Vale igual numa empresa de dez milhões e
//   numa de dez mil, e é a pergunta que um auditor faz de verdade.
//
// A leitura vem do resumo mensal (HistoricoMensal), não do contexto: o
// contexto tem teto de 400 dias por decisão de custo, e comparar com dois anos
// exige dois anos. Somado por mês, isso são dezenas de linhas por fornecedor
// em vez de milhares de títulos.
//
// AS REGRAS SÃO PURAS E EXPORTADAS. A consulta é assíncrona e fica no
// `executar`; a decisão recebe os dados por parâmetro. É o que permite
// exercitar cada regra com uma série montada à mão, sem banco — e este módulo,
// mais que os outros, precisa disso: um erro de sinal aqui não quebra nada,
// só passa a acusar a pessoa errada.

// MEDIANA, NÃO MÉDIA; MAD, NÃO DESVIO PADRÃO. A razão está em historico.ts, e
// ela é o coração desta camada: o desvio padrão é puxado pelo próprio ponto
// fora da curva que se procura, então o extremo acaba cabendo dentro dele.

// Dois anos de janela. Três capturariam mais sazonalidade e trariam de volta
// preços de um negócio que já era outro — o mesmo argumento que limitou a
// carga histórica a cinco anos em vez de nove.
const MESES_DE_JANELA = 24;

// Menos que isso não é padrão, é amostra. Seis meses cobrem um semestre
// inteiro e já revelam sazonalidade curta.
const MINIMO_DE_MESES = 6;

// Cinco desvios absolutos medianos. Em série financeira real, três produz
// alarme quase todo mês; cinco separa o que qualquer pessoa olharia duas vezes.
const DESVIOS_PARA_ALERTAR = 5;

// Fornecedor que aparece em poucos meses e some. Três é o teto: quatro meses
// seguidos já é relação, não passagem.
const MESES_DE_EFEMERO = 3;

// Quantos meses sem faturar para considerar que sumiu.
const MESES_DE_AUSENCIA = 3;

export type ItemDePadrao = {
  chave: string;
  rotulo: string;
  valorCents: number;
  descricao: string;
  evidencia: Record<string, unknown>;
};

function competenciaDe(d: Date): string {
  return chaveMes(d);
}

function porChave(series: SerieMensal[]): Map<string, SerieMensal[]> {
  const mapa = new Map<string, SerieMensal[]>();
  for (const s of series) {
    const atual = mapa.get(s.chave);
    if (atual) atual.push(s);
    else mapa.set(s.chave, [s]);
  }
  return mapa;
}

function rotuloDe(linhas: SerieMensal[], chave: string): string {
  return linhas.find((l) => l.rotulo)?.rotulo ?? chave;
}

// ---------------------------------------------------------------------------
// HI-FORA-DO-PADRAO — o mês corrente muito acima do que ESTE fornecedor cobra.
//
// A base de comparação EXCLUI o mês corrente, e isso não é detalhe: incluí-lo
// faria o próprio valor sob suspeita puxar a mediana na direção dele, e um
// pagamento absurdo o bastante deixaria de ser absurdo por causa de si mesmo.
// ---------------------------------------------------------------------------
export function foraDoPadrao(
  series: SerieMensal[],
  competenciaAtual: string,
  materialidade: number
): ItemDePadrao[] {
  const achados: ItemDePadrao[] = [];

  for (const [chave, linhas] of porChave(series)) {
    const atual = linhas.find((l) => l.competencia === competenciaAtual);
    if (!atual || atual.valorCents <= 0) continue;

    const anteriores = linhas.filter((l) => l.competencia < competenciaAtual);
    const baseline = montarBaselines(anteriores, MINIMO_DE_MESES).get(chave);
    if (!baseline) continue;

    const desvios = desvioDoPadrao(atual.valorCents, baseline);
    if (desvios < DESVIOS_PARA_ALERTAR) continue;

    // O que interessa é o EXCEDENTE, não o valor cheio: o padrão do fornecedor
    // é despesa esperada, e chamar o total de "valor em jogo" inflaria o
    // impacto de todo achado desta regra.
    const excedente = atual.valorCents - baseline.medianaCents;
    if (excedente < materialidade) continue;

    achados.push({
      chave,
      rotulo: rotuloDe(linhas, chave),
      valorCents: excedente,
      descricao:
        `No mês, ${fmtBRL(atual.valorCents)} em ${atual.titulos} título(s). ` +
        `Nos ${baseline.meses} meses anteriores (${baseline.primeiraCompetencia} a ${baseline.ultimaCompetencia}), ` +
        `o típico era ${fmtBRL(baseline.medianaCents)} por mês — excedente de ${fmtBRL(excedente)}.`,
      evidencia: {
        competencia: competenciaAtual,
        valorDoMes: atual.valorCents,
        titulosNoMes: atual.titulos,
        maiorTituloDoMes: atual.valorMaximoCents,
        medianaHistorica: baseline.medianaCents,
        mesesDeHistorico: baseline.meses,
        desviosAcima: Math.round(desvios * 10) / 10,
      },
    });
  }

  return achados;
}

// ---------------------------------------------------------------------------
// HI-FORNECEDOR-EFEMERO — apareceu, recebeu alto, sumiu.
//
// É o formato clássico de empresa de fachada, e é invisível para qualquer
// regra de limiar: cada pagamento isolado pode ser perfeitamente normal. O que
// chama atenção é o CONJUNTO — poucos meses de vida, volume relevante,
// silêncio depois.
//
// Não é acusação. Fornecedor de obra pontual tem exatamente esse desenho, e o
// achado diz isso na recomendação.
// ---------------------------------------------------------------------------
export function fornecedorEfemero(
  series: SerieMensal[],
  competenciaAtual: string,
  materialidade: number
): ItemDePadrao[] {
  const achados: ItemDePadrao[] = [];
  const limiteDeAusencia = competenciaAnterior(competenciaAtual, MESES_DE_AUSENCIA);

  for (const [chave, linhas] of porChave(series)) {
    const ativos = linhas.filter((l) => l.valorCents > 0);
    if (ativos.length === 0 || ativos.length > MESES_DE_EFEMERO) continue;

    const total = ativos.reduce((a, b) => a + b.valorCents, 0);
    if (total < materialidade * 2) continue;

    const competencias = ativos.map((a) => a.competencia).sort();
    const ultima = competencias[competencias.length - 1];
    // Ainda ativo não é efêmero — é fornecedor novo, que já tem regra própria.
    if (ultima > limiteDeAusencia) continue;

    achados.push({
      chave,
      rotulo: rotuloDe(linhas, chave),
      valorCents: total,
      descricao:
        `Recebeu ${fmtBRL(total)} em ${ativos.length} mês(es) — ${competencias.join(", ")} — e não voltou a faturar desde então. ` +
        `Nos ${MESES_DE_JANELA} meses analisados, é todo o histórico dele.`,
      evidencia: {
        totalRecebido: total,
        mesesAtivos: competencias,
        ultimaCompetencia: ultima,
        titulos: ativos.reduce((a, b) => a + b.titulos, 0),
      },
    });
  }

  return achados;
}

// ---------------------------------------------------------------------------
// HI-REAJUSTE-SILENCIOSO — contrato recorrente que subiu de degrau e ficou.
//
// Diferente de HI-FORA-DO-PADRAO de propósito: aquele acha o PICO, este acha o
// PATAMAR. Um pico chama atenção sozinho; um reajuste de 20% que virou o novo
// normal não chama nenhuma — some dentro da variação mensal e só aparece
// quando alguém compara o ano com o anterior.
// ---------------------------------------------------------------------------
export function reajusteSilencioso(
  series: SerieMensal[],
  competenciaAtual: string,
  materialidade: number,
  aumentoMinimoPercent = 25
): ItemDePadrao[] {
  const achados: ItemDePadrao[] = [];

  for (const [chave, linhas] of porChave(series)) {
    const ativos = linhas.filter((l) => l.valorCents > 0 && l.competencia <= competenciaAtual);
    // Recorrente de verdade: ao menos doze meses de vida, para haver "antes" e
    // "depois" com significado.
    if (ativos.length < 12) continue;

    const ordenados = [...ativos].sort((a, b) => a.competencia.localeCompare(b.competencia));
    const recentes = ordenados.slice(-3);
    const antigos = ordenados.slice(0, -3);
    if (antigos.length < MINIMO_DE_MESES) continue;

    const mediana = (v: number[]) => {
      const o = [...v].sort((a, b) => a - b);
      const m = Math.floor(o.length / 2);
      return o.length % 2 === 1 ? o[m] : Math.round((o[m - 1] + o[m]) / 2);
    };
    const antes = mediana(antigos.map((l) => l.valorCents));
    const depois = mediana(recentes.map((l) => l.valorCents));
    if (antes <= 0) continue;

    const aumento = ((depois - antes) / antes) * 100;
    if (aumento < aumentoMinimoPercent) continue;

    // Doze meses no novo patamar é o custo anual do reajuste — o número que
    // interessa a quem vai renegociar, e não a diferença de um mês.
    const custoAnual = (depois - antes) * 12;
    if (custoAnual < materialidade) continue;

    achados.push({
      chave,
      rotulo: rotuloDe(linhas, chave),
      valorCents: custoAnual,
      descricao:
        `Fatura há ${ativos.length} meses. O típico era ${fmtBRL(antes)} por mês; nos últimos três, ${fmtBRL(depois)} — ` +
        `alta de ${fmtPercent(aumento)} que se manteve. Projetado em doze meses, são ${fmtBRL(custoAnual)} a mais.`,
      evidencia: {
        medianaAnterior: antes,
        medianaRecente: depois,
        aumentoPercent: Math.round(aumento * 10) / 10,
        mesesDeRelacao: ativos.length,
        custoAnualizado: custoAnual,
      },
    });
  }

  return achados;
}

// ---------------------------------------------------------------------------
// HI-PRAZO-ANTECIPADO — fornecedor que passou a ser pago antes do vencimento.
//
// Isolado, não é nada: adiantar um pagamento acontece. Como PADRÃO que mudou,
// é uma das perguntas mais antigas de auditoria — quem decide a ordem da fila
// de pagamentos, e por quê. Pode ser desconto negociado (e aí é bom, e deveria
// aparecer no valor); pode ser favorecimento.
//
// `diasPagamentoSoma` guarda a soma de (dia da baixa − dia do vencimento).
// Negativo é adiantado. Guardar a soma e a contagem, e não a média, é o que
// permite juntar meses — média de médias não é a média.
// ---------------------------------------------------------------------------
export function prazoAntecipado(
  series: SerieMensal[],
  competenciaAtual: string,
  materialidade: number,
  diasDeAntecipacao = 5
): ItemDePadrao[] {
  const achados: ItemDePadrao[] = [];

  for (const [chave, linhas] of porChave(series)) {
    const comBaixa = linhas.filter((l) => l.baixas > 0 && l.competencia <= competenciaAtual);
    if (comBaixa.length < 12) continue;

    const ordenados = [...comBaixa].sort((a, b) => a.competencia.localeCompare(b.competencia));
    const recentes = ordenados.slice(-3);
    const antigos = ordenados.slice(0, -3);
    if (antigos.length < MINIMO_DE_MESES) continue;

    const mediaDias = (ls: SerieMensal[]) => {
      const baixas = ls.reduce((a, b) => a + b.baixas, 0);
      return baixas > 0 ? ls.reduce((a, b) => a + b.diasPagamentoSoma, 0) / baixas : 0;
    };
    const antes = mediaDias(antigos);
    const depois = mediaDias(recentes);

    // Antes era pago no vencimento ou depois; agora, sistematicamente antes.
    if (antes < 0) continue;
    if (depois > -diasDeAntecipacao) continue;

    const valorRecente = recentes.reduce((a, b) => a + b.valorBaixadoCents, 0);
    if (valorRecente < materialidade) continue;

    achados.push({
      chave,
      rotulo: rotuloDe(linhas, chave),
      valorCents: valorRecente,
      descricao:
        `Era pago em média ${Math.round(antes)} dia(s) após o vencimento; nos últimos três meses, ` +
        `${Math.abs(Math.round(depois))} dia(s) ANTES — sobre ${fmtBRL(valorRecente)} pagos no período.`,
      evidencia: {
        diasMediosAntes: Math.round(antes * 10) / 10,
        diasMediosDepois: Math.round(depois * 10) / 10,
        valorNoPeriodoRecente: valorRecente,
        mesesComparados: { antes: antigos.length, depois: recentes.length },
      },
    });
  }

  return achados;
}

// ---------------------------------------------------------------------------

export const agentePadroes: Agente = {
  id: "padroes",
  nome: "Padrões e desvios históricos",
  area: "Controladoria",
  descricao:
    "Compara cada fornecedor com o próprio histórico de até dois anos: gasto fora do padrão dele, fornecedor que apareceu e sumiu, reajuste que virou patamar sem aditivo e mudança na ordem da fila de pagamentos. São as perguntas que limiar fixo não responde.",
  executar: auditarPadroes,
};

async function auditarPadroes(ctx: ContextoAuditoria): Promise<AchadoNovo[]> {
  const competenciaAtual = competenciaDe(ctx.dataReferencia);
  const materialidade = materialidadeCents(ctx);

  const series = await lerSeries({
    companyId: ctx.companyId,
    conexaoId: ctx.conexaoId,
    dimensao: "PARCEIRO",
    natureza: "PAGAR",
    de: competenciaAnterior(competenciaAtual, MESES_DE_JANELA),
    ate: competenciaAtual,
  });

  // Base vazia não é base pequena. Sem resumo mensal nenhum — porque a carga
  // histórica não rodou, ou porque o recálculo ainda não foi feito — este
  // agente se cala inteiro, em vez de concluir "nenhum desvio encontrado"
  // sobre nada. Silêncio por falta de dado não pode parecer aprovação.
  if (series.length === 0) return [];

  const achados: AchadoNovo[] = [];
  const montar = (
    regra: string,
    categoria: AchadoNovo["categoria"],
    tituloDe: (i: ItemDePadrao) => string,
    recomendacao: string,
    itens: ItemDePadrao[]
  ) => {
    for (const i of itens) {
      achados.push({
        regra,
        tipo: "ESTADO",
        severidade: severidadePorValor(i.valorCents, materialidade),
        categoria,
        titulo: tituloDe(i),
        descricao: i.descricao,
        recomendacao,
        valorCents: i.valorCents,
        dataReferencia: ctx.dataReferencia,
        entidadeTipo: "OmieParceiro",
        entidadeRef: i.rotulo,
        evidencia: { fornecedor: i.rotulo, ...i.evidencia },
        // A competência entra na chave: o mesmo fornecedor fora do padrão em
        // dois meses diferentes são dois fatos, não uma repetição.
        chave: chaveAchado(regra, i.chave, competenciaAtual),
      });
    }
  };

  montar(
    "HI-FORA-DO-PADRAO",
    "RISCO_FINANCEIRO",
    (i) => `${i.rotulo} cobrou muito acima do próprio padrão`,
    "Comparar as notas do mês com as dos meses anteriores do mesmo fornecedor. Aumento de escopo, reajuste " +
      "contratual e erro de digitação produzem o mesmo salto no total — e só o documento distingue os três.",
    foraDoPadrao(series, competenciaAtual, materialidade)
  );

  montar(
    "HI-FORNECEDOR-EFEMERO",
    "FRAUDE",
    (i) => `${i.rotulo} recebeu e desapareceu`,
    "Conferir contrato, notas e a entrega correspondente. Fornecedor de serviço pontual tem exatamente este desenho e " +
      "é legítimo; o que não pode existir é pagamento relevante sem contraparte documentada.",
    fornecedorEfemero(series, competenciaAtual, materialidade)
  );

  montar(
    "HI-REAJUSTE-SILENCIOSO",
    "PERDA_FINANCEIRA",
    (i) => `${i.rotulo} subiu de patamar e ficou`,
    "Localizar o aditivo ou o aceite que autorizou o novo valor. Sem ele, o reajuste é unilateral e cabe cobrança " +
      "retroativa da diferença — o valor do achado é o custo projetado em doze meses.",
    reajusteSilencioso(series, competenciaAtual, materialidade)
  );

  montar(
    "HI-PRAZO-ANTECIPADO",
    "FRAUDE",
    (i) => `${i.rotulo} passou a ser pago antes do vencimento`,
    "Verificar se há desconto por antecipação negociado e registrado. Havendo, o desconto precisa aparecer no valor " +
      "pago; não havendo, identificar quem alterou a ordem da fila de pagamentos e com que autorização.",
    prazoAntecipado(series, competenciaAtual, materialidade)
  );

  return achados;
}
