// TESTES DE CONTRATOS DE SERVIÇO E CT-e — `npm run teste:contratos`.
//
// Sem banco e sem Omie: um JSON bruto plausível por endpoint (nomes tirados do
// WSDL) para os normalizadores, e contexto montado à mão para as regras. Cada
// regra tem o caso que precisa apontar e o caso legítimo que precisa deixar em
// paz — inclusive a condição de silêncio (base sem contrato, título sem elo
// com contrato, CT-e não espelhado), que num sistema de auditoria importa
// tanto quanto o achado.
import { auditarContratos } from "../src/lib/controladoria/agents/contratos";
import { agenteFiscal } from "../src/lib/controladoria/agents/fiscal";
import { supervisionar } from "../src/lib/controladoria/supervisor";
import type { AchadoNovo, ContextoAuditoria } from "../src/lib/controladoria/types";
import {
  cteAutorizado,
  cteCancelado,
  hashCamposContrato,
  normalizarContrato,
  normalizarCte,
} from "../src/lib/omie/mapping";
import type { VersaoContrato } from "../src/lib/omie/types";

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

// ------------------------------------------------------------ normalizadores
console.log("\nnormalizarContrato — ListarContratos como o WSDL descreve");
const CONTRATO_BRUTO = {
  cabecalho: {
    nCodCtr: 123456,
    cCodIntCtr: "CTR-2026-01",
    nCodCli: 987,
    cNumCtr: "000123",
    cCodSit: "10",
    dVigInicial: "01/01/2026",
    dVigFinal: "31/12/2026",
    nDiaFat: 10,
    nValTotMes: 45000.5,
    cTipoFat: "01",
  },
  itensContrato: [
    {
      itemCabecalho: {
        codServico: 1,
        quant: 22,
        valorUnit: 2045.48,
        valorTotal: 45000.5,
        valorDesconto: 0,
        aliqDesconto: 0,
        cCodCategItem: "1.01.02",
      },
    },
  ],
  infAdic: { cCodCateg: "1.01.02", nCodCC: 1, nCodProj: 0, nCodVend: 0 },
  infoCadastro: { dInc: "15/12/2025", uInc: "maria", dAlt: "20/08/2026", uAlt: "joao" },
};
{
  const c = normalizarContrato(CONTRATO_BRUTO)!;
  conferir("código interno é nCodCtr", c.codigoOmie, "123456");
  conferir("número é cNumCtr", c.numero, "000123");
  conferir("cliente é nCodCli", c.parceiroCodigo, "987");
  conferir("situação crua e legível", [c.situacao, c.situacaoDescricao], ["10", "Ativo"]);
  conferir("vigência em data local", [c.vigenciaInicio?.getDate(), c.vigenciaFim?.getMonth()], [1, 11]);
  conferir("dia de faturamento", c.diaFaturamento, 10);
  conferir("valor mensal em centavos", c.valorMensalCents, 4_500_050);
  conferir("periodicidade", c.periodicidade, "01");
  conferir("categoria vem de infAdic", c.categoriaCodigo, "1.01.02");
  conferir("um item, com valor unitário em centavos", [c.itens.length, c.itens[0]?.valorUnitarioCents], [1, 204_548]);
  conferir("quem incluiu e quem alterou", [c.usuarioInclusao, c.usuarioAlteracao], ["maria", "joao"]);
  conferir("data da alteração", c.alteradoEmOmie?.toISOString().slice(0, 10), "2026-08-20");
  conferir("hash é SHA-256", /^[0-9a-f]{64}$/.test(c.hashCampos), true);
  conferir("hash é estável", normalizarContrato(CONTRATO_BRUTO)!.hashCampos, c.hashCampos);
}
{
  const alterado = { ...CONTRATO_BRUTO, cabecalho: { ...CONTRATO_BRUTO.cabecalho, nValTotMes: 40000 } };
  conferir("valor mensal diferente muda o hash", normalizarContrato(alterado)!.hashCampos !== normalizarContrato(CONTRATO_BRUTO)!.hashCampos, true);
  const soUsuario = { ...CONTRATO_BRUTO, infoCadastro: { ...CONTRATO_BRUTO.infoCadastro, uAlt: "outro" } };
  conferir("trocar só o usuário NÃO muda o hash", normalizarContrato(soUsuario)!.hashCampos, normalizarContrato(CONTRATO_BRUTO)!.hashCampos);
}
{
  const semValorMensal = { ...CONTRATO_BRUTO, cabecalho: { ...CONTRATO_BRUTO.cabecalho, nValTotMes: undefined } };
  conferir("sem nValTotMes, soma dos itens", normalizarContrato(semValorMensal)!.valorMensalCents, 4_500_050);
  // Achatado (sem `cabecalho`) e com a chave da situação vindo com espaço no
  // fim, como a NF-e real devolve `vRetPrev ` — a busca tolerante precisa ler.
  const achatado = { ...Object.fromEntries(Object.entries(CONTRATO_BRUTO.cabecalho).filter(([k]) => k !== "cCodSit")), "cCodSit ": "90" };
  conferir("resposta achatada e chave com espaço no fim ainda lê", normalizarContrato(achatado)?.situacaoDescricao, "Suspenso");
  conferir("sem nCodCtr é descartado", normalizarContrato({ cabecalho: { cNumCtr: "1" } }), null);
  conferir("situação desconhecida fica com o código", normalizarContrato({ cabecalho: { nCodCtr: 1, cCodSit: "20" } })?.situacaoDescricao, "20");
  conferir(
    "hash direto reproduz o do normalizador",
    hashCamposContrato({ situacao: "10", valorMensalCents: 4_500_050, vigenciaInicio: d("2026-01-01T03:00:00Z"), vigenciaFim: d("2026-12-31T03:00:00Z"), itens: normalizarContrato(CONTRATO_BRUTO)!.itens }),
    normalizarContrato(CONTRATO_BRUTO)!.hashCampos
  );
}

