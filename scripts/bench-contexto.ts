// ONDE VAI O TEMPO DE ABRIR UMA TELA.
//
// `carregarContexto` roda em toda página do módulo. Este script o executa
// contra um Postgres local com volume parecido com o de produção e mede,
// isolada e repetidamente, cada consulta que ele dispara — para a decisão de
// otimizar sair de número medido, não de suspeita.
//
// Uso: TESTE_DATABASE_URL=... TITULOS=50000 npx tsx scripts/bench-contexto.ts
import { PrismaClient } from "@prisma/client";

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

async function semear(titulos: number) {
  for (const t of ["omieBaixa", "omieTitulo", "omieMovimento", "omieParceiro", "omieConexao", "controladoriaConfig"] as const) {
    await (prisma[t] as { deleteMany: (a: unknown) => Promise<unknown> }).deleteMany({ where: { companyId: EMPRESA } });
  }
  const cx = await prisma.omieConexao.create({
    data: { companyId: EMPRESA, nome: "Bench", apelido: "BENCH", credencialRef: "B" },
  });
  await prisma.controladoriaConfig.create({ data: { companyId: EMPRESA, dataInicioBase: new Date(2025, 0, 1) } });
  const base = { companyId: EMPRESA, conexaoId: cx.id, conexaoApelido: "BENCH", status: "ABERTO" };
  for (let lote = 0; lote < Math.ceil(titulos / 5000); lote++) {
    await prisma.omieTitulo.createMany({
      data: Array.from({ length: 5000 }, (_, i) => {
        const n = lote * 5000 + i;
        const dia = new Date(2026, 0, 1 + (n % 265));
        return {
          ...base,
          natureza: (n % 3 === 0 ? "RECEBER" : "PAGAR") as "RECEBER" | "PAGAR",
          codigoLancamento: `L${n}`,
          parceiroCodigo: `P${n % 800}`,
          parceiroNome: `Fornecedor ${n % 800}`,
          parceiroDocumento: String(10000000000000 + (n % 800)),
          categoriaCodigo: `C${n % 40}`,
          categoriaDescricao: `Categoria ${n % 40}`,
          numeroDocumento: String(n),
          observacao: "x".repeat(120),
          dataEmissao: dia,
          dataVencimento: dia,
          valorDocumentoCents: 10_000 + (n % 9999),
          valorPagoCents: 10_000,
          liquidado: n % 4 !== 0,
        };
      }),
    });
  }
  await prisma.omieBaixa.createMany({
    data: Array.from({ length: Math.min(titulos, 20000) }, (_, i) => ({
      companyId: EMPRESA, conexaoId: cx.id, tituloId: "x", chave: `B${i}`,
      dataBaixa: new Date(2026, 0, 1 + (i % 265)), valorCents: 10_000,
    })),
    skipDuplicates: true,
  }).catch(() => undefined);
  await prisma.omieMovimento.createMany({
    data: Array.from({ length: 15000 }, (_, i) => ({
      companyId: EMPRESA, conexaoId: cx.id, conexaoApelido: "BENCH",
      contaCorrenteCodigo: String(100 + (i % 6)), codigoLancamento: `M${i}`,
      data: new Date(2026, 0, 1 + (i % 265)), valorCents: (i % 2 ? 1 : -1) * (5_000 + i),
    })),
  });
  await prisma.omieParceiro.createMany({
    data: Array.from({ length: 800 }, (_, i) => ({
      companyId: EMPRESA, conexaoId: cx.id, conexaoApelido: "BENCH",
      codigoOmie: `P${i}`, nome: `Fornecedor ${i}`, documento: String(10000000000000 + i),
    })),
  });
  return cx.id;
}

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
  await semear(alvo);
  await prisma.$executeRawUnsafe("ANALYZE");

  const desde = new Date(2026, 0, 1);
  const recorte = { gte: desde };
  const escopo = { companyId: EMPRESA };

  const resultados = [
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
