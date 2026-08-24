import type { Instrumentation } from "next";

// GANCHO DE ERRO DO SERVIDOR.
//
// O Next chama `onRequestError` para toda exceção não tratada do servidor —
// montagem de página, rota de API e Server Action — e entrega o mesmo `digest`
// que a tela de erro mostra ao usuário. É o único ponto em que os dois lados
// da falha existem juntos: o número que a pessoa vê e a exceção que a causou.
//
// Sem isto, ligar um ao outro exige o painel da hospedagem. Com isto, a tela
// de sincronização mostra os dois lado a lado — e "deu erro 2799718439" passa
// a ser uma frase que se responde na hora.
//
// A GRAVAÇÃO É CARREGADA SOB DEMANDA, e só no runtime Node. O import estático
// do cliente Prisma aqui entraria no bundle do runtime Edge, onde ele não
// roda; e a instrumentação é carregada em toda inicialização, inclusive nas
// que não vão errar nunca.

export const onRequestError: Instrumentation.onRequestError = async (erro, requisicao, contexto) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const { registrarFalha } = await import("@/lib/controladoria/falhas");
    await registrarFalha({
      erro,
      // `digest` é acrescentado pelo Next ao objeto de erro antes de chamar
      // este gancho. Não está no tipo público, daí o acesso defensivo.
      digest: typeof (erro as { digest?: unknown })?.digest === "string" ? (erro as { digest: string }).digest : null,
      origem: contexto?.routerKind ? `${contexto.routerKind}/${contexto.routeType ?? "?"}` : null,
      rota: contexto?.routePath ?? requisicao?.path ?? null,
      metodo: requisicao?.method ?? null,
    });
  } catch {
    // Ver regra 1 em falhas.ts: registrar a falha nunca pode virar a falha.
  }
};
