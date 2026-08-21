import { waitUntil } from "@vercel/functions";
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

export function dispararProximaInvocacao(params?: { ciclo?: number; data?: string | null }): ResultadoDisparo {
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
      .then((r) => {
        if (!r.ok) {
          console.error(
            `[ciclo] encadeamento recusado: HTTP ${r.status}.` +
              (r.status === 401
                ? " Proteção de deploy ativa sem VERCEL_AUTOMATION_BYPASS_SECRET, ou CRON_SECRET divergente."
                : "")
          );
        }
      })
      .catch((e) => {
        console.error(`[ciclo] encadeamento falhou: ${e instanceof Error ? e.message : "erro desconhecido"}`);
      })
  );

  return { disparado: true };
}
