import type { OmieContrato, OmieTitulo } from "@prisma/client";
import { contratoAtivo, contratoInativo, contratoMensal, PERIODICIDADE_CONTRATO } from "@/lib/omie/mapping";
import type { VersaoContrato } from "@/lib/omie/types";
import { fmtBRL, fmtData } from "../format";
import { diasEntre, fimDoMes, inicioDoMes } from "../periodos";
import type { AchadoNovo, Agente, ContextoAuditoria } from "../types";
import {
  chaveAchado,
  chaveMes,
  emAberto,
  materialidadeCents,
  refTitulo,
  severidadePorValor,
  somar,
  titulosAtivos,
} from "./comum";

// AGENTE DE CONTRATOS DE SERVIÇO
//
// O contas a receber olha o que FOI cobrado. Este agente olha o que DEVERIA
// ter sido: o contrato de serviço da Omie diz quanto cada cliente paga por mês,
// a partir de quando, até quando e em que dia se fatura. É o único dado da
// base que permite dizer "faltou receita" em vez de só "atrasou receita".
//
// Toda regra aqui depende de duas coisas que a Omie pode não entregar: o
// contrato espelhado (fase `contratos` do sync) e o ELO entre título e
// contrato (`OmieTitulo.contratoCodigo`, que vem de cabecTitulo.nCodCtr e
// pode estar nulo nas linhas espelhadas antes da coluna existir). Sem
// contrato, o agente devolve vazio e o supervisor registra o motivo. Sem elo
// em NENHUM título a receber, as regras de faturamento esperado também se
// calam — apontar "contrato sem faturamento" numa base que não liga título a
// contrato seria acusar todos os contratos de uma vez.
//
// Área COMERCIAL, e não Financeiro: contrato sem faturamento, faturado a menor
// ou alterado é conversa com quem vende e renova.

export const agenteContratos: Agente = {
  id: "contratos",
  nome: "Contratos de serviço",
  area: "Comercial",
  descricao:
    "Confronta os contratos de serviço da Omie com o faturamento: título em contrato suspenso, cancelado ou vencido; contrato ativo sem título no mês; faturado abaixo do valor contratual; valor ou situação alterados em silêncio; vigência terminando.",
  executar: auditarContratos,
};

// Tolerância do faturado-a-menor: abaixo de 90% do valor mensal é achado.
// Dez por cento absorve desconto pontual, glosa de dia não trabalhado e
// arredondamento de rateio — o que se quer pegar é o mês faturado pela metade.
const TOLERANCIA_FATURADO_A_MENOR = 0.9;

// Dias depois do dia de faturamento para cobrar o mês corrente. Antes disso o
// título ainda pode estar sendo emitido.
const FOLGA_APOS_DIA_DE_FATURAMENTO = 5;

// Horizonte da regra de vigência terminando.
const DIAS_DE_AVISO_DE_VENCIMENTO = 60;

export function auditarContratos(ctx: ContextoAuditoria): AchadoNovo[] {
  const contratos = ctx.contratos ?? [];
  if (contratos.length === 0) return [];

  const materialidade = materialidadeCents(ctx);
  const elo = ligarTitulosAContratos(ctx, contratos);

  const achados: AchadoNovo[] = [];
  achados.push(...contratoInativoFaturado(ctx, elo, materialidade));
  achados.push(...contratoSemFaturamento(ctx, contratos, elo, materialidade));
  achados.push(...contratoFaturadoAMenor(ctx, contratos, elo, materialidade));
  achados.push(...contratoAlterado(ctx, contratos, materialidade));
  achados.push(...contratoVencendo(ctx, contratos));
  return achados;
}

// O ELO TÍTULO → CONTRATO.
//
// `contratoCodigo` do título é `nCodCtr` (o código interno) na origem, mas o
// normalizador aceita `cNumCtr` como alternativa — então o mapa indexa o
// contrato pelas duas grafias, sempre qualificadas pela conexão: a numeração
// de contrato é independente em cada conta Omie.
type Elo = {
  // Há pelo menos um título a receber ligado a contrato nesta base.
  temVinculo: boolean;
  titulosPorContrato: Map<string, OmieTitulo[]>;
  // Pares (título, contrato), na ordem dos títulos do contexto.
  ligacoes: { titulo: OmieTitulo; contrato: OmieContrato }[];
};

