import { lerReaisEmCents } from "@/lib/controladoria/format";
import { normalizarCnpj } from "@/lib/cadastro/normalizacao";
import { lerData, lerInteiro } from "@/lib/cadastro/fichaVeiculo";

// FINANCIAMENTOS, CAPITAL DE GIRO E CONSÓRCIOS — o que substitui a planilha
// "Consórcios e Financiamentos". Puro: leitura do formulário, a situação de
// cada contrato numa data e o saldo devedor por veículo.
//
// DE ONDE VÊM AS PARCELAS PAGAS, nesta ordem:
//   1. Omie — os títulos do contrato pagos nas contas a pagar
//      (src/lib/frota/parcelasOmie.ts). Com "007/048" no título, a maior
//      parcela paga é o número de pagas; sem isso, o informado até a data da
//      informação mais as pagas na Omie depois dela;
//   2. informado (extrato do banco, a planilha migrada);
//   3. as datas: as parcelas vencidas até hoje, supondo pagamento em dia.
// A situação diz qual das três usou.
//
// SALDO PARA QUITAÇÃO: financiamento e giro — o valor presente das parcelas
// restantes na taxa do contrato (a mesma conta do banco: confere ao centavo
// com o "valor para quitação" da planilha). Consórcio — a administradora
// calcula pelo fundo remanescente e pelo crédito corrigido, não por parcelas ×
// valor (Mercabenco reajusta a partir da parcela 50): vale o saldo INFORMADO
// menos as parcelas pagas depois da informação; sem informado, restantes ×
// parcela.

export const PRODUTOS = ["financiamento_bens", "capital_giro", "consorcio"] as const;
export type Produto = (typeof PRODUTOS)[number];
export const ROTULO_PRODUTO: Record<string, string> = { financiamento_bens: "Financiamento de bens", capital_giro: "Capital de giro", consorcio: "Consórcio" };
export const SITUACOES_CONSORCIO = ["nao_contemplada", "contemplada_sem_bem", "contemplada_com_bem"] as const;
export const ROTULO_SITUACAO_CONSORCIO: Record<string, string> = {
  nao_contemplada: "não contemplada",
  contemplada_sem_bem: "contemplada sem o bem",
  contemplada_com_bem: "contemplada com o bem",
};

// ---- Formulário ----

export type DadosFinanciamento = {
  produto: Produto;
  modalidade: string | null;
  instituicao: string;
  instituicaoCnpj: string | null;
  empresa: string | null;
  contratoNumero: string | null;
  celulaCredito: string | null;
  garantia: string | null;
  grupo: string | null;
  cota: string | null;
  dataInicio: Date | null;
  dataFinal: Date | null;
  dataPrimeiraParcela: Date | null;
  valorBensCents: bigint | null;
  entradaCents: bigint | null;
  valorFinanciadoCents: bigint | null;
  valorCreditadoCents: bigint | null;
  lanceCents: bigint | null;
  lancePlanejadoPct: number | null;
  taxaPct: number | null;
  vencimentoDia: number | null;
  parcelas: number | null;
  valorParcelaCents: bigint | null;
  parcelasPagas: number | null;
  valorPagoCents: bigint | null;
  saldoQuitacaoCents: bigint | null;
  situacaoConsorcio: string | null;
  dataContemplacao: Date | null;
  observacoes: string | null;
};

const txt = (v: unknown) => {
  const t = String(v ?? "").trim();
  return t === "" ? null : t;
};
const pct = (v: unknown, max: number): number | null | "invalido" => {
  const t = txt(v);
  if (t === null) return null;
  const x = Number(t.replace("%", "").replace(",", "."));
  return Number.isFinite(x) && x >= 0 && x <= max ? x : "invalido";
};

