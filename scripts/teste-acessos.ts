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
import { PERMISSOES, PERFIS_SUGERIDOS, permissoesDoPapel, pode, resolverAcesso } from "../src/lib/acessos";
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

console.log(falhas === 0 ? "\nTodos os testes passaram." : `\n${falhas} teste(s) falharam.`);
process.exit(falhas === 0 ? 0 : 1);
