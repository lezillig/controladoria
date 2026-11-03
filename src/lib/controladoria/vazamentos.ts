import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tabela } from "@/lib/esquemaDoBanco";
import { filtroConexaoBaixa } from "./escopoSql";
import type { Periodo } from "./periodos";

// ONDE O DINHEIRO ESCAPA — as perdas do mês pela ORIGEM, em ordem de valor.
//
// O cartão "Perdas do mês" diz quanto saiu sem comprar nada (juros e multa
// por atraso, tarifa bancária, desconto concedido) e de que tipo. Não dizia
// DE ONDE: qual fornecedor nos cobra juros todo mês, qual conta cobra mais
// tarifa, qual cliente leva desconto. É isso que decide o que atacar primeiro
// — e nenhuma dessas perdas trava a operação quando cortada: juros se cortam
// pagando no prazo, tarifa renegociando, desconto cumprindo a política.
//
// A SOMA É A DO CARTÃO. Mesmo filtro do resumo no banco (resumoNoBanco.ts):
// baixas do período, juros e multa só de título a pagar, desconto só de título
// a receber, tarifa de todas as baixas, e na visão do grupo sem as operações
// entre as empresas. A soma de todas as origens é o "Perdas do mês"; a tela
// mostra as maiores e quanto elas são do total, para um desencontro aparecer.
//
// A RECORRÊNCIA vem dos meses fechados anteriores (seis): a perda que se
// repete todo mês é processo, não acidente — e é a primeira a atacar.

export type TipoDeVazamento = "atraso" | "tarifa" | "desconto";

export type Vazamento = {
  tipo: TipoDeVazamento;
  rotulo: string;
  valorCents: number;
  // Média por mês nos meses anteriores olhados (zero onde não houve).
  mediaMensalCents: number;
  mesesComPerda: number;
  mesesOlhados: number;
  acao: string;
  // O filtro da lista que soma este número (tela de detalhamento).
  filtro: { parte: "juros_multa" | "tarifa" | "desconto"; parceiro?: string; conta?: string };
};

export type Vazamentos = {
  totalCents: number;
  origens: number;
  maiores: Vazamento[];
  somaDosMaioresCents: number;
};

// Uma linha por mês × natureza × origem, como sai do banco.
export type LinhaDeVazamento = {
  atual: boolean;
  mes: string; // AAAA-MM
  natureza: string | null;
  parceiro: string;
  conexaoId: string;
  conta: string;
  atrasoCents: number;
  tarifaCents: number;
  descontoCents: number;
};

const MESES_DE_HISTORICO = 6;
// "Recorrente": em metade ou mais dos meses olhados.
const recorrente = (v: Pick<Vazamento, "mesesComPerda" | "mesesOlhados">) => v.mesesOlhados > 0 && v.mesesComPerda * 2 >= v.mesesOlhados;

function acaoDe(tipo: TipoDeVazamento, v: Pick<Vazamento, "mesesComPerda" | "mesesOlhados">): string {
  const repete = recorrente(v);
  if (tipo === "atraso")
    return repete
      ? "O atraso se repete: mudar o vencimento com o fornecedor para depois do recebimento, ou programar o pagamento na data."
      : "Pagar no vencimento; se faltou caixa, renegociar o prazo antes de vencer — depois de vencido, o juro já correu.";
  if (tipo === "tarifa")
    return repete
      ? "Tarifa de todo mês: levar a soma ao gerente e renegociar o pacote, ou concentrar a cobrança na conta mais barata."
      : "Conferir no extrato que tarifa foi essa e se estava no contrato da conta.";
  return repete
    ? "Desconto de todo mês ao mesmo cliente: se não está no contrato, é margem entregue — confirmar quem autoriza."
    : "Confirmar quem autorizou o desconto e se ele está no contrato.";
}

