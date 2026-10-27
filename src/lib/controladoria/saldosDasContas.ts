import { prisma } from "@/lib/prisma";

// O SALDO DE CADA CONTA E O TOTAL DISPONÍVEL.
//
// Três leituras lado a lado, porque cada uma erra de um jeito:
//   - o saldo da OMIE (cabeçalho do extrato): o que o financeiro vê lá;
//   - o saldo pelo EXTRATO espelhado (saldo inicial + lançamentos): o que este
//     sistema soma — diferença contra a Omie é lançamento que não chegou;
//   - o saldo INFORMADO do banco, digitado na tela: a verdade do banco numa
//     data, e o único jeito de contar aplicação que a Omie não tem (ou tem
//     sem os rendimentos).
//
// O saldo considerado é o informado quando há (é o do banco), senão o da
// Omie, senão o do extrato. Aplicação e cartão ficam fora do "disponível".

export type GrupoDaConta = "disponivel" | "aplicacao" | "cartao";

export function grupoDaConta(c: { descricao: string; tipoDescricao?: string | null; tipoCodigo?: string | null }): GrupoDaConta {
  const texto = `${c.descricao} ${c.tipoDescricao ?? ""}`;
  if (/aplica|invest|cdb|poupan|fundo|\blci\b|\blca\b|renda fixa|compromissada|tesouro/i.test(texto)) return "aplicacao";
  if (/cart[aã]o/i.test(texto)) return "cartao";
  return "disponivel";
}

export const ROTULO_GRUPO: Record<GrupoDaConta, string> = { disponivel: "Disponível", aplicacao: "Aplicação", cartao: "Cartão" };

export type SaldoDaConta = {
  chave: string;
  conexaoId: string;
  empresa: string;
  contaCodigo: string | null;
  descricao: string;
  banco: string | null;
  tipo: string | null;
  grupo: GrupoDaConta;
  inativa: boolean;
  foraDaOmie: boolean;
  omieCents: number | null;
  omieConciliadoCents: number | null;
  omieDisponivelCents: number | null;
  omieEm: Date | null;
  extratoCents: number | null;
  informado: { id: string; valorCents: number; data: Date; autor: string | null } | null;
  consideradoCents: number;
  fonte: "banco" | "omie" | "extrato";
};

