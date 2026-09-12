import { prisma } from "@/lib/prisma";
import { esquemaDaControladoria, tabela } from "@/lib/esquemaDoBanco";

// LIMPEZA DA BASE ANTIGA — a mesma sequência de docs/limpar-base-historica.sql,
// executada pelo sistema em vez de colada num console.
//
// Existe como botão porque a ORDEM dos passos é o que decide se a limpeza
// serve para alguma coisa, e ordem é o que se erra ao rodar SQL à mão: mover
// a data de início da base vem ANTES de apagar, senão a carga histórica —
// autocurável de propósito — rebaixa tudo na noite seguinte. Aqui a ordem
// está no código e não depende de ninguém lembrar.
//
// O que fica: títulos ainda em aberto, por mais antigos que sejam (a opção B
// do documento). Dinheiro que alguém ainda deve não pode sumir da tela por ser
// velho — é o contrário do que uma auditoria faz.
//
// Não é perda definitiva: o espelho é cópia, a Omie continua com tudo. Mover a
// data de início para trás e rodar a carga traz de volta.

export const CORTE = new Date("2025-01-01T00:00:00.000Z");
const COMPETENCIA_DE_CORTE = "2025-01";

export type MedidaDaBaseAntiga = {
  titulos: number;
  titulosEmAberto: number;
  movimentos: number;
  notas: number;
  resumoMensal: number;
  janelasDeCarga: number;
  dataInicioBase: Date | null;
  // Os maiores títulos antigos ainda em aberto — o que a opção B preserva.
  emAbertoMaiores: {
    conexaoApelido: string;
    natureza: string;
    parceiroNome: string | null;
    numeroDocumento: string | null;
    dataVencimento: Date;
    valorCents: number;
  }[];
};

const n = (r: { n: bigint | number }[]) => Number(r[0]?.n ?? 0);

export async function medirBaseAntiga(companyId: string): Promise<MedidaDaBaseAntiga> {
  const [titulos, titulosEmAberto, movimentos, notas, resumoMensal, janelasDeCarga, config, emAbertoMaiores] =
    await Promise.all([
      prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*) AS n FROM ${tabela("OmieTitulo")}
         WHERE "companyId" = ${companyId}
           AND COALESCE("dataEmissao", "dataVencimento") < ${CORTE}`,
      prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*) AS n FROM ${tabela("OmieTitulo")}
         WHERE "companyId" = ${companyId}
           AND COALESCE("dataEmissao", "dataVencimento") < ${CORTE}
           AND liquidado = false AND cancelado = false`,
      prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*) AS n FROM ${tabela("OmieMovimento")}
         WHERE "companyId" = ${companyId} AND data < ${CORTE}`,
      prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*) AS n FROM ${tabela("OmieNota")}
         WHERE "companyId" = ${companyId} AND "dataEmissao" < ${CORTE}`,
      prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*) AS n FROM ${tabela("HistoricoMensal")}
         WHERE "companyId" = ${companyId} AND competencia < ${COMPETENCIA_DE_CORTE}`,
      prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*) AS n FROM ${tabela("OmieSyncRun")}
         WHERE "companyId" = ${companyId} AND backfill = true AND "janelaFim" < ${CORTE}`,
      prisma.controladoriaConfig.findFirst({ where: { companyId }, select: { dataInicioBase: true } }),
      prisma.omieTitulo.findMany({
        where: {
          companyId,
          liquidado: false,
          cancelado: false,
          OR: [{ dataEmissao: { lt: CORTE } }, { dataEmissao: null, dataVencimento: { lt: CORTE } }],
        },
        orderBy: { valorDocumentoCents: "desc" },
        take: 10,
        select: {
          conexaoApelido: true, natureza: true, parceiroNome: true, numeroDocumento: true,
          dataVencimento: true, valorDocumentoCents: true,
        },
      }),
    ]);

  return {
    titulos: n(titulos),
    titulosEmAberto: n(titulosEmAberto),
    movimentos: n(movimentos),
    notas: n(notas),
    resumoMensal: n(resumoMensal),
    janelasDeCarga: n(janelasDeCarga),
    dataInicioBase: config?.dataInicioBase ?? null,
    emAbertoMaiores: emAbertoMaiores.map((t) => ({ ...t, natureza: String(t.natureza), valorCents: t.valorDocumentoCents })),
  };
}

export type ResultadoDaLimpeza = {
  dataInicioMovida: boolean;
  titulosApagados: number;
  titulosEmAbertoPreservados: number;
  movimentosApagados: number;
  notasApagadas: number;
  resumoMensalApagado: number;
  janelasApagadas: number;
  achadosOrfaosApagados: number;
  vacuum: boolean;
};

