import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autorizado } from "@/lib/controladoria/autorizacaoDoCiclo";

// O VIGIA PERGUNTA AQUI ANTES DE AGIR: tem alguém trabalhando no ciclo agora?
//
// O workflow do GitHub acorda a cada 30 minutos. Se alguma execução avançou
// há menos de 30 minutos (o batimento anda a cada ~40 s enquanto ela vive),
// outro condutor — o encadeamento da Vercel ou uma aba aberta — está no
// comando, e o vigia não entra: dois condutores na mesma execução duplicam
// invocações e embaralham o diagnóstico. Caso contrário (caiu, parou há 30
// minutos ou mais, ou ainda não começou), ele conduz; o ciclo retoma de onde
// ficou, e com o dia já concluído responde na hora que não há o que fazer.
export const dynamic = "force-dynamic";

const ESPERA_MINUTOS = 30;

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const corte = new Date(Date.now() - ESPERA_MINUTOS * 60_000);
  const execucoes = await prisma.omieSyncRun.findMany({
    where: { status: "EXECUTANDO" },
    orderBy: { atualizadoEm: "desc" },
    select: { companyId: true, fase: true, atualizadoEm: true, invocacoes: true },
  });
  const viva = execucoes.find((e) => e.atualizadoEm > corte);
  const ultimoErro = await prisma.omieSyncRun.findFirst({ where: { status: "ERRO" }, orderBy: { iniciadoEm: "desc" }, select: { finalizadoEm: true, erro: true } });
  const minutos = (d: Date) => Math.round((Date.now() - d.getTime()) / 60_000);
  return NextResponse.json({
    agir: !viva,
    motivo: viva
      ? `Execução avançando (fase ${viva.fase}, último avanço há ${minutos(viva.atualizadoEm)} min): outro condutor está no comando.`
      : execucoes.length
        ? `Execução parada há ${minutos(execucoes[0].atualizadoEm)} min (fase ${execucoes[0].fase}): retomar.`
        : "Nenhuma execução em andamento: conduzir (retoma o que falhou ou confirma que o dia está concluído).",
    execucoes: execucoes.map((e) => ({ fase: e.fase, minutosDesdeAvanco: minutos(e.atualizadoEm), invocacoes: e.invocacoes })),
    ultimoErro: ultimoErro ? { em: ultimoErro.finalizadoEm, erro: ultimoErro.erro?.slice(0, 300) ?? null } : null,
  });
}