export function montarSaldos(params: {
  contas: {
    conexaoId: string;
    conexaoApelido: string;
    codigo: string;
    descricao: string;
    banco: string | null;
    inativa: boolean;
    tipoCodigo: string | null;
    tipoDescricao: string | null;
    saldoInicialCents: number;
    saldoOmieCents: number | null;
    saldoConciliadoOmieCents: number | null;
    saldoDisponivelOmieCents: number | null;
    saldoOmieEm: Date | null;
  }[];
  movimentado: Map<string, number>;
  informados: { id: string; conexaoId: string; contaCodigo: string | null; descricao: string; aplicacao: boolean; data: Date; valorCents: number; autorNome: string | null; empresa: string }[];
}): SaldoDaConta[] {
  // O informado mais recente por conta (ou por descrição, fora da Omie).
  const ultimo = new Map<string, (typeof params.informados)[number]>();
  for (const i of params.informados) {
    const k = i.contaCodigo ? `${i.conexaoId}:${i.contaCodigo}` : `${i.conexaoId}:fora:${i.descricao.trim().toUpperCase()}`;
    const atual = ultimo.get(k);
    if (!atual || i.data > atual.data) ultimo.set(k, i);
  }
  const linhas: SaldoDaConta[] = params.contas.map((c) => {
    const chave = `${c.conexaoId}:${c.codigo}`;
    const inf = ultimo.get(chave);
    ultimo.delete(chave);
    const extrato = c.saldoInicialCents + (params.movimentado.get(chave) ?? 0);
    const informado = inf ? { id: inf.id, valorCents: inf.valorCents, data: inf.data, autor: inf.autorNome } : null;
    const fonte = informado ? "banco" : c.saldoOmieCents !== null ? "omie" : "extrato";
    return {
      chave,
      conexaoId: c.conexaoId,
      empresa: c.conexaoApelido,
      contaCodigo: c.codigo,
      descricao: c.descricao,
      banco: c.banco,
      tipo: c.tipoDescricao,
      grupo: inf?.aplicacao ? "aplicacao" : grupoDaConta(c),
      inativa: c.inativa,
      foraDaOmie: false,
      omieCents: c.saldoOmieCents,
      omieConciliadoCents: c.saldoConciliadoOmieCents,
      omieDisponivelCents: c.saldoDisponivelOmieCents,
      omieEm: c.saldoOmieEm,
      extratoCents: extrato,
      informado,
      consideradoCents: informado ? informado.valorCents : (c.saldoOmieCents ?? extrato),
      fonte,
    };
  });
  // Contas que só existem no banco (informadas, fora da Omie).
  for (const [chave, i] of ultimo) {
    if (i.contaCodigo) continue;
    linhas.push({
      chave,
      conexaoId: i.conexaoId,
      empresa: i.empresa,
      contaCodigo: null,
      descricao: i.descricao,
      banco: null,
      tipo: null,
      grupo: i.aplicacao ? "aplicacao" : grupoDaConta({ descricao: i.descricao }),
      inativa: false,
      foraDaOmie: true,
      omieCents: null,
      omieConciliadoCents: null,
      omieDisponivelCents: null,
      omieEm: null,
      extratoCents: null,
      informado: { id: i.id, valorCents: i.valorCents, data: i.data, autor: i.autorNome },
      consideradoCents: i.valorCents,
      fonte: "banco",
    });
  }
  // Conta inativa só aparece se ainda tem saldo.
  return linhas.filter((l) => !l.inativa || l.consideradoCents !== 0);
}

export function totais(linhas: SaldoDaConta[]) {
  const soma = (g: GrupoDaConta) => linhas.filter((l) => l.grupo === g).reduce((s, l) => s + l.consideradoCents, 0);
  const disponivel = soma("disponivel");
  const aplicacao = soma("aplicacao");
  const cartao = soma("cartao");
  return { disponivel, aplicacao, cartao, total: disponivel + aplicacao + cartao };
}

export async function saldosDasContas(params: { companyId: string; conexaoId: string | null; ate: Date }) {
  const filtro = { companyId: params.companyId, ...(params.conexaoId ? { conexaoId: params.conexaoId } : {}) };
  const [contas, mov, informados, conexoes] = await Promise.all([
    prisma.omieContaCorrente.findMany({
      where: filtro,
      orderBy: [{ conexaoApelido: "asc" }, { descricao: "asc" }],
      select: {
        conexaoId: true, conexaoApelido: true, codigo: true, descricao: true, banco: true, inativa: true, tipoCodigo: true, tipoDescricao: true,
        saldoInicialCents: true, saldoOmieCents: true, saldoConciliadoOmieCents: true, saldoDisponivelOmieCents: true, saldoOmieEm: true,
      },
    }),
    prisma.omieMovimento.groupBy({ by: ["conexaoId", "contaCorrenteCodigo"], where: { ...filtro, data: { lte: params.ate } }, _sum: { valorCents: true } }),
    prisma.saldoBancarioInformado.findMany({ where: filtro, orderBy: { data: "desc" } }),
    prisma.omieConexao.findMany({ where: { companyId: params.companyId }, select: { id: true, apelido: true } }),
  ]);
  const apelido = new Map(conexoes.map((c) => [c.id, c.apelido]));
  return montarSaldos({
    contas,
    movimentado: new Map(mov.map((m) => [`${m.conexaoId}:${m.contaCorrenteCodigo}`, m._sum.valorCents ?? 0])),
    informados: informados.map((i) => ({ ...i, valorCents: Number(i.valorCents), empresa: apelido.get(i.conexaoId) ?? "?" })),
  });
}