export function lerFinanciamento(f: Record<string, unknown>, hoje = new Date()): { ok: true; dados: DadosFinanciamento } | { ok: false; erro: string } {
  const produto = String(f.produto ?? "") as Produto;
  if (!PRODUTOS.includes(produto)) return { ok: false, erro: "Escolha o produto (financiamento, capital de giro ou consórcio)." };
  const instituicao = txt(f.instituicao);
  if (!instituicao) return { ok: false, erro: "Informe o banco ou a administradora." };
  const cnpjTxt = txt(f.instituicaoCnpj);
  const instituicaoCnpj = cnpjTxt ? normalizarCnpj(cnpjTxt) : null;
  if (cnpjTxt && !instituicaoCnpj) return { ok: false, erro: "CNPJ do banco/administradora inválido." };
  const parcelas = lerInteiro(f.parcelas, 1, 360);
  if (parcelas === "invalido") return { ok: false, erro: "Número de parcelas inválido (1 a 360)." };
  const pagas = lerInteiro(f.parcelasPagas, 0, 360);
  if (pagas === "invalido" || (pagas !== null && parcelas !== null && pagas > parcelas)) return { ok: false, erro: "Parcelas pagas inválidas (no máximo o total)." };
  const dia = lerInteiro(f.vencimentoDia, 1, 31);
  if (dia === "invalido") return { ok: false, erro: "Dia de vencimento inválido (1 a 31)." };
  const datas: Record<string, Date | null> = {};
  for (const [campo, rotulo] of [["dataInicio", "início"], ["dataFinal", "término"], ["dataPrimeiraParcela", "primeira parcela"], ["dataContemplacao", "contemplação"]] as const) {
    const d = lerData(f[campo]);
    if (d === "invalida") return { ok: false, erro: `Data de ${rotulo} inválida.` };
    datas[campo] = d;
  }
  if (datas.dataContemplacao && datas.dataContemplacao > hoje) return { ok: false, erro: "A contemplação não pode ser no futuro." };
  const dinheiro: Record<string, bigint | null> = {};
  for (const [campo, rotulo] of [
    ["valorBens", "Valor dos bens"],
    ["entrada", "Entrada"],
    ["valorFinanciado", "Valor financiado / crédito"],
    ["valorCreditado", "Valor creditado / líquido"],
    ["lance", "Lance"],
    ["valorParcela", "Valor da parcela"],
    ["valorPago", "Valor pago"],
    ["saldoQuitacao", "Saldo para quitação"],
  ] as const) {
    const v = lerReaisEmCents(String(f[campo] ?? ""));
    if (v === "invalido" || (typeof v === "number" && v < 0)) return { ok: false, erro: `${rotulo}: valor inválido.` };
    dinheiro[campo] = v === null ? null : BigInt(v);
  }
  const taxa = pct(f.taxaPct, 100);
  if (taxa === "invalido") return { ok: false, erro: "Taxa inválida (em %, ex.: 1,34)." };
  const lancePlan = pct(f.lancePlanejadoPct, 100);
  if (lancePlan === "invalido") return { ok: false, erro: "Lance planejado inválido (em % do crédito)." };
  const consorcio = produto === "consorcio";
  const situacao = consorcio ? (txt(f.situacaoConsorcio) ?? "nao_contemplada") : null;
  if (situacao && !(SITUACOES_CONSORCIO as readonly string[]).includes(situacao)) return { ok: false, erro: "Situação da cota inválida." };
  if (consorcio && situacao !== "nao_contemplada" && !datas.dataContemplacao) return { ok: false, erro: "Informe a data da contemplação." };
  return {
    ok: true,
    dados: {
      produto,
      modalidade: txt(f.modalidade),
      instituicao: instituicao.slice(0, 120),
      instituicaoCnpj,
      empresa: txt(f.empresa),
      contratoNumero: txt(f.contratoNumero),
      celulaCredito: txt(f.celulaCredito),
      garantia: txt(f.garantia),
      grupo: consorcio ? txt(f.grupo) : null,
      cota: consorcio ? txt(f.cota) : null,
      dataInicio: datas.dataInicio,
      dataFinal: datas.dataFinal,
      dataPrimeiraParcela: datas.dataPrimeiraParcela,
      valorBensCents: dinheiro.valorBens,
      entradaCents: dinheiro.entrada,
      valorFinanciadoCents: dinheiro.valorFinanciado,
      valorCreditadoCents: dinheiro.valorCreditado,
      lanceCents: consorcio ? dinheiro.lance : null,
      lancePlanejadoPct: consorcio ? lancePlan : null,
      taxaPct: taxa,
      vencimentoDia: dia,
      parcelas,
      valorParcelaCents: dinheiro.valorParcela,
      parcelasPagas: pagas,
      valorPagoCents: dinheiro.valorPago,
      saldoQuitacaoCents: dinheiro.saldoQuitacao,
      situacaoConsorcio: situacao,
      dataContemplacao: consorcio && situacao !== "nao_contemplada" ? datas.dataContemplacao : null,
      observacoes: txt(f.observacoes)?.slice(0, 2000) ?? null,
    },
  };
}

