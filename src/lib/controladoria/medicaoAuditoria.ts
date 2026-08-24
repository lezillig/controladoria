import { prisma } from "@/lib/prisma";

// QUANTO CUSTA A AUDITORIA, E ONDE.
//
// A fase de auditoria roda perto do teto de 60 segundos da função, e função que
// estoura não grava nada. O ciclo já media o tempo e gravava em
// `OmieSyncRun.detalhes` — mas nada mostrava, e "roda em 46s" continuava sendo
// uma frase sem ação possível.
//
// A distinção que decide o conserto: CARREGAR o contexto e RODAR os agentes são
// custos diferentes. Se o gargalo é o carregamento, dividir os agentes entre
// invocações não ajuda em nada — cada invocação recarregaria o contexto inteiro
// e o custo total subiria. Se o gargalo são os agentes, dividir resolve.
//
// Sem esta leitura, escolher entre os dois é chute — e chute aqui custa uma
// publicação e mais um dia de ciclo estourando.

export type MedicaoAuditoria = {
  em: string | null;
  msContexto: number | null;
  msAgentes: number | null;
  msTotal: number | null;
  titulos: number | null;
  baixas: number | null;
  movimentos: number | null;
  notas: number | null;
  parceiros: number | null;
  janelaDesde: string | null;
};

function numero(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

export async function ultimaMedicaoDaAuditoria(companyId: string): Promise<MedicaoAuditoria | null> {
  try {
    // A execução do CICLO (auditoria e relatório) é a que tem `conexaoId` nulo:
    // ela cobre o grupo, não uma empresa. Filtrar por ela evita pescar a
    // medição de uma janela de carga, que não roda auditoria.
    // As cinco últimas, e a primeira que tiver medição — em vez de filtrar
    // `detalhes` no banco. O campo é Json, onde `not: null` no Prisma tem
    // semântica própria (nulo do banco x nulo do JSON) e a consulta viraria uma
    // pegadinha para quem lesse depois. Cinco linhas com uma coluna custam
    // nada, e a execução mais recente quase sempre é a primeira.
    const runs = await prisma.omieSyncRun.findMany({
      where: { companyId, conexaoId: null },
      orderBy: { iniciadoEm: "desc" },
      take: 5,
      select: { detalhes: true },
    });
    const bruto = runs
      .map((r) => (r.detalhes as { medicaoContexto?: Record<string, unknown> } | null)?.medicaoContexto)
      .find((m) => m != null);
    if (!bruto) return null;

    return {
      em: texto(bruto.em),
      msContexto: numero(bruto.msContexto),
      msAgentes: numero(bruto.msAgentes),
      msTotal: numero(bruto.msTotal),
      titulos: numero(bruto.titulos),
      baixas: numero(bruto.baixas),
      movimentos: numero(bruto.movimentos),
      notas: numero(bruto.notas),
      parceiros: numero(bruto.parceiros),
      janelaDesde: texto(bruto.janelaDesde),
    };
  } catch {
    return null;
  }
}
