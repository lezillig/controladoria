// TESTES DO AGENTE FISCAL — `npm run teste:fiscal`.
//
// Duas regras nascidas do relatório de Conformidade Fiscal da consultoria
// (Azul, 17/09/2026): o ISS recolhido abaixo do destacado nas NFS-e (a
// consultoria viu R$ 206 em março e R$ 1.237 em abril) e a NF-e de venda de
// mercadoria numa transportadora (o "Tipo 00" que ela chamou de risco
// altíssimo no Bloco K). E o mapeamento que as sustenta: tributo da NFS-e vem
// por item, CFOP da NF-e também.
import type { ContextoAuditoria } from "../src/lib/controladoria/types";
import { agenteFiscal } from "../src/lib/controladoria/agents/fiscal";
import { normalizarNfe, normalizarNfse } from "../src/lib/omie/mapping";

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(
    `${ok ? "  ok  " : "FALHA "} ${nome}` +
      (ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         obtido   ${JSON.stringify(real)}`)
  );
}

const HOJE = new Date("2026-09-20");
const d = (iso: string) => new Date(iso);

type Titulo = ContextoAuditoria["titulos"][number];
type Nota = ContextoAuditoria["notas"][number];
type Categoria = ContextoAuditoria["categorias"][number];

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
    parceiroNome: "PREFEITURA DE SAO PAULO",
    parceiroDocumento: "46395000000139",
    parceiroCodigo: "PMSP",
    categoriaCodigo: "2.01.05",
    categoriaDescricao: null,
    dataEmissao: d("2026-04-01"),
    dataVencimento: d("2026-04-10"),
    valorDocumentoCents: 0,
    valorPagoCents: 0,
    retencaoIrCents: 0,
    retencaoIssCents: 0,
    retencaoPisCents: 0,
    retencaoCofinsCents: 0,
    retencaoCsllCents: 0,
    retencaoInssCents: 0,
    ...p,
  }) as Titulo;

const nota = (p: Partial<Nota> = {}): Nota =>
  ({
    id: `n${++seq}`,
    companyId: "c",
    conexaoId: "x",
    conexaoApelido: "AZUL",
    tipo: "NFSE",
    chave: `NFSE:${seq}:NFSE`,
    numero: String(seq),
    serie: "NFSE",
    chaveAcesso: null,
    dataEmissao: d("2026-03-15"),
    parceiroCodigo: "C1",
    parceiroNome: "CLIENTE",
    valorCents: 100_000_00,
    valorServicosCents: 100_000_00,
    baseIssCents: 100_000_00,
    valorIssCents: 5_000_00,
    valorPisCents: 650_00,
    valorCofinsCents: 3_000_00,
    valorIcmsCents: null,
    valorIpiCents: null,
    valorIrCents: null,
    valorCsllCents: null,
    valorInssCents: null,
    cancelada: false,
    naturezaOperacao: null,
    cfop: null,
    issRetido: false,
    ...p,
  }) as Nota;

const categoriaIss: Categoria = {
  id: "cat1",
  companyId: "c",
  conexaoId: "x",
  conexaoApelido: "AZUL",
  codigo: "2.01.05",
  descricao: "ISS a recolher",
  natureza: null,
  categoriaSuperior: null,
  totalizadora: false,
  inativa: false,
  codigoDre: null,
  tipoCategoria: null,
  contaReceita: false,
  contaDespesa: true,
  sincronizadoEm: HOJE,
};

// Cinquenta títulos de fundo dão materialidade (0,5% das baixas, piso R$ 500).
function fundo(): Titulo[] {
  return Array.from({ length: 50 }, (_, i) =>
    titulo({
      parceiroNome: `FORNECEDOR ${i}`,
      categoriaCodigo: "3.01.01",
      categoriaDescricao: "Manutenção",
      valorDocumentoCents: 2_000_00,
      valorPagoCents: 2_000_00,
      dataVencimento: d("2026-02-10"),
    })
  );
}

function contexto(p: { titulos?: Titulo[]; notas?: Nota[]; categorias?: Categoria[] }): ContextoAuditoria {
  return {
    companyId: "c",
    conexaoId: null,
    dataReferencia: HOJE,
    agora: HOJE,
    janelaDesde: d("2026-01-01"),
    titulos: p.titulos ?? [],
    baixas: [],
    parceiros: [],
    movimentos: [],
    contasCorrentes: [],
    config: { limiteAlcadaCents: 100_000_000_00, saldoMinimoCents: 0 },
    motoristas: [],
    notas: p.notas ?? [],
    categorias: p.categorias ?? [categoriaIss],
    departamentos: [],
    projetos: [],
    vinculos: [],
    abastecimentos: [],
    veiculos: [],
    clientes: [],
    conexoes: [],
    conformidade: { apontamentos: [], documentos: [] },
    gestao: { disponivel: true, erro: null },
  } as unknown as ContextoAuditoria;
}

async function rodar(ctx: ContextoAuditoria, regra: string) {
  return (await agenteFiscal.executar(ctx)).filter((a) => a.regra === regra);
}

// Guia do ISS de março vence em abril.
const guiaAbril = (valor: number) =>
  titulo({ dataEmissao: d("2026-04-05"), dataVencimento: d("2026-04-10"), valorDocumentoCents: valor, valorPagoCents: valor });

(async () => {
  console.log("\n1. FI-ISS-RECOLHIDO-A-MENOR — o caso da consultoria");
  {
    // Março: R$ 1.152.783,85 de serviços, 5% = R$ 57.639,19 destacado; guia R$ 57.432,75.
    const ctx = contexto({
      titulos: [...fundo(), guiaAbril(57_432_75)],
      notas: [
        nota({ dataEmissao: d("2026-03-10"), valorIssCents: 30_000_00 }),
        nota({ dataEmissao: d("2026-03-20"), valorIssCents: 27_639_19 }),
      ],
    });
    const r = await rodar(ctx, "FI-ISS-RECOLHIDO-A-MENOR");
    conferir("guia R$ 206 abaixo do apurado é achado", r.length, 1);
    conferir("a diferença é o valor", r[0]?.valorCents, 206_44);
    conferir("é EVENTO datado na competência", r[0]?.tipo, "EVENTO");
    conferir("chave por competência", r[0]?.chave, "FI-ISS-RECOLHIDO-A-MENOR|2026-03");
    conferir("evidência traz apurado e recolhido", [r[0]?.evidencia?.issApurado, r[0]?.evidencia?.issRecolhido], [57_639_19, 57_432_75]);
  }
  {
    const ctx = contexto({
      titulos: [...fundo(), guiaAbril(57_639_06)],
      notas: [nota({ dataEmissao: d("2026-03-10"), valorIssCents: 57_639_19 })],
    });
    conferir("R$ 0,13 de arredondamento não é achado", (await rodar(ctx, "FI-ISS-RECOLHIDO-A-MENOR")).length, 0);
  }
  {
    const ctx = contexto({
      titulos: [...fundo(), guiaAbril(60_000_00)],
      notas: [nota({ dataEmissao: d("2026-03-10"), valorIssCents: 57_639_19 })],
    });
    conferir("guia a MAIOR não é esta regra", (await rodar(ctx, "FI-ISS-RECOLHIDO-A-MENOR")).length, 0);
  }
  {
    const ctx = contexto({
      titulos: [...fundo(), guiaAbril(30_000_00)],
      notas: [
        nota({ dataEmissao: d("2026-03-10"), valorIssCents: 30_000_00 }),
        nota({ dataEmissao: d("2026-03-12"), valorIssCents: 27_000_00, issRetido: true }),
      ],
    });
    conferir("nota com ISS RETIDO pelo tomador fica fora da conta", (await rodar(ctx, "FI-ISS-RECOLHIDO-A-MENOR")).length, 0);
  }
  {
    const ctx = contexto({
      titulos: [...fundo(), guiaAbril(30_000_00)],
      notas: [
        nota({ dataEmissao: d("2026-03-10"), valorIssCents: 30_000_00 }),
        nota({ dataEmissao: d("2026-03-12"), valorIssCents: 27_000_00, cancelada: true }),
      ],
    });
    conferir("nota cancelada fica fora", (await rodar(ctx, "FI-ISS-RECOLHIDO-A-MENOR")).length, 0);
  }
  {
    const ctx = contexto({
      titulos: [...fundo()],
      notas: [nota({ dataEmissao: d("2026-03-10"), valorIssCents: 57_639_19 })],
    });
    conferir("sem NENHUM título de ISS na base a regra cala (categoria pode ter outro nome)", (await rodar(ctx, "FI-ISS-RECOLHIDO-A-MENOR")).length, 0);
  }
  {
    const ctx = contexto({
      titulos: [...fundo(), guiaAbril(10_00)],
      notas: [nota({ dataEmissao: d("2026-09-10"), valorIssCents: 57_639_19 })],
    });
    conferir("mês corrente não fechou: cala", (await rodar(ctx, "FI-ISS-RECOLHIDO-A-MENOR")).length, 0);
  }
  {
    const ctx = contexto({
      titulos: [...fundo(), guiaAbril(10_00)],
      notas: [nota({ dataEmissao: d("2026-08-10"), valorIssCents: 57_639_19 })],
    });
    conferir("guia de agosto vence em setembro, ainda não venceu: cala", (await rodar(ctx, "FI-ISS-RECOLHIDO-A-MENOR")).length, 0);
  }
  {
    const ctx = contexto({
      titulos: [
        ...fundo(),
        titulo({ dataVencimento: d("2026-04-10"), valorDocumentoCents: 57_639_19, categoriaCodigo: "9.9", categoriaDescricao: "ISS retido de terceiros" }),
        guiaAbril(1_00),
      ],
      notas: [nota({ dataEmissao: d("2026-03-10"), valorIssCents: 57_639_19 })],
    });
    const r = await rodar(ctx, "FI-ISS-RECOLHIDO-A-MENOR");
    conferir("'ISS retido' de terceiros não conta como guia própria", r[0]?.evidencia?.issRecolhido, 1_00);
  }

  console.log("\n2. FI-NFE-VENDA-MERCADORIA — o Bloco K visto pela nota");
  {
    const ctx = contexto({
      titulos: fundo(),
      notas: [
        nota({ tipo: "NFE", chave: "NFE:1:1", dataEmissao: d("2026-05-03"), cfop: "5102", valorCents: 20_000_00 }),
        nota({ tipo: "NFE", chave: "NFE:2:1", dataEmissao: d("2026-05-09"), cfop: "6102", valorCents: 15_000_00 }),
        nota({ tipo: "NFE", chave: "NFE:3:1", dataEmissao: d("2026-05-20"), cfop: "5949", valorCents: 9_000_00 }),
        nota({ tipo: "NFE", chave: "NFE:4:1", dataEmissao: d("2026-06-02"), cfop: "5551", valorCents: 80_000_00 }),
      ],
    });
    const r = await rodar(ctx, "FI-NFE-VENDA-MERCADORIA");
    conferir("um achado por mês com CFOP de venda", r.length, 1);
    conferir("só as duas notas de venda entram", r[0]?.evidencia?.quantidade, 2);
    conferir("soma das duas", r[0]?.valorCents, 35_000_00);
    conferir("remessa (5949) e venda de ativo (5551) ficam de fora", /5949|5551/.test(JSON.stringify(r[0]?.evidencia)), false);
    conferir("chave por mês", r[0]?.chave, "FI-NFE-VENDA-MERCADORIA|2026-05");
    conferir("acima da materialidade é MÉDIA", r[0]?.severidade, "MEDIA");
  }
  {
    const ctx = contexto({
      titulos: fundo(),
      notas: [nota({ tipo: "NFE", chave: "NFE:1:1", dataEmissao: d("2026-05-03"), cfop: "5102", valorCents: 200_00 })],
    });
    conferir("abaixo da materialidade é BAIXA", (await rodar(ctx, "FI-NFE-VENDA-MERCADORIA"))[0]?.severidade, "BAIXA");
  }
  {
    const ctx = contexto({
      titulos: fundo(),
      notas: [
        nota({ tipo: "NFE", chave: "NFE:1:1", dataEmissao: d("2026-05-03"), cfop: "5102", cancelada: true }),
        nota({ tipo: "NFE", chave: "NFE:2:1", dataEmissao: d("2026-05-03"), cfop: null }),
        nota({ tipo: "NFSE", chave: "NFSE:3:1", dataEmissao: d("2026-05-03"), cfop: "5102" }),
      ],
    });
    conferir("cancelada, sem CFOP e NFS-e não contam", (await rodar(ctx, "FI-NFE-VENDA-MERCADORIA")).length, 0);
  }

  console.log("\n3. Mapeamento — o que sustenta as duas regras");
  {
    // NFS-e como ListarNFSEs devolve na conta: tributos por item, retenção em Valores.
    const m = normalizarNfse({
      Cabecalho: { nNumeroNFSe: 1234, nValorNFSe: 1000, cStatusNFSe: "F", cRazaoDestinatario: "CLIENTE", nCodigoCliente: 9 },
      Emissao: { cDataEmissao: "10/03/2026" },
      Valores: { cIssRetido: "N", nValorLiquido: 953.5, nValorTotalServicos: 1000 },
      RPS: { cSerieRPS: "NFSE" },
      ListaServicos: [
        { nValorServico: 600, nValorISS: 30, nValorPIS: 3.9, nValorCOFINS: 18, nValorIR: 0, nValorCSLL: 0, nValorINSS: 0 },
        { nValorServico: 400, nValorISS: 20, nValorPIS: 2.6, nValorCOFINS: 12, nValorIR: 0, nValorCSLL: 0, nValorINSS: 0 },
      ],
    });
    conferir("ISS somado dos itens", m?.valorIssCents, 50_00);
    conferir("PIS somado dos itens", m?.valorPisCents, 6_50);
    conferir("COFINS somado dos itens", m?.valorCofinsCents, 30_00);
    conferir("base do ISS = soma dos serviços", m?.baseIssCents, 1000_00);
    conferir("ISS não retido", m?.issRetido, false);
    conferir("cIssRetido=S vira retido", normalizarNfse({
      Cabecalho: { nNumeroNFSe: 1, nValorNFSe: 10 }, Emissao: { cDataEmissao: "10/03/2026" }, Valores: { cIssRetido: "S" },
    })?.issRetido, true);
    conferir("sem marcador, retenção fica nula", normalizarNfse({
      Cabecalho: { nNumeroNFSe: 1, nValorNFSe: 10 }, Emissao: { cDataEmissao: "10/03/2026" },
    })?.issRetido, null);
  }
  {
    const nfe = normalizarNfe({
      ide: { nNF: "77", serie: "1", dEmi: "03/05/2026" },
      total: { ICMSTot: { vNF: 20000, vICMS: 0 } },
      det: [{ prod: { CFOP: "5102", xProd: "A" } }, { prod: { CFOP: "5102", xProd: "B" } }, { prod: { CFOP: "5949", xProd: "C" } }],
    });
    conferir("CFOP da NF-e é o mais frequente entre os itens", nfe?.cfop, "5102");
    conferir("NF-e sem itens fica sem CFOP", normalizarNfe({ ide: { nNF: "78", dEmi: "03/05/2026" }, total: { ICMSTot: { vNF: 1 } } })?.cfop, null);
  }

  console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTodos os testes passaram.");
  process.exit(falhas ? 1 : 0);
})();
