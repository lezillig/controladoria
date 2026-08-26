import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { composicaoDoPeriodo } from "@/lib/controladoria/composicao";
import { retencoesDoPeriodo } from "@/lib/controladoria/retencoes";
import { cabecalhoDeContexto, montarCsv, nomeDoArquivo } from "@/lib/controladoria/exportarCsv";
import { mesCompleto, rotuloMes } from "@/lib/controladoria/periodos";
import { resolverEscopo, resolverPeriodo, resolverRegime } from "@/app/(app)/_dados";
import { exigirPermissao } from "@/app/(app)/_dados";

// EXPORTAÇÃO DA COMPOSIÇÃO DE RECEITA E DESPESA.
//
// "Os valores de receita e despesa estão incorretos, gerar planilha para
// corrigirmos as informações." O conserto não é aqui — é na Omie, categoria por
// categoria — e quem vai fazer precisa de uma lista que dê para ordenar,
// filtrar e riscar conforme resolve. A tela mostra; a planilha é onde se
// trabalha.
//
// Receita e despesa saem no MESMO arquivo, com uma coluna "Natureza". Dois
// arquivos separados obrigariam a abrir os dois para somar o resultado, e a
// primeira coisa que alguém faz com essa lista é justamente cruzar os dois
// lados.
//
// As somas são as MESMAS que a tela exibe — a mesma função, não uma consulta
// paralela. Planilha que diverge da tela é pior que planilha nenhuma: as duas
// circulam, ninguém sabe qual vale, e a correção é feita sobre a errada.

export async function GET(req: NextRequest) {
  const session = await exigirPermissao("custos");

  const empresaParam = req.nextUrl.searchParams.get("empresa") ?? undefined;
  const competenciaParam = req.nextUrl.searchParams.get("competencia") ?? undefined;
  const regime = resolverRegime(req.nextUrl.searchParams.get("regime") ?? undefined);
  const noCaixa = regime === "caixa";

  const escopo = await resolverEscopo(session.companyId, empresaParam);
  const periodo = resolverPeriodo(competenciaParam);
  // Mês inteiro, igual à tela: planilha que diverge da tela é pior que
  // planilha nenhuma.
  const mes = mesCompleto(periodo.dataReferencia);
  // "agosto/2026", e nao "Mês atual (agosto/2026)": o rótulo da tela carrega
  // contexto que no nome do arquivo vira ruído.
  const competencia = rotuloMes(periodo.dataReferencia);

  // Em sequência, não em paralelo: o pooler do Neon tem teto de conexões, e
  // uma rota de exportação não pode competir com quem está navegando.
  const escopoConsulta = { companyId: session.companyId, conexaoId: escopo.conexaoId };
  const receita = await composicaoDoPeriodo({ ...escopoConsulta, periodo: mes, natureza: "RECEBER", regime });
  const despesa = await composicaoDoPeriodo({ ...escopoConsulta, periodo: mes, natureza: "PAGAR", regime });
  const retencoes = await retencoesDoPeriodo({ ...escopoConsulta, periodo: mes });

  const empresa = escopo.apelido
    ? escopo.apelido
    : (await prisma.omieConexao.count({ where: { companyId: session.companyId, ativa: true } })) > 1
      ? "Grupo (todas)"
      : "Grupo";

  const linhas: (string | number | null)[][] = [
    ...cabecalhoDeContexto({
      titulo: noCaixa
        ? "Composição do recebido e do pago por categoria (regime de CAIXA)"
        : "Composição de receita e despesa por categoria (regime de COMPETÊNCIA)",
      empresa,
      competencia: competencia,
      // O critério viaja com o arquivo. Ele circula por e-mail e é aberto por
    // quem não escolheu o regime — sem esta linha, dois arquivos do mesmo mês
    // com números diferentes parecem contradição, e são só perguntas
    // diferentes.
    criterio: noCaixa
      ? "Caixa — baixas registradas no mês inteiro, pela data da baixa, no valor baixado"
      : "Competência — títulos não cancelados, pela data de EMISSÃO no mês inteiro, no valor do documento",
      geradoEm: new Date(),
    }),
    [
      "Natureza",
      "Categoria",
      "Tipo de documento",
      "Conta corrente",
      noCaixa ? "Baixas" : "Títulos",
      "Valor (R$)",
      "% da natureza",
    ],
  ];

  const bloco = (rotulo: string, dados: typeof receita) => {
    for (const l of dados.linhas) {
      linhas.push([rotulo, l.categoria, l.tipo, l.conta, l.quantidade, l.valorCents / 100, l.participacaoPercent]);
    }
    // Total por natureza na própria tabela, e não só implícito na soma das
    // linhas: é o número que precisa bater com a tela, e deixá-lo explícito é
    // o que permite conferir sem refazer a conta.
    linhas.push([rotulo, "TOTAL", "", "", dados.quantidade, dados.totalCents / 100, 100]);
  };

  bloco(noCaixa ? "Recebido" : "Receita", receita);
  linhas.push([]);
  bloco(noCaixa ? "Pago" : "Despesa", despesa);
  linhas.push([]);
  linhas.push([
    noCaixa ? "Fluxo líquido" : "Resultado",
    noCaixa ? "RECEBIDO - PAGO" : "RECEITA - DESPESA",
    "",
    "",
    "",
    (receita.totalCents - despesa.totalCents) / 100,
    "",
  ]);

  // RETENÇÕES, no mesmo arquivo e depois do resultado.
  //
  // Quem abre esta planilha está conferindo o mês contra o extrato e contra o
  // que o contador apurou. A retenção é a primeira coisa que explica os dois
  // não baterem — e procurá-la numa segunda planilha significa, na prática,
  // não procurá-la.
  if (retencoes.linhas.length > 0) {
    linhas.push([]);
    linhas.push([
      "Retenção",
      "Tributo",
      "",
      "",
      "",
      "Retido sobre a receber (R$)",
      "Retido sobre a pagar (R$)",
    ]);
    for (const r of retencoes.linhas) {
      linhas.push(["Retenção", r.tributo, "", "", "", r.receberCents / 100, r.pagarCents / 100]);
    }
    linhas.push(["Retenção", "TOTAL", "", "", "", retencoes.totalReceberCents / 100, retencoes.totalPagarCents / 100]);
  }

  const csv = montarCsv(linhas);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nomeDoArquivo(noCaixa ? "composicao-caixa" : "composicao-competencia", empresa, competencia)}"`,
      // Sem cache: os números mudam a cada sincronização, e uma planilha
      // servida de cache traria o retrato de ontem sem avisar.
      "Cache-Control": "no-store",
    },
  });
}
