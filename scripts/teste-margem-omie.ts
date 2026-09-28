// TESTES DA MARGEM QUE A OMIE JÁ SABE — `npm run teste:margem-omie`.
//
// Margem por OS (projeto), por cliente Omie (as OS somadas por quem foi
// cobrado) e faturado versus contratado por contrato de serviço. Nenhuma das
// três passa por vínculo: só entra o que o título já trouxe da origem, e o
// que não trouxe fica contado à parte. Cada cenário confere o número.
//
// Sem banco: o contexto é montado à mão, como nos outros conjuntos.
import type { OmieContrato, OmieProjeto, OmieTitulo } from "@prisma/client";
import { faturadoVersusContratado, margemPorClienteOmie, margemPorOs } from "../src/lib/controladoria/margemOmie";
import type { ContextoAuditoria } from "../src/lib/controladoria/types";
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
    contratoCodigo: null,
    dataEmissao: d("2026-08-05T00:00:00"),
    dataVencimento: d("2026-08-20T00:00:00"),
    valorDocumentoCents: 1_000_00,
    valorPagoCents: 1_000_00,
    saldoCents: 0,
    ...p,
  }) as OmieTitulo;

const receber = (p: Partial<OmieTitulo> = {}) =>
  titulo({ natureza: "RECEBER", parceiroCodigo: "CLI1", parceiroNome: "PREFEITURA DE CAJAMAR", categoriaCodigo: "1.01", categoriaDescricao: "Serviços", ...p });

const projeto = (codigo: string, nome: string, conexaoId = "x"): OmieProjeto =>
  ({ id: `p${++seq}`, companyId: "c", conexaoId, conexaoApelido: conexaoId === "x" ? "AZUL" : "MCZ", codigo, nome, inativo: false, sincronizadoEm: HOJE }) as OmieProjeto;

const contrato = (p: Partial<OmieContrato> = {}): OmieContrato =>
  ({
    id: `c${++seq}`,
    companyId: "c",
    conexaoId: "x",
    conexaoApelido: "AZUL",
    codigoOmie: "9001",
    codigoIntegracao: null,
    numero: "CT-1",
    parceiroCodigo: "CLI1",
    parceiroNome: "PREFEITURA DE CAJAMAR",
    situacao: "10",
    situacaoDescricao: "Ativo",
    vigenciaInicio: d("2026-01-01"),
    vigenciaFim: d("2026-12-31"),
    diaFaturamento: 10,
    valorMensalCents: 50_000_00,
    periodicidade: "01",
    categoriaCodigo: null,
    itens: [],
    usuarioInclusao: null,
    usuarioAlteracao: null,
    dataInclusaoOmie: null,
    alteradoEmOmie: null,
    hashCampos: "h",
    versoes: [],
    sincronizadoEm: HOJE,
    ...p,
  }) as OmieContrato;

function contexto(p: { titulos?: OmieTitulo[]; projetos?: OmieProjeto[]; contratos?: OmieContrato[] }): ContextoAuditoria {
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
    categorias: [],
    departamentos: [],
    projetos: p.projetos ?? [],
    contratos: p.contratos,
    vinculos: [],
    contasCorrentes: [],
    config: {},
    clientes: [],
    motoristas: [],
    veiculos: [],
    abastecimentos: [],
    gestao: { disponivel: false },
  } as unknown as ContextoAuditoria;
}

