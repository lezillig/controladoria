import { fmtBRL, fmtPercent } from "../format";
import {
  competenciaAnterior,
  desvioDoPadrao,
  lerSeries,
  montarBaselines,
  type SerieMensal,
} from "../historico";
import type { AchadoNovo, Agente, ContextoAuditoria } from "../types";
import { normalizarRazaoSocial } from "../documento";
import { chaveAchado, chaveMes, materialidadeCents, mediana, severidadePorValor } from "./comum";

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

  // QUEM NÃO É FORNECEDOR não tem padrão de fornecedor.
  //
  //   - A PRÓPRIA EMPRESA. "AZUL TRANSPORTES subiu de patamar: de R$ 14.830
  //     para R$ 550.000 por mês" era a Azul transferindo para a Azul (e a MCZ
  //     para a MCZ): mútuo, aporte, folha paga pela matriz. Não é reajuste,
  //     não é fornecedor efêmero, não é fila de pagamento — é movimento
  //     entre contas do grupo, e entra aqui só porque o parceiro existe no
  //     cadastro. Reconhecido pelo CNPJ da conexão ou pelo nome dela.
  //   - BANCO, FINANCEIRA, CONSÓRCIO E TRIBUTO. O Bradesco "subiu 56%" porque
  //     entrou um financiamento novo, e o que se renegocia é o contrato, não
  //     um "aditivo de fornecimento". A cobrança retroativa da diferença, que
  //     é a recomendação, não faz sentido para nenhum deles.
  const seriesDeFornecedores = somenteFornecedores(series, ctx);

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
    foraDoPadrao(seriesDeFornecedores, competenciaAtual, materialidade)
  );

  montar(
    "HI-FORNECEDOR-EFEMERO",
    "FRAUDE",
    (i) => `${i.rotulo} recebeu e desapareceu`,
    "Conferir contrato, notas e a entrega correspondente. Fornecedor de serviço pontual tem exatamente este desenho e " +
      "é legítimo; o que não pode existir é pagamento relevante sem contraparte documentada.",
    fornecedorEfemero(seriesDeFornecedores, competenciaAtual, materialidade)
  );

  // REAJUSTE × OPERAÇÃO QUE CRESCEU. O cartão de combustível "subiu 44%"
  // no mesmo período em que a receita subiu: mais contrato, mais veículo
  // rodando, mais diesel. Preço unitário reajustado e volume maior produzem
  // o mesmo salto no total do fornecedor; a receita separa os dois. Quando o
  // faturamento do grupo cresceu ao menos metade do que o fornecedor
  // cresceu, o achado diz isso e pede a conta certa: custo por quilômetro
  // ou por veículo, não aditivo.
  const crescimentoDaReceita = crescimentoRecenteDaReceita(ctx, competenciaAtual);
  const reajustes = reajusteSilencioso(seriesDeFornecedores, competenciaAtual, materialidade).map((i) => {
    const aumento = Number((i.evidencia as { aumentoPercent?: number }).aumentoPercent ?? 0);
    const acompanhaOperacao = crescimentoDaReceita !== null && crescimentoDaReceita >= aumento / 2 && crescimentoDaReceita > 10;
    if (!acompanhaOperacao) return i;
    return {
      ...i,
      descricao:
        i.descricao +
        ` No mesmo período a receita do grupo cresceu ${fmtPercent(crescimentoDaReceita)}: o salto acompanha a operação, ` +
        `e a pergunta certa é se o custo por veículo ou por quilômetro subiu — não se houve aditivo.`,
      evidencia: { ...i.evidencia, crescimentoDaReceitaPercent: Math.round(crescimentoDaReceita * 10) / 10, acompanhaOperacao: true },
    };
  });
  montar(
    "HI-REAJUSTE-SILENCIOSO",
    "PERDA_FINANCEIRA",
    (i) => `${i.rotulo} subiu de patamar e ficou`,
    "Localizar o aditivo ou o aceite que autorizou o novo valor. Sem ele, o reajuste é unilateral e cabe cobrança " +
      "retroativa da diferença — o valor do achado é o custo projetado em doze meses.",
    reajustes
  );

  montar(
    "HI-PRAZO-ANTECIPADO",
    "FRAUDE",
    (i) => `${i.rotulo} passou a ser pago antes do vencimento`,
    "Verificar se há desconto por antecipação negociado e registrado. Havendo, o desconto precisa aparecer no valor " +
      "pago; não havendo, identificar quem alterou a ordem da fila de pagamentos e com que autorização.",
    prazoAntecipado(seriesDeFornecedores, competenciaAtual, materialidade)
  );

  return achados;
}

