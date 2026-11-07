// TODA REGRA DO MOTOR TEM TESTE — `npm run teste:regras-cobertura`.
//
// A revisão de 11/2026 achou 54 regras que nenhum teste exercitava: uma
// mudança no contexto ou num limiar podia calar qualquer uma delas sem o CI
// perceber. Esta trava lê os códigos de regra dos agentes e procura cada um
// nos scripts de teste:
//
//   - regra NOVA sem teste quebra o CI (escreva o teste, ou ponha a regra na
//     lista abaixo com o motivo, numa decisão consciente);
//   - regra da lista que GANHOU teste também quebra, para a lista só encolher.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// As que ainda não têm teste (11/2026). Só se tira daqui.
const SEM_TESTE = new Set([
  "AD-CADASTRO-SEM-DOCUMENTO",
  "AD-CONTA-SEM-MOVIMENTO",
  "AD-DATA-INCOERENTE",
  "AD-SYNC-ATRASADO",
  "AD-SYNC-AUSENTE",
  "AD-SYNC-ERRO",
  "AD-TRATATIVA-PARADA",
  "CB-DEBITO-DUPLICADO",
  "CB-NAO-CONCILIADO",
  "CB-SALDO-MINIMO",
  "CB-SEM-CATEGORIA",
  "CP-ANTECIPACAO",
  "CP-FANTASMA",
  "CP-SEM-CATEGORIA",
  "CP-SEM-CENTRO-CUSTO",
  "CP-SEM-DOCUMENTO",
  "CP-VENC-NAO-UTIL",
  "CR-ATRASO-RECORRENTE",
  "CR-CONCENTRACAO",
  "CR-DESCONTO",
  "CR-INADIMPLENCIA",
  "CR-OS-NAO-FATURADA",
  "CR-PERDA-PROVAVEL",
  "CU-COMBUSTIVEL",
  "CU-CONCENTRACAO-FORNECEDOR",
  "CU-DESPESA-NOVA",
  "CU-OUTLIER",
  "CU-RECORRENTE",
  "CU-VARIACAO",
  "FC-CICLO",
  "FC-DESCASAMENTO",
  "FI-DOC-SEM-NUMERO",
  "FI-NOTA-SEM-TITULO",
  "FI-PIS-COFINS",
  "FI-RECEITA-SEM-NOTA",
  "FR-FORNECEDOR-NOVO-ALTO",
  "FR-FRACIONAMENTO",
  "FR-PAGAMENTO-NAO-UTIL",
  "OP-ALCADA",
  "OP-JUROS-ANO",
  "OP-ONDE-REDUZIR",
  "OP-TARIFAS",
  "RE-COBERTURA-BAIXA",
  "RE-MARGEM-ABAIXO-META",
  "RE-MARGEM-NEGATIVA",
  "RE-VEICULO-CARO",
]);

const raiz = path.resolve(__dirname, "..");
const pastaAgentes = path.join(raiz, "src/lib/controladoria/agents");
const regras = new Set<string>();
for (const f of readdirSync(pastaAgentes)) {
  if (!f.endsWith(".ts")) continue;
  for (const m of readFileSync(path.join(pastaAgentes, f), "utf8").matchAll(/regra: "([A-Z]{2,3}-[A-Z0-9-]+)"/g)) regras.add(m[1]);
}
const testes = readdirSync(path.join(raiz, "scripts"))
  .filter((f) => f.startsWith("teste-") && f.endsWith(".ts") && f !== "teste-regras-cobertura.ts")
  .map((f) => readFileSync(path.join(raiz, "scripts", f), "utf8"))
  .join("\n");

const semTeste = [...regras].filter((r) => !testes.includes(r)).sort();
const novas = semTeste.filter((r) => !SEM_TESTE.has(r));
const ganharam = [...SEM_TESTE].filter((r) => regras.has(r) && testes.includes(r));
const sumiram = [...SEM_TESTE].filter((r) => !regras.has(r));

console.log(`${regras.size} regras; ${semTeste.length} sem teste (lista: ${SEM_TESTE.size}).`);
let falhou = false;
if (novas.length) {
  falhou = true;
  console.log(`FALHA  regra(s) sem teste fora da lista: ${novas.join(", ")}`);
}
if (ganharam.length || sumiram.length) {
  falhou = true;
  console.log(`FALHA  tire da lista (ganharam teste ou não existem mais): ${[...ganharam, ...sumiram].join(", ")}`);
}
if (falhou) process.exit(1);
console.log("Cobertura das regras: tudo certo.");