// ---- Parcelas e saldo ----

// "007/048", "7/48", "07 de 48" → { n: 7, total: 48 }; "7" → { n: 7, total: null }.
export function lerNumeroParcela(texto: string | null | undefined): { n: number; total: number | null } | null {
  const m = /(\d{1,3})\s*(?:\/|de)\s*(\d{1,3})/i.exec(String(texto ?? ""));
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= Number(m[2])) return { n: Number(m[1]), total: Number(m[2]) };
  const s = /^\s*0*(\d{1,3})\s*$/.exec(String(texto ?? ""));
  return s && Number(s[1]) >= 1 ? { n: Number(s[1]), total: null } : null;
}

// O vencimento da parcela n (1, 2, …): o mês da primeira + n − 1, no dia de
// vencimento (ou no da primeira), limitado ao último dia do mês.
export function vencimentoDaParcela(primeira: Date, n: number, dia: number | null): Date {
  const ano = primeira.getUTCFullYear();
  const mes = primeira.getUTCMonth() + (n - 1);
  const d = dia ?? primeira.getUTCDate();
  const ultimo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ano, mes, Math.min(d, ultimo)));
}

// A primeira parcela quando o contrato só diz o fim: o mês final − (parcelas − 1).
export function primeiraParcelaPeloFim(dataFinal: Date, parcelas: number, dia: number | null): Date {
  const base = new Date(Date.UTC(dataFinal.getUTCFullYear(), dataFinal.getUTCMonth() - (parcelas - 1), 1));
  return vencimentoDaParcela(base, 1, dia ?? dataFinal.getUTCDate());
}

// Saldo para quitação: valor presente das restantes (financiamento, giro) ou
// a soma delas (consórcio, ou sem taxa).
export function saldoParaQuitacao(p: { produto: string; restantes: number; valorParcelaCents: number; taxaPct: number | null }): number {
  if (p.restantes <= 0) return 0;
  const i = (p.taxaPct ?? 0) / 100;
  if (p.produto === "consorcio" || i <= 0 || i > 0.2) return Math.round(p.restantes * p.valorParcelaCents);
  return Math.round((p.valorParcelaCents * (1 - Math.pow(1 + i, -p.restantes))) / i);
}

export type PagamentoOmie = { numeroParcela: number | null; dataVencimento: Date; valorCents: number; pago: boolean; dataPagamento: Date | null };

export type ContratoFrota = {
  produto: string;
  parcelas: number | null;
  valorParcelaCents: bigint | number | null;
  taxaPct: number | null;
  dataPrimeiraParcela: Date | null;
  dataFinal: Date | null;
  vencimentoDia: number | null;
  parcelasPagas: number | null;
  saldoQuitacaoCents: bigint | number | null;
  saldoInformadoEm: Date | null;
  ativo: boolean;
};

export type SituacaoFinanciamento = {
  pagas: number | null;
  origemPagas: "omie" | "informado" | "datas" | "sem dados";
  restantes: number | null;
  proximoVencimento: Date | null;
  saldoCents: number | null;
  saldoInformadoCents: number | null;
  quitado: boolean;
  ultimoPagamento: Date | null;
  // Na Omie: títulos vencidos e não pagos; lançados e a vencer.
  atrasadas: { quantidade: number; valorCents: number };
  aVencerNaOmie: { quantidade: number; valorCents: number };
  // Parcelas que vencem nos próximos 60 dias e não estão lançadas na Omie
  // (só quando o contrato já tem ligação com a Omie).
  naoLancadas: number;
};

const num = (v: bigint | number | null) => (v === null ? null : Number(v));
const DIA = 86_400_000;

