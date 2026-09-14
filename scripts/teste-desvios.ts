// TESTES DAS REGRAS DE DESVIO DE DINHEIRO — `npm run teste:desvios`.
//
// As regras aqui nasceram do estudo de fraude sobre esta base (ACFE, testes
// de vendor master, ISA 240): conta bancária dividida entre fornecedores,
// nota paga duas vezes com valor diferente, cadastro criado e pago na mesma
// semana, valor sempre redondo, numeração de nota exclusiva, entrada no banco
// sem título, atraso recebido sem juros, fornecedor dormente que acorda.
//
// Cada regra tem o caso que precisa apontar e o caso legítimo que precisa
// deixar em paz. Sem banco: contexto montado à mão.
import { auditarFraude } from "../src/lib/controladoria/agents/antifraude";
import { numeroDaNota } from "../src/lib/controladoria/agents/antifraudeFornecedor";
import { agenteConciliacao } from "../src/lib/controladoria/agents/conciliacao";
import { auditarContasReceber } from "../src/lib/controladoria/agents/contasReceber";
import { fornecedorDormente, reajusteVencido } from "../src/lib/controladoria/agents/padroes";
import { testeBenfordNigrini } from "../src/lib/controladoria/agents/antifraudeEstatistica";
import { tipoDeTomador } from "../src/lib/controladoria/agents/contasReceberRetencao";
import type { SerieMensal } from "../src/lib/controladoria/historico";
import type { ContextoAuditoria } from "../src/lib/controladoria/types";

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(
    `${ok ? "  ok  " : "FALHA "} ${nome}` +
      (ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         obtido   ${JSON.stringify(real)}`)
  );
}

const HOJE = new Date("2026-08-25");
const d = (iso: string) => new Date(iso);

type Titulo = ContextoAuditoria["titulos"][number];
type Parceiro = ContextoAuditoria["parceiros"][number];
type Movimento = ContextoAuditoria["movimentos"][number];
type Baixa = ContextoAuditoria["baixas"][number];

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
    status: "PAGO",
    parceiroNome: "OFICINA MECANICA BETA",
    parceiroDocumento: "12345678000199",
    parceiroCodigo: "P1",
    contaCorrenteCodigo: "100",
    numeroDocumento: null,
    numeroParcela: null,
    tipoDocumento: null,
    categoriaDescricao: "Manutenção de veículos",
    dataEmissao: d("2026-06-01"),
    dataVencimento: d("2026-06-10"),
    dataUltimaBaixa: d("2026-06-10"),
    valorDocumentoCents: 1_234_56,
    valorPagoCents: 1_234_56,
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

const parceiro = (p: Partial<Parceiro> = {}): Parceiro =>
  ({
    id: `p${++seq}`,
    companyId: "c",
    conexaoId: "x",
    conexaoApelido: "AZUL",
    codigoOmie: "P1",
    nome: "OFICINA MECANICA BETA",
    documento: "12345678000199",
    email: "contato@beta.com.br",
    cidade: "CAMPINAS",
    inativo: false,
    bloqueado: false,
    contaBancariaHash: null,
    contaBancariaAlteradaEm: null,
    dataCadastroOmie: d("2024-01-10"),
    primeiraVezEm: d("2024-01-10"),
    ...p,
  }) as Parceiro;

const movimento = (p: Partial<Movimento> & { valorCents: number }): Movimento =>
  ({
    id: `m${++seq}`,
    companyId: "c",
    conexaoId: "x",
    conexaoApelido: "AZUL",
    contaCorrenteCodigo: "100",
    codigoLancamento: `M${seq}`,
    data: d("2026-08-10"),
    conciliado: false,
    tituloCodigo: null,
    observacao: null,
    parceiroNome: null,
    tipo: null,
    documento: null,
    ...p,
  }) as Movimento;

const baixa = (p: Partial<Baixa> & { tituloId: string }): Baixa =>
  ({
    id: `b${++seq}`,
    companyId: "c",
    conexaoId: "x",
    dataBaixa: d("2026-08-10"),
    valorCents: 1_000_00,
    jurosCents: 0,
    multaCents: 0,
    descontoCents: 0,
    tarifaCents: 0,
    contaCorrenteCodigo: "100",
    liquidaTitulo: true,
    ...p,
  }) as Baixa;

function contexto(p: {
  titulos?: Titulo[];
  parceiros?: Parceiro[];
  movimentos?: Movimento[];
  baixas?: Baixa[];
  motoristas?: { id: string; name: string; cpf: string; active: boolean }[];
}): ContextoAuditoria {
  return {
    companyId: "c",
    conexaoId: null,
    dataReferencia: HOJE,
    agora: HOJE,
    janelaDesde: d("2026-01-01"),
    titulos: p.titulos ?? [],
    baixas: p.baixas ?? [],
    parceiros: p.parceiros ?? [],
    movimentos: p.movimentos ?? [],
    contasCorrentes: [],
    config: { limiteAlcadaCents: 100_000_000_00, saldoMinimoCents: 0 },
    motoristas: p.motoristas ?? [],
    notas: [],
    categorias: [],
    departamentos: [],
    projetos: [],
    vinculos: [],
    abastecimentos: [],
    veiculos: [],
    clientes: [],
    conexoes: [],
    gestao: { disponivel: true, erro: null },
  } as unknown as ContextoAuditoria;
}

// Cinquenta títulos "de fundo" com centavos, para a taxa de redondos da base
// ser baixa e a materialidade existir (R$ 500 de piso).
function fundo(): Titulo[] {
  return Array.from({ length: 50 }, (_, i) =>
    titulo({
      parceiroNome: `FORNECEDOR ${i}`,
      parceiroDocumento: `${String(10_000_000 + i).padStart(8, "0")}000100`,
      parceiroCodigo: `F${i}`,
      numeroDocumento: String(1000 + i * 7),
      valorDocumentoCents: 1_000_00 + i * 137,
      valorPagoCents: 1_000_00 + i * 137,
    })
  );
}

const rodarFraude = (ctx: ContextoAuditoria, regra: string) => auditarFraude(ctx).filter((a) => a.regra === regra);

// ------------------------------------------------------------ numeroDaNota
console.log("\nnumeroDaNota — o que conta como número de nota");
conferir("NF-e 000123 é 123", numeroDaNota("NF-e 000123"), "123");
conferir("123/1 é 123 (a parcela é outro campo)", numeroDaNota("123/1"), "1231");
conferir("'12' é referência curta, não nota", numeroDaNota("12"), null);
conferir("'QUITADO' não é nota", numeroDaNota("QUITADO"), null);

// ---------------------------------------------------- FR-CONTA-COMPARTILHADA
console.log("\nFR-CONTA-COMPARTILHADA — dois fornecedores, uma conta bancária");
{
  const hash = "abcdef0123456789abcdef";
  const a = parceiro({ codigoOmie: "P1", nome: "SERVICOS ALFA LTDA", documento: "11111111000111", contaBancariaHash: hash });
  const b = parceiro({ codigoOmie: "P2", nome: "CONSULTORIA GAMA LTDA", documento: "22222222000122", contaBancariaHash: hash });
  const ctx = contexto({
    parceiros: [a, b],
    titulos: [...fundo(), titulo({ parceiroCodigo: "P1", valorPagoCents: 20_000_00, valorDocumentoCents: 20_000_00 })],
  });
  const r = rodarFraude(ctx, "FR-CONTA-COMPARTILHADA");
  conferir("dois CNPJs com o mesmo hash bancário é achado", r.length, 1);
  conferir("com o pago aos dois", r[0]?.valorCents, 20_000_00);
  conferir("e a lista dos cadastros", (r[0]?.evidencia?.cadastros as unknown[]).length, 2);
}
{
  // Matriz e filial: mesma raiz de CNPJ, mesma conta — normal.
  const hash = "abcdef0123456789abcdef";
  const ctx = contexto({
    parceiros: [
      parceiro({ codigoOmie: "P1", documento: "11111111000111", contaBancariaHash: hash }),
      parceiro({ codigoOmie: "P2", documento: "11111111000202", contaBancariaHash: hash }),
    ],
    titulos: fundo(),
  });
  conferir("matriz e filial não são achado", rodarFraude(ctx, "FR-CONTA-COMPARTILHADA").length, 0);
}
{
  // O mesmo fornecedor nas duas contas Omie: mesmo CNPJ, mesmo hash — normal.
  const hash = "abcdef0123456789abcdef";
  const ctx = contexto({
    parceiros: [
      parceiro({ codigoOmie: "P1", conexaoId: "x", conexaoApelido: "AZUL", documento: "11111111000111", contaBancariaHash: hash }),
      parceiro({ codigoOmie: "P9", conexaoId: "y", conexaoApelido: "MCZ", documento: "11111111000111", contaBancariaHash: hash }),
    ],
    titulos: fundo(),
  });
  conferir("mesmo CNPJ nas duas empresas não é achado", rodarFraude(ctx, "FR-CONTA-COMPARTILHADA").length, 0);
}
{
  // Um dos cadastros é o CPF de alguém da folha: crítico.
  const hash = "abcdef0123456789abcdef";
  const ctx = contexto({
    parceiros: [
      parceiro({ codigoOmie: "P1", nome: "SERVICOS ALFA LTDA", documento: "11111111000111", contaBancariaHash: hash }),
      parceiro({ codigoOmie: "P2", nome: "JOAO DA SILVA", documento: "52998224725", contaBancariaHash: hash }),
    ],
    titulos: fundo(),
    motoristas: [{ id: "m1", name: "JOAO DA SILVA", cpf: "529.982.247-25", active: true }],
  });
  const r = rodarFraude(ctx, "FR-CONTA-COMPARTILHADA");
  conferir("conta dividida com CPF da folha é CRÍTICA", r[0]?.severidade, "CRITICA");
}

// ------------------------------------------------------------ FR-NF-REPETIDA
console.log("\nFR-NF-REPETIDA — a mesma nota, paga duas vezes com valor diferente");
{
  const primeira = titulo({ numeroDocumento: "4521", valorDocumentoCents: 3_200_00, valorPagoCents: 3_200_00, dataVencimento: d("2026-05-10"), dataUltimaBaixa: d("2026-05-10") });
  const segunda = titulo({ numeroDocumento: "NF 4521", valorDocumentoCents: 3_250_00, valorPagoCents: 3_250_00, dataVencimento: d("2026-06-15"), dataUltimaBaixa: d("2026-06-15") });
  const ctx = contexto({ titulos: [...fundo(), primeira, segunda] });
  const r = rodarFraude(ctx, "FR-NF-REPETIDA");
  conferir("nota relançada com valor corrigido, sem cancelar a anterior, é achado", r.length, 1);
  conferir("o excedente é o menor pagamento", r[0]?.valorCents, 3_200_00);
  conferir("a chave é fornecedor + nota", r[0]?.chave, "FR-NF-REPETIDA|doc:12345678000199|4521");
}
{
  // Mesma nota nas DUAS empresas.
  const azul = titulo({ numeroDocumento: "777", valorDocumentoCents: 5_000_00, valorPagoCents: 5_000_00, dataVencimento: d("2026-05-10") });
  const mcz = titulo({ numeroDocumento: "777", conexaoId: "y", conexaoApelido: "MCZ", parceiroCodigo: "Q1", valorDocumentoCents: 5_000_00, valorPagoCents: 5_000_00, dataVencimento: d("2026-06-10") });
  const ctx = contexto({ titulos: [...fundo(), azul, mcz] });
  const r = rodarFraude(ctx, "FR-NF-REPETIDA");
  conferir("mesma nota paga pela Azul e pela MCZ é achado", r.length, 1);
  conferir("o título diz as duas empresas", r[0]?.titulo.includes("AZUL e MCZ"), true);
}
{
  // Carnê: mesma nota, parcelas 1/3, 2/3, 3/3 — legítimo.
  const parcelas = [1, 2, 3].map((n) =>
    titulo({ numeroDocumento: "9001", numeroParcela: `${n}/3`, valorDocumentoCents: 800_00, valorPagoCents: 800_00, dataVencimento: d(`2026-0${3 + n}-10`) })
  );
  const ctx = contexto({ titulos: [...fundo(), ...parcelas] });
  conferir("parcelas da mesma nota não são repetição", rodarFraude(ctx, "FR-NF-REPETIDA").length, 0);
}
{
  // Valor e vencimento iguais: é CP-DUPLICIDADE, não esta regra.
  const a = titulo({ numeroDocumento: "555", valorDocumentoCents: 1_000_00, valorPagoCents: 1_000_00, dataVencimento: d("2026-06-10") });
  const b = titulo({ numeroDocumento: "555", valorDocumentoCents: 1_000_00, valorPagoCents: 1_000_00, dataVencimento: d("2026-06-10") });
  const ctx = contexto({ titulos: [...fundo(), a, b] });
  conferir("duplicidade exata fica com CP-DUPLICIDADE", rodarFraude(ctx, "FR-NF-REPETIDA").length, 0);
}
{
  // Banco que numera por contrato: "12345" todo mês é a parcela do
  // financiamento, não nota.
  const parcelas = [4, 5, 6].map((m) =>
    titulo({ parceiroNome: "BANCO BRADESCO S.A.", parceiroDocumento: "60746948000112", numeroDocumento: "12345", valorDocumentoCents: 2_000_00 + m, valorPagoCents: 2_000_00 + m, dataVencimento: d(`2026-0${m}-10`) })
  );
  const ctx = contexto({ titulos: [...fundo(), ...parcelas] });
  conferir("quem numera por contrato fica de fora", rodarFraude(ctx, "FR-NF-REPETIDA").length, 0);
}

// -------------------------------------------------------- FR-CADASTRO-E-PAGO
console.log("\nFR-CADASTRO-E-PAGO — cadastrado e pago na mesma semana");
{
  const novo = parceiro({ codigoOmie: "N1", nome: "ASSESSORIA RAPIDA LTDA", documento: "33333333000133", dataCadastroOmie: d("2026-07-01"), email: null, cidade: null });
  // R$ 1.200 contra materialidade de R$ 500 (piso): 2,4x = MÉDIA por valor.
  const pago = titulo({ parceiroCodigo: "N1", parceiroNome: "ASSESSORIA RAPIDA LTDA", parceiroDocumento: "33333333000133", categoriaDescricao: "Serviços de consultoria", dataUltimaBaixa: d("2026-07-02"), valorPagoCents: 1_200_00, valorDocumentoCents: 1_200_00 });
  const ctx = contexto({ parceiros: [novo], titulos: [...fundo(), pago] });
  const r = rodarFraude(ctx, "FR-CADASTRO-E-PAGO");
  conferir("cadastrado dia 1 e pago dia 2 é achado", r.length, 1);
  conferir("os sinais agravantes aparecem", (r[0]?.evidencia?.sinais as string[]).length, 3);
  conferir("dois ou mais sinais agravam a severidade (MÉDIA → ALTA)", r[0]?.severidade, "ALTA");
}
{
  const antigo = parceiro({ codigoOmie: "N1", dataCadastroOmie: d("2026-05-01") });
  const pago = titulo({ parceiroCodigo: "N1", dataUltimaBaixa: d("2026-07-02"), valorPagoCents: 8_000_00, valorDocumentoCents: 8_000_00 });
  const ctx = contexto({ parceiros: [antigo], titulos: [...fundo(), pago] });
  conferir("dois meses entre cadastro e pagamento não é achado", rodarFraude(ctx, "FR-CADASTRO-E-PAGO").length, 0);
}
{
  // Sem data de cadastro da Omie (só "primeira vez no espelho"): a regra se
  // cala, porque a carga histórica cria cadastro e título no mesmo instante.
  const semData = parceiro({ codigoOmie: "N1", dataCadastroOmie: null, primeiraVezEm: d("2026-07-01") });
  const pago = titulo({ parceiroCodigo: "N1", dataUltimaBaixa: d("2026-07-01"), valorPagoCents: 8_000_00, valorDocumentoCents: 8_000_00 });
  const ctx = contexto({ parceiros: [semData], titulos: [...fundo(), pago] });
  conferir("sem data real de cadastro, fica calada", rodarFraude(ctx, "FR-CADASTRO-E-PAGO").length, 0);
}

// ---------------------------------------------------------- FR-VALOR-REDONDO
console.log("\nFR-VALOR-REDONDO — o fornecedor que só cobra números redondos");
{
  const redondos = [1, 2, 3, 4, 5, 6].map((m) =>
    titulo({ parceiroNome: "SERVICOS GERAIS LTDA", parceiroDocumento: "44444444000144", parceiroCodigo: "R1", numeroDocumento: null, valorDocumentoCents: m * 500_00, valorPagoCents: m * 500_00, dataVencimento: d(`2026-0${m}-10`), categoriaDescricao: "Serviços diversos" })
  );
  const ctx = contexto({ titulos: [...fundo(), ...redondos] });
  const r = rodarFraude(ctx, "FR-VALOR-REDONDO");
  conferir("seis títulos redondos e sem nota é achado", r.length, 1);
  conferir("aponta o fornecedor", r[0]?.entidadeRef, "SERVICOS GERAIS LTDA");
}
{
  // Aluguel: redondo por natureza.
  const aluguel = [1, 2, 3, 4, 5, 6].map((m) =>
    titulo({ parceiroNome: "IMOBILIARIA CENTRO", parceiroDocumento: "55555555000155", parceiroCodigo: "A1", numeroDocumento: null, valorDocumentoCents: 3_000_00 + (m % 2) * 100_00, valorPagoCents: 3_000_00, dataVencimento: d(`2026-0${m}-10`), categoriaDescricao: "Aluguel da garagem" })
  );
  const ctx = contexto({ titulos: [...fundo(), ...aluguel] });
  conferir("aluguel redondo não é achado", rodarFraude(ctx, "FR-VALOR-REDONDO").length, 0);
}
{
  // Redondo mas COM nota fiscal em todos: o documento sustenta.
  const comNota = [1, 2, 3, 4, 5, 6].map((m) =>
    titulo({ parceiroNome: "SERVICOS GERAIS LTDA", parceiroDocumento: "44444444000144", parceiroCodigo: "R1", numeroDocumento: String(200 + m), valorDocumentoCents: m * 500_00, valorPagoCents: m * 500_00, dataVencimento: d(`2026-0${m}-10`), categoriaDescricao: "Serviços diversos" })
  );
  const ctx = contexto({ titulos: [...fundo(), ...comNota] });
  conferir("redondo com nota em todos não é achado", rodarFraude(ctx, "FR-VALOR-REDONDO").length, 0);
}

// -------------------------------------------------------- FR-NOTA-SEQUENCIAL
console.log("\nFR-NOTA-SEQUENCIAL — a numeração de nota que só anda conosco");
{
  const seguidas = [118, 119, 120, 121, 122].map((n, i) =>
    titulo({ parceiroNome: "CONSULTORIA EXCLUSIVA LTDA", parceiroDocumento: "66666666000166", parceiroCodigo: "S1", numeroDocumento: String(n), dataEmissao: d(`2026-0${2 + i}-05`), dataVencimento: d(`2026-0${2 + i}-15`), valorDocumentoCents: 4_000_00, valorPagoCents: 4_000_00, categoriaDescricao: "Serviços de consultoria" })
  );
  const ctx = contexto({ titulos: [...fundo(), ...seguidas] });
  const r = rodarFraude(ctx, "FR-NOTA-SEQUENCIAL");
  conferir("cinco notas seguidas em cinco meses é achado", r.length, 1);
  conferir("serviço acima da materialidade é MÉDIA", r[0]?.severidade, "MEDIA");
}
{
  const espacadas = [118, 140, 171, 205, 260].map((n, i) =>
    titulo({ parceiroNome: "GRAFICA MOVIMENTADA LTDA", parceiroDocumento: "77777777000177", parceiroCodigo: "G1", numeroDocumento: String(n), dataEmissao: d(`2026-0${2 + i}-05`), dataVencimento: d(`2026-0${2 + i}-15`) })
  );
  const ctx = contexto({ titulos: [...fundo(), ...espacadas] });
  conferir("numeração com saltos (tem outros clientes) não é achado", rodarFraude(ctx, "FR-NOTA-SEQUENCIAL").length, 0);
}
{
  // Quatro notas seguidas em 20 dias: pode ser um projeto só, ainda não é padrão.
  const curtas = [10, 11, 12, 13].map((n, i) =>
    titulo({ parceiroNome: "PRESTADOR NOVO LTDA", parceiroDocumento: "88888888000188", parceiroCodigo: "H1", numeroDocumento: String(n), dataEmissao: d(`2026-06-${5 + i * 5}`), dataVencimento: d(`2026-06-${5 + i * 5}`) })
  );
  const ctx = contexto({ titulos: [...fundo(), ...curtas] });
  conferir("sequência curta demais no tempo fica calada", rodarFraude(ctx, "FR-NOTA-SEQUENCIAL").length, 0);
}

// ------------------------------------------------------ CB-ENTRADA-SEM-TITULO
console.log("\nCB-ENTRADA-SEM-TITULO — dinheiro que entrou sem título");
const rodarConciliacao = (ctx: ContextoAuditoria, regra: string) =>
  (agenteConciliacao.executar(ctx) as ReturnType<typeof auditarFraude>).filter((a) => a.regra === regra);
{
  const ctx = contexto({
    titulos: fundo(),
    movimentos: [movimento({ valorCents: 15_000_00, data: d("2026-08-10"), parceiroNome: "EMPRESA DESCONHECIDA", observacao: "PIX RECEBIDO" })],
  });
  const r = rodarConciliacao(ctx, "CB-ENTRADA-SEM-TITULO");
  conferir("crédito sem título nem baixa é achado", r.length, 1);
  conferir("com o valor do crédito", r[0]?.valorCents, 15_000_00);
}
{
  const t = titulo({ natureza: "RECEBER", valorPagoCents: 15_000_00, valorDocumentoCents: 15_000_00 });
  const ctx = contexto({
    titulos: [...fundo(), t],
    baixas: [baixa({ tituloId: t.id, valorCents: 15_000_00, dataBaixa: d("2026-08-11") })],
    movimentos: [movimento({ valorCents: 15_000_00, data: d("2026-08-10") })],
  });
  conferir("crédito que casa com baixa a receber não é achado", rodarConciliacao(ctx, "CB-ENTRADA-SEM-TITULO").length, 0);
}
{
  const ctx = contexto({
    titulos: fundo(),
    movimentos: [
      movimento({ valorCents: 15_000_00, data: d("2026-08-10"), contaCorrenteCodigo: "100" }),
      movimento({ valorCents: -15_000_00, data: d("2026-08-10"), contaCorrenteCodigo: "200" }),
    ],
  });
  conferir("transferência entre contas do grupo não é achado", rodarConciliacao(ctx, "CB-ENTRADA-SEM-TITULO").length, 0);
}
{
  const ctx = contexto({
    titulos: fundo(),
    movimentos: [movimento({ valorCents: 15_000_00, data: d("2026-08-10"), observacao: "RESGATE APLICACAO CDB" })],
  });
  conferir("resgate de aplicação não é receita", rodarConciliacao(ctx, "CB-ENTRADA-SEM-TITULO").length, 0);
}

// ----------------------------------------------------- CR-JUROS-NAO-COBRADOS
console.log("\nCR-JUROS-NAO-COBRADOS — o cliente atrasou e pagou sem juros");
const rodarReceber = (ctx: ContextoAuditoria, regra: string) => auditarContasReceber(ctx).filter((a) => a.regra === regra);
{
  const atrasados = [1, 2, 3].map((i) =>
    titulo({ natureza: "RECEBER", parceiroNome: "PREFEITURA MUNICIPAL DE CAJAMAR", parceiroDocumento: "46577331000109", parceiroCodigo: "C1", dataVencimento: d(`2026-0${3 + i}-10`), dataUltimaBaixa: d(`2026-0${5 + i}-10`), valorDocumentoCents: 40_000_00, valorPagoCents: 40_000_00 })
  );
  const ctx = contexto({ titulos: [...fundo(), ...atrasados] });
  const r = rodarReceber(ctx, "CR-JUROS-NAO-COBRADOS");
  conferir("três títulos pagos 60 dias depois sem juros são achado", r.length >= 1, true);
  conferir("é oportunidade, não perda", r[0]?.categoria, "OPORTUNIDADE");
  conferir("reconhece o tomador público", r[0]?.evidencia?.tomadorPublico, true);
  conferir("o impacto é o custo do atraso a 1% ao mês", (r[0]?.impactoCents ?? 0) > 0, true);
}
{
  const comJuros = titulo({ natureza: "RECEBER", parceiroCodigo: "C2", dataVencimento: d("2026-04-10"), dataUltimaBaixa: d("2026-06-10"), valorDocumentoCents: 40_000_00, valorPagoCents: 40_800_00, jurosCents: 800_00 });
  const ctx = contexto({ titulos: [...fundo(), comJuros] });
  conferir("atraso com juros cobrados não é achado", rodarReceber(ctx, "CR-JUROS-NAO-COBRADOS").length, 0);
}
{
  const pequeno = titulo({ natureza: "RECEBER", parceiroCodigo: "C3", dataVencimento: d("2026-04-10"), dataUltimaBaixa: d("2026-05-15"), valorDocumentoCents: 2_000_00, valorPagoCents: 2_000_00 });
  const ctx = contexto({ titulos: [...fundo(), pequeno] });
  conferir("juros abaixo de um quarto da materialidade não viram achado", rodarReceber(ctx, "CR-JUROS-NAO-COBRADOS").length, 0);
}

// ----------------------------------------------------- FR-EDITADO-APOS-BAIXA
console.log("\nFR-EDITADO-APOS-BAIXA — o título mudou depois de pago");
{
  const t = titulo({ dataUltimaBaixa: d("2026-06-10"), alteradoEmOmie: d("2026-06-25"), usuarioAlteracao: "maria", usuarioInclusao: "joao", valorPagoCents: 3_000_00, valorDocumentoCents: 3_000_00 });
  const ctx = contexto({ titulos: [...fundo(), t] });
  const r = rodarFraude(ctx, "FR-EDITADO-APOS-BAIXA");
  conferir("alterado 15 dias depois de pago é achado", r.length, 1);
  conferir("diz quem alterou", r[0]?.evidencia?.alteradoPor, "maria");
  conferir("nunca abaixo de MÉDIA", ["MEDIA", "ALTA", "CRITICA"].includes(r[0]?.severidade ?? ""), true);
}
{
  const t = titulo({ dataUltimaBaixa: d("2026-06-10"), alteradoEmOmie: d("2026-06-11"), usuarioAlteracao: "maria", valorPagoCents: 3_000_00 });
  const ctx = contexto({ titulos: [...fundo(), t] });
  conferir("alteração no dia seguinte (a própria baixa) não é achado", rodarFraude(ctx, "FR-EDITADO-APOS-BAIXA").length, 0);
}
{
  // Sem o bloco info (conta que não devolve usuário): a regra fica calada,
  // porque `alteradoEmOmie` sozinho não diz nada sobre quem.
  const t = titulo({ dataUltimaBaixa: d("2026-06-10"), alteradoEmOmie: d("2026-06-25"), usuarioAlteracao: null, valorPagoCents: 3_000_00 });
  const ctx = contexto({ titulos: [...fundo(), t] });
  conferir("sem usuário de alteração fica calada", rodarFraude(ctx, "FR-EDITADO-APOS-BAIXA").length, 0);
}

// ------------------------------------------------------ FR-LANCAMENTO-MANUAL
console.log("\nFR-LANCAMENTO-MANUAL — título digitado à mão, sem documento");
{
  const manuais = [1, 2, 3].map((i) =>
    titulo({ origemLancamento: "MANP", numeroDocumento: null, usuarioInclusao: "carlos", dataInclusaoOmie: d(`2026-07-0${i}`), valorDocumentoCents: 900_00, valorPagoCents: 900_00, parceiroCodigo: `M${i}`, parceiroNome: `FORNECEDOR MANUAL ${i}` })
  );
  const ctx = contexto({ titulos: [...fundo(), ...manuais] });
  const r = rodarFraude(ctx, "FR-LANCAMENTO-MANUAL");
  conferir("três manuais sem nota do mesmo usuário no mês são um achado", r.length, 1);
  conferir("por usuário e mês", r[0]?.chave, "FR-LANCAMENTO-MANUAL|AZUL|carlos|2026-07");
  conferir("com a soma", r[0]?.valorCents, 2_700_00);
}
{
  const porNota = titulo({ origemLancamento: "NFEP", numeroDocumento: null, usuarioInclusao: "carlos", valorDocumentoCents: 5_000_00 });
  const manualComNota = titulo({ origemLancamento: "MANP", numeroDocumento: "4411", usuarioInclusao: "carlos", valorDocumentoCents: 5_000_00 });
  const ctx = contexto({ titulos: [...fundo(), porNota, manualComNota] });
  conferir("nascido de nota, ou manual com número de nota, não é achado", rodarFraude(ctx, "FR-LANCAMENTO-MANUAL").length, 0);
}

// ---------------------------------------------------- HI-FORNECEDOR-DORMENTE
console.log("\nHI-FORNECEDOR-DORMENTE — o cadastro esquecido que voltou a receber");
const MATERIALIDADE = 50_000;
function serie(chave: string, meses: { competencia: string; valor: number }[]): SerieMensal[] {
  return meses.map((m) => ({
    chave,
    rotulo: `Fornecedor ${chave}`,
    competencia: m.competencia,
    titulos: 1,
    valorCents: m.valor,
    valorMaximoCents: m.valor,
    baixas: 1,
    valorBaixadoCents: m.valor,
    diasPagamentoSoma: 0,
  }));
}
{
  const s = serie("D", [
    { competencia: "2024-06", valor: 300_00 },
    { competencia: "2024-07", valor: 300_00 },
    { competencia: "2024-08", valor: 300_00 },
    { competencia: "2026-08", valor: 900_00 },
  ]);
  const r = fornecedorDormente(s, "2026-08", MATERIALIDADE);
  conferir("três meses ativos, 23 dormentes, volta acima da materialidade: achado", r.length, 1);
  conferir("a evidência diz quanto tempo dormiu", r[0]?.evidencia.mesesDormente, 23);
}
{
  const s = serie("E", [
    { competencia: "2024-06", valor: 300_00 },
    { competencia: "2024-07", valor: 300_00 },
    { competencia: "2024-08", valor: 300_00 },
    { competencia: "2025-02", valor: 900_00 },
    { competencia: "2026-08", valor: 900_00 },
  ]);
  conferir("sono de 17 meses conta, mas o penúltimo mês ativo é o marco", fornecedorDormente(s, "2026-08", MATERIALIDADE).length, 1);
}
{
  const s = serie("F", [
    { competencia: "2025-06", valor: 300_00 },
    { competencia: "2025-07", valor: 300_00 },
    { competencia: "2025-08", valor: 300_00 },
    { competencia: "2026-08", valor: 900_00 },
  ]);
  conferir("onze meses parado ainda não é dormente", fornecedorDormente(s, "2026-08", MATERIALIDADE).length, 0);
}
{
  const s = serie("G", [
    { competencia: "2024-06", valor: 300_00 },
    { competencia: "2026-08", valor: 900_00 },
  ]);
  conferir("um mês antigo só não é relação antiga", fornecedorDormente(s, "2026-08", MATERIALIDADE).length, 0);
}
{
  const s = serie("H", [
    { competencia: "2024-06", valor: 300_00 },
    { competencia: "2024-07", valor: 300_00 },
    { competencia: "2024-08", valor: 300_00 },
    { competencia: "2026-03", valor: 900_00 },
  ]);
  conferir("quem acordou há cinco meses já não é notícia", fornecedorDormente(s, "2026-08", MATERIALIDADE).length, 0);
}

// -------------------------------------------------------------- FR-BENFORD
console.log("\nFR-BENFORD — método de Nigrini (MAD + qui-quadrado)");
{
  // Amostra que segue Benford: 2000 valores log-uniformes.
  let semente = 42;
  const aleatorio = () => {
    semente = (semente * 1103515245 + 12345) % 2147483648;
    return semente / 2147483648;
  };
  const conformes = Array.from({ length: 2000 }, () => Math.round(10 ** (3 + aleatorio() * 4)));
  const r1 = testeBenfordNigrini(conformes, 1)!;
  conferir("base log-uniforme é conforme no 1º dígito", r1.naoConforme, false);
  conferir("MAD abaixo do limite de Nigrini", r1.mad < 0.015, true);
  // Amostra inventada: tudo começa com 5 ou 9.
  const inventados = Array.from({ length: 2000 }, (_, i) => (i % 2 === 0 ? 5_000_00 + i * 37 : 9_000_00 + i * 53));
  const r2 = testeBenfordNigrini(inventados, 1)!;
  conferir("valores escolhidos são não conformes", r2.naoConforme, true);
  conferir("o dígito em excesso aparece primeiro", [5, 9].includes(r2.excessos[0].digito), true);
  conferir("amostra vazia devolve nulo", testeBenfordNigrini([], 1), null);
}
{
  // Na regra: 600 títulos inventados (todos começando com 9) numa categoria
  // disparam; 600 títulos log-uniformes não.
  let semente = 7;
  const aleatorio = () => {
    semente = (semente * 1103515245 + 12345) % 2147483648;
    return semente / 2147483648;
  };
  const conformes = Array.from({ length: 600 }, (_, i) =>
    titulo({ parceiroCodigo: `B${i % 40}`, parceiroDocumento: `${String(20_000_000 + (i % 40)).padStart(8, "0")}000100`, valorDocumentoCents: Math.round(10 ** (3 + aleatorio() * 4)), categoriaCodigo: "2.01", categoriaDescricao: "Manutenção" })
  );
  const ctx = contexto({ titulos: conformes });
  conferir("categoria conforme não gera achado", rodarFraude(ctx, "FR-BENFORD").length, 0);
  const inventados = Array.from({ length: 600 }, (_, i) =>
    titulo({ parceiroCodigo: `B${i % 40}`, parceiroDocumento: `${String(20_000_000 + (i % 40)).padStart(8, "0")}000100`, valorDocumentoCents: 9_000_00 + i * 37, categoriaCodigo: "2.02", categoriaDescricao: "Serviços" })
  );
  const ctx2 = contexto({ titulos: inventados });
  const r = rodarFraude(ctx2, "FR-BENFORD");
  conferir("categoria com valores escolhidos gera um achado", r.length, 1);
  conferir("a evidência lista os fornecedores nos dígitos em excesso", (r[0]?.evidencia?.fornecedoresNosDigitosEmExcesso as unknown[]).length > 0, true);
}

// -------------------------------------------------------- FR-KICKBACK-CATEGORIA
console.log("\nFR-KICKBACK-CATEGORIA — um fornecedor toma a categoria enquanto o custo sobe");
{
  const HOJE_JANELA = contexto({}); // janelaDesde 2026-01-01, referência 2026-08-25 → meses inteiros jan..jul
  void HOJE_JANELA;
  const lista: Titulo[] = [];
  // Jan–Mar: três fornecedores dividindo R$ 30 mil/mês. Mai–Jul: um só com R$ 45 mil/mês.
  for (const m of [1, 2, 3]) for (const f of ["K1", "K2", "K3"]) lista.push(titulo({ parceiroCodigo: f, parceiroNome: `FORN ${f}`, parceiroDocumento: `${f}${f}${f}${f}00000100`.slice(0, 14), categoriaCodigo: "3.01", categoriaDescricao: "Pneus", departamentoCodigo: "D1", dataEmissao: d(`2026-0${m}-10`), dataVencimento: d(`2026-0${m}-20`), valorDocumentoCents: 10_000_00, valorPagoCents: 10_000_00 }));
  for (const m of [4]) for (const f of ["K1", "K2"]) lista.push(titulo({ parceiroCodigo: f, parceiroNome: `FORN ${f}`, parceiroDocumento: `${f}${f}${f}${f}00000100`.slice(0, 14), categoriaCodigo: "3.01", categoriaDescricao: "Pneus", departamentoCodigo: "D1", dataEmissao: d(`2026-0${m}-10`), dataVencimento: d(`2026-0${m}-20`), valorDocumentoCents: 15_000_00, valorPagoCents: 15_000_00 }));
  for (const m of [5, 6, 7]) lista.push(titulo({ parceiroCodigo: "K1", parceiroNome: "FORN K1", parceiroDocumento: "K1K1K1K100000100".slice(0, 14), categoriaCodigo: "3.01", categoriaDescricao: "Pneus", departamentoCodigo: "D1", dataEmissao: d(`2026-0${m}-10`), dataVencimento: d(`2026-0${m}-20`), valorDocumentoCents: 45_000_00, valorPagoCents: 45_000_00 }));
  const ctx = contexto({ titulos: [...fundo(), ...lista] });
  const r = rodarFraude(ctx, "FR-KICKBACK-CATEGORIA");
  conferir("concentração de 33% → 100% com custo +50% e sem receita é achado", r.length, 1);
  conferir("nomeia o fornecedor que tomou a categoria", r[0]?.entidadeRef, "FORN K1");
}
{
  // Mesma concentração, mas a receita cresceu junto: é operação, não comissão.
  const lista: Titulo[] = [];
  for (const m of [1, 2, 3]) for (const f of ["K1", "K2", "K3"]) lista.push(titulo({ parceiroCodigo: f, parceiroDocumento: `${f}${f}${f}${f}00000100`.slice(0, 14), categoriaCodigo: "3.01", departamentoCodigo: "D1", dataEmissao: d(`2026-0${m}-10`), dataVencimento: d(`2026-0${m}-20`), valorDocumentoCents: 10_000_00 }));
  for (const m of [4]) lista.push(titulo({ parceiroCodigo: "K2", parceiroDocumento: "K2K2K2K200000100".slice(0, 14), categoriaCodigo: "3.01", departamentoCodigo: "D1", dataEmissao: d(`2026-0${m}-10`), dataVencimento: d(`2026-0${m}-20`), valorDocumentoCents: 10_000_00 }));
  for (const m of [5, 6, 7]) lista.push(titulo({ parceiroCodigo: "K1", parceiroDocumento: "K1K1K1K100000100".slice(0, 14), categoriaCodigo: "3.01", departamentoCodigo: "D1", dataEmissao: d(`2026-0${m}-10`), dataVencimento: d(`2026-0${m}-20`), valorDocumentoCents: 45_000_00 }));
  for (const m of [1, 2, 3]) lista.push(titulo({ natureza: "RECEBER", parceiroCodigo: "C1", dataEmissao: d(`2026-0${m}-05`), dataVencimento: d(`2026-0${m}-25`), valorDocumentoCents: 100_000_00 }));
  for (const m of [5, 6, 7]) lista.push(titulo({ natureza: "RECEBER", parceiroCodigo: "C1", dataEmissao: d(`2026-0${m}-05`), dataVencimento: d(`2026-0${m}-25`), valorDocumentoCents: 200_000_00 }));
  const ctx = contexto({ titulos: [...fundo(), ...lista] });
  conferir("receita que dobrou explica o custo: não é achado", rodarFraude(ctx, "FR-KICKBACK-CATEGORIA").length, 0);
}

// ------------------------------------------------------ CR-RETENCAO-INDEVIDA
console.log("\nCR-RETENCAO-INDEVIDA — o tomador reteve o que a lei não manda");
conferir("prefeitura é público", tipoDeTomador("PREFEITURA MUNICIPAL DE CAJAMAR"), "publico");
conferir("universidade federal é federal", tipoDeTomador("UNIVERSIDADE FEDERAL DE SAO CARLOS"), "federal");
conferir("empresa é privado", tipoDeTomador("INDUSTRIA DE PAPEL LTDA"), "privado");
{
  // Privado retendo 4,65% de PCC sobre R$ 50 mil: R$ 2.325 indevidos.
  const t = titulo({ natureza: "RECEBER", parceiroNome: "INDUSTRIA DE PAPEL LTDA", parceiroDocumento: "99999999000199", parceiroCodigo: "R1", valorDocumentoCents: 50_000_00, valorPagoCents: 47_675_00, retencaoPisCents: 325_00, retencaoCofinsCents: 1_500_00, retencaoCsllCents: 500_00 });
  const ctx = contexto({ titulos: [...fundo(), t] });
  const r = rodarReceber(ctx, "CR-RETENCAO-INDEVIDA");
  conferir("PCC retido por privado é achado", r.length, 1);
  conferir("com o valor retido", r[0]?.valorCents, 2_325_00);
  conferir("é oportunidade de recuperação", r[0]?.categoria, "OPORTUNIDADE");
}
{
  // Órgão federal retendo exatamente 7,05%: correto.
  const t = titulo({ natureza: "RECEBER", parceiroNome: "UNIVERSIDADE FEDERAL DE SAO CARLOS", parceiroCodigo: "R2", valorDocumentoCents: 100_000_00, valorPagoCents: 92_950_00, retencaoIrCents: 2_400_00, retencaoPisCents: 650_00, retencaoCofinsCents: 3_000_00, retencaoCsllCents: 1_000_00 });
  const ctx = contexto({ titulos: [...fundo(), t] });
  conferir("7,05% do órgão federal é o correto", rodarReceber(ctx, "CR-RETENCAO-INDEVIDA").length, 0);
}
{
  // Prefeitura retendo só IRRF: correto; prefeitura retendo PCC: indevido.
  const so_ir = titulo({ natureza: "RECEBER", parceiroNome: "PREFEITURA MUNICIPAL DE CAJAMAR", parceiroCodigo: "R3", valorDocumentoCents: 100_000_00, retencaoIrCents: 1_500_00 });
  const comPcc = titulo({ natureza: "RECEBER", parceiroNome: "PREFEITURA MUNICIPAL DE CAJAMAR", parceiroCodigo: "R3", valorDocumentoCents: 100_000_00, retencaoIrCents: 1_500_00, retencaoCofinsCents: 3_000_00 });
  conferir("prefeitura com só IRRF não é achado", rodarReceber(contexto({ titulos: [...fundo(), so_ir] }), "CR-RETENCAO-INDEVIDA").length, 0);
  conferir("prefeitura com COFINS retido é achado", rodarReceber(contexto({ titulos: [...fundo(), comPcc] }), "CR-RETENCAO-INDEVIDA").length, 1);
}

// ---------------------------------------------------------------- CR-LAPPING
console.log("\nCR-LAPPING — o pagamento de um título aplicado em outro");
{
  const pago = titulo({ natureza: "RECEBER", parceiroCodigo: "L1", parceiroDocumento: "77777777000177", valorDocumentoCents: 8_000_00, valorPagoCents: 5_000_00, liquidado: false });
  const aberto = titulo({ natureza: "RECEBER", parceiroCodigo: "L1", parceiroDocumento: "77777777000177", valorDocumentoCents: 5_000_00, valorPagoCents: 0, liquidado: false, dataVencimento: d("2026-07-10") });
  const ctx = contexto({ titulos: [...fundo(), pago, aberto], baixas: [baixa({ tituloId: pago.id, valorCents: 5_000_00, dataBaixa: d("2026-07-15") })] });
  const r = rodarReceber(ctx, "CR-LAPPING");
  conferir("baixa de R$ 5.000 num título de R$ 8.000, com outro de R$ 5.000 em aberto, é achado", r.length, 1);
  conferir("a evidência diz qual título tem esse valor", String((r[0]?.evidencia?.casos as { tituloComEsseValor: string }[])[0]?.tituloComEsseValor).length > 0, true);
}
{
  const pago = titulo({ natureza: "RECEBER", parceiroCodigo: "L2", parceiroDocumento: "66666666000166", valorDocumentoCents: 5_000_00, valorPagoCents: 5_000_00 });
  const aberto = titulo({ natureza: "RECEBER", parceiroCodigo: "L2", parceiroDocumento: "66666666000166", valorDocumentoCents: 5_000_00, valorPagoCents: 0, liquidado: false });
  const ctx = contexto({ titulos: [...fundo(), pago, aberto], baixas: [baixa({ tituloId: pago.id, valorCents: 5_000_00 })] });
  conferir("baixa do valor exato do próprio título não é lapping", rodarReceber(ctx, "CR-LAPPING").length, 0);
}

// ---------------------------------------------- CB-TRANSFERENCIA-INTERGRUPO
console.log("\nCB-TRANSFERENCIA-INTERGRUPO — dinheiro que mudou de empresa sem título");
{
  const ctx = contexto({
    titulos: fundo(),
    movimentos: [
      movimento({ valorCents: -20_000_00, data: d("2026-08-10"), conexaoId: "x", conexaoApelido: "AZUL", contaCorrenteCodigo: "100" }),
      movimento({ valorCents: 20_000_00, data: d("2026-08-11"), conexaoId: "y", conexaoApelido: "MCZ", contaCorrenteCodigo: "200" }),
    ],
  });
  const r = rodarConciliacao(ctx, "CB-TRANSFERENCIA-INTERGRUPO");
  conferir("débito na Azul e crédito na MCZ no dia seguinte é transferência", r.length, 1);
  conferir("informativo", r[0]?.severidade, "INFO");
  conferir("e não aparece como entrada sem título", rodarConciliacao(ctx, "CB-ENTRADA-SEM-TITULO").length, 0);
}

// ------------------------------------------------------ HI-REAJUSTE-VENCIDO
console.log("\nHI-REAJUSTE-VENCIDO — o cliente que fatura o mesmo valor há mais de um ano");
{
  const meses = Array.from({ length: 14 }, (_, i) => {
    const m = new Date(2025, 5 + i, 1);
    return { competencia: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`, valor: 30_000_00 };
  });
  const r = reajusteVencido(serie("C1", meses), "2026-08", MATERIALIDADE);
  conferir("14 meses no mesmo valor é reajuste vencido", r.length, 1);
  conferir("impacto = 12 x mediana x 4%", r[0]?.valorCents, Math.round(30_000_00 * 12 * 0.04));
}
{
  const meses = Array.from({ length: 14 }, (_, i) => {
    const m = new Date(2025, 5 + i, 1);
    return { competencia: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`, valor: i >= 11 ? 33_000_00 : 30_000_00 };
  });
  conferir("aumento de 10% nos últimos meses é reajuste feito", reajusteVencido(serie("C2", meses), "2026-08", MATERIALIDADE).length, 0);
}
{
  const meses = Array.from({ length: 14 }, (_, i) => {
    const m = new Date(2025, 5 + i, 1);
    return { competencia: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`, valor: 10_000_00 + (i % 3) * 8_000_00 };
  });
  conferir("valor por quilômetro (varia muito) não tem reajuste a cobrar", reajusteVencido(serie("C3", meses), "2026-08", MATERIALIDADE).length, 0);
}

