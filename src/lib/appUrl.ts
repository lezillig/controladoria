// URL pública do sistema.
//
// Usada em dois lugares que precisam da MESMA resposta: o link "abrir o
// painel" do e-mail e o auto-encadeamento do ciclo, que chama a própria rota
// agendada. Duas implementações divergiriam no dia em que o domínio mudasse, e
// o sintoma seria obscuro — e-mail apontando para um lugar, encadeamento para
// outro.
//
// EM PRODUÇÃO NA VERCEL, O DOMÍNIO QUE ELA INFORMA VEM PRIMEIRO.
// VERCEL_PROJECT_PRODUCTION_URL é o domínio de produção do projeto (o próprio,
// se um dia houver) e não erra; o APP_URL é digitado à mão, e um APP_URL
// apontando para o projeto de outra conta (controladoria.vercel.app, 404)
// parou a carga em 27/10/2026 e mandava os links do e-mail para lugar nenhum.
// Fora da produção da Vercel (local, outra hospedagem), vale o APP_URL.
// VERCEL_URL nunca: muda a cada deploy e fica atrás da proteção de deploy.
function producaoDaVercel(): string | null {
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return process.env.VERCEL_ENV === "production" && vercel ? `https://${vercel}` : null;
}

export function urlDoSistema(): string | null {
  return urlsCandidatasDoSistema()[0] ?? null;
}

// Os endereços em que o sistema tenta alcançar a si mesmo, em ordem. O
// encadeamento do ciclo passa para o seguinte quando um endereço responde 404
// ou não responde.
export function urlsCandidatasDoSistema(): string[] {
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const lista = [producaoDaVercel(), process.env.APP_URL?.replace(/\/$/, ""), vercel ? `https://${vercel}` : undefined];
  return [...new Set(lista.filter((u): u is string => !!u))];
}
