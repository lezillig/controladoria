import { waitUntil } from "@vercel/functions";
import { urlsCandidatasDoSistema } from "@/lib/appUrl";

// Chama a rota da IA (/api/cron/ia) quando o ciclo diário termina SEM o
// condutor do GitHub Actions — o caso em que só o agendamento da Vercel está
// conduzindo. Com o condutor, quem chama é ele, em laço (ver o workflow).
//
// É melhor esforço, de propósito: uma chamada, sem insistir. A Vercel já
// recusou autochamada no meio de uma carga (508, em 04/11/2026), e a triagem
// que não rodou hoje roda na próxima passada — os achados continuam abertos.
export function dispararRotaDaIa(): void {
  const base = urlsCandidatasDoSistema()[0];
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) return;
  const cabecalhos: Record<string, string> = { Authorization: `Bearer ${secret}` };
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) cabecalhos["x-vercel-protection-bypass"] = bypass;
  waitUntil(
    fetch(`${base}/api/cron/ia`, { headers: cabecalhos })
      .then((r) => {
        if (!r.ok) console.warn(`[ia] a rota da IA respondeu ${r.status} ao disparo do fim do ciclo.`);
      })
      .catch((e) => console.warn(`[ia] disparo da rota da IA falhou: ${e instanceof Error ? e.message : "erro desconhecido"}`))
  );
}
