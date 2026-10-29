import { prisma } from "@/lib/prisma";
import { buscarPublicacoes, MODALIDADES, paraRadar, ufsDoRadar, type LicitacaoDoRadar } from "./pncp";

// A varredura anda um dia de publicação por vez e só marca o dia como feito
// quando todas as UFs, modalidades e páginas dele passaram. Um dia que não
// cabe no orçamento é refeito inteiro na próxima vez — o upsert pela chave
// do PNCP torna isso inofensivo.
//
// Primeira execução: começa DIAS_INICIAIS atrás, para pegar o que ainda está
// com proposta aberta.

export const DIAS_INICIAIS = 30;

// "AAAA-MM-DD" de Brasília, N dias a partir de hoje. Deslocamento fixo de -3 h,
// como dataReferenciaPadrao: Brasília não tem horário de verão desde 2019.
export function diaDeBrasilia(deslocamentoDias = 0, agora = Date.now()): string {
  return new Date(agora - 3 * 3_600_000 + deslocamentoDias * 86_400_000).toISOString().slice(0, 10);
}
const proximoDia = (dia: string) => new Date(Date.parse(`${dia}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

export type ResultadoVarredura = { diasVarridos: string[]; encontradas: number; novas: number; diasPendentes: number; erros: string[] };

async function gravar(companyId: string, l: LicitacaoDoRadar): Promise<boolean> {
  const existente = await prisma.radarLicitacao.findUnique({
    where: { companyId_numeroControle: { companyId, numeroControle: l.numeroControle } },
    select: { id: true },
  });
  // Republicação (retificação, prazo novo) atualiza os dados do edital, nunca
  // a decisão de quem já olhou.
  await prisma.radarLicitacao.upsert({
    where: { companyId_numeroControle: { companyId, numeroControle: l.numeroControle } },
    create: { companyId, ...l },
    update: { ...l },
  });
  return !existente;
}

export async function varrerDia(companyId: string, dia: string, prazo: number): Promise<{ completo: boolean; encontradas: number; novas: number }> {
  let encontradas = 0;
  let novas = 0;
  for (const uf of ufsDoRadar()) {
    for (const [codigo, nome] of Object.entries(MODALIDADES)) {
      for (let pagina = 1; ; pagina++) {
        if (Date.now() > prazo) return { completo: false, encontradas, novas };
        const { registros, totalPaginas } = await buscarPublicacoes(dia, uf, Number(codigo), pagina);
        for (const r of registros) {
          const l = paraRadar(r, nome);
          if (!l) continue;
          encontradas++;
          if (await gravar(companyId, l)) novas++;
        }
        if (pagina >= totalPaginas) break;
      }
    }
  }
  return { completo: true, encontradas, novas };
}

export async function varrerPendentes(companyId: string, orcamentoMs: number, agora = Date.now()): Promise<ResultadoVarredura> {
  const prazo = Date.now() + orcamentoMs;
  const ontem = diaDeBrasilia(-1, agora);
  const cursor = await prisma.radarVarredura.findUnique({ where: { companyId } });
  let dia = cursor ? proximoDia(cursor.ultimoDia.toISOString().slice(0, 10)) : diaDeBrasilia(-DIAS_INICIAIS, agora);
  const r: ResultadoVarredura = { diasVarridos: [], encontradas: 0, novas: 0, diasPendentes: 0, erros: [] };
  while (dia <= ontem && Date.now() < prazo) {
    try {
      const v = await varrerDia(companyId, dia, prazo);
      r.encontradas += v.encontradas;
      r.novas += v.novas;
      if (!v.completo) break;
      await prisma.radarVarredura.upsert({
        where: { companyId },
        create: { companyId, ultimoDia: new Date(`${dia}T00:00:00Z`) },
        update: { ultimoDia: new Date(`${dia}T00:00:00Z`) },
      });
      r.diasVarridos.push(dia);
      dia = proximoDia(dia);
    } catch (e) {
      // PNCP fora do ar: para aqui e tenta o mesmo dia na próxima vez.
      r.erros.push(e instanceof Error ? e.message.slice(0, 300) : String(e));
      break;
    }
  }
  for (let d = dia; d <= ontem; d = proximoDia(d)) r.diasPendentes++;
  return r;
}