export function situacaoDoFinanciamento(c: ContratoFrota, hoje: Date, omie: PagamentoOmie[] = []): SituacaoFinanciamento {
  const parcela = num(c.valorParcelaCents);
  const primeira = c.dataPrimeiraParcela ?? (c.dataFinal && c.parcelas ? primeiraParcelaPeloFim(c.dataFinal, c.parcelas, c.vencimentoDia) : null);
  const pagosOmie = omie.filter((t) => t.pago);
  let pagas: number | null = null;
  let origem: SituacaoFinanciamento["origemPagas"] = "sem dados";
  const comNumero = pagosOmie.filter((t) => t.numeroParcela !== null);
  if (comNumero.length > 0) {
    pagas = Math.max(...comNumero.map((t) => t.numeroParcela as number));
    origem = "omie";
  } else if (pagosOmie.length > 0 && c.parcelasPagas !== null && c.saldoInformadoEm) {
    pagas = c.parcelasPagas + pagosOmie.filter((t) => t.dataVencimento > c.saldoInformadoEm!).length;
    origem = "omie";
  } else if (c.parcelasPagas !== null) {
    pagas = c.parcelasPagas;
    origem = "informado";
  } else if (pagosOmie.length > 0) {
    pagas = pagosOmie.length;
    origem = "omie";
  } else if (primeira && c.parcelas) {
    let k = 0;
    while (k < c.parcelas && vencimentoDaParcela(primeira, k + 1, c.vencimentoDia) <= hoje) k++;
    pagas = k;
    origem = "datas";
  }
  if (pagas !== null && c.parcelas) pagas = Math.min(pagas, c.parcelas);
  const restantes = pagas !== null && c.parcelas ? Math.max(0, c.parcelas - pagas) : null;
  const quitado = !c.ativo || restantes === 0;
  const proximo = !quitado && pagas !== null && primeira ? vencimentoDaParcela(primeira, pagas + 1, c.vencimentoDia) : null;
  const abertos = quitado ? [] : omie.filter((t) => !t.pago);
  const atrasados = abertos.filter((t) => t.dataVencimento < hoje);
  const aVencer = abertos.filter((t) => t.dataVencimento >= hoje);
  let naoLancadas = 0;
  if (!quitado && omie.length > 0 && primeira && c.parcelas && pagas !== null) {
    const limite = new Date(hoje.getTime() + 60 * DIA);
    for (let k = pagas + 1; k <= c.parcelas; k++) {
      const v = vencimentoDaParcela(primeira, k, c.vencimentoDia);
      if (v > limite) break;
      if (!omie.some((t) => Math.abs(t.dataVencimento.getTime() - v.getTime()) <= 10 * DIA)) naoLancadas++;
    }
  }
  const informado = num(c.saldoQuitacaoCents);
  let saldo: number | null;
  if (quitado) saldo = 0;
  else if (c.produto === "consorcio" && informado !== null) {
    const pagasDepois = pagas !== null && c.parcelasPagas !== null ? Math.max(0, pagas - c.parcelasPagas) : 0;
    saldo = Math.max(0, informado - pagasDepois * (parcela ?? 0));
  } else if (restantes !== null && parcela !== null) saldo = saldoParaQuitacao({ produto: c.produto, restantes, valorParcelaCents: parcela, taxaPct: c.taxaPct });
  else saldo = informado;
  return {
    pagas,
    origemPagas: origem,
    restantes,
    proximoVencimento: proximo,
    saldoCents: saldo,
    saldoInformadoCents: num(c.saldoQuitacaoCents),
    quitado,
    ultimoPagamento: pagosOmie.reduce<Date | null>((m, t) => (t.dataPagamento && (!m || t.dataPagamento > m) ? t.dataPagamento : m), null),
    atrasadas: { quantidade: atrasados.length, valorCents: atrasados.reduce((s, t) => s + t.valorCents, 0) },
    aVencerNaOmie: { quantidade: aVencer.length, valorCents: aVencer.reduce((s, t) => s + t.valorCents, 0) },
    naoLancadas,
  };
}

// A PARTE DE CADA VEÍCULO no contrato: pela "Parcela Placa" de cada um; sem
// ela (em algum), em partes iguais.
export function rateioDoContrato(veiculos: { veiculoId: string; parcelaCents: bigint | number | null }[]): Map<string, number> {
  const comParcela = veiculos.filter((v) => v.parcelaCents !== null && Number(v.parcelaCents) > 0);
  const total = comParcela.reduce((s, v) => s + Number(v.parcelaCents), 0);
  const fatias = new Map<string, number>();
  for (const v of veiculos) fatias.set(v.veiculoId, comParcela.length === veiculos.length && total > 0 ? Number(v.parcelaCents) / total : 1 / veiculos.length);
  return fatias;
}

export type SaldoDoVeiculo = { saldoCents: number; parcelaMensalCents: number; contratos: number; instituicoes: string[] };

