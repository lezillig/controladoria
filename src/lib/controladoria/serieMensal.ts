import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tabela } from "@/lib/esquemaDoBanco";
import { rotuloMes } from "./periodos";

// RESULTADO MÊS A MÊS — somado no banco, não na memória da função.
//
// O painel monta os números carregando o contexto de auditoria inteiro: todos
// os títulos, baixas, notas e parceiros desde o início da base, linha por
// linha. Com 46 mil títulos e 45 mil baixas isso passa de trinta megabytes por
// abertura de tela, e foi esse mesmo padrão — em outra tela — que esgotou a
// franquia de transferência do banco e derrubou os dois sistemas.
//
// Uma série de vinte meses não precisa das linhas: precisa da soma delas. Aqui
// o Postgres agrupa e devolve uma linha por mês, alguns kilobytes no total.
//
// A REGRA DE CÁLCULO É A MESMA do painel e do relatório, deliberadamente:
// regime de COMPETÊNCIA pela data de vencimento, sobre títulos não cancelados,
// pelo valor do documento. Duas telas do mesmo sistema discordando sobre
// "receita do mês" não é uma inconsistência de exibição — é o fim da confiança
// no sistema inteiro, e ninguém volta a usar um painel que já mentiu uma vez.

export type MesDaSerie = {
  // AAAA-MM, chave estável para ligar com o seletor de competência.
  competencia: string;
  rotulo: string;
  receitaCents: number;
  despesaCents: number;
  resultadoCents: number;
  margemPercent: number | null;
  titulosReceber: number;
  titulosPagar: number;
  // Acumulado DENTRO DO ANO, zerando em janeiro — que é como resultado
  // acumulado é lido em qualquer DRE gerencial. Acumular desde o início da
  // base misturaria exercícios e produziria um número que não corresponde a
  // nada que o contador reconheça.
  receitaAcumuladaCents: number;
  despesaAcumuladaCents: number;
  resultadoAcumuladoCents: number;
  // Regime de CAIXA no mesmo mês: o que de fato entrou e saiu, pela data da
  // baixa. Fica lado a lado com a competência de propósito e sempre rotulado —
  // o erro mais comum de relatório gerencial em PME é misturar os dois, e o
  // sintoma é o mês fechar no azul no resultado e no vermelho no banco.
  recebidoCents: number;
  pagoCents: number;
  fluxoLiquidoCents: number;
  // FATURAMENTO FISCAL: soma das notas emitidas no mês, não canceladas, pela
  // data de emissão. É o número que a contabilidade declara e o único que dá
  // para conferir contra a Receita.
  //
  // Fica ao lado da receita por título, e não no lugar dela, porque os dois
  // respondem perguntas diferentes: "quanto eu faturei" e "quanto eu tenho a
  // receber". A distância entre eles é onde moram transferência entre contas,
  // resgate de consórcio, venda de veículo e devolução — que a composição do
  // mês lista por categoria.
  //
  // PARCIAL enquanto o CT-e não for espelhado: o espelho guarda NF-e e NFS-e.
  // Ver receitaFiscal.ts.
  receitaFiscalCents: number;
  notasEmitidas: number;
};

type LinhaCompetencia = { mes: Date; natureza: string; valor: bigint; quantidade: bigint };
type LinhaCaixa = { mes: Date; natureza: string; valor: bigint };
type LinhaFiscal = { mes: Date; valor: bigint; quantidade: bigint };

