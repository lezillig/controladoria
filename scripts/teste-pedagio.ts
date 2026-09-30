// PEDÁGIO POR CATEGORIA — `npm run teste:pedagio`.
// A categoria segue eixos e rodagem, não a lotação. Referência (roteiro
// VERIFICAR): São Paulo–Santos, praça de R$ 40,60 em categoria 1 por sentido;
// ônibus ida e volta R$ 162,40; van de rodagem simples R$ 81,20.
import { categoriaPedagioDe, tarifaDaPraca, tarifaParaPerfil, type PracaPedagio } from "../src/lib/simulador/pedagio";
import { PERFIS_PADRAO } from "../src/lib/simulador/premissas";

let falhas = 0;
function ok(nome: string, cond: boolean, detalhe = "") {
  if (!cond) falhas++;
  console.log(`${cond ? "  ok  " : "FALHA "} ${nome}${cond ? "" : ` — ${detalhe}`}`);
}
const perfil = (t: string) => PERFIS_PADRAO.find((p) => p.tipo === t)!;
const imigrantes: PracaPedagio = { chave: "imigrantes", praca: "Imigrantes (SP-160)", concessionaria: null, tarifaVan: 40.6, tarifaMicro: null, tarifaOnibus2: null, tarifaOnibus3: null, descontoTagPct: null };

console.log("\nCategoria pelo tipo de veículo");
ok("van e carro: rodagem simples", categoriaPedagioDe(perfil("VAN")) === "RODAGEM_SIMPLES" && categoriaPedagioDe(perfil("CARRO_ADAPTADO")) === "RODAGEM_SIMPLES");
ok("micro e ônibus: 2 eixos", categoriaPedagioDe(perfil("MICRO")) === "DOIS_EIXOS" && categoriaPedagioDe(perfil("ONIBUS_UNIDADE_MOVEL")) === "DOIS_EIXOS");
ok("van de rodagem dupla por escolha", categoriaPedagioDe({ ...perfil("VAN"), categoriaPedagio: "DOIS_EIXOS" }) === "DOIS_EIXOS");

console.log("\nTarifa (São Paulo–Santos, ida e volta = 2 passagens)");
ok("ônibus: R$ 81,20 por passagem → R$ 162,40 ida e volta", tarifaParaPerfil(imigrantes, perfil("ONIBUS"))! * 2 === 162.4, String(tarifaParaPerfil(imigrantes, perfil("ONIBUS"))));
ok("micro: o mesmo do ônibus", tarifaParaPerfil(imigrantes, perfil("MICRO")) === 81.2);
ok("van de rodagem simples: R$ 40,60 por passagem → R$ 81,20", tarifaParaPerfil(imigrantes, perfil("VAN"))! * 2 === 81.2);
ok("3 eixos: triplo", tarifaDaPraca(imigrantes, "TRES_EIXOS") === 121.8);
ok("coluna própria da praça prevalece", tarifaDaPraca({ ...imigrantes, tarifaOnibus2: 80 }, "DOIS_EIXOS") === 80);
ok("desconto da tag", tarifaDaPraca({ ...imigrantes, descontoTagPct: 0.05 }, "RODAGEM_SIMPLES") === 38.57);
ok("praça sem tarifa: nulo, a tela mantém a digitada", tarifaDaPraca({ ...imigrantes, tarifaVan: null }, "DOIS_EIXOS") === null);

console.log(falhas === 0 ? "\nTudo certo.\n" : `\n${falhas} FALHA(S).\n`);
process.exit(falhas === 0 ? 0 : 1);
