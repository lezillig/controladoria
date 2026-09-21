import type { OmieCte, OmieTitulo } from "@prisma/client";
import { cteAutorizado } from "@/lib/omie/mapping";
import { casarCtesComTitulos } from "../cte";
import { fmtBRL, fmtData, fmtPercent } from "../format";
import { diasEntre, inicioDoAno, inicioDoMes } from "../periodos";
import type { AchadoNovo, Agente, ContextoAuditoria } from "../types";
import { agrupar, chaveAchado, chaveMes, materialidadeCents, refTitulo, severidadePorValor, somar, titulosAtivos } from "./comum";

// AGENTE FISCAL / CONTÁBIL
//
// Regime tributario da empresa: LUCRO PRESUMIDO (confirmado com o usuario).
// As faixas de referencia abaixo saem dai. Fretamento de passageiros no
// presumido tem uma particularidade que muda o numero esperado: a presuncao
// de IRPJ e de 16% (transporte de passageiros), nao os 32% de "servicos em
// geral" — usar 32% por engano infla a expectativa de imposto em 2x e faria
// este agente apontar "carga baixa" num tributo pago corretamente.
//
// Estas faixas sao REFERENCIA para levantar duvida, nunca apuracao. O calculo
// fiscal e da contabilidade; o papel do agente e dizer "o numero saiu fora da
// faixa esperada, vale conferir" — e mostrar a conta que fez.
const REFERENCIA_PRESUMIDO = {
  // PIS/COFINS cumulativos sobre a receita bruta.
  pisCofinsPercent: 3.65,
  // Presuncao de lucro sobre a receita, por atividade.
  presuncaoIrpjTransportePassageiros: 16,
  presuncaoCsll: 12,
  // ISS varia por municipio (Lei Complementar 116/2003 fixa o piso de 2% e o
  // teto de 5%); fretamento intermunicipal/interestadual e ICMS, nao ISS —
  // por isso a faixa e larga e o achado so aparece FORA dela.
  issMinPercent: 2,
  issMaxPercent: 5,
};

// Abaixo deste volume de notas no periodo, qualquer percentual medio e
// estatisticamente instavel e o achado viraria ruido.
const MINIMO_NOTAS_PARA_ANALISE = 5;

export const agenteFiscal: Agente = {
  id: "fiscal",
  nome: "Fiscal e contábil",
  area: "Contabilidade",
  descricao:
    "Confronta notas fiscais e títulos: receita sem nota, nota sem título, notas canceladas com título ativo, título de documento fiscal sem número, carga tributária efetiva fora da faixa esperada para o Lucro Presumido, ISS recolhido abaixo do destacado nas notas, NF-e de venda de mercadoria (risco do Bloco K) e falhas na sequência de numeração.",
  executar: auditarFiscal,
};

function auditarFiscal(ctx: ContextoAuditoria): AchadoNovo[] {
  const achados: AchadoNovo[] = [];
  const materialidade = materialidadeCents(ctx);

  achados.push(...notaCanceladaComTitulo(ctx, materialidade));
  achados.push(...receitaSemNota(ctx, materialidade));
  achados.push(...notaSemTitulo(ctx, materialidade));
  achados.push(...cargaTributaria(ctx));
  achados.push(...issRecolhidoAMenor(ctx, materialidade));
  achados.push(...nfeDeVendaDeMercadoria(ctx, materialidade));
  achados.push(...falhaNaSequencia(ctx));
  achados.push(...documentoSemNumero(ctx, materialidade));
  achados.push(...regrasDeCte(ctx, materialidade));

  return achados;
}

// ---------------------------------------------------------------------------
// CT-e ESPELHADO × TÍTULO A RECEBER
//
// As três regras abaixo são a conferência de CT-e (src/lib/controladoria/
// cte.ts) rodando sozinha, todo dia, sobre o que o painel do contador devolve
// — em vez de esperar alguém colar a lista. O casamento é a MESMA função da
// tela (`casarCtesComTitulos`), de propósito: a conferência à mão achou cinco
// cancelados com título vivo (R$ 164 mil) e quatro autorizados nunca cobrados,
// e o agente precisa reproduzir exatamente esse resultado, não uma variação.
//
// Ficam caladas quando não há CT-e no contexto: a conta pode não ter o painel
// do contador habilitado, e nesse caso ausência de CT-e é ausência de fonte,
// não achado. O supervisor registra o motivo.
// ---------------------------------------------------------------------------

// Dias depois da emissão para cobrar título: o faturamento do frete costuma
// sair no mesmo dia, mas o fechamento semanal de alguns clientes leva alguns.
const DIAS_PARA_TITULO_DO_CTE = 5;

// Divergência de valor que vira achado: mais de 1% E mais de R$ 10. O
// percentual absorve arredondamento de pedágio e reajuste de centavos; o piso
// evita apontar R$ 0,50 num frete de R$ 40.
const DIVERGENCIA_PERCENT = 0.01;
const DIVERGENCIA_MINIMA_CENTS = 1_000;