console.log("\nnormalizarCte — ListarDocumentos do painel do contador");
const CHAVE = "35260112345678000199570010000011611000011615";
const CTE_BRUTO = {
  nNumero: 1161,
  cSerie: "1",
  nChave: CHAVE,
  dEmissao: "23/01/2026",
  hEmissao: "10:15:00",
  nValor: 218497.5,
  cXml: "<cteProc>…</cteProc>",
  nIdCT: 555,
  nIdNF: 0,
  cStatus: "00",
};
{
  const c = normalizarCte(CTE_BRUTO, "57")!;
  conferir("chave de acesso de 44 dígitos", c.chave, CHAVE);
  conferir("número, série e modelo", [c.numero, c.serie, c.modelo], ["1161", "1", "57"]);
  conferir("valor em centavos", c.valorCents, 21_849_750);
  conferir("data local", c.dataEmissao.toISOString().slice(0, 10), "2026-01-23");
  conferir("autorizado", [c.status, c.cancelado], ["00", false]);
  conferir("id interno", c.idOmie, "555");
  conferir("o XML não é lido", "cXml" in c, false);
}
{
  conferir("cStatus 10 é cancelado", normalizarCte({ ...CTE_BRUTO, cStatus: "10" }, "57")?.cancelado, true);
  conferir("cStatus 20 (denegado) não é cancelado nem autorizado", [cteCancelado("20"), cteAutorizado("20")], [false, false]);
  conferir("sem status conta como autorizado", cteAutorizado(null), true);
  conferir('"Cancelada" em texto é cancelado', cteCancelado("Cancelada"), true);
  conferir('"Cancelamento Rejeitado" NÃO é', cteCancelado("Cancelamento Rejeitado"), false);
  conferir("sem chave, monta modelo:numero:serie", normalizarCte({ ...CTE_BRUTO, nChave: 0 }, "67")?.chave, "67:1161:1");
  conferir("sem data é descartado", normalizarCte({ ...CTE_BRUTO, dEmissao: "" }, "57"), null);
  conferir("sem chave e sem número é descartado", normalizarCte({ dEmissao: "01/01/2026", nValor: 10 }, "57"), null);
}

// ------------------------------------------------------------------ fixtures
type Titulo = ContextoAuditoria["titulos"][number];
type Contrato = NonNullable<ContextoAuditoria["contratos"]>[number];
type Cte = NonNullable<ContextoAuditoria["ctes"]>[number];

