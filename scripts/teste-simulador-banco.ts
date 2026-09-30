// TESTES DO SIMULADOR CONTRA UM POSTGRES REAL — `npm run teste:simulador-banco`.
//
// Precisa de TESTE_DATABASE_URL (ver o topo de scripts/teste-sql.ts). Confere:
// a base de custos versionada (reimportar igual não duplica; mudar um valor
// fecha a vigência anterior e a base de uma data passada continua a antiga);
// o histórico importado como estudos, idempotente, com versão reexecutável
// que reproduz o gravado; versões novas numeradas e a definição corrente
// atualizada; lances, resultado e realizado.
import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";

const url = process.env.TESTE_DATABASE_URL;
if (!url) {
  console.log("\nTESTE_DATABASE_URL não definida — pulando o teste de banco do simulador.\n");
  process.exit(0);
}
process.env.DATABASE_URL = url;

let falhas = 0;
function ok(nome: string, passou: boolean, detalhe = "") {
  if (!passou) falhas++;
  console.log(`${passou ? "  ok  " : "FALHA "} ${nome}${passou ? "" : `\n         ${detalhe}`}`);
}
function conferir(nome: string, real: unknown, esperado: unknown) {
  ok(nome, JSON.stringify(real) === JSON.stringify(esperado), `esperado ${JSON.stringify(esperado)}\n         obtido   ${JSON.stringify(real)}`);
}

const EMPRESA = "empresa-simulador-banco";