// Banco, financeira, consórcio, tributo e afins: não são fornecedores com
// contrato de fornecimento, e nenhuma das quatro perguntas deste agente se
// aplica a eles.
const NAO_E_FORNECEDOR =
  /\b(banco|bco|financeira|cons[oó]rcio|leasing|arrendamento|fomento|fidc|securitizadora|sicredi|sicoob|caixa econ|receita federal|prefeitura|secretaria da fazenda|sefaz|inss|fgts|detran)/i;

export function somenteFornecedores(
  series: SerieMensal[],
  ctx: Pick<ContextoAuditoria, "conexoes" | "parceiros">
): SerieMensal[] {
  const cnpjsDoGrupo = new Set(ctx.conexoes.map((c) => (c.cnpj ?? "").replace(/\D/g, "")).filter(Boolean));
  const nomesDoGrupo = ctx.conexoes.map((c) => normalizarRazaoSocial(c.nome)).filter((n) => n.length >= 6);
  // O mesmo código existe nas duas contas Omie com parceiros diferentes, e a
  // série do resumo vem por código. Todos os parceiros do código entram na
  // decisão: a série só sai quando TODOS estão fora de escopo — na dúvida, o
  // fornecedor fica.
  const parceirosPorCodigo = new Map<string, ContextoAuditoria["parceiros"]>();
  for (const p of ctx.parceiros) parceirosPorCodigo.set(p.codigoOmie, [...(parceirosPorCodigo.get(p.codigoOmie) ?? []), p]);
  const parceiroForaDeEscopo = (nomeBruto: string | null, documentoBruto: string | null): boolean => {
    const documento = (documentoBruto ?? "").replace(/\D/g, "");
    if (documento && cnpjsDoGrupo.has(documento)) return true;
    const nome = normalizarRazaoSocial(nomeBruto ?? "");
    if (nome && nomesDoGrupo.some((n) => n === nome || nome.startsWith(n))) return true;
    return NAO_E_FORNECEDOR.test(nomeBruto ?? "");
  };
  const foraDeEscopo = (chave: string, rotulo: string | null): boolean => {
    const candidatos = parceirosPorCodigo.get(chave) ?? [];
    if (candidatos.length === 0) return parceiroForaDeEscopo(rotulo, null);
    return candidatos.every((p) => parceiroForaDeEscopo(p.nome, p.documento));
  };
  const excluidas = new Set(
    [...porChave(series)].filter(([chave, linhas]) => foraDeEscopo(chave, rotuloDe(linhas, chave))).map(([chave]) => chave)
  );
  return series.filter((s) => !excluidas.has(s.chave));
}

// Crescimento da receita do grupo: mediana dos três meses recentes contra a
// mediana dos anteriores, na mesma janela que o reajuste usa. Vem dos
// títulos a receber do contexto; nulo quando não há base para comparar.
function crescimentoRecenteDaReceita(ctx: ContextoAuditoria, competenciaAtual: string): number | null {
  const porMes = new Map<string, number>();
  for (const t of ctx.titulos) {
    if (t.natureza !== "RECEBER" || t.cancelado) continue;
    const comp = competenciaDe(t.dataEmissao ?? t.dataVencimento);
    // Só meses inteiros DENTRO da janela: fora dela o contexto tem apenas os
    // títulos ainda em aberto, e um mês antigo com um título só puxaria a
    // mediana para baixo e inventaria crescimento. O mês corrente, parcial,
    // fica de fora pelo mesmo motivo.
    if (comp >= competenciaAtual || comp < competenciaDe(ctx.janelaDesde)) continue;
    porMes.set(comp, (porMes.get(comp) ?? 0) + t.valorDocumentoCents);
  }
  const meses = [...porMes.entries()].filter(([, v]) => v > 0).sort(([a], [b]) => a.localeCompare(b));
  if (meses.length < 6) return null;
  const recentes = meses.slice(-3).map(([, v]) => v);
  const antigos = meses.slice(0, -3).map(([, v]) => v);
  const antes = mediana(antigos);
  const depois = mediana(recentes);
  if (antes <= 0) return null;
  return ((depois - antes) / antes) * 100;
}