let seq = 0;
const titulo = (p: Partial<Titulo> = {}): Titulo =>
  ({
    id: `t${++seq}`,
    companyId: "c",
    conexaoId: "x",
    conexaoApelido: "AZUL",
    natureza: "RECEBER",
    codigoLancamento: `L${seq}`,
    cancelado: false,
    liquidado: false,
    status: "ABERTO",
    parceiroNome: "PREFEITURA MUNICIPAL DE CAJAMAR",
    parceiroDocumento: "46523023000181",
    parceiroCodigo: "P1",
    numeroDocumento: null,
    numeroParcela: null,
    tipoDocumento: null,
    chaveNfe: null,
    contratoCodigo: null,
    dataEmissao: d("2026-07-10"),
    dataVencimento: d("2026-07-20"),
    dataUltimaBaixa: null,
    valorDocumentoCents: 50_000_00,
    saldoCents: 50_000_00,
    valorPagoCents: 0,
    jurosCents: 0,
    multaCents: 0,
    descontoCents: 0,
    tarifaCents: 0,
    ...p,
  }) as Titulo;

const contrato = (p: Partial<Contrato> = {}): Contrato =>
  ({
    id: `c${++seq}`,
    companyId: "c",
    conexaoId: "x",
    conexaoApelido: "AZUL",
    codigoOmie: "C1",
    codigoIntegracao: null,
    numero: "1001",
    parceiroCodigo: "P1",
    parceiroNome: "PREFEITURA MUNICIPAL DE CAJAMAR",
    situacao: "10",
    situacaoDescricao: "Ativo",
    vigenciaInicio: d("2026-01-01"),
    vigenciaFim: d("2026-12-31"),
    diaFaturamento: 10,
    valorMensalCents: 50_000_00,
    periodicidade: "01",
    categoriaCodigo: null,
    itens: [],
    usuarioInclusao: "maria",
    usuarioAlteracao: null,
    dataInclusaoOmie: d("2025-12-15"),
    alteradoEmOmie: null,
    hashCampos: "h",
    versoes: [],
    sincronizadoEm: HOJE,
    ...p,
  }) as Contrato;

const cte = (p: Partial<Cte> = {}): Cte =>
  ({
    id: `e${++seq}`,
    companyId: "c",
    conexaoId: "x",
    conexaoApelido: "AZUL",
    chave: `3526011234567800019957001000001${String(1000 + seq).padStart(4, "0")}100001${String(seq).padStart(4, "0")}`.slice(0, 44),
    numero: "1151",
    serie: "1",
    modelo: "57",
    dataEmissao: d("2026-07-02"),
    valorCents: 82_000_00,
    status: "00",
    cancelado: false,
    idOmie: null,
    sincronizadoEm: HOJE,
    ...p,
  }) as Cte;

function contexto(p: { titulos?: Titulo[]; contratos?: Contrato[]; ctes?: Cte[] }): ContextoAuditoria {
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
    contratos: p.contratos,
    ctes: p.ctes,
  } as unknown as ContextoAuditoria;
}

const rodar = (ctx: ContextoAuditoria, regra: string) => auditarContratos(ctx).filter((a) => a.regra === regra);
// Um título ligado a OUTRO contrato: prova que a base liga título a contrato,
// sem interferir no contrato sob teste.
const eloDeFundo = () => titulo({ contratoCodigo: "C9", parceiroCodigo: "P9", dataEmissao: d("2026-07-05") });