function regrasDeCte(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const ctes = ctx.ctes ?? [];
  if (ctes.length === 0) return [];

  const achados: AchadoNovo[] = [];
  const receber = titulosAtivos(ctx, "RECEBER");

  // Uma conexão de cada vez: a numeração de CT-e e de título é da conta, e um
  // CT-e 1284 da Azul não pode casar com o título 1284 da MCZ.
  for (const [conexaoId, ctesDaConexao] of agrupar(ctes, (c) => c.conexaoId)) {
    const titulos = receber
      .filter((t) => t.conexaoId === conexaoId)
      .map((t) => ({
        id: t.id,
        chaveNfe: t.chaveNfe,
        numero: t.numeroDocumento,
        data: t.dataEmissao ?? t.dataVencimento,
        valorCents: t.valorDocumentoCents,
        tipo: t.tipoDocumento,
        titulo: t,
      }));

    // Autorizados ANTES dos cancelados: um CT-e cancelado e reemitido com o
    // mesmo valor no mesmo dia é o caso comum, e o casamento fraco precisa
    // prender o título ao documento vivo. Denegado, devolvido e pendente não
    // entram — não são documento válido nem cancelamento.
    const autorizados = ctesDaConexao.filter((c) => !c.cancelado && cteAutorizado(c.status));
    const cancelados = ctesDaConexao.filter((c) => c.cancelado);
    const casaveis = [...autorizados, ...cancelados].map((c) => ({
      id: c.id,
      chave: c.chave,
      numero: c.numero,
      data: c.dataEmissao,
      valorCents: c.valorCents,
      cte: c,
    }));
    const casamentos = casarCtesComTitulos(casaveis, titulos);

    for (const c of cancelados) {
      const m = casamentos.get(c.id);
      // Só casamento FORTE (chave ou número) sustenta "cancelado com título":
      // por valor e data, um cancelado e o seu substituto são indistinguíveis.
      if (!m || m.como === "valor+data") continue;
      achados.push(cteCanceladoComTitulo(c, m.titulo.titulo, m.como, materialidade));
    }

    for (const c of autorizados) {
      const m = casamentos.get(c.id);
      if (!m) {
        if (diasEntre(c.dataEmissao, ctx.dataReferencia) >= DIAS_PARA_TITULO_DO_CTE) {
          achados.push(cteSemTitulo(ctx, c, materialidade));
        }
        continue;
      }
      if (m.como === "valor+data") continue; // valor exato por construção
      const t = m.titulo.titulo;
      const diferenca = Math.abs(t.valorDocumentoCents - c.valorCents);
      if (diferenca > DIVERGENCIA_MINIMA_CENTS && diferenca > Math.round(c.valorCents * DIVERGENCIA_PERCENT)) {
        achados.push(cteValorDivergente(ctx, c, t, m.como, materialidade));
      }
    }
  }
  return achados;
}

function rotuloCte(c: OmieCte): string {
  return `CT-e${c.modelo === "67" ? " OS" : ""} ${c.numero ?? c.chave} (${c.conexaoApelido})`;
}

function evidenciaCte(c: OmieCte): Record<string, unknown> {
  return {
    cte: c.numero,
    serie: c.serie,
    modelo: c.modelo,
    chave: c.chave,
    emissao: c.dataEmissao,
    valorCteCents: c.valorCents,
    status: c.status,
  };
}

// FI-CTE-CANCELADO-COM-TITULO — o documento fiscal foi cancelado e a cobrança
// continuou. É o padrão dos cinco casos da conferência à mão: CT-e cancelado e
// reemitido, título colado no morto — num deles o substituto saiu R$ 7.617,65
// mais barato e o título ficou com o valor antigo.
function cteCanceladoComTitulo(c: OmieCte, t: OmieTitulo, como: string, materialidade: number): AchadoNovo {
  return {
    regra: "FI-CTE-CANCELADO-COM-TITULO",
    tipo: "EVENTO",
    severidade: severidadePorValor(t.valorDocumentoCents, materialidade),
    categoria: "CONFORMIDADE",
    titulo: `${rotuloCte(c)} cancelado, mas o título de ${fmtBRL(t.valorDocumentoCents)} continua ativo`,
    descricao:
      `O ${rotuloCte(c)}, emitido em ${fmtData(c.dataEmissao)} por ${fmtBRL(c.valorCents)}, está cancelado — e o título ` +
      `${refTitulo(t)}, de ${fmtBRL(t.valorDocumentoCents)} para ${t.parceiroNome ?? "cliente não identificado"}, ` +
      `segue ${t.liquidado ? "recebido" : "em aberto"} com esse documento (casado por ${como}). Cobrança sem documento ` +
      `fiscal válido: o cliente contesta, e se pagou, pagou sem CT-e.`,
    recomendacao:
      "Localizar o CT-e substituto e religar o título a ele — conferindo o valor, que no substituto pode ter mudado. " +
      "Se não houve reemissão, cancelar o título.",
    valorCents: t.valorDocumentoCents,
    dataReferencia: c.dataEmissao,
    entidadeTipo: "OmieTitulo",
    entidadeId: t.id,
    entidadeRef: rotuloCte(c),
    evidencia: { ...evidenciaCte(c), titulo: t.codigoLancamento, valorTituloCents: t.valorDocumentoCents, casadoPor: como },
    chave: chaveAchado("FI-CTE-CANCELADO-COM-TITULO", c.conexaoApelido, c.chave),
  };
}

// FI-CTE-SEM-TITULO — frete documentado, imposto devido, ninguém cobrou. Um
// achado por CT-e, e não agregado por mês como a NFS-e: cada frete é grande o
// bastante para ser tratado sozinho, e o mais antigo da conferência à mão
// estava parado desde abril.
function cteSemTitulo(ctx: ContextoAuditoria, c: OmieCte, materialidade: number): AchadoNovo {
  return {
    regra: "FI-CTE-SEM-TITULO",
    tipo: "ESTADO",
    severidade: severidadePorValor(c.valorCents, materialidade),
    categoria: "PERDA_FINANCEIRA",
    titulo: `${rotuloCte(c)} de ${fmtBRL(c.valorCents)} sem título a receber`,
    descricao:
      `O ${rotuloCte(c)}, autorizado em ${fmtData(c.dataEmissao)} por ${fmtBRL(c.valorCents)}, não tem título a receber ` +
      `correspondente — nem pela chave de acesso, nem pelo número, nem por valor e data (±7 dias) — passados ` +
      `${diasEntre(c.dataEmissao, ctx.dataReferencia)} dias. Documento emitido e frete prestado sem cobrança registrada.`,
    recomendacao:
      "Gerar o título a receber do CT-e e enviar a fatura. Se o título existe com outro valor ou sem número, " +
      "preencher o número do documento no título para o cruzamento reconhecê-lo.",
    valorCents: c.valorCents,
    impactoCents: c.valorCents,
    dataReferencia: ctx.dataReferencia,
    entidadeTipo: "OmieCte",
    entidadeId: c.id,
    entidadeRef: rotuloCte(c),
    evidencia: { ...evidenciaCte(c), diasDesdeEmissao: diasEntre(c.dataEmissao, ctx.dataReferencia) },
    chave: chaveAchado("FI-CTE-SEM-TITULO", c.conexaoApelido, c.chave),
  };
}

