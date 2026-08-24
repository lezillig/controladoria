import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tabela } from "@/lib/esquemaDoBanco";
import { competenciaSql } from "./competencia";
import type { Periodo } from "./periodos";

// RETENÇÕES NA FONTE — o dinheiro que não passa pela conta.
//
// O painel trata "receita" como a soma dos títulos a receber pelo valor do
// documento. Quando o tomador retém na fonte, o que entra na conta é menos que
// isso — um título de R$ 100 mil com R$ 11 mil retidos deposita R$ 89 mil. A
// diferença não é erro do sistema nem do banco: é imposto que o cliente
// recolheu no lugar da empresa. Mas, sem estar em lugar nenhum, ela aparece
// como conciliação que não fecha, todo mês, sem explicação.
//
// Do lado a pagar a leitura se inverte: ali a empresa é quem retém, e o valor
// é obrigação a recolher em nome do prestador. Retenção lançada no título e não
// recolhida na guia é das divergências que a consultoria aponta — e é o tipo de
// coisa que só vira achado se o número existir.
//
// POR TRIBUTO, não somado. Cada retenção tem guia, prazo e alíquota própria; um
// total serve para saber a ordem de grandeza e para nada mais. Conferir contra
// a DCTFWeb exige o número separado.

export type LinhaRetencao = {
  tributo: string;
  receberCents: number;
  pagarCents: number;
};

export type RetencoesDoPeriodo = {
  linhas: LinhaRetencao[];
  totalReceberCents: number;
  totalPagarCents: number;
  // Quantos títulos do período têm alguma retenção. Sem isso, um total alto
  // não distingue "muitos contratos com retenção" de "um título gigante", e a
  // primeira pergunta de quem olha é sempre essa.
  titulosComRetencaoReceber: number;
  titulosComRetencaoPagar: number;
};

// Cada tributo com o rótulo que aparece na guia, não o nome da coluna. Quem lê
// esta tela confere contra a DCTFWeb e o comprovante do cliente, e ali está
// escrito "IRRF", não "retencaoIrCents".
const TRIBUTOS: readonly { rotulo: string; coluna: string }[] = [
  { rotulo: "IRRF", coluna: "retencaoIrCents" },
  { rotulo: "ISS", coluna: "retencaoIssCents" },
  { rotulo: "PIS", coluna: "retencaoPisCents" },
  { rotulo: "COFINS", coluna: "retencaoCofinsCents" },
  { rotulo: "CSLL", coluna: "retencaoCsllCents" },
  { rotulo: "INSS", coluna: "retencaoInssCents" },
];

type LinhaBruta = Record<string, bigint>;

export async function retencoesDoPeriodo(params: {
  companyId: string;
  conexaoId?: string | null;
  periodo: Periodo;
}): Promise<RetencoesDoPeriodo> {
  const { companyId, conexaoId, periodo } = params;
  const filtro = conexaoId ? Prisma.sql`AND t."conexaoId" = ${conexaoId}` : Prisma.empty;

  // Os nomes de coluna vêm de TRIBUTOS, uma constante deste arquivo — nunca de
  // entrada do usuário. `Prisma.raw` aqui é seguro por isso e só por isso; o
  // filtro de conexão, que vem da querystring, continua parametrizado acima.
  const somas = TRIBUTOS.flatMap((t) => [
    Prisma.sql`SUM(CASE WHEN t.natureza::text = 'RECEBER' THEN t.${Prisma.raw(`"${t.coluna}"`)} ELSE 0 END)::bigint AS ${Prisma.raw(`"r_${t.coluna}"`)}`,
    Prisma.sql`SUM(CASE WHEN t.natureza::text = 'PAGAR'   THEN t.${Prisma.raw(`"${t.coluna}"`)} ELSE 0 END)::bigint AS ${Prisma.raw(`"p_${t.coluna}"`)}`,
  ]);

  // O "tem alguma retenção" precisa somar as seis colunas na condição: um
  // título com só ISS retido conta, e contar por coluna daria seis contagens
  // que não somam para nada útil.
  const algumaRetencao = Prisma.raw(
    TRIBUTOS.map((t) => `t."${t.coluna}"`).join(" + ") + " > 0"
  );

  const [linha] = await prisma.$queryRaw<LinhaBruta[]>`
    SELECT ${Prisma.join(somas, ", ")},
           COUNT(*) FILTER (WHERE t.natureza::text = 'RECEBER' AND ${algumaRetencao})::bigint AS q_receber,
           COUNT(*) FILTER (WHERE t.natureza::text = 'PAGAR'   AND ${algumaRetencao})::bigint AS q_pagar
      FROM ${tabela("OmieTitulo")} t
     WHERE t."companyId" = ${companyId}
       AND t.cancelado = false
       AND ${competenciaSql("t")} >= ${periodo.inicio}
       AND ${competenciaSql("t")} <= ${periodo.fim}
       ${filtro}
  `;

  // `?? 0` e não `?? 0n`: o alvo de compilação deste projeto é anterior a
  // ES2020, onde literal BigInt não existe. `Number` aceita os dois.
  const valor = (chave: string) => Number(linha?.[chave] ?? 0);

  const linhas = TRIBUTOS.map((t) => ({
    tributo: t.rotulo,
    receberCents: valor(`r_${t.coluna}`),
    pagarCents: valor(`p_${t.coluna}`),
  }));

  return {
    // Tributo sem retenção nenhuma no mês sai da tabela: seis linhas zeradas
    // escondem a única que tem valor.
    linhas: linhas.filter((l) => l.receberCents !== 0 || l.pagarCents !== 0),
    totalReceberCents: linhas.reduce((a, l) => a + l.receberCents, 0),
    totalPagarCents: linhas.reduce((a, l) => a + l.pagarCents, 0),
    titulosComRetencaoReceber: valor("q_receber"),
    titulosComRetencaoPagar: valor("q_pagar"),
  };
}
