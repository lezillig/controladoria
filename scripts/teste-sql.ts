// TESTES DE SQL CONTRA UM POSTGRES DE VERDADE — `npm run teste:sql`.
//
// POR QUE ISTO EXISTE, e vale registrar porque custou caro: num único dia, três
// defeitos foram parar em produção neste projeto, e os três eram SQL cru —
// coluna a mais na lista do INSERT, filtro que impedia o uso de índice, e uma
// consulta de pendências que varria cinco anos de base. Nenhum deles é visível
// para o compilador, e nenhum apareceria em teste de função pura: `Prisma.raw`
// é texto até chegar ao banco.
//
// A rede de proteção que existia — try/catch em volta da chamada — impediu o
// estrago, mas rede de proteção não é qualidade. Ela transforma "defeito que
// derruba a carga" em "defeito que passa despercebido", que é melhor e continua
// sendo defeito.
//
// COMO RODAR. Precisa de um Postgres vazio e de `TESTE_DATABASE_URL` apontando
// para ele. Em máquina de desenvolvimento:
//
//   initdb -D /tmp/pgteste -U dev --auth=trust
//   pg_ctl -D /tmp/pgteste -o "-p 55432 -k /tmp" start
//   createdb -h /tmp -p 55432 -U dev controladoria_teste
//   export TESTE_DATABASE_URL="postgresql://dev@localhost:55432/controladoria_teste?host=/tmp"
//   DATABASE_URL=$TESTE_DATABASE_URL DIRECT_URL=$TESTE_DATABASE_URL npx prisma migrate deploy
//   npm run teste:sql
//
// SEM A VARIÁVEL, O TESTE NÃO FALHA — ele avisa e sai com sucesso. Um teste que
// quebra o build de quem não tem banco local seria desligado na primeira
// semana, e aí não protegeria ninguém.
import { PrismaClient } from "@prisma/client";

const url = process.env.TESTE_DATABASE_URL;
if (!url) {
  console.log(
    "\nTESTE_DATABASE_URL não definida — pulando os testes de SQL.\n" +
      "Eles precisam de um Postgres real; as instruções estão no topo de scripts/teste-sql.ts.\n"
  );
  process.exit(0);
}