// FI-CTE-VALOR-DIVERGENTE — o título casou com o CT-e (por chave ou número)
// mas cobra outro valor. Acima do documento é cobrança que ele não autoriza;
// abaixo é receita que ficou na mesa.
function cteValorDivergente(ctx: ContextoAuditoria, c: OmieCte, t: OmieTitulo, como: string, materialidade: number): AchadoNovo {
  const diferenca = t.valorDocumentoCents - c.valorCents;
  return {
    regra: "FI-CTE-VALOR-DIVERGENTE",
    tipo: "ESTADO",
    severidade: severidadePorValor(diferenca, materialidade),
    categoria: "ERRO_PROCESSO",
    titulo: `${rotuloCte(c)}: título ${diferenca > 0 ? "acima" : "abaixo"} do documento em ${fmtBRL(Math.abs(diferenca))}`,
    descricao:
      `O ${rotuloCte(c)} foi autorizado por ${fmtBRL(c.valorCents)} e o título ${refTitulo(t)} (casado por ${como}) ` +
      `cobra ${fmtBRL(t.valorDocumentoCents)} — diferença de ${fmtBRL(Math.abs(diferenca))}` +
      (diferenca > 0
        ? ", acima do que o documento fiscal autoriza."
        : ", abaixo do frete documentado."),
    recomendacao:
      diferenca > 0
        ? "Ajustar o título ao valor do CT-e ou emitir CT-e complementar. Cobrar acima do documento é o que o cliente glosa primeiro."
        : "Conferir se houve desconto acordado; sem acordo, emitir o complemento da cobrança.",
    valorCents: Math.abs(diferenca),
    impactoCents: diferenca < 0 ? Math.abs(diferenca) : undefined,
    dataReferencia: ctx.dataReferencia,
    entidadeTipo: "OmieTitulo",
    entidadeId: t.id,
    entidadeRef: rotuloCte(c),
    evidencia: { ...evidenciaCte(c), titulo: t.codigoLancamento, valorTituloCents: t.valorDocumentoCents, diferencaCents: diferenca, casadoPor: como },
    chave: chaveAchado("FI-CTE-VALOR-DIVERGENTE", c.conexaoApelido, c.chave),
  };
}

// FI-DOC-SEM-NUMERO — titulo de documento fiscal sem o numero preenchido.
//
// Nasceu de uma conferencia a mao: 24 de 56 titulos de CT-e estavam sem o
// numero do documento na Omie, e a proporcao piorava mes a mes — de nenhum em
// abril para todos em agosto. Ninguem tinha notado, porque nada olhava.
//
// O custo nao e de arrumacao. Sem o numero, nao ha como ligar a cobranca ao
// documento fiscal que a autoriza, e e exatamente esse elo que responde as tres
// perguntas caras: o documento foi cancelado e a cobranca continuou? o frete
// foi emitido e nunca virou fatura? o valor cobrado e o mesmo que o documento
// autoriza? Sem numero, a conferencia cai no casamento por valor e data — que
// nao distingue dois fretes de mesmo valor no mesmo dia, caso real desta base.
//
// AGRUPADO POR TIPO DE DOCUMENTO, e nao um achado por titulo: sao dezenas por
// mes, e trinta achados iguais afogam o resto do relatorio. Um achado por tipo
// diz o tamanho do problema e deixa a lista na evidencia.
function documentoSemNumero(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  // Mes fechado anterior, como nas demais regras deste agente: o mes corrente
  // ainda esta sendo lancado, e apontar titulo recem-criado sem numero seria
  // alarme diario contra trabalho em andamento.
  const inicio = inicioDoMes(new Date(ctx.dataReferencia.getFullYear(), ctx.dataReferencia.getMonth() - 1, 1));
  const fim = new Date(ctx.dataReferencia.getFullYear(), ctx.dataReferencia.getMonth(), 0, 23, 59, 59, 999);
  if (fim < inicio) return [];

  const semNumero = titulosAtivos(ctx, "RECEBER").filter((t) => {
    const competencia = t.dataEmissao ?? t.dataVencimento;
    if (competencia < inicio || competencia > fim) return false;
    // So onde a falta significa alguma coisa: titulo sem TIPO de documento
    // tambem nao tem numero a preencher, e cobrar numero dele seria ruido.
    if ((t.tipoDocumento ?? "").trim() === "") return false;
    return !/\d/.test(t.numeroDocumento ?? "");
  });
  if (semNumero.length === 0) return [];

  const achados: AchadoNovo[] = [];
  for (const [tipo, grupo] of agrupar(semNumero, (t) => (t.tipoDocumento ?? "").trim().toUpperCase())) {
    const valor = somar(grupo, (t) => t.valorDocumentoCents);
    // Um titulo isolado sem numero e digitacao; um punhado repetido e processo
    // quebrado. O corte por materialidade sozinho deixaria passar um tipo
    // inteiro de documento com valores pequenos — por isso ele OU a contagem.
    if (valor < materialidade && grupo.length < 3) continue;

    achados.push({
      regra: "FI-DOC-SEM-NUMERO",
      tipo: "ESTADO",
      severidade: severidadePorValor(valor, materialidade),
      categoria: "CONFORMIDADE",
      titulo: `${grupo.length} título(s) de ${tipo} sem o número do documento fiscal`,
      descricao:
        `Entre ${fmtData(inicio)} e ${fmtData(fim)}, ${grupo.length} título(s) do tipo ${tipo}, somando ` +
        `${fmtBRL(valor)}, estão sem o número do documento preenchido na Omie. Sem esse número não há como ligar a ` +
        `cobrança ao documento fiscal que a autoriza — é o elo que mostra documento cancelado ainda sendo cobrado, ` +
        `documento emitido que nunca virou fatura e valor cobrado diferente do autorizado.`,
      recomendacao:
        `Preencher o número do documento nos títulos listados. Se a falta for recorrente neste tipo, o ajuste é no ` +
        `processo de faturamento, não título a título. A tela "Conferência de CT-e" mostra o efeito disso: sem o ` +
        `número, o cruzamento cai no casamento por valor e data.`,
      dataReferencia: ctx.dataReferencia,
      evidencia: {
        tipoDocumento: tipo,
        quantidade: grupo.length,
        valorCents: valor,
        // Vinte basta para conferir na Omie sem transformar a evidencia num
        // despejo do banco.
        titulos: grupo.slice(0, 20).map((t) => ({
          codigoLancamento: t.codigoLancamento,
          parceiro: t.parceiroNome,
          emissao: t.dataEmissao ?? t.dataVencimento,
          valorCents: t.valorDocumentoCents,
        })),
      },
      chave: chaveAchado("FI-DOC-SEM-NUMERO", tipo, chaveMes(ctx.dataReferencia)),
    });
  }
  return achados;
}

