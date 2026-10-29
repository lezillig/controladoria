// TÍTULOS EXCLUÍDOS NA OMIE — `npm run teste:exclusoes`.
//
// O caso que motivou: no DRE de setembro/2026 da Azul havia um título a
// receber de R$ 9.190,00 que a Omie já não tinha. A sincronização só incluía e
// atualizava; o título apagado ficava no espelho para sempre.
//
// Parte 1 (sem banco): quais meses a fase confere e como a resposta da
// consulta de um lançamento é lida. Parte 2 (Postgres em TESTE_DATABASE_URL;
// sem ela, pula): a fase de verdade, com a Omie simulada — exclui só o que a
// Omie confirma que não existe, mantém o que existe com outra data e o que
// teve resposta ambígua, trava quando a listagem não bate com o espelho, e o
// título que volta a vir deixa de estar excluído.
process.env.OMIE_PACE_MS = "0";

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "  ok  " : "FALHA "} ${nome}${ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         obtido   ${JSON.stringify(real)}`}`);
}
const rotulo = (m: { inicio: Date }) => `${m.inicio.getFullYear()}-${String(m.inicio.getMonth() + 1).padStart(2, "0")}`;

async function puros() {
  const { mesesDaVerificacao, existenciaDaConsulta, esperaDoCursor, cursorDeExclusoesSalvo } = await import("../src/lib/omie/sync");
  const { OmieVazioError } = await import("../src/lib/omie/client");

  console.log("\n1. Quais meses");
  const dia = { janelaInicio: new Date(2026, 8, 27), janelaFim: new Date(2026, 9, 1, 23, 59, 59) };
  const varredura = mesesDaVerificacao({ ...dia, backfill: false, varridaEm: null, inicioDaBase: new Date(2023, 0, 1) });
  conferir("primeira vez: de jan/2025 ao mês corrente", [varredura.length, rotulo(varredura[0]), rotulo(varredura[varredura.length - 1])], [22, "2025-01", "2026-10"]);
  conferir(
    "base que começa depois de jan/2025: do início da base",
    rotulo(mesesDaVerificacao({ ...dia, backfill: false, varridaEm: null, inicioDaBase: new Date(2026, 5, 10) })[0]),
    "2026-06"
  );
  conferir(
    "depois da varredura: os três últimos meses",
    mesesDaVerificacao({ ...dia, backfill: false, varridaEm: new Date(), inicioDaBase: null }).map(rotulo),
    ["2026-08", "2026-09", "2026-10"]
  );
  conferir(
    "carga histórica: o mês da janela",
    mesesDaVerificacao({ janelaInicio: new Date(2025, 3, 1), janelaFim: new Date(2025, 3, 30, 23, 59), backfill: true, varridaEm: null, inicioDaBase: null }).map(rotulo),
    ["2025-04"]
  );
  const set = mesesDaVerificacao({ ...dia, backfill: false, varridaEm: new Date(), inicioDaBase: null })[1];
  conferir("o mês vai do dia 1 ao último dia, 23:59:59", [set.inicio.getDate(), set.fim.getDate(), set.fim.getHours()], [1, 30, 23]);

  console.log("\n1b. Recusa de consumo: esperar e retomar");
  const { segundosDeBloqueio } = await import("../src/lib/omie/client");
  conferir("prazo do bloqueio dito pela Omie", [segundosDeBloqueio("ERROR: API bloqueada por consumo indevido. Tente novamente em 1765 segundos."), segundosDeBloqueio("Consumo redundante detectado")], [1765, null]);
  conferir("cursor sem espera: 0", esperaDoCursor(JSON.stringify({ pagina: 2 })), 0);
  conferir("espera que falta", esperaDoCursor(JSON.stringify({ aguardarAte: new Date(1_000_000 + 30_000).toISOString() }), 1_000_000), 30_000);
  conferir("espera vencida e cursor ilegível: 0", [esperaDoCursor(JSON.stringify({ aguardarAte: new Date(0).toISOString() })), esperaDoCursor("{")], [0, 0]);
  const meses = mesesDaVerificacao({ ...dia, backfill: false, varridaEm: null, inicioDaBase: new Date(2023, 0, 1) });
  conferir(
    "ponto guardado: o mês volta pelo índice de hoje",
    cursorDeExclusoesSalvo(JSON.stringify({ mesInicio: meses[20].inicio.toISOString(), natureza: 1, pagina: 3, listado: true, desde: "x", pulados: ["a"] }), meses),
    { mes: 20, natureza: 1, pagina: 3, desde: "x", listado: true, pulados: ["a"] }
  );
  conferir("mês fora da lista ou texto ilegível: recomeça", [cursorDeExclusoesSalvo(JSON.stringify({ mesInicio: new Date(2020, 0, 1).toISOString() }), meses), cursorDeExclusoesSalvo("x", meses)], [null, null]);

  console.log("\n2. A resposta da consulta do lançamento");
  conferir("veio o lançamento com o mesmo código: existe", existenciaDaConsulta({ codigo_lancamento_omie: 5964601061 }, null, "5964601061"), "existe");
  conferir("veio outro código: indeterminado", existenciaDaConsulta({ codigo_lancamento_omie: 1 }, null, "5964601061"), "indeterminado");
  conferir("\"não existem registros\" (nulo): não existe", existenciaDaConsulta(null, null, "1"), "nao_existe");
  conferir("OmieVazioError: não existe", existenciaDaConsulta(undefined, new OmieVazioError("Não existem registros"), "1"), "nao_existe");
  conferir(
    "\"Lançamento não cadastrado\": não existe",
    existenciaDaConsulta(undefined, new Error("Omie recusou ConsultarContaReceber (SOAP-ENV:Client-5113): ERROR: Lançamento não cadastrado para o Código [5964601061] !"), "1"),
    "nao_existe"
  );
  conferir(
    "\"Conta a receber não encontrada\": não existe",
    existenciaDaConsulta(undefined, new Error("Omie recusou ConsultarContaReceber: Conta a receber não encontrada!"), "1"),
    "nao_existe"
  );
  conferir("credencial recusada: indeterminado", existenciaDaConsulta(undefined, new Error("A chave de acesso não está preenchida ou não é válida."), "1"), "indeterminado");
  conferir("método inexistente: indeterminado", existenciaDaConsulta(undefined, new Error('Method "ConsultarContaReceber" not exists'), "1"), "indeterminado");
  conferir("resposta sem código: indeterminado", existenciaDaConsulta({ status: "ok" }, null, "1"), "indeterminado");
}

