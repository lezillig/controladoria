import { prisma } from "@/lib/prisma";
import { alertaDoDocumento, type Alerta } from "./documentos";
import { coberturaDeApolice, piorAlerta, type CoberturaApolice } from "./controles";
import { saldoPorVeiculo, situacaoDoFinanciamento, lerNumeroParcela, type PagamentoOmie, type SituacaoFinanciamento, type SaldoDoVeiculo } from "./financiamentos";

// A FROTA LIDA DO BANCO, com o que se calcula sobre ela: o alerta dos
// documentos, a cobertura da apólice, a situação de cada contrato (com as
// parcelas da Omie) e o saldo devedor por veículo. As telas e o agente diário
// leem por aqui.

const PAGO = /PAGO|LIQUID|QUITAD|RECEBID/i;

// Os títulos da Omie ligados a cada contrato, como pagamentos.
export async function pagamentosOmiePorContrato(companyId: string, ids?: string[]): Promise<Map<string, PagamentoOmie[]>> {
  const links = await prisma.frotaParcelaOmie.findMany({ where: { companyId, ...(ids ? { financiamentoId: { in: ids } } : {}) }, select: { financiamentoId: true, tituloId: true, numeroParcela: true } });
  const porContrato = new Map<string, PagamentoOmie[]>();
  if (links.length === 0) return porContrato;
  const titulos = await prisma.omieTitulo.findMany({
    where: { id: { in: links.map((l) => l.tituloId) }, cancelado: false },
    select: { id: true, numeroParcela: true, dataVencimento: true, valorDocumentoCents: true, valorPagoCents: true, status: true, baixas: { select: { dataBaixa: true } } },
  });
  const porId = new Map(titulos.map((t) => [t.id, t]));
  for (const l of links) {
    const t = porId.get(l.tituloId);
    if (!t) continue;
    const pago = PAGO.test(t.status ?? "") || (t.valorPagoCents > 0 && t.valorPagoCents >= t.valorDocumentoCents - 100);
    const lista = porContrato.get(l.financiamentoId) ?? [];
    lista.push({
      numeroParcela: l.numeroParcela ?? lerNumeroParcela(t.numeroParcela)?.n ?? null,
      dataVencimento: t.dataVencimento,
      valorCents: t.valorDocumentoCents,
      pago,
      dataPagamento: pago ? t.baixas.reduce<Date | null>((m, b) => (!m || b.dataBaixa > m ? b.dataBaixa : m), null) : null,
    });
    porContrato.set(l.financiamentoId, lista);
  }
  return porContrato;
}

export type ContratoComSituacao = Awaited<ReturnType<typeof contratosComSituacao>>[number];

export async function contratosComSituacao(companyId: string, hoje: Date, filtro: { veiculoId?: string; ids?: string[] } = {}) {
  const contratos = await prisma.frotaFinanciamento.findMany({
    where: {
      companyId,
      ...(filtro.ids ? { id: { in: filtro.ids } } : {}),
      ...(filtro.veiculoId ? { veiculos: { some: { veiculoId: filtro.veiculoId } } } : {}),
    },
    include: { veiculos: { include: { veiculo: { select: { id: true, placa: true, chassi: true, modelo: true, status: true } } } } },
    orderBy: [{ ativo: "desc" }, { instituicao: "asc" }, { contratoNumero: "asc" }, { grupo: "asc" }, { cota: "asc" }],
  });
  const omie = await pagamentosOmiePorContrato(companyId, filtro.ids ?? (filtro.veiculoId ? contratos.map((c) => c.id) : undefined));
  return contratos.map((c) => ({ ...c, pagamentosOmie: omie.get(c.id) ?? [], situacao: situacaoDoFinanciamento(c, hoje, omie.get(c.id) ?? []) as SituacaoFinanciamento }));
}