process.env.DATABASE_URL = url;
const prisma = new PrismaClient({ datasources: { db: { url } } });

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(
    `${ok ? "  ok  " : "FALHA "} ${nome}${ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         obtido   ${JSON.stringify(real)}`}`
  );
}

const EMPRESA = "empresa-de-teste";

async function limpar() {
  await prisma.historicoMensal.deleteMany({ where: { companyId: EMPRESA } });
  await prisma.omieBaixa.deleteMany({ where: { companyId: EMPRESA } });
  await prisma.omieTitulo.deleteMany({ where: { companyId: EMPRESA } });
  await prisma.omieConexao.deleteMany({ where: { companyId: EMPRESA } });
  await prisma.controladoriaConfig.deleteMany({ where: { companyId: EMPRESA } });
}

async function principal() {
  const { recalcularHistorico, competenciasPendentes, lerSeries, montarBaselines } = await import(
    "../src/lib/controladoria/historico"
  );

  await limpar();

  const conexao = await prisma.omieConexao.create({
    data: { companyId: EMPRESA, nome: "Teste LTDA", apelido: "TESTE", credencialRef: "TESTE" },
  });
  await prisma.controladoriaConfig.create({
    data: { companyId: EMPRESA, dataInicioBase: new Date(2026, 0, 1) },
  });

  // Três títulos em março, um deles cancelado, mais um em abril. Os números são
  // escolhidos para que cada asserção só possa passar por um motivo.
  const base = {
    companyId: EMPRESA,
    conexaoId: conexao.id,
    conexaoApelido: "TESTE",
    natureza: "PAGAR" as const,
    status: "ABERTO",
  };
  const t1 = await prisma.omieTitulo.create({
    data: {
      ...base,
      codigoLancamento: "1",
      parceiroCodigo: "F1",
      parceiroNome: "Posto Alfa",
      categoriaCodigo: "C1",
      categoriaDescricao: "Combustível",
      dataEmissao: new Date(2026, 2, 5),
      dataVencimento: new Date(2026, 2, 15),
      valorDocumentoCents: 100_000,
    },
  });
  await prisma.omieTitulo.create({
    data: {
      ...base,
      codigoLancamento: "2",
      parceiroCodigo: "F1",
      parceiroNome: "Posto Alfa",
      categoriaCodigo: "C1",
      categoriaDescricao: "Combustível",
      // ÚLTIMO DIA DO MÊS, com hora. O recorte passou a ser por faixa de data, e
      // é aqui que um `<=` no lugar de `< primeiro dia do mês seguinte` deixaria
      // este título de fora sem ninguém perceber.
      dataEmissao: new Date(2026, 2, 31, 23, 30),
      dataVencimento: new Date(2026, 3, 10),
      valorDocumentoCents: 50_000,
    },
  });
  await prisma.omieTitulo.create({
    data: {
      ...base,
      codigoLancamento: "3",
      parceiroCodigo: "F1",
      parceiroNome: "Posto Alfa",
      categoriaCodigo: "C1",
      categoriaDescricao: "Combustível",
      dataEmissao: new Date(2026, 2, 20),
      dataVencimento: new Date(2026, 2, 25),
      valorDocumentoCents: 999_999,
      cancelado: true,
    },
  });
  await prisma.omieTitulo.create({
    data: {
      ...base,
      codigoLancamento: "4",
      parceiroCodigo: "F2",
      parceiroNome: "Oficina Beta",
      categoriaCodigo: "C2",
      categoriaDescricao: "Manutenção",
      // SEM dataEmissao: a competência cai no vencimento, que é a regra de
      // competencia.ts. Título sem emissão não pode sumir do resumo.
      dataVencimento: new Date(2026, 3, 8),
      valorDocumentoCents: 30_000,
    },
  });

  // DUAS baixas no MESMO título: é o caso que o LEFT JOIN LATERAL existe para
  // resolver. Com JOIN direto, o título entraria duas vezes no COUNT(*) e a
  // contagem de títulos do mês viria inflada.
  await prisma.omieBaixa.createMany({
    data: [
      {
        companyId: EMPRESA,
        conexaoId: conexao.id,
        tituloId: t1.id,
        chave: "b1",
        dataBaixa: new Date(2026, 2, 20),
        valorCents: 60_000,
      },
      {
        companyId: EMPRESA,
        conexaoId: conexao.id,
        tituloId: t1.id,
        chave: "b2",
        dataBaixa: new Date(2026, 2, 25),
        valorCents: 40_000,
      },
    ],
  });

  // ------------------------------------------------- 1. o recálculo roda
  console.log("\n1. O recálculo executa contra o Postgres");
  const r = await recalcularHistorico(EMPRESA, conexao.id, ["2026-03", "2026-04"]);
  conferir("duas competências processadas", r.competencias, 2);

  // ------------------------------------------------- 2. o que ele gravou
  console.log("\n2. Os números do mês");
  const marco = await prisma.historicoMensal.findFirst({
    where: { companyId: EMPRESA, competencia: "2026-03", dimensao: "PARCEIRO", chave: "F1" },
  });
  conferir("gravou a linha do fornecedor", Boolean(marco), true);
  conferir("dois títulos, o cancelado fora", marco?.titulos, 2);
  conferir("soma sem o cancelado", marco?.valorCents, 150_000);
  conferir("maior título do mês", marco?.valorMaximoCents, 100_000);
  conferir("duas baixas, sem inflar a contagem de títulos", marco?.baixas, 2);
  conferir("valor baixado", marco?.valorBaixadoCents, 100_000);
  conferir("rótulo guardado", marco?.rotulo, "Posto Alfa");

  const abril = await prisma.historicoMensal.findFirst({
    where: { companyId: EMPRESA, competencia: "2026-04", dimensao: "PARCEIRO", chave: "F2" },
  });
  conferir("título sem emissão cai no vencimento", abril?.valorCents, 30_000);

  const categoria = await prisma.historicoMensal.findFirst({
    where: { companyId: EMPRESA, competencia: "2026-03", dimensao: "CATEGORIA", chave: "C1" },
  });
  conferir("a dimensão de categoria também gravou", categoria?.valorCents, 150_000);

  // ------------------------------------------------- 3. idempotência
  //
  // O recálculo roda ao fim de TODA janela, e a janela diária cobre D-3 —
  // portanto reprocessa dias já contados. Se não fosse idempotente, os valores
  // dobrariam a cada ciclo.
  console.log("\n3. Rodar de novo não duplica nem soma");
  await recalcularHistorico(EMPRESA, conexao.id, ["2026-03"]);
  const depois = await prisma.historicoMensal.findMany({
    where: { companyId: EMPRESA, competencia: "2026-03", dimensao: "PARCEIRO" },
  });
  conferir("continua uma linha por fornecedor", depois.length, 1);
  conferir("com o mesmo valor", depois[0]?.valorCents, 150_000);

  // ------------------------------------------------- 4. limpeza de órfãs
  console.log("\n4. Título que deixa de existir sai do resumo");
  await prisma.omieBaixa.deleteMany({ where: { tituloId: t1.id } });
  await prisma.omieTitulo.deleteMany({ where: { companyId: EMPRESA, parceiroCodigo: "F1" } });
  await recalcularHistorico(EMPRESA, conexao.id, ["2026-03"]);
  const orfa = await prisma.historicoMensal.findFirst({
    where: { companyId: EMPRESA, competencia: "2026-03", dimensao: "PARCEIRO", chave: "F1" },
  });
  conferir("linha removida", orfa, null);

  // ------------------------------------------------- 5. pendências
  console.log("\n5. Competências pendentes");
  const pendentes = await competenciasPendentes(EMPRESA);
  conferir("março e abril já não pendem", pendentes.some((p) => p.competencia === "2026-04"), false);
  conferir("mas os meses sem resumo pendem", pendentes.length > 0, true);

  // ------------------------------------------------- 6. leitura
  console.log("\n6. Leitura das séries");
  const series = await lerSeries({
    companyId: EMPRESA,
    dimensao: "PARCEIRO",
    natureza: "PAGAR",
    de: "2026-01",
    ate: "2026-12",
  });
  conferir("a série volta do banco", series.length >= 1, true);
  conferir("e o baseline não explode com amostra pequena", montarBaselines(series).size, 0);

  await limpar();
}

principal()
  .then(async () => {
    await prisma.$disconnect();
    console.log(falhas === 0 ? "\nTodos os testes passaram.\n" : `\n${falhas} FALHA(S).\n`);
    process.exit(falhas === 0 ? 0 : 1);
  })
  .catch(async (e) => {
    await prisma.$disconnect();
    console.error("\nO teste não completou:", e);
    process.exit(1);
  });
