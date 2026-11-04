import { waitUntil } from "@vercel/functions";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { urlsCandidatasDoSistema } from "@/lib/appUrl";
import { acionarCondutorGithub, condutorGithubConfigurado } from "./condutorGithub";

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
export async function anotarNaExecucao(
  companyId: string | undefined,
  anotacao: Record<string, unknown>
): Promise<void> {
  try {
    const run = await prisma.omieSyncRun.findFirst({
      where: { status: "EXECUTANDO", ...(companyId ? { companyId } : {}) },
      orderBy: { iniciadoEm: "asc" },
      select: { id: true, detalhes: true },
    });
    if (!run) return;

    // Mescla em vez de sobrescrever: `detalhes` guarda anotações de origens
    // diferentes — o desfecho do disparo e o que a invocação automática de
    // fato fez — e substituir o objeto inteiro faria uma apagar a outra
    // justamente quando as duas juntas contam a história.
    const anterior =
      run.detalhes && typeof run.detalhes === "object" && !Array.isArray(run.detalhes)
        ? (run.detalhes as Record<string, unknown>)
        : {};

    await prisma.omieSyncRun.update({
      where: { id: run.id },
      data: { detalhes: { ...anterior, ...anotacao } as Prisma.InputJsonValue },
    });
  } catch {
    // Falha ao anotar não pode derrubar o ciclo: o objetivo aqui é
    // diagnóstico, e um diagnóstico que quebra a operação é pior que nenhum.
  }
}

async function registrarDesfecho(companyId: string | undefined, texto: string | null, aviso: string | null = null): Promise<void> {
  await anotarNaExecucao(companyId, {
    encadeamento: texto,
    encadeamentoOk: texto === null,
    encadeamentoAviso: aviso,
    em: new Date().toISOString(),
  });
}

// RECUSADA A AUTOCHAMADA, A CONDUÇÃO VAI PARA O GITHUB.
//
// Em 04/11/2026 a Vercel passou a recusar a autochamada com 508 (laço) no
// meio da carga, e o vigia agendado do GitHub, que devia retomar a cada 30
// minutos, ficou mais de 12 horas sem disparar — a fila de agendamentos do
// GitHub atrasa ou descarta. O acionamento direto (workflow_dispatch) não
// espera fila: com GITHUB_DISPATCH_TOKEN, a rodada que não conseguiu chamar a
// próxima entrega a carga ao condutor na hora. Sem o token, o texto diz o que
// falta, na tela de sincronização.
async function passarAoCondutor(data: string | null): Promise<string> {
  if (!condutorGithubConfigurado())
    return "Sem GITHUB_DISPATCH_TOKEN na Vercel, a carga espera o vigia do GitHub ou o botão Sincronizar agora.";
  const r = await acionarCondutorGithub(data);
  return r.ok ? "A condução passou para o GitHub Actions." : r.detalhe;
}

export function dispararProximaInvocacao(params?: {
  ciclo?: number;
  data?: string | null;
  companyId?: string;
}): ResultadoDisparo {
  const bases = urlsCandidatasDoSistema();
  const secret = process.env.CRON_SECRET;

  if (bases.length === 0) return { disparado: false, motivo: "Sem URL pública (APP_URL não configurada)." };
  if (!secret) return { disparado: false, motivo: "CRON_SECRET não configurado." };

  const cabecalhos: Record<string, string> = { Authorization: `Bearer ${secret}` };
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) cabecalhos[CABECALHO_BYPASS] = bypass;

  const alvoEm = (base: string) => {
    const alvo = new URL(`${base}/api/cron/controladoria`);
    if (params?.ciclo !== undefined) alvo.searchParams.set("ciclo", String(params.ciclo));
    if (params?.data) alvo.searchParams.set("data", params.data);
    return alvo.toString();
  };

  // `waitUntil` garante o disparo antes de a instância congelar. Sem ele, a
  // Vercel pode encerrar a função com o fetch ainda na fila.
  //
  // A falha é registrada no log em vez de engolida: um encadeamento que morre
  // calado é indistinguível de um ciclo que terminou, e foi exatamente isso
  // que fez a primeira carga parar por horas sem ninguém saber por quê. Quem
  // olha a tela vê pelo batimento que parou; quem abre o log vê por quê.
  //
  // ENDEREÇO ERRADO NÃO PARA A CARGA: 404 ou falta de resposta num endereço
  // passa para o seguinte (ver urlsCandidatasDoSistema), e o endereço que
  // falhou vira aviso na tela de sincronização — o link do e-mail usa o mesmo
  // APP_URL e também precisa ser corrigido.
  waitUntil(
    (async () => {
      const falhas: string[] = [];
      for (const [i, base] of bases.entries()) {
        const ultima = i === bases.length - 1;
        let r: Response;
        try {
          r = await fetch(alvoEm(base), { headers: cabecalhos });
        } catch (e) {
          const texto = `Encadeamento falhou em ${base}: ${e instanceof Error ? e.message : "erro desconhecido"}.`;
          console.error(`[ciclo] ${texto}`);
          falhas.push(texto);
          if (!ultima) continue;
          await registrarDesfecho(params?.companyId, `${falhas.join(" ")} ${await passarAoCondutor(params?.data ?? null)}`);
          return;
        }
        if (r.status === 404 && !ultima) {
          falhas.push(`${base} respondeu 404 à rota do ciclo.`);
          continue;
        }

        // O CORPO também é lido, não só o código. Uma rota pode responder 200
        // e dizer no corpo que não fez nada — e foi exatamente assim que a
        // carga ficou parada parecendo saudável. Aceitar o 200 sem olhar
        // dentro é o mesmo erro de engolir a exceção, com outra roupa.
        const corpo = (await r.json().catch(() => null)) as { error?: string } | null;

        if (r.ok && !corpo?.error) {
          // Registrar o sucesso também é o que separa "tentou e foi recusado"
          // de "nem chegou a tentar". Sem os dois lados, um encadeamento que
          // simplesmente não acontece fica idêntico a um que deu errado.
          const aviso = falhas.length
            ? `${falhas.join(" ")} O ciclo seguiu por ${base}. Corrija APP_URL na Vercel (Settings → Environment Variables) para ${base} — o link do e-mail usa o mesmo endereço.`
            : null;
          if (aviso) console.warn(`[ciclo] ${aviso}`);
          await registrarDesfecho(params?.companyId, null, aviso);
          return;
        }

        const causa =
          r.status === 401
            ? "A proteção de deploy da Vercel está barrando a chamada que o sistema faz a si mesmo. Em Settings → Deployment Protection, gere o Protection Bypass for Automation e cadastre o valor como VERCEL_AUTOMATION_BYPASS_SECRET — ou desligue a proteção para Production. (Se o bypass já existe, o CRON_SECRET é que está divergente.)"
            : r.status === 404
              ? `Nenhum endereço do sistema respondeu à rota do ciclo (${bases.join(", ")}). Confira se APP_URL aponta para o domínio de produção.`
              : r.status === 508
                ? "A Vercel recusou a autochamada como laço (508, visto em 04/11/2026 com a carga parada por horas): a função chamando a si mesma em sequência é bloqueada pela plataforma."
                : (corpo?.error ?? "");
        const texto = `${falhas.length ? `${falhas.join(" ")} ` : ""}Encadeamento recusado com HTTP ${r.status} em ${base}. ${causa} ${await passarAoCondutor(params?.data ?? null)}`.trim();
        console.error(`[ciclo] ${texto}`);
        await registrarDesfecho(params?.companyId, texto);
        return;
      }
    })()
  );

  return { disparado: true };
}
