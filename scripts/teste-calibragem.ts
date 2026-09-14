// TESTES DE CALIBRAGEM — `npm run teste:calibragem`.
//
// Três regras respondiam por 60% dos achados em aberto (766 + 850 + 348 de
// 2.977), e quase todos eram legítimos: retenção na fonte lida como
// recebimento a menor, cotas de consórcio lidas como duplicidade, motorista
// cadastrado como fornecedor sem nenhum pagamento. Estes testes fixam o que
// cada regra passou a aceitar como normal — e o que continua apontando.
import { auditarContasPagar } from "../src/lib/controladoria/agents/contasPagar";
import { auditarContasReceber } from "../src/lib/controladoria/agents/contasReceber";
import { auditarFraude } from "../src/lib/controladoria/agents/antifraude";
import type { ContextoAuditoria } from "../src/lib/controladoria/types";

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(
    `${ok ? "  ok  " : "FALHA "} ${nome}${ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         obtido   ${JSON.stringify(real)}`}`
  );
}

const HOJE = new Date("2026-09-12");
const d = (iso: string) => new Date(iso);

type Titulo = ContextoAuditoria["titulos"][number];
type Parceiro = ContextoAuditoria["parceiros"][number];
type Motorista = ContextoAuditoria["motoristas"][number];

let seq = 0;
const titulo = (p: Partial<Titulo> = {}): Titulo =>
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
    contaCorrenteCodigo: "100",
    numeroDocumento: null,
    numeroParcela: null,
    tipoDocumento: null,
    dataEmissao: d("2026-08-01"),
    dataVencimento: d("2026-08-10"),
    valorDocumentoCents: 1_000_00,
    valorPagoCents: 1_000_00,
    saldoCents: 0,
    jurosCents: 0,
    multaCents: 0,
    descontoCents: 0,
    tarifaCents: 0,
    retencaoIrCents: 0,
    retencaoIssCents: 0,
    retencaoPisCents: 0,
    retencaoCofinsCents: 0,
    retencaoCsllCents: 0,
    retencaoInssCents: 0,
    ...p,
  }) as Titulo;

function contexto(p: { titulos?: Titulo[]; parceiros?: Parceiro[]; motoristas?: Motorista[] }): ContextoAuditoria {
  return {
    companyId: "c",
    conexaoId: null,
    dataReferencia: HOJE,
    agora: HOJE,
    janelaDesde: d("2026-01-01"),
    titulos: p.titulos ?? [],
    baixas: [],
    contasCorrentes: [],
    config: { limiteAlcadaCents: 100_000_000_00, diasAtrasoCritico: 30, limiteConcentracaoFornecedorPercent: 90 },
    motoristas: p.motoristas ?? [],
    parceiros: p.parceiros ?? [],
    projetos: [],
    movimentos: [],
    notas: [],
    categorias: [],
    departamentos: [],
    vinculos: [],
    clientes: [],
    veiculos: [],
    abastecimentos: [],
    gestao: { disponivel: false },
    conformidade: { apontamentos: [], vinculos: [], documentos: [] },
    ultimoSyncConcluido: null,
  } as unknown as ContextoAuditoria;
}

// ------------------------------------------------------- CR-RECEBIDO-MENOR
console.log("\nCR-RECEBIDO-MENOR — retenção na fonte não é perda");
{
  // Prefeitura: documento 10.000, reteve 500 de ISS e 150 de IR, pagou 9.350.
  const t = titulo({
    natureza: "RECEBER", parceiroNome: "PREFEITURA", valorDocumentoCents: 10_000_00, valorPagoCents: 9_350_00,
    retencaoIssCents: 500_00, retencaoIrCents: 150_00,
  });
  const a = auditarContasReceber(contexto({ titulos: [t] })).filter((x) => x.regra === "CR-RECEBIDO-MENOR");
  conferir("recebido = documento − retenções: sem achado", a.length, 0);
}
{
  // Mesma retenção, mas entrou 9.000: faltam 350 de verdade.
  const t = titulo({
    natureza: "RECEBER", parceiroNome: "PREFEITURA", valorDocumentoCents: 10_000_00, valorPagoCents: 9_000_00,
    retencaoIssCents: 500_00, retencaoIrCents: 150_00,
  });
  const a = auditarContasReceber(contexto({ titulos: [t] })).filter((x) => x.regra === "CR-RECEBIDO-MENOR");
  conferir("faltou além da retenção: aponta", a.length, 1);
  conferir("o valor apontado é só o que falta", a[0]?.valorCents, 350_00);
  conferir("evidência mostra as retenções", (a[0]?.evidencia as { retencoes: number }).retencoes, 650_00);
}
{
  // Sem retenção, recebeu menos: continua apontando como antes.
  const t = titulo({ natureza: "RECEBER", valorDocumentoCents: 10_000_00, valorPagoCents: 9_900_00 });
  const a = auditarContasReceber(contexto({ titulos: [t] })).filter((x) => x.regra === "CR-RECEBIDO-MENOR");
  conferir("sem retenção, diferença real: aponta", a.map((x) => x.valorCents), [100_00]);
}

// --------------------------------------------------------- CP-DUPLICIDADE
console.log("\nCP-DUPLICIDADE — documentos distintos não são duplicidade");
const rodarPagar = (titulos: Titulo[]) => auditarContasPagar(contexto({ titulos })).filter((x) => x.regra === "CP-DUPLICIDADE");
{
  // Três cotas de consórcio, cada uma com seu documento, mesmo valor, mesmo dia.
  const cotas = ["10408-0454", "10423-0319", "10429-0322"].map((doc) =>
    titulo({ parceiroNome: "CONSORCIO", valorDocumentoCents: 815_16, numeroDocumento: doc, dataVencimento: d("2026-09-10") })
  );
  conferir("cotas com documentos distintos: sem achado", rodarPagar(cotas).length, 0);
}
{
  // O caso do print: o MESMO documento duas vezes.
  const par = [1, 2].map(() =>
    titulo({ parceiroNome: "CONSORCIO", valorDocumentoCents: 815_16, numeroDocumento: "10408-0454", dataVencimento: d("2026-09-10") })
  );
  const a = rodarPagar(par);
  conferir("mesmo documento repetido: aponta", a.length, 1);
  conferir("exposição = um dos dois", a[0]?.valorCents, 815_16);
}
{
  // Sem número de documento nenhum: continua suspeito.
  const semDoc = [1, 2].map(() => titulo({ parceiroNome: "AVULSO", valorDocumentoCents: 500_00, dataVencimento: d("2026-09-10") }));
  conferir("sem documento: aponta", rodarPagar(semDoc).length, 1);
}
{
  // Um com documento e outro sem: não são "todos distintos" — aponta.
  const misto = [
    titulo({ parceiroNome: "MISTO", valorDocumentoCents: 500_00, numeroDocumento: "A1", dataVencimento: d("2026-09-10") }),
    titulo({ parceiroNome: "MISTO", valorDocumentoCents: 500_00, numeroDocumento: null, dataVencimento: d("2026-09-10") }),
  ];
  conferir("documento ausente num deles: aponta", rodarPagar(misto).length, 1);
}

// ------------------------------------------------ FR-FORNECEDOR-FUNCIONARIO
console.log("\nFR-FORNECEDOR-FUNCIONARIO — só com dinheiro envolvido");
const motorista = { id: "m1", name: "JOAO MOTORISTA", cpf: "123.456.789-00", active: true } as unknown as Motorista;
const parceiro = (over: Partial<Parceiro> = {}) =>
  ({ id: "p1", codigoOmie: "F9", nome: "JOAO MOTORISTA ME", documento: "12345678900", inativo: false, ...over }) as unknown as Parceiro;
{
  const a = auditarFraude(contexto({ parceiros: [parceiro()], motoristas: [motorista] })).filter((x) => x.regra === "FR-FORNECEDOR-FUNCIONARIO");
  conferir("cadastro sem título: silêncio", a.length, 0);
}
{
  const t = titulo({ parceiroCodigo: "F9", parceiroNome: "JOAO MOTORISTA ME", valorDocumentoCents: 2_000_00 });
  const a = auditarFraude(contexto({ titulos: [t], parceiros: [parceiro()], motoristas: [motorista] })).filter((x) => x.regra === "FR-FORNECEDOR-FUNCIONARIO");
  conferir("com título pago: aponta", a.length, 1);
  conferir("com o valor pago", a[0]?.valorCents, 2_000_00);
}

console.log(falhas === 0 ? "\nTodos os testes passaram.\n" : `\n${falhas} FALHA(S).\n`);
process.exit(falhas === 0 ? 0 : 1);
