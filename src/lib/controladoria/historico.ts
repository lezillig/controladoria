import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tabela } from "@/lib/esquemaDoBanco";

// A MEMÓRIA LONGA DA AUDITORIA.
//
// O contexto que os agentes recebem tem teto de 400 dias, e vai continuar
// tendo: carregar anos de títulos em memória a cada ciclo foi o que esgotou a
// franquia de transferência do banco uma vez. Só que as perguntas que mais
// interessam a uma auditoria são justamente as que precisam de anos —
//
//   "este fornecedor sempre cobrou isso, ou dobrou este mês?"
//   "esta despesa é sazonal, ou apareceu agora?"
//   "o prazo de pagamento dele mudou?"
//   "ele fatura todo mês, ou só apareceu duas vezes e sumiu?"
//
// — e uma regra de limiar fixo não responde nenhuma delas. "Pagamento acima de
// R$ 50 mil" é uma afirmação sobre o tamanho da empresa; "pagamento três vezes
// acima do que ESTE fornecedor cobra há três anos" é uma afirmação sobre o
// fornecedor. A segunda é auditoria; a primeira é um filtro.
//
// Este arquivo resolve os dois lados sem escolher: o histórico fica SOMADO por
// mês. Cinco anos de um fornecedor viram sessenta linhas em vez de milhares de
// títulos, e a comparação com o mês corrente cabe numa consulta.
//
// TUDO É CALCULADO DENTRO DO BANCO. Os dois INSERT ... SELECT abaixo poderiam
// ser um `findMany` seguido de laço em JavaScript, e seria mais fácil de ler —
// e traria centenas de milhares de linhas pela rede a cada recálculo, que é
// exatamente o custo que esta tabela existe para evitar. O agregado atravessa
// a rede; os títulos não.

export type Dimensao = "PARCEIRO" | "CATEGORIA";

// A competência de um título é a data de EMISSÃO, com o vencimento como
// reserva — a mesma regra de competencia.ts, e pelo mesmo motivo documentado
// lá. Repetida aqui em SQL porque o cálculo é do banco.
const COMPETENCIA = Prisma.raw(`to_char(COALESCE(t."dataEmissao", t."dataVencimento"), 'YYYY-MM')`);

