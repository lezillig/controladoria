"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { dataReferenciaPadrao, executarPasso } from "@/lib/controladoria/ciclo";
import { existeAlgumaCredencialOmie } from "@/lib/omie/client";
import { dispararProximaInvocacao } from "@/lib/controladoria/encadear";
import { registrarEvento } from "../auditoria/actions";
import { exigirPermissao } from "../_dados";

// Sincronização manual. O ciclo normal é o agendamento diário; este botão
// existe para dois momentos concretos: a primeira configuração (ninguém quer
// esperar até amanhã para ver se as credenciais funcionam) e o "acabei de
// lançar na Omie, quero ver aqui agora".
//
// Roda a MESMA máquina de estados do cron, em laço, dentro de um orçamento de
// tempo próprio — não é um caminho alternativo de sincronização. Um segundo
// caminho seria a primeira coisa a divergir do agendado e a última a ser
// percebida.

// Orçamento de trabalho por rodada, dentro do teto de 60s da página.
//
// Os números são 40/48 e não menos porque o log de produção mostrou que eles
// cabem: sete rodadas seguidas duraram entre 40,2s e 42,1s e todas
// responderam 200. A suspeita de que a função estava sendo morta no meio era
// falsa — encurtar o orçamento só faria cada rodada render menos.
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
  const session = await exigirPermissao("sincronizar");

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
  const session = await exigirPermissao("sincronizar");

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
  const session = await exigirPermissao("sincronizar");

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

// RELER UMA JANELA DE CARGA.
//
// A fase de notas fiscais é best-effort: uma recusa da Omie não pode impedir o
// relatório do dia. Mas a janela era marcada como concluída de qualquer jeito,
// e aquele mês ficava para sempre sem nota — o erro gravado e nada que o
// desfizesse.
//
// Esta ação apaga a EXECUÇÃO daquele mês, não os dados. O ciclo procura a
// primeira janela que falta (ver `obterOuCriarRun`) e a refaz na próxima
// rodada, gravando por cima do que já existe: o espelho é upsert, então reler
// atualiza e completa, nunca duplica nem perde.
//
// Uma janela por vez, e não "reler tudo a partir daqui": trinta e oito janelas
// são horas de sincronização e consumo de API das duas contas. Quem sabe qual
// mês falhou não precisa pagar por isso.
export async function relerJanela(formData: FormData): Promise<ResultadoSync> {
  const session = await exigirPermissao("sincronizar");

  const conexaoId = String(formData.get("conexaoId") ?? "");
  const janela = String(formData.get("janelaInicio") ?? "");
  const inicio = new Date(janela);
  if (!conexaoId || Number.isNaN(inicio.getTime())) {
    return { mensagens: ["Janela inválida — nada foi alterado."] };
  }

  // O mês inteiro, e não o instante exato: a execução guarda `janelaInicio` na
  // meia-noite do dia 1, mas comparar por igualdade de instante dependeria do
  // fuso com que a data chegou do formulário.
  const mesInicio = new Date(inicio.getFullYear(), inicio.getMonth(), 1, 0, 0, 0, 0);
  const mesFim = new Date(inicio.getFullYear(), inicio.getMonth() + 1, 1, 0, 0, 0, 0);

  const alvo = await prisma.omieSyncRun.findFirst({
    where: {
      companyId: session.companyId,
      conexaoId,
      backfill: true,
      janelaInicio: { gte: mesInicio, lt: mesFim },
    },
    select: { id: true, janelaInicio: true, conexao: { select: { apelido: true } } },
  });
  if (!alvo) return { mensagens: ["Janela não encontrada — talvez já tenha sido apagada."] };

  await prisma.omieSyncRun.delete({ where: { id: alvo.id } });

  const competencia = `${alvo.janelaInicio.getFullYear()}-${String(alvo.janelaInicio.getMonth() + 1).padStart(2, "0")}`;
  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "SYNC_JANELA_RELIDA",
    entidadeTipo: "OmieSyncRun",
    entidadeId: alvo.id,
    descricao: `Janela ${competencia} de ${alvo.conexao?.apelido ?? "?"} marcada para releitura.`,
  });

  revalidatePath("/sincronizacao");
  return {
    mensagens: [
      `Janela ${competencia} (${alvo.conexao?.apelido ?? "?"}) será relida na próxima sincronização. ` +
        "Clique em Sincronizar agora ou espere o ciclo da madrugada.",
    ],
  };
}

// RELER UM PERÍODO INTEIRO — o passo que faltava no ciclo "corrige na Omie,
// confere aqui".
//
// `relerJanela`, acima, só é alcançável pela lista de janelas que FALHARAM.
// Isso cobre o caso em que a carga quebrou, e não cobre o caso mais comum
// depois que o módulo entrou em uso: a janela carregou bem, alguém corrigiu o
// dado na Omie, e o espelho continua com a versão antiga.
//
// O ciclo diário não resolve. Ele relê emissão e pagamento dos ÚLTIMOS TRÊS
// DIAS, e vencimento de hoje ±120 dias. Um título emitido em abril, corrigido
// hoje, só volta se o vencimento dele ainda estiver dentro da janela de
// vencimento — e, se não estiver, o espelho fica desatualizado para sempre,
// sem nada avisando. Quem conferisse veria o número velho achando que era o
// novo, que é o pior modo de falhar de um sistema de conferência.
//
// TETO DE DOZE MESES por chamada. Não é limitação técnica: é o mesmo motivo do
// "uma janela por vez" do botão original — cada janela é uma carga completa do
// mês nas duas contas, e um intervalo digitado errado (2020 a 2026) viraria
// horas de consumo de API sem que ninguém tivesse pedido isso.
const MAXIMO_JANELAS_POR_RELEITURA = 12;

