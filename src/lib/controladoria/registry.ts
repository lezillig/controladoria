import { agenteAdministrativo } from "./agents/administrativo";
import { agenteAntifraude } from "./agents/antifraude";
import { agenteConciliacao } from "./agents/conciliacao";
import { agenteConformidade } from "./agents/conformidade";
import { agenteContasPagar } from "./agents/contasPagar";
import { agenteContasReceber } from "./agents/contasReceber";
import { agenteCustos } from "./agents/custos";
import { agenteFiscal } from "./agents/fiscal";
import { agenteFluxoCaixa } from "./agents/fluxoCaixa";
import { agenteOportunidades } from "./agents/oportunidades";
import { agentePadroes } from "./agents/padroes";
import { agenteRentabilidade } from "./agents/rentabilidade";
import type { Agente } from "./types";

// REGISTRO DOS AGENTES
//
// Estrutura em tres camadas, desenhada para dar confianca ao resultado — e
// nao apenas quantidade de alertas:
//
//   Camada 1 — ONZE agentes de dominio (abaixo). Deterministicos, puros,
//   cada um dono de uma pergunta de negocio. Nao conversam entre si: um
//   agente que depende do resultado de outro cria ordem de execucao implicita
//   e, no dia em que um falhar, o outro passa a mentir em silencio.
//
//   Camada 2 — SUPERVISOR (src/lib/controladoria/supervisor.ts). Recebe tudo
//   que a camada 1 produziu e decide o que e publicavel: suprime o que
//   depende de dado ausente, consolida o que dois agentes viram por caminhos
//   diferentes, respeita tratativa humana anterior, calibra severidade e
//   atribui confianca. E o unico ponto por onde um achado chega ao usuario.
//
//   Camada 3 — ANALISTA (src/lib/controladoria/aiAnalyst.ts). Le apenas o que
//   o supervisor aprovou e escreve a leitura executiva. Nao cria, nao apaga e
//   nao altera achado nenhum — se pudesse, o relatorio deixaria de ser
//   auditavel e viraria opiniao com aparencia de numero.
//
// Por que DEZ, e nao tres ou trinta: cada agente corresponde a uma pergunta
// que tem um dono diferente na empresa (contas a pagar e do financeiro,
// fiscal e da contabilidade, rentabilidade e da controladoria). Agentes
// demais fragmentariam a mesma pergunta em varias caixas de entrada; agentes
// de menos misturariam responsabilidades e tornariam impossivel dizer a quem
// endereçar o achado. O campo `area` de cada um e literalmente isso: o
// destinatario do trabalho.
export const AGENTES: Agente[] = [
  agenteContasPagar,
  agenteContasReceber,
  agenteConciliacao,
  agenteAntifraude,
  agenteCustos,
  // Logo depois de custos, e não no fim: os dois olham a mesma despesa, e a
  // diferença é o eixo. Custos compara com o mês anterior e com a tolerância
  // configurada; padrões compara cada fornecedor com o histórico DELE, que é a
  // pergunta que limiar nenhum responde.
  agentePadroes,
  agenteFiscal,
  agenteFluxoCaixa,
  agenteRentabilidade,
  agenteOportunidades,
  agenteAdministrativo,
  agenteConformidade,
];

export function agentePorId(id: string): Agente | undefined {
  return AGENTES.find((a) => a.id === id);
}

export const AREAS = [...new Set(AGENTES.map((a) => a.area))].sort();
