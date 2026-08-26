import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cabecalhoDeContexto, montarCsv, nomeDoArquivo } from "@/lib/controladoria/exportarCsv";
import { mesCompleto, rotuloMes } from "@/lib/controladoria/periodos";
import { resolverEscopo, resolverPeriodo } from "@/app/(app)/_dados";
import { exigirPermissao } from "@/app/(app)/_dados";

// AS NOTAS QUE O ESPELHO TEM, UMA POR LINHA.
//
// Existe para uma conferência específica: o faturamento do sistema não bate com
// a declaração que a contabilidade emitiu a partir da própria Omie. Total contra
// total só permite discordar — de novo. Nota contra nota diz QUAL nota falta.
//
// O formato é deliberadamente próximo do que a Omie exporta: tipo, número,
// série, data de emissão, tomador, valor e situação. Assim as duas planilhas
// abrem lado a lado e a comparação é por número da nota, que é a chave que as
// duas pontas reconhecem.
//
// NOTA CANCELADA ENTRA, marcada como tal. Ela não é faturamento — a soma da
// tela a exclui —, mas some da conferência se não aparecer aqui: a divergência
// mais comum é justamente uma nota que um lado considera cancelada e o outro
// não, e essa não dá para achar numa lista que já filtrou.

export async function GET(req: NextRequest) {
  const session = await exigirPermissao("titulos");

  const empresaParam = req.nextUrl.searchParams.get("empresa") ?? undefined;
  const competenciaParam = req.nextUrl.searchParams.get("competencia") ?? undefined;

  const escopo = await resolverEscopo(session.companyId, empresaParam);
  const periodo = resolverPeriodo(competenciaParam);
  const mes = mesCompleto(periodo.dataReferencia);
  const competencia = rotuloMes(periodo.dataReferencia);

  const notas = await prisma.omieNota.findMany({
    where: {
      companyId: session.companyId,
      ...(escopo.conexaoId ? { conexaoId: escopo.conexaoId } : {}),
      dataEmissao: { gte: mes.inicio, lte: mes.fim },
    },
    orderBy: [{ dataEmissao: "asc" }, { numero: "asc" }],
    select: {
      conexaoApelido: true,
      tipo: true,
      numero: true,
      serie: true,
      dataEmissao: true,
      parceiroNome: true,
      valorCents: true,
      valorServicosCents: true,
      valorIssCents: true,
      cancelada: true,
      chaveAcesso: true,
    },
  });

  const empresa = escopo.apelido
    ? escopo.apelido
    : (await prisma.omieConexao.count({ where: { companyId: session.companyId, ativa: true } })) > 1
      ? "Grupo (todas)"
      : "Grupo";

  const validas = notas.filter((n) => !n.cancelada);
  const totalCents = validas.reduce((a, n) => a + n.valorCents, 0);

  // Data em DD/MM/AAAA sem depender de fuso do runtime: as notas são gravadas
  // com data local à meia-noite, e formatar por UTC devolveria o dia anterior.
  const dataBr = (d: Date) =>
    `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;

  const linhas: (string | number | null)[][] = [
    ...cabecalhoDeContexto({
      titulo: "Notas fiscais espelhadas da Omie",
      empresa,
      competencia,
      criterio: "Pela data de EMISSÃO da nota. Canceladas aparecem marcadas e ficam fora do total.",
      geradoEm: new Date(),
    }),
    [
      "Empresa",
      "Tipo",
      "Número",
      "Série",
      "Emissão",
      "Tomador",
      "Valor (R$)",
      "Valor dos serviços (R$)",
      "ISS (R$)",
      "Situação",
      "Chave de acesso",
    ],
  ];

  for (const n of notas) {
    linhas.push([
      n.conexaoApelido,
      n.tipo,
      n.numero,
      n.serie,
      dataBr(n.dataEmissao),
      n.parceiroNome,
      n.valorCents / 100,
      n.valorServicosCents === null ? null : n.valorServicosCents / 100,
      n.valorIssCents === null ? null : n.valorIssCents / 100,
      n.cancelada ? "CANCELADA" : "Válida",
      n.chaveAcesso,
    ]);
  }

  linhas.push([]);
  linhas.push(["", "TOTAL VÁLIDAS", validas.length, "", "", "", totalCents / 100, "", "", "", ""]);
  linhas.push(["", "CANCELADAS", notas.length - validas.length, "", "", "", "", "", "", "", ""]);
  linhas.push([]);
  // O aviso viaja com o arquivo. Ele vai circular por e-mail e ser aberto por
  // quem não acompanhou a conversa; sem esta linha, alguém soma o total e
  // conclui que o sistema perdeu 8% do faturamento.
  linhas.push([
    "",
    "ATENÇÃO: esta lista tem apenas NF-e e NFS-e. O CT-e ainda não é espelhado, e a operação emite CT-e.",
  ]);

  return new NextResponse(montarCsv(linhas), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nomeDoArquivo("notas", empresa, competencia)}"`,
      "Cache-Control": "no-store",
    },
  });
}
