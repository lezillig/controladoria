"use server";

import { revalidatePath } from "next/cache";
import { waitUntil } from "@vercel/functions";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { dataReferenciaPadrao, executarPasso } from "@/lib/controladoria/ciclo";
import { existeAlgumaCredencialOmie } from "@/lib/omie/client";
import { urlDoSistema } from "@/lib/appUrl";
import { registrarEvento } from "../auditoria/actions";

// Sincronização manual. O ciclo normal é o agendamento diário; este botão
// existe para dois momentos concretos: a primeira configuração (ninguém quer
// esperar até amanhã para ver se as credenciais funcionam) e o "acabei de
// lançar na Omie, quero ver aqui agora".
//
// Roda a MESMA máquina de estados do cron, em laço, dentro de um orçamento de
// tempo próprio — não é um caminho alternativo de sincronização. Um segundo
// caminho seria a primeira coisa a divergir do agendado e a última a ser
// percebida.

// Server Action na Vercel tem o mesmo teto de execução das funções de rota.
// 40s deixa margem para a resposta e o revalidate.
const ORCAMENTO_MS = 40_000;
const DEADLINE_MS = 48_000;

// Entrega o resto do trabalho para a rota agendada, que já sabe se
// auto-encadear até o fim.
//
// Sem isto, a carga histórica ficava a cargo do dedo de quem clica: cada
// execução manual avança uma janela de 40 segundos e para. Vinte meses de base
// significariam dezenas de cliques — e a alternativa, esperar a madrugada,
// levaria noites. A rota agendada já resolve isso desde sempre; o botão só não
// estava puxando esse fio.
//
// Deliberadamente NÃO é `await`: a Server Action responde à pessoa agora, e a
// invocação seguinte roda por conta própria. `waitUntil` garante o disparo
// antes de a instância congelar — sem ele, a Vercel poderia encerrar a função
// com o fetch ainda na fila.
//
// Devolve false quando não há URL pública (desenvolvimento local, por
// exemplo). Nesse caso o comportamento antigo continua valendo, e a mensagem
// na tela diz a verdade em vez de prometer um encadeamento que não aconteceu.
function encadearCiclo(): boolean {
  const base = urlDoSistema();
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) return false;

  waitUntil(
    fetch(`${base}/api/cron/controladoria`, {
      headers: { Authorization: `Bearer ${secret}` },
    }).catch(() => {})
  );
  return true;
}

export type ResultadoSync = { erro?: string; mensagens?: string[]; concluido?: boolean };

export async function sincronizarAgora(): Promise<ResultadoSync> {
  const session = await requireRole("ADMIN", "CONTROLADORIA");

  if (!existeAlgumaCredencialOmie()) {
    return { erro: "Nenhuma credencial da Omie encontrada no ambiente. Cadastre OMIE_APP_KEY_<APELIDO> e OMIE_APP_SECRET_<APELIDO> na hospedagem e faça um novo deploy." };
  }

  const iniciado = Date.now();
  const mensagens: string[] = [];
  let concluido = false;

  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "SYNC_MANUAL",
    descricao: "Sincronização com a Omie disparada manualmente.",
  });

  try {
    // Laço com dois freios: o orçamento de tempo e um teto de iterações. O
    // segundo protege contra uma fase que pare de avançar (cursor travado):
    // sem ele, o laço consumiria o tempo inteiro sem sair do lugar.
    for (let i = 0; i < 60; i++) {
      if (Date.now() - iniciado > ORCAMENTO_MS) {
        mensagens.push(
          encadearCiclo()
            ? "Tempo desta execução esgotado — o restante continua sozinho, em segundo plano. Pode fechar a aba e recarregar esta página daqui a pouco para ver o avanço."
            : "Tempo desta execução esgotado — o restante continua na próxima execução manual (ou no ciclo automático da madrugada)."
        );
        break;
      }

      const passo = await executarPasso({
        companyId: session.companyId,
        fimDoOrcamento: iniciado + ORCAMENTO_MS,
        deadline: iniciado + DEADLINE_MS,
        dataReferencia: dataReferenciaPadrao(),
      });

      mensagens.push(...passo.detalhes);
      if (!passo.continua) {
        concluido = true;
        break;
      }
    }
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : "erro desconhecido";
    await prisma.omieSyncRun.updateMany({
      where: { companyId: session.companyId, status: "EXECUTANDO" },
      data: { status: "ERRO", finalizadoEm: new Date(), erro: mensagem.slice(0, 2000) },
    });
    return { erro: mensagem, mensagens };
  }

  revalidatePath("/sincronizacao");
  revalidatePath("/");
  return { mensagens, concluido };
}

// Encerra uma execução travada em EXECUTANDO. Necessário porque a máquina de
// estados retoma sempre a execução em andamento: se uma delas parar no meio
// (deploy no meio do ciclo, erro não capturado), toda invocação seguinte
// tentaria retomá-la e o ciclo diário nunca começaria.
export async function encerrarExecucaoTravada(): Promise<ResultadoSync> {
  const session = await requireRole("ADMIN", "CONTROLADORIA");

  const resultado = await prisma.omieSyncRun.updateMany({
    where: { companyId: session.companyId, status: "EXECUTANDO" },
    data: {
      status: "ERRO",
      finalizadoEm: new Date(),
      erro: "Execução encerrada manualmente por um usuário.",
    },
  });

  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "SYNC_ENCERRADO",
    descricao: `${resultado.count} execução(ões) travada(s) encerrada(s) manualmente.`,
  });

  revalidatePath("/sincronizacao");
  return { mensagens: [`${resultado.count} execução(ões) encerrada(s).`] };
}