// FI-NOTA-CANCELADA — nota cancelada, mas o titulo a receber continua vivo.
// Cobranca de servico que fiscalmente nao existe: o cliente nao vai pagar (ou
// pagou sem nota, o que e pior).
function notaCanceladaComTitulo(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const canceladas = ctx.notas.filter((n) => n.cancelada);
  if (canceladas.length === 0) return [];

  const achados: AchadoNovo[] = [];
  const receberPorNumero = agrupar(
    titulosAtivos(ctx, "RECEBER").filter((t) => t.numeroDocumento !== null),
    (t) => t.numeroDocumento as string
  );
  for (const nota of canceladas) {
    const titulos = nota.numero !== null ? (receberPorNumero.get(nota.numero) ?? []) : [];
    if (titulos.length === 0) continue;

    const valor = somar(titulos, (t) => t.valorDocumentoCents);
    // NF-e (produto) numa empresa de serviço: as notas 251 e 252, para uma
    // distribuidora de autopeças e uma concessionária, são devolução ou
    // remessa de peça — não receita. O título a receber que ficou é resto do
    // cancelamento e deve ser cancelado; "reemitir a nota" e "omissão de
    // receita" só fazem sentido para NFS-e de serviço prestado.
    const nfeDeProduto = nota.tipo !== "NFSE";
    achados.push({
      regra: "FI-NOTA-CANCELADA",
      tipo: "ESTADO",
      severidade: severidadePorValor(valor, materialidade),
      categoria: "CONFORMIDADE",
      titulo: `Nota ${nota.numero} cancelada, mas o título continua ativo`,
      descricao:
        `A ${nota.tipo === "NFSE" ? "NFS-e" : "NF-e"} nº ${nota.numero}, emitida em ${fmtData(nota.dataEmissao)} ` +
        `para ${nota.parceiroNome ?? "cliente não identificado"}, está cancelada — mas ${titulos.length} título(s) ` +
        `a receber somando ${fmtBRL(valor)} seguem ativos com esse número de documento.` +
        (nfeDeProduto
          ? " NF-e de produto numa empresa de serviço costuma ser devolução ou remessa de peça, não receita: o título é resto do cancelamento."
          : ""),
      recomendacao: nfeDeProduto
        ? "Cancelar o título a receber na Omie. Se a devolução ou remessa precisa de nota válida, emitir nova NF-e sem gerar título financeiro."
        : "Cancelar o título correspondente ou reemitir a nota. Se o serviço foi prestado e o cliente pagou, " +
          "a nota precisa ser reemitida — receita sem nota é omissão de receita, não apenas falha de controle.",
      valorCents: valor,
      dataReferencia: nota.dataEmissao,
      entidadeTipo: "OmieNota",
      entidadeId: nota.id,
      entidadeRef: `Nota ${nota.numero}`,
      evidencia: { nota: nota.numero, tipo: nota.tipo, titulos: titulos.map((t) => t.codigoLancamento), valor },
      chave: chaveAchado("FI-NOTA-CANCELADA", nota.chave),
    });
  }
  return achados;
}

// FI-RECEITA-SEM-NOTA — comparacao agregada por mes entre receita faturada
// (titulos a receber) e notas emitidas. Agregado, e nao titulo a titulo,
// porque o vinculo nota-titulo na Omie e frouxo: cruzar por numero geraria
// falso positivo em massa. A diferenca de TOTAL, sim, e um sinal solido.
const TOLERANCIA_RECEITA_NOTA_PERCENT = 10;

