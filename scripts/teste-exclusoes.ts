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
  const { mesesDaVerificacao, existenciaDaConsulta } = await import("../src/lib/omie/sync");
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
  const existem = new Set(["100", "300"]);
  const naoCadastrados = new Set(["200"]);
  const vazios = new Set(["500"]);
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
          titulosEncontrados: [...naListagem].map((c) => ({ cabecTitulo: { nCodTitulo: Number(c), nValorTitulo: 9190, dDtVenc: "09/09/2026", dDtEmissao: "09/09/2026", cStatus: "A VENCER" } })),
        }),
        { status: 200 }
      );
    }
    const codigo = String(p.codigo_lancamento_omie);
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
