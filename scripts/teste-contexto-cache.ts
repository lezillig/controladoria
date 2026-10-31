// O CONTEXTO DAS TELAS EM CACHE — `npm run teste:contexto-cache`.
//
// Com Postgres (TESTE_DATABASE_URL): a mesma tela aberta de novo reaproveita
// o retrato; muda a versão dos dados (classificação do DRE, sincronização) ou
// alguém invalida, e o retrato é montado de novo; outra empresa (conexão) é
// outro retrato.
export {};
import { PrismaClient } from "@prisma/client";

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "  ok  " : "FALHA "} ${nome}${ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         veio     ${JSON.stringify(real)}`}`);
}

(async () => {
  const url = process.env.TESTE_DATABASE_URL;
  if (!url) {
    console.log("TESTE_DATABASE_URL não definida — pulando.");
    process.exit(0);
  }
  process.env.DATABASE_URL = url;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const { contextoEmCache, invalidarContextoEmCache } = await import("../src/lib/controladoria/contextoEmCache");
  const E = "empresa-contexto-cache";
  const limpar = async () => {
    await prisma.omieTitulo.deleteMany({ where: { companyId: E } });
    await prisma.dreClassificacao.deleteMany({ where: { companyId: E } });
    await prisma.omieSyncRun.deleteMany({ where: { companyId: E } });
    await prisma.omieConexao.deleteMany({ where: { companyId: E } });
    await prisma.controladoriaConfig.deleteMany({ where: { companyId: E } });
  };
  await limpar();
  try {
    const cx = await prisma.omieConexao.create({ data: { companyId: E, nome: "Azul", apelido: "AZ", credencialRef: "AZCACHE" } });
    await prisma.omieTitulo.create({
      data: { companyId: E, conexaoId: cx.id, conexaoApelido: "AZ", codigoLancamento: "1", natureza: "PAGAR", status: "A VENCER", valorDocumentoCents: 100_00, dataVencimento: new Date(2026, 9, 10) },
    });
    // A configuração padrão nasce na primeira montagem e muda a versão; aqui
    // ela já existe, como em toda empresa depois do primeiro acesso.
    const { garantirConfig } = await import("../src/lib/controladoria/contexto");
    await garantirConfig(E);
    const ref = new Date(2026, 9, 29);
    const abrir = (conexaoId?: string) => contextoEmCache(E, ref, conexaoId, { desde: new Date(2026, 0, 1) });

    const a = await abrir();
    const b = await abrir();
    conferir("a mesma tela de novo: o mesmo retrato", a === b, true);
    conferir("o retrato tem o título", a.titulos.length, 1);

    const outra = await abrir(cx.id);
    conferir("outra empresa: outro retrato", outra === a, false);
    conferir("e o do grupo continua guardado", (await abrir()) === a, true);

    await prisma.dreClassificacao.create({ data: { companyId: E, categoriaCodigo: "2.01", linha: "DESPESA_GERAL", origem: "CONFIRMADA" } });
    const c = await abrir();
    conferir("classificou o DRE: retrato novo", c === a, false);

    await prisma.omieTitulo.create({
      data: { companyId: E, conexaoId: cx.id, conexaoApelido: "AZ", codigoLancamento: "2", natureza: "PAGAR", status: "A VENCER", valorDocumentoCents: 50_00, dataVencimento: new Date(2026, 9, 12) },
    });
    conferir("título novo sem passar pela sincronização: o retrato ainda é o guardado", (await abrir()).titulos.length, 1);
    await prisma.omieSyncRun.create({ data: { companyId: E, conexaoId: cx.id, janelaInicio: new Date(2026, 9, 1), janelaFim: new Date(2026, 9, 29), status: "CONCLUIDO" } });
    conferir("a sincronização andou: retrato novo, com o título", (await abrir()).titulos.length, 2);

    const d = await abrir();
    invalidarContextoEmCache(E);
    conferir("invalidado: retrato novo", (await abrir()) === d, false);
  } finally {
    await limpar();
    await prisma.$disconnect();
  }
  console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
})();
