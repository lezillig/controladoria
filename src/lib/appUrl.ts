// URL pública do sistema.
//
// Usada em dois lugares que precisam da MESMA resposta: o link "abrir o
// painel" do e-mail e o auto-encadeamento do ciclo, que chama a própria rota
// agendada. Duas implementações divergiriam no dia em que o domínio mudasse, e
// o sintoma seria obscuro — e-mail apontando para um lugar, encadeamento para
// outro.
//
// Na Vercel, VERCEL_PROJECT_PRODUCTION_URL aponta sempre para o domínio de
// produção — diferente de VERCEL_URL, que muda a cada deploy de preview e
// faria o link do e-mail apontar para um deploy antigo (ou morto).
export function urlDoSistema(): string | null {
  const explicita = process.env.APP_URL;
  if (explicita) return explicita.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return vercel ? `https://${vercel}` : null;
}

// Os endereços em que o sistema tenta alcançar a si mesmo, em ordem: o
// APP_URL cadastrado e, depois, o domínio de produção que a própria Vercel
// informa. O encadeamento do ciclo passa para o seguinte quando um endereço
// responde 404 ou não responde — um APP_URL apontando para outro projeto
// (controladoria.vercel.app, por exemplo, é de outra conta) parava a carga.
export function urlsCandidatasDoSistema(): string[] {
  const lista = [process.env.APP_URL?.replace(/\/$/, ""), process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined];
  return [...new Set(lista.filter((u): u is string => !!u))];
}
