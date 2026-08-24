import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tabela } from "@/lib/esquemaDoBanco";
import { competenciaSql } from "./competencia";
import type { Periodo } from "./periodos";

// RECEITA PELO DOCUMENTO FISCAL EMITIDO — não pelo título a receber.
//
// O que o painel chamava de "receita" era a soma dos títulos a receber com
// vencimento no mês. Isso não é faturamento, e a composição de um mês real
// mostrou por quê: dentro dos R$ 9,29 milhões havia resgate de consórcio
// (71 títulos), venda de veículo, lucros cessantes, reembolso de multa de
// trânsito, devolução de pagamento em duplicidade e devolução de PIX. Nenhum
// deles é serviço prestado; todos entravam na receita e na margem.
//
// Some-se a isso o que o usuário apontou e que a tabela não mostra sozinha:
// transferência entre contas da própria empresa também gera título, e ela
// infla a "receita" com dinheiro que só mudou de bolso.
//
// Faturamento é o que foi DOCUMENTADO: nota emitida, não cancelada, pela data
// de emissão. É o número que a contabilidade apura, é o que sustenta o imposto,
// e é o único que dá para conferir contra o que a Receita tem.
//
// ---------------------------------------------------------------------------
// O QUE ESTA FUNÇÃO AINDA NÃO ENXERGA, E POR QUÊ ISSO IMPORTA
//
// O espelho guarda NF-e e NFS-e. Não guarda CT-e — e a operação emite CT-e:
// no mês analisado foram R$ 779.092,59 em títulos com tipo de documento "CTE",
// 8,4% da receita. Enquanto o CT-e não for espelhado, este número é RECEITA
// FISCAL PARCIAL, e apresentá-lo como total seria trocar um erro por outro.
//
// Por isso a tela mostra os dois lados e a diferença, em vez de simplesmente
// substituir um número pelo outro. O `alertaCte` abaixo existe para que essa
// limitação viaje junto com o dado, e não vire nota de rodapé esquecida.
// ---------------------------------------------------------------------------

export type LinhaReceitaFiscal = {
  tipo: string;
  rotulo: string;
  quantidade: number;
  valorCents: number;
};

export type ReceitaFiscalDoPeriodo = {
  totalCents: number;
  quantidade: number;
  linhas: LinhaReceitaFiscal[];
  // Total dos títulos a receber com tipo de documento de CT-e no mesmo período.
  // É a medida do buraco: quanto de faturamento existe e não está espelhado
  // como documento fiscal.
  cteEmTitulosCents: number;
  cteEmTitulos: number;
  // FATURAMENTO PELO TÍTULO, POR DATA DE EMISSÃO — a ponte que faltava.
  //
  // Conferido contra a declaração de faturamento assinada pela contabilidade,
  // doze meses, extraída da própria Omie: os títulos com tipo de documento
  // FISCAL (NFS-e, NF-e, CT-e), somados pela data de EMISSÃO, ficam a 3,3% da
  // declaração no acumulado e entre -7,4% e +0,3% mês a mês.
  //
  // Os mesmos títulos somados pela data de VENCIMENTO — que é o que a tela
  // mostrava — ficavam 32% acima em julho. A diferença nunca foi dado faltando:
  // era a pergunta trocada. Vencimento responde "quanto tenho a receber neste
  // mês"; emissão responde "quanto faturei neste mês".
  //
  // Vale mais que o número vindo de OmieNota enquanto o CT-e não for espelhado:
  // aqui o CT-e entra, porque o título dele existe mesmo sem a nota.
  fiscaisPorEmissaoCents: number;
  fiscaisPorEmissao: number;
  todosPorEmissaoCents: number;
};

const ROTULO: Record<string, string> = {
  NFSE: "NFS-e — nota de serviço",
  NFE: "NF-e — nota de produto",
};

type LinhaBruta = { tipo: string; quantidade: bigint; valor: bigint };

