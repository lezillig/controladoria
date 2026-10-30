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
import { casarClientes } from "../src/lib/controladoria/casamentoClientes";
import { custoDeCapitalPorVeiculo, premissasDaBase } from "../src/lib/controladoria/custoDeCapital";
import { centrosDeCustoDoMes, custoPorFuncionario, custoPorVeiculo, custoTotalPeriodo, custosDoPeriodo, rentabilidadePorContrato } from "../src/lib/controladoria/unitEconomics";
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
    clientes: [{ id: "cli1", nome: "PREFEITURA", active: true, cnpj: "46395000000139" }, { id: "cli2", nome: "SEM CNPJ LTDA", active: true, cnpj: null }],
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

console.log("\nRECEITA PELO CNPJ DO CLIENTE DA GESTÃO — sem de-para");
{
  const daPrefeitura = titulo({ natureza: "RECEBER", parceiroNome: "PREF MUN X", parceiroDocumento: "46.395.000/0001-39", parceiroCodigo: "C9", valorDocumentoCents: 10_000_00 });
  const deOutro = titulo({ natureza: "RECEBER", parceiroNome: "EMPRESA Y", parceiroDocumento: "61068276000104", parceiroCodigo: "C8", valorDocumentoCents: 3_000_00 });
  // A prefeitura também vendeu para a Azul: custo não vai para o contrato dela pelo CNPJ.
  const compraDaPrefeitura = titulo({ parceiroDocumento: "46395000000139", valorDocumentoCents: 500_00 });
  const ctx = contexto({ titulos: [daPrefeitura, deOutro, compraDaPrefeitura] });
  const r = rentabilidadePorContrato(ctx, AGOSTO, nomes);
  conferir("receita do CNPJ do cliente entra no contrato", r.linhas.map((l) => [l.id, l.receitaCents, l.custoCents]), [["cli1", 10_000_00, 0]]);
  conferir("custo de quem é cliente não vai pelo CNPJ", r.naoAlocadoCents, 500_00);
  const c = casarClientes(ctx, AGOSTO);
  conferir(
    "conferência: casado, sem CNPJ e quem pagou sem cliente",
    [c.clientes.map((x) => [x.nome, x.cnpj, x.nomesNaOmie, x.receitaCents]), c.semCliente.map((x) => [x.nome, x.receitaCents])],
    [
      [["PREFEITURA", "46395000000139", ["PREF MUN X"], 10_000_00], ["SEM CNPJ LTDA", null, [], 0]],
      [["EMPRESA Y", 3_000_00]],
    ]
  );
  const comDePara = rentabilidadePorContrato(contexto({ titulos: [titulo({ ...daPrefeitura, id: "dp", departamentoCodigo: "D1" })], vinculos: [vinculo({ clienteId: "cli1" })] }), AGOSTO, nomes);
  conferir("de-para confirmado continua valendo antes do CNPJ", comDePara.linhas[0]?.receitaCents, 10_000_00);
}

console.log("\nCENTRO DE CUSTO BATIZADO COM A PLACA OU O CONTRATO — sem de-para");
{
  const base = contexto({});
  const ctx = {
    ...base,
    clientes: [{ id: "cli1", nome: "PREFEITURA", active: true, cnpj: null, numerosDeContrato: ["CT 12/2026"] }, { id: "cli2", nome: "UNILEVER", active: true, cnpj: null, numerosDeContrato: ["7"] }],
    departamentos: [
      { conexaoId: "x", codigo: "D10", descricao: "VAN ABC-1D23" },
      { conexaoId: "x", codigo: "D11", descricao: "Contrato CT 12/2026 - Prefeitura" },
      { conexaoId: "x", codigo: "D12", descricao: "ABC1D23 e CT 12/2026 (rateio)" },
      { conexaoId: "x", codigo: "D13", descricao: "Oficina 7" },
    ],
    projetos: [],
  } as unknown as ContextoAuditoria;
  const t10 = titulo({ departamentoCodigo: "D10", valorDocumentoCents: 700_00 });
  const t11 = titulo({ departamentoCodigo: "D11", valorDocumentoCents: 900_00 });
  const t12 = titulo({ departamentoCodigo: "D12", valorDocumentoCents: 100_00 });
  const t13 = titulo({ departamentoCodigo: "D13", valorDocumentoCents: 50_00 });
  const c = { ...ctx, titulos: [t10, t11, t12, t13] } as ContextoAuditoria;
  conferir("placa no nome do departamento leva ao veículo", custoPorVeiculo(c, AGOSTO).linhas.map((l) => [l.id, l.custoCents]), [["v1", 700_00]]);
  conferir("número do contrato no nome leva ao cliente dele", rentabilidadePorContrato(c, AGOSTO, nomes).linhas.map((l) => [l.id, l.custoCents]), [["cli1", 900_00]]);
  conferir(
    "duas coisas no nome é rateio (de-para); número curto não casa",
    centrosDeCustoDoMes(c, AGOSTO).map((x) => [x.codigo, x.destino, x.alvo]),
    [["D11", "contrato", "PREFEITURA"], ["D10", "placa", "ABC1D23"], ["D12", "nenhum", null], ["D13", "nenhum", null]]
  );
}

console.log("\nCUSTO DE PROPRIEDADE — depreciação linear e parcela ao lado");
{
  const premissas = premissasDaBase(new Map([["vida_util_anos", { valor: 5 }], ["valor_residual_pct", { valor: 0.2 }]]));
  conferir("premissas da base", [premissas.vidaUtilAnos, premissas.valorResidualPct, premissas.fonte], [5, 0.2, "base de custos do simulador"]);
  conferir("sem premissa na base, o padrão do simulador e a tela diz", premissasDaBase(new Map()).vidaUtilAnos, 8);
  const v = (id: string, p: Partial<{ dataCompra: Date | null; valorCompraCents: number | null; dataVenda: Date | null }>) => ({
    id, plate: id.toUpperCase(), status: "ATIVO", dataCompra: d("2024-03-10T00:00:00"), valorCompraCents: 300_000_00, dataVenda: null, ...p,
  });
  const r = custoDeCapitalPorVeiculo(
    [v("van1", {}), v("velha", { dataCompra: d("2015-01-01T00:00:00") }), v("semcompra", { valorCompraCents: null }), v("vendida", { dataVenda: d("2026-07-01T00:00:00") })],
    [
      { vehicleId: "van1", banco: "Itaú", modalidade: "CDC", parcelaCents: 7_500_00, saldoCents: 120_000_00, quitado: false, dataFinal: d("2028-01-01T00:00:00"), posicaoEm: d("2026-08-01") },
      { vehicleId: "van1", banco: "Bradesco", modalidade: "CONSORCIO", parcelaCents: 2_000_00, saldoCents: 0, quitado: true, dataFinal: null, posicaoEm: d("2026-08-01") },
    ],
    premissas,
    AGOSTO
  );
  conferir(
    "R$ 300 mil, 20% residual, 5 anos = R$ 4.000/mês; quitado não pesa; vida útil encerrada e sem compra dizem por quê; vendida antes do mês sai",
    r.map((x) => [x.placa, x.depreciacaoCents, x.motivo, x.parcelaCents, x.saldoCents, x.financiamentos]),
    [
      ["VAN1", 4_000_00, null, 7_500_00, 120_000_00, ["financiamento Itaú"]],
      ["VELHA", null, "vida útil encerrada", 0, 0, []],
      ["SEMCOMPRA", null, "sem valor ou data de compra na ficha", 0, 0, []],
    ]
  );
}

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
