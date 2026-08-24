import { prisma } from "@/lib/prisma";

// SALDO POR CONTA CORRENTE — onde está a diferença.
//
// A Omie mostra "Saldo em Contas" de R$ 2,99 milhões. O painel mostrava
// R$ 131 mil. Um número contra o outro não dá para investigar: os dois são
// totais, e total contra total só permite discordar.
//
// Esta consulta quebra o nosso lado conta a conta e mostra as três parcelas
// que o compõem — saldo inicial cadastrado, movimentos de extrato espelhados,
// baixas de título espelhadas — mais o período que cada uma cobre. Com isso a
// pergunta deixa de ser "por que dá diferente" e passa a ser respondível
// olhando a linha: conta sem nenhum movimento espelhado é falha de leitura do
// extrato; conta com movimento mas com período que começa depois do saldo
// inicial é buraco de janela; conta cujo saldo bate é conta que está certa.
//
// AS BAIXAS ENTRAM SÓ COMO REFERÊNCIA, não somadas ao saldo. Baixa de título e
// linha de extrato são a MESMA movimentação vista de dois lugares: somar as
// duas contaria cada pagamento duas vezes. A coluna existe porque, quando o
// extrato vem vazio e as baixas não, ela mostra que o dinheiro passou pela
// conta e que o que falta é o espelho do extrato — que é exatamente a hipótese
// que estava em aberto.
//
// Somado no banco, uma linha por conta. Ver o comentário de saudeDaBase.ts:
// esta tela recarrega sozinha enquanto a carga anda, e trazer movimento para a
// memória da função foi o que já derrubou a franquia do banco uma vez.

export type SaldoDaConta = {
  conexaoApelido: string;
  codigo: string;
  descricao: string;
  banco: string | null;
  numeroConta: string | null;
  inativa: boolean;
  saldoInicialCents: number;
  movimentos: number;
  somaMovimentosCents: number;
  primeiroMovimento: Date | null;
  ultimoMovimento: Date | null;
  baixas: number;
  somaBaixasCents: number;
  // Saldo inicial + movimentos de extrato. É o que o módulo consegue afirmar
  // com o que tem espelhado — e só vale quando a coluna de movimentos cobre o
  // período inteiro desde o saldo inicial.
  saldoCalculadoCents: number;
};

type LinhaBruta = {
  conexaoApelido: string;
  codigo: string;
  descricao: string;
  banco: string | null;
  numeroConta: string | null;
  inativa: boolean;
  saldo_inicial: bigint;
  movimentos: bigint;
  soma_movimentos: bigint;
  primeiro: Date | null;
  ultimo: Date | null;
  baixas: bigint;
  soma_baixas: bigint;
};

export async function saldosPorConta(companyId: string): Promise<SaldoDaConta[]> {
  // As duas agregações vão em subconsulta, e não em JOIN direto com GROUP BY
  // no fim: juntar movimento e baixa na mesma varredura multiplicaria as
  // linhas de uma pela quantidade da outra, e o total sairia inflado sem que
  // nada na tela denunciasse.
  const linhas = await prisma.$queryRaw<LinhaBruta[]>`
    SELECT cc."conexaoApelido",
           cc.codigo,
           cc.descricao,
           cc.banco,
           cc."numeroConta",
           cc.inativa,
           cc."saldoInicialCents"::bigint       AS saldo_inicial,
           COALESCE(m.qtd, 0)::bigint           AS movimentos,
           COALESCE(m.soma, 0)::bigint          AS soma_movimentos,
           m.primeiro                           AS primeiro,
           m.ultimo                             AS ultimo,
           COALESCE(b.qtd, 0)::bigint           AS baixas,
           COALESCE(b.soma, 0)::bigint          AS soma_baixas
      FROM "OmieContaCorrente" cc
      LEFT JOIN (
        SELECT "conexaoId",
               "contaCorrenteCodigo",
               COUNT(*)           AS qtd,
               SUM("valorCents")  AS soma,
               MIN(data)          AS primeiro,
               MAX(data)          AS ultimo
          FROM "OmieMovimento"
         WHERE "companyId" = ${companyId}
         GROUP BY 1, 2
      ) m ON m."conexaoId" = cc."conexaoId" AND m."contaCorrenteCodigo" = cc.codigo
      LEFT JOIN (
        -- Sinal pela natureza do título: baixa de PAGAR sai da conta, baixa de
        -- RECEBER entra. Somar as duas em módulo daria um número grande e sem
        -- significado nenhum.
        SELECT bx."conexaoId",
               bx."contaCorrenteCodigo",
               COUNT(*) AS qtd,
               SUM(CASE WHEN t.natureza::text = 'PAGAR' THEN -bx."valorCents" ELSE bx."valorCents" END) AS soma
          FROM "OmieBaixa" bx
          JOIN "OmieTitulo" t ON t.id = bx."tituloId"
         WHERE bx."companyId" = ${companyId}
         GROUP BY 1, 2
      ) b ON b."conexaoId" = cc."conexaoId" AND b."contaCorrenteCodigo" = cc.codigo
     WHERE cc."companyId" = ${companyId}
     ORDER BY cc."conexaoApelido", cc.descricao
  `;

  return linhas.map((l) => ({
    conexaoApelido: l.conexaoApelido,
    codigo: l.codigo,
    descricao: l.descricao,
    banco: l.banco,
    numeroConta: l.numeroConta,
    inativa: l.inativa,
    saldoInicialCents: Number(l.saldo_inicial),
    movimentos: Number(l.movimentos),
    somaMovimentosCents: Number(l.soma_movimentos),
    primeiroMovimento: l.primeiro,
    ultimoMovimento: l.ultimo,
    baixas: Number(l.baixas),
    somaBaixasCents: Number(l.soma_baixas),
    saldoCalculadoCents: Number(l.saldo_inicial) + Number(l.soma_movimentos),
  }));
}

// Total do que o módulo consegue afirmar, e de quanta conta ele consegue
// afirmar. As duas coisas juntas: um total de saldo sem dizer que metade das
// contas está sem extrato é o número que criou a confusão em primeiro lugar.
export type ResumoDeSaldos = {
  contas: number;
  contasAtivasSemMovimento: number;
  saldoCalculadoCents: number;
  somaBaixasCents: number;
};

export function resumirSaldos(contas: SaldoDaConta[]): ResumoDeSaldos {
  return {
    contas: contas.length,
    contasAtivasSemMovimento: contas.filter((c) => !c.inativa && c.movimentos === 0).length,
    saldoCalculadoCents: contas.reduce((a, c) => a + c.saldoCalculadoCents, 0),
    somaBaixasCents: contas.reduce((a, c) => a + c.somaBaixasCents, 0),
  };
}
