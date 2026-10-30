import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// A TRILHA DE AUDITORIA DA PLATAFORMA (AudLog): quem mudou o quê, quando,
// com o antes e o depois — regra de ouro 3 do azul-gestao. Toda escrita no
// cadastro mestre passa por `registrarAlteracao`.
//
// CPF não entra em claro no log: vai mascarado. A trilha é lida por mais
// gente do que o cadastro de pessoas, e um dado pessoal copiado para o log
// vira um segundo lugar de onde ele pode vazar.

type Cliente = Prisma.TransactionClient | typeof prisma;
export type Operacao = "insert" | "update" | "desativar";
type Registro = Record<string, unknown>;

const CAMPOS_PESSOAIS = new Set(["cpf"]);
const IGNORAR = new Set(["criadoEm", "atualizadoEm", "origens"]);

function serializavel(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return v.toString();
  return v;
}

export function protegerRegistro(r: Registro | null | undefined): Registro | null {
  if (!r) return null;
  const saida: Registro = {};
  for (const [k, v] of Object.entries(r)) {
    if (IGNORAR.has(k)) continue;
    saida[k] = CAMPOS_PESSOAIS.has(k) && typeof v === "string" ? `***${v.slice(3, 9)}**` : serializavel(v);
  }
  return saida;
}

// Só os campos que mudaram (nas duas pontas). Nada mudou: nulo — e nada é
// gravado.
export function diferencas(antes: Registro, depois: Registro): { antes: Registro; depois: Registro } | null {
  const a: Registro = {};
  const d: Registro = {};
  for (const k of Object.keys(depois)) {
    if (IGNORAR.has(k)) continue;
    const va = serializavel(antes[k]);
    const vd = serializavel(depois[k]);
    if (JSON.stringify(va ?? null) !== JSON.stringify(vd ?? null)) {
      a[k] = antes[k];
      d[k] = depois[k];
    }
  }
  return Object.keys(d).length ? { antes: a, depois: d } : null;
}

export async function registrarAlteracao(
  db: Cliente,
  p: { companyId: string; usuario?: string | null; agente?: string | null; tabela: string; registroId: string; operacao: Operacao; antes?: Registro | null; depois?: Registro | null }
) {
  await db.audLog.create({
    data: {
      companyId: p.companyId,
      usuario: p.usuario ?? null,
      agente: p.agente ?? null,
      tabela: p.tabela,
      registroId: p.registroId,
      operacao: p.operacao,
      antes: (protegerRegistro(p.antes) ?? undefined) as Prisma.InputJsonValue | undefined,
      depois: (protegerRegistro(p.depois) ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}