function receitaSemNota(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  // Mes fechado anterior: o mes corrente sempre tem defasagem natural entre
  // faturar e emitir, e apontar isso todo dia seria alarme falso diario.
  const inicio = inicioDoMes(new Date(ctx.dataReferencia.getFullYear(), ctx.dataReferencia.getMonth() - 1, 1));
  const fim = new Date(ctx.dataReferencia.getFullYear(), ctx.dataReferencia.getMonth(), 0, 23, 59, 59, 999);
  if (fim < inicio) return [];

  const titulos = titulosAtivos(ctx, "RECEBER").filter(
    (t) => (t.dataEmissao ?? t.dataVencimento) >= inicio && (t.dataEmissao ?? t.dataVencimento) <= fim
  );
  const notas = ctx.notas.filter((n) => !n.cancelada && n.dataEmissao >= inicio && n.dataEmissao <= fim);
  if (titulos.length === 0 || notas.length < MINIMO_NOTAS_PARA_ANALISE) return [];

  const totalTitulos = somar(titulos, (t) => t.valorDocumentoCents);
  const totalNotas = somar(notas, (n) => n.valorCents);
  const diferenca = totalTitulos - totalNotas;
  if (diferenca <= 0) return [];

  const percentual = (diferenca / totalTitulos) * 100;
  if (percentual < TOLERANCIA_RECEITA_NOTA_PERCENT || diferenca < materialidade) return [];

  return [
    {
      regra: "FI-RECEITA-SEM-NOTA",
      tipo: "ESTADO",
      severidade: severidadePorValor(diferenca, materialidade),
      categoria: "CONFORMIDADE",
      titulo: `${fmtBRL(diferenca)} faturados a mais do que o total de notas emitidas`,
      descricao:
        `No mês fechado anterior, os títulos a receber somam ${fmtBRL(totalTitulos)} e as notas emitidas somam ` +
        `${fmtBRL(totalNotas)} — diferença de ${fmtPercent(percentual)}. Ou faltam notas, ou há títulos lançados ` +
        `sem fato gerador, ou parte do faturamento é de outra natureza (reembolso, repasse).`,
      recomendacao:
        "Levantar com a contabilidade a origem da diferença antes do fechamento fiscal do mês. " +
        "Receita registrada sem nota correspondente é o achado que mais gera autuação em fiscalização de transporte.",
      valorCents: diferenca,
      dataReferencia: fim,
      evidencia: { totalTitulos, totalNotas, diferenca, percentual, titulos: titulos.length, notas: notas.length },
      chave: chaveAchado("FI-RECEITA-SEM-NOTA", chaveMes(fim)),
    },
  ];
}

// FI-NOTA-SEM-TITULO — o inverso: nota emitida sem nenhum titulo a receber
// correspondente. Servico prestado, imposto devido, e ninguem vai cobrar.
function notaSemTitulo(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const inicio = inicioDoMes(new Date(ctx.dataReferencia.getFullYear(), ctx.dataReferencia.getMonth() - 1, 1));
  const notas = ctx.notas.filter((n) => !n.cancelada && n.dataEmissao >= inicio && n.dataEmissao <= ctx.dataReferencia);
  if (notas.length === 0) return [];

  const receber = titulosAtivos(ctx, "RECEBER");
  const numerosDeTitulo = new Set(receber.map((t) => t.numeroDocumento).filter((n): n is string => n !== null));
  const valoresPorParceiro = agrupar(receber.filter((t) => t.parceiroCodigo), (t) => t.parceiroCodigo as string);
  const orfas = notas.filter((n) => {
    if (n.numero && numerosDeTitulo.has(n.numero)) return false;
    // Sem numero em comum, tenta casar por cliente e valor exato — o
    // casamento frouxo evita apontar nota que so foi lancada com outro
    // numero de documento.
    return !(n.parceiroCodigo ? (valoresPorParceiro.get(n.parceiroCodigo) ?? []) : []).some(
      (t) => Math.abs(t.valorDocumentoCents - n.valorCents) <= 100
    );
  });
  if (orfas.length === 0) return [];

  const valor = somar(orfas, (n) => n.valorCents);
  if (valor < materialidade) return [];

  return [
    {
      regra: "FI-NOTA-SEM-TITULO",
      tipo: "ESTADO",
      severidade: severidadePorValor(valor, materialidade),
      categoria: "PERDA_FINANCEIRA",
      titulo: `${orfas.length} notas emitidas sem título a receber`,
      descricao:
        `${fmtBRL(valor)} em notas emitidas não têm título a receber correspondente. O imposto foi gerado, ` +
        `o serviço foi prestado — mas não existe cobrança registrada. É receita que pode simplesmente nunca entrar.`,
      recomendacao:
        "Gerar os títulos a receber dessas notas e conferir se os boletos foram enviados aos clientes. " +
        "Sendo notas de devolução ou substituição, confirmar com a contabilidade e ajustar.",
      valorCents: valor,
      impactoCents: valor,
      dataReferencia: ctx.dataReferencia,
      evidencia: {
        notas: orfas.slice(0, 50).map((n) => ({
          numero: n.numero,
          cliente: n.parceiroNome,
          valor: n.valorCents,
          emissao: n.dataEmissao.toISOString(),
        })),
        quantidade: orfas.length,
      },
      chave: chaveAchado("FI-NOTA-SEM-TITULO", chaveMes(ctx.dataReferencia)),
    },
  ];
}