// Puro: das linhas do banco às origens em ordem de valor.
export function montarVazamentos(
  linhas: LinhaDeVazamento[],
  opcoes: { quantos?: number; mesesOlhados: number; nomeDaConta: (conexaoId: string, codigo: string) => string | null }
): Vazamentos {
  type Acumulado = { tipo: TipoDeVazamento; rotulo: string; filtro: Vazamento["filtro"]; atual: number; porMes: Map<string, number> };
  const origens = new Map<string, Acumulado>();
  const somar = (chave: string, base: Omit<Acumulado, "atual" | "porMes">, l: LinhaDeVazamento, valor: number) => {
    if (valor === 0) return;
    const o = origens.get(chave) ?? { ...base, atual: 0, porMes: new Map() };
    if (l.atual) o.atual += valor;
    else o.porMes.set(l.mes, (o.porMes.get(l.mes) ?? 0) + valor);
    origens.set(chave, o);
  };
  for (const l of linhas) {
    if (l.natureza === "PAGAR")
      somar(`atraso|${l.parceiro}`, { tipo: "atraso", rotulo: `Juros e multa · ${l.parceiro || "(fornecedor não identificado)"}`, filtro: { parte: "juros_multa", parceiro: l.parceiro } }, l, l.atrasoCents);
    if (l.natureza === "RECEBER")
      somar(`desconto|${l.parceiro}`, { tipo: "desconto", rotulo: `Desconto concedido · ${l.parceiro || "(cliente não identificado)"}`, filtro: { parte: "desconto", parceiro: l.parceiro } }, l, l.descontoCents);
    // Tarifa de qualquer baixa, como no cartão — inclusive de título que não
    // está no espelho.
    const conta = `${l.conexaoId}:${l.conta}`;
    somar(`tarifa|${conta}`, { tipo: "tarifa", rotulo: `Tarifa bancária · ${opcoes.nomeDaConta(l.conexaoId, l.conta) ?? "conta não identificada"}`, filtro: { parte: "tarifa", conta } }, l, l.tarifaCents);
  }
  const todas = [...origens.values()].filter((o) => o.atual > 0);
  const totalCents = todas.reduce((s, o) => s + o.atual, 0);
  const maiores = todas
    .sort((a, b) => b.atual - a.atual || a.rotulo.localeCompare(b.rotulo))
    .slice(0, opcoes.quantos ?? 5)
    .map((o) => {
      const meses = [...o.porMes.values()];
      const base = { mesesComPerda: meses.filter((v) => v > 0).length, mesesOlhados: opcoes.mesesOlhados };
      return {
        tipo: o.tipo,
        rotulo: o.rotulo,
        valorCents: o.atual,
        mediaMensalCents: opcoes.mesesOlhados > 0 ? Math.round(meses.reduce((s, v) => s + v, 0) / opcoes.mesesOlhados) : 0,
        ...base,
        acao: acaoDe(o.tipo, base),
        filtro: o.filtro,
      };
    });
  return { totalCents, origens: todas.length, maiores, somaDosMaioresCents: maiores.reduce((s, v) => s + v.valorCents, 0) };
}

export function ehRecorrente(v: Vazamento): boolean {
  return recorrente(v);
}

type LinhaBruta = { atual: boolean; mes: string; natureza: string | null; parceiro: string; conexao: string; conta: string; atraso: bigint; tarifa: bigint; desconto: bigint };

export async function vazamentosNoBanco(params: { companyId: string; conexaoId?: string | null; periodo: Periodo; quantos?: number }): Promise<Vazamentos> {
  const { companyId, conexaoId, periodo } = params;
  // Os seis meses FECHADOS antes do mês do período.
  const inicioDoMesAtual = new Date(periodo.inicio.getFullYear(), periodo.inicio.getMonth(), 1);
  const desde = new Date(inicioDoMesAtual.getFullYear(), inicioDoMesAtual.getMonth() - MESES_DE_HISTORICO, 1);
  const [linhas, contas] = await Promise.all([
    prisma.$queryRaw<LinhaBruta[]>`
      SELECT (b."dataBaixa" >= ${periodo.inicio}) AS atual,
             to_char(b."dataBaixa", 'YYYY-MM') AS mes,
             t.natureza::text AS natureza,
             COALESCE(t."parceiroNome", '') AS parceiro,
             b."conexaoId" AS conexao,
             COALESCE(b."contaCorrenteCodigo", '') AS conta,
             COALESCE(SUM(b."jurosCents" + b."multaCents"), 0)::bigint AS atraso,
             COALESCE(SUM(b."tarifaCents"), 0)::bigint AS tarifa,
             COALESCE(SUM(b."descontoCents"), 0)::bigint AS desconto
        FROM ${tabela("OmieBaixa")} b
        LEFT JOIN ${tabela("OmieTitulo")} t ON t.id = b."tituloId"
       WHERE b."companyId" = ${companyId}
         AND b."dataBaixa" >= ${desde}
         AND b."dataBaixa" <= ${periodo.fim}
         AND (b."dataBaixa" >= ${periodo.inicio} OR b."dataBaixa" < ${inicioDoMesAtual})
         AND (b."jurosCents" <> 0 OR b."multaCents" <> 0 OR b."tarifaCents" <> 0 OR b."descontoCents" <> 0)
         ${filtroConexaoBaixa(conexaoId, companyId)}
       GROUP BY 1, 2, 3, 4, 5, 6
    `,
    prisma.omieContaCorrente.findMany({ where: { companyId, ...(conexaoId ? { conexaoId } : {}) }, select: { conexaoId: true, conexaoApelido: true, codigo: true, descricao: true } }),
  ]);
  const nomes = new Map(contas.map((c) => [`${c.conexaoId}:${c.codigo}`, `${c.conexaoApelido} · ${c.descricao}`]));
  return montarVazamentos(
    linhas.map((l) => ({
      atual: l.atual,
      mes: l.mes,
      natureza: l.natureza,
      parceiro: l.parceiro,
      conexaoId: l.conexao,
      conta: l.conta,
      atrasoCents: Number(l.atraso),
      tarifaCents: Number(l.tarifa),
      descontoCents: Number(l.desconto),
    })),
    { quantos: params.quantos, mesesOlhados: MESES_DE_HISTORICO, nomeDaConta: (c, codigo) => nomes.get(`${c}:${codigo}`) ?? null }
  );
}

// Filtro de parceiro na lista (detalhamento.ts): vazio quer dizer "sem nome".
export function filtroDeParceiroSql(parceiro: string | null | undefined) {
  if (parceiro === undefined || parceiro === null) return Prisma.empty;
  return parceiro === "" ? Prisma.sql`AND (t."parceiroNome" IS NULL OR t."parceiroNome" = '')` : Prisma.sql`AND t."parceiroNome" = ${parceiro}`;
}