function ligarTitulosAContratos(ctx: ContextoAuditoria, contratos: OmieContrato[]): Elo {
  const porChave = new Map<string, OmieContrato>();
  for (const c of contratos) {
    porChave.set(`${c.conexaoId}|${c.codigoOmie}`, c);
    if (c.numero) porChave.set(`${c.conexaoId}|${c.numero}`, c);
  }

  const titulosPorContrato = new Map<string, OmieTitulo[]>();
  const ligacoes: Elo["ligacoes"] = [];
  let temVinculo = false;
  for (const t of titulosAtivos(ctx, "RECEBER")) {
    if (!t.contratoCodigo) continue;
    temVinculo = true;
    const c = porChave.get(`${t.conexaoId}|${t.contratoCodigo}`);
    if (!c) continue;
    ligacoes.push({ titulo: t, contrato: c });
    const lista = titulosPorContrato.get(c.id);
    if (lista) lista.push(t);
    else titulosPorContrato.set(c.id, [t]);
  }
  return { temVinculo, titulosPorContrato, ligacoes };
}

function competencia(t: OmieTitulo): Date {
  return t.dataEmissao ?? t.dataVencimento;
}

function rotuloContrato(c: OmieContrato): string {
  return `${c.numero ?? c.codigoOmie} · ${c.parceiroNome ?? "cliente não identificado"} (${c.conexaoApelido})`;
}

function evidenciaContrato(c: OmieContrato): Record<string, unknown> {
  return {
    contrato: c.numero ?? c.codigoOmie,
    codigoOmie: c.codigoOmie,
    cliente: c.parceiroNome,
    situacao: c.situacaoDescricao ?? c.situacao,
    vigenciaInicio: c.vigenciaInicio,
    vigenciaFim: c.vigenciaFim,
    diaFaturamento: c.diaFaturamento,
    periodicidade: c.periodicidade ? PERIODICIDADE_CONTRATO[c.periodicidade] ?? c.periodicidade : "mensal (não informada)",
    valorMensalCents: c.valorMensalCents,
  };
}

// CR-CONTRATO-INATIVO-FATURADO — título a receber ligado a contrato suspenso
// ou cancelado, ou emitido depois do fim da vigência.
//
// O caso que importa é a cobrança que CONTINUOU depois de o contrato morrer —
// não o título emitido enquanto ele vivia e que ficou para trás. A Omie só
// devolve a data da última alteração (`dAlt`), não a do cancelamento; quando
// ela existe, é a melhor aproximação e o título precisa ser posterior a ela.
// Quando não existe, o critério é o título ainda estar em aberto: cobrança
// viva num contrato morto é o que se quer ver, faturamento antigo já quitado
// não.
function contratoInativoFaturado(ctx: ContextoAuditoria, elo: Elo, materialidade: number): AchadoNovo[] {
  const achados: AchadoNovo[] = [];
  for (const { titulo: t, contrato: c } of elo.ligacoes) {
    const emissao = competencia(t);

    const depoisDaVigencia = c.vigenciaFim !== null && emissao > c.vigenciaFim;
    const emContratoInativo =
      contratoInativo(c.situacao) && (c.alteradoEmOmie ? emissao > c.alteradoEmOmie : emAberto(t));
    if (!depoisDaVigencia && !emContratoInativo) continue;

    const motivo = emContratoInativo
      ? `o contrato está ${(c.situacaoDescricao ?? c.situacao ?? "inativo").toLowerCase()}`
      : `a vigência do contrato terminou em ${fmtData(c.vigenciaFim)}`;
    achados.push({
      regra: "CR-CONTRATO-INATIVO-FATURADO",
      tipo: "EVENTO",
      severidade: severidadePorValor(t.valorDocumentoCents, materialidade),
      categoria: "ERRO_PROCESSO",
      titulo: `Título de ${fmtBRL(t.valorDocumentoCents)} emitido em contrato ${emContratoInativo ? (c.situacaoDescricao ?? "inativo").toLowerCase() : "vencido"}`,
      descricao:
        `O título ${refTitulo(t)}, de ${fmtBRL(t.valorDocumentoCents)} emitido em ${fmtData(emissao)} para ` +
        `${c.parceiroNome ?? t.parceiroNome ?? "cliente não identificado"}, está ligado ao contrato ` +
        `${c.numero ?? c.codigoOmie} — e ${motivo}. Cobrança sem contrato que a sustente é o que o cliente ` +
        `contesta primeiro, e o que a auditoria externa pergunta depois.`,
      recomendacao:
        "Confirmar com o comercial se o serviço continua sendo prestado. Se sim, reativar ou renovar o contrato " +
        "na Omie antes de faturar de novo; se não, cancelar o título e verificar se houve prestação sem cobertura contratual.",
      valorCents: t.valorDocumentoCents,
      dataReferencia: emissao,
      entidadeTipo: "OmieTitulo",
      entidadeId: t.id,
      entidadeRef: rotuloContrato(c),
      evidencia: {
        ...evidenciaContrato(c),
        titulo: t.codigoLancamento,
        emissao,
        valorTituloCents: t.valorDocumentoCents,
        emAberto: emAberto(t),
        alteradoEmOmie: c.alteradoEmOmie,
      },
      chave: chaveAchado("CR-CONTRATO-INATIVO-FATURADO", refTitulo(t)),
    });
  }
  return achados;
}