console.log("MARGEM POR OS — receita menos custo do mesmo projeto");
{
  const titulos = [
    // OS 14516: dois custos e uma cobrança em agosto.
    titulo({ projetoCodigo: "14516", valorDocumentoCents: 3_000_00, dataEmissao: d("2026-08-03T00:00:00") }),
    titulo({ projetoCodigo: "14516", valorDocumentoCents: 1_500_00, dataEmissao: d("2026-08-04T00:00:00") }),
    receber({ projetoCodigo: "14516", valorDocumentoCents: 6_000_00, dataEmissao: d("2026-08-28T00:00:00") }),
    // OS 14517: custou, nunca foi cobrada.
    titulo({ projetoCodigo: "14517", valorDocumentoCents: 2_000_00, dataEmissao: d("2026-08-10T00:00:00") }),
    // OS 14518: cobrada em setembro, custo em agosto — a leitura sem período
    // junta os dois; a de agosto vê só o custo.
    titulo({ projetoCodigo: "14518", valorDocumentoCents: 900_00, dataEmissao: d("2026-08-30T00:00:00") }),
    receber({ projetoCodigo: "14518", valorDocumentoCents: 2_400_00, dataEmissao: d("2026-09-02T00:00:00"), parceiroCodigo: "CLI2", parceiroNome: "COLÉGIO ALFA" }),
    // Sem projeto: fica fora e é contado à parte.
    titulo({ valorDocumentoCents: 700_00 }),
    receber({ valorDocumentoCents: 5_000_00 }),
    // Cancelado: nunca entra.
    titulo({ projetoCodigo: "14516", valorDocumentoCents: 99_999_00, cancelado: true }),
    // Mesmo código 14516 na outra empresa: outra OS.
    titulo({ projetoCodigo: "14516", conexaoId: "y", conexaoApelido: "MCZ", valorDocumentoCents: 400_00, dataEmissao: d("2026-08-01T00:00:00") }),
  ];
  const projetos = [projeto("14516", "Fretamento Cajamar — agosto"), projeto("14516", "Escolar MCZ", "y")];
  const ctx = contexto({ titulos, projetos });

  const tudo = margemPorOs(ctx);
  conferir(
    "ordem: do último movimento mais recente ao mais antigo",
    tudo.os.map((o) => `${o.conexaoApelido}|${o.projeto}`),
    ["AZUL|14518", "AZUL|14516", "AZUL|14517", "MCZ|14516"]
  );
  const principal = tudo.os.find((o) => o.chave === "x|14516")!;
  conferir("OS 14516: receita, custo e margem", [principal.receitaCents, principal.custoCents, principal.margemCents], [6_000_00, 4_500_00, 1_500_00]);
  conferir("OS 14516: margem percentual", Math.round(principal.margemPercent!), 25);
  conferir("OS 14516: nome vem do cadastro de projeto", principal.nome, "Fretamento Cajamar — agosto");
  conferir("OS 14516: cliente cobrado", [principal.clienteCodigo, principal.clientesDistintos], ["CLI1", 1]);
  conferir("OS 14517: sem faturamento, margem é o custo negativo", tudo.os.find((o) => o.chave === "x|14517")!.margemCents, -2_000_00);
  conferir("OS 14518 sem período: cobrança de setembro entra", tudo.os.find((o) => o.chave === "x|14518")!.margemCents, 1_500_00);
  conferir("MCZ 14516 é outra OS, com o nome dela", tudo.os.find((o) => o.chave === "y|14516")!.nome, "Escolar MCZ");
  conferir("fora das OS: custo e receita sem projeto", [tudo.custoForaDeOsCents, tudo.receitaForaDeOsCents], [700_00, 5_000_00]);
  conferir("contagens: sem faturamento e sem custo", [tudo.semFaturamento, tudo.semCusto], [2, 0]);
  // 3.000 + 1.500 + 2.000 + 900 + 400 de custo; 6.000 + 2.400 de receita.
  conferir("totais das OS", [tudo.receitaCents, tudo.custoCents], [8_400_00, 7_800_00]);

  const agosto = margemPorOs(ctx, AGOSTO);
  conferir("agosto: OS 14518 só com o custo", agosto.os.find((o) => o.chave === "x|14518")!.receitaCents, 0);
  conferir("agosto: receita sem projeto de agosto conta fora", agosto.receitaForaDeOsCents, 5_000_00);

  console.log("\nMARGEM POR CLIENTE OMIE — as OS somadas por quem foi cobrado");
  const clientes = margemPorClienteOmie(tudo);
  conferir(
    "um grupo por cliente e um para as OS sem cobrança, maior receita primeiro",
    clientes.map((c) => [c.clienteNome, c.ordens, c.receitaCents, c.custoCents]),
    [
      ["PREFEITURA DE CAJAMAR (AZUL)", 1, 6_000_00, 4_500_00],
      ["COLÉGIO ALFA (AZUL)", 1, 2_400_00, 900_00],
      ["OS sem cobrança", 2, 0, 2_400_00],
    ]
  );
  conferir("sem cobrança: margem percentual não existe", clientes[2].margemPercent, null);
}

