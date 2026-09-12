// TESTES DO ALERTA POR EXCEÇÃO — `npm run teste:alerta`.
//
// A regra que decide o que entra no e-mail é pura e mora em decidirAlerta.
// Errar para um lado manda e-mail todo dia (e o alerta vira o ruído que
// existe para evitar); errar para o outro cala um achado crítico que ninguém
// leu. Os dois erros são caros, e por isso a decisão tem teste próprio.
import { CARENCIA_CAIXA_DIAS, decidirAlerta, montarAlerta, type AchadoParaAlerta } from "../src/lib/controladoria/alerta";

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(
    `${ok ? "  ok  " : "FALHA "} ${nome}${ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         obtido   ${JSON.stringify(real)}`}`
  );
}

const achado = (id: string, over: Partial<AchadoParaAlerta> = {}): AchadoParaAlerta => ({
  id,
  regra: "CP-DUPLICIDADE",
  titulo: `Achado ${id}`,
  severidade: "CRITICA",
  valorCents: 100_000,
  impactoCents: null,
  recomendacao: "Conferir.",
  conexaoApelido: "AZUL",
  entidadeRef: null,
  ...over,
});

const agora = new Date("2026-09-12T06:00:00Z");
const dias = (n: number) => new Date(agora.getTime() - n * 86_400_000);
const projecaoOk = [
  { dias: 7, saldoProjetadoCents: 100 },
  { dias: 30, saldoProjetadoCents: 50 },
];
const projecaoRuim = [
  { dias: 7, saldoProjetadoCents: 100 },
  { dias: 30, saldoProjetadoCents: -5_000 },
  { dias: 60, saldoProjetadoCents: -9_000 },
];

console.log("\n1. Achado crítico alerta uma vez");
{
  const d = decidirAlerta({ achadosCriticosAbertos: [achado("a"), achado("b")], jaAlertados: new Set(), projecao: projecaoOk, ultimoAlertaCaixaEm: null, agora });
  conferir("dois novos entram", d.achados.map((a) => a.id), ["a", "b"]);
  conferir("caixa ok não entra", d.caixa, null);
}
{
  const d = decidirAlerta({ achadosCriticosAbertos: [achado("a"), achado("b")], jaAlertados: new Set(["a"]), projecao: projecaoOk, ultimoAlertaCaixaEm: null, agora });
  conferir("já alertado não repete", d.achados.map((a) => a.id), ["b"]);
}
{
  const d = decidirAlerta({ achadosCriticosAbertos: [achado("a")], jaAlertados: new Set(["a"]), projecao: projecaoOk, ultimoAlertaCaixaEm: null, agora });
  conferir("nada novo = nada a alertar", [d.achados.length, d.caixa], [0, null]);
}

console.log("\n2. Caixa negativo: o horizonte mais curto, com carência");
{
  const d = decidirAlerta({ achadosCriticosAbertos: [], jaAlertados: new Set(), projecao: projecaoRuim, ultimoAlertaCaixaEm: null, agora });
  conferir("primeira vez alerta o horizonte mais curto", d.caixa, { dias: 30, saldoProjetadoCents: -5_000 });
}
{
  const d = decidirAlerta({ achadosCriticosAbertos: [], jaAlertados: new Set(), projecao: projecaoRuim, ultimoAlertaCaixaEm: dias(1), agora });
  conferir("alertado ontem: silêncio", d.caixa, null);
}
{
  const d = decidirAlerta({ achadosCriticosAbertos: [], jaAlertados: new Set(), projecao: projecaoRuim, ultimoAlertaCaixaEm: dias(CARENCIA_CAIXA_DIAS + 1), agora });
  conferir("passada a carência, alerta de novo", d.caixa?.dias, 30);
}
{
  // Achado novo continua saindo mesmo com o caixa em carência: são razões
  // independentes.
  const d = decidirAlerta({ achadosCriticosAbertos: [achado("z")], jaAlertados: new Set(), projecao: projecaoRuim, ultimoAlertaCaixaEm: dias(1), agora });
  conferir("achado novo sai, caixa em carência não", [d.achados.length, d.caixa], [1, null]);
}

console.log("\n3. O e-mail");
{
  const m = montarAlerta(
    { achados: [achado("a", { titulo: "Fornecedor & Cia pago em duplicidade", impactoCents: 250_000 })], caixa: { dias: 30, saldoProjetadoCents: -5_000 } },
    new Date("2026-09-11T12:00:00Z"),
    1_000_000
  );
  conferir("assunto diz o que há", m.assunto, "[Alerta] 1 achado(s) crítico(s) novo(s) · caixa negativo em 30 dias — 11/09/2026");
  conferir("html escapa o texto do achado", m.html.includes("Fornecedor &amp; Cia"), true);
  // fmtBRL usa espaço não separável depois de "R$"; o teste olha só os dígitos.
  conferir("texto traz o valor de impacto", m.texto.includes("2.500,00"), true);
  conferir("texto traz o caixa negativo", /-\s?R\$\s?50,00|R\$\s?-50,00/.test(m.texto), true);
}
{
  const m = montarAlerta({ achados: [], caixa: { dias: 7, saldoProjetadoCents: -1 } }, new Date("2026-09-11T12:00:00Z"), 0);
  conferir("só caixa: assunto sem achados", m.assunto.startsWith("[Alerta] caixa negativo em 7 dias"), true);
}

console.log(falhas === 0 ? "\nTodos os testes passaram.\n" : `\n${falhas} FALHA(S).\n`);
process.exit(falhas === 0 ? 0 : 1);
