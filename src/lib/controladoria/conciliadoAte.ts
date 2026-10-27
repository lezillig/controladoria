import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tabela } from "@/lib/esquemaDoBanco";

// ATÉ QUE DIA CADA CONTA ESTÁ CONCILIADA.
//
// "Conciliado até" é o último dia em que TUDO para trás está conciliado: a
// véspera do primeiro lançamento pendente do extrato, olhando o histórico
// inteiro (e não só a janela da tela) — um pendente esquecido de março deixa a
// conta conciliada até fevereiro, por mais que abril esteja em dia, e é
// exatamente isso que a pergunta quer saber. Sem pendente, a conta está
// conciliada até o último lançamento.
//
// Lançamento com data depois da referência (agendado, "previsto") fica de
// fora: ainda não aconteceu, não tem o que conciliar.

export type SituacaoDaConta = {
  conexaoId: string;
  contaCodigo: string;
  movimentos: number;
  pendentes: number;
  pendentesCents: number;
  primeiroPendente: Date | null;
  primeiroMovimento: Date | null;
  ultimoMovimento: Date | null;
  ultimaConciliacao: Date | null;
};

const DIA = 86_400_000;

export function conciliadoAte(s: Pick<SituacaoDaConta, "primeiroPendente" | "primeiroMovimento" | "ultimoMovimento">, dataReferencia: Date): {
  ate: Date | null;
  nadaConciliado: boolean;
  diasDeAtraso: number | null;
} {
  if (!s.ultimoMovimento) return { ate: null, nadaConciliado: false, diasDeAtraso: null };
  const nadaConciliado = !!s.primeiroPendente && !!s.primeiroMovimento && s.primeiroPendente.getTime() <= s.primeiroMovimento.getTime();
  const ate = s.primeiroPendente ? new Date(s.primeiroPendente.getTime() - DIA) : s.ultimoMovimento;
  // Atraso contado até a data de referência (D-1): conta sem pendente está em dia.
  const ref = Date.UTC(dataReferencia.getFullYear(), dataReferencia.getMonth(), dataReferencia.getDate());
  const diasDeAtraso = s.primeiroPendente ? Math.max(0, Math.round((ref - Date.UTC(ate.getUTCFullYear(), ate.getUTCMonth(), ate.getUTCDate())) / DIA)) : 0;
  return { ate, nadaConciliado, diasDeAtraso };
}

type Linha = {
  conexaoId: string;
  conta: string;
  movimentos: bigint;
  pendentes: bigint;
  pendentes_cents: bigint | null;
  primeiro_pendente: Date | null;
  primeiro: Date | null;
  ultimo: Date | null;
  ultima_conciliacao: Date | null;
};

export async function situacaoDasContas(params: { companyId: string; conexaoId: string | null; dataReferencia: Date }): Promise<Map<string, SituacaoDaConta>> {
  const fim = new Date(params.dataReferencia.getFullYear(), params.dataReferencia.getMonth(), params.dataReferencia.getDate(), 23, 59, 59);
  const linhas = await prisma.$queryRaw<Linha[]>`
    SELECT m."conexaoId", m."contaCorrenteCodigo" AS conta,
           COUNT(*)::bigint AS movimentos,
           COUNT(*) FILTER (WHERE NOT m.conciliado)::bigint AS pendentes,
           SUM(ABS(m."valorCents")) FILTER (WHERE NOT m.conciliado)::bigint AS pendentes_cents,
           MIN(m.data) FILTER (WHERE NOT m.conciliado) AS primeiro_pendente,
           MIN(m.data) AS primeiro,
           MAX(m.data) AS ultimo,
           MAX(m."dataConciliacao") AS ultima_conciliacao
      FROM ${tabela("OmieMovimento")} m
     WHERE m."companyId" = ${params.companyId}
       AND m.data <= ${fim}
       ${params.conexaoId ? Prisma.sql`AND m."conexaoId" = ${params.conexaoId}` : Prisma.empty}
     GROUP BY 1, 2`;
  return new Map(
    linhas.map((l) => [
      `${l.conexaoId}:${l.conta}`,
      {
        conexaoId: l.conexaoId,
        contaCodigo: l.conta,
        movimentos: Number(l.movimentos),
        pendentes: Number(l.pendentes),
        pendentesCents: Number(l.pendentes_cents ?? 0),
        primeiroPendente: l.primeiro_pendente,
        primeiroMovimento: l.primeiro,
        ultimoMovimento: l.ultimo,
        ultimaConciliacao: l.ultima_conciliacao,
      },
    ])
  );
}