// Os meses que a regra de faturamento esperado avalia para um contrato: o
// mês anterior fechado sempre; o corrente só depois do dia de faturamento mais
// a folga — antes disso o título ainda pode estar sendo emitido, e um alarme
// diário contra trabalho em andamento é o jeito mais rápido de ser ignorado.
function mesesAvaliados(ctx: ContextoAuditoria, c: OmieContrato): { inicio: Date; fim: Date }[] {
  const ref = ctx.dataReferencia;
  const anterior = inicioDoMes(new Date(ref.getFullYear(), ref.getMonth() - 1, 1));
  const meses = [{ inicio: anterior, fim: fimDoMes(anterior) }];
  if (c.diaFaturamento !== null && ref.getDate() > c.diaFaturamento + FOLGA_APOS_DIA_DE_FATURAMENTO) {
    const corrente = inicioDoMes(ref);
    meses.push({ inicio: corrente, fim: fimDoMes(corrente) });
  }
  return meses;
}

// O contrato vale para este mês? Ativo, mensal, com valor, e a vigência
// cobrindo o mês inteiro — contrato que começou no dia 20 não deve o mês.
function contratoDeveOMes(c: OmieContrato, mes: { inicio: Date; fim: Date }): boolean {
  if (!contratoAtivo(c.situacao) || !contratoMensal(c.periodicidade) || c.valorMensalCents <= 0) return false;
  if (c.vigenciaInicio !== null && c.vigenciaInicio > mes.inicio) return false;
  if (c.vigenciaFim !== null && c.vigenciaFim < mes.fim) return false;
  return true;
}

function titulosDoMes(elo: Elo, c: OmieContrato, mes: { inicio: Date; fim: Date }): OmieTitulo[] {
  return (elo.titulosPorContrato.get(c.id) ?? []).filter((t) => competencia(t) >= mes.inicio && competencia(t) <= mes.fim);
}