console.log("\nFATURADO × CONTRATADO — por contrato de serviço, no mês");
{
  const contratos = [
    contrato(), // CT-1 ativo, R$ 50 mil/mês
    contrato({ codigoOmie: "9002", numero: "CT-2", parceiroNome: "COLÉGIO ALFA", valorMensalCents: 20_000_00 }),
    contrato({ codigoOmie: "9003", numero: "CT-3", parceiroNome: "ANTIGO", situacao: "99", situacaoDescricao: "Cancelado", valorMensalCents: 10_000_00 }),
    contrato({ codigoOmie: "9004", numero: "CT-4", parceiroNome: "ENCERRADO SEM MOVIMENTO", situacao: "90", situacaoDescricao: "Suspenso", valorMensalCents: 8_000_00 }),
    contrato({ codigoOmie: "9005", numero: "CT-5", parceiroNome: "TRIMESTRAL", periodicidade: "03", valorMensalCents: 30_000_00 }),
    contrato({ codigoOmie: "9006", numero: "CT-6", conexaoId: "y", conexaoApelido: "MCZ", parceiroNome: "MCZ CLIENTE", valorMensalCents: 5_000_00 }),
  ];
  const titulos = [
    // CT-1 pelo código interno, duas parcelas: R$ 45 mil de R$ 50 mil.
    receber({ contratoCodigo: "9001", valorDocumentoCents: 30_000_00 }),
    receber({ contratoCodigo: "9001", valorDocumentoCents: 15_000_00 }),
    // CT-2 pelo NÚMERO: faturou o contratado inteiro.
    receber({ contratoCodigo: "CT-2", valorDocumentoCents: 20_000_00 }),
    // CT-3 cancelado e ainda faturando.
    receber({ contratoCodigo: "9003", valorDocumentoCents: 4_000_00 }),
    // Fora do mês: não conta para agosto.
    receber({ contratoCodigo: "9001", valorDocumentoCents: 50_000_00, dataEmissao: d("2026-07-10T00:00:00") }),
    // Código 9006 na AZUL não é o CT-6 da MCZ.
    receber({ contratoCodigo: "9006", valorDocumentoCents: 5_000_00 }),
    // Cancelado: não entra.
    receber({ contratoCodigo: "9001", valorDocumentoCents: 5_000_00, cancelado: true }),
  ];
  const linhas = faturadoVersusContratado(contexto({ titulos, contratos }), AGOSTO);
  conferir(
    "ativos primeiro, quem mais falta no topo (empate: maior contrato); suspenso sem movimento fica fora",
    linhas.map((l) => l.rotulo),
    ["CT-1", "CT-6", "CT-2", "CT-5", "CT-3"]
  );
  const ct1 = linhas.find((l) => l.rotulo === "CT-1")!;
  conferir("CT-1: faturado, diferença e percentual", [ct1.faturadoCents, ct1.diferencaCents, Math.round(ct1.faturadoPercent!), ct1.titulos], [45_000_00, -5_000_00, 90, 2]);
  conferir("CT-2 pelo número: 100%", linhas.find((l) => l.rotulo === "CT-2")!.faturadoPercent, 100);
  const ct3 = linhas.find((l) => l.rotulo === "CT-3")!;
  conferir("CT-3 cancelado: faturou 4 mil, diferença é tudo a mais", [ct3.ativo, ct3.faturadoCents, ct3.diferencaCents, ct3.faturadoPercent], [false, 4_000_00, 4_000_00, null]);
  const ct5 = linhas.find((l) => l.rotulo === "CT-5")!;
  conferir("CT-5 trimestral: sem diferença mensal comparável", [ct5.periodicidade, ct5.diferencaCents, ct5.faturadoPercent], ["trimestral", null, null]);
  conferir("CT-6 da MCZ: o 9006 da AZUL não é dele", linhas.find((l) => l.rotulo === "CT-6")!.faturadoCents, 0);
  conferir("sem contratos na base: lista vazia", faturadoVersusContratado(contexto({ titulos }), AGOSTO), []);
}

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
