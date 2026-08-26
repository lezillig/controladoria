// TESTES DAS REGRAS "POR ONDE O DINHEIRO SAIU" — `npm run teste:antifraude`.
//
// Estas cinco regras vão rodar contra 46 mil títulos e 45 mil baixas no
// próximo ciclo. Uma regra de antifraude que erra não é só ruído: ela manda
// alguém investigar um colega. O teste existe para que o primeiro contato com
// o dado real não seja também o primeiro contato com a regra.
//
// Sem banco: os agentes recebem o contexto pronto, então basta montá-lo.
import { auditarFraude } from "../src/lib/controladoria/agents/antifraude";
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
type Baixa = ContextoAuditoria["baixas"][number];
type Conta = ContextoAuditoria["contasCorrentes"][number];

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
    status: "Pago",
    parceiroNome: "FORNECEDOR TESTE",
    parceiroDocumento: null,
    parceiroCodigo: null,
    contaCorrenteCodigo: "100",
    numeroDocumento: null,
    tipoDocumento: null,
    dataEmissao: d("2026-08-01"),
    dataVencimento: d("2026-08-10"),
    valorDocumentoCents: 1_000_00,
    valorPagoCents: 1_000_00,
    jurosCents: 0,
    multaCents: 0,
    descontoCents: 0,
    tarifaCents: 0,
    ...p,
  }) as Titulo;