// CR-CONTRATO-SEM-FATURAMENTO — contrato ativo, mensal, dentro da vigência, e
// nenhum título a receber emitido no mês. Receita esperada que ninguém cobrou.
function contratoSemFaturamento(ctx: ContextoAuditoria, contratos: OmieContrato[], elo: Elo, materialidade: number): AchadoNovo[] {
  if (!elo.temVinculo) return [];
  const achados: AchadoNovo[] = [];
  for (const c of contratos) {
    for (const mes of mesesAvaliados(ctx, c)) {
      if (!contratoDeveOMes(c, mes)) continue;
      if (titulosDoMes(elo, c, mes).length > 0) continue;
      achados.push({
        regra: "CR-CONTRATO-SEM-FATURAMENTO",
        tipo: "ESTADO",
        severidade: severidadePorValor(c.valorMensalCents, materialidade),
        categoria: "PERDA_FINANCEIRA",
        titulo: `Contrato ${c.numero ?? c.codigoOmie} sem faturamento em ${chaveMes(mes.inicio)}`,
        descricao:
          `O contrato ${c.numero ?? c.codigoOmie} de ${c.parceiroNome ?? "cliente não identificado"} ` +
          `(${c.conexaoApelido}) está ativo, prevê ${fmtBRL(c.valorMensalCents)} por mês` +
          (c.diaFaturamento ? `, faturado no dia ${c.diaFaturamento},` : "") +
          ` e não tem nenhum título a receber emitido entre ${fmtData(mes.inicio)} e ${fmtData(mes.fim)}. ` +
          `É receita contratada que não foi cobrada — ou serviço que deixou de ser prestado sem o contrato acompanhar.`,
        recomendacao:
          "Emitir o faturamento do mês ou, se o serviço foi interrompido, suspender o contrato na Omie. " +
          "Se o título existe e foi lançado sem o vínculo com o contrato, preencher o contrato no título.",
        valorCents: c.valorMensalCents,
        impactoCents: c.valorMensalCents,
        dataReferencia: mes.fim < ctx.dataReferencia ? mes.fim : ctx.dataReferencia,
        entidadeTipo: "OmieContrato",
        entidadeId: c.id,
        entidadeRef: rotuloContrato(c),
        evidencia: { ...evidenciaContrato(c), competencia: chaveMes(mes.inicio) },
        chave: chaveAchado("CR-CONTRATO-SEM-FATURAMENTO", c.conexaoApelido, c.codigoOmie, chaveMes(mes.inicio)),
      });
    }
  }
  return achados;
}

// CR-CONTRATO-FATURADO-A-MENOR — os títulos do mês anterior fechado somam
// menos de 90% do valor mensal. Só contratos mensais: num trimestral, o mês
// sem título é o normal, e avaliá-lo exigiria saber em que mês do ciclo se
// está — dado que a Omie não devolve.
function contratoFaturadoAMenor(ctx: ContextoAuditoria, contratos: OmieContrato[], elo: Elo, materialidade: number): AchadoNovo[] {
  if (!elo.temVinculo) return [];
  const ref = ctx.dataReferencia;
  const anterior = inicioDoMes(new Date(ref.getFullYear(), ref.getMonth() - 1, 1));
  const mes = { inicio: anterior, fim: fimDoMes(anterior) };

  const achados: AchadoNovo[] = [];
  for (const c of contratos) {
    if (!contratoDeveOMes(c, mes)) continue;
    const titulos = titulosDoMes(elo, c, mes);
    if (titulos.length === 0) continue; // é CR-CONTRATO-SEM-FATURAMENTO
    const faturado = somar(titulos, (t) => t.valorDocumentoCents);
    if (faturado >= Math.round(c.valorMensalCents * TOLERANCIA_FATURADO_A_MENOR)) continue;
    const diferenca = c.valorMensalCents - faturado;

    achados.push({
      regra: "CR-CONTRATO-FATURADO-A-MENOR",
      tipo: "ESTADO",
      severidade: severidadePorValor(diferenca, materialidade),
      categoria: "PERDA_FINANCEIRA",
      titulo: `Contrato ${c.numero ?? c.codigoOmie} faturado ${fmtBRL(diferenca)} abaixo do valor mensal`,
      descricao:
        `Em ${chaveMes(mes.inicio)}, o contrato ${c.numero ?? c.codigoOmie} de ${c.parceiroNome ?? "cliente não identificado"} ` +
        `(${c.conexaoApelido}) prevê ${fmtBRL(c.valorMensalCents)} e os ${titulos.length} título(s) emitidos somam ` +
        `${fmtBRL(faturado)} — ${Math.round((faturado / c.valorMensalCents) * 100)}% do contratado. Desconto acima de ` +
        `10% do valor mensal precisa de motivo registrado: glosa, dia não operado ou renegociação.`,
      recomendacao:
        "Conferir com o comercial se houve glosa ou renegociação e, se houve, ajustar o valor do contrato na Omie " +
        "para que a diferença deixe de ser apontada. Sem motivo, emitir o complemento.",
      valorCents: diferenca,
      impactoCents: diferenca,
      dataReferencia: mes.fim,
      entidadeTipo: "OmieContrato",
      entidadeId: c.id,
      entidadeRef: rotuloContrato(c),
      evidencia: {
        ...evidenciaContrato(c),
        competencia: chaveMes(mes.inicio),
        faturadoCents: faturado,
        diferencaCents: diferenca,
        titulos: titulos.map((t) => ({ codigoLancamento: t.codigoLancamento, emissao: competencia(t), valorCents: t.valorDocumentoCents })),
      },
      chave: chaveAchado("CR-CONTRATO-FATURADO-A-MENOR", c.conexaoApelido, c.codigoOmie, chaveMes(mes.inicio)),
    });
  }
  return achados;
}