export async function receitaFiscalDoPeriodo(params: {
  companyId: string;
  conexaoId?: string | null;
  periodo: Periodo;
}): Promise<ReceitaFiscalDoPeriodo> {
  const { companyId, conexaoId, periodo } = params;
  const filtroNota = conexaoId ? Prisma.sql`AND n."conexaoId" = ${conexaoId}` : Prisma.empty;
  const filtroTitulo = conexaoId ? Prisma.sql`AND t."conexaoId" = ${conexaoId}` : Prisma.empty;

  // Nota CANCELADA fica de fora. Ela existe no espelho de propósito — nota
  // cancelada com título vivo é achado do agente fiscal —, mas não é
  // faturamento, e somá-la seria repetir em outro lugar o erro que esta função
  // veio corrigir.
  const linhas = await prisma.$queryRaw<LinhaBruta[]>`
    SELECT n.tipo AS tipo,
           COUNT(*)::bigint AS quantidade,
           SUM(n."valorCents")::bigint AS valor
      FROM ${tabela("OmieNota")} n
     WHERE n."companyId" = ${companyId}
       AND n.cancelada = false
       AND n."dataEmissao" >= ${periodo.inicio}
       AND n."dataEmissao" <= ${periodo.fim}
       ${filtroNota}
     GROUP BY 1
     ORDER BY 3 DESC
  `;

  // O CT-e não tem espelho fiscal, então a medida possível é indireta: os
  // títulos a receber que a própria Omie marcou com tipo de documento de CT-e.
  // Não é o valor da nota — é o valor cobrado —, e a tela diz isso.
  const [cte] = await prisma.$queryRaw<{ quantidade: bigint; valor: bigint }[]>`
    SELECT COUNT(*)::bigint AS quantidade,
           COALESCE(SUM(t."valorDocumentoCents"), 0)::bigint AS valor
      FROM ${tabela("OmieTitulo")} t
     WHERE t."companyId" = ${companyId}
       AND t.cancelado = false
       AND t.natureza::text = 'RECEBER'
       AND UPPER(COALESCE(t."tipoDocumento", '')) IN ('CTE', 'CT-E', 'CTRC')
       AND ${competenciaSql("t")} >= ${periodo.inicio}
       AND ${competenciaSql("t")} <= ${periodo.fim}
       ${filtroTitulo}
  `;

  // Tipos de documento que a Omie marca como fiscais. Os códigos vêm da
  // própria base — a composição do mês mostrou NFS, CTE, NF ao lado de BOL,
  // PIX, DEP, REE. Boleto e PIX são instrumento de cobrança, não documento
  // fiscal, e é justamente essa confusão que inflava a receita.
  const [emissao] = await prisma.$queryRaw<{ fq: bigint; fv: bigint; tv: bigint }[]>`
    SELECT COUNT(*) FILTER (WHERE UPPER(COALESCE(t."tipoDocumento", '')) IN ('NFS','NFSE','NF','NFE','CTE','CT-E','CTRC'))::bigint AS fq,
           COALESCE(SUM(t."valorDocumentoCents") FILTER (WHERE UPPER(COALESCE(t."tipoDocumento", '')) IN ('NFS','NFSE','NF','NFE','CTE','CT-E','CTRC')), 0)::bigint AS fv,
           COALESCE(SUM(t."valorDocumentoCents"), 0)::bigint AS tv
      FROM ${tabela("OmieTitulo")} t
     WHERE t."companyId" = ${companyId}
       AND t.cancelado = false
       AND t.natureza::text = 'RECEBER'
       AND t."dataEmissao" >= ${periodo.inicio}
       AND t."dataEmissao" <= ${periodo.fim}
       ${filtroTitulo}
  `;

  const detalhadas = linhas.map((l) => ({
    tipo: l.tipo,
    rotulo: ROTULO[l.tipo] ?? l.tipo,
    quantidade: Number(l.quantidade),
    valorCents: Number(l.valor),
  }));

  return {
    totalCents: detalhadas.reduce((a, l) => a + l.valorCents, 0),
    quantidade: detalhadas.reduce((a, l) => a + l.quantidade, 0),
    linhas: detalhadas,
    cteEmTitulosCents: Number(cte?.valor ?? 0),
    cteEmTitulos: Number(cte?.quantidade ?? 0),
    fiscaisPorEmissaoCents: Number(emissao?.fv ?? 0),
    fiscaisPorEmissao: Number(emissao?.fq ?? 0),
    todosPorEmissaoCents: Number(emissao?.tv ?? 0),
  };
}

// CATEGORIAS DE TÍTULO A RECEBER QUE NÃO SÃO RECEITA DE OPERAÇÃO.
//
// A ponte entre os dois números. Quem olha "R$ 9,29 milhões pelo título" e
// "R$ X pela nota" precisa saber de onde vem a diferença — e a diferença tem
// nome, categoria por categoria.
//
// O critério é a DESCRIÇÃO da categoria, e não uma lista de códigos: código de
// categoria muda entre as duas contas Omie do grupo, descrição não. Casos
// cobertos, todos vistos na base real: resgate de consórcio, venda de veículo,
// lucros cessantes, sinistro, reembolso, devolução, estorno, transferência
// entre contas, aporte e empréstimo.
//
// É uma HEURÍSTICA, e a tela diz isso. Ela não decide nada sozinha: serve para
// dirigir o olho de quem vai reclassificar na Omie, que é onde o conserto
// acontece de verdade.
const PADRAO_NAO_OPERACIONAL =
  "(consórcio|consorcio|venda de veículo|venda de veiculo|lucros cessantes|sinistro|reembolso|" +
  "devolução|devolucao|devoluções|devolucoes|estorno|transferência|transferencia|aporte|empréstimo|emprestimo|" +
  "resgate|convênio|convenio|indenização|indenizacao)";

export type LinhaNaoOperacional = {
  categoria: string;
  quantidade: number;
  valorCents: number;
};

export async function receitaNaoOperacional(params: {
  companyId: string;
  conexaoId?: string | null;
  periodo: Periodo;
}): Promise<{ linhas: LinhaNaoOperacional[]; totalCents: number }> {
  const { companyId, conexaoId, periodo } = params;
  const filtro = conexaoId ? Prisma.sql`AND t."conexaoId" = ${conexaoId}` : Prisma.empty;

  const linhas = await prisma.$queryRaw<{ categoria: string | null; quantidade: bigint; valor: bigint }[]>`
    SELECT COALESCE(NULLIF(TRIM(t."categoriaDescricao"), ''), t."categoriaCodigo", 'Sem categoria') AS categoria,
           COUNT(*)::bigint AS quantidade,
           SUM(t."valorDocumentoCents")::bigint AS valor
      FROM ${tabela("OmieTitulo")} t
     WHERE t."companyId" = ${companyId}
       AND t.cancelado = false
       AND t.natureza::text = 'RECEBER'
       AND t."dataVencimento" >= ${periodo.inicio}
       AND t."dataVencimento" <= ${periodo.fim}
       AND COALESCE(t."categoriaDescricao", '') ~* ${PADRAO_NAO_OPERACIONAL}
       ${filtro}
     GROUP BY 1
     ORDER BY 3 DESC
  `;

  const detalhadas = linhas.map((l) => ({
    categoria: l.categoria ?? "Sem categoria",
    quantidade: Number(l.quantidade),
    valorCents: Number(l.valor),
  }));

  return { linhas: detalhadas, totalCents: detalhadas.reduce((a, l) => a + l.valorCents, 0) };
}
