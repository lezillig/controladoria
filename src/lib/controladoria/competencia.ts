import { Prisma } from "@prisma/client";

// QUAL DATA DECIDE O MÊS DE UM TÍTULO.
//
// Até aqui era a data de VENCIMENTO. A conferência contra a declaração de
// faturamento assinada pela contabilidade — doze meses, extraída da própria
// Omie — mostrou que essa escolha estava errada para medir resultado:
//
//   julho/2026, títulos com documento fiscal
//     por vencimento .... R$ 9.288.190,67   (+32% sobre a declaração)
//     por emissão ....... R$ 7.099.201,88   (+1,1%)
//     declaração ........ R$ 7.024.730,48
//
// Vencimento responde "quanto tenho a receber neste mês". Emissão responde
// "quanto faturei neste mês". As duas perguntas são legítimas; a segunda é a
// que se chama competência, e era a primeira que estava no lugar dela.
//
// COALESCE COM O VENCIMENTO, e não `dataEmissao` puro: a coluna é opcional no
// modelo. Na base real da Omie ela vem preenchida em 100% dos 12.931 títulos
// conferidos, mas um nulo faria o título SUMIR do resultado do mês — e título
// que some é pior que título no mês errado, porque ninguém procura o que não
// sabe que falta.
//
// O QUE NÃO MUDA, DE PROPÓSITO: atraso, aging, "vence até", pontualidade de
// pagamento e projeção de fluxo continuam pelo VENCIMENTO. Ali a pergunta é
// mesmo sobre quando o dinheiro deve entrar ou sair, e trocar a data
// transformaria um título vencido há 600 dias em um título recém-emitido.
//
// E o regime de CAIXA continua pela data da BAIXA, como sempre foi.

// Para consulta em SQL cru. Recebe o alias da tabela de títulos.
export function competenciaSql(alias = "t"): Prisma.Sql {
  return Prisma.raw(`COALESCE(${alias}."dataEmissao", ${alias}."dataVencimento")`);
}

// Para os agentes e o BSC, que cruzam registro a registro na memória.
export function dataDeCompetencia(titulo: { dataEmissao: Date | null; dataVencimento: Date }): Date {
  return titulo.dataEmissao ?? titulo.dataVencimento;
}

// Texto único do critério, para a tela e para o cabeçalho da planilha. Existe
// para os dois nunca divergirem: uma planilha que circula por e-mail dizendo um
// critério enquanto a tela diz outro é como se perde a confiança num relatório.
export const CRITERIO_COMPETENCIA =
  "Competência pela DATA DE EMISSÃO do título — é o critério que bate com a declaração de faturamento da contabilidade.";

// SEM AS PROVISÕES FUTURAS NO RESULTADO (decisão de 04/10/2026).
//
// No regime de competência, o título continua no mês da EMISSÃO, mas o
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

export function semProvisaoFuturaSql(alias = "t", hoje = inicioDeHoje()): Prisma.Sql {
  return Prisma.sql`(${Prisma.raw(`${alias}.liquidado`)} = true OR ${Prisma.raw(`${alias}."dataVencimento"`)} < ${hoje})`;
}

export function naoEhProvisaoFutura(titulo: { liquidado: boolean; dataVencimento: Date }, hoje = inicioDeHoje()): boolean {
  return titulo.liquidado === true || titulo.dataVencimento < hoje;
}

export const CRITERIO_SEM_PROVISAO = "Sem as provisões futuras: título em aberto com vencimento de hoje em diante fica fora até ser pago; pagos e em atraso entram.";
