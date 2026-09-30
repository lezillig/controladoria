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
  const comPraca = await estudos.salvarVersao(
    EMPRESA,
    sjp.id,
    { entrada: { ...entrada2, rotas: entrada2.rotas.map((x, k) => (k === 0 ? { ...x, pracaPedagio: "Imigrantes" } : x)) }, origem: {}, status: "RASCUNHO", observacoes: "praça", baseEm: null },
    "teste"
  );
  const reaberto = await estudos.entradaInicial(EMPRESA, (await estudos.carregarEstudo(EMPRESA, sjp.id))!);
  conferir("a praça de pedágio da rota volta ao reabrir", [comPraca.versao, reaberto.entrada.rotas[0].pracaPedagio ?? null, reaberto.entrada.rotas[1].pracaPedagio ?? null], [3, "Imigrantes", null]);

  console.log("\nESTUDO NOVO A PARTIR DA BASE");
  const novoId = await estudos.criarEstudo(EMPRESA, { tipo: "CONTRATO_PRIVADO", nome: "Fretamento fábrica X", cliente: "Fábrica X", tipoServico: "FRETAMENTO", criterioJulgamento: "ITEM", unidadePreco: "BINOMIA", vigenciaMeses: 24 }, "teste");
  const novo = (await estudos.carregarEstudo(EMPRESA, novoId))!;
  const ini = await estudos.entradaInicial(EMPRESA, novo);
  conferir("sem versão: premissas da base", [ini.versaoBase, ini.entrada.premissas.variaveis.dieselLitro, ini.origem["variaveis.dieselLitro"].origem], [null, 6.49, "BASE"]);
  conferir("perfis de veículo da base (a van do Gabarito)", ini.entrada.premissas.perfis?.map((p) => p.tipo), ["VAN"]);
  conferir("vigência do estudo", ini.entrada.premissas.contrato.vigenciaMeses, 24);
  conferir("unidade do estudo", ini.entrada.unidadePreco, "BINOMIA");
  conferir("margens da base", estudos.regrasDeMargem(base), { margemMinima: 0.07, margemAlvo: 0.12 });
  const eventualId = await estudos.criarEstudo(EMPRESA, { tipo: "ORCAMENTO_INTERNO", nome: "Excursão", cliente: "Clube Y", tipoServico: "FRETAMENTO_EVENTUAL", criterioJulgamento: "ITEM", unidadePreco: "DIARIA", vigenciaMeses: 1 }, "teste");
  const eventual = await estudos.entradaInicial(EMPRESA, (await estudos.carregarEstudo(EMPRESA, eventualId))!);
  const comTipos = await estudos.criarEstudo(EMPRESA, { tipo: "CONTRATO_PRIVADO", nome: "Executivo", tipoServico: "FRETAMENTO", criterioJulgamento: "ITEM", unidadePreco: "VEICULO_MES", tiposVeiculo: ["CARRO", "VAN"] }, "teste");
  const entradaComTipos = (await estudos.entradaInicial(EMPRESA, (await estudos.carregarEstudo(EMPRESA, comTipos))!)).entrada;
  conferir("tipos escolhidos ao criar, na ordem: carro (padrão, sem modelo na base) e a van da base", entradaComTipos.premissas.perfis?.map((p) => p.tipo), ["CARRO", "VAN"]);
  conferir("fretamento eventual: km da viagem é o cobrado (utilização 100%) e preço por diária", [eventual.entrada.premissas.contrato.utilizacao, eventual.entrada.unidadePreco], [1, "DIARIA"]);
  {
    const pr = eventual.entrada.premissas.preco;
    const esperado = 0.08 * (1 - pr.pis - pr.cofins - Math.max(pr.iss, pr.icms));
    const semPremio = (await estudos.entradaInicial(EMPRESA, novo)).entrada.premissas.preco.despesasSobrePrecoPct;
    ok(
      "fretamento eventual: prêmio de 8% da nota sem tributos nas despesas sobre o preço, sem hora extra",
      Math.abs(pr.despesasSobrePrecoPct - semPremio - esperado) < 1e-6 && eventual.entrada.premissas.pessoal.horaExtraPct === 0 && /cláusula 9/.test(eventual.origem["preco.despesasSobrePrecoPct"]?.fonte ?? ""),
      `${pr.despesasSobrePrecoPct} vs ${semPremio} + ${esperado}`
    );
  }
  const comItens = await estudos.criarEstudo(
    EMPRESA,
    {
      tipo: "LICITACAO",
      nome: "Quatro lotes",
      tipoServico: "FRETAMENTO",
      criterioJulgamento: "ITEM",
      unidadePreco: "KM",
      tiposVeiculo: ["CARRO", "VAN"],
      itens: [
        { descricao: "Lote 1 — vans", tipoVeiculo: "VAN", veiculos: 4, km: 8800, precoMaximoKm: 9.5 },
        { descricao: "Lote 2 — carros", tipoVeiculo: "CARRO", veiculos: 2, km: 5000 },
        { descricao: "Lote 3", veiculos: 1 },
      ],
    },
    "teste"
  );
  const abertoComItens = await estudos.entradaInicial(EMPRESA, (await estudos.carregarEstudo(EMPRESA, comItens))!);
  const perfilDe = (codigo: string | null | undefined) => abertoComItens.entrada.premissas.perfis?.find((p) => p.codigo === codigo)?.tipo ?? null;
  conferir(
    "itens do formulário: descrições, teto e rotas com o perfil do tipo",
    [abertoComItens.entrada.itens.map((i) => i.descricao), abertoComItens.entrada.itens[0].precoMaximoKm, abertoComItens.entrada.rotas.map((r) => [r.item, perfilDe(r.perfilVeiculo)])],
    [["Lote 1 — vans", "Lote 2 — carros", "Lote 3"], 9.5, [["1", "VAN"], ["2", "CARRO"]]]
  );
  const salvoComItens = await estudos.salvarVersao(EMPRESA, comItens, { entrada: abertoComItens.entrada, origem: abertoComItens.origem, status: "RASCUNHO", observacoes: null, baseEm: null }, "teste");
  ok("estudo criado com itens salva a primeira versão", salvoComItens.versao === 1, JSON.stringify(salvoComItens.erro));
  const privado = await estudos.criarEstudo(
    EMPRESA,
    {
      tipo: "CONTRATO_PRIVADO",
      nome: "Fábrica em turnos",
      tipoServico: "FRETAMENTO",
      criterioJulgamento: "ITEM",
      unidadePreco: "VEICULO_MES",
      esfera: "PRIVADO",
      itens: [{ descricao: "Diretoria", veiculos: 1, administrativo: true, turnos: 2, diasMes: 26, horarioInicio: "05:30", horarioFim: "23:00" }],
    },
    "teste"
  );
  const abertoPrivado = await estudos.entradaInicial(EMPRESA, (await estudos.carregarEstudo(EMPRESA, privado))!);
  const salvoPrivado = await estudos.salvarVersao(EMPRESA, privado, { entrada: abertoPrivado.entrada, origem: abertoPrivado.origem, status: "RASCUNHO", observacoes: null, baseEm: null }, "teste");
  const reabertoPrivado = (await estudos.entradaInicial(EMPRESA, (await estudos.carregarEstudo(EMPRESA, privado))!)).entrada.rotas[0];
  conferir(
    "proposta privada: ADM, turnos, dias e horário salvam e voltam",
    [salvoPrivado.versao, reabertoPrivado.administrativo, reabertoPrivado.turnos, reabertoPrivado.diasMes, reabertoPrivado.horarioInicio, reabertoPrivado.horarioFim, reabertoPrivado.horasDia, reabertoPrivado.noturno],
    [1, true, 2, 26, "05:30", "23:00", 17.5, true]
  );
  const horarioRuim = await estudos.salvarVersao(
    EMPRESA,
    privado,
    { entrada: { ...abertoPrivado.entrada, rotas: [{ ...abertoPrivado.entrada.rotas[0], horarioInicio: "25h" }] }, origem: {}, status: "RASCUNHO", observacoes: null, baseEm: null },
    "teste"
  );
  ok("horário inválido é recusado ao salvar", Boolean(horarioRuim.erro), JSON.stringify(horarioRuim));

  console.log("\nAJUSTES DA BASE PELA TELA — vigência nova, nada sobrescrito");
  {
    const ed = await import("../src/lib/simulador/edicaoBase");
    const antes = await prisma.simParametro.findFirst({ where: { companyId: EMPRESA, chave: "diesel_rs_l", vigenciaFim: null } });
    const r1 = await ed.ajustarParametro(EMPRESA, "diesel_rs_l", { valor: 6.79, texto: null }, "teste");
    conferir("diesel ajustado: um alterado", r1.resumo?.parametros, { novos: 0, alterados: 1, inalterados: 0 });
    const agora = await prisma.simParametro.findFirst({ where: { companyId: EMPRESA, chave: "diesel_rs_l", vigenciaFim: null } });
    conferir("vale o novo, com a fonte do ajuste", [Number(agora?.valor), agora?.fonte], [6.79, ed.FONTE_AJUSTE]);
    ok("o anterior fica no histórico com a vigência fechada", Boolean(antes && (await prisma.simParametro.findUnique({ where: { id: antes.id } }))?.vigenciaFim));
    conferir("mesmo valor não grava", (await ed.ajustarParametro(EMPRESA, "diesel_rs_l", { valor: 6.79, texto: null }, "teste")).resumo?.parametros.inalterados, 1);
    const pct = await ed.ajustarParametro(EMPRESA, "margem_alvo", { valor: 0.1, texto: null }, "teste");
    ok("percentual em fração é aceito", !pct.erro);
    ok("chave desconhecida é recusada", Boolean((await ed.ajustarParametro(EMPRESA, "nao_existe", { valor: 1, texto: null }, "teste")).erro));
    ok("negativo é recusado", Boolean((await ed.ajustarParametro(EMPRESA, "diesel_rs_l", { valor: -1, texto: null }, "teste")).erro));
    await ed.voltarAoPadrao(EMPRESA, "diesel_rs_l");
    const semBase = (await baseVigente(EMPRESA)).parametros.get("diesel_rs_l");
    ok("voltar ao padrão tira o diesel da base vigente", semBase === undefined);
    conferir("padrão do simulador para o diesel", ed.padraoDoSimulador("diesel_rs_l") !== null, true);
    const v = await ed.salvarRegistro(EMPRESA, "veiculo", { tipo: "Carro", modelo: "Corolla", ano: 2025, valorCompra: 160000, consumoKmL: 12 }, null, "teste");
    conferir("modelo novo da frota", v.resumo?.veiculos.novos, 1);
    const carro = await prisma.simVeiculoModelo.findFirst({ where: { companyId: EMPRESA, modelo: "Corolla", vigenciaFim: null } });
    await ed.salvarRegistro(EMPRESA, "veiculo", { tipo: "Carro", modelo: "Corolla Cross", ano: 2025, valorCompra: 170000 }, carro!.id, "teste");
    conferir("renomear o modelo encerra o registro anterior", [(await prisma.simVeiculoModelo.findUnique({ where: { id: carro!.id } }))?.vigenciaFim !== null, await prisma.simVeiculoModelo.count({ where: { companyId: EMPRESA, modelo: { startsWith: "Corolla" }, vigenciaFim: null } })], [true, 1]);
    ok("sem modelo é recusado", Boolean((await ed.salvarRegistro(EMPRESA, "veiculo", { tipo: "Van" }, null, "teste")).erro));
    const outra = await ed.encerrarRegistro("outra-empresa", "veiculo", carro!.id);
    ok("outra empresa não retira registro", Boolean(outra.erro));
  }

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

  // Regressão: a versão do lance vinha do formulário sem conferência — id
  // inexistente estourava a chave estrangeira; id de outro estudo (ou de
  // outra empresa) era aceito e ligado ao lance.
  const lanceBase = { fase: "LANCE", dataHora: new Date(), precos: [{ item: "lote", preco: 9.3 }], valorTotal: null, observacao: null };
  const semVersao = await estudos.registrarLance(EMPRESA, sjp.id, { ...lanceBase, simulacaoId: "nao-existe" }, "teste");
  ok("lance com versão inexistente é recusado sem exceção", "erro" in semVersao, JSON.stringify(semVersao));
  const binomia = await estudos.salvarVersao(
    EMPRESA,
    novoId,
    { entrada: { ...ini.entrada, rotas: historicoSaoJoseDosPinhais().entrada.rotas.map((r) => ({ ...r, item: ini.entrada.itens[0].codigo, perfilVeiculo: null })) }, origem: {}, status: "RASCUNHO", observacoes: null, baseEm: null },
    "teste"
  );
  ok("versão do estudo binômio salva", Boolean(binomia.id), JSON.stringify(binomia.erro));
  const deOutroEstudo = await estudos.registrarLance(EMPRESA, sjp.id, { ...lanceBase, simulacaoId: binomia.id! }, "teste");
  ok("lance com versão de outro estudo é recusado", "erro" in deOutroEstudo, JSON.stringify(deOutroEstudo));
  const dataRuim = await estudos.registrarLance(EMPRESA, sjp.id, { ...lanceBase, dataHora: new Date("não é data"), simulacaoId: null }, "teste");
  ok("lance com data inválida é recusado sem exceção", "erro" in dataRuim, JSON.stringify(dataRuim));
  conferir("… e nenhum desses lances foi gravado", await prisma.simLance.count({ where: { estudoId: sjp.id } }), 1);
  // Regressão: o preço do resumo da versão (binômia por item) era faturamento
  // ÷ km — o faturamento inteiro por km — enquanto o editor mostra a parcela por km.
  const gravada = await prisma.simSimulacao.findUniqueOrThrow({ where: { id: binomia.id! } });
  const { precoDoConjunto } = await import("../src/lib/simulador/decisao");
  const r = binomia.resultado!;
  ok(
    "binômia: preço do resumo é o do editor (parcela por km), não faturamento ÷ km",
    Math.abs(Number(gravada.precoKm) - precoDoConjunto(r)) < 1e-6 && Math.abs(Number(gravada.precoKm) - r.totais.faturamento / r.totais.kmUtil) > 0.5,
    `${gravada.precoKm} × ${precoDoConjunto(r)}`
  );
  // Regressão: diasMes 21,5 era aceito e truncado para 21 na definição.
  const diasFrac = await estudos.salvarVersao(
    EMPRESA,
    sjp.id,
    { entrada: { ...entrada2, rotas: entrada2.rotas.map((x, k) => (k === 0 ? { ...x, diasMes: 21.5 } : x)) }, origem: {}, status: "RASCUNHO", observacoes: null, baseEm: null },
    "teste"
  );
  ok("dias por mês fracionário é recusado ao salvar", Boolean(diasFrac.erro), JSON.stringify(diasFrac.erro ?? diasFrac.versao));

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
