// ONDE VAI O TEMPO DE ABRIR UMA TELA.
//
// `carregarContexto` roda em toda página do módulo. Este script o executa
// contra um Postgres local com volume parecido com o de produção e mede,
// isolada e repetidamente, cada consulta que ele dispara — para a decisão de
// otimizar sair de número medido, não de suspeita.
//
// Uso: TESTE_DATABASE_URL=... TITULOS=50000 npx tsx scripts/bench-contexto.ts
import { PrismaClient } from "@prisma/client";
import { semear } from "./_semente-bench";

const url = process.env.TESTE_DATABASE_URL;
if (!url) {
  console.log(
    "\nTESTE_DATABASE_URL não definida — este é um banco de medição, não de teste.\n" +
      "Instruções no topo de scripts/teste-sql.ts; depois:\n" +
      "  TITULOS=50000 npx tsx scripts/bench-contexto.ts\n"
  );
  process.exit(0);
}

process.env.DATABASE_URL = url;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const EMPRESA = "bench";

const RODADAS = 5;
async function medir(nome: string, f: () => Promise<unknown>) {
  const ms: number[] = [];
  let n = 0;
  for (let r = 0; r < RODADAS; r++) {
    const t = Date.now();
    const saida = await f();
    ms.push(Date.now() - t);
    if (Array.isArray(saida)) n = saida.length;
  }
  const ord = [...ms].sort((a, b) => a - b);
  return { nome, mediana: ord[Math.floor(ord.length / 2)], linhas: n };
}

async function principal() {
  const alvo = Number(process.env.TITULOS ?? 50000);
  console.log(`semeando ${alvo} títulos...`);
  await semear(prisma, alvo);
  await prisma.$executeRawUnsafe("ANALYZE");

  const desde = new Date(2026, 0, 1);
  const recorte = { gte: desde };
  const escopo = { companyId: EMPRESA };

  const { Prisma } = await import("@prisma/client");
  const { tabela } = await import("../src/lib/esquemaDoBanco");
  const resultados = [
    await medir("títulos via $queryRaw (mesmas colunas)", () =>
      prisma.$queryRaw(Prisma.sql`
        SELECT * FROM ${tabela("OmieTitulo")} t
         WHERE t."companyId" = ${EMPRESA}
           AND (t."dataVencimento" >= ${desde} OR t."dataEmissao" >= ${desde}
                OR (t.liquidado = false AND t.cancelado = false))
         ORDER BY t."dataVencimento" ASC`)
    ),
    await medir("títulos (janela + tudo em aberto)", () =>
      prisma.omieTitulo.findMany({
        where: { ...escopo, OR: [{ dataVencimento: recorte }, { dataEmissao: recorte }, { liquidado: false, cancelado: false }] },
        orderBy: { dataVencimento: "asc" },
      })
    ),
    await medir("baixas dos títulos carregados", () =>
      prisma.omieBaixa.findMany({
        where: { ...escopo, titulo: { OR: [{ dataVencimento: recorte }, { dataEmissao: recorte }, { liquidado: false, cancelado: false }] } },
      })
    ),
    await medir("movimentos", () => prisma.omieMovimento.findMany({ where: { ...escopo, data: recorte }, orderBy: { data: "asc" } })),
    await medir("parceiros", () => prisma.omieParceiro.findMany({ where: escopo })),
    await medir("categorias", () => prisma.omieCategoria.findMany({ where: escopo })),
    // O QUE A TELA DE CUSTOS REALMENTE PRECISA: a soma por categoria, não as
    // linhas. Mesma janela, mesmo filtro; o que muda é o que volta pela rede —
    // dezenas de linhas em vez de dezenas de milhares.
    await medir("DRE por categoria (GROUP BY)", () =>
      prisma.$queryRaw(Prisma.sql`
        SELECT COALESCE(t."categoriaCodigo", 'SEM_CATEGORIA') AS categoria,
               SUM(t."valorDocumentoCents")::bigint AS cents
          FROM ${tabela("OmieTitulo")} t
         WHERE t."companyId" = ${EMPRESA} AND t.cancelado = false
           AND COALESCE(t."dataEmissao", t."dataVencimento") >= ${desde}
         GROUP BY 1`)
    ),
    await medir("20 maiores títulos por categoria (janela)", () =>
      prisma.$queryRaw(Prisma.sql`
        SELECT * FROM (
          SELECT t.id, t."categoriaCodigo", t."valorDocumentoCents",
                 ROW_NUMBER() OVER (PARTITION BY t."categoriaCodigo"
                                    ORDER BY ABS(t."valorDocumentoCents") DESC) AS pos
            FROM ${tabela("OmieTitulo")} t
           WHERE t."companyId" = ${EMPRESA} AND t.cancelado = false
             AND COALESCE(t."dataEmissao", t."dataVencimento") >= ${desde}
        ) x WHERE x.pos <= 20`)
    ),
  ];

  console.log(`\n--- mediana de ${RODADAS} rodadas, Postgres local (sem latência de rede) ---`);
  let soma = 0;
  for (const r of resultados.sort((a, b) => b.mediana - a.mediana)) {
    soma += r.mediana;
    console.log(`${String(r.mediana).padStart(6)} ms  ${r.nome.padEnd(36)} ${String(r.linhas).padStart(7)} linhas`);
  }
  console.log(`${String(soma).padStart(6)} ms  TOTAL (as consultas rodam em paralelo; o pior manda)`);
  await prisma.$disconnect();
}
principal();
