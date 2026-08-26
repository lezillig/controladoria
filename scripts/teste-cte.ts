// TESTES DA CONFERENCIA DE CT-e — `npm run teste:cte`.
//
// Nao precisa de banco: `cruzarCte` e a regra separada da consulta justamente
// para poder ser exercitada assim. A lista de entrada e a real, colada pelo
// usuario, e cada caso aqui e um erro que ja aconteceu de verdade — inclusive
// o do CT-e 1279, que a conferencia apontava como nao cobrado porque o tipo do
// titulo na Omie nao dizia CT-e (caso 3b).
import { lerListaDeCte, cruzarCte, type TituloCte } from "../src/lib/controladoria/cte";

// Lista real colada pelo usuário (janeiro/2026), no layout de 8 colunas da Omie.
const JANEIRO = `Data\tStatus\tCTE\tCFOP\tTipo\tTomador (CNPJ/CPF)\tTomador (Razão Social)\tTotal Frete
30/01/2026\tCancelada\t1166\t5357\tNormal\t08.082.743/0001-60\tSECRETARIA MUNICIPAL DA PESSOA COM DEFICIENCIA\t4.200,00
30/01/2026\tAutorizada\t1165\t5357\tNormal\t61.186.888/0002-74\tSPAL INDUSTRIA BRASILEIRA DE BEBIDAS S/A\t7.241,42
23/01/2026\tCancelada\t1164\t5357\tNormal\t09.334.219/0001-00\tFABIANO TELES DE SOUSA SALES LOCACOES LTDA\t1.700,00
23/01/2026\tAutorizada\t1163\t5357\tNormal\t61.186.888/0002-74\tSPAL INDUSTRIA BRASILEIRA DE BEBIDAS S/A\t58.500,00
23/01/2026\tAutorizada\t1162\t5357\tNormal\t61.186.888/0002-74\tSPAL INDUSTRIA BRASILEIRA DE BEBIDAS S/A\t14.940,00
23/01/2026\tAutorizada\t1161\t5357\tNormal\t61.186.888/0002-74\tSPAL INDUSTRIA BRASILEIRA DE BEBIDAS S/A\t218.497,50
23/01/2026\tAutorizada\t1160\t5357\tNormal\t61.186.888/0075-20\tSPAL INDUSTRIA BRASILEIRA DE BEBIDAS S/A\t52.000,00
23/01/2026\tAutorizada\t1159\t5357\tNormal\t61.186.888/0075-20\tSPAL INDUSTRIA BRASILEIRA DE BEBIDAS S/A\t52.000,00
20/01/2026\tCancelada\t1158\t5357\tNormal\t09.334.219/0001-00\tFABIANO TELES DE SOUSA SALES LOCACOES LTDA\t1.700,00
12/01/2026\tCancelada\t1157\t5357\tNormal\t08.082.743/0001-60\tSECRETARIA MUNICIPAL DA PESSOA COM DEFICIENCIA\t2.100,00
09/01/2026\tCancelada\t1156\t5357\tNormal\t08.082.743/0001-60\tSECRETARIA MUNICIPAL DA PESSOA COM DEFICIENCIA\t1.500,00
09/01/2026\tCancelada\t1155\t5357\tNormal\t08.082.743/0001-60\tSECRETARIA MUNICIPAL DA PESSOA COM DEFICIENCIA\t2.100,00
08/01/2026\tAutorizada\t1154\t5357\tNormal\t61.186.888/0225-96\tSPAL INDUSTRIA BRASILEIRA DE BEBIDAS S/A\t85.799,85
02/01/2026\tAutorizada\t1153\t5357\tNormal\t61.186.888/0003-55\tSPAL INDUSTRIA BRASILEIRA DE BEBIDAS S/A\t44.000,00
02/01/2026\tAutorizada\t1152\t5357\tNormal\t61.186.888/0018-31\tSPAL INDUSTRIA BRASILEIRA DE BEBIDAS S/A\t77.500,00
02/01/2026\tCancelada\t1151\t5357\tNormal\t61.186.888/0225-96\tSPAL INDUSTRIA BRASILEIRA DE BEBIDAS S/A\t82.000,00
02/01/2026\tAutorizada\t1150\t5357\tNormal\t46.523.023/0001-81\tMUNICIPIO DE CAJAMAR\t102.449,20`;

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "  ok  " : "FALHA "} ${nome}${ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         obtido   ${JSON.stringify(real)}`}`);
}

