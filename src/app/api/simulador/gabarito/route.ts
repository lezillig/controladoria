import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { exigirPermissao } from "@/app/(app)/_dados";

// O GABARITO EM BRANCO — a planilha que a área preenche com a base de custos
// (parâmetros, frota, mão de obra por função, pedágios, regras de margem) e
// devolve na tela Base de custos. Só com sessão: não tem dado, mas é
// material interno.

export const runtime = "nodejs";

const ARQUIVO = path.join(process.cwd(), "docs/simulador_custos_handoff/planilhas_referencia/Gabarito_Dados_Simulador_Custos_AzulMob.xlsx");

export async function GET() {
  await exigirPermissao("simulador");
  const conteudo = await readFile(ARQUIVO).catch(() => null);
  if (!conteudo) return NextResponse.json({ erro: "Gabarito indisponível neste ambiente." }, { status: 404 });
  return new NextResponse(new Uint8Array(conteudo), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="Gabarito_Base_de_Custos.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