const baixa = (p: Partial<Baixa> & { tituloId: string }): Baixa =>
  ({
    id: `b${++seq}`,
    companyId: "c",
    conexaoId: "x",
    chave: `K${seq}`,
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

const conta = (p: Partial<Conta> & { codigo: string }): Conta =>
  ({
    id: `cc${p.codigo}`,
    companyId: "c",
    conexaoId: "x",
    conexaoApelido: "AZUL",
    descricao: `Conta ${p.codigo}`,
    banco: "341",
    inativa: false,
    naoEntraNoResumo: false,
    naoEntraNoFluxo: false,
    saldoInicialCents: 0,
    ...p,
  }) as Conta;

function contexto(p: {
  titulos?: Titulo[];
  baixas?: Baixa[];
  contasCorrentes?: Conta[];
}): ContextoAuditoria {
  return {
    companyId: "c",
    conexaoId: null,
    dataReferencia: HOJE,
    agora: HOJE,
    janelaDesde: d("2026-01-01"),
    titulos: p.titulos ?? [],
    baixas: p.baixas ?? [],
    contasCorrentes: p.contasCorrentes ?? [],
    // O agente inteiro roda em cada chamada, e as outras regras dele leem
    // config e cadastro de motoristas. Ficam mínimos de propósito: o que se
    // testa aqui são as cinco regras novas, e as demais precisam apenas não
    // quebrar. `limiteAlcadaCents` alto mantém o fracionamento calado.
    config: { limiteAlcadaCents: 100_000_000_00 },
    motoristas: [],
    movimentos: [],
    notas: [],
    parceiros: [],
    categorias: [],
    departamentos: [],
    vinculos: [],
  } as unknown as ContextoAuditoria;
}

const rodar = (ctx: ContextoAuditoria, regra: string) =>
  auditarFraude(ctx).filter((a) => a.regra === regra);

// ------------------------------------------------------- FR-CONTA-ESCONDIDA
console.log("\nFR-CONTA-ESCONDIDA — conta fora do resumo de caixa, com movimento");
{
  const t = titulo({ contaCorrenteCodigo: "900", valorDocumentoCents: 500_000_00 });
  const ctx = contexto({
    titulos: [t],
    baixas: [baixa({ tituloId: t.id, contaCorrenteCodigo: "900", valorCents: 500_000_00 })],
    contasCorrentes: [conta({ codigo: "900", descricao: "Conta Reserva", naoEntraNoResumo: true })],
  });
  const a = rodar(ctx, "FR-CONTA-ESCONDIDA");
  conferir("aponta a conta escondida", a.length, 1);
  conferir("com o valor que passou por ela", a[0]?.valorCents, 500_000_00);
  conferir("e nomeia a conta", a[0]?.titulo.includes("Conta Reserva"), true);
}
{
  const t = titulo({ contaCorrenteCodigo: "100", valorDocumentoCents: 500_000_00 });
  const ctx = contexto({
    titulos: [t],
    baixas: [baixa({ tituloId: t.id, valorCents: 500_000_00 })],
    contasCorrentes: [conta({ codigo: "100" })],
  });
  conferir("conta normal não vira achado", rodar(ctx, "FR-CONTA-ESCONDIDA").length, 0);
}
{
  const ctx = contexto({
    contasCorrentes: [conta({ codigo: "900", naoEntraNoFluxo: true })],
  });
  conferir("conta escondida SEM movimento não vira achado", rodar(ctx, "FR-CONTA-ESCONDIDA").length, 0);
}

// -------------------------------------------------------- FR-BAIXA-DESVIADA
console.log("\nFR-BAIXA-DESVIADA — pagou por conta diferente da do título");
{
  const t1 = titulo({ contaCorrenteCodigo: "100", valorDocumentoCents: 300_000_00 });
  const t2 = titulo({ contaCorrenteCodigo: "100", valorDocumentoCents: 300_000_00 });
  const ctx = contexto({
    titulos: [t1, t2],
    baixas: [
      baixa({ tituloId: t1.id, contaCorrenteCodigo: "200", valorCents: 300_000_00 }),
      baixa({ tituloId: t2.id, contaCorrenteCodigo: "200", valorCents: 300_000_00 }),
    ],
    contasCorrentes: [conta({ codigo: "100", descricao: "Itaú" }), conta({ codigo: "200", descricao: "Bradesco" })],
  });
  const a = rodar(ctx, "FR-BAIXA-DESVIADA");
  conferir("um achado por PAR de contas, não por baixa", a.length, 1);
  conferir("somando as duas", a[0]?.valorCents, 600_000_00);
  conferir("e nomeando as contas", a[0]?.descricao.includes("Itaú") && a[0]?.descricao.includes("Bradesco"), true);
}
{
  const t = titulo({ contaCorrenteCodigo: null, valorDocumentoCents: 300_000_00 });
  const ctx = contexto({
    titulos: [t],
    baixas: [baixa({ tituloId: t.id, contaCorrenteCodigo: "200", valorCents: 300_000_00 })],
    contasCorrentes: [conta({ codigo: "200" })],
  });
  conferir("título sem conta não conta como desvio", rodar(ctx, "FR-BAIXA-DESVIADA").length, 0);
}
{
  const t = titulo({ cancelado: true, contaCorrenteCodigo: "100", valorDocumentoCents: 300_000_00 });
  const ctx = contexto({
    titulos: [t],
    baixas: [baixa({ tituloId: t.id, contaCorrenteCodigo: "200", valorCents: 300_000_00 })],
    contasCorrentes: [conta({ codigo: "100" }), conta({ codigo: "200" })],
  });
  conferir("título cancelado sai daqui e vai para a regra própria", rodar(ctx, "FR-BAIXA-DESVIADA").length, 0);
}

// ------------------------------------------------------- FR-BAIXA-SEM-CONTA
console.log("\nFR-BAIXA-SEM-CONTA — pagou e não disse de onde");
{
  const ts = [1, 2, 3, 4, 5].map(() => titulo({ valorDocumentoCents: 100_00 }));
  const ctx = contexto({
    titulos: ts,
    baixas: ts.map((t) => baixa({ tituloId: t.id, contaCorrenteCodigo: null, valorCents: 100_00 })),
  });
  const a = rodar(ctx, "FR-BAIXA-SEM-CONTA");
  conferir("cinco baixas pequenas passam pelo corte por CONTAGEM", a.length, 1);
  conferir("é falha de processo, não indício de desvio", a[0]?.categoria, "ERRO_PROCESSO");
}
{
  const t = titulo({ valorDocumentoCents: 100_00 });
  const ctx = contexto({
    titulos: [t],
    baixas: [baixa({ tituloId: t.id, contaCorrenteCodigo: null, valorCents: 100_00 })],
  });
  conferir("uma baixa pequena sozinha não vira achado", rodar(ctx, "FR-BAIXA-SEM-CONTA").length, 0);
}

// -------------------------------------------------- FR-CANCELADO-COM-BAIXA
console.log("\nFR-CANCELADO-COM-BAIXA — a contradição de estado");
{
  const t = titulo({ cancelado: true, valorDocumentoCents: 50_00 });
  const ctx = contexto({ titulos: [t], baixas: [baixa({ tituloId: t.id, valorCents: 50_00 })] });
  const a = rodar(ctx, "FR-CANCELADO-COM-BAIXA");
  conferir("um caso pequeno JÁ é achado — não há piso de valor", a.length, 1);
  conferir("e a evidência traz o título", (a[0]?.evidencia as { casos: unknown[] })?.casos.length, 1);
}
{
  const t = titulo({ cancelado: true });
  conferir("cancelado SEM baixa é o caso certo", rodar(contexto({ titulos: [t] }), "FR-CANCELADO-COM-BAIXA").length, 0);
}

// ---------------------------------------------------- FR-BAIXA-ANTECIPADA
console.log("\nFR-BAIXA-ANTECIPADA — pagou antes de existir");
{
  const t = titulo({ dataEmissao: d("2026-08-20"), valorDocumentoCents: 200_000_00 });
  const ctx = contexto({
    titulos: [t],
    baixas: [baixa({ tituloId: t.id, dataBaixa: d("2026-08-01"), valorCents: 200_000_00 })],
  });
  const a = rodar(ctx, "FR-BAIXA-ANTECIPADA");
  conferir("19 dias antes da emissão é achado", a.length, 1);
  conferir("com a diferença na evidência", (a[0]?.evidencia as { casos: { diasDeDiferenca: number }[] })?.casos[0]?.diasDeDiferenca, 19);
}
{
  const t = titulo({ dataEmissao: d("2026-08-10") });
  const ctx = contexto({ titulos: [t], baixas: [baixa({ tituloId: t.id, dataBaixa: d("2026-08-09") })] });
  conferir("um dia de folga não é anomalia (fuso)", rodar(ctx, "FR-BAIXA-ANTECIPADA").length, 0);
}
{
  const t = titulo({ dataEmissao: null });
  const ctx = contexto({ titulos: [t], baixas: [baixa({ tituloId: t.id, dataBaixa: d("2026-08-01") })] });
  conferir("título sem emissão não pode ser julgado", rodar(ctx, "FR-BAIXA-ANTECIPADA").length, 0);
}

// ---------------------------------------------------------- FR-BAIXA-FUTURA
console.log("\nFR-BAIXA-FUTURA — baixa registrada antes de acontecer");
{
  const t = titulo({ valorDocumentoCents: 400_000_00 });
  const ctx = contexto({
    titulos: [t],
    baixas: [baixa({ tituloId: t.id, dataBaixa: d("2026-09-15"), valorCents: 400_000_00 })],
  });
  const a = rodar(ctx, "FR-BAIXA-FUTURA");
  conferir("data futura é achado", a.length, 1);
  conferir("com os dias no futuro na evidência", (a[0]?.evidencia as { casos: { diasNoFuturo: number }[] })?.casos[0]?.diasNoFuturo, 21);
}
{
  const t = titulo();
  const ctx = contexto({ titulos: [t], baixas: [baixa({ tituloId: t.id, dataBaixa: HOJE })] });
  conferir("baixa de hoje não é futuro", rodar(ctx, "FR-BAIXA-FUTURA").length, 0);
}

// ------------------------------------------------------- FR-BAIXA-DUPLICADA
console.log("\nFR-BAIXA-DUPLICADA — o mesmo título baixado duas vezes");
{
  const t = titulo({ valorDocumentoCents: 200_000_00 });
  const ctx = contexto({
    titulos: [t],
    baixas: [
      baixa({ tituloId: t.id, dataBaixa: d("2026-08-10"), valorCents: 200_000_00 }),
      baixa({ tituloId: t.id, dataBaixa: d("2026-08-10"), valorCents: 200_000_00 }),
    ],
  });
  const a = rodar(ctx, "FR-BAIXA-DUPLICADA");
  conferir("aponta a repetição", a.length, 1);
  conferir("conta só a SEGUNDA — a primeira é legítima", a[0]?.valorCents, 200_000_00);
}
{
  const t = titulo({ valorDocumentoCents: 200_000_00 });
  const ctx = contexto({
    titulos: [t],
    baixas: [
      baixa({ tituloId: t.id, dataBaixa: d("2026-08-10"), valorCents: 100_000_00 }),
      baixa({ tituloId: t.id, dataBaixa: d("2026-08-10"), valorCents: 100_000_00 }),
    ],
  });
  conferir("duas parcelas iguais no mesmo dia ainda contam", rodar(ctx, "FR-BAIXA-DUPLICADA").length, 1);
}
{
  const t = titulo({ valorDocumentoCents: 200_000_00 });
  const ctx = contexto({
    titulos: [t],
    baixas: [
      baixa({ tituloId: t.id, dataBaixa: d("2026-08-10"), valorCents: 200_000_00 }),
      baixa({ tituloId: t.id, dataBaixa: d("2026-08-20"), valorCents: 200_000_00 }),
    ],
  });
  conferir("dias diferentes não é duplicidade", rodar(ctx, "FR-BAIXA-DUPLICADA").length, 0);
}

// ---------------------------------------------------- FR-RECEBIVEL-CANCELADO
console.log("\nFR-RECEBIVEL-CANCELADO — desistiu de cobrar, sem passar por perda");
{
  const pago = titulo({ natureza: "RECEBER", valorDocumentoCents: 1_000_000_00 });
  const cancelados = [1, 2].map(() =>
    titulo({ natureza: "RECEBER", cancelado: true, valorDocumentoCents: 200_000_00, parceiroDocumento: "11222333000181" })
  );
  const ctx = contexto({
    titulos: [pago, ...cancelados],
    baixas: [baixa({ tituloId: pago.id, valorCents: 1_000_000_00 })],
  });
  const a = rodar(ctx, "FR-RECEBIVEL-CANCELADO");
  conferir("agrupa por cliente", a.length, 1);
  conferir("somando os dois cancelados", a[0]?.valorCents, 400_000_00);
}
{
  const t = titulo({ natureza: "RECEBER", cancelado: true, valorDocumentoCents: 500_000_00 });
  const ctx = contexto({ titulos: [t], baixas: [baixa({ tituloId: t.id, valorCents: 500_000_00 })] });
  conferir("cancelado COM recebimento é outra regra", rodar(ctx, "FR-RECEBIVEL-CANCELADO").length, 0);
}
{
  const t = titulo({ natureza: "PAGAR", cancelado: true, valorDocumentoCents: 500_000_00 });
  conferir("título a pagar cancelado não entra aqui", rodar(contexto({ titulos: [t] }), "FR-RECEBIVEL-CANCELADO").length, 0);
}

// ------------------------------------------------------- FR-DESCONTO-TOTAL
console.log("\nFR-DESCONTO-TOTAL — o desconto engoliu o título");
{
  const t = titulo({ natureza: "RECEBER", valorDocumentoCents: 500_000_00 });
  const ctx = contexto({
    titulos: [t],
    baixas: [baixa({ tituloId: t.id, valorCents: 1_00, descontoCents: 499_999_00 })],
  });
  const a = rodar(ctx, "FR-DESCONTO-TOTAL");
  conferir("desconto de ~100% é achado", a.length, 1);
  conferir("e o valor é o desconto", a[0]?.valorCents, 499_999_00);
}
{
  const t = titulo({ natureza: "RECEBER", valorDocumentoCents: 500_000_00 });
  const ctx = contexto({
    titulos: [t],
    baixas: [baixa({ tituloId: t.id, valorCents: 450_000_00, descontoCents: 50_000_00 })],
  });
  conferir("desconto de 10% é política comercial, não é aqui", rodar(ctx, "FR-DESCONTO-TOTAL").length, 0);
}

// --------------------------------------------------- FR-CLIENTE-FORNECEDOR
console.log("\nFR-CLIENTE-FORNECEDOR — o mesmo CNPJ nos dois sentidos");
{
  const DOC = "11222333000181";
  const ctx = contexto({
    titulos: [
      titulo({ natureza: "PAGAR", parceiroDocumento: DOC, parceiroNome: "PARCEIRA TRANSPORTES", valorDocumentoCents: 800_000_00 }),
      titulo({ natureza: "RECEBER", parceiroDocumento: DOC, parceiroNome: "PARCEIRA TRANSPORTES", valorDocumentoCents: 600_000_00 }),
    ],
    baixas: [],
  });
  const a = rodar(ctx, "FR-CLIENTE-FORNECEDOR");
  conferir("aponta a parte relacionada", a.length, 1);
  conferir("valor é o MENOR dos dois lados", a[0]?.valorCents, 600_000_00);
}
{
  const ctx = contexto({
    titulos: [
      titulo({ natureza: "PAGAR", parceiroDocumento: "11222333000181", valorDocumentoCents: 800_000_00 }),
      titulo({ natureza: "RECEBER", parceiroDocumento: "11222333000181", valorDocumentoCents: 1_00 }),
    ],
  });
  conferir("um lado irrelevante não faz parte relacionada", rodar(ctx, "FR-CLIENTE-FORNECEDOR").length, 0);
}
{
  const ctx = contexto({
    titulos: [
      titulo({ natureza: "PAGAR", parceiroDocumento: "11111111111111", valorDocumentoCents: 800_000_00 }),
      titulo({ natureza: "RECEBER", parceiroDocumento: "11111111111111", valorDocumentoCents: 800_000_00 }),
    ],
  });
  conferir("documento inválido não vira parte relacionada", rodar(ctx, "FR-CLIENTE-FORNECEDOR").length, 0);
}

// ------------------------------------------------------------ base vazia
console.log("\nBase vazia");
{
  const achados = auditarFraude(contexto({}));
  conferir("nenhuma regra dispara sem dado", achados.length, 0);
}

console.log(falhas === 0 ? "\nTodos os testes passaram.\n" : `\n${falhas} FALHA(S).\n`);
process.exit(falhas === 0 ? 0 : 1);
