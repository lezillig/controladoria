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

type Baixa = ContextoAuditoria["baixas"][number];
const baixa = (tituloId: string, valorCents: number, p: Partial<Baixa> = {}): Baixa =>
  ({
    id: `b${++seq}`,
    companyId: "c",
    tituloId,
    dataBaixa: d("2026-08-10"),
    valorCents,
    jurosCents: 0,
    multaCents: 0,
    descontoCents: 0,
    tarifaCents: 0,
    contaCorrenteCodigo: "100",
    ...p,
  }) as Baixa;

function contexto(p: { titulos?: Titulo[]; baixas?: Baixa[]; parceiros?: Parceiro[]; motoristas?: Motorista[] }): ContextoAuditoria {
  return {
    companyId: "c",
    conexaoId: null,
    dataReferencia: HOJE,
    agora: HOJE,
    janelaDesde: d("2026-01-01"),
    titulos: p.titulos ?? [],
    baixas: p.baixas ?? [],
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
  // (9.876,55 e não 9.900: 1,00% a menos é alíquota de CSLL, e seria lido
  // como retenção — ver CR-RETENCAO-PRESUMIDA abaixo.)
  const t = titulo({ natureza: "RECEBER", valorDocumentoCents: 10_000_00, valorPagoCents: 9_876_55 });
  const a = auditarContasReceber(contexto({ titulos: [t] })).filter((x) => x.regra === "CR-RECEBIDO-MENOR");
  conferir("sem retenção, diferença real: aponta", a.map((x) => x.valorCents), [123_45]);
}

// --------------------------------------------------- CR-RETENCAO-PRESUMIDA
console.log("\nCR-RETENCAO-PRESUMIDA — percentual fixo por cliente é imposto, não perda");
const receber = (titulos: Titulo[]) =>
  auditarContasReceber(contexto({ titulos })).filter((x) => x.regra === "CR-RECEBIDO-MENOR" || x.regra === "CR-RETENCAO-PRESUMIDA");
{
  // Os cinco títulos reais da Secretaria da Educação: valores diferentes,
  // TODOS com exatamente 7,70% a menos, sem retenção registrada na Omie.
  const casos: [number, number][] = [
    [838_581_95, 774_011_15],
    [583_572_21, 538_637_16],
    [248_490_57, 229_356_80],
    [120_142_55, 110_891_58],
  ];
  const titulos = casos.map(([doc, pago], i) =>
    titulo({ natureza: "RECEBER", parceiroNome: "SECRETARIA DA EDUCACAO", parceiroDocumento: "46000000000100", numeroDocumento: `1${i}`, valorDocumentoCents: doc, valorPagoCents: pago })
  );
  const a = receber(titulos);
  const retencao = a.filter((x) => x.regra === "CR-RETENCAO-PRESUMIDA");
  conferir("um achado de retenção para o cliente", retencao.length, 1);
  conferir("nenhum recebido a menor sobra", a.filter((x) => x.regra === "CR-RECEBIDO-MENOR").length, 0);
  conferir("alíquota identificada", (retencao[0]?.evidencia as { aliquota: string }).aliquota, "7,70%");
  conferir("total retido = soma das faltas", retencao[0]?.valorCents, 64_570_80 + 44_935_05 + 19_133_77 + 9_250_97);
  conferir("é ESTADO e baixo", [retencao[0]?.tipo, retencao[0]?.severidade], ["ESTADO", "BAIXA"]);
  conferir("chave por cliente e alíquota", retencao[0]?.chave, "CR-RETENCAO-PRESUMIDA|doc:46000000000100|770");
}
{
  // Um título só, percentual desconhecido (7,70% não está na lista): sem
  // segundo título para confirmar o padrão, continua sendo recebido a menor —
  // com o percentual na evidência para quem for conferir.
  const t = titulo({ natureza: "RECEBER", parceiroNome: "CLIENTE X", valorDocumentoCents: 838_581_95, valorPagoCents: 774_011_15 });
  const a = receber([t]);
  conferir("título único com percentual não catalogado: recebido a menor", a.map((x) => x.regra), ["CR-RECEBIDO-MENOR"]);
  conferir("evidência traz o percentual", (a[0]?.evidencia as { percentualDaFalta: string }).percentualDaFalta, "7,70%");
}
{
  // Um título só a 8,30% (não catalogado), mas OUTRO cliente da base tem
  // retenção REGISTRADA de 8,30%: a base ensinou a alíquota — é retenção.
  const comRetencao = titulo({
    natureza: "RECEBER", parceiroNome: "PIONEIRAS", parceiroCodigo: "P", valorDocumentoCents: 37_380_00, valorPagoCents: 34_277_46,
    retencaoIrCents: 3_102_54,
  });
  const unico = titulo({ natureza: "RECEBER", parceiroNome: "ENFORCE", parceiroCodigo: "E", valorDocumentoCents: 66_100_00, valorPagoCents: 60_613_70 });
  const a = receber([comRetencao, unico]);
  conferir("alíquota aprendida de retenção registrada: retenção presumida", a.map((x) => x.regra), ["CR-RETENCAO-PRESUMIDA"]);
}
{
  // Um título só a 10,70%, e outro cliente com cluster de 10,70%: também.
  const cluster = [1, 2].map((i) =>
    titulo({ natureza: "RECEBER", parceiroNome: "DIREITOS HUMANOS", parceiroCodigo: "D", numeroDocumento: `d${i}`, valorDocumentoCents: 365_192_66, valorPagoCents: 326_117_05 })
  );
  const unico = titulo({ natureza: "RECEBER", parceiroNome: "SEC MUNICIPAL", parceiroCodigo: "S", valorDocumentoCents: 113_560_00, valorPagoCents: 101_409_08 });
  const a = receber([...cluster, unico]);
  conferir("alíquota aprendida de cluster alheio: dois achados de retenção", a.map((x) => x.regra), ["CR-RETENCAO-PRESUMIDA", "CR-RETENCAO-PRESUMIDA"]);
}
{
  // Pagamento parcial registrado como quitado (38% a menos) e o caso em que
  // o recebido é igual ao desconto (98% a menos): perda de verdade, aponta.
  const a = receber([
    titulo({ natureza: "RECEBER", parceiroNome: "HOLDING", parceiroCodigo: "H", valorDocumentoCents: 568_049_45, valorPagoCents: 350_000_00 }),
    titulo({ natureza: "RECEBER", parceiroNome: "ASSOCIACAO", parceiroCodigo: "A2", valorDocumentoCents: 37_380_00, valorPagoCents: 429_60, descontoCents: 429_60, retencaoIssCents: 3_102_54 }),
  ]);
  conferir("diferenças grandes continuam recebido a menor", a.map((x) => x.regra), ["CR-RECEBIDO-MENOR", "CR-RECEBIDO-MENOR"]);
}
{
  // Um título só, mas com alíquota conhecida (PCC 4,65%): é retenção.
  const t = titulo({ natureza: "RECEBER", parceiroNome: "EMPRESA GRANDE", valorDocumentoCents: 100_000_00, valorPagoCents: 95_350_00 });
  conferir("título único com alíquota conhecida: retenção", receber([t]).map((x) => x.regra), ["CR-RETENCAO-PRESUMIDA"]);
}
{
  // Dois títulos do mesmo cliente com percentuais DIFERENTES e fora da lista:
  // não há padrão — os dois são recebido a menor.
  const a = receber([
    titulo({ natureza: "RECEBER", parceiroNome: "AVULSO", parceiroCodigo: "A", valorDocumentoCents: 10_000_00, valorPagoCents: 9_123_45 }),
    titulo({ natureza: "RECEBER", parceiroNome: "AVULSO", parceiroCodigo: "A", valorDocumentoCents: 10_000_00, valorPagoCents: 8_765_43 }),
  ]);
  conferir("sem padrão: dois recebidos a menor", a.map((x) => x.regra), ["CR-RECEBIDO-MENOR", "CR-RECEBIDO-MENOR"]);
}
{
  // Glosa de 30%: acima do teto de retenção, é perda e precisa aparecer —
  // mesmo repetida em dois títulos.
  const a = receber([
    titulo({ natureza: "RECEBER", parceiroNome: "GLOSA", parceiroCodigo: "G", valorDocumentoCents: 10_000_00, valorPagoCents: 7_000_00 }),
    titulo({ natureza: "RECEBER", parceiroNome: "GLOSA", parceiroCodigo: "G", valorDocumentoCents: 20_000_00, valorPagoCents: 14_000_00 }),
  ]);
  conferir("30% a menos não é retenção", a.map((x) => x.regra), ["CR-RECEBIDO-MENOR", "CR-RECEBIDO-MENOR"]);
}

// ---------------------------------------------------------- CP-PAGO-ACIMA
console.log("\nCP-PAGO-ACIMA — excedente igual ao desconto é forma de registro");
const pagoAcima = (titulos: Titulo[]) => auditarContasPagar(contexto({ titulos })).filter((x) => x.regra === "CP-PAGO-ACIMA");
{
  // O caso real: documento, desconto e pago iguais.
  const t = titulo({ valorDocumentoCents: 49_379_54, descontoCents: 49_379_54, valorPagoCents: 49_379_54 });
  conferir("desconto = documento = pago: sem achado", pagoAcima([t]).length, 0);
}
{
  // Desconto parcial não aplicado no pagamento: também é registro (pagou o
  // documento cheio), não dinheiro a mais.
  const t = titulo({ valorDocumentoCents: 1_000_00, descontoCents: 100_00, valorPagoCents: 1_000_00 });
  conferir("pagou o documento ignorando o desconto: sem achado", pagoAcima([t]).length, 0);
}
{
  // Pagou acima do documento sem desconto nenhum: continua apontando.
  const t = titulo({ valorDocumentoCents: 1_000_00, valorPagoCents: 1_200_00 });
  const a = pagoAcima([t]);
  conferir("pago acima sem desconto: aponta", a.map((x) => x.valorCents), [200_00]);
  const ev = a[0]?.evidencia as { devido: number; excedente: number };
  conferir("evidência traz devido e excedente", [ev.devido, ev.excedente], [1_000_00, 200_00]);
}
{
  // Desconto de 100, pagou 1.200 por um documento de 1.000: o que passa do
  // documento é 200 — o desconto não entra na conta.
  const t = titulo({ valorDocumentoCents: 1_000_00, descontoCents: 100_00, valorPagoCents: 1_200_00 });
  conferir("acima do documento com desconto: aponta só o que passa", pagoAcima([t]).map((x) => x.valorCents), [200_00]);
}
{
  // O segundo caso real: pago = documento, com multa e desconto registrados.
  const t = titulo({ valorDocumentoCents: 1_248_77, descontoCents: 339_30, multaCents: 12_49, valorPagoCents: 1_248_77 });
  conferir("pago = documento, desconto e multa no registro: sem achado", pagoAcima([t]).length, 0);
}

// ----------------------------------------------------- CP-DIVERGENCIA-BAIXA
console.log("\nCP-DIVERGENCIA-BAIXA — bruto de um lado, líquido do outro, não é divergência");
const divergencia = (titulos: Titulo[], baixas: Baixa[]) =>
  auditarContasPagar(contexto({ titulos, baixas })).filter((x) => x.regra === "CP-DIVERGENCIA-BAIXA");
{
  // Título pago com juros: resumo diz 1.100 pagos, a baixa diz 1.000 + 100 de juros.
  const t = titulo({ id: "T1", valorDocumentoCents: 1_000_00, valorPagoCents: 1_100_00, jurosCents: 100_00 });
  conferir("diferença = juros do título: sem achado", divergencia([t], [baixa("T1", 1_000_00)]).length, 0);
}
{
  // Encargo registrado só na baixa.
  const t = titulo({ id: "T2", valorDocumentoCents: 1_000_00, valorPagoCents: 1_100_00 });
  conferir("diferença = juros da baixa: sem achado", divergencia([t], [baixa("T2", 1_000_00, { jurosCents: 100_00 })]).length, 0);
}
{
  // O caso real: duas baixas somam 41.960,30 e o título diz 55.620,43, sem
  // encargo que explique — aponta, e a evidência lista as baixas.
  const t = titulo({ id: "T3", valorDocumentoCents: 55_620_43, valorPagoCents: 55_620_43 });
  const a = divergencia([t], [baixa("T3", 20_980_15), baixa("T3", 20_980_15)]);
  conferir("diferença sem explicação: aponta", a.map((x) => x.valorCents), [13_660_13]);
  conferir("evidência lista as baixas espelhadas", (a[0]?.evidencia as { baixasEspelhadas: unknown[] }).baixasEspelhadas.length, 2);
  conferir("descrição diz que falta baixa", a[0]?.descricao.includes("Falta baixa"), true);
}

// ----------------------------------------------- CP-DUPLICIDADE (continuação)
console.log("\nCP-DUPLICIDADE — documento de enfeite e instituição financeira");
const rodarPagar = (titulos: Titulo[]) => auditarContasPagar(contexto({ titulos })).filter((x) => x.regra === "CP-DUPLICIDADE");
{
  // O caso real: quatro parcelas do Banco RCI com documento "QUITADO".
  const grupo = [1, 2, 3, 4].map(() =>
    titulo({ parceiroNome: "BANCO RCI BRASIL S.A", valorDocumentoCents: 101_477_45, numeroDocumento: "QUITADO", dataVencimento: d("2026-02-17") })
  );
  const a = rodarPagar(grupo);
  conferir("\"QUITADO\" não conta como documento: aponta", a.length, 1);
  conferir("banco: informativo, não perda a gritar", a[0]?.severidade, "INFO");
  conferir("descrição explica a leitura provável", a[0]?.descricao.includes("contratos"), true);
}
{
  // O caso real: três licenciamentos do DETRAN com documento "Toyota Corolla".
  const grupo = [1, 2, 3].map(() =>
    titulo({ parceiroNome: "DEPARTAMENTO ESTADUAL DE TRANSITO", valorDocumentoCents: 5_069_99, numeroDocumento: "Toyota Corolla", dataVencimento: d("2026-05-05") })
  );
  const a = rodarPagar(grupo);
  conferir("\"Toyota Corolla\" não é número de documento: aponta", a.length, 1);
  conferir("DETRAN cobra por veículo: informativo", a[0]?.severidade, "INFO");
  conferir("descrição não diz 'mesmo número de documento'", a[0]?.descricao.includes("mesmo número de documento"), false);
}
{
  // O caso real do Bradesco Consórcios: o MESMO contrato, mesma parcela,
  // duas vezes. Banco não torna isso informativo.
  const par = [1, 2].map(() =>
    titulo({ parceiroNome: "BRADESCO ADMINISTRADORA DE CONSORCIOS LTDA.", valorDocumentoCents: 838_25, numeroDocumento: "CTO 0704830809", numeroParcela: "015/055", dataVencimento: d("2026-09-09") })
  );
  const a = rodarPagar(par);
  conferir("mesmo contrato duas vezes no consórcio: aponta", a.length, 1);
  conferir("sem rebaixar para informativo", a[0]?.severidade !== "INFO", true);
}
{
  // O caso real da MCZ: seis previsões de R$ 50.000 no mesmo dia, documento
  // "PREVISÃO", em aberto. Não é duplicidade — é previsão no contas a pagar.
  const grupo = [1, 2, 3, 4, 5, 6].map(() =>
    titulo({ conexaoApelido: "MCZ", parceiroNome: "MCZ TRANSPORTE E TURISMO LTDA", valorDocumentoCents: 50_000_00, numeroDocumento: "PREVISÃO",
      numeroParcela: "012/013", dataVencimento: d("2026-05-28"), liquidado: false, status: "A VENCER", valorPagoCents: 0, saldoCents: 50_000_00 })
  );
  const todos = auditarContasPagar(contexto({ titulos: grupo }));
  conferir("previsão não é duplicidade", todos.filter((x) => x.regra === "CP-DUPLICIDADE").length, 0);
  const previsao = todos.filter((x) => x.regra === "CP-PREVISAO");
  conferir("um achado de previsão por empresa", previsao.length, 1);
  conferir("com o total em aberto", previsao[0]?.valorCents, 300_000_00);
  conferir("informativo", previsao[0]?.severidade, "INFO");
}
{
  // Mesmo padrão num fornecedor comum: severidade normal.
  const grupo = [1, 2].map(() =>
    titulo({ parceiroNome: "OFICINA DO ZE", valorDocumentoCents: 5_000_00, numeroDocumento: "PAGO", dataVencimento: d("2026-02-17") })
  );
  const a = rodarPagar(grupo);
  conferir("fornecedor comum com documento de enfeite: aponta", a.length, 1);
  conferir("sem rebaixar", a[0]?.severidade !== "INFO", true);
}

// --------------------------------------------------------- CP-DUPLICIDADE
console.log("\nCP-DUPLICIDADE — documentos distintos não são duplicidade");
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
  ({
    id: "p1", conexaoId: "x", conexaoApelido: "AZUL", codigoOmie: "F9", nome: "JOAO MOTORISTA ME",
    documento: "12345678900", inativo: false, ...over,
  }) as unknown as Parceiro;
const fornecedorFuncionario = (p: Parameters<typeof contexto>[0]) =>
  auditarFraude(contexto(p)).filter((x) => x.regra === "FR-FORNECEDOR-FUNCIONARIO");
{
  const a = fornecedorFuncionario({ parceiros: [parceiro()], motoristas: [motorista] });
  conferir("cadastro sem título: silêncio", a.length, 0);
}
{
  const t = titulo({ parceiroCodigo: "F9", parceiroNome: "JOAO MOTORISTA ME", valorDocumentoCents: 2_000_00, categoriaCodigo: "2.01", categoriaDescricao: "Serviços de terceiros" });
  const a = fornecedorFuncionario({ titulos: [t], parceiros: [parceiro()], motoristas: [motorista] });
  conferir("com título em categoria de fornecedor: aponta", a.length, 1);
  conferir("com o valor pago", a[0]?.valorCents, 2_000_00);
  conferir("como fraude, não informativo", [a[0]?.categoria, a[0]?.severidade !== "INFO"], ["FRAUDE", true]);
}
{
  // Três motoristas recebendo diária: UM achado informativo, com os três na
  // evidência — não três achados de conflito de interesse.
  const motoristas = [1, 2, 3].map((i) => ({ id: `m${i}`, name: `MOTORISTA ${i}`, cpf: `0000000000${i}`, active: true }) as unknown as Motorista);
  const parceiros = [1, 2, 3].map((i) => parceiro({ id: `p${i}`, codigoOmie: `F${i}`, nome: `MOTORISTA ${i}`, documento: `0000000000${i}` } as Partial<Parceiro>));
  const titulos = [1, 2, 3].map((i) =>
    titulo({ parceiroCodigo: `F${i}`, parceiroNome: `MOTORISTA ${i}`, valorDocumentoCents: 300_00, categoriaCodigo: "2.05", categoriaDescricao: "Diárias de viagem" })
  );
  const a = fornecedorFuncionario({ titulos, parceiros, motoristas });
  conferir("diária de três motoristas: um achado", a.length, 1);
  conferir("informativo", a[0]?.severidade, "INFO");
  conferir("os três na evidência", (a[0]?.evidencia as { funcionarios: unknown[] }).funcionarios.length, 3);
  conferir("chave por empresa e categoria", a[0]?.chave, "FR-FORNECEDOR-FUNCIONARIO|AZUL|2.05");
}
{
  // R$ 10,00 em "Serviços Gráficos": reembolso, informativo.
  const t = titulo({ parceiroCodigo: "F9", parceiroNome: "JOAO MOTORISTA ME", valorDocumentoCents: 10_00, categoriaCodigo: "2.02.92", categoriaDescricao: "Serviços Gráficos" });
  const a = fornecedorFuncionario({ titulos: [t], parceiros: [parceiro()], motoristas: [motorista] });
  conferir("título pequeno em categoria de fornecedor: informativo", [a[0]?.severidade, a[0]?.categoria], ["INFO", "ERRO_PROCESSO"]);
  conferir("descrição diz reembolso", a[0]?.descricao.includes("reembolso"), true);
}
{
  // Rescisão paga a quem ainda consta ativo: sobe de informativo para médio.
  const motoristas = [1, 2].map((i) => ({ id: `m${i}`, name: `MOTORISTA ${i}`, cpf: `0000000000${i}`, active: i === 1 }) as unknown as Motorista);
  const parceiros = [1, 2].map((i) => parceiro({ id: `p${i}`, codigoOmie: `F${i}`, nome: `MOTORISTA ${i}`, documento: `0000000000${i}` } as Partial<Parceiro>));
  const titulos = [1, 2].map((i) =>
    titulo({ parceiroCodigo: `F${i}`, parceiroNome: `MOTORISTA ${i}`, valorDocumentoCents: 5_000_00, categoriaCodigo: "2.03.04", categoriaDescricao: "Rescisão Trabalhista" })
  );
  const a = fornecedorFuncionario({ titulos, parceiros, motoristas });
  conferir("rescisão com um ativo: médio", a[0]?.severidade, "MEDIA");
  conferir("evidência conta os ativos com rescisão", (a[0]?.evidencia as { rescisaoComCadastroAtivo: number }).rescisaoComCadastroAtivo, 1);
  conferir("descrição alerta", a[0]?.descricao.includes("ATENÇÃO"), true);
}
{
  // Título de OUTRA conexão com o mesmo código de parceiro não conta.
  const t = titulo({ conexaoId: "y", conexaoApelido: "MCZ", parceiroCodigo: "F9", valorDocumentoCents: 2_000_00 });
  conferir("código igual em outra conta: silêncio", fornecedorFuncionario({ titulos: [t], parceiros: [parceiro()], motoristas: [motorista] }).length, 0);
}

// ---------------------------------------------- FR-CADASTRO-DUPLICADO / NOME
console.log("\nFR-CADASTRO-DUPLICADO — só dentro da mesma conta Omie");
const cadastros = (parceiros: Parceiro[]) =>
  auditarFraude(contexto({ parceiros })).filter((x) => x.regra === "FR-CADASTRO-DUPLICADO" || x.regra === "FR-CADASTRO-NOME-SIMILAR");
{
  // O mesmo fornecedor na Azul e na MCZ: cada empresa tem o seu cadastro.
  const a = cadastros([
    parceiro({ id: "a", conexaoId: "x", conexaoApelido: "AZUL", codigoOmie: "1", nome: "POSTO ALFA LTDA", documento: "11222333000181" } as Partial<Parceiro>),
    parceiro({ id: "b", conexaoId: "y", conexaoApelido: "MCZ", codigoOmie: "7", nome: "POSTO ALFA LTDA", documento: "11222333000181" } as Partial<Parceiro>),
  ]);
  conferir("mesmo documento em contas diferentes: silêncio", a.length, 0);
}
{
  // Duas vezes na MESMA conta: duplicado de verdade.
  const a = cadastros([
    parceiro({ id: "a", codigoOmie: "1", nome: "POSTO ALFA LTDA", documento: "11222333000181" } as Partial<Parceiro>),
    parceiro({ id: "b", codigoOmie: "2", nome: "POSTO ALFA", documento: "11222333000181" } as Partial<Parceiro>),
  ]);
  conferir("mesmo documento na mesma conta: aponta", a.map((x) => x.regra), ["FR-CADASTRO-DUPLICADO"]);
  conferir("chave leva a empresa", a[0]?.chave, "FR-CADASTRO-DUPLICADO|AZUL|11222333000181");
}
{
  // Nome igual, documentos diferentes, em contas diferentes: silêncio.
  const a = cadastros([
    parceiro({ id: "a", conexaoId: "x", conexaoApelido: "AZUL", codigoOmie: "1", nome: "OFICINA MECANICA BETA LTDA", documento: "11222333000181" } as Partial<Parceiro>),
    parceiro({ id: "b", conexaoId: "y", conexaoApelido: "MCZ", codigoOmie: "7", nome: "OFICINA MECANICA BETA LTDA", documento: "99888777000155" } as Partial<Parceiro>),
  ]);
  conferir("nome igual em contas diferentes: silêncio", a.length, 0);
}
{
  const a = cadastros([
    parceiro({ id: "a", codigoOmie: "1", nome: "OFICINA MECANICA BETA LTDA", documento: "11222333000181" } as Partial<Parceiro>),
    parceiro({ id: "b", codigoOmie: "2", nome: "OFICINA MECANICA BETA LTDA.", documento: "99888777000155" } as Partial<Parceiro>),
  ]);
  conferir("nome igual na mesma conta com documentos diferentes: aponta", a.map((x) => x.regra), ["FR-CADASTRO-NOME-SIMILAR"]);
}
{
  // Homônimos: dois CPFs, o mesmo nome, duas pessoas.
  const a = cadastros([
    parceiro({ id: "a", codigoOmie: "1", nome: "JOSE DA SILVA", documento: "12345678909" } as Partial<Parceiro>),
    parceiro({ id: "b", codigoOmie: "2", nome: "JOSE DA SILVA", documento: "98765432100" } as Partial<Parceiro>),
  ]);
  conferir("dois CPFs com o mesmo nome: silêncio", a.length, 0);
}
{
  // Matriz e filial: mesma raiz de CNPJ.
  const a = cadastros([
    parceiro({ id: "a", codigoOmie: "1", nome: "AUTO POSTO GAMA LTDA", documento: "11222333000181" } as Partial<Parceiro>),
    parceiro({ id: "b", codigoOmie: "2", nome: "AUTO POSTO GAMA LTDA", documento: "11222333000262" } as Partial<Parceiro>),
  ]);
  conferir("matriz e filial: silêncio", a.length, 0);
}

console.log(falhas === 0 ? "\nTodos os testes passaram.\n" : `\n${falhas} FALHA(S).\n`);
process.exit(falhas === 0 ? 0 : 1);