// FI-CARGA-TRIBUTARIA — carga efetiva sobre o faturamento do ano contra a
// faixa esperada para o Lucro Presumido. Serve tanto para achar imposto pago
// a MAIS (dinheiro recuperavel) quanto a MENOS (risco de autuacao) — os dois
// sao achados legitimos, e o segundo costuma ser o unico que alguem procura.
function cargaTributaria(ctx: ContextoAuditoria): AchadoNovo[] {
  const inicio = inicioDoAno(ctx.dataReferencia);
  const notas = ctx.notas.filter((n) => !n.cancelada && n.dataEmissao >= inicio);
  if (notas.length < MINIMO_NOTAS_PARA_ANALISE) return [];

  const faturamento = somar(notas, (n) => n.valorCents);
  if (faturamento <= 0) return [];

  const pisCofins = somar(notas, (n) => (n.valorPisCents ?? 0) + (n.valorCofinsCents ?? 0));
  const iss = somar(notas, (n) => n.valorIssCents ?? 0);
  const percentualPisCofins = (pisCofins / faturamento) * 100;
  const percentualIss = (iss / faturamento) * 100;

  const achados: AchadoNovo[] = [];

  // PIS/COFINS: no presumido o percentual e fixo (0,65% + 3%), entao qualquer
  // desvio relevante e erro de calculo ou de preenchimento da nota.
  if (pisCofins > 0) {
    const desvio = percentualPisCofins - REFERENCIA_PRESUMIDO.pisCofinsPercent;
    if (Math.abs(desvio) > 0.5) {
      const valorDesvio = Math.round((Math.abs(desvio) / 100) * faturamento);
      achados.push({
        regra: "FI-PIS-COFINS",
        tipo: "ESTADO",
        severidade: "MEDIA",
        categoria: "CONFORMIDADE",
        titulo: `PIS/COFINS em ${fmtPercent(percentualPisCofins)} do faturamento (esperado ${fmtPercent(
          REFERENCIA_PRESUMIDO.pisCofinsPercent
        )})`,
        descricao:
          `Sobre ${fmtBRL(faturamento)} faturados no ano, as notas destacam ${fmtBRL(pisCofins)} de PIS/COFINS. ` +
          `No Lucro Presumido a alíquota cumulativa é de 3,65% — o desvio de ${fmtPercent(Math.abs(desvio))} ` +
          `equivale a ${fmtBRL(valorDesvio)} ${desvio > 0 ? "pagos a mais" : "a menos"} do que a referência.`,
        recomendacao:
          desvio > 0
            ? "Conferir com a contabilidade se há retenção na fonte sendo somada indevidamente ao destaque. Imposto pago a maior nos últimos 5 anos é passível de restituição/compensação."
            : "Conferir se todas as notas tiveram os tributos destacados corretamente — diferença a menor vira débito com multa e juros na fiscalização.",
        valorCents: valorDesvio,
        impactoCents: desvio > 0 ? valorDesvio : undefined,
        dataReferencia: ctx.dataReferencia,
        evidencia: { faturamento, pisCofins, percentual: percentualPisCofins, referencia: REFERENCIA_PRESUMIDO.pisCofinsPercent },
        chave: chaveAchado("FI-PIS-COFINS", String(ctx.dataReferencia.getFullYear())),
      });
    }
  }

  // ISS: faixa larga (2% a 5%, LC 116/2003) porque depende do municipio; so
  // sai da faixa e que vira achado.
  if (iss > 0 && (percentualIss < REFERENCIA_PRESUMIDO.issMinPercent || percentualIss > REFERENCIA_PRESUMIDO.issMaxPercent)) {
    achados.push({
      regra: "FI-ISS",
      tipo: "ESTADO",
      severidade: "BAIXA",
      categoria: "CONFORMIDADE",
      titulo: `ISS efetivo em ${fmtPercent(percentualIss)} — fora da faixa legal de 2% a 5%`,
      descricao:
        `As notas de serviço do ano destacam ${fmtBRL(iss)} de ISS sobre ${fmtBRL(faturamento)} faturados. ` +
        `A LC 116/2003 fixa o piso de 2% e o teto de 5% — um efetivo fora dessa faixa costuma indicar notas sem ISS ` +
        `destacado (fretamento intermunicipal, que é ICMS, e não ISS) misturadas às de serviço municipal.`,
      recomendacao:
        "Separar o faturamento por tipo de operação (municipal x intermunicipal) antes de concluir. " +
        "Persistindo a diferença dentro do serviço municipal, revisar a alíquota aplicada com a contabilidade.",
      valorCents: iss,
      dataReferencia: ctx.dataReferencia,
      evidencia: { faturamento, iss, percentual: percentualIss },
      chave: chaveAchado("FI-ISS", String(ctx.dataReferencia.getFullYear())),
    });
  }

  return achados;
}

// ---------------------------------------------------------------------------
// O QUE O RELATÓRIO DE CONFORMIDADE FISCAL DA CONSULTORIA CONFERE TODO MÊS
//
// O relatório de 17/09/2026 (Azul, jan–jul/26) faz duas contas que o espelho
// da Omie permite refazer sozinho, todo dia, sem esperar o PDF:
//
//   1. ISS apurado (total de serviços × alíquota) contra a GUIA paga. Em
//      março a guia saiu R$ 206 abaixo do apurado; em abril, R$ 1.237. É
//      pouco, e é exatamente o tipo de diferença que vira auto de infração
//      com multa de 20% e juros quando o município cruza a NFS-e com o
//      recolhimento — e que ninguém percebe sem somar.
//
//   2. Produto cadastrado como "Tipo 00 — Mercadoria para Revenda" numa
//      empresa que não vende mercadoria. A consultoria classificou o risco
//      do Bloco K como altíssimo: o cruzamento automatizado do fisco lê isso
//      como omissão de receita ou fraude na produção. O tipo do item mora no
//      cadastro de produtos, que o espelho não tem; o que o espelho tem é a
//      NF-e emitida com o CFOP de cada item — e CFOP de VENDA de mercadoria
//      (5101/5102/6101/6102 e a família de ST) numa transportadora é o mesmo
//      sintoma visto pela nota, não pelo cadastro.
// ---------------------------------------------------------------------------

// Categoria de título que é recolhimento de ISS. Pela descrição da categoria
// (ou do título), porque a Omie não tem "tipo de tributo": "ISS", "ISSQN",
// "Imposto sobre serviços". "ISS retido" fica de fora — é o ISS que a empresa
// reteve de terceiros, outra conta.
const PADRAO_CATEGORIA_ISS = /\b(iss|issqn)\b|imposto sobre servi/i;
const PADRAO_ISS_RETIDO = /retid/i;

