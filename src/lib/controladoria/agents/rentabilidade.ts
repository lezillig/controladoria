import { fmtBRL, fmtData, fmtPercent } from "../format";
import { dentro, ultimoMesFechado, type Periodo } from "../periodos";
import { custoPorVeiculo, rentabilidadePorContrato, type LinhaCusto, type ResultadoRateio } from "../unitEconomics";
import type { AchadoNovo, Agente, ContextoAuditoria } from "../types";
import { chaveAchado, chaveMes, materialidadeCents, mediana, severidadePorValor } from "./comum";

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
    "Apura custo e receita por contrato, veículo e funcionário a partir do de-para de centro de custo, aponta contratos com margem negativa ou abaixo da meta, veículos com custo fora do padrão da frota, veículo parado ou já fora da frota que continua custando, e mede a cobertura do rateio.",
  executar: auditarRentabilidade,
};

// O ÚLTIMO MÊS FECHADO, e não o mês corrente até D-1. Contrato de fretamento
// fatura uma vez por mês e incorre custo todos os dias: até o dia do
// faturamento, TODO contrato tinha margem negativa, e a regra de margem
// dispararia para a carteira inteira assim que a cobertura passasse do
// mínimo. No último dia do mês, o próprio mês já é o fechado.
function periodoMesCorrente(ctx: ContextoAuditoria): Periodo {
  return ultimoMesFechado(ctx.dataReferencia);
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
        combustivelDescontadoDaOmie: rentabilidade.combustivelDescontadoCents,
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
    const tipico = mediana(valores);
    for (const linha of porVeiculo.linhas) {
      if (tipico <= 0 || linha.custoCents < tipico * 2) continue;
      const excedente = linha.custoCents - tipico;
      if (excedente < materialidade) continue;

      achados.push({
        regra: "RE-VEICULO-CARO",
        tipo: "ESTADO",
        severidade: severidadePorValor(excedente, materialidade),
        categoria: "OPORTUNIDADE",
        titulo: `Veículo ${linha.nome} custa ${fmtBRL(linha.custoCents)} no mês`,
        descricao:
          `Mais que o dobro da mediana da frota (${fmtBRL(tipico)}) — ${fmtBRL(excedente)} acima. ` +
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
        evidencia: { custo: linha.custoCents, mediana: tipico, origens: linha.origens },
        chave: chaveAchado("RE-VEICULO-CARO", linha.id, chaveMes(ctx.dataReferencia)),
      });
    }
  }

  achados.push(...veiculoParadoComCusto(ctx, periodo, porVeiculo, materialidade));

  return achados;
}

// O VEÍCULO QUE NÃO RODA E CONTINUA CUSTANDO — o custo escondido clássico da
// frota. Dois casos, no último mês fechado:
//
//   RE-VEICULO-INATIVO-COM-CUSTO  fora da frota (INATIVO na gestão: vendido,
//                                 baixado, sinistro) e com seguro, rastreador,
//                                 IPVA ou parcela ainda saindo
//   RE-VEICULO-OCIOSO             ATIVO na gestão, sem um km na Ituran nem no
//                                 check-in, sem abastecimento, e custando
//
// O custo é o que a Omie já liga ao veículo (de-para, placa no centro de custo
// ou no documento — unitEconomics.ts) mais a parcela do financiamento ou
// consórcio ainda correndo (gestão). Os dois não se sobrepõem: o rateio por
// veículo deixa financiamento fora do custo.
//
// Em manutenção, em preparação ou à venda, parado é o esperado: fica de fora.
// E a regra de ocioso só fala quando a frota tem rastro no mês — se menos da
// metade dos veículos ativos tem km ou abastecimento, o que falta é a
// importação da Ituran, não o uso, e acusar a frota inteira seria ruído.
const FRACAO_MINIMA_COM_RASTRO = 0.5;