// ---------------------------------------------------------------- 1. leitura
console.log("\n1. Leitura da lista colada (layout de 8 colunas)");
const { itens, ignoradas } = lerListaDeCte(JANEIRO);
conferir("17 CT-e lidos", itens.length, 17);
conferir("nenhuma linha ignorada", ignoradas.length, 0);
conferir("7 cancelados", itens.filter((i) => i.cancelado).length, 7);
conferir("10 autorizados", itens.filter((i) => !i.cancelado).length, 10);
conferir("valor com milhar e centavo", itens.find((i) => i.numero === "1161")?.valorCents, 21_849_750);
conferir("data brasileira", itens.find((i) => i.numero === "1150")?.data.toISOString().slice(0, 10), "2026-01-02");
conferir("tomador da última coluna", itens.find((i) => i.numero === "1150")?.tomador, "MUNICIPIO DE CAJAMAR");
conferir(
  "soma dos autorizados",
  itens.filter((i) => !i.cancelado).reduce((a, i) => a + i.valorCents, 0),
  71_292_797
);

// ------------------------------------------------------- 2. outros separadores
console.log("\n2. Outros formatos");
conferir("ponto e vírgula", lerListaDeCte("Nº;Data;Tomador;Valor;Status\n1150;02/01/2026;CAJAMAR;102.449,20;Autorizada").itens.length, 1);
conferir(
  "linhas de filtro antes do cabeçalho",
  lerListaDeCte("Relatório de CT-e\nPeríodo: 01/01/2026\nNº\tData\tValor\tStatus\n1150\t02/01/2026\t102.449,20\tAutorizada").itens.length,
  1
);
conferir(
  "rodapé de total é reportado, não engolido",
  lerListaDeCte("Nº\tData\tValor\tStatus\n1150\t02/01/2026\t102.449,20\tAutorizada\nTOTAL\t\t102.449,20\t").ignoradas.length,
  1
);
conferir(
  '"Cancelamento Rejeitado" NÃO é cancelado',
  lerListaDeCte("Nº\tData\tValor\tStatus\n1150\t02/01/2026\t100,00\tCancelamento Rejeitado").itens[0]?.cancelado,
  false
);

// --------------------------------------------------------------- 3. cruzamento
console.log("\n3. Cruzamento com os títulos");

const t = (
  p: Omit<Partial<TituloCte>, "data"> & { id: string; valorCents: number; data: string }
): TituloCte => ({
  numero: null,
  situacao: "Recebido",
  cancelado: false,
  parceiro: null,
  tipo: "CTE",
  ...p,
  data: new Date(p.data),
});

// 3a. Casamento por número, mesmo com o número sujo do lado da Omie.
{
  const r = cruzarCte(lerListaDeCte(JANEIRO).itens, [
    t({ id: "a", numero: "CTE 001161", valorCents: 21_849_750, data: "2026-01-23" }),
  ]);
  const l = r.linhas.find((x) => x.numero === "1161");
  conferir('"CTE 001161" casa com 1161', l?.casadoPor, "número");
  conferir("e confere", l?.tipo, "casado");
}

// 3b. O caso 1279: o título existe mas o tipo do documento não diz CT-e.
//     Antes do conserto, isto era apontado como "emitido e não cobrado".
{
  const r = cruzarCte(lerListaDeCte(JANEIRO).itens, [
    t({ id: "a", numero: "1150", valorCents: 10_244_920, data: "2026-01-02", tipo: "OUTROS" }),
  ]);
  const l = r.linhas.find((x) => x.numero === "1150");
  conferir("título com tipo errado ainda casa por número", l?.tipo, "casado");
}

