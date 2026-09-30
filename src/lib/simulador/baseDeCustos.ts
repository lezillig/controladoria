import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { LeituraGabarito, RegistroLido } from "./gabarito";

// A BASE DE CUSTOS VERSIONADA — gravar e ler.
//
// NUNCA SOBRESCREVER. Um valor que muda fecha a vigência do registro anterior
// e abre outro; um valor igual não gera registro novo (reimportar o mesmo
// Gabarito não enche a base de cópias). O que não veio na importação continua
// vigente: o Gabarito é preenchido aos poucos, e uma aba vazia não pode apagar
// o que a anterior tinha.

export type BaseValor = { valor: number | null; texto: string | null; fonte: string; vigenciaInicio: Date };

// Um registro tabular da base com os campos do modelo (números já sem Decimal).
export type RegistroBase = { id: string; chave: string; fonte: string; vigenciaInicio: Date } & Record<string, unknown>;

export type BaseVigente = {
  em: Date;
  parametros: Map<string, BaseValor>;
  veiculos: RegistroBase[];
  funcoes: RegistroBase[];
  pedagios: RegistroBase[];
};

export type ResumoGravacao = Record<"parametros" | "veiculos" | "funcoes" | "pedagios" | "referencias", { novos: number; alterados: number; inalterados: number }>;

const zerado = () => ({ novos: 0, alterados: 0, inalterados: 0 });

// Comparação de valores entre o que está gravado (Decimal, Int, texto) e o
// que veio (número, texto). Decimal é comparado pelo número — 0.7 e 0.700000
// são o mesmo valor.
function mesmoValor(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => {
    if (v === null || v === undefined || v === "") return null;
    if (v instanceof Prisma.Decimal) return v.toNumber();
    if (typeof v === "object" && v !== null && "toNumber" in v) return (v as { toNumber: () => number }).toNumber();
    return v;
  };
  const x = norm(a);
  const y = norm(b);
  if (typeof x === "number" && typeof y === "number") return Math.abs(x - y) < 1e-9;
  return x === y;
}