// Diferença que vira achado: pelo menos R$ 100 E 0,1% do apurado. O piso
// absorve arredondamento de guia (a consultoria viu R$ 0,13 a R$ 0,16 em
// três meses e não apontou); o percentual só importa em guia muito grande.
// Os R$ 206 de março que a consultoria apontou passam — é a referência.
const ISS_TOLERANCIA_PERCENT = 0.001;
const ISS_DIFERENCA_MINIMA_CENTS = 100_00;

function ehTituloDeIss(t: OmieTitulo, categorias: Map<string, string>): boolean {
  const descricao = `${t.categoriaDescricao ?? ""} ${categorias.get(t.categoriaCodigo ?? "") ?? ""}`;
  if (PADRAO_ISS_RETIDO.test(descricao)) return false;
  return PADRAO_CATEGORIA_ISS.test(descricao);
}

function mesSeguinte(chaveMesAno: string): string {
  const [ano, mes] = chaveMesAno.split("-").map(Number);
  const d = new Date(ano, mes, 1); // mes é 1-based na chave; Date usa 0-based → já é o seguinte
  return chaveMes(d);
}

// FI-ISS-RECOLHIDO-A-MENOR — por competência fechada: ISS destacado nas
// NFS-e sem retenção contra os títulos de ISS pagos ou a pagar com vencimento
// no mês seguinte (a guia do serviço de março vence em abril).
//
// Cala quando: não há NFS-e com ISS no mês; ou a base não tem NENHUM título
// de ISS na janela (a categoria pode ter outro nome — apontar "guia zero"
// nesse caso seria acusar a categoria, não o recolhimento); ou o mês ainda
// não fechou.
function issRecolhidoAMenor(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const categorias = new Map(ctx.categorias.map((c) => [c.codigo, c.descricao]));
  const titulosIss = titulosAtivos(ctx, "PAGAR").filter((t) => ehTituloDeIss(t, categorias));
  if (titulosIss.length === 0) return [];

  const mesAtual = chaveMes(inicioDoMes(ctx.dataReferencia));
  const notas = ctx.notas.filter(
    (n) => n.tipo === "NFSE" && !n.cancelada && n.issRetido !== true && (n.valorIssCents ?? 0) > 0
  );
  const porMes = agrupar(notas, (n) => chaveMes(n.dataEmissao));
  const guiasPorVencimento = agrupar(titulosIss, (t) => chaveMes(t.dataVencimento));

  const achados: AchadoNovo[] = [];
  for (const [mes, notasDoMes] of porMes) {
    // Só competência FECHADA: as notas do mês corrente ainda estão sendo
    // emitidas e a guia ainda não venceu.
    if (mes >= mesAtual) continue;
    const apurado = somar(notasDoMes, (n) => n.valorIssCents ?? 0);
    const guias = guiasPorVencimento.get(mesSeguinte(mes)) ?? [];
    // A guia que ainda não venceu não é "a menor" — é "a pagar".
    const vencimentoDaGuia = new Date(Number(mesSeguinte(mes).slice(0, 4)), Number(mesSeguinte(mes).slice(5, 7)), 0);
    if (vencimentoDaGuia >= ctx.dataReferencia) continue;
    const recolhido = somar(guias, (t) => t.valorDocumentoCents);
    const diferenca = apurado - recolhido;
    if (diferenca < ISS_DIFERENCA_MINIMA_CENTS || diferenca < apurado * ISS_TOLERANCIA_PERCENT) continue;

    achados.push({
      regra: "FI-ISS-RECOLHIDO-A-MENOR",
      tipo: "EVENTO",
      severidade: severidadePorValor(diferenca, materialidade),
      categoria: "CONFORMIDADE",
      titulo: `ISS de ${mes}: ${fmtBRL(recolhido)} recolhido contra ${fmtBRL(apurado)} destacado nas notas`,
      descricao:
        `As ${notasDoMes.length} NFS-e de ${mes} sem ISS retido destacam ${fmtBRL(apurado)} de ISS. ` +
        `Os títulos de ISS com vencimento em ${mesSeguinte(mes)} somam ${fmtBRL(recolhido)}` +
        (guias.length === 0 ? " (nenhum título de ISS encontrado para esse vencimento)" : ` (${guias.length} título(s))`) +
        `. Faltam ${fmtBRL(diferenca)}. O município cruza a NFS-e com o recolhimento; diferença a menor vira ` +
        `auto de infração com multa e juros, e é o que o relatório de conformidade fiscal aponta mês a mês.`,
      recomendacao:
        "Conferir com a contabilidade a guia do mês: se houve nota substituída ou cancelada depois da apuração, " +
        "documentar; se a guia saiu a menor, recolher a diferença por guia complementar antes de qualquer " +
        "cruzamento. Se o ISS desse mês foi pago sob outra categoria na Omie, reclassificar o título.",
      valorCents: diferenca,
      impactoCents: diferenca,
      dataReferencia: notasDoMes[0].dataEmissao,
      evidencia: {
        competencia: mes,
        vencimentoDaGuia: mesSeguinte(mes),
        notas: notasDoMes.length,
        issApurado: apurado,
        issRecolhido: recolhido,
        diferenca,
        titulosDeIss: guias.map((t) => ({ ref: refTitulo(t), valor: t.valorDocumentoCents, vencimento: fmtData(t.dataVencimento), status: t.status })),
      },
      chave: chaveAchado("FI-ISS-RECOLHIDO-A-MENOR", mes),
    });
  }
  return achados;
}

// CFOP de VENDA de mercadoria (dentro e fora do estado, própria e com ST).
// Remessa (5949/6949), devolução (5202/6202), venda de ativo (5551/6551),
// transferência (5152/6152) e serviço de transporte (5351–5360/6351–6360)
// NÃO estão aqui: são as saídas normais de uma transportadora.
const CFOP_VENDA_MERCADORIA = /^(5101|5102|5103|5104|5105|5106|5109|5110|5111|5112|5113|5114|5115|5116|5117|5118|5119|5120|5401|5402|5403|5405|6101|6102|6103|6104|6105|6106|6107|6108|6109|6110|6111|6112|6113|6114|6115|6116|6117|6118|6119|6120|6401|6402|6403|6404)$/;