// UMA COMPETÊNCIA, UMA DIMENSÃO, DE UMA VEZ.
//
// `ON CONFLICT DO UPDATE` faz o recálculo ser idempotente: rodar de novo a
// mesma competência atualiza as linhas em vez de duplicá-las. É o que permite
// chamar isto ao fim de toda janela de sincronização sem pensar duas vezes —
// inclusive na janela diária, que cobre D-3 e portanto reprocessa dias já
// contados.
async function recalcularDimensao(
  companyId: string,
  conexaoId: string,
  competencia: string,
  dimensao: Dimensao
): Promise<number> {
  const chave =
    dimensao === "PARCEIRO" ? Prisma.raw(`t."parceiroCodigo"`) : Prisma.raw(`t."categoriaCodigo"`);
  const rotulo =
    dimensao === "PARCEIRO" ? Prisma.raw(`t."parceiroNome"`) : Prisma.raw(`t."categoriaDescricao"`);

  return prisma.$executeRaw`
    INSERT INTO ${tabela("HistoricoMensal")} (
      id, "companyId", "conexaoId", competencia, natureza, dimensao, chave, rotulo,
      titulos, "valorCents", "valorMaximoCents",
      baixas, "valorBaixadoCents", "diasPagamentoSoma", "calculadoEm"
    )
    SELECT
      gen_random_uuid()::text,
      t."companyId",
      t."conexaoId",
      ${COMPETENCIA},
      t.natureza::text,
      ${dimensao},
      ${chave},
      -- O rótulo do mês é o do título mais recente daquele mês. Fornecedor
      -- renomeado na Omie não reescreve o passado: o nome antigo fica com o
      -- mês antigo, que é o que alguém conferindo um achado de 2023 precisa
      -- ler para reconhecer do que se trata.
      (ARRAY_AGG(${rotulo} ORDER BY t."dataVencimento" DESC))[1],
      COUNT(*)::int,
      COALESCE(SUM(t."valorDocumentoCents"), 0)::int,
      COALESCE(MAX(t."valorDocumentoCents"), 0)::int,
      COALESCE(SUM(b.qtd), 0)::int,
      COALESCE(SUM(b.valor), 0)::int,
      COALESCE(SUM(b.dias), 0)::int,
      -- NOW() fecha a lista: são quinze colunas no INSERT, e faltava o
      -- décimo quinto valor. O Postgres recusou com "INSERT has more target
      -- columns than expressions" — e a recusa só apareceu na execução real,
      -- porque SQL cru não passa pelo compilador. É por isso que a chamada
      -- desta função vive dentro de um try/catch no ciclo: o resumo é
      -- derivado, e derrubar a janela inteira por causa dele seria trocar o
      -- barato pelo caro.
      NOW()
    FROM ${tabela("OmieTitulo")} t
    -- LATERAL, e não JOIN direto: com JOIN, um título com três baixas entraria
    -- três vezes no COUNT(*) e o número de títulos do mês ficaria inflado.
    -- Assim as baixas são somadas ANTES, uma linha por título.
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS qtd,
             SUM(x."valorCents") AS valor,
             SUM(EXTRACT(DAY FROM (x."dataBaixa" - t."dataVencimento"))) AS dias
        FROM ${tabela("OmieBaixa")} x
       WHERE x."tituloId" = t.id
    ) b ON TRUE
    WHERE t."companyId" = ${companyId}
      AND t."conexaoId" = ${conexaoId}
      AND ${COMPETENCIA} = ${competencia}
      -- Cancelado fica de fora do histórico, e isto é decisão de conteúdo, não
      -- de desempenho: um título cancelado nunca foi despesa nem receita, e
      -- deixá-lo entrar na base de comparação faria a média do fornecedor
      -- descrever cobranças que foram desfeitas.
      AND t.cancelado = false
      AND ${chave} IS NOT NULL
    GROUP BY t."companyId", t."conexaoId", ${COMPETENCIA}, t.natureza::text, ${chave}
    ON CONFLICT ("companyId", "conexaoId", competencia, natureza, dimensao, chave)
    DO UPDATE SET
      rotulo              = EXCLUDED.rotulo,
      titulos             = EXCLUDED.titulos,
      "valorCents"        = EXCLUDED."valorCents",
      "valorMaximoCents"  = EXCLUDED."valorMaximoCents",
      baixas              = EXCLUDED.baixas,
      "valorBaixadoCents" = EXCLUDED."valorBaixadoCents",
      "diasPagamentoSoma" = EXCLUDED."diasPagamentoSoma",
      "calculadoEm"       = NOW()
  `;
}

// Linhas que sobraram de um estado anterior da base.
//
// Sem isto, um título excluído na Omie (ou que mudou de fornecedor) deixaria
// para trás a linha do mês antigo, com o valor antigo — e o histórico passaria
// a descrever uma realidade que não existe mais, em silêncio. O recálculo
// reescreve o que existe; esta limpeza remove o que deixou de existir.
async function limparOrfas(
  companyId: string,
  conexaoId: string,
  competencia: string
): Promise<number> {
  return prisma.$executeRaw`
    DELETE FROM ${tabela("HistoricoMensal")} h
     WHERE h."companyId" = ${companyId}
       AND h."conexaoId" = ${conexaoId}
       AND h.competencia = ${competencia}
       AND NOT EXISTS (
         SELECT 1
           FROM ${tabela("OmieTitulo")} t
          WHERE t."companyId" = h."companyId"
            AND t."conexaoId" = h."conexaoId"
            AND t.cancelado = false
            AND ${COMPETENCIA} = h.competencia
            AND t.natureza::text = h.natureza
            AND (CASE WHEN h.dimensao = 'PARCEIRO' THEN t."parceiroCodigo" ELSE t."categoriaCodigo" END) = h.chave
       )
  `;
}

export async function recalcularHistorico(
  companyId: string,
  conexaoId: string,
  competencias: string[]
): Promise<{ competencias: number; linhas: number }> {
  let linhas = 0;
  for (const competencia of new Set(competencias)) {
    linhas += await recalcularDimensao(companyId, conexaoId, competencia, "PARCEIRO");
    linhas += await recalcularDimensao(companyId, conexaoId, competencia, "CATEGORIA");
    await limparOrfas(companyId, conexaoId, competencia);
  }
  return { competencias: new Set(competencias).size, linhas };
}

