import { fmtBRL, fmtPercent } from "../format";
import { inicioDoMes, rotuloMes, type Periodo } from "../periodos";
import { custoPorVeiculo, rentabilidadePorContrato } from "../unitEconomics";
import type { AchadoNovo, Agente, ContextoAuditoria } from "../types";
import { chaveAchado, chaveMes, materialidadeCents, severidadePorValor } from "./comum";

// AGENTE DE RENTABILIDADE (unit economics)
// Responde "qual contrato da lucro e qual da prejuizo" — e, antes disso,
// responde honestamente se a base ja permite responder. A ordem importa: um
// ranking de rentabilidade construido sobre 40% de custo nao alocado leva a
// decisao errada com toda a aparencia de rigor.

// Abaixo desta cobertura, o agente NAO emite achado de margem por contrato.
// Emite um achado unico dizendo que o rateio ainda nao sustenta conclusao —
// que e a informacao verdadeira naquele momento.
const COBERTURA_MINIMA_PARA_CONCLUIR = 70;

export const agenteRentabilidade: Agente = {
  id: "rentabilidade",
  nome: "Rentabilidade por contrato",
  area: "Controladoria",
  descricao:
    "Apura custo e receita por contrato, veículo e funcionário a partir do de-para de centro de custo, aponta contratos com margem negativa ou abaixo da meta, veículos com custo fora do padrão da frota e mede a cobertura do rateio.",
  executar: auditarRentabilidade,
};

function periodoMesCorrente(ctx: ContextoAuditoria): Periodo {
  return {
    inicio: inicioDoMes(ctx.dataReferencia),
    fim: ctx.dataReferencia,
    rotulo: rotuloMes(ctx.dataReferencia),
  };
}

