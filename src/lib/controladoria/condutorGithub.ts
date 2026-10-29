// O CONDUTOR DO GITHUB ACIONADO PELO AGENDAMENTO DA VERCEL.
//
// O ciclo diário tem dois relógios: o agendamento da Vercel (03:10 de
// Brasília, ±59 min — dispara, mas a autochamada que encadeia as rodadas é
// frágil) e o do GitHub Actions (que conduz bem, mas cujos agendamentos
// atrasam horas em dia de fila: em 29/10/2026 o primeiro disparo saiu às
// 09:33, com o ciclo aberto às 03:36 e parado desde então).
//
// Com GITHUB_DISPATCH_TOKEN no ambiente (token fine-grained do repositório,
// permissão Actions: read and write), a chamada da Vercel aciona o workflow
// na hora (workflow_dispatch, que não espera fila de agendamento) e deixa a
// condução com ele. Sem o token, ou se o GitHub recusar, nada muda: a rota
// segue com a autochamada, como antes.

const REPOSITORIO = process.env.GITHUB_REPOSITORIO_CARGA ?? "lezillig/controladoria";
const WORKFLOW = "carga-controladoria.yml";

export function condutorGithubConfigurado(): boolean {
  return !!process.env.GITHUB_DISPATCH_TOKEN;
}

export async function acionarCondutorGithub(data: string | null): Promise<{ ok: boolean; detalhe: string }> {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) return { ok: false, detalhe: "GITHUB_DISPATCH_TOKEN não configurado." };
  try {
    const r = await fetch(`https://api.github.com/repos/${REPOSITORIO}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "main", inputs: { data: data ?? "" } }),
      signal: AbortSignal.timeout(10_000),
    });
    // 204: aceito. Qualquer outra coisa (401 token vencido, 404 sem permissão)
    // devolve o código para o aviso, nunca o token.
    return r.status === 204 ? { ok: true, detalhe: "Condutor do GitHub Actions acionado." } : { ok: false, detalhe: `GitHub recusou o acionamento do condutor (HTTP ${r.status}).` };
  } catch (e) {
    return { ok: false, detalhe: `Falha ao acionar o condutor do GitHub: ${e instanceof Error ? e.name : "erro"}.` };
  }
}
