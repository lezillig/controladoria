// CADASTRO MESTRE DA PLATAFORMA (Fase 0, spec 01) — `npm run teste:cadastro`.
//
// Parte 1 (sem banco): placa, CPF e CNPJ normalizados e validados; a mescla
// fonte × cadastro (completa vazio, nunca sobrescreve, aponta divergência);
// quem decide pendência; a trilha sem CPF em claro. Parte 2 (Postgres em
// TESTE_DATABASE_URL; sem ela, pula): a carga de verdade a partir da Omie e da
// gestão, rodada duas vezes (a segunda não duplica nada), o centro de custo
// de cada veículo, a pendência única para a Omie e a decisão com trilha.

export {};

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "  ok  " : "FALHA "} ${nome}${ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         veio     ${JSON.stringify(real)}`}`);
}

async function puros() {
  const n = await import("../src/lib/cadastro/normalizacao");
  const { mesclar, cargoDaFuncao } = await import("../src/lib/cadastro/carga");
  const { podeDecidir } = await import("../src/lib/auditoria/pendencias");
  const { protegerRegistro, diferencas } = await import("../src/lib/auditoria/trilha");

  console.log("\n1. Chaves naturais");
  conferir("placa antiga e Mercosul, com hífen, espaço e minúscula", ["abc-1234", "ABC 1D23", " bra2e19 "].map(n.normalizarPlaca), ["ABC1234", "ABC1D23", "BRA2E19"]);
  conferir("placa inválida: nulo", ["AB1234", "ABCD123", "", null].map(n.normalizarPlaca), [null, null, null, null]);
  conferir("CPF com pontos e com o zero à esquerda comido pela planilha", [n.normalizarCpf("529.982.247-25"), n.normalizarCpf(1234567890 * 0 + 52998224725), n.normalizarCpf("01234567890")], ["52998224725", "52998224725", "01234567890"]);
  conferir("CPF que só parece CPF", [n.normalizarCpf("111.111.111-11"), n.normalizarCpf("529.982.247-24")], [null, null]);
  conferir("CNPJ formatado e sem zero à esquerda", [n.normalizarCnpj("11.222.333/0001-81"), n.normalizarCnpj("191000000000")], ["11222333000181", null]);
  conferir("CNPJ do Banco do Brasil (00.000.000/0001-91) como número", n.normalizarCnpj(191), null);
  conferir("CNPJ com dígito errado", n.normalizarCnpj("11.222.333/0001-82"), null);
  conferir("CPF na tela: só o miolo", n.mascararCpf("52998224725"), "***.982.247-**");
  conferir("tipo do veículo pelo texto", ["MICRO ONIBUS", "Sprinter 416", "ÔNIBUS RODOVIÁRIO", "Gol"].map(n.tipoDeVeiculo), ["micro", "van", "onibus", "outro"]);

  console.log("\n2. A mescla da carga");
  const atual = { modelo: "Sprinter", anoFab: null, status: "ativo" };
  conferir("completa o vazio, aponta a divergência, não sobrescreve", mesclar(atual, { modelo: "Master", anoFab: 2019, status: "ativo" }), { completar: { anoFab: 2019 }, divergentes: [{ campo: "modelo", cadastro: "Sprinter", fonte: "Master" }] });
  conferir("vazio da fonte não apaga nada", mesclar(atual, { modelo: null, anoFab: "" }), { completar: {}, divergentes: [] });
  conferir("cargo pela função da gestão", ["Motorista D", "MONITORA ESCOLAR", "Mecânico", "Auxiliar administrativo", null].map(cargoDaFuncao), ["motorista", "monitor", "mecanico", "adm", "motorista"]);

  console.log("\n3. Quem decide pendência");
  const base = { papel: "GESTOR", temPermissao: true, perfis: [] as string[] };
  conferir("ADMIN decide tudo, mesmo sem a permissão", podeDecidir({ papel: "ADMIN", temPermissao: false, perfis: [], perfilAprovador: "financeiro" }), true);
  conferir("GESTOR decide pendência de gestor e de operação", [podeDecidir({ ...base, perfilAprovador: "gestor" }), podeDecidir({ ...base, perfilAprovador: "operacao" })], [true, true]);
  conferir("GESTOR não decide a do financeiro", podeDecidir({ ...base, perfilAprovador: "financeiro" }), false);
  conferir("perfil de acesso \"Financeiro\" decide a do financeiro", podeDecidir({ ...base, perfis: ["Financeiro"], perfilAprovador: "financeiro" }), true);
  conferir("sem a permissão de decidir, nada", podeDecidir({ ...base, temPermissao: false, perfilAprovador: "gestor" }), false);

  console.log("\n4. A trilha");
  conferir("CPF mascarado e datas em texto", protegerRegistro({ cpf: "52998224725", nome: "X", dataAdmissao: new Date("2026-01-02T00:00:00Z"), atualizadoEm: new Date() }), { cpf: "***982247**", nome: "X", dataAdmissao: "2026-01-02T00:00:00.000Z" });
  conferir("só o que mudou", diferencas({ a: 1, b: 2 }, { a: 1, b: 3 }), { antes: { b: 2 }, depois: { b: 3 } });
  conferir("nada mudou: nulo", diferencas({ a: 1 }, { a: 1 }), null);
}

