import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { detalharJurosEMulta, detalharPerdas, ehComponenteDePerda, periodoLivre } from "@/lib/controladoria/detalhamento";
import { cabecalhoDeContexto, montarCsv, nomeDoArquivo } from "@/lib/controladoria/exportarCsv";
import { exigirPermissao, resolverEscopo } from "@/app/(app)/_dados";

// PLANILHA DAS PERDAS DE UM PERÍODO — juros e multa por atraso (juntos ou
// separados), tarifa e desconto concedido, baixa a baixa. É a mesma consulta
// da tela de detalhamento, sem o teto de linhas da tela: a planilha leva todas.
//
// Juros e multa juntos é a lista para cobrar do responsável pelo atraso e para
// medir o que ele custou no ano.

const SEM_TETO = 100_000;

export async function GET(req: NextRequest) {
  const session = await exigirPermissao("painel");
  const q = req.nextUrl.searchParams;
  const parte = q.get("parte") ?? "juros_multa";
  const periodo = periodoLivre(q.get("de") ?? undefined, q.get("ate") ?? undefined);
  if (!periodo) return new NextResponse("Período inválido: informe de e ate no formato AAAA-MM-DD.", { status: 400 });
  if (parte !== "juros_multa" && !ehComponenteDePerda(parte)) return new NextResponse("Componente inválido.", { status: 400 });

  const escopo = await resolverEscopo(session.companyId, q.get("empresa") ?? undefined);
  const base = { companyId: session.companyId, conexaoId: escopo.conexaoId, periodo, limite: SEM_TETO };
  const dados = parte === "juros_multa" ? await detalharJurosEMulta(base) : await detalharPerdas({ ...base, componente: parte });

  const empresa = escopo.apelido
    ? escopo.apelido
    : (await prisma.omieConexao.count({ where: { companyId: session.companyId, ativa: true } })) > 1
      ? "Grupo (todas)"
      : "Grupo";
  const extras = dados.extras ?? [];
  const data = (d: Date) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;

  const linhas: (string | number | null)[][] = [
    ...cabecalhoDeContexto({ titulo: dados.titulo, empresa, competencia: periodo.rotulo, criterio: dados.criterio, geradoEm: new Date() }),
    [dados.rotuloData, "Empresa", "Documento", "Parceiro", "Classificação", ...extras.map((e) => `${e} (R$)`), `${dados.rotuloValor} (R$)`],
    ...dados.linhas.map((l) => [
      data(l.data),
      l.empresa,
      l.documento ?? "",
      l.parceiro ?? "",
      l.descricao ?? "",
      ...(l.extrasCents ?? []).map((v) => v / 100),
      l.valorCents / 100,
    ]),
    // O total na própria tabela: é o número que precisa bater com a tela.
    ["TOTAL", "", "", `${dados.quantidade} baixas`, "", ...(dados.totaisExtrasCents ?? []).map((v) => v / 100), dados.totalCents / 100],
  ];

  return new NextResponse(montarCsv(linhas), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nomeDoArquivo(parte === "juros_multa" ? "juros-e-multa" : parte, empresa, periodo.rotulo)}"`,
      "Cache-Control": "no-store",
    },
  });
}
