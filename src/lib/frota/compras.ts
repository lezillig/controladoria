import { prisma } from "@/lib/prisma";
import { lerReaisEmCents } from "@/lib/controladoria/format";
import { lerInteiro, TIPOS_VEICULO, USOS_VEICULO } from "@/lib/cadastro/fichaVeiculo";

// O FLUXO DE COMPRA DE VEÍCULO (a proposta de fluxos, item 1):
//
//   pedido → pendência para a Diretoria (quem pede não aprova) → aprovado →
//   recebimento de cada veículo: entra no cadastro com a NF tirada das contas
//   a pagar da Omie (número, emissão, valor, vendedor), em "reserva", com os
//   documentos exigidos pela categoria marcados como pendentes e um checklist
//   de inclusão (emplacamento, apólice, tag, rastreador) para a Frota →
//   concluído quando chegam todos.

export const FORMAS_PAGAMENTO = [
  { chave: "a_vista", rotulo: "à vista" },
  { chave: "financiamento", rotulo: "financiamento" },
  { chave: "consorcio", rotulo: "consórcio (cota contemplada)" },
] as const;
export const ROTULO_FORMA: Record<string, string> = Object.fromEntries(FORMAS_PAGAMENTO.map((f) => [f.chave, f.rotulo]));

export type SituacaoCompra = "solicitada" | "aprovada" | "rejeitada" | "concluida" | "cancelada";
export const ROTULO_SITUACAO_COMPRA: Record<SituacaoCompra, string> = { solicitada: "aguardando a Diretoria", aprovada: "aprovada — receber", rejeitada: "rejeitada", concluida: "concluída", cancelada: "cancelada" };

// A situação mostrada: a rejeição mora na pendência.
export function situacaoDaCompra(c: { status: string }, pendencia: { status: string } | null): SituacaoCompra {
  if (c.status === "solicitada" && pendencia?.status === "rejeitada") return "rejeitada";
  return (["solicitada", "aprovada", "concluida", "cancelada"].includes(c.status) ? c.status : "solicitada") as SituacaoCompra;
}

type Form = Record<string, string>;
export type PedidoLido = {
  tipo: string;
  marca: string | null;
  modelo: string | null;
  anoMod: number | null;
  capacidade: number | null;
  categoriaUso: string | null;
  quantidade: number;
  valorUnitarioCents: bigint | null;
  formaPagamento: string;
  instituicao: string | null;
  fornecedorNome: string | null;
  fornecedorDocumento: string | null;
  destino: string | null;
  justificativa: string;
};

export function lerPedido(f: Form, comValores: boolean, hoje: Date): { ok: true; dados: PedidoLido } | { ok: false; erro: string } {
  const t = (k: string, max = 120) => (f[k] ?? "").trim().slice(0, max) || null;
  const tipo = f.tipo ?? "";
  if (!(TIPOS_VEICULO as readonly string[]).includes(tipo)) return { ok: false, erro: "Escolha o tipo do veículo." };
  const uso = t("categoriaUso");
  if (uso && !(USOS_VEICULO as readonly string[]).includes(uso)) return { ok: false, erro: "Uso inválido." };
  const quantidade = lerInteiro(f.quantidade, 1, 100) ?? 1;
  if (quantidade === "invalido") return { ok: false, erro: "Quantidade de 1 a 100." };
  const anoMod = lerInteiro(f.anoMod, 2000, hoje.getUTCFullYear() + 2);
  if (anoMod === "invalido") return { ok: false, erro: "Ano-modelo inválido." };
  const capacidade = lerInteiro(f.capacidade, 1, 90);
  if (capacidade === "invalido") return { ok: false, erro: "Lugares de 1 a 90." };
  const forma = f.formaPagamento ?? "";
  if (!FORMAS_PAGAMENTO.some((x) => x.chave === forma)) return { ok: false, erro: "Escolha a forma de pagamento." };
  const instituicao = t("instituicao");
  if (forma !== "a_vista" && !instituicao) return { ok: false, erro: "Diga o banco ou a administradora do financiamento/consórcio." };
  const justificativa = t("justificativa", 600);
  if (!justificativa) return { ok: false, erro: "Diga por que comprar (contrato novo, renovação, substituição…) — é o que a Diretoria vai avaliar." };
  let valor: bigint | null = null;
  if (comValores && (f.valorUnitario ?? "").trim()) {
    const v = lerReaisEmCents(f.valorUnitario);
    if (v === "invalido" || v === null || v <= 0) return { ok: false, erro: "Valor unitário inválido." };
    valor = BigInt(v);
  }
  const doc = (f.fornecedorDocumento ?? "").replace(/\D/g, "");
  return {
    ok: true,
    dados: {
      tipo,
      marca: t("marca", 60),
      modelo: t("modelo", 80),
      anoMod,
      capacidade,
      categoriaUso: uso,
      quantidade,
      valorUnitarioCents: valor,
      formaPagamento: forma,
      instituicao: forma === "a_vista" ? null : instituicao,
      fornecedorNome: t("fornecedorNome"),
      fornecedorDocumento: doc.length === 14 ? doc : null,
      destino: t("destino"),
      justificativa,
    },
  };
}

