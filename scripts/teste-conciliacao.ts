// TESTES DA CONCILIAÇÃO BANCÁRIA — `npm run teste:conciliacao`.
//
// O agente existia há meses sem um caso de teste, e a revisão de auditoria
// encontrou o motivo de isso importar: o casamento entre movimento do extrato
// e baixa de título era por valor e data em TODO o grupo. Um débito na conta
// da Azul era "explicado" por um recebimento da MCZ do mesmo valor, e uma
// baixa de título a pagar explicava um crédito. CB-SAIDA-SEM-TITULO é a regra
// que o próprio arquivo chama de a mais séria dele — é assim que aparece um
// pagamento que nunca passou por aprovação —, e o casamento frouxo a calava.
//
// Sem banco: o agente recebe o contexto pronto.
import { agenteConciliacao } from "../src/lib/controladoria/agents/conciliacao";
import type { AchadoNovo, ContextoAuditoria } from "../src/lib/controladoria/types";

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
type Movimento = ContextoAuditoria["movimentos"][number];

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
    parceiroNome: "FORNECEDOR",
    parceiroDocumento: null,
    parceiroCodigo: null,
    contaCorrenteCodigo: "100",
    numeroDocumento: null,
    dataEmissao: d("2026-08-01"),
    dataVencimento: d("2026-08-10"),
    valorDocumentoCents: 50_000_00,
    valorPagoCents: 50_000_00,
    ...p,
  }) as Titulo;

const baixa = (p: Partial<Baixa> & { tituloId: string }): Baixa =>
  ({
    id: `b${++seq}`,
    companyId: "c",
    conexaoId: "x",
    chave: `K${seq}`,
    dataBaixa: d("2026-08-10"),
    valorCents: 50_000_00,
    jurosCents: 0,
    multaCents: 0,
    descontoCents: 0,
    tarifaCents: 0,
    contaCorrenteCodigo: "100",
    lancamentoCCCodigo: null,
    liquidaTitulo: true,
    ...p,
  }) as Baixa;

const movimento = (p: Partial<Movimento> = {}): Movimento =>
  ({
    id: `m${++seq}`,
    companyId: "c",
    conexaoId: "x",
    conexaoApelido: "AZUL",
    contaCorrenteCodigo: "100",
    codigoLancamento: `M${seq}`,
    data: d("2026-08-10"),
    valorCents: -50_000_00,
    tipo: null,
    parceiroNome: "FORNECEDOR",
    documento: null,
    observacao: null,
    tituloCodigo: null,
    ...p,
  }) as Movimento;

function contexto(p: { titulos?: Titulo[]; baixas?: Baixa[]; movimentos?: Movimento[] }): ContextoAuditoria {
  return {
    companyId: "c",
    conexaoId: null,
    dataReferencia: HOJE,
    agora: HOJE,
    janelaDesde: d("2026-01-01"),
    titulos: p.titulos ?? [],
    baixas: p.baixas ?? [],
    movimentos: p.movimentos ?? [],
    contasCorrentes: [],
    // Materialidade de R$ 50.000: 0,5% de dez milhões baixados em doze meses.
    baixadoEm12MesesCents: 10_000_000_00,
    config: { saldoMinimoCaixaCents: null, limiteAlcadaCents: null },
    conexoes: [],
    parceiros: [],
    categorias: [],
    notas: [],
  } as unknown as ContextoAuditoria;
}

const rodar = (ctx: ContextoAuditoria, regra: string) =>
  (agenteConciliacao.executar(ctx) as AchadoNovo[]).filter((a) => a.regra === regra);