// O QUE AINDA NÃO TEM RESUMO.
//
// Existe porque o cálculo acontece ao FIM de cada janela de sincronização — e
// isso deixa dois buracos previsíveis: a base carregada antes desta camada
// existir, e qualquer janela cujo recálculo tenha falhado (ele vive num
// try/catch de propósito, para não derrubar a carga do mês por causa de um
// agregado). Na primeira vez que isto rodou, os dois buracos eram o mesmo: 134
// janelas carregadas, zero resumos, por um erro de SQL que só a execução real
// revelou.
//
// A lista sai do próprio espelho — competências que TÊM título e não TÊM
// resumo. Assim ela encolhe sozinha a cada lote e não depende de ninguém
// lembrar do que ficou para trás.
export async function competenciasPendentes(
  companyId: string
): Promise<{ conexaoId: string; competencia: string }[]> {
  return prisma.$queryRaw<{ conexaoId: string; competencia: string }[]>`
    SELECT DISTINCT t."conexaoId", ${COMPETENCIA} AS competencia
      FROM ${tabela("OmieTitulo")} t
     WHERE t."companyId" = ${companyId}
       AND t.cancelado = false
       AND NOT EXISTS (
         SELECT 1 FROM ${tabela("HistoricoMensal")} h
          WHERE h."companyId" = t."companyId"
            AND h."conexaoId" = t."conexaoId"
            AND h.competencia = ${COMPETENCIA}
       )
     ORDER BY 2 DESC
  `;
}

// UM LOTE POR CHAMADA, com prazo.
//
// Cento e trinta e quatro competências × duas dimensões não cabem nos sessenta
// segundos de uma função. Em vez de arriscar o estouro — que deixaria o
// trabalho pela metade sem dizer onde parou —, cada chamada faz o que couber no
// prazo e devolve quantas faltam. Quem chamou decide se volta.
//
// As mais RECENTES primeiro (a consulta ordena por competência decrescente):
// se o processo for interrompido, o que já está pronto é o período que as telas
// mais consultam.
export async function recalcularPendentes(
  companyId: string,
  prazo: Date
): Promise<{ feitas: number; restantes: number }> {
  const pendentes = await competenciasPendentes(companyId);
  let feitas = 0;

  for (const p of pendentes) {
    // Confere ANTES de começar mais uma, e não depois: uma competência no meio
    // do caminho é pior que uma não começada, porque a dimensão PARCEIRO
    // ficaria gravada e a CATEGORIA não — e a próxima passada a consideraria
    // pronta, já que "pronta" é ter qualquer linha.
    if (new Date() >= prazo) break;
    await recalcularHistorico(companyId, p.conexaoId, [p.competencia]);
    feitas++;
  }

  return { feitas, restantes: pendentes.length - feitas };
}