// 3c. Dois CT-e de R$ 52.000,00 no mesmo dia — o motivo de casar por número primeiro.
{
  const r = cruzarCte(lerListaDeCte(JANEIRO).itens, [
    t({ id: "a", numero: "1159", valorCents: 5_200_000, data: "2026-01-23" }),
    t({ id: "b", numero: "1160", valorCents: 5_200_000, data: "2026-01-23" }),
  ]);
  conferir("os dois casam, cada um com o seu", r.casados, 2);
  conferir("nenhum sobra", r.linhas.filter((x) => x.tipo === "titulo_sem_cte").length, 0);
}

// 3d. Cancelado com título vivo: 1151 (R$ 82.000) cancelado, reemitido como 1154.
{
  const r = cruzarCte(lerListaDeCte(JANEIRO).itens, [
    t({ id: "a", numero: "1151", valorCents: 8_200_000, data: "2026-01-02" }),
  ]);
  const l = r.linhas.find((x) => x.numero === "1151");
  conferir("1151 cancelado com título vivo", l?.tipo, "cancelado_com_titulo");
  conferir("valor somado no destaque", r.canceladoComTituloCents, 8_200_000);
  conferir("1154 aparece como não cobrado", r.linhas.find((x) => x.numero === "1154")?.tipo, "autorizado_sem_titulo");
}

// 3e. Cancelado SEM título é o caso certo — não vira linha.
{
  const r = cruzarCte(lerListaDeCte(JANEIRO).itens, []);
  conferir("nenhum cancelado vira linha", r.linhas.filter((x) => x.tipo === "cancelado_com_titulo").length, 0);
  conferir("os 10 autorizados viram 'não cobrado'", r.linhas.filter((x) => x.tipo === "autorizado_sem_titulo").length, 10);
  conferir("e somam o total autorizado", r.autorizadoSemTituloCents, 71_292_797);
}

// 3f. Valor divergente: cobrança acima do documento (o caso CAJAMAR).
{
  const r = cruzarCte(lerListaDeCte(JANEIRO).itens, [
    t({ id: "a", numero: "1150", valorCents: 11_006_685, data: "2026-01-02" }),
  ]);
  const l = r.linhas.find((x) => x.numero === "1150");
  conferir("1150 com valor divergente", l?.tipo, "valor_divergente");
  conferir("diferença de R$ 7.617,65", r.divergenciaDeValorCents, 761_765);
}

// 3g. Casamento fraco: título sem número, mesmo valor, 3 dias depois.
{
  const r = cruzarCte(lerListaDeCte(JANEIRO).itens, [
    t({ id: "a", numero: null, valorCents: 4_400_000, data: "2026-01-05" }),
  ]);
  const l = r.linhas.find((x) => x.numero === "1153");
  conferir("casa por valor+data", l?.casadoPor, "valor+data");
  conferir("e a tela vai dizer que foi fraco", l?.tipo, "casado");
  conferir("contado como sem número", r.titulosSemNumero, 1);
}

// 3h. Fora da tolerância de 7 dias não casa.
{
  const r = cruzarCte(lerListaDeCte(JANEIRO).itens, [
    t({ id: "a", numero: null, valorCents: 4_400_000, data: "2026-01-20" }),
  ]);
  conferir("18 dias depois não casa", r.linhas.find((x) => x.numero === "1153")?.tipo, "autorizado_sem_titulo");
}

// 3i. Título de outro tipo puxado pelo valor não vira "título sem CT-e".
{
  const r = cruzarCte(
    [lerListaDeCte(JANEIRO).itens[0]!], // só o 1166, cancelado
    [t({ id: "a", numero: "9656", valorCents: 2_662_709, data: "2026-01-15", tipo: "RPS" })]
  );
  conferir("NFS-e de valor parecido não vira diferença", r.linhas.length, 0);
}

// 3j. Título CT-e de verdade que sobra, sim, vira diferença.
{
  const r = cruzarCte(
    [lerListaDeCte(JANEIRO).itens[0]!],
    [t({ id: "a", numero: "1149", valorCents: 3_000_000, data: "2026-01-15", parceiro: "SPAL" })]
  );
  conferir("CT-e espelhado sem par na lista aparece", r.linhas[0]?.tipo, "titulo_sem_cte");
}