// ----------------------------------------------- CR-CONTRATO-SEM-FATURAMENTO
console.log("\nCR-CONTRATO-SEM-FATURAMENTO — contrato ativo, mês sem título");
{
  const ctx = contexto({ contratos: [contrato()], titulos: [eloDeFundo()] });
  const r = rodar(ctx, "CR-CONTRATO-SEM-FATURAMENTO");
  conferir("julho fechado e agosto (dia 25 > 10 + 5) sem título: dois achados", r.length, 2);
  conferir("chave carrega a competência", r[0]?.chave, "CR-CONTRATO-SEM-FATURAMENTO|AZUL|C1|2026-07");
  conferir("valor é o mensal do contrato", r[0]?.valorCents, 50_000_00);
  conferir("é receita esperada, não cobrada", r[0]?.categoria, "PERDA_FINANCEIRA");
}
{
  const ctx = contexto({ contratos: [contrato()], titulos: [eloDeFundo(), titulo({ contratoCodigo: "C1", dataEmissao: d("2026-07-12") })] });
  conferir("com título em julho, sobra só agosto", rodar(ctx, "CR-CONTRATO-SEM-FATURAMENTO").map((a) => a.chave), ["CR-CONTRATO-SEM-FATURAMENTO|AZUL|C1|2026-08"]);
}
{
  const ctx = contexto({
    contratos: [contrato()],
    titulos: [eloDeFundo(), titulo({ contratoCodigo: "1001", dataEmissao: d("2026-07-12") }), titulo({ contratoCodigo: "C1", dataEmissao: d("2026-08-11") })],
  });
  conferir("elo pelo número do contrato (cNumCtr) também vale; faturado nos dois meses: nada", rodar(ctx, "CR-CONTRATO-SEM-FATURAMENTO").length, 0);
}
{
  const ctx = contexto({ contratos: [contrato({ diaFaturamento: 25 })], titulos: [eloDeFundo()] });
  conferir("dia de faturamento 25 em 25/08: agosto ainda não é cobrado", rodar(ctx, "CR-CONTRATO-SEM-FATURAMENTO").length, 1);
}
{
  const ctx = contexto({ contratos: [contrato({ vigenciaInicio: d("2026-07-15") })], titulos: [eloDeFundo()] });
  conferir("contrato que começou no meio de julho não deve julho", rodar(ctx, "CR-CONTRATO-SEM-FATURAMENTO").map((a) => a.chave), ["CR-CONTRATO-SEM-FATURAMENTO|AZUL|C1|2026-08"]);
}
{
  conferir("trimestral fica de fora", rodar(contexto({ contratos: [contrato({ periodicidade: "03" })], titulos: [eloDeFundo()] }), "CR-CONTRATO-SEM-FATURAMENTO").length, 0);
  conferir("suspenso fica de fora", rodar(contexto({ contratos: [contrato({ situacao: "90" })], titulos: [eloDeFundo()] }), "CR-CONTRATO-SEM-FATURAMENTO").length, 0);
  conferir("sem valor mensal fica de fora", rodar(contexto({ contratos: [contrato({ valorMensalCents: 0 })], titulos: [eloDeFundo()] }), "CR-CONTRATO-SEM-FATURAMENTO").length, 0);
  conferir("periodicidade nula conta como mensal", rodar(contexto({ contratos: [contrato({ periodicidade: null })], titulos: [eloDeFundo()] }), "CR-CONTRATO-SEM-FATURAMENTO").length, 2);
}
{
  // Nenhum título da base tem contratoCodigo: o espelho não liga título a
  // contrato (coluna nova, linhas antigas). Acusar "sem faturamento" aqui
  // seria acusar todos os contratos de uma vez.
  const ctx = contexto({ contratos: [contrato()], titulos: [titulo({ dataEmissao: d("2026-07-12") })] });
  conferir("sem elo título→contrato em nenhum título, fica calada", rodar(ctx, "CR-CONTRATO-SEM-FATURAMENTO").length, 0);
  conferir("sem contrato na base, o agente devolve vazio", auditarContratos(contexto({ titulos: [eloDeFundo()] })).length, 0);
}

// ---------------------------------------------- CR-CONTRATO-FATURADO-A-MENOR
console.log("\nCR-CONTRATO-FATURADO-A-MENOR — julho faturado abaixo de 90%");
{
  const ctx = contexto({ contratos: [contrato()], titulos: [titulo({ contratoCodigo: "C1", dataEmissao: d("2026-07-12"), valorDocumentoCents: 40_000_00 })] });
  const r = rodar(ctx, "CR-CONTRATO-FATURADO-A-MENOR");
  conferir("80% do contratado é achado", r.length, 1);
  conferir("valor é a diferença", r[0]?.valorCents, 10_000_00);
  conferir("chave por contrato e competência", r[0]?.chave, "CR-CONTRATO-FATURADO-A-MENOR|AZUL|C1|2026-07");
}
{
  const ctx = contexto({ contratos: [contrato()], titulos: [titulo({ contratoCodigo: "C1", dataEmissao: d("2026-07-12"), valorDocumentoCents: 46_000_00 })] });
  conferir("92% está dentro da tolerância", rodar(ctx, "CR-CONTRATO-FATURADO-A-MENOR").length, 0);
}
{
  const ctx = contexto({
    contratos: [contrato()],
    titulos: [
      titulo({ contratoCodigo: "C1", dataEmissao: d("2026-07-05"), valorDocumentoCents: 25_000_00 }),
      titulo({ contratoCodigo: "C1", dataEmissao: d("2026-07-20"), valorDocumentoCents: 25_000_00 }),
    ],
  });
  conferir("duas parcelas que somam o mensal não são achado", rodar(ctx, "CR-CONTRATO-FATURADO-A-MENOR").length, 0);
}
{
  const ctx = contexto({ contratos: [contrato()], titulos: [eloDeFundo()] });
  conferir("sem título nenhum é da outra regra, não desta", rodar(ctx, "CR-CONTRATO-FATURADO-A-MENOR").length, 0);
}

