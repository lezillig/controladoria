import { prisma } from "@/lib/prisma";

// RETENÇÃO DE DADOS — o prazo de cada coisa, aplicado todo dia.
//
// LGPD, arts. 15 e 16: dado pessoal é guardado enquanto serve à finalidade, e
// depois some. Este módulo é a política escrita em código, rodada no fim de
// cada consolidação diária (best-effort: falha vira log, nunca derruba o
// ciclo). O que ela faz e por quê:
//
//   - IP e user-agent da trilha de eventos e das tentativas de login: 180
//     dias. Servem para investigar um incidente de acesso; seis meses é o
//     prazo do Marco Civil para registros de acesso a aplicação (art. 15).
//     A LINHA da trilha fica — quem fez o quê é rastreabilidade de
//     auditoria e tem prazo de 5 anos; só o identificador de rede sai.
//   - Investigações com a IA: 5 anos. A pergunta é livre e pode citar
//     terceiros; cinco anos é o prazo decadencial tributário, que é o
//     horizonte em que uma auditoria pode ser questionada.
//   - Falhas de servidor: 90 dias. São diagnóstico, não registro.
//
// Achados e evidências NÃO entram aqui: são o produto da auditoria, e a
// retenção deles é decisão da diretoria (documentada em docs/roadmap.md).
const DIAS_DE_IP = 180;
const DIAS_DE_INVESTIGACAO = 5 * 365;
const DIAS_DE_FALHA = 90;

export type ResultadoDaRetencao = { trilhaAnonimizada: number; loginsAnonimizados: number; investigacoesApagadas: number; falhasApagadas: number };

export async function aplicarRetencao(companyId: string, agora = new Date()): Promise<ResultadoDaRetencao> {
  const corteDeIp = new Date(agora.getTime() - DIAS_DE_IP * 86_400_000);
  const corteDeInvestigacao = new Date(agora.getTime() - DIAS_DE_INVESTIGACAO * 86_400_000);
  const corteDeFalha = new Date(agora.getTime() - DIAS_DE_FALHA * 86_400_000);

  const trilha = await prisma.controladoriaEventLog.updateMany({
    where: { companyId, criadoEm: { lt: corteDeIp }, OR: [{ ip: { not: null } }, { userAgent: { not: null } }] },
    data: { ip: null, userAgent: null },
  });
  const logins = await prisma.tentativaLogin.updateMany({
    where: { criadoEm: { lt: corteDeIp }, OR: [{ ip: { not: null } }, { userAgent: { not: null } }] },
    data: { ip: null, userAgent: null },
  });
  const investigacoes = await prisma.investigacao.deleteMany({
    where: { companyId, criadoEm: { lt: corteDeInvestigacao } },
  });
  const falhas = await prisma.falhaDeServidor.deleteMany({ where: { criadoEm: { lt: corteDeFalha } } }).catch(() => ({ count: 0 }));

  return {
    trilhaAnonimizada: trilha.count,
    loginsAnonimizados: logins.count,
    investigacoesApagadas: investigacoes.count,
    falhasApagadas: falhas.count,
  };
}
