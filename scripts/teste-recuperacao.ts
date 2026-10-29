// JANELA DE RECUPERAÇÃO E SAÚDE DA SINCRONIZAÇÃO — `npm run teste:recuperacao` (precisa de TESTE_DATABASE_URL).
import { PrismaClient } from "@prisma/client";

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "  ok  " : "FALHA "} ${nome}${ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         veio     ${JSON.stringify(real)}`}`);
}
const d = (s: string) => new Date(`${s}T12:00:00`);

(async () => {
  const url = process.env.TESTE_DATABASE_URL;
  if (!url) {
    console.log("TESTE_DATABASE_URL não definida — pulando.");
    process.exit(0);
  }
  process.env.DATABASE_URL = url;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const { inicioDaJanelaDaConexao, saudeDaSincronizacao } = await import("../src/lib/controladoria/ciclo");
  const E = "empresa-recuperacao";
  const limpar = async () => {
    await prisma.omieSyncRun.deleteMany({ where: { companyId: E } });
    await prisma.omieConexao.deleteMany({ where: { companyId: E } });
  };
  await limpar();
  try {
    const az = await prisma.omieConexao.create({ data: { companyId: E, nome: "Azul", apelido: "AZ", credencialRef: "AZ" } });
    const mc = await prisma.omieConexao.create({ data: { companyId: E, nome: "MCZ", apelido: "MC", credencialRef: "MC" } });
    const run = (conexaoId: string, fim: string, x: Record<string, unknown> = {}) =>
      prisma.omieSyncRun.create({ data: { companyId: E, conexaoId, status: "CONCLUIDO", fase: "concluido", janelaInicio: d(fim), janelaFim: d(fim), backfill: false, ...x } });
    await run(az.id, "2026-10-27");
    await run(mc.id, "2026-10-10");
    // Depois disso, "concluídas" com a recusa só no erro (regra antiga) e uma ERRO pela regra nova.
    await run(mc.id, "2026-10-20", { erro: "títulos: Omie recusou PesquisarLancamentos: A chave de acesso está inválida ou o aplicativo está suspenso" });
    await run(mc.id, "2026-10-27", { status: "ERRO", erro: "CONTA RECUSADA PELA OMIE: Para consumir a API Omie é necessário ativar um addon na Omie Store." });
    const normal = new Date(2026, 9, 25);
    conferir("em dia: janela normal", (await inicioDaJanelaDaConexao(az.id, normal)).getTime(), normal.getTime());
    conferir("MCZ: recomeça 3 dias antes da última boa (10/10)", (await inicioDaJanelaDaConexao(mc.id, normal)).toISOString().slice(0, 10), new Date(2026, 9, 7).toISOString().slice(0, 10));
    const saude = await saudeDaSincronizacao(E, new Date(2026, 9, 28, 9));
    conferir("saúde: só a MCZ em alerta, com a causa", saude.map((s) => [s.apelido, s.alerta, !!s.recusa]), [["AZ", false, false], ["MC", true, true]]);
  } finally {
    await limpar();
    await prisma.$disconnect();
  }
  console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
})();