async function noBanco() {
  const url = process.env.TESTE_DATABASE_URL;
  if (!url) {
    console.log("\nTESTE_DATABASE_URL não definida — pulando a parte com banco.");
    return;
  }
  process.env.DATABASE_URL = url;
  const { prisma } = await import("../src/lib/prisma");
  const { executarFase } = await import("../src/lib/omie/sync");
  const EMPRESA = "empresa-exclusoes";
  process.env.OMIE_APP_KEY_TESTEEXCL = "1234567890";
  process.env.OMIE_APP_SECRET_TESTEEXCL = "0123456789abcdef0123456789abcdef";

  const limpar = async () => {
    await prisma.omieTituloVersao.deleteMany({ where: { companyId: EMPRESA } });
    await prisma.omieBaixa.deleteMany({ where: { companyId: EMPRESA } });
    await prisma.omieTitulo.deleteMany({ where: { companyId: EMPRESA } });
    await prisma.omieConexao.deleteMany({ where: { companyId: EMPRESA } });
    await prisma.controladoriaConfig.deleteMany({ where: { companyId: EMPRESA } });
  };
  await limpar();
  const config = await prisma.controladoriaConfig.findFirst();
  if (!config) {
    console.log("\nSem ControladoriaConfig de modelo no banco de teste — pulando a parte com banco.");
    return;
  }
  const { id: _id, companyId: _c, ...resto } = config;
  void _id;
  void _c;
  await prisma.controladoriaConfig.create({ data: { ...resto, companyId: EMPRESA, dataInicioBase: new Date(2026, 7, 1) } });
  const cx = await prisma.omieConexao.create({
    data: { companyId: EMPRESA, nome: "Azul", apelido: "AZUL", credencialRef: "TESTEEXCL" },
  });

  const titulo = (codigo: string, emissao: Date, extra: Record<string, unknown> = {}) => ({
    companyId: EMPRESA,
    conexaoId: cx.id,
    conexaoApelido: "AZUL",
    natureza: "RECEBER" as const,
    codigoLancamento: codigo,
    dataEmissao: emissao,
    dataVencimento: emissao,
    valorDocumentoCents: 919000,
    status: "A VENCER",
    ...extra,
  });
  const set = new Date(2026, 8, 9);
  await prisma.omieTitulo.createMany({
    data: [
      titulo("100", set), // vem na listagem
      titulo("200", set), // excluído: "não cadastrado"
      titulo("300", set), // existe, com outra data na Omie
      titulo("400", set), // resposta ambígua
      titulo("500", set), // excluído: "não existem registros"
      titulo("600", set, { cancelado: true, status: "CANCELADO" }), // já cancelado: fora
      // Agosto: quarenta títulos que a listagem não devolve — a trava.
      ...Array.from({ length: 40 }, (_, i) => titulo(`9${String(i).padStart(3, "0")}`, new Date(2026, 7, 5))),
    ],
  });

  // A Omie simulada.
  const naListagem = new Set(["100"]);
  // Campos além do cabeçalho, por código (resumo e baixas, no item 6).
  const extras: Record<string, Record<string, unknown>> = {};
  const existem = new Set(["100", "300"]);
  const naoCadastrados = new Set(["200"]);
  const vazios = new Set(["500"]);
  // Lançamentos que a Omie recusa por consumo (item 7).
  const limitados = new Set<string>();
  const vazio = () => new Response(JSON.stringify({ faultstring: "ERROR: Não existem registros para a página [1]!" }), { status: 500 });
  const chamadas: string[] = [];
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async (_u: string, init: { body: string }) => {
    const corpo = JSON.parse(init.body) as { call: string; param: Record<string, unknown>[] };
    const p = corpo.param[0];
    chamadas.push(corpo.call);
    if (corpo.call === "PesquisarLancamentos") {
      const setembro = p.dDtEmisDe === "01/09/2026";
      if (!setembro || p.cNatureza !== "R") return vazio();
      return new Response(
        JSON.stringify({
          nPagina: 1,
          nTotPaginas: 1,
          titulosEncontrados: [...naListagem].map((c) => ({ cabecTitulo: { nCodTitulo: Number(c), nValorTitulo: 9190, dDtVenc: "09/09/2026", dDtEmissao: "09/09/2026", cStatus: "A VENCER" }, ...(extras[c] ?? {}) })),
        }),
        { status: 200 }
      );
    }
    const codigo = String(p.codigo_lancamento_omie);
    if (limitados.has(codigo)) return new Response(JSON.stringify({ faultstring: "Consumo redundante detectado. Aguarde 60 segundos." }), { status: 500 });
    if (existem.has(codigo)) return new Response(JSON.stringify({ codigo_lancamento_omie: Number(codigo), valor_documento: 9190 }), { status: 200 });
    if (naoCadastrados.has(codigo)) return new Response(JSON.stringify({ faultstring: `ERROR: Lançamento não cadastrado para o Código [${codigo}] !`, faultcode: "SOAP-ENV:Client-5113" }), { status: 500 });
    if (vazios.has(codigo)) return vazio();
    return new Response(JSON.stringify({ faultstring: "Erro interno ao processar a requisição." }), { status: 500 });
  }) as typeof fetch;

  try {
    console.log("\n3. A fase de verdade, primeira vez (varredura desde o início da base: ago e set/2026)");
    const agora = Date.now();
    const ctx = {
      companyId: EMPRESA, conexaoId: cx.id, conexaoApelido: "AZUL", credencialRef: "TESTEEXCL", cursor: null as string | null,
      janelaInicio: new Date(2026, 8, 27), janelaFim: new Date(2026, 8, 30, 23, 59, 59),
      fimDoOrcamento: agora + 60_000, deadline: agora + 120_000,
    };
    const r = await executarFase("exclusoes", ctx, false);
    const t = async (codigo: string) =>
      prisma.omieTitulo.findFirst({ where: { companyId: EMPRESA, codigoLancamento: codigo }, select: { cancelado: true, status: true, excluidoNaOmieEm: true } });
    conferir("a fase conclui", r.faseConcluida, true);
    conferir("dois excluídos", r.excluidos, 2);
    conferir("veio na listagem: fica", (await t("100"))?.cancelado, false);
    conferir("\"não cadastrado\": sai, como excluído na Omie", [(await t("200"))?.cancelado, (await t("200"))?.status, !!(await t("200"))?.excluidoNaOmieEm], [true, "EXCLUÍDO NA OMIE", true]);
    conferir("existe com outra data: fica", [(await t("300"))?.cancelado, (await t("300"))?.excluidoNaOmieEm], [false, null]);
    conferir("resposta ambígua: fica, com o erro registrado", [(await t("400"))?.cancelado, r.erros.some((e) => e.includes("lançamento 400"))], [false, true]);
    conferir("\"não existem registros\": sai", (await t("500"))?.cancelado, true);
    conferir("já cancelado não é consultado", chamadas.filter((c) => c.startsWith("Consultar")).length, 4);
    const agosto = await prisma.omieTitulo.count({ where: { companyId: EMPRESA, codigoLancamento: { startsWith: "9" }, cancelado: false } });
    conferir("agosto: 40 de 40 não vieram — a trava segura, nada excluído", [agosto, r.erros.some((e) => e.includes("trava de segurança"))], [40, true]);
    const versao = await prisma.omieTituloVersao.findFirst({ where: { companyId: EMPRESA, campo: "exclusao" }, select: { de: true, para: true } });
    conferir("a exclusão fica no histórico do título", versao, { de: "A VENCER", para: "EXCLUÍDO NA OMIE" });
    conferir("a varredura fica registrada na conexão", !!(await prisma.omieConexao.findUnique({ where: { id: cx.id } }))?.exclusoesVarridasEm, true);

    console.log("\n4. O título excluído que volta a vir da Omie");
    naListagem.add("200");
    const t2 = await executarFase("titulos", { ...ctx, janelaInicio: new Date(2026, 8, 1), janelaFim: new Date(2026, 8, 30, 23, 59, 59) }, true);
    conferir("a fase de títulos conclui", t2.faseConcluida, true);
    conferir("deixa de estar excluído, com o status da Omie", [(await t("200"))?.cancelado, (await t("200"))?.status, (await t("200"))?.excluidoNaOmieEm], [false, "A VENCER", null]);

    console.log("\n5. O DRE não soma o excluído");
    const { montarDreNoBanco } = await import("../src/lib/controladoria/dreNoBanco");
    const periodo = { inicio: new Date(2026, 8, 1), fim: new Date(2026, 8, 30, 23, 59, 59), rotulo: "set" };
    const anterior = { inicio: new Date(2026, 7, 1), fim: new Date(2026, 7, 31, 23, 59, 59), rotulo: "ago" };
    const dre = await montarDreNoBanco({ companyId: EMPRESA, conexaoId: cx.id, janela: { desde: new Date(2025, 0, 1), ate: null } }, periodo as never, anterior as never, new Map(), { regime: "competencia", incluirTitulos: false });
    const sem = dre.linhas.find((l) => l.itens.some((i) => i.categoriaCodigo === "SEM_CATEGORIA"));
    // 100, 200 (voltou), 300 e 400 ficam; 500 saiu e 600 já era cancelado.
    conferir("receita do mês: quatro títulos de R$ 9.190,00", dre.semCategoriaCents || sem?.valorCents || 0, 4 * 919000);

    console.log("\n6. A baixa que deixou de vir da Omie sai (só com a lista completa)");
    // 700: a mesma baixa gravada duas vezes (com e sem código). 800: estornada
    // na Omie (pago zero, sem baixas). 900: resposta parcial (resumo diz R$
    // 183,80 pagos, veio uma baixa de R$ 91,90) — não apaga nada.
    for (const c of ["700", "800", "900"]) {
      const novo = await prisma.omieTitulo.create({ data: titulo(c, set) });
      await prisma.omieBaixa.createMany({
        data: [
          { companyId: EMPRESA, conexaoId: cx.id, tituloId: novo.id, chave: `RECEBER:${c}:1`, dataBaixa: new Date(2026, 8, 15), valorCents: 919000 },
          { companyId: EMPRESA, conexaoId: cx.id, tituloId: novo.id, chave: `RECEBER:${c}:2026-09-15:919000`, dataBaixa: new Date(2026, 8, 15), valorCents: 919000 },
        ],
      });
      naListagem.add(c);
    }
    const baixa = { nCodBaixa: 1, dDtPagamento: "15/09/2026", nValPago: 9190 };
    extras["700"] = { resumo: { nValPago: 9190 }, lancamentos: [baixa] };
    extras["800"] = { resumo: { nValPago: 0 }, lancamentos: [] };
    extras["900"] = { resumo: { nValPago: 18380 }, lancamentos: [baixa] };
    const t3 = await executarFase("titulos", { ...ctx, janelaInicio: new Date(2026, 8, 1), janelaFim: new Date(2026, 8, 30, 23, 59, 59) }, true);
    conferir("a fase de títulos conclui", t3.faseConcluida, true);
    const baixasDe = async (c: string) => (await prisma.omieBaixa.findMany({ where: { titulo: { conexaoId: cx.id, codigoLancamento: c } }, select: { chave: true } })).map((b) => b.chave).sort();
    conferir("baixa em dobro: fica só a que a Omie devolve", await baixasDe("700"), ["RECEBER:700:1"]);
    conferir("estornada na Omie: sai", await baixasDe("800"), []);
    conferir("resposta parcial: nada sai", (await baixasDe("900")).length, 2);

    console.log("\n7. A Omie limita o consumo no meio da varredura histórica");
    await prisma.omieConexao.update({ where: { id: cx.id }, data: { exclusoesVarridasEm: null, exclusoesCursor: null } });
    const novos = ["1001", "1002", "1003", "1004", "1005"];
    await prisma.omieTitulo.createMany({ data: novos.map((c) => titulo(c, set)) });
    for (const c of novos) vazios.add(c);
    for (const c of ["1001", "1002", "1003"]) limitados.add(c);
    const instante = () => ({ fimDoOrcamento: Date.now() + 60_000, deadline: Date.now() + 120_000 });
    const r7 = await executarFase("exclusoes", { ...ctx, ...instante(), cursor: null }, false);
    const cx7 = await prisma.omieConexao.findUnique({ where: { id: cx.id }, select: { exclusoesVarridasEm: true, exclusoesCursor: true } });
    conferir("três recusas seguidas: a fase encerra por hoje (a próxima empresa não espera)", [r7.faseConcluida, r7.erros.some((e) => e.includes("interrompida por hoje"))], [true, true]);
    conferir("o ponto fica guardado e a varredura não conta como feita", [!!cx7?.exclusoesCursor, cx7?.exclusoesVarridasEm ?? null], [true, null]);
    conferir("o lançamento seguinte não foi consultado", (await t("1004"))?.cancelado, false);
    limitados.clear();
    chamadas.length = 0;
    const r7b = await executarFase("exclusoes", { ...ctx, ...instante(), cursor: null }, false);
    const cx7b = await prisma.omieConexao.findUnique({ where: { id: cx.id }, select: { exclusoesVarridasEm: true, exclusoesCursor: true } });
    // Parou em setembro, a receber: falta só listar setembro a pagar.
    conferir("no ciclo seguinte continua de onde parou: sem relistar agosto", chamadas.filter((c) => c === "PesquisarLancamentos").length, 1);
    conferir("os recusados voltam a ser consultados e saem", [r7b.faseConcluida, r7b.excluidos, (await t("1001"))?.cancelado], [true, 5, true]);
    conferir("varredura concluída: o ponto guardado some", [!!cx7b?.exclusoesVarridasEm, cx7b?.exclusoesCursor ?? null], [true, null]);
  } finally {
    globalThis.fetch = fetchOriginal;
    await limpar();
    await prisma.$disconnect();
  }
}

puros()
  .then(noBanco)
  .then(() => {
    console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTodos os testes passaram.");
    process.exit(falhas ? 1 : 0);
  })
  .catch((e) => {
    console.error("O teste não completou:", e);
    process.exit(1);
  });