// --------------------------------------------- CR-CONTRATO-INATIVO-FATURADO
console.log("\nCR-CONTRATO-INATIVO-FATURADO — cobrança em contrato morto");
{
  const c = contrato({ situacao: "99", situacaoDescricao: "Cancelado", alteradoEmOmie: d("2026-06-01") });
  const t = titulo({ contratoCodigo: "C1", dataEmissao: d("2026-07-05") });
  const r = rodar(contexto({ contratos: [c], titulos: [t] }), "CR-CONTRATO-INATIVO-FATURADO");
  conferir("título emitido depois do cancelamento é achado", r.length, 1);
  conferir("é EVENTO com a data da emissão", [r[0]?.tipo, r[0]?.dataReferencia?.toISOString().slice(0, 10)], ["EVENTO", "2026-07-05"]);
  conferir("chave é o título", r[0]?.chave, `CR-CONTRATO-INATIVO-FATURADO|AZUL:${t.codigoLancamento}`);
}
{
  const c = contrato({ situacao: "99", alteradoEmOmie: d("2026-06-01") });
  const t = titulo({ contratoCodigo: "C1", dataEmissao: d("2026-05-05"), liquidado: true, valorPagoCents: 50_000_00, saldoCents: 0 });
  conferir("título anterior ao cancelamento não é achado", rodar(contexto({ contratos: [c], titulos: [t] }), "CR-CONTRATO-INATIVO-FATURADO").length, 0);
}
{
  // Sem data de alteração na Omie: o critério é o título estar em aberto.
  const c = contrato({ situacao: "90", situacaoDescricao: "Suspenso" });
  const aberto = titulo({ contratoCodigo: "C1", dataEmissao: d("2026-05-05") });
  const quitado = titulo({ contratoCodigo: "C1", dataEmissao: d("2026-05-05"), liquidado: true, valorPagoCents: 50_000_00, saldoCents: 0 });
  conferir("sem dAlt, título em aberto no contrato suspenso é achado", rodar(contexto({ contratos: [c], titulos: [aberto] }), "CR-CONTRATO-INATIVO-FATURADO").length, 1);
  conferir("sem dAlt, título já quitado fica em paz", rodar(contexto({ contratos: [c], titulos: [quitado] }), "CR-CONTRATO-INATIVO-FATURADO").length, 0);
}
{
  const c = contrato({ vigenciaFim: d("2026-06-30") });
  const t = titulo({ contratoCodigo: "C1", dataEmissao: d("2026-07-05") });
  const r = rodar(contexto({ contratos: [c], titulos: [t] }), "CR-CONTRATO-INATIVO-FATURADO");
  conferir("contrato ativo com vigência vencida também é achado", r.length, 1);
  conferir("e o título diz 'vencido'", r[0]?.titulo.includes("vencido"), true);
}
{
  const c = contrato({ situacao: "99" });
  const t = titulo({ contratoCodigo: "C1", conexaoId: "y", conexaoApelido: "MCZ", dataEmissao: d("2026-07-05") });
  conferir("mesmo código em outra conta Omie não liga", rodar(contexto({ contratos: [c], titulos: [t] }), "CR-CONTRATO-INATIVO-FATURADO").length, 0);
}