// 3k. Ordem de leitura: o que custa dinheiro primeiro.
{
  const r = cruzarCte(lerListaDeCte(JANEIRO).itens, [
    t({ id: "a", numero: "1151", valorCents: 8_200_000, data: "2026-01-02" }),
    t({ id: "b", numero: "1149", valorCents: 100, data: "2026-01-15" }),
  ]);
  conferir("cancelado com título vivo vem primeiro", r.linhas[0]?.tipo, "cancelado_com_titulo");
  conferir("o que confere vem por último", r.linhas[r.linhas.length - 1]?.tipo, "titulo_sem_cte");
}

// ---------------------------------------------------------------- 4. regressão
//
// TRÊS CASOS REAIS QUE UMA ANÁLISE MINHA, FEITA POR FORA, DEU COMO "EMITIDO E
// NÃO COBRADO". Os três estavam cobrados na Omie, e dois já recebidos. O
// usuário conferiu um a um e mostrou os títulos.
//
// O que os três têm em comum é o que quase certamente derrubou aquela análise:
// o NOME DO CLIENTE NO TÍTULO É DIFERENTE DO TOMADOR DO CT-e. "GM- HUB
// FACILITIES" x "GF MENEZES EVENTOS", "SERVICO SOCIAL DA INDUSTRIA - SESI" x
// "SESI SUZANO", "MUNICIPIO DE CAMPINAS" x "PREFEITURA MUNICIPAL DE CAMPINAS".
// São a mesma empresa com cadastro diferente — situação normal num ERP, e
// motivo nenhum para dizer que a nota não foi faturada.
//
// O cruzamento DESTE módulo acerta os três porque casa por NÚMERO primeiro e
// nunca usa o nome. Estes casos ficam aqui para que continue assim: o dia em
// que alguém acrescentar o parceiro ao casamento, três testes quebram e
// explicam por quê.
console.log("\n4. Regressão: nome do cliente diferente do tomador do CT-e");
{
  const lista = `Data\tStatus\tCTE\tCFOP\tTipo\tTomador (CNPJ/CPF)\tTomador (Razão Social)\tTotal Frete
22/04/2026\tAutorizada\t1223\t5357\tNormal\t23730540000126\tGM- HUB FACILITIES MARKETING E EVENTOS LTDA\t1.150,00
06/05/2026\tAutorizada\t1237\t5357\tNormal\t03667884003065\tSERVICO SOCIAL DA INDUSTRIA - SESI\t2.200,00
09/06/2026\tAutorizada\t1262\t5357\tNormal\t51885242000140\tMUNICIPIO DE CAMPINAS\t2.800,00`;

  const r = cruzarCte(lerListaDeCte(lista).itens, [
    t({ id: "r1", numero: "1223", valorCents: 115_000, data: "2026-04-17", parceiro: "GF MENEZES EVENTOS" }),
    t({ id: "r2", numero: "1237", valorCents: 220_000, data: "2026-06-01", parceiro: "SESI SUZANO" }),
    t({ id: "r3", numero: "1262", valorCents: 280_000, data: "2026-06-10", parceiro: "PREFEITURA MUNICIPAL DE CAMPINAS" }),
  ]);

  conferir("os três casam", r.casados, 3);
  conferir("nenhum aparece como não cobrado", r.linhas.filter((l) => l.tipo === "autorizado_sem_titulo").length, 0);
  conferir("e o casamento é pelo número, não pelo nome", r.linhas[0]?.casadoPor, "número");
  // O título do 1223 vence CINCO DIAS ANTES da emissão do CT-e. Casar só por
  // valor e data exigiria acertar a direção da tolerância; por número, a data
  // deixa de ser o critério e vira só desempate.
  conferir("título anterior à emissão do CT-e também casa", r.linhas.some((l) => l.numero === "1223" && l.tipo === "casado"), true);
}

console.log(falhas === 0 ? "\nTodos os testes passaram.\n" : `\n${falhas} FALHA(S).\n`);
process.exit(falhas === 0 ? 0 : 1);
