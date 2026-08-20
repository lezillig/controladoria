import { fmtBRL, fmtData, fmtPercent } from "../format";
import { inicioDoAno, inicioDoMes } from "../periodos";
import type { AchadoNovo, Agente, ContextoAuditoria } from "../types";
import { agrupar, chaveAchado, chaveMes, materialidadeCents, severidadePorValor, somar, titulosAtivos } from "./comum";

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
    "Confronta notas fiscais e títulos: receita sem nota, nota sem título, notas canceladas com título ativo, carga tributária efetiva fora da faixa esperada para o Lucro Presumido e falhas na sequência de numeração.",
  executar: auditarFiscal,
};

function auditarFiscal(ctx: ContextoAuditoria): AchadoNovo[] {
  const achados: AchadoNovo[] = [];
  const materialidade = materialidadeCents(ctx);

  achados.push(...notaCanceladaComTitulo(ctx, materialidade));
  achados.push(...receitaSemNota(ctx, materialidade));
  achados.push(...notaSemTitulo(ctx, materialidade));
  achados.push(...cargaTributaria(ctx));
  achados.push(...falhaNaSequencia(ctx));

  return achados;
}

// FI-NOTA-CANCELADA — nota cancelada, mas o titulo a receber continua vivo.
// Cobranca de servico que fiscalmente nao existe: o cliente nao vai pagar (ou
// pagou sem nota, o que e pior).
function notaCanceladaComTitulo(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const canceladas = ctx.notas.filter((n) => n.cancelada);
  if (canceladas.length === 0) return [];

  const achados: AchadoNovo[] = [];
  for (const nota of canceladas) {
    const titulos = titulosAtivos(ctx, "RECEBER").filter(
      (t) => t.numeroDocumento !== null && nota.numero !== null && t.numeroDocumento === nota.numero
    );
    if (titulos.length === 0) continue;

    const valor = somar(titulos, (t) => t.valorDocumentoCents);
    achados.push({
      regra: "FI-NOTA-CANCELADA",
      tipo: "ESTADO",
      severidade: severidadePorValor(valor, materialidade),
      categoria: "CONFORMIDADE",
      titulo: `Nota ${nota.numero} cancelada, mas o título continua ativo`,
      descricao:
        `A ${nota.tipo === "NFSE" ? "NFS-e" : "NF-e"} nº ${nota.numero}, emitida em ${fmtData(nota.dataEmissao)} ` +
        `para ${nota.parceiroNome ?? "cliente não identificado"}, está cancelada — mas ${titulos.length} título(s) ` +
        `a receber somando ${fmtBRL(valor)} seguem ativos com esse número de documento.`,
      recomendacao:
        "Cancelar o título correspondente ou reemitir a nota. Se o serviço foi prestado e o cliente pagou, " +
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
  const orfas = notas.filter((n) => {
    if (n.numero && receber.some((t) => t.numeroDocumento === n.numero)) return false;
    // Sem numero em comum, tenta casar por cliente e valor exato — o
    // casamento frouxo evita apontar nota que so foi lancada com outro
    // numero de documento.
    return !receber.some(
      (t) => t.parceiroCodigo === n.parceiroCodigo && Math.abs(t.valorDocumentoCents - n.valorCents) <= 100
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
        total: orfas.length,
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