// ------------------------------------------------------ CR-CONTRATO-ALTERADO
console.log("\nCR-CONTRATO-ALTERADO — valor reduzido em silêncio");
const versao = (p: Partial<VersaoContrato>): VersaoContrato => ({
  vistoEm: "2026-07-01T06:00:00.000Z",
  hashCampos: "h1",
  valorMensalCents: 50_000_00,
  situacao: "10",
  usuarioAlteracao: "maria",
  alteradoEmOmie: null,
  ...p,
});
{
  const c = contrato({
    valorMensalCents: 40_000_00,
    usuarioAlteracao: "joao",
    versoes: [versao({}), versao({ vistoEm: "2026-08-10T06:00:00.000Z", hashCampos: "h2", valorMensalCents: 40_000_00, usuarioAlteracao: "joao", alteradoEmOmie: "2026-08-09T03:00:00.000Z" })] as unknown as Contrato["versoes"],
  });
  const r = rodar(contexto({ contratos: [c], titulos: [] }), "CR-CONTRATO-ALTERADO");
  conferir("queda de R$ 50 mil para R$ 40 mil é achado", r.length, 1);
  conferir("diz quem alterou", r[0]?.evidencia?.alteradoPor, "joao");
  conferir("valor é a redução mensal", r[0]?.valorCents, 10_000_00);
  conferir("nunca abaixo de MÉDIA", ["MEDIA", "ALTA", "CRITICA"].includes(r[0]?.severidade ?? ""), true);
  conferir("um por alteração, com a data na chave", r[0]?.chave, "CR-CONTRATO-ALTERADO|AZUL|C1|2026-08-10");
  conferir("data do fato é a da alteração na Omie", r[0]?.dataReferencia?.toISOString().slice(0, 10), "2026-08-09");
}
{
  const c = contrato({ versoes: [versao({}), versao({ vistoEm: "2026-08-10T06:00:00.000Z", hashCampos: "h2", valorMensalCents: 55_000_00, usuarioAlteracao: "joao" })] as unknown as Contrato["versoes"] });
  conferir("aumento não é achado", rodar(contexto({ contratos: [c] }), "CR-CONTRATO-ALTERADO").length, 0);
}
{
  const c = contrato({ situacao: "90", versoes: [versao({}), versao({ vistoEm: "2026-08-10T06:00:00.000Z", hashCampos: "h2", situacao: "90", usuarioAlteracao: "joao" })] as unknown as Contrato["versoes"] });
  const r = rodar(contexto({ contratos: [c] }), "CR-CONTRATO-ALTERADO");
  conferir("suspensão é achado", r.length, 1);
  conferir("com o valor mensal que deixou de valer", r[0]?.valorCents, 50_000_00);
}
{
  const c = contrato({ usuarioAlteracao: null, versoes: [versao({}), versao({ vistoEm: "2026-08-10T06:00:00.000Z", hashCampos: "h2", valorMensalCents: 40_000_00, usuarioAlteracao: null })] as unknown as Contrato["versoes"] });
  conferir("sem usuário de alteração (a conta não devolve infoCadastro), fica calada", rodar(contexto({ contratos: [c] }), "CR-CONTRATO-ALTERADO").length, 0);
}
{
  const c = contrato({ versoes: [versao({})] as unknown as Contrato["versoes"] });
  conferir("uma versão só (primeira vez vista) não é alteração", rodar(contexto({ contratos: [c] }), "CR-CONTRATO-ALTERADO").length, 0);
}

// ------------------------------------------------------ CR-CONTRATO-VENCENDO
console.log("\nCR-CONTRATO-VENCENDO — vigência nos próximos 60 dias");
{
  const r = rodar(contexto({ contratos: [contrato({ vigenciaFim: d("2026-09-30") })] }), "CR-CONTRATO-VENCENDO");
  conferir("vence em 36 dias: INFO", [r.length, r[0]?.severidade], [1, "INFO"]);
  conferir("chave só por contrato", r[0]?.chave, "CR-CONTRATO-VENCENDO|AZUL|C1");
  conferir("evidência diz quantos dias", r[0]?.evidencia?.diasParaVencer, 36);
}
{
  conferir("dezembro ainda não", rodar(contexto({ contratos: [contrato()] }), "CR-CONTRATO-VENCENDO").length, 0);
  conferir("já vencido é da outra regra", rodar(contexto({ contratos: [contrato({ vigenciaFim: d("2026-06-30") })] }), "CR-CONTRATO-VENCENDO").length, 0);
  conferir("cancelado não vence", rodar(contexto({ contratos: [contrato({ situacao: "99", vigenciaFim: d("2026-09-30") })] }), "CR-CONTRATO-VENCENDO").length, 0);
  conferir("sem vigência final não vence", rodar(contexto({ contratos: [contrato({ vigenciaFim: null })] }), "CR-CONTRATO-VENCENDO").length, 0);
}

// ------------------------------------------------------------- CT-e no fiscal
const rodarFiscal = (ctx: ContextoAuditoria, regra: string) => (agenteFiscal.executar(ctx) as AchadoNovo[]).filter((a) => a.regra === regra);