export function veiculoParadoComCusto(ctx: ContextoAuditoria, periodo: Periodo, porVeiculo: ResultadoRateio<LinhaCusto>, materialidade: number): AchadoNovo[] {
  const frota = ctx.frota;
  if (!frota) return [];
  const achados: AchadoNovo[] = [];
  const custoOmie = new Map(porVeiculo.linhas.map((l) => [l.id, l]));
  // Abaixo disto não vale a conversa: uma tarifa de rastreador perdida.
  const piso = Math.max(100_00, Math.round(materialidade / 20));

  const comRastro = new Set<string>();
  for (const [id, km] of frota.kmDoMesFechado) if (km.km > 0) comRastro.add(id);
  for (const a of ctx.abastecimentos) if (a.vehicleId && dentro(a.dataHora, periodo)) comRastro.add(a.vehicleId);
  for (const u of ctx.usosDeVeiculo ?? []) if (dentro(u.checkInAt, periodo)) comRastro.add(u.vehicleId);

  const ativos = ctx.veiculos.filter((v) => v.status === "ATIVO" && !frota.vendaPorVeiculo.has(v.id));
  const rastroSuficiente = ativos.length > 0 && ativos.filter((v) => comRastro.has(v.id)).length >= ativos.length * FRACAO_MINIMA_COM_RASTRO;

  for (const v of ctx.veiculos) {
    const venda = frota.vendaPorVeiculo.get(v.id) ?? null;
    // Vendido no próprio mês: o custo até a venda é legítimo.
    if (venda && venda >= periodo.inicio) continue;
    const foraDaFrota = v.status === "INATIVO" || venda !== null;
    const ocioso = !foraDaFrota && v.status === "ATIVO" && rastroSuficiente && !comRastro.has(v.id);
    if (!foraDaFrota && !ocioso) continue;

    const omie = custoOmie.get(v.id);
    // O cartão de frota é uso, não custo de parado: se abasteceu, rodou — e
    // no fora da frota, abastecimento é outro achado (frota.ts).
    const origensSemCartao = (omie?.origens ?? []).filter((o) => o !== "cartao-frota");
    // O rateio soma o cartão junto; aqui ele sai da conta.
    const combustivel = ctx.abastecimentos.filter((a) => a.vehicleId === v.id && dentro(a.dataHora, periodo)).reduce((s2, a) => s2 + a.valorCents, 0);
    const custoOmieCents = omie ? Math.max(0, omie.custoCents - combustivel) : 0;
    const parcela = frota.parcelaPorVeiculo.get(v.id) ?? 0;
    const custo = custoOmieCents + parcela;
    if (custo < piso) continue;

    const regra = foraDaFrota ? "RE-VEICULO-INATIVO-COM-CUSTO" : "RE-VEICULO-OCIOSO";
    const partes = [
      custoOmieCents > 0 ? `${fmtBRL(custoOmieCents)} em títulos da Omie ligados à placa (${origensSemCartao.join(", ") || "rateio"})` : null,
      parcela > 0 ? `${fmtBRL(parcela)} de parcela de financiamento ou consórcio ainda correndo` : null,
    ].filter(Boolean);
    achados.push({
      regra,
      tipo: "EVENTO",
      // Fora da frota, no mínimo média: não há uso que justifique o custo.
      severidade: foraDaFrota && severidadePorValor(custo, materialidade) === "BAIXA" ? "MEDIA" : severidadePorValor(custo, materialidade),
      categoria: foraDaFrota ? "PERDA_FINANCEIRA" : "OPORTUNIDADE",
      titulo: foraDaFrota
        ? `Veículo ${v.plate} fora da frota${venda ? ` (vendido em ${fmtData(venda)})` : ""} custou ${fmtBRL(custo)} em ${periodo.rotulo}`
        : `Veículo ${v.plate} ficou parado em ${periodo.rotulo} e custou ${fmtBRL(custo)}`,
      descricao: foraDaFrota
        ? `O veículo está ${venda ? `vendido desde ${fmtData(venda)}` : "como inativo na gestão (vendido, baixado ou sinistro)"} e no mês ainda saiu: ${partes.join("; ")}. ` +
          "Seguro, rastreador, IPVA e parcela de veículo que não é mais da frota é dinheiro saindo sem retorno — e, se foi vendido, parte disso é do comprador."
        : `Ativo na gestão, mas sem nenhum km na Ituran ou no check-in e sem abastecimento no mês — e custou ${partes.join("; ")}. ` +
          `A frota teve rastro no mês (${comRastro.size} veículo(s) com km ou abastecimento), então não é falta de dado: o veículo não rodou.`,
      recomendacao: foraDaFrota
        ? "Cancelar seguro e rastreador do veículo e conferir a transferência e o IPVA com o comprador; se é consórcio ou financiamento, confirmar a quitação ou a transferência. Pedir de volta o que foi pago depois da venda."
        : "Realocar o veículo num contrato, colocá-lo à venda ou devolver; se está parado esperando oficina, mudar o status na gestão para MANUTENÇÃO, para a frota mostrar o que de fato está disponível.",
      valorCents: custo,
      dataReferencia: periodo.fim,
      entidadeTipo: "Vehicle",
      entidadeId: v.id,
      entidadeRef: v.plate,
      evidencia: {
        placa: v.plate,
        situacaoNaGestao: v.status,
        vendidoEm: venda ? fmtData(venda) : "—",
        custoNaOmie: custoOmieCents,
        origensDoCusto: origensSemCartao,
        parcelaDoFinanciamento: parcela,
        kmNoMes: frota.kmDoMesFechado.get(v.id)?.km ?? 0,
        mes: periodo.rotulo,
      },
      chave: chaveAchado(regra, v.id, chaveMes(periodo.inicio)),
    });
  }
  return achados;
}
