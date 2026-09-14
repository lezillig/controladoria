"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { dataReferenciaPadrao, executarPasso } from "@/lib/controladoria/ciclo";
import { fimDoDia } from "@/lib/controladoria/periodos";
import { fmtData } from "@/lib/controladoria/format";
import { existeAlgumaCredencialOmie } from "@/lib/omie/client";
import { dispararProximaInvocacao } from "@/lib/controladoria/encadear";
import { recalcularPendentes } from "@/lib/controladoria/historico";
import {
  limparBaseAntiga as limpar,
  medirBaseAntiga as medir,
  type MedidaDaBaseAntiga,
  type ResultadoDaLimpeza,
} from "@/lib/controladoria/limpezaHistorica";
import { registrarEvento } from "@/lib/controladoria/trilha";
import { redigir } from "@/lib/controladoria/falhas";
import { executarAuditoriaRetroativa } from "@/lib/controladoria/retroativa";
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
    // Redigida e curta: erro de banco traz o host da conexão, e a mensagem
    // vai para a tela e para a trilha.
    const mensagem = redigir(e instanceof Error ? e.message : "erro desconhecido").slice(0, 500);
    await prisma.omieSyncRun.updateMany({
      where: { companyId: session.companyId, status: "EXECUTANDO" },
      data: { status: "ERRO", finalizadoEm: new Date(), erro: mensagem },
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

// RECÁLCULO DO RESUMO MENSAL, sob demanda.
//
// O cálculo normal acontece ao fim de cada janela de sincronização, e não
// precisa de botão. Este existe para os buracos: a base que foi carregada antes
// desta camada existir, e as janelas cujo recálculo falhou — ele vive num
// try/catch de propósito, para um agregado com defeito não derrubar a carga do
// mês inteiro.
//
// Foi exatamente o que aconteceu na estreia: 134 janelas carregadas, zero
// resumos, por uma coluna a mais na lista do INSERT que só a execução real
// revelou. A carga sobreviveu, o resumo não — e é para isso que este botão
// serve.
//
// UM LOTE POR CHAMADA. Cento e trinta e quatro competências não cabem nos
// sessenta segundos da função, e estourar deixaria o trabalho pela metade sem
// dizer onde parou. Cada chamada faz o que couber e devolve quantas faltam; a
// tela chama de novo até zerar.
// 25 segundos, e não 45. A função tem sessenta no total, e o que sobra não é
// folga: é o tempo de a última competência iniciada terminar. Um lote que
// começa aos 44 segundos e leva vinte estoura — e a resposta que o cliente
// recebe não é um erro tratado, é "An unexpected response was received from
// the server", que não diz nada a ninguém.
const SEGUNDOS_DO_LOTE = 25;

export async function recalcularResumoMensal(): Promise<{
  feitas: number;
  restantes: number;
  mensagem: string;
}> {
  const session = await exigirPermissao("sincronizar");

  const prazo = new Date(Date.now() + SEGUNDOS_DO_LOTE * 1000);
  const { feitas, restantes } = await recalcularPendentes(session.companyId, prazo);

  // Trilha só quando ZERA, e não a cada lote: um recálculo de cento e trinta
  // competências geraria dezenas de linhas idênticas na auditoria, afogando o
  // que a trilha existe para preservar.
  if (feitas > 0 && restantes === 0) {
    await registrarEvento({
      companyId: session.companyId,
      userId: session.userId,
      userNome: session.name,
      userEmail: session.email,
      acao: "RESUMO_MENSAL_RECALCULADO",
      descricao: "Resumo mensal do histórico recalculado até não sobrar competência pendente.",
    });
  }

  revalidatePath("/sincronizacao");
  return {
    feitas,
    restantes,
    mensagem:
      restantes === 0
        ? feitas === 0
          ? "Nada pendente: todas as competências já têm resumo."
          : `Resumo mensal completo — ${feitas} competência(s) nesta rodada.`
        : `${feitas} competência(s) nesta rodada, ${restantes} restante(s).`,
  };
}

// RODAR A AUDITORIA DE NOVO, sem esperar amanhã.
//
// O ciclo consolida uma vez por dia e recusa a segunda: "Ciclo do dia já
// concluído para todas as conexões". A recusa está certa no dia a dia — auditar
// duas vezes o mesmo espelho gasta invocação e não muda nada.
//
// Ela deixa de estar certa exatamente quando a base MUDA sem o espelho ficar
// "desatualizado": depois de uma carga histórica, de uma releitura de período,
// ou de uma correção feita na Omie e sincronizada. Nesses casos os agentes têm
// dado novo para olhar e o sistema respondia que não havia o que fazer — foi o
// que aconteceu ao terminar cinco anos de importação, que é o momento em que
// mais se quer a auditoria rodando.
//
// A implementação é apagar a marca do dia, não criar um caminho alternativo. A
// execução consolidada é reconhecida por (companyId, conexaoId nulo, não
// backfill, janelaFim de hoje); removida ela, a MESMA máquina de estados cria a
// próxima na chamada seguinte. Um segundo caminho de auditoria seria a primeira
// coisa a divergir do agendado e a última a ser percebida.
export async function reabrirAuditoria(): Promise<{ mensagens: string[] }> {
  const session = await exigirPermissao("sincronizar");

  const emAndamento = await prisma.omieSyncRun.findFirst({
    where: { companyId: session.companyId, status: "EXECUTANDO" },
  });
  if (emAndamento) {
    return {
      mensagens: [
        "Há uma execução em andamento. Espere ela terminar antes de reabrir a auditoria — duas ao mesmo tempo " +
          "disputariam a mesma janela.",
      ],
    };
  }

  // A MESMA IDENTIDADE QUE O CICLO USA PARA RECUSAR A SEGUNDA CONSOLIDAÇÃO.
  //
  // obterOuCriarRun reconhece a consolidação do dia por (conexaoId nulo, não
  // backfill, janelaFim = fim do dia da data de referência) — e é ESSA linha
  // que faz "Sincronizar agora" responder "ciclo do dia já concluído". A
  // versão anterior procurava por outro critério, "iniciada hoje", e os dois
  // não coincidem sempre: a consolidação que bloqueava o ciclo não era
  // encontrada, o botão dizia "não havia consolidação" e o ciclo, em seguida,
  // dizia que já estava concluído. Apagar pela janela remove exatamente o que
  // bloqueia; as consolidações de outros dias continuam intactas, porque têm
  // outra janelaFim.
  const janelaFim = fimDoDia(dataReferenciaPadrao());
  const apagadas = await prisma.omieSyncRun.deleteMany({
    where: {
      companyId: session.companyId,
      conexaoId: null,
      backfill: false,
      status: { in: ["CONCLUIDO", "ERRO"] },
      janelaFim,
    },
  });

  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "AUDITORIA_REABERTA",
    descricao: `Consolidação do dia reaberta (${apagadas.count} execução(ões) removida(s)) para a auditoria rodar de novo sobre a base atual.`,
  });

  revalidatePath("/sincronizacao");
  return {
    mensagens:
      apagadas.count > 0
        ? [
            "Consolidação do dia reaberta.",
            "Clique em Sincronizar agora: o ciclo vai direto para a fase de auditoria, sobre a base como ela está agora.",
          ]
        : [
            `Não havia consolidação para a referência ${fmtData(janelaFim)} — a auditoria já vai rodar no próximo Sincronizar agora.`,
          ],
  };
}