console.log("\nFI-CTE-CANCELADO-COM-TITULO — documento cancelado, cobrança viva");
{
  const c = cte({ numero: "1151", cancelado: true, status: "10" });
  const t = titulo({ numeroDocumento: "CTE 001151", valorDocumentoCents: 82_000_00, dataEmissao: d("2026-07-02") });
  const r = rodarFiscal(contexto({ ctes: [c], titulos: [t] }), "FI-CTE-CANCELADO-COM-TITULO");
  conferir("casado pelo número sujo é achado", r.length, 1);
  conferir("EVENTO na data de emissão do CT-e", [r[0]?.tipo, r[0]?.dataReferencia?.toISOString().slice(0, 10)], ["EVENTO", "2026-07-02"]);
  conferir("evidência diz como casou", r[0]?.evidencia?.casadoPor, "número");
  conferir("chave é a chave de acesso", r[0]?.chave, `FI-CTE-CANCELADO-COM-TITULO|AZUL|${c.chave}`);
}
{
  const c = cte({ numero: null, cancelado: true, status: "10" });
  const t = titulo({ chaveNfe: c.chave, numeroDocumento: null, valorDocumentoCents: 82_000_00 });
  const r = rodarFiscal(contexto({ ctes: [c], titulos: [t] }), "FI-CTE-CANCELADO-COM-TITULO");
  conferir("casado pela chave de acesso (cChaveNFe do título)", r[0]?.evidencia?.casadoPor, "chave");
}
{
  // Cancelado e reemitido no mesmo dia, mesmo valor; o título não tem número.
  // O casamento fraco tem de prender o título ao documento vivo.
  const morto = cte({ numero: "1151", cancelado: true, status: "10" });
  const vivo = cte({ numero: "1154", dataEmissao: d("2026-07-02") });
  const t = titulo({ numeroDocumento: null, valorDocumentoCents: 82_000_00, dataEmissao: d("2026-07-03") });
  const ctx = contexto({ ctes: [morto, vivo], titulos: [t] });
  conferir("substituto fica com o título; o cancelado não acusa", rodarFiscal(ctx, "FI-CTE-CANCELADO-COM-TITULO").length, 0);
  conferir("e o vivo não aparece como sem título", rodarFiscal(ctx, "FI-CTE-SEM-TITULO").length, 0);
}
{
  conferir("cancelado sem título é o caso certo", rodarFiscal(contexto({ ctes: [cte({ cancelado: true, status: "10" })], titulos: [] }), "FI-CTE-CANCELADO-COM-TITULO").length, 0);
}

console.log("\nFI-CTE-SEM-TITULO — frete documentado, ninguém cobrou");
{
  const c = cte({ numero: "1200", dataEmissao: d("2026-08-10"), valorCents: 11_950_00 });
  const r = rodarFiscal(contexto({ ctes: [c], titulos: [] }), "FI-CTE-SEM-TITULO");
  conferir("15 dias sem título é achado", r.length, 1);
  conferir("ESTADO, com o valor do frete", [r[0]?.tipo, r[0]?.valorCents], ["ESTADO", 11_950_00]);
}
{
  conferir("3 dias ainda não", rodarFiscal(contexto({ ctes: [cte({ dataEmissao: d("2026-08-22") })], titulos: [] }), "FI-CTE-SEM-TITULO").length, 0);
  const c = cte({ numero: "1200", dataEmissao: d("2026-08-10") });
  const fraco = titulo({ numeroDocumento: null, valorDocumentoCents: 82_000_00, dataEmissao: d("2026-08-14") });
  conferir("título de mesmo valor 4 dias depois casa (fraco) e cala", rodarFiscal(contexto({ ctes: [c], titulos: [fraco] }), "FI-CTE-SEM-TITULO").length, 0);
  conferir("pendente (40) não é documento válido", rodarFiscal(contexto({ ctes: [cte({ status: "40", dataEmissao: d("2026-08-10") })], titulos: [] }), "FI-CTE-SEM-TITULO").length, 0);
  const outraConta = titulo({ conexaoId: "y", conexaoApelido: "MCZ", numeroDocumento: "1200", valorDocumentoCents: 82_000_00, dataEmissao: d("2026-08-10") });
  conferir("título da outra conta Omie não casa", rodarFiscal(contexto({ ctes: [c], titulos: [outraConta] }), "FI-CTE-SEM-TITULO").length, 1);
}