function lerVersoes(c: OmieContrato): VersaoContrato[] {
  return Array.isArray(c.versoes) ? (c.versoes as unknown as VersaoContrato[]) : [];
}

// CR-CONTRATO-ALTERADO — valor mensal reduzido, ou situação mudada para
// suspenso/cancelado, entre duas versões vistas pelo espelho, com o usuário
// que alterou. "Valor de contrato alterado em silêncio": ninguém aprova
// desconto de contrato por e-mail, e o único rastro é o `uAlt` da Omie.
//
// Um achado por alteração (a data em que o espelho viu a versão nova entra na
// chave), EVENTO — a mudança aconteceu, e reverter o valor depois não a
// desfaz. Sem usuário de alteração a regra se cala: seria acusar sem dizer
// quem, e a conta que não devolve `infoCadastro` não tem como sustentar isso.
function contratoAlterado(ctx: ContextoAuditoria, contratos: OmieContrato[], materialidade: number): AchadoNovo[] {
  const achados: AchadoNovo[] = [];
  for (const c of contratos) {
    const versoes = lerVersoes(c);
    for (let i = 1; i < versoes.length; i++) {
      const antes = versoes[i - 1];
      const depois = versoes[i];
      const queda = depois.valorMensalCents < antes.valorMensalCents;
      const inativado = contratoInativo(depois.situacao) && !contratoInativo(antes.situacao);
      if (!queda && !inativado) continue;
      const usuario = depois.usuarioAlteracao ?? c.usuarioAlteracao;
      if (!usuario) continue;

      const vistoEm = new Date(depois.vistoEm);
      const dataDoFato = depois.alteradoEmOmie ? new Date(depois.alteradoEmOmie) : vistoEm;
      const valor = queda ? antes.valorMensalCents - depois.valorMensalCents : antes.valorMensalCents;
      const porValor = severidadePorValor(valor, materialidade);
      const oQueMudou = [
        queda ? `o valor mensal caiu de ${fmtBRL(antes.valorMensalCents)} para ${fmtBRL(depois.valorMensalCents)}` : null,
        inativado ? `a situação passou de ${descreverSituacao(antes.situacao)} para ${descreverSituacao(depois.situacao)}` : null,
      ]
        .filter(Boolean)
        .join(" e ");

      achados.push({
        regra: "CR-CONTRATO-ALTERADO",
        tipo: "EVENTO",
        // Nunca abaixo de MÉDIA: o valor pode ser pequeno, mas alteração de
        // contrato sem trilha é exatamente o que uma auditoria de receita
        // procura — a redução repetida em contratos pequenos soma.
        severidade: porValor === "BAIXA" || porValor === "INFO" ? "MEDIA" : porValor,
        categoria: "RISCO_FINANCEIRO",
        titulo: `Contrato ${c.numero ?? c.codigoOmie} alterado por ${usuario}: ${queda ? "valor reduzido" : "contrato desativado"}`,
        descricao:
          `Entre ${fmtData(new Date(antes.vistoEm))} e ${fmtData(vistoEm)}, no contrato ${c.numero ?? c.codigoOmie} de ` +
          `${c.parceiroNome ?? "cliente não identificado"} (${c.conexaoApelido}), ${oQueMudou}. ` +
          `A última alteração registrada na Omie é de ${usuario}` +
          (depois.alteradoEmOmie ? `, em ${fmtData(dataDoFato)}` : "") +
          `. Não há na Omie registro de quem aprovou a mudança — só de quem a digitou.`,
        recomendacao:
          "Pedir ao comercial o aditivo ou o e-mail de aprovação que sustenta a alteração. Sem documento, " +
          "restaurar o valor anterior e revisar quem tem permissão de editar contrato na Omie.",
        valorCents: valor,
        impactoCents: queda ? valor : undefined,
        dataReferencia: dataDoFato,
        entidadeTipo: "OmieContrato",
        entidadeId: c.id,
        entidadeRef: rotuloContrato(c),
        evidencia: {
          ...evidenciaContrato(c),
          alteradoPor: usuario,
          alteradoEmOmie: depois.alteradoEmOmie,
          vistoEm: depois.vistoEm,
          valorAnteriorCents: antes.valorMensalCents,
          valorNovoCents: depois.valorMensalCents,
          situacaoAnterior: descreverSituacao(antes.situacao),
          situacaoNova: descreverSituacao(depois.situacao),
        },
        chave: chaveAchado("CR-CONTRATO-ALTERADO", c.conexaoApelido, c.codigoOmie, depois.vistoEm.slice(0, 10)),
      });
    }
  }
  return achados;
}