// AUDITORIA RETROATIVA — ver src/lib/controladoria/retroativa.ts.
//
// Um ano por clique. Roda dentro desta ação (não no ciclo), porque é uma
// varredura sob demanda sobre um período fechado, e o teto de 300 s da tela
// comporta um ano de base. Não disputa com o ciclo: recusa rodar enquanto
// houver execução em andamento, e grava só fatos datados daquele ano.
export async function auditarAnoPassado(formData: FormData): Promise<ResultadoSync> {
  const session = await exigirPermissao("sincronizar");
  const ano = Number(String(formData.get("ano") ?? ""));
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) return { erro: "Informe o ano a auditar." };

  const emAndamento = await prisma.omieSyncRun.findFirst({
    where: { companyId: session.companyId, status: "EXECUTANDO" },
    select: { id: true },
  });
  if (emAndamento) {
    return { erro: "Há uma execução em andamento. Espere ela terminar antes de auditar o passado." };
  }

  try {
    const r = await executarAuditoriaRetroativa(session.companyId, ano);
    await registrarEvento({
      companyId: session.companyId,
      userId: session.userId,
      userNome: session.name,
      userEmail: session.email,
      acao: "AUDITORIA_RETROATIVA",
      descricao:
        `Auditoria retroativa de ${ano}: ${r.resultado.novos} novo(s), ${r.resultado.reincidentes} reincidente(s), ` +
        `${r.resultado.fechadosAutomaticamente} fechado(s), ${r.resultado.reabertos} reaberto(s) — ` +
        `${r.titulos} títulos, ${r.baixas} baixas, ${r.abastecimentos} abastecimentos lidos.`,
    });
    revalidatePath("/sincronizacao");
    revalidatePath("/auditoria");
    const erros = r.resultado.errosPorAgente.map((e) => `${e.agente}: ${redigir(e.erro).slice(0, 200)}`);
    return {
      concluido: true,
      mensagens: [
        `Auditoria de ${ano} concluída: ${r.resultado.novos} achado(s) novo(s), ${r.resultado.reincidentes} já conhecido(s), ` +
          `${r.resultado.fechadosAutomaticamente} fechado(s) por não aparecerem mais, ${r.resultado.reabertos} reaberto(s).`,
        `Base lida: ${r.titulos} títulos, ${r.baixas} baixas e ${r.abastecimentos} abastecimentos de ${ano} ` +
          `(${Math.round(r.msContexto / 1000)} s de leitura, ${Math.round(r.msAuditoria / 1000)} s de agentes).`,
        ...(erros.length > 0 ? [`Agente(s) com erro nesta varredura: ${erros.join("; ")}.`] : []),
        "Os achados estão na tela de auditoria — filtre pelo período para ver só os daquele ano.",
      ],
    };
  } catch (e) {
    return { erro: `A auditoria de ${ano} falhou: ${redigir(e instanceof Error ? e.message : String(e)).slice(0, 400)}` };
  }
}