// AS COMPETÊNCIAS QUE UMA JANELA TOCA.
//
// Função pura, e é o pedaço testável desta camada. Uma janela de backfill é um
// mês e devolve um; a janela diária cobre D-3 e, virando o mês, encosta em dois
// — e é aí que o descuido apareceria: recalcular só o mês do fim deixaria os
// últimos dias do mês anterior com o resumo velho para sempre, porque nenhuma
// janela seguinte volta lá.
export function competenciasDaJanela(inicio: Date, fim: Date): string[] {
  const meses: string[] = [];
  const cursor = new Date(inicio.getFullYear(), inicio.getMonth(), 1);
  const ultimo = new Date(fim.getFullYear(), fim.getMonth(), 1);
  // Teto de sanidade: janela absurda (data digitada errada numa releitura) não
  // pode virar um laço de milhares de meses.
  while (cursor <= ultimo && meses.length < 120) {
    meses.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return meses;
}

// ---------------------------------------------------------------------------
// LEITURA — o que os agentes consultam.
// ---------------------------------------------------------------------------

export type SerieMensal = {
  chave: string;
  rotulo: string | null;
  competencia: string;
  titulos: number;
  valorCents: number;
  valorMaximoCents: number;
  baixas: number;
  diasPagamentoSoma: number;
};

// A série de todas as chaves de uma dimensão, entre duas competências.
//
// Uma consulta só para o conjunto inteiro, e não uma por fornecedor: com
// centenas de fornecedores, uma consulta por chave seria centenas de idas ao
// banco dentro de um ciclo que já disputa 60 segundos de função.
export async function lerSeries(params: {
  companyId: string;
  conexaoId?: string | null;
  dimensao: Dimensao;
  natureza: "PAGAR" | "RECEBER";
  de: string;
  ate: string;
}): Promise<SerieMensal[]> {
  const { companyId, conexaoId, dimensao, natureza, de, ate } = params;
  return prisma.$queryRaw<SerieMensal[]>`
    SELECT chave, rotulo, competencia, titulos,
           "valorCents", "valorMaximoCents", baixas, "diasPagamentoSoma"
      FROM ${tabela("HistoricoMensal")}
     WHERE "companyId" = ${companyId}
       AND dimensao = ${dimensao}
       AND natureza = ${natureza}
       AND competencia >= ${de}
       AND competencia <= ${ate}
       ${conexaoId ? Prisma.sql`AND "conexaoId" = ${conexaoId}` : Prisma.empty}
     ORDER BY chave, competencia
  `;
}

export type Baseline = {
  chave: string;
  rotulo: string | null;
  // Meses em que a chave apareceu na janela de referência. Menos que o mínimo
  // e não há baseline — só uma amostra pequena, que é diferente de um padrão.
  meses: number;
  medianaCents: number;
  // Desvio absoluto mediano. Escolhido no lugar do desvio padrão de propósito:
  // o desvio padrão é puxado pelo próprio ponto fora da curva que se está
  // procurando, então um fornecedor com um único pagamento absurdo passa a ter
  // um desvio tão grande que o absurdo cabe dentro dele. A mediana não se move
  // com o extremo — é a estatística certa para achar extremo.
  madCents: number;
  totalCents: number;
  primeiraCompetencia: string;
  ultimaCompetencia: string;
};

function mediana(valores: number[]): number {
  if (valores.length === 0) return 0;
  const ordenado = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenado.length / 2);
  return ordenado.length % 2 === 1
    ? ordenado[meio]
    : Math.round((ordenado[meio - 1] + ordenado[meio]) / 2);
}

// O PADRÃO DE CADA CHAVE, a partir das séries já lidas.
//
// Pura, e separada da consulta pelo mesmo motivo do cruzamento de CT-e: regra
// que só roda com banco em pé é regra que ninguém exercita.
export function montarBaselines(series: SerieMensal[], minimoDeMeses = 6): Map<string, Baseline> {
  const porChave = new Map<string, SerieMensal[]>();
  for (const s of series) {
    const atual = porChave.get(s.chave);
    if (atual) atual.push(s);
    else porChave.set(s.chave, [s]);
  }

  const baselines = new Map<string, Baseline>();
  for (const [chave, linhas] of porChave) {
    if (linhas.length < minimoDeMeses) continue;
    const valores = linhas.map((l) => l.valorCents);
    const med = mediana(valores);
    const competencias = linhas.map((l) => l.competencia).sort();
    baselines.set(chave, {
      chave,
      rotulo: linhas.find((l) => l.rotulo)?.rotulo ?? null,
      meses: linhas.length,
      medianaCents: med,
      madCents: mediana(valores.map((v) => Math.abs(v - med))),
      totalCents: valores.reduce((a, b) => a + b, 0),
      primeiraCompetencia: competencias[0],
      ultimaCompetencia: competencias[competencias.length - 1],
    });
  }
  return baselines;
}

// Quantos "desvios" o mês corrente está do padrão.
//
// MAD zero é o caso que precisa de cuidado, e ele é comum de verdade: um
// fornecedor de mensalidade fixa tem MAD zero porque todo mês é igual. Dividir
// por zero daria infinito e faria qualquer variação de um centavo virar achado
// crítico. Então, com MAD zero, a comparação passa a ser proporcional à
// mediana — que é como uma pessoa leria: "sempre foi 1.000 e veio 3.000".
export function desvioDoPadrao(valorCents: number, baseline: Baseline): number {
  if (baseline.madCents > 0) return (valorCents - baseline.medianaCents) / baseline.madCents;
  if (baseline.medianaCents === 0) return 0;
  return ((valorCents - baseline.medianaCents) / Math.abs(baseline.medianaCents)) * 10;
}

// A competência anterior a uma competência. Texto entra, texto sai — sem
// passar por Date, que traria fuso horário para uma pergunta que é só de
// calendário.
export function competenciaAnterior(competencia: string, meses = 1): string {
  const [ano, mes] = competencia.split("-").map(Number);
  const total = ano * 12 + (mes - 1) - meses;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}