// -------------------------------------------- FR-CONTA-ALTERADA-REPETIDA
console.log("\nFR-CONTA-ALTERADA-REPETIDA — trocou, recebeu, voltou");
{
  const p = parceiro({ codigoOmie: "P1", nome: "FORNECEDOR VOLTA E MEIA LTDA" });
  const ctx = contexto({ parceiros: [p], titulos: fundo() });
  ctx.contaHistorico = [
    { id: "h1", companyId: "c", conexaoId: "x", codigoOmie: "P1", hashAnterior: "A", hashNovo: "B", detectadoEm: d("2026-03-01") },
    { id: "h2", companyId: "c", conexaoId: "x", codigoOmie: "P1", hashAnterior: "B", hashNovo: "A", detectadoEm: d("2026-04-15") },
  ];
  const r = rodarFraude(ctx, "FR-CONTA-ALTERADA-REPETIDA");
  conferir("trocar e voltar à conta anterior é achado ALTA", r[0]?.severidade, "ALTA");
  conferir("o título diz que voltou", r[0]?.titulo.includes("devolvida"), true);
}
{
  const p = parceiro({ codigoOmie: "P1" });
  const ctx = contexto({ parceiros: [p], titulos: fundo() });
  ctx.contaHistorico = [{ id: "h1", companyId: "c", conexaoId: "x", codigoOmie: "P1", hashAnterior: "A", hashNovo: "B", detectadoEm: d("2026-03-01") }];
  conferir("uma troca só fica com FR-CONTA-ALTERADA", rodarFraude(ctx, "FR-CONTA-ALTERADA-REPETIDA").length, 0);
}

// ------------------------------------------- FR-EDITADO-APOS-BAIXA (versões)
console.log("\nFR-EDITADO-APOS-BAIXA — com as versões, diz o que mudou");
{
  const t = titulo({ dataUltimaBaixa: d("2026-06-10"), alteradoEmOmie: null, usuarioAlteracao: null, valorPagoCents: 3_000_00, valorDocumentoCents: 3_000_00 });
  const ctx = contexto({ titulos: [...fundo(), t] });
  ctx.versoesDeTitulo = [{ id: "v1", companyId: "c", tituloId: t.id, vistoEm: d("2026-06-25"), campo: "parceiroCodigo", de: "P1", para: "P9" }];
  const r = rodarFraude(ctx, "FR-EDITADO-APOS-BAIXA");
  conferir("versão depois da baixa dispara mesmo sem o bloco info", r.length, 1);
  conferir("e a evidência diz o que mudou", (r[0]?.evidencia?.mudancas as string[])[0], "parceiroCodigo: P1 → P9");
}

console.log(falhas === 0 ? "\nTodos os casos passaram." : `\n${falhas} caso(s) falharam.`);
process.exit(falhas === 0 ? 0 : 1);
