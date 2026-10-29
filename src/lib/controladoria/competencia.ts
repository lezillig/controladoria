import { Prisma } from "@prisma/client";

// QUAL DATA DECIDE O MÊS DE UM TÍTULO.
//
// DESPESA PELO VENCIMENTO, RECEITA PELA NOTA (decisão de 27/10/2026).
//
// A Omie tem três datas e cada uma responde uma pergunta:
//   lançamento/emissão — quando o título foi lançado (ou o documento emitido);
//   vencimento ......... a que mês a obrigação pertence;
//   pagamento .......... quando o dinheiro saiu ou entrou (regime de CAIXA).
//
// DESPESA (a pagar) pelo VENCIMENTO. Pela emissão, tudo o que se lança com
// antecedência ia para o mês do lançamento: as 48 parcelas de um financiamento
// lançadas no dia do contrato caíam todas naquele mês, e o mês em que cada
// parcela vence e é paga ficava sem ela — outubro/2026 apareceu com metade das
// prestações e dos custos de veículos, com tudo pago.
//
// RECEITA (a receber) pela EMISSÃO da nota, que é o faturamento: em
// julho/2026, por vencimento a receita dava R$ 9,29 mi (+32% sobre a
// declaração de faturamento da contabilidade); pela emissão, R$ 7,10 mi
// (+1,1%). COALESCE com o vencimento porque a emissão é opcional no modelo, e
// título sem data sumiria do resultado.
//
// O regime de CAIXA continua pela data da BAIXA; atraso, aging e projeção de
// fluxo continuam pelo vencimento.

// A regra ANTIGA (tudo pela emissão), só para comparação: a tela Custos base
// do simulador mostra os indiretos pelas duas regras, para separar o que mudou
// pela regra do que mudou nos dados. Nenhuma demonstração usa esta.
export type RegraCompetencia = "atual" | "emissao";

// Para consulta em SQL cru. Recebe o alias da tabela de títulos.
export function competenciaSql(alias = "t", regra: RegraCompetencia = "atual"): Prisma.Sql {
  if (regra === "emissao") return Prisma.raw(`COALESCE(${alias}."dataEmissao", ${alias}."dataVencimento")`);
  return Prisma.raw(
    `(CASE WHEN ${alias}.natureza = 'PAGAR' THEN ${alias}."dataVencimento" ELSE COALESCE(${alias}."dataEmissao", ${alias}."dataVencimento") END)`
  );
}

// Para os agentes e o BSC, que cruzam registro a registro na memória. A
// natureza é obrigatória: sem ela uma despesa cairia no mês da emissão.
export function dataDeCompetencia(titulo: { natureza: string; dataEmissao: Date | null; dataVencimento: Date }): Date {
  return titulo.natureza === "PAGAR" ? titulo.dataVencimento : (titulo.dataEmissao ?? titulo.dataVencimento);
}

// Texto único do critério, para a tela e para o cabeçalho da planilha. Existe
// para os dois nunca divergirem: uma planilha que circula por e-mail dizendo um
// critério enquanto a tela diz outro é como se perde a confiança num relatório.
export const CRITERIO_COMPETENCIA =
  "Competência: despesas pela DATA DE VENCIMENTO, receitas pela DATA DE EMISSÃO da nota (o faturamento). A data de lançamento não entra.";

// SEM AS PROVISÕES FUTURAS NO RESULTADO (decisão de 04/10/2026).
//
// No regime de competência, o título continua no mês da competência, mas o
// título A VENCER — em aberto, com vencimento de hoje em diante — fica fora
// do resultado (DRE e sua planilha de conferência, análise de custos e base
// de custos do simulador). Entram o pago/recebido (`liquidado`) e o EM ATRASO: atraso é
// custo ou receita que já devia ter acontecido. Em setembro/2026, os PJs do
// apoio administrativo tinham o pagamento do mês seguinte lançado como a
// vencer ao lado do pago, e somar a provisão dobrava o custo do mês.
//
// O preço disso, dito na tela: o mês corrente aparece com a receita que
// ainda vai vencer de fora. Quem precisa do que está EM ABERTO — mês em
// formação, previsão de caixa, aging, conferência fiscal e de CT-e, auditoria
// — continua lendo todos os títulos, e também a composição por categoria e os
// cartões do painel, que mostram o mês inteiro como a Omie o tem.
//
// "Hoje" é o início do dia em que a leitura roda, o mesmo para a soma no
// banco e a montagem em memória (o teste diferencial exige as duas iguais).
// Os testes fixam o "hoje" (a base de teste tem datas fixas; sem isso, um
// título que vence em 10/10/2026 mudaria de lado conforme o dia em que o teste
// roda).
let hojeFixo: Date | null = null;
export function fixarHojeParaTeste(d: Date | null): void {
  hojeFixo = d;
}

export function inicioDeHoje(agora = hojeFixo ?? new Date()): Date {
  return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 0, 0, 0, 0);
}

// Só a CONTA A PAGAR é provisão: a nota emitida a receber é receita da
// competência mesmo antes de vencer (sem isso, o mês corrente ficava com a
// receita zerada — tudo o que se faturou nele vence depois).
export function semProvisaoFuturaSql(alias = "t", hoje = inicioDeHoje()): Prisma.Sql {
  return Prisma.sql`(${Prisma.raw(`${alias}.natureza`)} = 'RECEBER' OR ${Prisma.raw(`${alias}.liquidado`)} = true OR ${Prisma.raw(`${alias}."dataVencimento"`)} < ${hoje})`;
}

export function naoEhProvisaoFutura(titulo: { natureza?: string | null; liquidado: boolean; dataVencimento: Date }, hoje = inicioDeHoje()): boolean {
  return titulo.natureza === "RECEBER" || titulo.liquidado === true || titulo.dataVencimento < hoje;
}

export const CRITERIO_SEM_PROVISAO = "Sem as provisões futuras: conta a pagar em aberto com vencimento de hoje em diante fica fora até ser paga; pagas e em atraso entram. A receita faturada entra pela emissão da nota, mesmo a receber.";