async function principal() {
  const { prisma } = await import("../src/lib/prisma");
  const { lerGabarito } = await import("../src/lib/simulador/gabarito");
  const { baseVigente, gravarLeitura } = await import("../src/lib/simulador/baseDeCustos");
  const estudos = await import("../src/lib/simulador/estudos");
  const { historicoSaoJoseDosPinhais } = await import("../src/lib/simulador/historico");

  async function limpar() {
    await prisma.simEstudo.deleteMany({ where: { companyId: EMPRESA } });
    for (const m of [prisma.simParametro, prisma.simVeiculoModelo, prisma.simFuncao, prisma.simPedagioPraca, prisma.simReferencia] as unknown as { deleteMany: (a: unknown) => Promise<unknown> }[])
      await m.deleteMany({ where: { companyId: EMPRESA } });
  }
  await limpar();

  // Gabarito preenchido com os exemplos (ver teste-gabarito.ts).
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(readFileSync("docs/simulador_custos_handoff/planilhas_referencia/Gabarito_Dados_Simulador_Custos_AzulMob.xlsx") as unknown as ArrayBuffer);
  for (const nome of ["1_Frota", "2_MaoDeObra", "7_Pedagios_Rotas", "9_Historico_Contratos", "10_Mercado"]) {
    const ws = wb.getWorksheet(nome)!;
    ws.getRow(6).eachCell((cell, col) => (ws.getRow(7).getCell(col).value = cell.value));
  }
  for (const nome of ["3_Jornada", "4_Indiretos", "5_Tributos_Financeiro", "6_Insumos", "8_Regras_Azul"]) {
    const ws = wb.getWorksheet(nome)!;
    ws.eachRow((row, n) => {
      if (n > 4 && row.getCell(5).value !== null) row.getCell(3).value = row.getCell(5).value;
    });
  }
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());

  console.log("BASE DE CUSTOS VERSIONADA");
  const leitura = await lerGabarito(buffer);
  const t1 = new Date(2026, 8, 1);
  const r1 = await gravarLeitura(EMPRESA, leitura, { fonte: "Gabarito v1", autor: "teste", em: t1 });
  ok("primeira importação: tudo novo", r1.parametros.novos > 50 && r1.veiculos.novos === 1 && r1.funcoes.novos === 1, JSON.stringify(r1));
  const r2 = await gravarLeitura(EMPRESA, leitura, { fonte: "Gabarito v1 de novo", autor: "teste", em: new Date(2026, 8, 2) });
  conferir("reimportar igual: nada novo nem alterado", [r2.parametros.novos, r2.parametros.alterados, r2.veiculos.alterados], [0, 0, 0]);
  const diesel = leitura.parametros.find((p) => p.chave === "diesel_rs_l")!;
  const t3 = new Date(2026, 8, 20);
  const r3 = await gravarLeitura(
    EMPRESA,
    { ...leitura, parametros: leitura.parametros.map((p) => (p.chave === "diesel_rs_l" ? { ...diesel, valor: 6.49 } : p)) },
    { fonte: "Gabarito v2", autor: "teste", em: t3 }
  );
  conferir("diesel mudou: uma alteração", [r3.parametros.alterados, r3.parametros.novos], [1, 0]);
  conferir("base de hoje: diesel novo", (await baseVigente(EMPRESA, new Date(2026, 8, 25))).parametros.get("diesel_rs_l")?.valor, 6.49);
  conferir("base de 10/09: diesel antigo (vigência fechada, não apagada)", (await baseVigente(EMPRESA, new Date(2026, 8, 10))).parametros.get("diesel_rs_l")?.valor, 6.15);
  conferir("registros de diesel: dois", await prisma.simParametro.count({ where: { companyId: EMPRESA, chave: "diesel_rs_l" } }), 2);
  const base = await baseVigente(EMPRESA);
  conferir("van na base com FIPE", base.veiculos[0].valorFipe, 285000);

  console.log("\nHISTÓRICO COMO ESTUDOS");
  const h1 = await estudos.importarHistorico(EMPRESA, "teste");
  conferir("dois estudos criados", h1.criados, ["PE 036/2026", "PE 089/2026-SERMALI"]);
  const h2 = await estudos.importarHistorico(EMPRESA, "teste");
  conferir("reimportar: nada criado", [h2.criados.length, h2.existentes.length], [0, 2]);
  const sjp = await prisma.simEstudo.findFirstOrThrow({ where: { companyId: EMPRESA, numeroEdital: "PE 089/2026-SERMALI" } });
  const carregado = (await estudos.carregarEstudo(EMPRESA, sjp.id))!;
  conferir("SJP: 2 itens, 7 rotas, 17 regras", [carregado.itens.length, carregado.rotas.length, carregado.estudo.regras.length], [2, 7, 17]);
  conferir("versão 1 lançada", carregado.versoes.map((v) => [v.versao, v.status]), [[1, "LANCADA"]]);
  ok("preço da versão: R$ 9,31", Math.abs((carregado.versoes[0].precoKm ?? 0) - 9.31) < 1e-9, `${carregado.versoes[0].precoKm}`);
  const v1 = carregado.estudo.simulacoes[0];
  const re = estudos.reexecutar(v1);
  conferir("reexecutar o snapshot confere com o gravado", re.confere, true);
  conferir("a entrada do banco reproduz a da semente", estudos.reexecutar({ entrada: historicoSaoJoseDosPinhais().entrada, resultado: v1.resultado }).confere, true);

  console.log("\nNOVA VERSÃO");
  const inicial = await estudos.entradaInicial(EMPRESA, carregado);
  conferir("abre da última versão", inicial.versaoBase, 1);
  const entrada2 = { ...inicial.entrada, premissas: { ...inicial.entrada.premissas, contrato: { ...inicial.entrada.premissas.contrato, utilizacao: 0.9 } } };
  const s2 = await estudos.salvarVersao(EMPRESA, sjp.id, { entrada: entrada2, origem: inicial.origem, status: "RASCUNHO", observacoes: "90%", baseEm: null }, "teste");
  conferir("versão 2", s2.versao, 2);
  const depois = (await estudos.carregarEstudo(EMPRESA, sjp.id))!;
  conferir("duas versões, da mais nova à mais antiga", depois.versoes.map((v) => v.versao), [2, 1]);
  const v1Aberta = await estudos.entradaInicial(EMPRESA, depois, v1.id);
  conferir("abrir a versão 1 mostra a conta dela", v1Aberta.entrada.premissas.contrato.utilizacao, 0.85);
  const ruim = await estudos.salvarVersao(EMPRESA, sjp.id, { entrada: { ...entrada2, rotas: [{ ...entrada2.rotas[0], item: "9" }] }, origem: {}, status: "RASCUNHO", observacoes: null, baseEm: null }, "teste");
  ok("rota apontando item inexistente é recusada", Boolean(ruim.erro), JSON.stringify(ruim));
  conferir("… e nada é gravado", (await prisma.simSimulacao.count({ where: { estudoId: sjp.id } })), 2);

  console.log("\nESTUDO NOVO A PARTIR DA BASE");
  const novoId = await estudos.criarEstudo(EMPRESA, { tipo: "CONTRATO_PRIVADO", nome: "Fretamento fábrica X", cliente: "Fábrica X", tipoServico: "FRETAMENTO", criterioJulgamento: "ITEM", unidadePreco: "BINOMIA", vigenciaMeses: 24 }, "teste");
  const novo = (await estudos.carregarEstudo(EMPRESA, novoId))!;
  const ini = await estudos.entradaInicial(EMPRESA, novo);
  conferir("sem versão: premissas da base", [ini.versaoBase, ini.entrada.premissas.variaveis.dieselLitro, ini.origem["variaveis.dieselLitro"].origem], [null, 6.49, "BASE"]);
  conferir("perfis de veículo da base (a van do Gabarito)", ini.entrada.premissas.perfis?.map((p) => p.tipo), ["VAN"]);
  conferir("vigência do estudo", ini.entrada.premissas.contrato.vigenciaMeses, 24);
  conferir("unidade do estudo", ini.entrada.unidadePreco, "BINOMIA");
  conferir("margens da base", estudos.regrasDeMargem(base), { margemMinima: 0.07, margemAlvo: 0.12 });

  console.log("\nLANCES, RESULTADO E REALIZADO");
  await estudos.registrarLance(EMPRESA, sjp.id, { fase: "LANCE", dataHora: new Date(), precos: [{ item: "1", preco: 9.31 }, { item: "2", preco: 9.31 }], valorTotal: null, observacao: null, simulacaoId: v1.id }, "teste");
  conferir("um lance", await prisma.simLance.count({ where: { estudoId: sjp.id } }), 1);
  await estudos.registrarResultado(EMPRESA, sjp.id, { status: "GANHO", posicao: 1, vencedor: "Azul", precoKm: 9.31, valorTotal: null, data: null, observacao: null });
  conferir("status ganho", (await prisma.simEstudo.findUnique({ where: { id: sjp.id } }))?.status, "GANHO");
  await estudos.gravarRealizado(EMPRESA, sjp.id, { competencia: "2027-01", kmRealizado: 30000 }, "Ituran", "teste");
  await estudos.gravarRealizado(EMPRESA, sjp.id, { competencia: "2027-01", custoCombustivel: 25000 }, "controladoria", "teste");
  const real = await prisma.simContratoRealizado.findMany({ where: { estudoId: sjp.id } });
  conferir("realizado por partes, um registro com os dois", [real.length, Number(real[0].kmRealizado), Number(real[0].custoCombustivel)], [1, 30000, 25000]);
  const recusa = await estudos.gravarRealizado("outra-empresa", sjp.id, { competencia: "2027-02", kmRealizado: 1 }, "x", null);
  ok("outra empresa não grava no estudo", Boolean(recusa.erro));

  console.log("\nEXPORTAR — versão salva e rascunho, sem gravar nada");
  const { exportarEstudo } = await import("../src/lib/simulador/exportacaoEstudo");
  const versoesAntes = await prisma.simSimulacao.count({ where: { estudoId: sjp.id } });
  const daVersao = await exportarEstudo(EMPRESA, sjp.id, { simulacaoId: v1.id });
  ok("versão salva vira .xlsx", !("erro" in daVersao) && daVersao.conteudo.subarray(0, 2).toString() === "PK" && /_v1\.xlsx$/.test(daVersao.nome), JSON.stringify("erro" in daVersao ? daVersao : daVersao.nome));
  const rascunho = await exportarEstudo(EMPRESA, sjp.id, { entrada: historicoSaoJoseDosPinhais().entrada });
  ok("rascunho vira .xlsx", !("erro" in rascunho) && /_rascunho\.xlsx$/.test(rascunho.nome));
  const invalido = await exportarEstudo(EMPRESA, sjp.id, { entrada: { ...historicoSaoJoseDosPinhais().entrada, itens: [] } });
  ok("rascunho inválido é recusado pela mesma validação de salvar", "erro" in invalido);
  const deOutra = await exportarEstudo("outra-empresa", sjp.id, { simulacaoId: v1.id });
  ok("outra empresa não exporta o estudo", "erro" in deOutra);
  conferir("exportar não cria versão", await prisma.simSimulacao.count({ where: { estudoId: sjp.id } }), versoesAntes);

  await limpar();
  await prisma.$disconnect();
  console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
  process.exit(falhas === 0 ? 0 : 1);
}
principal().catch(async (e) => {
  console.error("\nO teste não completou:", e);
  process.exit(1);
});
