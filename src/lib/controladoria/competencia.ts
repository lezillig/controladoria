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