// LIMPAR A BASE ATÉ 31/12/2024 — ver src/lib/controladoria/limpezaHistorica.ts.
//
// Permissão de MODELO, não de sincronização: mover a data de início da base é
// alterar o modelo de gestão, e apagar quatro anos de espelho é uma decisão de
// quem responde pelo módulo. Quem só dispara a carga não deve conseguir.

export async function medirBaseAntiga(): Promise<{ medida?: MedidaDaBaseAntiga; erro?: string }> {
  const session = await exigirPermissao("gerir-modelo");
  try {
    return { medida: await medir(session.companyId) };
  } catch (e) {
    return { erro: `Não consegui medir: ${e instanceof Error ? e.message.slice(0, 300) : String(e)}` };
  }
}

export async function limparBaseAntiga(confirmacao: string): Promise<{ resultado?: ResultadoDaLimpeza; erro?: string }> {
  const session = await exigirPermissao("gerir-modelo");
  if (confirmacao !== "LIMPAR") return { erro: "Digite LIMPAR para confirmar." };

  // Carga em andamento e limpeza ao mesmo tempo é receita para base pela
  // metade: a carga grava títulos do período que a limpeza está apagando.
  const emAndamento = await prisma.omieSyncRun.findFirst({
    where: { companyId: session.companyId, status: "EXECUTANDO" },
    select: { id: true },
  });
  if (emAndamento) return { erro: "Há uma sincronização em andamento. Espere terminar (ou encerre-a) antes de limpar." };

  const antes = await medir(session.companyId);
  let resultado: ResultadoDaLimpeza;
  try {
    resultado = await limpar(session.companyId);
  } catch (e) {
    return { erro: `A limpeza falhou e nada foi apagado: ${e instanceof Error ? e.message.slice(0, 300) : String(e)}` };
  }

  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "BASE_ANTIGA_LIMPA",
    descricao:
      `Base limpa até 31/12/2024: ${resultado.titulosApagados} títulos, ${resultado.movimentosApagados} movimentos, ` +
      `${resultado.notasApagadas} notas, ${resultado.resumoMensalApagado} linhas de resumo mensal, ` +
      `${resultado.janelasApagadas} janelas de carga e ${resultado.achadosOrfaosApagados} achados órfãos apagados; ` +
      `${resultado.titulosEmAbertoPreservados} títulos antigos em aberto preservados.`,
    antes: { ...antes, emAbertoMaiores: undefined },
    depois: resultado,
  });

  revalidatePath("/sincronizacao");
  return { resultado };
}
