import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/prisma";
import { urlDoSistema } from "@/lib/appUrl";

// Disparo da próxima invocação do ciclo.
//
// O ciclo avança em janelas de ~40 segundos e continua chamando a si mesmo até
// terminar. Esse encadeamento é uma requisição HTTP que a função faz para o
// próprio domínio — e é aí que ele morre por um motivo que não aparece em
// lugar nenhum:
//
// PROTEÇÃO DE DEPLOY. Com "Vercel Authentication" ligada, toda requisição ao
// domínio que não venha de um usuário autenticado recebe uma página de login
// em vez da rota. A chamada que a função faz a si mesma é uma requisição
// externa como qualquer outra: recebe a página, não a rota, e o encadeamento
// para sem erro nenhum. O cabeçalho de bypass é o mecanismo previsto para
// isso; `VERCEL_AUTOMATION_BYPASS_SECRET` é gerado no painel, em
// Settings → Deployment Protection → Protection Bypass for Automation.
//
// Enviar o cabeçalho quando a variável não existe é inofensivo — sem proteção
// ligada, ele é ignorado.
const CABECALHO_BYPASS = "x-vercel-protection-bypass";

export type ResultadoDisparo = { disparado: boolean; motivo?: string };

// Registra o desfecho da tentativa na própria execução em andamento.
//
// O log da função conta a história, mas ninguém abre o log da Vercel para
// descobrir por que uma carga parou — a pergunta nasce na tela de
// sincronização e precisa ser respondida ali. Gravar em `detalhes` mantém o
// campo `erro` para o que ele significa (a execução falhou), já que um
// encadeamento recusado não invalida o trabalho que a invocação acabou de
// fazer: ele só impede o próximo passo.
async function registrarDesfecho(companyId: string | undefined, texto: string): Promise<void> {
  try {
    await prisma.omieSyncRun.updateMany({
      where: { status: "EXECUTANDO", ...(companyId ? { companyId } : {}) },
      data: { detalhes: { encadeamento: texto, em: new Date().toISOString() } },
    });
  } catch {
    // Falha ao registrar não pode derrubar o ciclo: o objetivo aqui é
    // diagnóstico, e um diagnóstico que quebra a operação é pior que nenhum.
  }
}

export function dispararProximaInvocacao(params?: {
  ciclo?: number;
  data?: string | null;
  companyId?: string;
}): ResultadoDisparo {
  const base = urlDoSistema();
  const secret = process.env.CRON_SECRET;

  if (!base) return { disparado: false, motivo: "Sem URL pública (APP_URL não configurada)." };
  if (!secret) return { disparado: false, motivo: "CRON_SECRET não configurado." };

  const cabecalhos: Record<string, string> = { Authorization: `Bearer ${secret}` };
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) cabecalhos[CABECALHO_BYPASS] = bypass;

  // `waitUntil` garante o disparo antes de a instância congelar. Sem ele, a
  // Vercel pode encerrar a função com o fetch ainda na fila.
  //
  // A falha é registrada no log em vez de engolida: um encadeamento que morre
  // calado é indistinguível de um ciclo que terminou, e foi exatamente isso
  // que fez a primeira carga parar por horas sem ninguém saber por quê. Quem
  // olha a tela vê pelo batimento que parou; quem abre o log vê por quê.
  const alvo = new URL(`${base}/api/cron/controladoria`);
  if (params?.ciclo !== undefined) alvo.searchParams.set("ciclo", String(params.ciclo));
  if (params?.data) alvo.searchParams.set("data", params.data);

  waitUntil(
    fetch(alvo.toString(), { headers: cabecalhos })
      .then(async (r) => {
        if (r.ok) return;
        const causa =
          r.status === 401
            ? "A proteção de deploy da Vercel está barrando a chamada que o sistema faz a si mesmo. Em Settings → Deployment Protection, gere o Protection Bypass for Automation e cadastre o valor como VERCEL_AUTOMATION_BYPASS_SECRET — ou desligue a proteção para Production. (Se o bypass já existe, o CRON_SECRET é que está divergente.)"
            : r.status === 404
              ? "A URL do próprio sistema não respondeu à rota do ciclo. Confira se APP_URL aponta para o domínio de produção."
              : "";
        const texto = `Encadeamento recusado com HTTP ${r.status}. ${causa}`.trim();
        console.error(`[ciclo] ${texto}`);
        await registrarDesfecho(params?.companyId, texto);
      })
      .catch(async (e) => {
        const texto = `Encadeamento falhou: ${e instanceof Error ? e.message : "erro desconhecido"}.`;
        console.error(`[ciclo] ${texto}`);
        await registrarDesfecho(params?.companyId, texto);
      })
  );

  return { disparado: true };
}