function chave(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function serieMensal(params: {
  companyId: string;
  conexaoId?: string | null;
  desde: Date;
  ate: Date;
}): Promise<MesDaSerie[]> {
  const { companyId, conexaoId, desde, ate } = params;

  // O filtro de conexão entra como fragmento parametrizado, nunca por
  // interpolação de texto: id vem da querystring, e concatenar valor de
  // requisição dentro de SQL é como se escreve uma injeção.
  const filtroConexao = conexaoId ? Prisma.sql`AND t."conexaoId" = ${conexaoId}` : Prisma.empty;
  const filtroConexaoBaixa = conexaoId ? Prisma.sql`AND b."conexaoId" = ${conexaoId}` : Prisma.empty;
  const filtroConexaoNota = conexaoId ? Prisma.sql`AND n."conexaoId" = ${conexaoId}` : Prisma.empty;

  const [competencia, caixa, fiscal] = await Promise.all([
    prisma.$queryRaw<LinhaCompetencia[]>`
      SELECT date_trunc('month', t."dataVencimento") AS mes,
             t.natureza::text AS natureza,
             SUM(t."valorDocumentoCents")::bigint AS valor,
             COUNT(*)::bigint AS quantidade
        FROM ${tabela("OmieTitulo")} t
       WHERE t."companyId" = ${companyId}
         AND t.cancelado = false
         AND t."dataVencimento" >= ${desde}
         AND t."dataVencimento" <= ${ate}
         ${filtroConexao}
       GROUP BY 1, 2
       ORDER BY 1
    `,
    // Sem `t.cancelado = false` aqui, ao contrário da competência acima, e
    // isso não é descuido: é o que o painel e o relatório fazem.
    //
    // Competência pergunta "este título gerou resultado no mês?" — cancelado
    // não gerou. Caixa pergunta "este dinheiro entrou ou saiu da conta?" — e
    // se houve baixa, houve movimento, independentemente de o título ter sido
    // cancelado depois. Alinhar os dois critérios "por coerência" faria esta
    // tela discordar do painel sobre quanto entrou no mês, que é a
    // divergência que mata a confiança no sistema.
    prisma.$queryRaw<LinhaCaixa[]>`
      SELECT date_trunc('month', b."dataBaixa") AS mes,
             t.natureza::text AS natureza,
             SUM(ABS(b."valorCents"))::bigint AS valor
        FROM ${tabela("OmieBaixa")} b
        JOIN ${tabela("OmieTitulo")} t ON t.id = b."tituloId"
       WHERE b."companyId" = ${companyId}
         AND b."dataBaixa" >= ${desde}
         AND b."dataBaixa" <= ${ate}
         ${filtroConexaoBaixa}
       GROUP BY 1, 2
       ORDER BY 1
    `,
    // Faturamento fiscal, pela data de EMISSÃO da nota. Nota cancelada fora:
    // ela fica no espelho porque nota cancelada com título vivo é achado do
    // agente fiscal, mas não é faturamento.
    prisma.$queryRaw<LinhaFiscal[]>`
      SELECT date_trunc('month', n."dataEmissao") AS mes,
             SUM(n."valorCents")::bigint AS valor,
             COUNT(*)::bigint AS quantidade
        FROM ${tabela("OmieNota")} n
       WHERE n."companyId" = ${companyId}
         AND n.cancelada = false
         AND n."dataEmissao" >= ${desde}
         AND n."dataEmissao" <= ${ate}
         ${filtroConexaoNota}
       GROUP BY 1
       ORDER BY 1
    `,
  ]);

  // Um mês sem título nenhum precisa aparecer com zero, e não sumir.
  // Buraco na série é lido como "não aconteceu nada"; linha zerada é lida como
  // "não faturamos nesse mês" — e a segunda é a que faz alguém perguntar por
  // quê.
  const meses = new Map<string, MesDaSerie>();
  const cursor = new Date(Date.UTC(desde.getUTCFullYear(), desde.getUTCMonth(), 1));
  const limite = new Date(Date.UTC(ate.getUTCFullYear(), ate.getUTCMonth(), 1));
  while (cursor <= limite) {
    meses.set(chave(cursor), {
      competencia: chave(cursor),
      rotulo: rotuloMes(new Date(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1)),
      receitaCents: 0,
      despesaCents: 0,
      resultadoCents: 0,
      margemPercent: null,
      titulosReceber: 0,
      titulosPagar: 0,
      receitaAcumuladaCents: 0,
      despesaAcumuladaCents: 0,
      resultadoAcumuladoCents: 0,
      recebidoCents: 0,
      pagoCents: 0,
      fluxoLiquidoCents: 0,
      receitaFiscalCents: 0,
      notasEmitidas: 0,
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  for (const linha of competencia) {
    const mes = meses.get(chave(linha.mes));
    if (!mes) continue;
    if (linha.natureza === "RECEBER") {
      mes.receitaCents = Number(linha.valor);
      mes.titulosReceber = Number(linha.quantidade);
    } else {
      mes.despesaCents = Number(linha.valor);
      mes.titulosPagar = Number(linha.quantidade);
    }
  }

  for (const linha of caixa) {
    const mes = meses.get(chave(linha.mes));
    if (!mes) continue;
    if (linha.natureza === "RECEBER") mes.recebidoCents = Number(linha.valor);
    else mes.pagoCents = Number(linha.valor);
  }

  for (const linha of fiscal) {
    const mes = meses.get(chave(linha.mes));
    if (!mes) continue;
    mes.receitaFiscalCents = Number(linha.valor);
    mes.notasEmitidas = Number(linha.quantidade);
  }

  let anoCorrente = -1;
  let receitaAcumulada = 0;
  let despesaAcumulada = 0;

  const serie = [...meses.values()];
  for (const mes of serie) {
    const ano = Number(mes.competencia.slice(0, 4));
    if (ano !== anoCorrente) {
      anoCorrente = ano;
      receitaAcumulada = 0;
      despesaAcumulada = 0;
    }
    receitaAcumulada += mes.receitaCents;
    despesaAcumulada += mes.despesaCents;

    mes.resultadoCents = mes.receitaCents - mes.despesaCents;
    mes.margemPercent = mes.receitaCents > 0 ? (mes.resultadoCents / mes.receitaCents) * 100 : null;
    mes.receitaAcumuladaCents = receitaAcumulada;
    mes.despesaAcumuladaCents = despesaAcumulada;
    mes.resultadoAcumuladoCents = receitaAcumulada - despesaAcumulada;
    mes.fluxoLiquidoCents = mes.recebidoCents - mes.pagoCents;
  }

  return serie;
}