// -------------------------------------------------------- CB-SAIDA-SEM-TITULO
console.log("\nCB-SAIDA-SEM-TITULO — débito no extrato sem baixa que o explique");
{
  const t = titulo();
  const ctx = contexto({ titulos: [t], baixas: [baixa({ tituloId: t.id })], movimentos: [movimento()] });
  conferir("débito com baixa igual na mesma conta e empresa: silêncio", rodar(ctx, "CB-SAIDA-SEM-TITULO").length, 0);
}
{
  // A ÚNICA baixa igual é da OUTRA empresa: não explica este débito.
  const t = titulo({ conexaoId: "y", conexaoApelido: "MCZ" });
  const ctx = contexto({ titulos: [t], baixas: [baixa({ tituloId: t.id, conexaoId: "y" })], movimentos: [movimento()] });
  const a = rodar(ctx, "CB-SAIDA-SEM-TITULO");
  conferir("baixa da outra empresa não explica o débito", a.length, 1);
  conferir("categoria fraude, com o valor do débito", [a[0]?.categoria, a[0]?.valorCents], ["FRAUDE", 50_000_00]);
}
{
  // Baixa igual, mesma empresa, mas de título A RECEBER: dinheiro entrando não
  // explica dinheiro saindo.
  const t = titulo({ natureza: "RECEBER" });
  const ctx = contexto({ titulos: [t], baixas: [baixa({ tituloId: t.id })], movimentos: [movimento()] });
  conferir("baixa de título a receber não explica um débito", rodar(ctx, "CB-SAIDA-SEM-TITULO").length, 1);
}
{
  // Mesma empresa, OUTRA conta corrente informada nos dois lados.
  const t = titulo({ contaCorrenteCodigo: "200" });
  const ctx = contexto({ titulos: [t], baixas: [baixa({ tituloId: t.id, contaCorrenteCodigo: "200" })], movimentos: [movimento()] });
  conferir("baixa em outra conta não explica o débito desta", rodar(ctx, "CB-SAIDA-SEM-TITULO").length, 1);
}
{
  // Baixa sem conta informada casa pela empresa, valor e data.
  const t = titulo();
  const ctx = contexto({ titulos: [t], baixas: [baixa({ tituloId: t.id, contaCorrenteCodigo: null })], movimentos: [movimento()] });
  conferir("baixa sem conta informada ainda casa", rodar(ctx, "CB-SAIDA-SEM-TITULO").length, 0);
}
{
  // O CÓDIGO DO LANÇAMENTO na conta corrente é o casamento exato, mesmo com
  // valor diferente (tarifa embutida, por exemplo).
  const t = titulo();
  const ctx = contexto({
    titulos: [t],
    baixas: [baixa({ tituloId: t.id, valorCents: 49_990_00, lancamentoCCCodigo: "M-EXATO" })],
    movimentos: [movimento({ codigoLancamento: "M-EXATO" })],
  });
  conferir("código do lançamento casa mesmo com valor diferente", rodar(ctx, "CB-SAIDA-SEM-TITULO").length, 0);
}

// ------------------------------------------------------- CB-ENTRADA-SEM-TITULO
console.log("\nCB-ENTRADA-SEM-TITULO — crédito no extrato sem título a receber");
{
  const t = titulo({ natureza: "RECEBER", parceiroNome: "CLIENTE" });
  const ctx = contexto({ titulos: [t], baixas: [baixa({ tituloId: t.id })], movimentos: [movimento({ valorCents: 50_000_00, parceiroNome: "CLIENTE" })] });
  conferir("crédito com baixa de título a receber: silêncio", rodar(ctx, "CB-ENTRADA-SEM-TITULO").length, 0);
}
{
  const t = titulo({ natureza: "RECEBER", conexaoId: "y", conexaoApelido: "MCZ" });
  const ctx = contexto({ titulos: [t], baixas: [baixa({ tituloId: t.id, conexaoId: "y" })], movimentos: [movimento({ valorCents: 50_000_00, parceiroNome: "CLIENTE" })] });
  conferir("recebimento da outra empresa não explica o crédito desta", rodar(ctx, "CB-ENTRADA-SEM-TITULO").length, 1);
}

// ------------------------------------------------------ CB-BAIXA-SEM-MOVIMENTO
console.log("\nCB-BAIXA-SEM-MOVIMENTO — título pago sem dinheiro saindo do extrato");
{
  // Extrato só da Azul. A baixa da MCZ sem movimento não é "baixa sem
  // movimento": é extrato não importado, e disso o supervisor trata.
  const azul = titulo();
  const mcz = titulo({ conexaoId: "y", conexaoApelido: "MCZ" });
  const ctx = contexto({
    titulos: [azul, mcz],
    baixas: [baixa({ tituloId: azul.id, valorCents: 80_000_00 }), baixa({ tituloId: mcz.id, conexaoId: "y", valorCents: 80_000_00 })],
    movimentos: [movimento({ valorCents: -1_00 })],
  });
  const a = rodar(ctx, "CB-BAIXA-SEM-MOVIMENTO");
  conferir("só a empresa COM extrato é avaliada", a.length, 1);
  conferir("e a baixa apontada é a da Azul", a[0]?.valorCents, 80_000_00);
}
{
  const t = titulo();
  const ctx = contexto({ titulos: [t], baixas: [baixa({ tituloId: t.id, valorCents: 80_000_00 })], movimentos: [movimento({ valorCents: -80_000_00 })] });
  conferir("baixa com débito igual na mesma empresa e conta: silêncio", rodar(ctx, "CB-BAIXA-SEM-MOVIMENTO").length, 0);
}

console.log(falhas === 0 ? "\nTodos os testes passaram.\n" : `\n${falhas} FALHA(S).\n`);
process.exit(falhas === 0 ? 0 : 1);