export async function limparBaseAntiga(companyId: string): Promise<ResultadoDaLimpeza> {
  // PASSO 1 — a data de início da base, antes de qualquer DELETE. Sem isto o
  // resto é desperdício: a carga rebaixaria o período apagado.
  const movidas = await prisma.controladoriaConfig.updateMany({
    where: { companyId, dataInicioBase: { lt: CORTE } },
    data: { dataInicioBase: CORTE },
  });

  // PASSOS 2 a 4 numa transação: ou some tudo, ou não some nada. As baixas vão
  // junto com o título pela chave estrangeira (ON DELETE CASCADE); não há
  // DELETE separado para elas, e não deve haver.
  //
  // Transação interativa, e não o lote de promessas, por causa do prazo: o
  // lote usa o teto padrão do Prisma, cinco segundos, e apagar cem mil títulos
  // com as baixas em cascata leva mais que isso. Aqui o prazo é explícito.
  const apagados = await prisma.$transaction(
    async (tx) => {
      const titulos = await tx.$executeRaw`
        DELETE FROM ${tabela("OmieTitulo")}
         WHERE "companyId" = ${companyId}
           AND COALESCE("dataEmissao", "dataVencimento") < ${CORTE}
           AND (liquidado = true OR cancelado = true)`;
      const movimentos = await tx.$executeRaw`
        DELETE FROM ${tabela("OmieMovimento")}
         WHERE "companyId" = ${companyId} AND data < ${CORTE}`;
      const notas = await tx.$executeRaw`
        DELETE FROM ${tabela("OmieNota")}
         WHERE "companyId" = ${companyId} AND "dataEmissao" < ${CORTE}`;
      // Derivado e idempotente: some porque não há mais títulos para
      // sustentá-lo, e o botão "Recalcular resumo mensal" refaz o que faltar.
      const resumoMensal = await tx.$executeRaw`
        DELETE FROM ${tabela("HistoricoMensal")}
         WHERE "companyId" = ${companyId} AND competencia < ${COMPETENCIA_DE_CORTE}`;
      // As janelas de carga do período apagado. Sem isto a barra da carga
      // histórica seguiria contando janelas de um período que não existe.
      const janelas = await tx.$executeRaw`
        DELETE FROM ${tabela("OmieSyncRun")}
         WHERE "companyId" = ${companyId} AND backfill = true AND "janelaFim" < ${CORTE}`;
      // Achados que apontavam para títulos apagados: ficariam na lista sem
      // forma de conferir a evidência. Por objeto, não por data — achado de
      // 2026 sobre um título de 2023 também fica órfão.
      const achadosOrfaos = await tx.$executeRaw`
        DELETE FROM ${tabela("AuditFinding")} f
         WHERE f."companyId" = ${companyId}
           AND f."entidadeTipo" = 'OmieTitulo'
           AND NOT EXISTS (SELECT 1 FROM ${tabela("OmieTitulo")} t WHERE t.id = f."entidadeId")`;
      return { titulos, movimentos, notas, resumoMensal, janelas, achadosOrfaos };
    },
    { timeout: 240_000, maxWait: 10_000 }
  );

  const preservados = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) AS n FROM ${tabela("OmieTitulo")}
     WHERE "companyId" = ${companyId}
       AND COALESCE("dataEmissao", "dataVencimento") < ${CORTE}`;

  // PASSO 5 — VACUUM. Sem ele as páginas ficam marcadas como reutilizáveis mas
  // o arquivo não encolhe, e o que se paga na Neon é o arquivo. Não roda dentro
  // de transação (o Postgres proíbe), por isso vem depois e um a um. Falhar
  // aqui não desfaz a limpeza — só adia o encolhimento para o autovacuum.
  let vacuum = true;
  const schema = esquemaDaControladoria();
  for (const t of ["OmieTitulo", "OmieBaixa", "OmieMovimento", "OmieNota", "AuditFinding", "HistoricoMensal"]) {
    try {
      // Nome fixo desta lista + schema validado em esquemaDoBanco: nada aqui
      // vem de entrada de usuário.
      await prisma.$executeRawUnsafe(`VACUUM (ANALYZE) "${schema}"."${t}"`);
    } catch {
      vacuum = false;
    }
  }

  return {
    dataInicioMovida: movidas.count > 0,
    titulosApagados: apagados.titulos,
    titulosEmAbertoPreservados: n(preservados),
    movimentosApagados: apagados.movimentos,
    notasApagadas: apagados.notas,
    resumoMensalApagado: apagados.resumoMensal,
    janelasApagadas: apagados.janelas,
    achadosOrfaosApagados: apagados.achadosOrfaos,
    vacuum,
  };
}
