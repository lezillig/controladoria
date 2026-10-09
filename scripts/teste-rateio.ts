// TESTES DO RATEIO DE CUSTO — `npm run teste:rateio`.
//
// O custo por contrato, veículo e funcionário soma títulos a pagar da Omie e
// o extrato do cartão de frota. Quando os dois existem no mesmo período, a
// fatura do cartão na Omie e as transações do extrato são o MESMO dinheiro —
// e somá-los dobrava o combustível. Cada cenário aqui confere o número: total,
// não alocado, cobertura e quanto foi descontado.
//
// Sem banco: o contexto é montado à mão, como nos outros conjuntos.
import type { OmieCategoria, OmieTitulo, OmieVinculoCentroCusto } from "@prisma/client";
import { custoPorFuncionario, custoPorVeiculo, custoTotalPeriodo, custosDoPeriodo, rentabilidadePorContrato } from "../src/lib/controladoria/unitEconomics";
import type { ContextoAuditoria } from "../src/lib/controladoria/types";
import type { AbastecimentoGestao } from "../src/lib/gestao/leitura";
import type { Periodo } from "../src/lib/controladoria/periodos";

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(
    `${ok ? "  ok  " : "FALHA "} ${nome}` +
      (ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         obtido   ${JSON.stringify(real)}`)
  );
}

const d = (iso: string) => new Date(iso);
const HOJE = d("2026-09-15T00:00:00");
const AGOSTO: Periodo = { inicio: d("2026-08-01T00:00:00"), fim: d("2026-08-31T23:59:59.999"), rotulo: "ago/2026" };

let seq = 0;
const titulo = (p: Partial<OmieTitulo> = {}): OmieTitulo =>
  ({
    id: `t${++seq}`,
    companyId: "c",
    conexaoId: "x",
    conexaoApelido: "AZUL",
    natureza: "PAGAR",
    codigoLancamento: `L${seq}`,
    cancelado: false,
    liquidado: true,
    status: "Pago",
    parceiroNome: "FORNECEDOR TESTE",
    parceiroDocumento: null,
    parceiroCodigo: "F1",
    categoriaCodigo: "2.01",
    categoriaDescricao: "Manutenção",
    departamentoCodigo: null,
    projetoCodigo: null,
    observacao: null,
    numeroDocumento: null,
    dataEmissao: d("2026-08-05T00:00:00"),
    dataVencimento: d("2026-08-20T00:00:00"),
    valorDocumentoCents: 1_000_00,
    valorPagoCents: 1_000_00,
    saldoCents: 0,
    ...p,
  }) as OmieTitulo;

const abastecimento = (p: Partial<AbastecimentoGestao> = {}): AbastecimentoGestao => ({
  id: `a${++seq}`,
  vehicleId: "v1",
  driverId: "m1",
  valorCents: 60_000,
  volumeLitros: 100,
  kmRodados: null,
  placaOriginal: "ABC1D23",
  combustivel: "DIESEL S10",
  posto: "POSTO CENTRAL",
  cidade: "CAMPINAS",
  uf: "SP",
  hodometro: null,
  motoristaOriginal: null,
  modeloOriginal: null,
  dataHora: d("2026-08-10T08:00:00"),
  ...p,
});

const vinculo = (p: Partial<OmieVinculoCentroCusto>): OmieVinculoCentroCusto =>
  ({
    id: `v${++seq}`,
    companyId: "c",
    tipoOrigem: "DEPARTAMENTO",
    valorOrigem: "D1",
    rotuloOrigem: null,
    conexaoId: null,
    clienteId: null,
    vehicleId: null,
    driverId: null,
    percentual: 100,
    sugerido: false,
    confirmadoPorUserId: null,
    ...p,
  }) as OmieVinculoCentroCusto;

function contexto(p: {
  titulos?: OmieTitulo[];
  abastecimentos?: AbastecimentoGestao[];
  vinculos?: OmieVinculoCentroCusto[];
  categorias?: Partial<OmieCategoria>[];
}): ContextoAuditoria {
  return {
    companyId: "c",
    conexaoId: null,
    dataReferencia: HOJE,
    agora: HOJE,
    janelaDesde: d("2026-01-01"),
    titulos: p.titulos ?? [],
    baixas: [],
    movimentos: [],
    notas: [],
    parceiros: [],
    categorias: p.categorias ?? [],
    departamentos: [],
    projetos: [],
    vinculos: p.vinculos ?? [],
    contasCorrentes: [],
    config: {},
    clientes: [{ id: "cli1", nome: "PREFEITURA", active: true }],
    motoristas: [{ id: "m1", name: "JOSE DA SILVA", cpf: "00000000000", active: true, valorHoraCents: null, clienteId: "cli1", departamento: null }],
    veiculos: [{ id: "v1", plate: "ABC1D23", status: "ATIVO", currentMileage: 0, model: "SPRINTER", type: "VAN" }],
    abastecimentos: p.abastecimentos ?? [],
    gestao: { disponivel: true, erro: null },
  } as unknown as ContextoAuditoria;
}

const nomes = new Map([["cli1", "PREFEITURA"]]);
const resumo = (r: { totalCents: number; naoAlocadoCents: number; coberturaPercent: number; combustivelDescontadoCents: number }) => ({
  total: r.totalCents,
  naoAlocado: r.naoAlocadoCents,
  cobertura: Math.round(r.coberturaPercent),
  descontado: r.combustivelDescontadoCents,
});

// Os mesmos títulos em todos os cenários: manutenção com vínculo ao contrato,
// e a fatura do cartão de frota (parceiro TICKET, categoria Combustível).
const manutencao = () => titulo({ departamentoCodigo: "D1", valorDocumentoCents: 4_000_00 });
const faturaCartao = () =>
  titulo({ parceiroNome: "TICKET LOG", parceiroCodigo: "TK", categoriaCodigo: "2.05", categoriaDescricao: "Combustível", valorDocumentoCents: 1_800_00 });
const vinculoContrato = () => vinculo({ clienteId: "cli1" });
const categorias: Partial<OmieCategoria>[] = [{ codigo: "2.05", descricao: "Combustível" }, { codigo: "2.01", descricao: "Manutenção" }];

console.log("SEM EXTRATO — a Omie é a única fonte de combustível");
{
  const ctx = contexto({ titulos: [manutencao(), faturaCartao()], vinculos: [vinculoContrato()], categorias });
  const r = rentabilidadePorContrato(ctx, AGOSTO, nomes);
  conferir("fatura entra no total e fica não alocada", resumo(r), { total: 5_800_00, naoAlocado: 1_800_00, cobertura: 69, descontado: 0 });
  conferir("custo total do período bate", custoTotalPeriodo(ctx, AGOSTO), 5_800_00);
}

console.log("\nCOM EXTRATO — a fatura sai, o extrato representa o combustível");
{
  // Três abastecimentos do motorista do contrato: R$ 600 cada, R$ 1.800 no mês
  // — o mesmo dinheiro da fatura TICKET.
  const extrato = [abastecimento(), abastecimento({ dataHora: d("2026-08-17T08:00:00") }), abastecimento({ dataHora: d("2026-08-24T08:00:00") })];
  const ctx = contexto({ titulos: [manutencao(), faturaCartao()], abastecimentos: extrato, vinculos: [vinculoContrato()], categorias });

  const colheita = custosDoPeriodo(ctx, AGOSTO);
  conferir("colheita: fica só a manutenção", colheita.titulos.map((t) => t.valorDocumentoCents), [4_000_00]);
  conferir("colheita: desconta a fatura", colheita.combustivelDescontadoCents, 1_800_00);

  const contrato = rentabilidadePorContrato(ctx, AGOSTO, nomes);
  conferir("contrato: total sem dupla contagem, tudo alocado", resumo(contrato), { total: 5_800_00, naoAlocado: 0, cobertura: 100, descontado: 1_800_00 });
  conferir("contrato: custo do cliente vem de vínculo e cartão", contrato.linhas[0]?.origens.sort(), ["cartao-frota", "vinculo"]);

  const veiculo = custoPorVeiculo(ctx, AGOSTO);
  conferir("veículo: manutenção não alocada, combustível no veículo", resumo(veiculo), { total: 5_800_00, naoAlocado: 4_000_00, cobertura: 31, descontado: 1_800_00 });
  conferir("veículo: custo da placa é só o cartão", veiculo.linhas[0]?.custoCents, 1_800_00);

  const funcionario = custoPorFuncionario(ctx, AGOSTO);
  conferir("funcionário: mesmo total", resumo(funcionario), { total: 5_800_00, naoAlocado: 4_000_00, cobertura: 31, descontado: 1_800_00 });

  conferir("custo total do período bate com o rateio", custoTotalPeriodo(ctx, AGOSTO), 5_800_00);
}

console.log("\nRECONHECIMENTO — combustível pelo parceiro ou pela descrição, sem cadastro de categoria");
{
  const extrato = [abastecimento()];
  const posto = titulo({ parceiroNome: "AUTO POSTO BOA VIAGEM", categoriaCodigo: "9.99", categoriaDescricao: null, valorDocumentoCents: 700_00 });
  const diesel = titulo({ parceiroNome: "DISTRIBUIDORA X", categoriaCodigo: "9.98", categoriaDescricao: "Diesel S10", valorDocumentoCents: 300_00 });
  const ctx = contexto({ titulos: [manutencao(), posto, diesel], abastecimentos: extrato, vinculos: [vinculoContrato()] });
  const colheita = custosDoPeriodo(ctx, AGOSTO);
  conferir("posto e diesel saem pela palavra", colheita.combustivelDescontadoCents, 1_000_00);
  conferir("manutenção fica", colheita.titulos.length, 1);
}

console.log("\nPERÍODO — extrato de outro mês não desconta a fatura deste");
{
  const extratoSetembro = [abastecimento({ dataHora: d("2026-09-03T08:00:00") })];
  const ctx = contexto({ titulos: [manutencao(), faturaCartao()], abastecimentos: extratoSetembro, vinculos: [vinculoContrato()], categorias });
  const r = rentabilidadePorContrato(ctx, AGOSTO, nomes);
  conferir("agosto sem extrato: fatura entra", resumo(r), { total: 5_800_00, naoAlocado: 1_800_00, cobertura: 69, descontado: 0 });
  conferir("título cancelado nunca entra", custoTotalPeriodo(contexto({ titulos: [titulo({ cancelado: true })] }), AGOSTO), 0);
}

console.log("\nSÓ CUSTO DE OPERAÇÃO — investimento, financiamento, sócios e o grupo ficam fora");
{
  const compraVeiculo = titulo({ categoriaCodigo: "5.01", categoriaDescricao: "Aquisição de veículos", valorDocumentoCents: 50_000_00 });
  const emprestimo = titulo({ categoriaCodigo: "5.02", categoriaDescricao: "Pagamento de empréstimo", valorDocumentoCents: 20_000_00 });
  const repasseMcz = titulo({ categoriaCodigo: "2.01", parceiroDocumento: "11222333000144", valorDocumentoCents: 9_000_00 });
  const classificacoesDre = new Map([
    ["5.01", { linha: "FINANCIAMENTO_INVESTIMENTO" }],
    ["5.02", { linha: "FINANCIAMENTO_INVESTIMENTO" }],
  ]);
  const ctx = { ...contexto({ titulos: [manutencao(), compraVeiculo, emprestimo, repasseMcz] }), classificacoesDre, raizesCnpjDoGrupo: ["11222333"], conexaoId: null } as ContextoAuditoria;
  const c = custosDoPeriodo(ctx, AGOSTO);
  conferir("só a manutenção fica no custo", c.titulos.length, 1);
  conferir("o que saiu é dito", c.foraDoCustoCents, 79_000_00);
  conferir("visão de uma empresa: o repasse ao grupo é custo dela", custosDoPeriodo({ ...ctx, conexaoId: "x" }, AGOSTO).foraDoCustoCents, 70_000_00);
}

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