// AS NOTAS DO FORNECEDOR NA OMIE: contas a pagar do fornecedor do pedido
// (pelo CNPJ, ou por palavra do nome), emitidas desde 60 dias antes do
// pedido, agrupadas pelo número do documento (a NF parcelada vira uma só).
// Nota já usada por outro veículo sai da lista.
const palavras = (s: string | null) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((p) => p.length >= 4 && !["LTDA", "COMERCIO", "VEICULOS", "AUTOMOVEIS", "DISTRIBUIDORA", "BRASIL"].includes(p));

export type NotaDaOmie = { chave: string; numeroDocumento: string; parceiroNome: string | null; dataEmissao: Date | null; valorCents: number; conexaoApelido: string; parcelas: number };

export async function notasDoFornecedor(companyId: string, compra: { criadoEm: Date; fornecedorNome: string | null; fornecedorDocumento: string | null }): Promise<NotaDaOmie[]> {
  const nomes = palavras(compra.fornecedorNome);
  if (!compra.fornecedorDocumento && !nomes.length) return [];
  const desde = new Date(compra.criadoEm.getTime() - 60 * 86_400_000);
  const titulos = await prisma.omieTitulo.findMany({
    where: {
      companyId,
      natureza: "PAGAR",
      cancelado: false,
      numeroDocumento: { not: null },
      AND: [
        { OR: [{ dataEmissao: { gte: desde } }, { dataEmissao: null, dataVencimento: { gte: desde } }] },
        ...(compra.fornecedorDocumento ? [] : [{ OR: nomes.map((n) => ({ parceiroNome: { contains: n, mode: "insensitive" as const } })) }]),
      ],
    },
    select: { id: true, conexaoApelido: true, numeroDocumento: true, parceiroNome: true, parceiroDocumento: true, dataEmissao: true, valorDocumentoCents: true },
    orderBy: { dataEmissao: "desc" },
    take: 400,
  });
  const doFornecedor = compra.fornecedorDocumento ? titulos.filter((t) => (t.parceiroDocumento ?? "").replace(/\D/g, "") === compra.fornecedorDocumento) : titulos;
  const usadas = new Set((await prisma.cadVeiculo.findMany({ where: { companyId, notaFiscalCompra: { not: null } }, select: { notaFiscalCompra: true } })).map((v) => v.notaFiscalCompra));
  const porNota = new Map<string, NotaDaOmie>();
  for (const t of doFornecedor) {
    const numero = (t.numeroDocumento ?? "").trim();
    if (!numero || usadas.has(numero)) continue;
    const chave = `${t.conexaoApelido}|${numero}`;
    const n = porNota.get(chave) ?? { chave, numeroDocumento: numero, parceiroNome: t.parceiroNome, dataEmissao: t.dataEmissao, valorCents: 0, conexaoApelido: t.conexaoApelido, parcelas: 0 };
    n.valorCents += t.valorDocumentoCents;
    n.parcelas++;
    porNota.set(chave, n);
  }
  return [...porNota.values()].slice(0, 50);
}
