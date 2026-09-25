// A TELA DE CUSTOS E DRE, DOS DOIS JEITOS, NA MESMA BASE.
//
// O usuário descreveu o problema assim: "é muito lerdo para mudar de um menu
// para outro, tentei mudar para o menu Custos e DRE e demora muito". Este
// script é a régua: ele monta a tela pelo caminho antigo (carregar treze meses
// de títulos e somar na memória) e pelo novo (somar no banco), na mesma base e
// com os mesmos números na saída, e mede os dois.
//
// Uso: TESTE_DATABASE_URL=... TITULOS=50000 npx tsx scripts/bench-custos.ts
import { PrismaClient } from "@prisma/client";
import { EMPRESA_BENCH, semear } from "./_semente-bench";

const url = process.env.TESTE_DATABASE_URL;
if (!url) {
  console.log(
    "\nTESTE_DATABASE_URL não definida — este é um banco de medição, não de teste.\n" +
      "Instruções no topo de scripts/teste-sql.ts; depois:\n" +
      "  TITULOS=50000 npx tsx scripts/bench-custos.ts\n"
  );
  process.exit(0);
}

process.env.DATABASE_URL = url;
const prisma = new PrismaClient({ datasources: { db: { url } } });

const REFERENCIA = new Date(2026, 8, 22);
const RODADAS = 3;

async function medir(nome: string, f: () => Promise<unknown>) {
  const ms: number[] = [];
  for (let r = 0; r < RODADAS; r++) {
    const t = Date.now();
    await f();
    ms.push(Date.now() - t);
  }
  const ord = [...ms].sort((a, b) => a - b);
  return { nome, mediana: ord[Math.floor(ord.length / 2)] };
}

async function principal() {
  const alvo = Number(process.env.TITULOS ?? 50000);
  console.log(`semeando ${alvo} títulos...`);
  await semear(prisma, alvo);
  await prisma.$executeRawUnsafe("ANALYZE");

  const { carregarContexto } = await import("../src/lib/controladoria/contexto");
  const { montarDre, montarDreAnual } = await import("../src/lib/controladoria/dre");
  const { montarDreNoBanco, montarDreAnualNoBanco } = await import("../src/lib/controladoria/dreNoBanco");
  const { ranking, montarComparativo, comparativoDoEscopo } = await import("../src/lib/controladoria/analytics");
  const { rankingNoBanco } = await import("../src/lib/controladoria/resumoNoBanco");
  const { analisarEstrategiaDeCusto } = await import("../src/lib/controladoria/estrategiaCusto");
  const { analisarEstrategiaNoBanco } = await import("../src/lib/controladoria/estrategiaCustoNoBanco");

  const classificacoes = new Map<string, { linha: string; subgrupo: string | null; confirmada: boolean }>();
  const anoAnterior = { inicio: new Date(2025, 8, 1), fim: new Date(2025, 8, 30, 23, 59, 59, 999), rotulo: "2025" };
  const desde = new Date(2025, 8, 1);
  const escopo = { companyId: EMPRESA_BENCH, conexaoId: null, janela: { desde, ate: null } };
  const opcoes = { regime: "competencia" as const, periodoAnoAnterior: anoAnterior };

  const resultados = [
    await medir("visão MENSAL — pelo contexto (carrega as linhas)", async () => {
      const ctx = await carregarContexto(EMPRESA_BENCH, REFERENCIA, undefined, { desde });
      const comp = await montarComparativo(ctx);
      montarDre(ctx, comp.janelas.mesAtual, comp.janelas.mesAnterior, classificacoes, opcoes);
      ranking(ctx, comp.janelas.mesAtual, "PAGAR", 15);
      analisarEstrategiaDeCusto(ctx);
    }),
    await medir("visão MENSAL — somando no banco", async () => {
      const comp = await comparativoDoEscopo({
        companyId: EMPRESA_BENCH,
        conexaoId: null,
        dataReferencia: REFERENCIA,
        dataInicioBase: new Date(2025, 0, 1),
      });
      await Promise.all([
        montarDreNoBanco(escopo, comp.janelas.mesAtual, comp.janelas.mesAnterior, classificacoes, opcoes),
        rankingNoBanco(escopo, comp.janelas.mesAtual, "PAGAR", 15),
        analisarEstrategiaNoBanco(escopo, REFERENCIA),
      ]);
    }),
    await medir("visão ANUAL — pelo contexto (carrega as linhas)", async () => {
      const ctx = await carregarContexto(EMPRESA_BENCH, REFERENCIA, undefined, { desde: new Date(2026, 0, 1) });
      montarDreAnual(ctx, 2026, classificacoes, {});
    }),
    await medir("visão ANUAL — somando no banco", async () => {
      await montarDreAnualNoBanco(
        { ...escopo, janela: { desde: new Date(2026, 0, 1), ate: null } },
        2026,
        REFERENCIA,
        classificacoes,
        {}
      );
    }),
  ];

  console.log(`\n--- mediana de ${RODADAS} rodadas, Postgres local (sem latência de rede) ---`);
  for (const r of resultados) console.log(`${String(r.mediana).padStart(6)} ms  ${r.nome}`);
  await prisma.$disconnect();
}
principal();
