// ONDE VAI O TEMPO DEPOIS QUE OS DADOS JÁ ESTÃO NA MEMÓRIA.
//
// `scripts/bench-contexto.ts` mede o BANCO. Este mede a CONTA: `montarDre` e
// `montarDreAnual` são funções puras sobre o contexto, então aqui não há
// Postgres nenhum — o contexto é montado em memória e as duas funções rodam
// sobre ele. É a outra metade da latência da tela de Custos e DRE, e sem
// medir as duas metades separadas não há como saber qual otimizar.
//
// Uso: TITULOS=50000 npx tsx scripts/bench-dre.ts
import { montarDre, montarDreAnual } from "../src/lib/controladoria/dre";
import { montarJanelas } from "../src/lib/controladoria/periodos";
import type { ContextoAuditoria } from "../src/lib/controladoria/types";

const ALVO = Number(process.env.TITULOS ?? 50000);
const CATEGORIAS = 40;
const REFERENCIA = new Date(2026, 8, 22);

// O contexto sintético segue o formato do real no que a conta usa: um ano de
// datas, 40 categorias, um terço a receber, um quarto cancelado ou em aberto,
// retenção em parte dos títulos a receber e uma baixa por título liquidado.
function montarContexto(): ContextoAuditoria {
  const titulos = Array.from({ length: ALVO }, (_, n) => {
    const dia = new Date(2026, 0, 1 + (n % 265));
    const receber = n % 3 === 0;
    return {
      id: `t${n}`,
      companyId: "bench",
      conexaoId: "cx",
      conexaoApelido: "BENCH",
      natureza: receber ? "RECEBER" : "PAGAR",
      codigoLancamento: `L${n}`,
      parceiroCodigo: `P${n % 800}`,
      parceiroNome: `Fornecedor ${n % 800}`,
      parceiroDocumento: String(10000000000000 + (n % 800)),
      categoriaCodigo: n % 97 === 0 ? null : `C${n % CATEGORIAS}`,
      categoriaDescricao: `Categoria ${n % CATEGORIAS}`,
      numeroDocumento: String(n),
      dataEmissao: dia,
      dataVencimento: dia,
      valorDocumentoCents: 10_000 + (n % 9999),
      valorPagoCents: 10_000,
      saldoCents: null,
      cancelado: n % 53 === 0,
      liquidado: n % 4 !== 0,
      retencaoIssCents: receber && n % 7 === 0 ? 1_000 : 0,
      retencaoPisCents: receber && n % 7 === 0 ? 200 : 0,
      retencaoCofinsCents: receber && n % 7 === 0 ? 900 : 0,
      retencaoCsllCents: 0,
      retencaoIrCents: receber && n % 11 === 0 ? 450 : 0,
      retencaoInssCents: 0,
    };
  });

  const baixas = titulos
    .filter((t) => t.liquidado)
    .map((t, i) => ({
      id: `b${i}`,
      tituloId: t.id,
      dataBaixa: t.dataVencimento,
      valorCents: t.valorDocumentoCents,
    }));

  const categorias = Array.from({ length: CATEGORIAS }, (_, i) => ({
    codigo: `C${i}`,
    descricao: i % 5 === 0 ? `Serviços prestados ${i}` : `Combustível e peças ${i}`,
    natureza: null,
    contaReceita: i % 5 === 0,
    contaDespesa: i % 5 !== 0,
    tipoCategoria: null,
    codigoDre: null,
  }));

  return {
    companyId: "bench",
    agora: REFERENCIA,
    dataReferencia: REFERENCIA,
    config: { retencoesNasDeducoes: false },
    conexoes: [],
    conexaoId: null,
    janelaDesde: new Date(2026, 0, 1),
    titulos,
    baixas,
    categorias,
    movimentos: [],
    parceiros: [],
    notas: [],
  } as unknown as ContextoAuditoria;
}

const RODADAS = 5;
function medir(nome: string, f: () => unknown) {
  const ms: number[] = [];
  for (let r = 0; r < RODADAS; r++) {
    const t = Date.now();
    f();
    ms.push(Date.now() - t);
  }
  const ord = [...ms].sort((a, b) => a - b);
  return { nome, mediana: ord[Math.floor(ord.length / 2)] };
}

function principal() {
  console.log(`montando contexto com ${ALVO} títulos...`);
  const ctx = montarContexto();
  const janelas = montarJanelas(REFERENCIA);
  const classificacoes = new Map<string, { linha: string; subgrupo: string | null; confirmada: boolean }>();
  const anoAnterior = {
    inicio: new Date(2025, 8, 1),
    fim: new Date(2025, 8, 30, 23, 59, 59, 999),
    rotulo: "2025",
  };

  const resultados = [
    medir("montarDre mensal, competência", () =>
      montarDre(ctx, janelas.mesAtual, janelas.mesAnterior, classificacoes, {
        periodoAnoAnterior: anoAnterior,
      })
    ),
    medir("montarDre mensal, caixa", () =>
      montarDre(ctx, janelas.mesAtual, janelas.mesAnterior, classificacoes, {
        regime: "caixa",
        periodoAnoAnterior: anoAnterior,
      })
    ),
    medir("montarDreAnual, competência (9 meses)", () =>
      montarDreAnual(ctx, 2026, classificacoes, {})
    ),
    medir("montarDreAnual, caixa (9 meses)", () =>
      montarDreAnual(ctx, 2026, classificacoes, { regime: "caixa" })
    ),
  ];

  console.log(`\n--- mediana de ${RODADAS} rodadas, só CPU (sem banco) ---`);
  for (const r of resultados.sort((a, b) => b.mediana - a.mediana)) {
    console.log(`${String(r.mediana).padStart(6)} ms  ${r.nome}`);
  }
}
principal();