function descreverSituacao(situacao: string | null): string {
  if (situacao === null) return "não informada";
  return ({ "00": "em elaboração", "10": "ativo", "90": "suspenso", "99": "cancelado" } as Record<string, string>)[situacao] ?? situacao;
}

// CR-CONTRATO-VENCENDO — vigência terminando nos próximos 60 dias, contrato
// ativo. Informativo: não é problema, é pauta de renovação — e a renovação
// atrasada vira, dois meses depois, CR-CONTRATO-INATIVO-FATURADO.
function contratoVencendo(ctx: ContextoAuditoria, contratos: OmieContrato[]): AchadoNovo[] {
  const achados: AchadoNovo[] = [];
  for (const c of contratos) {
    if (!contratoAtivo(c.situacao) || c.vigenciaFim === null) continue;
    const dias = diasEntre(ctx.dataReferencia, c.vigenciaFim);
    if (dias < 0 || dias > DIAS_DE_AVISO_DE_VENCIMENTO) continue;
    achados.push({
      regra: "CR-CONTRATO-VENCENDO",
      tipo: "ESTADO",
      severidade: "INFO",
      categoria: "RISCO_FINANCEIRO",
      titulo: `Contrato ${c.numero ?? c.codigoOmie} vence em ${dias} dia(s)`,
      descricao:
        `A vigência do contrato ${c.numero ?? c.codigoOmie} de ${c.parceiroNome ?? "cliente não identificado"} ` +
        `(${c.conexaoApelido}), de ${fmtBRL(c.valorMensalCents)} por mês, termina em ${fmtData(c.vigenciaFim)}. ` +
        `Sem renovação registrada, o faturamento seguinte sai sem contrato que o sustente.`,
      recomendacao: "Encaminhar a renovação ao comercial e registrar o aditivo na Omie antes do fim da vigência.",
      valorCents: c.valorMensalCents,
      dataReferencia: ctx.dataReferencia,
      entidadeTipo: "OmieContrato",
      entidadeId: c.id,
      entidadeRef: rotuloContrato(c),
      evidencia: { ...evidenciaContrato(c), diasParaVencer: dias },
      chave: chaveAchado("CR-CONTRATO-VENCENDO", c.conexaoApelido, c.codigoOmie),
    });
  }
  // Ordem estável por data de vencimento: a lista da tela começa pelo que
  // vence primeiro.
  return achados.sort((a, b) => ((a.evidencia?.diasParaVencer as number) ?? 0) - ((b.evidencia?.diasParaVencer as number) ?? 0));
}
