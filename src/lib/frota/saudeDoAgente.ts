import { prisma } from "@/lib/prisma";
import { lerContratosDaGestao, motivoDaFalhaDosContratos } from "@/lib/gestao/leitura";
import type { MotivoDaFalha } from "@/lib/gestao/diagnostico";

// O AGENTE DE FINANCIAMENTOS ESTÁ RODANDO? — dito na tela de Pendências.
//
// A fila de pendências desta base é alimentada, todo dia, por um agente só: o
// dos financiamentos (parcela em atraso, parcela não lançada). Quando ele não
// consegue ler os contratos na gestão, não propõe nada — e a tela mostrava
// "0 aguardando decisão", em verde, por semanas. Fila vazia porque está tudo
// em dia e fila vazia porque ninguém está olhando têm a mesma cara; é a
// falha que este sistema existe para não deixar acontecer.
//
// O agente grava uma marca por dia em que CONCLUI (AudLog, tabela "Agente",
// registro "frota:AAAA-MM-DD") e não grava quando a gestão não respondeu. A
// idade da última marca é o que diz se ele está parado.

// Até ontem conta como em dia: o ciclo diário roda de manhã, e quem abre a
// tela antes dele vê a marca da véspera.
const DIAS_DE_FOLGA = 1;

export type SaudeDoAgente =
  | { parado: false }
  | {
      parado: true;
      // Nula quando ele nunca concluiu nesta empresa.
      ultimaConclusao: Date | null;
      dias: number | null;
      // Por que a gestão não foi lida agora; nulo quando ela respondeu (o
      // agente só não rodou desde então — é o ciclo diário que não passou).
      motivo: MotivoDaFalha | null;
    };

const diaDe = (d: Date) => d.toISOString().slice(0, 10);

export async function saudeDoAgenteDeFinanciamentos(companyId: string, hoje = new Date()): Promise<SaudeDoAgente> {
  const ultima = await prisma.audLog.findFirst({
    where: { companyId, tabela: "Agente", registroId: { startsWith: "frota:" } },
    orderBy: { registroId: "desc" },
    select: { registroId: true },
  });
  const ultimaConclusao = ultima ? new Date(`${ultima.registroId.slice("frota:".length)}T00:00:00.000Z`) : null;
  const dias = ultimaConclusao && !Number.isNaN(ultimaConclusao.getTime()) ? Math.round((new Date(`${diaDe(hoje)}T00:00:00.000Z`).getTime() - ultimaConclusao.getTime()) / 86_400_000) : null;
  if (dias !== null && dias <= DIAS_DE_FOLGA) return { parado: false };
  // Só agora, com o agente parado, vale a leitura de teste: ela diz o motivo
  // de hoje (permissão, versão, conexão) em vez de um "não respondeu".
  const leu = await lerContratosDaGestao(companyId);
  return { parado: true, ultimaConclusao: dias === null ? null : ultimaConclusao, dias, motivo: leu ? null : motivoDaFalhaDosContratos() };
}