export function paraNumero(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  if (typeof v === "object" && "toNumber" in (v as object)) return (v as { toNumber: () => number }).toNumber();
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

type Delegado = {
  findMany: (args: unknown) => Promise<Record<string, unknown>[]>;
  updateMany: (args: unknown) => Promise<unknown>;
  createMany: (args: unknown) => Promise<unknown>;
};

async function gravarTabular(
  tx: Prisma.TransactionClient,
  modelo: "simVeiculoModelo" | "simFuncao" | "simPedagioPraca",
  companyId: string,
  registros: RegistroLido[],
  meta: { fonte: string; autor: string | null; em: Date }
) {
  const resumo = zerado();
  if (registros.length === 0) return resumo;
  const delegado = tx[modelo] as unknown as Delegado;
  const atuais = await delegado.findMany({ where: { companyId, vigenciaFim: null, chave: { in: registros.map((r) => r.chave) } } });
  const porChave = new Map(atuais.map((a) => [a.chave as string, a]));
  const fechar: string[] = [];
  const criar: Record<string, unknown>[] = [];
  for (const r of registros) {
    const atual = porChave.get(r.chave);
    if (atual && Object.entries(r.campos).every(([campo, v]) => mesmoValor(atual[campo], v))) {
      resumo.inalterados++;
      continue;
    }
    if (atual) {
      fechar.push(atual.id as string);
      resumo.alterados++;
    } else resumo.novos++;
    criar.push({ companyId, chave: r.chave, ...r.campos, vigenciaInicio: meta.em, fonte: meta.fonte, atualizadoPorNome: meta.autor });
  }
  if (fechar.length > 0) await delegado.updateMany({ where: { id: { in: fechar } }, data: { vigenciaFim: meta.em } });
  if (criar.length > 0) await delegado.createMany({ data: criar });
  return resumo;
}

export async function gravarLeitura(
  companyId: string,
  leitura: LeituraGabarito,
  meta: { fonte: string; autor: string | null; em?: Date }
): Promise<ResumoGravacao> {
  const em = meta.em ?? new Date();
  const m = { fonte: meta.fonte, autor: meta.autor, em };
  return prisma.$transaction(
    async (tx) => {
      // Parâmetros
      const parametros = zerado();
      const atuais = await tx.simParametro.findMany({ where: { companyId, vigenciaFim: null } });
      const porChave = new Map(atuais.map((a) => [a.chave, a]));
      const fechar: string[] = [];
      const criar: Prisma.SimParametroCreateManyInput[] = [];
      for (const p of leitura.parametros) {
        const atual = porChave.get(p.chave);
        if (atual && mesmoValor(atual.valor, p.valor) && mesmoValor(atual.texto, p.texto)) {
          parametros.inalterados++;
          continue;
        }
        if (atual) {
          fechar.push(atual.id);
          parametros.alterados++;
        } else parametros.novos++;
        criar.push({
          companyId,
          entidade: p.entidade,
          chave: p.chave,
          rotulo: p.rotulo,
          unidade: p.unidade,
          valor: p.valor === null ? null : new Prisma.Decimal(p.valor),
          texto: p.texto,
          vigenciaInicio: em,
          fonte: meta.fonte,
          atualizadoPorNome: meta.autor,
        });
      }
      if (fechar.length > 0) await tx.simParametro.updateMany({ where: { id: { in: fechar } }, data: { vigenciaFim: em } });
      if (criar.length > 0) await tx.simParametro.createMany({ data: criar });

      const veiculos = await gravarTabular(tx, "simVeiculoModelo", companyId, leitura.veiculos, m);
      const funcoes = await gravarTabular(tx, "simFuncao", companyId, leitura.funcoes, m);
      const pedagios = await gravarTabular(tx, "simPedagioPraca", companyId, leitura.pedagios, m);

      // Referências (abas 9 e 10): mesma regra, comparando o JSON inteiro.
      const referencias = zerado();
      if (leitura.referencias.length > 0) {
        const atuaisRef = await tx.simReferencia.findMany({ where: { companyId, vigenciaFim: null } });
        const refPorChave = new Map(atuaisRef.map((a) => [`${a.aba}|${a.chave}`, a]));
        const fecharRef: string[] = [];
        const criarRef: Prisma.SimReferenciaCreateManyInput[] = [];
        for (const r of leitura.referencias) {
          const atual = refPorChave.get(`${r.aba}|${r.chave}`);
          if (atual && JSON.stringify(atual.dados) === JSON.stringify(r.dados)) {
            referencias.inalterados++;
            continue;
          }
          if (atual) {
            fecharRef.push(atual.id);
            referencias.alterados++;
          } else referencias.novos++;
          criarRef.push({ companyId, aba: r.aba, chave: r.chave, dados: r.dados, vigenciaInicio: em, fonte: meta.fonte });
        }
        if (fecharRef.length > 0) await tx.simReferencia.updateMany({ where: { id: { in: fecharRef } }, data: { vigenciaFim: em } });
        if (criarRef.length > 0) await tx.simReferencia.createMany({ data: criarRef });
      }

      return { parametros, veiculos, funcoes, pedagios, referencias };
    },
    { timeout: 60_000 }
  );
}

// A BASE VIGENTE NUMA DATA: o registro cuja vigência cobre a data.
export async function baseVigente(companyId: string, em: Date = new Date()): Promise<BaseVigente> {
  const naData = { companyId, vigenciaInicio: { lte: em }, OR: [{ vigenciaFim: null }, { vigenciaFim: { gt: em } }] };
  const [parametros, veiculos, funcoes, pedagios] = await Promise.all([
    prisma.simParametro.findMany({ where: naData }),
    prisma.simVeiculoModelo.findMany({ where: naData, orderBy: [{ tipo: "asc" }, { modelo: "asc" }] }),
    prisma.simFuncao.findMany({ where: naData, orderBy: [{ funcao: "asc" }] }),
    prisma.simPedagioPraca.findMany({ where: naData, orderBy: [{ praca: "asc" }] }),
  ]);
  const simples = <T extends Record<string, unknown>>(r: T) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v : typeof v === "object" && v !== null && "toNumber" in v ? paraNumero(v) : v])) as RegistroBase;
  return {
    em,
    parametros: new Map(parametros.map((p) => [p.chave, { valor: paraNumero(p.valor), texto: p.texto, fonte: p.fonte, vigenciaInicio: p.vigenciaInicio }])),
    veiculos: veiculos.map(simples),
    funcoes: funcoes.map(simples),
    pedagios: pedagios.map(simples),
  };
}