export async function relerPeriodo(formData: FormData): Promise<ResultadoSync> {
  const session = await exigirPermissao("sincronizar");

  const conexaoParam = String(formData.get("conexaoId") ?? "");
  const de = String(formData.get("de") ?? "");
  const ate = String(formData.get("ate") ?? "");

  const casaDe = /^(\d{4})-(\d{2})$/.exec(de);
  const casaAte = /^(\d{4})-(\d{2})$/.exec(ate);
  if (!casaDe || !casaAte) {
    return { erro: "Informe o mês inicial e o final, no formato AAAA-MM." };
  }

  const inicio = new Date(Number(casaDe[1]), Number(casaDe[2]) - 1, 1);
  const fim = new Date(Number(casaAte[1]), Number(casaAte[2]) - 1, 1);
  if (fim < inicio) return { erro: "O mês final é anterior ao inicial." };

  const meses = (fim.getFullYear() - inicio.getFullYear()) * 12 + (fim.getMonth() - inicio.getMonth()) + 1;
  if (meses > MAXIMO_JANELAS_POR_RELEITURA) {
    return {
      erro:
        `${meses} meses de uma vez. O limite é ${MAXIMO_JANELAS_POR_RELEITURA} — cada mês é uma carga completa ` +
        `nas contas Omie, e um intervalo digitado errado viraria horas de consumo. Faça em partes.`,
    };
  }

  // O mês seguinte ao final, para o intervalo pegar o último mês inteiro.
  const limite = new Date(fim.getFullYear(), fim.getMonth() + 1, 1);

  // O MÊS CORRENTE NÃO TEM JANELA DE CARGA — e isso precisa ser dito, não
  // descoberto.
  //
  // A carga histórica só cria janelas até o mês ANTERIOR ao corrente (ver
  // `obterOuCriarRun`: o laço para em `cursor < mesCorrente`). Pedir releitura
  // de agosto em agosto não encontra nada para marcar. Sem este aviso, a ação
  // marcaria abril a julho, responderia "4 janelas marcadas" — e quem pediu
  // abril a agosto leria isso como sucesso e concluiria que agosto foi relido.
  //
  // Na prática o mês corrente já é relido todo dia: o ciclo diário cobre
  // emissão e pagamento dos últimos três dias E os vencimentos de hoje ±120
  // dias, o que alcança praticamente todo título do mês em curso.
  const agora = new Date();
  const mesCorrente = new Date(agora.getFullYear(), agora.getMonth(), 1);
  const pediuMesCorrente = limite > mesCorrente;

  // Conexões do escopo. Vazio = todas as ativas: quem corrigiu o cadastro na
  // Omie quase sempre corrigiu nas duas empresas, e obrigar duas passadas
  // idênticas só cria a chance de esquecer uma.
  const conexoes = await prisma.omieConexao.findMany({
    where: {
      companyId: session.companyId,
      ativa: true,
      ...(conexaoParam ? { id: conexaoParam } : {}),
    },
    select: { id: true, apelido: true },
  });
  if (conexoes.length === 0) return { erro: "Nenhuma conexão ativa no escopo escolhido." };

  const alvos = await prisma.omieSyncRun.findMany({
    where: {
      companyId: session.companyId,
      conexaoId: { in: conexoes.map((c) => c.id) },
      backfill: true,
      janelaInicio: { gte: inicio, lt: limite },
    },
    select: { id: true, janelaInicio: true, conexaoId: true, conexao: { select: { apelido: true } } },
    orderBy: { janelaInicio: "asc" },
  });

  if (alvos.length === 0) {
    return {
      erro: pediuMesCorrente
        ? "Nenhuma janela para marcar. A carga histórica só tem janela até o mês fechado anterior — o mês corrente " +
          "já é relido todos os dias pelo ciclo, que cobre os vencimentos de hoje ±120 dias."
        : "Nenhuma janela de carga encontrada nesse período. Confira o intervalo e a empresa — só existem janelas a " +
          "partir da data de início da base configurada.",
    };
  }

  await prisma.omieSyncRun.deleteMany({ where: { id: { in: alvos.map((a) => a.id) } } });

  const competencias = alvos.map(
    (a) =>
      `${a.conexao?.apelido ?? "?"} ${a.janelaInicio.getFullYear()}-${String(a.janelaInicio.getMonth() + 1).padStart(2, "0")}`
  );

  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "SYNC_PERIODO_RELIDO",
    entidadeTipo: "OmieSyncRun",
    descricao: `${alvos.length} janela(s) marcada(s) para releitura: ${competencias.join(", ")}.`,
  });

  revalidatePath("/sincronizacao");
  const mensagens = [
    `${alvos.length} janela(s) marcada(s) para releitura: ${competencias.join(", ")}.`,
    "Clique em Sincronizar agora e deixe a aba aberta — as janelas são refeitas uma após a outra.",
  ];
  if (pediuMesCorrente) {
    mensagens.push(
      "O mês corrente não entra: a carga histórica só tem janela até o mês fechado anterior. Ele já é relido todos " +
        "os dias pelo ciclo, que cobre os vencimentos de hoje ±120 dias."
    );
  }
  return { mensagens };
}