// FI-NFE-VENDA-MERCADORIA — NF-e emitida com CFOP de venda de mercadoria,
// por mês. Um achado por mês, com a lista das notas.
function nfeDeVendaDeMercadoria(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const notas = ctx.notas.filter((n) => n.tipo === "NFE" && !n.cancelada && n.cfop && CFOP_VENDA_MERCADORIA.test(n.cfop));
  if (notas.length === 0) return [];
  const achados: AchadoNovo[] = [];
  for (const [mes, doMes] of agrupar(notas, (n) => chaveMes(n.dataEmissao))) {
    const total = somar(doMes, (n) => n.valorCents);
    const cfops = [...new Set(doMes.map((n) => n.cfop))].join(", ");
    achados.push({
      regra: "FI-NFE-VENDA-MERCADORIA",
      tipo: "EVENTO",
      // Não é dinheiro saindo: é exposição fiscal. Fica em MÉDIA quando o
      // volume é material, BAIXA abaixo disso — e só sobe na mão de quem
      // souber que o item está mesmo como "mercadoria para revenda".
      severidade: total >= materialidade ? "MEDIA" : "BAIXA",
      categoria: "CONFORMIDADE",
      titulo: `${doMes.length} NF-e de venda de mercadoria em ${mes} (CFOP ${cfops}), ${fmtBRL(total)}`,
      descricao:
        `Em ${mes} a empresa emitiu ${doMes.length} NF-e com CFOP de venda de mercadoria (${cfops}), somando ${fmtBRL(total)}. ` +
        `Transportadora de passageiros não revende mercadoria: o item por trás dessas notas provavelmente está ` +
        `cadastrado na Omie como "Tipo 00 — Mercadoria para Revenda", e é exatamente o que a consultoria fiscal ` +
        `apontou como risco altíssimo no Bloco K — o cruzamento automatizado do fisco lê isso como omissão de ` +
        `receita ou fraude na produção. Venda de combustível, sucata ou ativo tem CFOP e tipo de item próprios.`,
      recomendacao:
        "Abrir na Omie o cadastro do produto de cada nota e conferir o Tipo do Item: o que não é revenda deve estar " +
        "como 'Outros insumos', 'Ativo imobilizado' ou 'Material de uso e consumo', com o CFOP de saída " +
        "correspondente. Corrigir o cadastro para as próximas emissões e avisar a contabilidade sobre as já emitidas.",
      valorCents: total,
      dataReferencia: doMes[0].dataEmissao,
      evidencia: {
        competencia: mes,
        quantidade: doMes.length,
        total,
        notas: doMes.slice(0, 20).map((n) => ({ numero: n.numero, serie: n.serie, cfop: n.cfop, emissao: fmtData(n.dataEmissao), valor: n.valorCents, destinatario: n.parceiroNome })),
      },
      chave: chaveAchado("FI-NFE-VENDA-MERCADORIA", mes),
    });
  }
  return achados;
}

// FI-SEQUENCIA — buraco na numeracao das notas emitidas. Nota que some da
// sequencia sem estar cancelada e um dos primeiros itens de qualquer
// fiscalizacao, e frequentemente e so uma nota inutilizada que ninguem
// registrou.
function falhaNaSequencia(ctx: ContextoAuditoria): AchadoNovo[] {
  const inicio = inicioDoMes(new Date(ctx.dataReferencia.getFullYear(), ctx.dataReferencia.getMonth() - 1, 1));
  const recentes = ctx.notas.filter((n) => n.dataEmissao >= inicio && n.numero !== null);
  const porSerie = agrupar(recentes, (n) => `${n.tipo}:${n.serie ?? "-"}`);

  const achados: AchadoNovo[] = [];
  for (const [serie, grupo] of porSerie) {
    const numeros = grupo
      .map((n) => Number(n.numero))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    if (numeros.length < MINIMO_NOTAS_PARA_ANALISE) continue;

    const faltantes: number[] = [];
    for (let i = 1; i < numeros.length; i++) {
      for (let n = numeros[i - 1] + 1; n < numeros[i]; n++) {
        faltantes.push(n);
        // Um buraco enorme quase sempre e mudanca de faixa de numeracao, nao
        // nota sumida — e listar milhares de numeros nao ajuda ninguem.
        if (faltantes.length > 50) break;
      }
      if (faltantes.length > 50) break;
    }
    if (faltantes.length === 0 || faltantes.length > 50) continue;

    achados.push({
      regra: "FI-SEQUENCIA",
      tipo: "ESTADO",
      severidade: "BAIXA",
      categoria: "CONFORMIDADE",
      titulo: `${faltantes.length} número(s) faltando na sequência de notas (${serie})`,
      descricao:
        `Na série ${serie}, os números ${faltantes.slice(0, 10).join(", ")}${
          faltantes.length > 10 ? "..." : ""
        } não aparecem entre ${numeros[0]} e ${numeros[numeros.length - 1]}, e não constam como cancelados na base.`,
      recomendacao:
        "Verificar na Omie/SEFAZ se são notas inutilizadas, denegadas ou canceladas fora do sistema. " +
        "Toda nota da sequência precisa ter destino documentado — é item padrão de fiscalização.",
      dataReferencia: ctx.dataReferencia,
      evidencia: { serie, faltantes: faltantes.slice(0, 50), de: numeros[0], ate: numeros[numeros.length - 1] },
      chave: chaveAchado("FI-SEQUENCIA", serie, chaveMes(ctx.dataReferencia)),
    });
  }
  return achados;
}

export { REFERENCIA_PRESUMIDO };