// O SALDO DEVEDOR POR VEÍCULO (a aba "SALDO DEVEDOR PLACA"), com a situação
// atual de cada contrato.
export function saldoPorVeiculo(
  contratos: { instituicao: string; valorParcelaCents: bigint | number | null; situacao: SituacaoFinanciamento; veiculos: { veiculoId: string; parcelaCents: bigint | number | null }[] }[]
): Map<string, SaldoDoVeiculo> {
  const porVeiculo = new Map<string, SaldoDoVeiculo>();
  for (const c of contratos) {
    if (c.situacao.quitado || c.veiculos.length === 0) continue;
    for (const [veiculoId, f] of rateioDoContrato(c.veiculos)) {
      const g = porVeiculo.get(veiculoId) ?? { saldoCents: 0, parcelaMensalCents: 0, contratos: 0, instituicoes: [] };
      g.saldoCents += Math.round((c.situacao.saldoCents ?? 0) * f);
      g.parcelaMensalCents += Math.round(Number(c.valorParcelaCents ?? 0) * f);
      g.contratos++;
      if (!g.instituicoes.includes(c.instituicao)) g.instituicoes.push(c.instituicao);
      porVeiculo.set(veiculoId, g);
    }
  }
  return porVeiculo;
}

type ParaControle = {
  instituicao: string;
  produto: string;
  valorFinanciadoCents: bigint | number | null;
  valorParcelaCents: bigint | number | null;
  valorCreditadoCents: bigint | number | null;
  lanceCents: bigint | number | null;
  situacaoConsorcio: string | null;
  situacao: SituacaoFinanciamento;
};

// O CONTROLE GERAL (a primeira aba da planilha): por instituição e produto,
// e o resumo das cotas (não contempladas; contempladas sem o bem = crédito
// disponível para comprar veículo).
export function controleGeral(contratos: ParaControle[]) {
  type Linha = { instituicao: string; produto: string; contratos: number; principalCents: number; parcelaMensalCents: number; saldoCents: number; atrasadoCents: number };
  const linhas = new Map<string, Linha>();
  const consorcio = { naoContempladas: { cotas: 0, creditoCents: 0 }, semBem: { cotas: 0, creditoCents: 0, liquidoCents: 0 } };
  for (const c of contratos) {
    if (c.situacao.quitado) continue;
    const k = `${c.instituicao}|${c.produto}`;
    const g = linhas.get(k) ?? { instituicao: c.instituicao, produto: c.produto, contratos: 0, principalCents: 0, parcelaMensalCents: 0, saldoCents: 0, atrasadoCents: 0 };
    g.contratos++;
    g.principalCents += Number(c.valorFinanciadoCents ?? 0);
    g.parcelaMensalCents += Number(c.valorParcelaCents ?? 0);
    g.saldoCents += c.situacao.saldoCents ?? 0;
    g.atrasadoCents += c.situacao.atrasadas.valorCents;
    linhas.set(k, g);
    if (c.produto !== "consorcio") continue;
    if (c.situacaoConsorcio === "nao_contemplada") {
      consorcio.naoContempladas.cotas++;
      consorcio.naoContempladas.creditoCents += Number(c.valorFinanciadoCents ?? 0);
    } else if (c.situacaoConsorcio === "contemplada_sem_bem") {
      consorcio.semBem.cotas++;
      consorcio.semBem.creditoCents += Number(c.valorFinanciadoCents ?? 0);
      consorcio.semBem.liquidoCents += c.valorCreditadoCents !== null ? Number(c.valorCreditadoCents) : Number(c.valorFinanciadoCents ?? 0) - Number(c.lanceCents ?? 0);
    }
  }
  const lista = [...linhas.values()].sort((a, b) => a.produto.localeCompare(b.produto) || b.saldoCents - a.saldoCents);
  const total = lista.reduce(
    (t, l) => ({ contratos: t.contratos + l.contratos, principalCents: t.principalCents + l.principalCents, parcelaMensalCents: t.parcelaMensalCents + l.parcelaMensalCents, saldoCents: t.saldoCents + l.saldoCents, atrasadoCents: t.atrasadoCents + l.atrasadoCents }),
    { contratos: 0, principalCents: 0, parcelaMensalCents: 0, saldoCents: 0, atrasadoCents: 0 }
  );
  return { linhas: lista, total, consorcio };
}