console.log("\nFI-CTE-VALOR-DIVERGENTE — cobrança diferente do documento");
{
  const c = cte({ numero: "1150", dataEmissao: d("2026-07-02"), valorCents: 102_449_20 });
  const t = titulo({ numeroDocumento: "1150", valorDocumentoCents: 110_066_85, dataEmissao: d("2026-07-02") });
  const r = rodarFiscal(contexto({ ctes: [c], titulos: [t] }), "FI-CTE-VALOR-DIVERGENTE");
  conferir("R$ 7.617,65 acima do documento (o caso CAJAMAR)", [r.length, r[0]?.evidencia?.diferencaCents], [1, 761_765]);
  conferir("título 'acima'", r[0]?.titulo.includes("acima"), true);
}
{
  const c = cte({ numero: "1150", dataEmissao: d("2026-07-02"), valorCents: 102_449_20 });
  const quase = titulo({ numeroDocumento: "1150", valorDocumentoCents: 102_500_00, dataEmissao: d("2026-07-02") });
  conferir("R$ 50,80 em R$ 102 mil (0,05%) não é divergência", rodarFiscal(contexto({ ctes: [c], titulos: [quase] }), "FI-CTE-VALOR-DIVERGENTE").length, 0);
  const pequeno = cte({ numero: "77", dataEmissao: d("2026-07-02"), valorCents: 100_00 });
  const oitoReais = titulo({ numeroDocumento: "77", valorDocumentoCents: 108_00, dataEmissao: d("2026-07-02") });
  conferir("8% mas menos de R$ 10 não é divergência", rodarFiscal(contexto({ ctes: [pequeno], titulos: [oitoReais] }), "FI-CTE-VALOR-DIVERGENTE").length, 0);
  const abaixo = titulo({ numeroDocumento: "1150", valorDocumentoCents: 90_000_00, dataEmissao: d("2026-07-02") });
  const r = rodarFiscal(contexto({ ctes: [c], titulos: [abaixo] }), "FI-CTE-VALOR-DIVERGENTE");
  conferir("abaixo do documento é receita na mesa: impacto preenchido", r[0]?.impactoCents, 12_449_20);
}
{
  conferir("sem CT-e no contexto, o fiscal não emite nada de CT-e", (agenteFiscal.executar(contexto({ titulos: [titulo()] })) as AchadoNovo[]).filter((a) => a.regra.startsWith("FI-CTE")).length, 0);
}

// ---------------------------------------------------------------- supervisor
console.log("\nSupervisor — regras caladas quando a base não tem o dado");
{
  const achados: AchadoNovo[] = [
    { regra: "CR-CONTRATO-VENCENDO", tipo: "ESTADO", severidade: "INFO", categoria: "RISCO_FINANCEIRO", titulo: "x", descricao: "x", chave: "a" },
    { regra: "FI-CTE-SEM-TITULO", tipo: "ESTADO", severidade: "MEDIA", categoria: "PERDA_FINANCEIRA", titulo: "y", descricao: "y", chave: "b", valorCents: 100 },
    { regra: "CP-VENCIDO", tipo: "ESTADO", severidade: "MEDIA", categoria: "RISCO_FINANCEIRO", titulo: "z", descricao: "z", chave: "c", valorCents: 100 },
  ];
  const semNada = supervisionar(contexto({ titulos: [titulo()] }), achados, new Map());
  conferir("sem contrato nem CT-e, as duas são suprimidas", semNada.suprimidos.map((s) => s.regra), ["CR-CONTRATO-VENCENDO", "FI-CTE-SEM-TITULO"]);
  conferir("com o motivo escrito", semNada.suprimidos[1]?.motivo.includes("painel do contador"), true);
  conferir("a regra alheia passa", semNada.aprovados.map((a) => a.regra), ["CP-VENCIDO"]);

  const comContrato = supervisionar(contexto({ titulos: [titulo()], contratos: [contrato()] }), achados, new Map());
  conferir("com contrato na base, só a de CT-e é suprimida", comContrato.suprimidos.map((s) => s.regra), ["FI-CTE-SEM-TITULO"]);
}

console.log(falhas === 0 ? "\nTodos os casos passaram." : `\n${falhas} caso(s) falharam.`);
process.exit(falhas === 0 ? 0 : 1);
