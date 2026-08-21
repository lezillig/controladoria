"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { dataReferenciaPadrao, executarPasso } from "@/lib/controladoria/ciclo";
import { existeAlgumaCredencialOmie } from "@/lib/omie/client";
import { dispararProximaInvocacao } from "@/lib/controladoria/encadear";
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

export type ResultadoSync = { erro?: string; mensagens?: string[]; concluido?: boolean };

// `encadear` distingue quem está conduzindo a carga.
//
// Quando a aba está aberta, ela chama esta ação em corrente, uma rodada após a
// outra — e disparar o ciclo em segundo plano a cada rodada colocaria dois
// motores sobre a MESMA execução, brigando pelo mesmo cursor. Não corrompe
// nada (toda escrita é upsert por chave natural), mas gasta invocação e
// embaralha o diagnóstico: fica impossível saber qual dos dois avançou o quê.
//
// Com a aba fechada não há quem chame de novo, e aí o disparo é o que faz a
// carga continuar.
export async function sincronizarAgora(opts?: { encadear?: boolean }): Promise<ResultadoSync> {
  const encadear = opts?.encadear ?? true;
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
        if (!encadear) {
          mensagens.push("Rodada concluída — a próxima começa em seguida, nesta aba.");
        } else {
          mensagens.push(
            dispararProximaInvocacao({ companyId: session.companyId }).disparado
              ? "Tempo desta execução esgotado — o restante continua sozinho, em segundo plano."
              : "Tempo desta execução esgotado — o restante continua na próxima execução manual (ou no ciclo automático da madrugada)."
          );
        }
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

// Entrega a carga ao ciclo em segundo plano e devolve na hora se o disparo
// saiu ou não.
//
// Existe porque "precisar ficar clicando" nunca foi o desenho: o ciclo sempre
// teve de andar sozinho. A condução pela aba entrou como remendo enquanto o
// encadeamento do servidor falhava em silêncio — e, agora que ele relata o
// motivo da recusa, esta ação é o teste limpo que faltava: só o servidor
// conduzindo, com o resultado visível na tela em vez de no log.
export async function continuarEmSegundoPlano(): Promise<ResultadoSync> {
  const session = await requireRole("ADMIN", "CONTROLADORIA");

  if (!existeAlgumaCredencialOmie()) {
    return { erro: "Nenhuma credencial da Omie encontrada no ambiente." };
  }

  const { disparado, motivo } = dispararProximaInvocacao({ companyId: session.companyId });

  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "SYNC_SEGUNDO_PLANO",
    descricao: disparado
      ? "Carga entregue ao ciclo em segundo plano."
      : `Não foi possível disparar o ciclo em segundo plano: ${motivo ?? "motivo desconhecido"}`,
  });

  revalidatePath("/sincronizacao");

  return disparado
    ? {
        mensagens: [
          "Ciclo disparado em segundo plano. Pode fechar esta aba.",
          "Recarregue esta página daqui a alguns minutos: se a barra avançar, ele está andando sozinho. Se parar, o motivo aparece aqui — não mais só no log da hospedagem.",
        ],
      }
    : { erro: `Não foi possível disparar o ciclo: ${motivo ?? "motivo desconhecido"}` };
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
