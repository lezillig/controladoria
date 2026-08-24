// QUAL VERSÃO ESTÁ NO AR, AGORA.
//
// A pergunta aparece toda vez que uma correção sobe: a tela mostra o mesmo erro
// de antes, ou já é a versão nova falhando de novo? Sem responder isso, cada
// conserto vira uma dúvida — e a resposta óbvia ("abra o painel da
// hospedagem") é uma ida a outro sistema para saber algo sobre este.
//
// Os valores são gravados NO BUILD (ver next.config.ts). Isso é proposital:
// lidos em tempo de execução, eles diriam onde a função está rodando, não de
// qual publicação ela veio.

export type VersaoPublicada = {
  // Sete caracteres do commit — o bastante para conferir contra o que foi
  // publicado, e curto o bastante para caber na tela.
  commitCurto: string | null;
  commit: string | null;
  mensagem: string | null;
  buildEm: Date | null;
  // Falso em desenvolvimento, onde a hospedagem não preenche nada. A tela diz
  // "ambiente local" em vez de mostrar campo vazio como se fosse defeito.
  publicado: boolean;
};

export function versaoPublicada(): VersaoPublicada {
  const commit = (process.env.COMMIT_DO_BUILD ?? "").trim() || null;
  const mensagem = (process.env.MENSAGEM_DO_BUILD ?? "").trim() || null;
  const hora = (process.env.HORA_DO_BUILD ?? "").trim();
  const buildEm = hora ? new Date(hora) : null;

  return {
    commit,
    commitCurto: commit ? commit.slice(0, 7) : null,
    mensagem,
    // `new Date("texto ruim")` devolve Invalid Date, que a formatação exibiria
    // como "Invalid Date" no meio da tela. Melhor não mostrar nada.
    buildEm: buildEm && !Number.isNaN(buildEm.getTime()) ? buildEm : null,
    publicado: commit !== null,
  };
}
