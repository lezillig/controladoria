// A BASE DE MEDIÇÃO, semeada uma vez e usada por mais de um bench.
//
// Volume parecido com o de produção: 50 mil títulos num ano, 40 categorias,
// 800 parceiros, 15 mil movimentos. Fica em `companyId = "bench"`, separado de
// qualquer empresa de teste, e é recriado a cada execução.
import type { PrismaClient } from "@prisma/client";

export const EMPRESA_BENCH = "bench";

export async function semear(prisma: PrismaClient, titulos: number) {
  for (const t of ["omieBaixa", "omieTitulo", "omieMovimento", "omieParceiro", "omieConexao", "controladoriaConfig"] as const) {
    await (prisma[t] as { deleteMany: (a: unknown) => Promise<unknown> }).deleteMany({ where: { companyId: EMPRESA_BENCH } });
  }
  const cx = await prisma.omieConexao.create({
    data: { companyId: EMPRESA_BENCH, nome: "Bench", apelido: "BENCH", credencialRef: "B" },
  });
  await prisma.controladoriaConfig.create({ data: { companyId: EMPRESA_BENCH, dataInicioBase: new Date(2025, 0, 1) } });
  const base = { companyId: EMPRESA_BENCH, conexaoId: cx.id, conexaoApelido: "BENCH", status: "ABERTO" };
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
      companyId: EMPRESA_BENCH, conexaoId: cx.id, tituloId: "x", chave: `B${i}`,
      dataBaixa: new Date(2026, 0, 1 + (i % 265)), valorCents: 10_000,
    })),
    skipDuplicates: true,
  }).catch(() => undefined);
  await prisma.omieMovimento.createMany({
    data: Array.from({ length: 15000 }, (_, i) => ({
      companyId: EMPRESA_BENCH, conexaoId: cx.id, conexaoApelido: "BENCH",
      contaCorrenteCodigo: String(100 + (i % 6)), codigoLancamento: `M${i}`,
      data: new Date(2026, 0, 1 + (i % 265)), valorCents: (i % 2 ? 1 : -1) * (5_000 + i),
    })),
  });
  await prisma.omieParceiro.createMany({
    data: Array.from({ length: 800 }, (_, i) => ({
      companyId: EMPRESA_BENCH, conexaoId: cx.id, conexaoApelido: "BENCH",
      codigoOmie: `P${i}`, nome: `Fornecedor ${i}`, documento: String(10000000000000 + i),
    })),
  });
  return cx.id;
}