export type LinhaDaFrota = {
  id: string;
  placa: string | null;
  chassi: string | null;
  prefixo: string | null;
  tipo: string;
  marca: string | null;
  modelo: string | null;
  anoFab: number | null;
  anoMod: number | null;
  capacidade: number | null;
  categoriaUso: string | null;
  alocacao: string | null;
  status: string;
  empresa: string | null;
  ipvaSituacao: string | null;
  pior: Alerta | null;
  vencidos: number;
  aVencer30: number;
  cobertura: CoberturaApolice;
  apolice: string | null;
  alienado: boolean;
  saldo: SaldoDoVeiculo | null;
  mercadoCents: number | null;
};

export async function listarFrota(companyId: string, hoje: Date): Promise<{ linhas: LinhaDaFrota[]; contratos: ContratoComSituacao[] }> {
  const [veiculos, contratos] = await Promise.all([
    prisma.cadVeiculo.findMany({
      where: { companyId },
      include: { documentos: { select: { tipo: true, situacao: true, validade: true } }, apolice: { select: { descricao: true, ativo: true, segmento: true, vigenciaFim: true } } },
      orderBy: [{ placa: "asc" }],
    }),
    contratosComSituacao(companyId, hoje),
  ]);
  const saldos = saldoPorVeiculo(contratos.map((c) => ({ instituicao: c.instituicao, valorParcelaCents: c.valorParcelaCents, situacao: c.situacao, veiculos: c.veiculos })));
  const alienados = new Set(contratos.filter((c) => !c.situacao.quitado).flatMap((c) => c.veiculos.filter((v) => v.alienado).map((v) => v.veiculoId)));
  const linhas = veiculos.map((v) => {
    const alertas = v.documentos.map((d) => alertaDoDocumento(d, hoje));
    return {
      id: v.id,
      placa: v.placa,
      chassi: v.chassi,
      prefixo: v.prefixo,
      tipo: v.tipo,
      marca: v.marca,
      modelo: v.modelo,
      anoFab: v.anoFab,
      anoMod: v.anoMod,
      capacidade: v.capacidade,
      categoriaUso: v.categoriaUso,
      alocacao: v.alocacao,
      status: v.status,
      empresa: v.empresa,
      ipvaSituacao: v.ipvaSituacao,
      pior: piorAlerta(alertas.filter((a) => a !== "nao_se_aplica")),
      vencidos: alertas.filter((a) => a === "vencido").length,
      aVencer30: alertas.filter((a) => a === "7" || a === "30").length,
      cobertura: coberturaDeApolice(v, v.apolice, hoje),
      apolice: v.apolice?.descricao ?? null,
      alienado: alienados.has(v.id),
      saldo: saldos.get(v.id) ?? null,
      mercadoCents: v.valorAjustadoCents !== null ? Number(v.valorAjustadoCents) : v.fipeValorCents !== null ? Number(v.fipeValorCents) : null,
    };
  });
  return { linhas, contratos };
}

// VEÍCULOS IGUAIS para a FIPE: mesmo tipo, marca, modelo e ano-modelo do
// cadastro, ainda na frota. Escolhe-se o modelo da FIPE uma vez por grupo.
const textoDoGrupo = (x: string | null) => (x ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
export const chaveDoGrupoFipe = (v: { tipo: string; marca: string | null; modelo: string | null; anoMod: number | null }) => [v.tipo, textoDoGrupo(v.marca), textoDoGrupo(v.modelo), v.anoMod ?? ""].join("|");

export async function veiculosIguais(companyId: string, v: { id: string; tipo: string; marca: string | null; modelo: string | null; anoMod: number | null }) {
  if (!v.marca || !v.modelo || !v.anoMod) return [];
  const chave = chaveDoGrupoFipe(v);
  const candidatos = await prisma.cadVeiculo.findMany({
    where: { companyId, tipo: v.tipo, anoMod: v.anoMod, status: { notIn: ["vendido", "baixado"] }, NOT: { id: v.id } },
    select: { id: true, placa: true, tipo: true, marca: true, modelo: true, anoMod: true, fipeCodigo: true },
  });
  return candidatos.filter((c) => chaveDoGrupoFipe(c) === chave);
}
