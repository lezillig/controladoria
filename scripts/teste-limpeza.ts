// TESTE DA LIMPEZA DA BASE ANTIGA — `npm run teste:limpeza`.
//
// Roda a sequência real de DELETE (src/lib/controladoria/limpezaHistorica.ts)
// contra um Postgres de verdade, porque SQL cru não tem verificação de tipo:
// uma coluna com o nome errado só aparece em produção, e em produção esta
// função apaga cem mil linhas. Mesmo Postgres e mesmas instruções do
// scripts/teste-sql.ts (TESTE_DATABASE_URL).
//
// O que se prova aqui, em ordem de importância:
//   1. Título antigo EM ABERTO fica; antigo liquidado ou cancelado some.
//   2. A data de início da base é movida ANTES — e só quando estava atrás.
//   3. Baixa some junto com o título (cascata); achado que apontava para um
//      título apagado some; achado sobre título vivo fica.
//   4. Tudo de 2025 em diante fica intocado.
//   5. Outra empresa no mesmo banco não é afetada.
import { PrismaClient } from "@prisma/client";

const url = process.env.TESTE_DATABASE_URL;
if (!url) {
  console.log("\nTESTE_DATABASE_URL não definida — pulando o teste de limpeza (precisa de um Postgres real).\n");
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

const EMPRESA = "empresa-limpeza";
const OUTRA = "outra-empresa-limpeza";

async function zerar() {
  for (const c of [EMPRESA, OUTRA]) {
    await prisma.auditFinding.deleteMany({ where: { companyId: c } });
    await prisma.historicoMensal.deleteMany({ where: { companyId: c } });
    await prisma.omieMovimento.deleteMany({ where: { companyId: c } });
    await prisma.omieBaixa.deleteMany({ where: { companyId: c } });
    await prisma.omieTitulo.deleteMany({ where: { companyId: c } });
    await prisma.omieSyncRun.deleteMany({ where: { companyId: c } });
    await prisma.omieConexao.deleteMany({ where: { companyId: c } });
    await prisma.controladoriaConfig.deleteMany({ where: { companyId: c } });
  }
}

async function titulo(companyId: string, conexaoId: string, codigo: string, emissao: string, liquidado: boolean, cancelado = false) {
  return prisma.omieTitulo.create({
    data: {
      companyId, conexaoId, conexaoApelido: "T", natureza: "PAGAR", codigoLancamento: codigo,
      dataEmissao: new Date(emissao), dataVencimento: new Date(emissao), valorDocumentoCents: 1000,
      status: liquidado ? "LIQUIDADO" : "ABERTO", liquidado, cancelado,
    },
  });
}

async function main() {
  const { limparBaseAntiga, medirBaseAntiga } = await import("../src/lib/controladoria/limpezaHistorica");
  await zerar();

  const conexao = await prisma.omieConexao.create({
    data: { companyId: EMPRESA, nome: "Teste", apelido: "T", credencialRef: "TESTE" },
  });
  const outraConexao = await prisma.omieConexao.create({
    data: { companyId: OUTRA, nome: "Outra", apelido: "O", credencialRef: "OUTRA" },
  });
  await prisma.controladoriaConfig.create({ data: { companyId: EMPRESA, dataInicioBase: new Date("2020-12-31") } });
  await prisma.controladoriaConfig.create({ data: { companyId: OUTRA, dataInicioBase: new Date("2020-12-31") } });

  const antigoPago = await titulo(EMPRESA, conexao.id, "a-pago", "2023-05-10", true);
  const antigoCancelado = await titulo(EMPRESA, conexao.id, "a-canc", "2024-11-30", false, true);
  const antigoAberto = await titulo(EMPRESA, conexao.id, "a-aberto", "2024-06-01", false);
  const novoPago = await titulo(EMPRESA, conexao.id, "n-pago", "2025-01-01", true);
  const daOutra = await titulo(OUTRA, outraConexao.id, "o-pago", "2022-01-01", true);

  await prisma.omieBaixa.create({
    data: { companyId: EMPRESA, conexaoId: conexao.id, tituloId: antigoPago.id, chave: "b1", dataBaixa: new Date("2023-05-15"), valorCents: 1000 },
  });
  await prisma.omieBaixa.create({
    data: { companyId: EMPRESA, conexaoId: conexao.id, tituloId: novoPago.id, chave: "b2", dataBaixa: new Date("2025-01-10"), valorCents: 1000 },
  });
  await prisma.omieMovimento.createMany({
    data: [
      { companyId: EMPRESA, conexaoId: conexao.id, conexaoApelido: "T", contaCorrenteCodigo: "1", codigoLancamento: "m-antigo", data: new Date("2024-12-31"), valorCents: 1 },
      { companyId: EMPRESA, conexaoId: conexao.id, conexaoApelido: "T", contaCorrenteCodigo: "1", codigoLancamento: "m-novo", data: new Date("2025-01-01"), valorCents: 1 },
    ],
  });
  await prisma.historicoMensal.createMany({
    data: [
      { companyId: EMPRESA, conexaoId: conexao.id, competencia: "2024-12", natureza: "PAGAR", dimensao: "PARCEIRO", chave: "x" },
      { companyId: EMPRESA, conexaoId: conexao.id, competencia: "2025-01", natureza: "PAGAR", dimensao: "PARCEIRO", chave: "x" },
    ],
  });
  await prisma.omieSyncRun.createMany({
    data: [
      { companyId: EMPRESA, conexaoId: conexao.id, backfill: true, status: "CONCLUIDO", janelaInicio: new Date("2024-12-01"), janelaFim: new Date("2024-12-31") },
      { companyId: EMPRESA, conexaoId: conexao.id, backfill: true, status: "CONCLUIDO", janelaInicio: new Date("2025-01-01"), janelaFim: new Date("2025-01-31") },
    ],
  });
  const achado = (chave: string, entidadeId: string | null) =>
    prisma.auditFinding.create({
      data: {
        companyId: EMPRESA, agente: "contasPagar", regra: "CP-X", severidade: "MEDIA", categoria: "ERRO_PROCESSO",
        titulo: chave, descricao: chave, chave, entidadeTipo: entidadeId ? "OmieTitulo" : null, entidadeId,
      },
    });
  await achado("sobre-apagado", antigoPago.id);
  await achado("sobre-vivo", antigoAberto.id);
  await achado("sem-entidade", null);

  console.log("\n1. Medida antes");
  const medida = await medirBaseAntiga(EMPRESA);
  conferir("três títulos antigos", medida.titulos, 3);
  conferir("um deles em aberto", medida.titulosEmAberto, 1);
  conferir("o em aberto aparece na lista", medida.emAbertoMaiores.map((t) => t.numeroDocumento ?? "sem número"), ["sem número"]);
  conferir("um movimento antigo", medida.movimentos, 1);
  conferir("uma competência antiga de resumo", medida.resumoMensal, 1);
  conferir("uma janela antiga de carga", medida.janelasDeCarga, 1);

  console.log("\n2. Limpeza");
  const r = await limparBaseAntiga(EMPRESA);
  conferir("data de início movida", r.dataInicioMovida, true);
  conferir("dois títulos apagados (pago e cancelado)", r.titulosApagados, 2);
  conferir("um antigo em aberto preservado", r.titulosEmAbertoPreservados, 1);
  conferir("movimento antigo apagado", r.movimentosApagados, 1);
  conferir("resumo antigo apagado", r.resumoMensalApagado, 1);
  conferir("janela antiga apagada", r.janelasApagadas, 1);
  conferir("um achado órfão apagado", r.achadosOrfaosApagados, 1);

  console.log("\n3. O que ficou");
  const config = await prisma.controladoriaConfig.findUnique({ where: { companyId: EMPRESA } });
  conferir("início da base = 2025-01-01", config?.dataInicioBase.toISOString().slice(0, 10), "2025-01-01");
  const vivos = await prisma.omieTitulo.findMany({ where: { companyId: EMPRESA }, orderBy: { codigoLancamento: "asc" }, select: { codigoLancamento: true } });
  conferir("ficaram o antigo em aberto e o novo", vivos.map((t) => t.codigoLancamento), ["a-aberto", "n-pago"]);
  conferir("baixa do título apagado sumiu em cascata", await prisma.omieBaixa.count({ where: { companyId: EMPRESA } }), 1);
  conferir("movimento de 2025 ficou", await prisma.omieMovimento.count({ where: { companyId: EMPRESA } }), 1);
  const achados = await prisma.auditFinding.findMany({ where: { companyId: EMPRESA }, orderBy: { chave: "asc" }, select: { chave: true } });
  conferir("achado sobre título vivo e achado sem entidade ficaram", achados.map((a) => a.chave), ["sem-entidade", "sobre-vivo"]);
  conferir("resumo de 2025 ficou", await prisma.historicoMensal.count({ where: { companyId: EMPRESA } }), 1);
  conferir("janela de 2025 ficou", await prisma.omieSyncRun.count({ where: { companyId: EMPRESA } }), 1);
  conferir("cancelado antigo sumiu", await prisma.omieTitulo.count({ where: { id: antigoCancelado.id } }), 0);

  console.log("\n4. Outra empresa intocada");
  conferir("título antigo da outra empresa ficou", await prisma.omieTitulo.count({ where: { id: daOutra.id } }), 1);
  const outraConfig = await prisma.controladoriaConfig.findUnique({ where: { companyId: OUTRA } });
  conferir("data da outra empresa não mudou", outraConfig?.dataInicioBase.toISOString().slice(0, 10), "2020-12-31");

  console.log("\n5. Rodar de novo não apaga nada");
  const r2 = await limparBaseAntiga(EMPRESA);
  conferir("segunda rodada: zero apagados", [r2.titulosApagados, r2.movimentosApagados, r2.achadosOrfaosApagados], [0, 0, 0]);
  conferir("segunda rodada: data não mexida", r2.dataInicioMovida, false);

  await zerar();
}

main()
  .then(() => {
    console.log(falhas === 0 ? "\nTodos os testes passaram.\n" : `\n${falhas} FALHA(S).\n`);
    process.exit(falhas === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
