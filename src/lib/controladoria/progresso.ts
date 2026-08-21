import { prisma } from "@/lib/prisma";
import { FASES } from "@/lib/omie/sync";
import { inicioDoMes } from "./periodos";

// PROGRESSO DA CARGA HISTÓRICA.
//
// A carga inicial não é uma operação de minutos: ela varre mês a mês, por
// empresa, desde a data-base até o mês corrente, e cada janela mensal passa
// pelas quatro fases de sincronização. Em vinte meses e duas empresas são
// quarenta janelas — mais de uma hora de trabalho encadeado.
//
// Sem uma medida disso, a tela só sabia dizer "esgotou o tempo, continua
// depois". Quem está esperando não consegue distinguir "falta pouco" de
// "falta a noite inteira", e a dúvida mais comum — "travou ou está andando?" —
// fica sem resposta.
//
// A conta é a mesma que a máquina de estados usa para decidir o que fazer em
// seguida (ver `obterOuCriarRun`): janelas mensais fechadas por conexão, da
// data-base até o mês corrente. Derivar o progresso de outra fonte abriria a
// porta para a barra dizer 100% enquanto o ciclo ainda tem trabalho.

export type ProgressoCarga = {
  // Janelas mensais previstas somando todas as conexões ativas.
  totalJanelas: number;
  janelasConcluidas: number;
  // 0 a 100, já incluindo a fração da janela em andamento.
  percentual: number;
  // Null quando não há execução de carga histórica em andamento.
  emAndamento: {
    conexaoApelido: string;
    competencia: string;
    fase: string;
    faseNumero: number;
    totalFases: number;
    // Batimento: quantos segundos desde o último avanço gravado. É o que
    // separa "trabalhando" de "morreu e ficou marcada como EXECUTANDO".
    segundosDesdeUltimoAvanco: number;
    // Cada passo é uma invocação de função; o número subindo é movimento
    // visível mesmo quando a fase demora a virar.
    invocacoes: number;
  } | null;
  // Quando a carga terminou e o sistema já está no regime diário.
  concluida: boolean;
};

// Meses fechados entre duas datas — o mesmo intervalo que a máquina de estados
// percorre: da data-base (inclusive) até o mês corrente (exclusive), porque o
// mês corrente é coberto pela sincronização do dia, não pela carga histórica.
function mesesAte(inicio: Date, mesCorrente: Date): number {
  const a = inicioDoMes(inicio);
  const meses = (mesCorrente.getFullYear() - a.getFullYear()) * 12 + (mesCorrente.getMonth() - a.getMonth());
  return Math.max(0, meses);
}

function competencia(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

export async function progressoDaCarga(
  companyId: string,
  dataInicioBase: Date,
  agora: Date = new Date()
): Promise<ProgressoCarga> {
  const mesCorrente = inicioDoMes(agora);
  const janelasPorConexao = mesesAte(dataInicioBase, mesCorrente);

  const [conexoes, concluidas, emAndamento] = await Promise.all([
    prisma.omieConexao.findMany({ where: { companyId, ativa: true }, select: { id: true, apelido: true } }),
    prisma.omieSyncRun.groupBy({
      by: ["conexaoId"],
      where: { companyId, backfill: true, status: "CONCLUIDO" },
      _count: { _all: true },
    }),
    prisma.omieSyncRun.findFirst({
      where: { companyId, status: "EXECUTANDO" },
      orderBy: { iniciadoEm: "asc" },
      select: {
        conexaoId: true,
        fase: true,
        janelaInicio: true,
        backfill: true,
        atualizadoEm: true,
        invocacoes: true,
      },
    }),
  ]);

  const totalJanelas = janelasPorConexao * conexoes.length;

  // Conta apenas conexões ATIVAS: uma desativada deixa de receber janelas, e
  // manter as dela no denominador travaria a barra num teto que nunca chega.
  const idsAtivos = new Set(conexoes.map((c) => c.id));
  const janelasConcluidas = concluidas
    .filter((c) => c.conexaoId !== null && idsAtivos.has(c.conexaoId))
    .reduce((soma, c) => soma + Math.min(c._count._all, janelasPorConexao), 0);

  const indiceFase = emAndamento ? FASES.indexOf(emAndamento.fase as (typeof FASES)[number]) : -1;
  // Fração da janela em curso. Só conta para janela de carga histórica: a
  // sincronização do dia não faz parte deste denominador.
  const fracaoAtual = emAndamento?.backfill && indiceFase >= 0 ? indiceFase / FASES.length : 0;

  const percentual =
    totalJanelas === 0 ? 100 : Math.min(100, ((janelasConcluidas + fracaoAtual) / totalJanelas) * 100);

  const conexaoEmAndamento = emAndamento?.conexaoId
    ? conexoes.find((c) => c.id === emAndamento.conexaoId)
    : undefined;

  return {
    totalJanelas,
    janelasConcluidas,
    percentual,
    emAndamento:
      emAndamento && conexaoEmAndamento
        ? {
            conexaoApelido: conexaoEmAndamento.apelido,
            competencia: competencia(emAndamento.janelaInicio),
            fase: emAndamento.fase,
            faseNumero: indiceFase >= 0 ? indiceFase + 1 : FASES.length,
            totalFases: FASES.length,
            segundosDesdeUltimoAvanco: Math.max(
              0,
              Math.round((agora.getTime() - emAndamento.atualizadoEm.getTime()) / 1000)
            ),
            invocacoes: emAndamento.invocacoes,
          }
        : null,
    concluida: totalJanelas > 0 && janelasConcluidas >= totalJanelas,
  };
}
