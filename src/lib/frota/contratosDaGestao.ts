import { prisma } from "@/lib/prisma";
import { lerContratosDaGestao, type ContratoLidoDaGestao, type VeiculoDoContratoGestao } from "@/lib/gestao/leitura";
import { lerNumeroParcela, primeiraParcelaPeloFim, situacaoDoFinanciamento, type PagamentoOmie, type SituacaoFinanciamento } from "./financiamentos";

// OS CONTRATOS SÃO DA GESTÃO (Cadastros › Veículos › Financiamentos): banco,
// número, cota, parcelas, placas. A controladoria só os lê e confere com a
// Omie — as parcelas pagas, as em atraso, as não lançadas e o saldo — e
// devolve o resultado à gestão pela integração (/api/integracao/financiamentos).
//
// A posição informada na gestão (parcelas pagas e saldo da planilha ou do
// extrato, na data `posicaoEm`) é o ponto de partida; o que a Omie pagou
// depois dela anda o contrato.

export type VeiculoDoContrato = {
  id: string;
  veiculoId: string;
  parcelaCents: number | null;
  saldoCents: number | null;
  veiculo: { id: string; placa: string; chassi: string | null; modelo: string | null; status: string | null };
};

export type ContratoDaGestao = {
  id: string;
  instituicao: string;
  produto: "financiamento_bens" | "consorcio";
  contratoNumero: string | null;
  grupo: string | null;
  cota: string | null;
  valorFinanciadoCents: number | null;
  valorParcelaCents: number | null;
  taxaPct: number | null;
  vencimentoDia: number | null;
  parcelas: number | null;
  parcelasPagas: number | null;
  saldoQuitacaoCents: number | null;
  saldoInformadoEm: Date | null;
  dataInicio: Date | null;
  dataPrimeiraParcela: Date | null;
  dataFinal: Date | null;
  situacaoConsorcio: "nao_contemplada" | "contemplada_sem_bem" | "contemplada_com_bem" | null;
  dataContemplacao: Date | null;
  // O texto do banco, como veio ("ALIENADO", "Contemplada c/ o bem"…).
  situacaoBanco: string | null;
  ativo: boolean;
  veiculos: VeiculoDoContrato[];
};

const CONTEMPLACAO: Record<string, ContratoDaGestao["situacaoConsorcio"]> = { COM_BEM: "contemplada_com_bem", SEM_BEM: "contemplada_sem_bem", NAO_CONTEMPLADA: "nao_contemplada" };

// Puro: a linha da gestão no formato da conferência.
export function contratoDaGestao(c: ContratoLidoDaGestao, veiculos: VeiculoDoContratoGestao[]): ContratoDaGestao {
  const consorcio = c.modalidade === "CONSORCIO";
  const num = (v: number | bigint | null) => (v === null ? null : Number(v));
  const parcelas = num(c.totalParcelas);
  const dia = num(c.diaVencimento);
  // A gestão não guarda o início: a primeira parcela sai do fim e do prazo.
  const inicio = c.dataFinal && parcelas ? primeiraParcelaPeloFim(c.dataFinal, parcelas, dia) : null;
  return {
    id: c.id,
    instituicao: c.banco,
    produto: consorcio ? "consorcio" : "financiamento_bens",
    contratoNumero: c.numeroContrato,
    grupo: c.grupo,
    cota: c.cota,
    valorFinanciadoCents: num(c.valorCents),
    valorParcelaCents: num(c.valorParcelaCents),
    taxaPct: c.taxaPct === null ? null : Number(c.taxaPct),
    vencimentoDia: dia,
    parcelas,
    parcelasPagas: num(c.parcelasPagas),
    saldoQuitacaoCents: num(c.saldoQuitacaoCents),
    saldoInformadoEm: c.parcelasPagas !== null || c.saldoQuitacaoCents !== null ? c.posicaoEm : null,
    dataInicio: inicio,
    dataPrimeiraParcela: null,
    dataFinal: c.dataFinal,
    situacaoConsorcio: consorcio ? (CONTEMPLACAO[c.contemplacao ?? ""] ?? "nao_contemplada") : null,
    dataContemplacao: c.dataContemplacao,
    situacaoBanco: c.situacao,
    ativo: !c.quitado,
    veiculos: veiculos.map((v) => ({
      id: v.id,
      // Sem o veículo ligado na gestão (placa ainda não cadastrada), a placa é a chave.
      veiculoId: v.vehicleId ?? `placa:${v.placa}`,
      parcelaCents: num(v.parcelaCents),
      saldoCents: num(v.saldoCents),
      veiculo: { id: v.vehicleId ?? `placa:${v.placa}`, placa: v.placa, chassi: v.chassi, modelo: v.modelo, status: v.status },
    })),
  };
}

const ORDEM = (a: ContratoDaGestao, b: ContratoDaGestao) =>
  Number(b.ativo) - Number(a.ativo) || a.instituicao.localeCompare(b.instituicao) || (a.contratoNumero ?? "").localeCompare(b.contratoNumero ?? "") || (a.grupo ?? "").localeCompare(b.grupo ?? "") || (a.cota ?? "").localeCompare(b.cota ?? "");

// null = a gestão não respondeu (quem chama não pode tratar como "sem contratos").
export async function lerContratos(companyId: string): Promise<ContratoDaGestao[] | null> {
  const lido = await lerContratosDaGestao(companyId);
  if (!lido) return null;
  const porContrato = new Map<string, VeiculoDoContratoGestao[]>();
  for (const v of lido.veiculos) porContrato.set(v.financiamentoId, [...(porContrato.get(v.financiamentoId) ?? []), v]);
  return lido.contratos.map((c) => contratoDaGestao(c, porContrato.get(c.id) ?? [])).sort(ORDEM);
}

const PAGO = /PAGO|LIQUID|QUITAD|RECEBID/i;

// Os títulos da Omie ligados a cada contrato (parcelasOmie.ts), como pagamentos.
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

export type ContratoComSituacao = ContratoDaGestao & { pagamentosOmie: PagamentoOmie[]; situacao: SituacaoFinanciamento };

export async function contratosComSituacao(companyId: string, hoje: Date, filtro: { ids?: string[]; vehicleId?: string } = {}): Promise<{ contratos: ContratoComSituacao[]; gestaoDisponivel: boolean }> {
  const todos = await lerContratos(companyId);
  if (!todos) return { contratos: [], gestaoDisponivel: false };
  const lista = todos.filter((c) => (!filtro.ids || filtro.ids.includes(c.id)) && (!filtro.vehicleId || c.veiculos.some((v) => v.veiculoId === filtro.vehicleId)));
  const omie = await pagamentosOmiePorContrato(companyId, filtro.ids || filtro.vehicleId ? lista.map((c) => c.id) : undefined);
  return {
    contratos: lista.map((c) => ({ ...c, pagamentosOmie: omie.get(c.id) ?? [], situacao: situacaoDoFinanciamento(c, hoje, omie.get(c.id) ?? []) })),
    gestaoDisponivel: true,
  };
}
