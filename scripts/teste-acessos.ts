// TESTES DA RESOLUÇÃO DE ACESSO — `npm run teste:acessos`.
//
// Sem banco: `resolverAcesso` é regra pura, e é assim de propósito. Esta é a
// função que decide quem enxerga o caixa do grupo, e ela precisa ser
// exercitável sem subir nada.
//
// O caso que dá nome ao arquivo é o terceiro: PAPEL SEM ACESSO VENCE O PERFIL.
// Um perfil generoso atribuído a quem é MOTORISTA na gestão não pode virar
// porta dos fundos — quem administra pessoas é a gestão, e a decisão de lá
// sobre quem é do financeiro tem de continuar valendo aqui.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PERMISSOES,
  PERFIS_SUGERIDOS,
  perderiaGestaoDeUsuarios,
  permissoesDoPapel,
  pode,
  resolverAcesso,
  rotaInicial,
} from "../src/lib/acessos";
import { requisicaoDeOutroSite, sessaoVigente } from "../src/lib/auth";
import { extensaoAceita } from "../src/lib/conformidade/tipos";
import { redigir } from "../src/lib/controladoria/falhas";
import { lerReaisEmCents } from "../src/lib/controladoria/format";
import { decodificarEntidades } from "../src/lib/omie/mapping";

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(
    `${ok ? "  ok  " : "FALHA "} ${nome}${ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         obtido   ${JSON.stringify(real)}`}`
  );
}

const TELAS = PERMISSOES.filter((p) => p.grupo === "Telas").map((p) => p.chave);
const ACOES = PERMISSOES.filter((p) => p.grupo === "Ações").map((p) => p.chave);

// ------------------------------------------------- 1. regras de papel
//
// O contrato de "nada muda no dia em que isto sobe". Qualquer diferença aqui é
// uma mudança de acesso silenciosa aplicada a todo mundo de uma vez.
console.log("\n1. Regras de papel, quando não há perfil");
conferir("ADMIN alcança tudo", permissoesDoPapel("ADMIN").length, PERMISSOES.length);
conferir("CONTROLADORIA alcança tudo", permissoesDoPapel("CONTROLADORIA").length, PERMISSOES.length);
conferir("GESTOR vê todas as telas", permissoesDoPapel("GESTOR").sort(), [...TELAS].sort());
conferir("GESTOR não executa nenhuma ação", permissoesDoPapel("GESTOR").filter((p) => (ACOES as string[]).includes(p)), []);
conferir("FOLHA não entra", permissoesDoPapel("FOLHA"), []);
conferir("MOTORISTA não entra", permissoesDoPapel("MOTORISTA"), []);
conferir("papel desconhecido não entra", permissoesDoPapel("ESTAGIARIO"), []);

// ------------------------------------------------- 2. perfil substitui o papel
console.log("\n2. Perfil atribuído substitui as regras de papel");
const soPainel = { nome: "Só painel", permissoes: ["painel"] };
const a = resolverAcesso("ADMIN", soPainel);
conferir("ADMIN com perfil restrito fica restrito", [...a.permissoes], ["painel"]);
conferir("e a origem aparece como perfil", a.origem, "perfil");
conferir("com o nome do perfil", a.perfilNome, "Só painel");
conferir("ADMIN restrito não trata achado", pode(a, "tratar-achado"), false);

const b = resolverAcesso("GESTOR", { nome: "Operacional", permissoes: ["custos", "classificar-dre"] });
conferir("perfil pode CONCEDER ação a GESTOR", pode(b, "classificar-dre"), true);

// ------------------------------------------------- 3. papel sem acesso vence
console.log("\n3. Papel sem acesso vence qualquer perfil");
const generoso = { nome: "Tudo", permissoes: PERMISSOES.map((p) => p.chave as string) };
for (const papel of ["FOLHA", "MOTORISTA", "ESTAGIARIO", ""]) {
  const r = resolverAcesso(papel, generoso);
  conferir(`${papel || "(vazio)"} continua sem acesso`, [...r.permissoes], []);
  conferir(`${papel || "(vazio)"}: origem é o papel, não o perfil`, r.origem, "papel");
}

// ------------------------------------------------- 4. sem perfil, cai no papel
console.log("\n4. Sem perfil, valem as regras de papel");
const c = resolverAcesso("GESTOR", null);
conferir("GESTOR sem perfil vê as telas", c.permissoes.size, TELAS.length);
conferir("origem é papel", c.origem, "papel");
conferir("e não há nome de perfil", c.perfilNome, null);

// ------------------------------------------------- 5. perfis sugeridos
//
// São o ponto de partida oferecido na criação. Se um deles conceder o que não
// deveria, o erro entra no sistema pela porta da frente — pré-marcado.
console.log("\n5. Perfis sugeridos");
const diretoria = PERFIS_SUGERIDOS.find((p) => p.nome === "Diretoria")!;
conferir("Diretoria vê tudo", [...diretoria.permissoes].sort(), [...TELAS].sort());
conferir("Diretoria não altera nada", diretoria.permissoes.filter((p) => (ACOES as string[]).includes(p)), []);

const financeiro = PERFIS_SUGERIDOS.find((p) => p.nome === "Financeiro")!;
conferir("Financeiro não trata achado", financeiro.permissoes.includes("tratar-achado"), false);
conferir("Financeiro não gere usuários", financeiro.permissoes.includes("gerir-usuarios"), false);
conferir("Financeiro confere CT-e", financeiro.permissoes.includes("conferir-cte"), true);

// Nenhum perfil sugerido pode citar chave fora do catálogo: chave inventada é
// permissão que nenhuma tela consulta — invisível e para sempre.
const validas = new Set<string>(PERMISSOES.map((p) => p.chave));
const inventadas = PERFIS_SUGERIDOS.flatMap((p) => p.permissoes).filter((p) => !validas.has(p));
conferir("nenhuma chave fora do catálogo", inventadas, []);

// Chaves duplicadas no catálogo fariam a contagem "12 de 22" mentir e a grade
// de marcação renderizar duas caixas com a mesma chave.
conferir("catálogo sem chave repetida", PERMISSOES.length, validas.size);

// ------------------------------------------------- 6. texto vindo da Omie
//
// Mora aqui porque é a mesma classe de defeito: um valor que atravessa a
// fronteira do sistema e chega à tela sem tradução. A categoria que apareceu
// no DRE escrita `&lt;Disponível&gt;` é o caso real.
console.log("\n6. Entidades HTML no texto da Omie");
conferir("categoria sem nome da Omie", decodificarEntidades("&lt;Disponível&gt;"), "<Disponível>");
conferir("e comercial em razão social", decodificarEntidades("TAL &amp; CIA"), "TAL & CIA");
conferir("texto sem entidade não muda", decodificarEntidades("Manutenção das vans"), "Manutenção das vans");
// UMA passada só: decodificar em laço transformaria isto em tag de verdade
// dentro do relatório que a diretoria abre no e-mail.
conferir("não decodifica duas vezes", decodificarEntidades("&amp;lt;script&gt;"), "&lt;script>");

// ------------------------------------------------- 7. sessão reconferida
//
// O token carrega papel E empresa do momento do login. O papel já era
// reconferido; a empresa não — quem foi transferido na gestão continuava
// filtrando tudo pela empresa antiga até o token vencer.
console.log("\n7. Sessão reconferida no cadastro");
const sessao = { userId: "u1", name: "Ana", email: "ana@x.com", role: "ADMIN", companyId: "empresa-a" };
conferir(
  "ativo na mesma empresa segue, com o papel ATUAL",
  sessaoVigente(sessao, { situacao: "ativo", role: "GESTOR", companyId: "empresa-a" })?.role,
  "GESTOR"
);
conferir(
  "transferido para outra empresa perde a sessão",
  sessaoVigente(sessao, { situacao: "ativo", role: "ADMIN", companyId: "empresa-b" }),
  null
);
conferir("desativado perde a sessão", sessaoVigente(sessao, { situacao: "revogado" }), null);
conferir("banco fora do ar não expulsa", sessaoVigente(sessao, { situacao: "indisponivel" })?.companyId, "empresa-a");

// ------------------------------------------------- 8. logout de outro site
console.log("\n8. Logout disparado por outro site");
conferir("cross-site é recusado", requisicaoDeOutroSite(new Headers({ "sec-fetch-site": "cross-site" })), true);
conferir("same-origin passa", requisicaoDeOutroSite(new Headers({ "sec-fetch-site": "same-origin" })), false);
conferir("sem o cabeçalho passa (não é navegador)", requisicaoDeOutroSite(new Headers()), false);

// ------------------------------------------------- 9. ninguém se tranca fora
//
// O caso real: ADMIN sem perfil próprio marca a "Diretoria" como padrão da
// empresa. O padrão passa a valer para ele, e a Diretoria não gere usuários.
console.log("\n9. Quem gere acesso não tira de si a gestão de usuários");
const diretoriaPadrao = { nome: diretoria.nome, permissoes: diretoria.permissoes as string[] };
conferir("ADMIN sob a Diretoria perderia", perderiaGestaoDeUsuarios("ADMIN", diretoriaPadrao), true);
conferir("ADMIN nas regras do papel não perde", perderiaGestaoDeUsuarios("ADMIN", null), false);
conferir("GESTOR devolvido ao papel perderia", perderiaGestaoDeUsuarios("GESTOR", null), true);
conferir(
  "perfil com gerir-usuarios mantém",
  perderiaGestaoDeUsuarios("GESTOR", { nome: "RH", permissoes: ["gerir-usuarios"] }),
  false
);

// ------------------------------------------------- 10. para onde vai quem caiu em /sem-acesso
console.log("\n10. Primeira tela liberada");
conferir("com o painel, vai ao painel", rotaInicial(new Set(["painel", "auditoria"]))?.href, "/");
conferir("perfil só de conformidade abre a conformidade", rotaInicial(new Set(["conformidade", "gerir-conformidade"]))?.href, "/conformidade");
conferir("só gerir usuários abre a tela de usuários", rotaInicial(new Set(["gerir-usuarios"]))?.href, "/usuarios");
conferir("nada liberado não tem destino", rotaInicial(new Set()), null);

// ------------------------------------------------- 11. tipo do upload cobrado no servidor
console.log("\n11. Upload de conformidade só com os formatos anunciados");
conferir("PDF aceito", extensaoAceita("relatorio.pdf"), true);
conferir("extensão em maiúsculas aceita", extensaoAceita("EMAIL.MSG"), true);
conferir("HTML recusado", extensaoAceita("pagina.html"), false);
conferir("SVG recusado", extensaoAceita("logo.svg"), false);
conferir("extensão dupla vale pela última", extensaoAceita("relatorio.pdf.exe"), false);
conferir("sem extensão recusado", extensaoAceita("relatorio"), false);

// ------------------------------------------------- 12. valor digitado em parâmetro
console.log("\n12. Valor em reais digitado no modelo de gestão");
conferir("vazio desliga (null)", lerReaisEmCents("  "), null);
conferir("número simples", lerReaisEmCents("10000"), 1_000_000);
conferir("formato brasileiro", lerReaisEmCents("10.000,50"), 1_000_050);
conferir("com R$ na frente", lerReaisEmCents("R$ 10.000,00"), 1_000_000);
conferir("volta do valor exibido (12345,67)", lerReaisEmCents("12345,67"), 1_234_567);
conferir("texto ilegível é inválido, não vazio", lerReaisEmCents("dez mil"), "invalido");

// ------------------------------------------------- 13. erro redigido antes da tela
//
// Regra do projeto: erro passa por `redigir` antes de ir à tela ou ao banco.
// Toda ação ("use server") que lê `.message` de uma exceção precisa importar
// `redigir` — a checagem é por arquivo, grossa de propósito, para pegar a ação
// nova que devolve `e.message` cru.
console.log("\n13. Ações que devolvem mensagem de exceção passam por redigir");
function arquivosDe(pasta: string): string[] {
  return readdirSync(pasta, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? arquivosDe(join(pasta, e.name)) : /\.tsx?$/.test(e.name) ? [join(pasta, e.name)] : []
  );
}
const semRedigir = arquivosDe(join(__dirname, "..", "src"))
  .filter((f) => {
    const fonte = readFileSync(f, "utf8");
    return /^\s*["']use server["']/m.test(fonte) && /\.message\b/.test(fonte) && !/\bredigir\b/.test(fonte);
  })
  .map((f) => f.slice(f.indexOf("src")));
conferir("nenhuma ação devolve e.message sem redigir", semRedigir, []);
conferir(
  "redigir apaga string de conexão",
  redigir("Can't reach postgresql://user:senha123@db.host:5432/db"),
  "Can't reach postgresql://[REDIGIDO]"
);

console.log(falhas === 0 ? "\nTodos os testes passaram." : `\n${falhas} teste(s) falharam.`);
process.exit(falhas === 0 ? 0 : 1);
