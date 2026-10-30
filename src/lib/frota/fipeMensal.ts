import { prisma } from "@/lib/prisma";
import { chaveDaReferencia, consultarPorCodigo, ehTipoFipe, FipeErro, ultimaReferencia } from "./fipe";

// A RELEITURA MENSAL DA FIPE (passo do agente da frota): quando a FIPE publica
// a tabela do mês, relê o valor de cada modelo escolhido — uma consulta por
// código + ano, não por veículo (26 Master 2024 iguais = 1 consulta). Com
// limite por dia, para não estourar a cota da API; o que faltar fica para o
// dia seguinte. Cada valor novo entra na trilha do veículo (o histórico da
// FIPE fica ali).

const LIMITE_DE_CONSULTAS = 150;

export type ResultadoFipeMensal = { referencia: string | null; consultas: number; veiculos: number; faltam: number; erro?: string };

export async function atualizarFipeDoMes(companyId: string, agente: string): Promise<ResultadoFipeMensal> {
  const escolhidos = await prisma.cadVeiculo.findMany({
    where: { companyId, fipeCodigo: { not: null }, fipeAnoModelo: { not: null }, status: { notIn: ["vendido", "baixado"] } },
    select: { id: true, anoMod: true, fipeTipo: true, fipeCodigo: true, fipeAnoModelo: true, fipeValorCents: true, fipeReferencia: true },
  });
  if (!escolhidos.length) return { referencia: null, consultas: 0, veiculos: 0, faltam: 0 };
  let referencia: string;
  try {
    referencia = await ultimaReferencia();
  } catch (e) {
    return { referencia: null, consultas: 0, veiculos: 0, faltam: 0, erro: e instanceof Error ? e.message : "falha" };
  }
  const alvo = chaveDaReferencia(referencia);
  const grupos = new Map<string, typeof escolhidos>();
  for (const v of escolhidos) {
    if (chaveDaReferencia(v.fipeReferencia) === alvo) continue;
    const tipo = ehTipoFipe(v.fipeTipo) ? v.fipeTipo : "cars";
    const chave = `${tipo}|${v.fipeCodigo}|${v.fipeAnoModelo}`;
    grupos.set(chave, [...(grupos.get(chave) ?? []), v]);
  }
  let consultas = 0;
  let veiculos = 0;
  let erro: string | undefined;
  const fila = [...grupos.entries()];
  for (const [chave, lista] of fila.slice(0, LIMITE_DE_CONSULTAS)) {
    const [tipo, codigo, ano] = chave.split("|");
    try {
      let anoLido = ano;
      const preco = await consultarPorCodigo(tipo as "cars" | "trucks", codigo, ano).catch(async (e) => {
        // O "Zero KM" (32000) some quando sai a tabela do ano-modelo: passa a
        // ler pelo ano do cadastro.
        const anoMod = lista[0].anoMod;
        if (!ano.startsWith("32000-") || !anoMod) throw e;
        anoLido = `${anoMod}-${ano.split("-")[1]}`;
        return consultarPorCodigo(tipo as "cars" | "trucks", codigo, anoLido);
      });
      consultas++;
      const agora = new Date();
      await prisma.cadVeiculo.updateMany({ where: { id: { in: lista.map((v) => v.id) } }, data: { fipeValorCents: BigInt(preco.valorCents), fipeReferencia: preco.referencia, fipeConsultadoEm: agora, fipeAnoModelo: anoLido } });
      await prisma.audLog.createMany({
        data: lista.map((v) => ({
          companyId,
          agente,
          tabela: "CadVeiculo",
          registroId: v.id,
          operacao: "update",
          antes: { fipeValorCents: v.fipeValorCents?.toString() ?? null, fipeReferencia: v.fipeReferencia },
          depois: { fipeValorCents: String(preco.valorCents), fipeReferencia: preco.referencia },
        })),
      });
      veiculos += lista.length;
    } catch (e) {
      erro = e instanceof Error ? e.message : "falha";
      // Cota estourada ou FIPE fora do ar: para por hoje; amanhã continua.
      if (e instanceof FipeErro && /limite|não respondeu/i.test(e.message)) break;
    }
  }
  return { referencia, consultas, veiculos, faltam: Math.max(0, fila.length - consultas), ...(erro ? { erro } : {}) };
}