function auditarRentabilidade(ctx: ContextoAuditoria): AchadoNovo[] {
  const achados: AchadoNovo[] = [];
  const materialidade = materialidadeCents(ctx);
  const periodo = periodoMesCorrente(ctx);

  const nomes = new Map(ctx.clientes.map((c) => [c.id, c.nome]));
  const rentabilidade = rentabilidadePorContrato(ctx, periodo, nomes);

  if (rentabilidade.totalCents > 0 && rentabilidade.coberturaPercent < COBERTURA_MINIMA_PARA_CONCLUIR) {
    achados.push({
      regra: "RE-COBERTURA-BAIXA",
      tipo: "ESTADO",
      severidade: "ALTA",
      categoria: "ERRO_PROCESSO",
      titulo: `Apenas ${fmtPercent(rentabilidade.coberturaPercent)} do custo está alocado a um contrato`,
      descricao:
        `De ${fmtBRL(rentabilidade.totalCents)} em custos do mês, ${fmtBRL(rentabilidade.naoAlocadoCents)} não estão ` +
        `ligados a nenhum contrato, veículo ou funcionário. Com essa cobertura, qualquer ranking de rentabilidade por ` +
        `contrato seria uma conclusão sobre a minoria do custo — por isso ele não é publicado ainda.`,
      recomendacao:
        "Em Controladoria → Rentabilidade, confirmar o de-para entre os departamentos/projetos da Omie e os contratos cadastrados. " +
        "Os 10 maiores títulos não alocados costumam resolver a maior parte da diferença; a partir de 70% de cobertura o ranking passa a ser publicado automaticamente.",
      valorCents: rentabilidade.naoAlocadoCents,
      dataReferencia: ctx.dataReferencia,
      evidencia: {
        total: rentabilidade.totalCents,
        naoAlocado: rentabilidade.naoAlocadoCents,
        cobertura: rentabilidade.coberturaPercent,
        contratosComDados: rentabilidade.linhas.length,
      },
      chave: chaveAchado("RE-COBERTURA-BAIXA", chaveMes(ctx.dataReferencia)),
    });
    return achados;
  }

  // RE-MARGEM-NEGATIVA — contrato que consome mais do que traz.
  for (const linha of rentabilidade.linhas) {
    if (linha.receitaCents <= 0) continue;
    if (linha.margemCents >= 0) continue;

    achados.push({
      regra: "RE-MARGEM-NEGATIVA",
      tipo: "ESTADO",
      severidade: severidadePorValor(Math.abs(linha.margemCents), materialidade),
      categoria: "RISCO_FINANCEIRO",
      titulo: `Contrato ${linha.nome} com margem negativa`,
      descricao:
        `No mês, esse contrato gerou ${fmtBRL(linha.receitaCents)} de receita contra ${fmtBRL(linha.custoCents)} de custo ` +
        `alocado — prejuízo de ${fmtBRL(Math.abs(linha.margemCents))}. Origem do rateio: ${linha.origens.join(", ") || "não informada"}.`,
      recomendacao:
        "Antes de renegociar, conferir se todo o custo alocado pertence mesmo a este contrato (rateio errado inverte a conclusão). " +
        "Confirmado o prejuízo, as saídas são: reajuste de preço na renovação, redução de escopo (menos veículos ou horas) " +
        "ou realocação dos motoristas para contratos com margem positiva.",
      valorCents: Math.abs(linha.margemCents),
      impactoCents: Math.abs(linha.margemCents),
      dataReferencia: ctx.dataReferencia,
      entidadeTipo: "Cliente",
      entidadeId: linha.id,
      entidadeRef: linha.nome,
      evidencia: { receita: linha.receitaCents, custo: linha.custoCents, margem: linha.margemCents, origens: linha.origens },
      chave: chaveAchado("RE-MARGEM-NEGATIVA", linha.id, chaveMes(ctx.dataReferencia)),
    });
  }

  // RE-MARGEM-ABAIXO-META — so roda com meta cadastrada. Sem meta, o sistema
  // nao arbitra qual margem e "boa".
  const meta = ctx.config.metaMargemPercent;
  if (meta !== null) {
    for (const linha of rentabilidade.linhas) {
      if (linha.margemPercent === null || linha.margemCents < 0) continue;
      if (linha.margemPercent >= meta) continue;
      const faltante = Math.round((meta / 100) * linha.receitaCents - linha.margemCents);
      if (faltante < materialidade) continue;

      achados.push({
        regra: "RE-MARGEM-ABAIXO-META",
        tipo: "ESTADO",
        severidade: "MEDIA",
        categoria: "OPORTUNIDADE",
        titulo: `${linha.nome}: margem de ${fmtPercent(linha.margemPercent)} contra meta de ${fmtPercent(meta)}`,
        descricao:
          `Receita de ${fmtBRL(linha.receitaCents)}, custo de ${fmtBRL(linha.custoCents)}, margem de ` +
          `${fmtBRL(linha.margemCents)}. Para atingir a meta faltariam ${fmtBRL(faltante)} no mês.`,
        recomendacao:
          "Comparar o custo por hora/veículo deste contrato com os de margem saudável: a diferença costuma estar em hora extra " +
          "estrutural ou em veículo ocioso alocado. As duas coisas são visíveis nos módulos de Folha e Utilização deste mesmo sistema.",
        valorCents: linha.margemCents,
        impactoCents: faltante,
        dataReferencia: ctx.dataReferencia,
        entidadeTipo: "Cliente",
        entidadeId: linha.id,
        entidadeRef: linha.nome,
        evidencia: { receita: linha.receitaCents, custo: linha.custoCents, margemPercent: linha.margemPercent, meta },
        chave: chaveAchado("RE-MARGEM-ABAIXO-META", linha.id, chaveMes(ctx.dataReferencia)),
      });
    }
  }

  // RE-VEICULO-CARO — veiculo com custo muito acima da mediana da frota.
  const porVeiculo = custoPorVeiculo(ctx, periodo);
  if (porVeiculo.linhas.length >= 5) {
    const valores = porVeiculo.linhas.map((l) => l.custoCents).sort((a, b) => a - b);
    const mediana = valores[Math.floor(valores.length / 2)];
    for (const linha of porVeiculo.linhas) {
      if (mediana <= 0 || linha.custoCents < mediana * 2) continue;
      const excedente = linha.custoCents - mediana;
      if (excedente < materialidade) continue;

      achados.push({
        regra: "RE-VEICULO-CARO",
        tipo: "ESTADO",
        severidade: severidadePorValor(excedente, materialidade),
        categoria: "OPORTUNIDADE",
        titulo: `Veículo ${linha.nome} custa ${fmtBRL(linha.custoCents)} no mês`,
        descricao:
          `Mais que o dobro da mediana da frota (${fmtBRL(mediana)}) — ${fmtBRL(excedente)} acima. ` +
          `Custo considerado: ${linha.origens.join(", ")}.`,
        recomendacao:
          "Verificar se a diferença vem de manutenção corretiva concentrada, consumo de combustível fora do padrão " +
          "ou uso mais intenso (o que seria saudável). Manutenção repetida no mesmo veículo é o sinal clássico de que " +
          "o custo de mantê-lo já superou o de substituí-lo.",
        valorCents: linha.custoCents,
        impactoCents: excedente,
        dataReferencia: ctx.dataReferencia,
        entidadeTipo: "Vehicle",
        entidadeId: linha.id,
        entidadeRef: linha.nome,
        evidencia: { custo: linha.custoCents, mediana, origens: linha.origens },
        chave: chaveAchado("RE-VEICULO-CARO", linha.id, chaveMes(ctx.dataReferencia)),
      });
    }
  }

  return achados;
}
