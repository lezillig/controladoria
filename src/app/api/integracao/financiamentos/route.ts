import { NextRequest, NextResponse } from "next/server";
import { redigir } from "@/lib/controladoria/falhas";
import { financiamentosParaGestao, integracaoAutorizada } from "@/lib/integracao/gestao";

// A SITUAÇÃO DE CADA CONTRATO DA GESTÃO NA OMIE — lida pela gestão uma vez
// por dia (src/lib/integracao/gestao.ts explica o contrato da integração).

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = integracaoAutorizada(req);
  if (auth === "nao-configurada") return NextResponse.json({ erro: "integração não configurada (INTEGRACAO_TOKEN)" }, { status: 503 });
  if (!auth) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  const empresa = req.nextUrl.searchParams.get("empresa")?.trim();
  if (!empresa) return NextResponse.json({ erro: "informe ?empresa=<id da empresa>" }, { status: 400 });
  try {
    const r = await financiamentosParaGestao(empresa);
    // Sem a leitura dos contratos, a resposta vazia diria "nada pago" — melhor dizer que não deu.
    if (!r.gestaoDisponivel) return NextResponse.json({ erro: "a controladoria não conseguiu ler os contratos da gestão" }, { status: 503 });
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ erro: redigir(e instanceof Error ? e.message : "erro").slice(0, 300) }, { status: 500 });
  }
}
