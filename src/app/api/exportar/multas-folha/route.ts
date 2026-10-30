import ExcelJS from "exceljs";
import { NextRequest, NextResponse } from "next/server";
import { eventosParaContabilidade } from "@/lib/frota/fechamentoMultasNoBanco";
import { exigirPermissao } from "@/app/(app)/_dados";

// OS EVENTOS DE DESCONTO DE MULTA DA COMPETÊNCIA, em planilha, para o RH
// colar na planilha de eventos da Contabilidade (o fluxograma da folha leva
// os eventos até o dia 20). Uma linha por motorista: matrícula (da lista de
// ativos da folha), nome, evento, valor e os AIT descontados.

export async function GET(req: NextRequest) {
  const session = await exigirPermissao("gerir-motoristas");
  const m = /^(\d{4})-(\d{2})$/.exec(req.nextUrl.searchParams.get("competencia") ?? "");
  if (!m) return NextResponse.json({ erro: "competência inválida" }, { status: 400 });
  const competencia = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  const eventos = await eventosParaContabilidade(session.companyId, competencia);
  const livro = new ExcelJS.Workbook();
  const ws = livro.addWorksheet(`Multas ${m[2]}-${m[1]}`);
  ws.addRow(["Competência", "Matrícula", "Nome", "Evento", "Valor", "AIT"]);
  ws.getRow(1).font = { bold: true };
  for (const e of eventos) ws.addRow([`${m[2]}/${m[1]}`, e.matricula ?? "", e.nome, "DESCONTO MULTA DE TRÂNSITO", e.valorCents / 100, e.aits.join(", ")]);
  ws.getColumn(5).numFmt = "#,##0.00";
  ws.columns.forEach((c, i) => (c.width = [12, 12, 40, 30, 12, 50][i]));
  const buffer = await livro.xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="eventos-multas-${m[1]}-${m[2]}.xlsx"`,
    },
  });
}