async function noBanco() {
  const url = process.env.TESTE_DATABASE_URL;
  if (!url) {
    console.log("\nTESTE_DATABASE_URL não definida — pulando a parte com banco.");
    return;
  }
  process.env.DATABASE_URL = url;
  delete process.env.GESTAO_DATABASE_URL;
  const { prisma } = await import("../src/lib/prisma");
  const carga = await import("../src/lib/cadastro/carga");
  const { decidirPendencia } = await import("../src/lib/auditoria/pendencias");
  const EMPRESA = "empresa-teste-cadastro";

  // As tabelas da gestão (public."Driver"/"Vehicle"), só se o banco de teste
  // não as tiver — e saem no fim.
  const existiam = Number((await prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('Driver','Vehicle')`)[0].n) === 2;
  if (!existiam) {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS public."Driver" (id text PRIMARY KEY, "companyId" text, name text, cpf text, active boolean, "valorHoraCents" int, "clienteId" text, departamento text, admissao timestamp, funcao text, empregador text)`);
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS public."Vehicle" (id text PRIMARY KEY, "companyId" text, plate text, status text, "currentMileage" int, model text, type text, year int)`);
  }
  const limpar = async () => {
    for (const t of ["audLog", "audPendencia", "cadCentroCusto", "frotaFinanciamento", "cadVeiculo", "cadPessoa", "cadCliente", "cadFornecedor", "omieParceiro"] as const) {
      await (prisma[t] as unknown as { deleteMany: (a: object) => Promise<unknown> }).deleteMany({ where: { companyId: EMPRESA } });
    }
    await prisma.omieConexao.deleteMany({ where: { companyId: EMPRESA } });
    await prisma.$executeRawUnsafe(`DELETE FROM public."Driver" WHERE "companyId" = '${EMPRESA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM public."Vehicle" WHERE "companyId" = '${EMPRESA}'`);
  };
  await limpar();
  try {
    const [azul, mcz] = await Promise.all([
      prisma.omieConexao.create({ data: { companyId: EMPRESA, nome: "Azul", apelido: "AZUL", credencialRef: "X1" } }),
      prisma.omieConexao.create({ data: { companyId: EMPRESA, nome: "MCZ", apelido: "MCZ", credencialRef: "X2" } }),
    ]);
    const parceiro = (cx: { id: string; apelido: string }, codigo: string, nome: string, documento: string | null, extra: object = {}) => ({
      companyId: EMPRESA, conexaoId: cx.id, conexaoApelido: cx.apelido, codigoOmie: codigo, nome, documento, ...extra,
    });
    await prisma.omieParceiro.createMany({
      data: [
        parceiro(azul, "1", "POSTO BOA VIAGEM LTDA", "11222333000181", { ehFornecedor: true }),
        parceiro(mcz, "9", "POSTO BOA VIAGEM", "11.222.333/0001-81", { ehFornecedor: true }),
        parceiro(azul, "2", "PREFEITURA MUNICIPAL DE XYZ", "11444777000161", { ehCliente: true }),
        parceiro(azul, "3", "JOAO AUTONOMO", "52998224725", { ehFornecedor: true }),
        parceiro(azul, "4", "SEM DOC", null, { ehFornecedor: true }),
      ],
    });
    await prisma.$executeRawUnsafe(`INSERT INTO public."Driver" (id, "companyId", name, cpf, active, admissao, funcao) VALUES
      ('d1', '${EMPRESA}', 'Motorista Um', '529.982.247-25', true, '2024-03-01', 'Motorista D'),
      ('d2', '${EMPRESA}', 'Monitora Dois', '111.111.111-11', true, null, 'Monitora'),
      ('d3', '${EMPRESA}', 'Mecânico Três', '01234567890', false, null, 'Mecânico')`);
    await prisma.$executeRawUnsafe(`INSERT INTO public."Vehicle" (id, "companyId", plate, status, "currentMileage", model, type, year) VALUES
      ('v1', '${EMPRESA}', 'abc-1234', 'ATIVO', 0, 'Sprinter 416', 'VAN', 2019),
      ('v2', '${EMPRESA}', 'BRA2E19', 'MANUTENCAO', 0, 'Marcopolo Volare', 'MICRO ONIBUS', 2015),
      ('v3', '${EMPRESA}', 'XX12', 'ATIVO', 0, 'x', 'x', 2020)`);

    console.log("\n5. A carga a partir da Omie e da gestão");
    const [forn, cli] = await carga.carregarParceiros(EMPRESA, "teste");
    conferir("fornecedor: o mesmo CNPJ nas duas contas vira um, com os dois códigos", [forn.novos, Object.entries(((await prisma.cadFornecedor.findFirst({ where: { companyId: EMPRESA } }))?.idsOmie ?? {}) as Record<string, string>).sort()], [1, [["AZUL", "1"], ["MCZ", "9"]]]);
    conferir("fornecedor pessoa física e sem documento ficam fora, contados", forn.ignorados, { "pessoa física (CPF)": 1, "sem documento": 1 });
    conferir("prefeitura entra como cliente público", [cli.novos, (await prisma.cadCliente.findFirst({ where: { companyId: EMPRESA } }))?.tipo], [1, "publico"]);
    const pes = await carga.carregarPessoas(EMPRESA, "teste");
    conferir("pessoas: duas válidas (uma inativa), CPF inválido de fora", [pes.novos, pes.ignorados], [2, { "CPF inválido": 1 }]);
    conferir("cargo e situação", (await prisma.cadPessoa.findMany({ where: { companyId: EMPRESA }, orderBy: { nome: "asc" }, select: { cargo: true, ativo: true } })), [{ cargo: "mecanico", ativo: false }, { cargo: "motorista", ativo: true }]);
    const vei = await carga.carregarVeiculos(EMPRESA, "teste");
    conferir("veículos: placa normalizada, placa inválida de fora", [vei.novos, vei.ignorados, (await prisma.cadVeiculo.findMany({ where: { companyId: EMPRESA }, orderBy: { placa: "asc" }, select: { placa: true, tipo: true, status: true } }))], [2, { "placa inválida": 1 }, [{ placa: "ABC1234", tipo: "van", status: "ativo" }, { placa: "BRA2E19", tipo: "micro", status: "manutencao" }]]);
    conferir("cada veículo com o seu centro de custo", (await prisma.cadCentroCusto.findMany({ where: { companyId: EMPRESA }, orderBy: { codigo: "asc" }, select: { codigo: true } })).map((c) => c.codigo), ["V-ABC1234", "V-BRA2E19"]);
    const trilha = await prisma.audLog.findMany({ where: { companyId: EMPRESA, tabela: "CadPessoa" }, select: { depois: true } });
    conferir("a trilha registra a criação, sem CPF em claro", [trilha.length, JSON.stringify(trilha).includes("52998224725")], [2, false]);

    console.log("\n6. Rodar de novo não duplica; mudança na fonte vira divergência");
    await prisma.$executeRawUnsafe(`UPDATE public."Vehicle" SET model = 'Master' WHERE id = 'v1'`);
    await prisma.cadVeiculo.updateMany({ where: { companyId: EMPRESA, placa: "BRA2E19" }, data: { anoFab: null } });
    const vei2 = await carga.carregarVeiculos(EMPRESA, "teste");
    conferir("nada novo, um completado (ano), um igual", [vei2.novos, vei2.completados, vei2.iguais], [0, 1, 1]);
    conferir("o modelo do cadastro não foi sobrescrito: divergência", [(await prisma.cadVeiculo.findFirst({ where: { companyId: EMPRESA, placa: "ABC1234" } }))?.modelo, vei2.divergencias.map((d) => [d.chave, d.campo, d.cadastro, d.fonte])], ["Sprinter 416", [["ABC1234", "modelo", "Sprinter 416", "Master"]]]);
    const [f2] = await carga.carregarParceiros(EMPRESA, "teste");
    conferir("parceiros de novo: nada novo", [f2.novos, await prisma.cadFornecedor.count({ where: { companyId: EMPRESA } })], [0, 1]);

    console.log("\n7. A pendência dos centros de custo na Omie");
    const p1 = await carga.pendenciaDeCentrosNaOmie(EMPRESA);
    const p2 = await carga.pendenciaDeCentrosNaOmie(EMPRESA);
    conferir("uma pendência só, para o financeiro, com os dois centros", [p1?.nova, p2?.nova, p1?.id === p2?.id, p1?.quantos, await prisma.audPendencia.count({ where: { companyId: EMPRESA } })], [true, false, true, 2, 1]);
    const decidir = (p: Partial<Parameters<typeof decidirPendencia>[0]>) =>
      decidirPendencia({ companyId: EMPRESA, id: p1!.id, decisao: "aprovada", comentario: null, usuario: "Fulano", papel: "GESTOR", temPermissao: true, perfis: [], ...p });
    conferir("GESTOR sem perfil financeiro não decide", (await decidir({})).ok, false);
    conferir("rejeitar exige motivo", await decidir({ papel: "ADMIN", decisao: "rejeitada" }), { ok: false, erro: "Para rejeitar, escreva o motivo." });
    conferir("o financeiro aprova", (await decidir({ perfis: ["Financeiro"] })).ok, true);
    conferir("não decide duas vezes", (await decidir({ papel: "ADMIN" })).ok, false);
    const log = await prisma.audLog.findFirst({ where: { companyId: EMPRESA, tabela: "AudPendencia" }, select: { usuario: true, depois: true } });
    conferir("a decisão fica na trilha", log, { usuario: "Fulano", depois: { status: "aprovada", comentario: null } });
  } finally {
    await limpar();
    if (!existiam) {
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS public."Driver"`);
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS public."Vehicle"`);
    }
    await prisma.$disconnect();
  }
}

puros()
  .then(noBanco)
  .then(() => {
    console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
    process.exit(falhas ? 1 : 0);
  })
  .catch((e) => {
    console.error("O teste não completou:", e);
    process.exit(1);
  });
