import { NextRequest, NextResponse } from "next/server";
import { redigir } from "@/lib/controladoria/falhas";
import { integracaoAutorizada, notasParaGestao, type NotaPedida } from "@/lib/integracao/gestao";

// A NOTA FISCAL DE CADA VEÍCULO COMPRADO, nas contas a pagar da Omie — pedida
// pela gestão (src/lib/integracao/gestao.ts explica o contrato).
// Corpo: { empresa, notas: [{ ref, numero, data: "AAAA-MM-DD" }] }.

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MAXIMO = 500;

export async function POST(req: NextRequest) {
  const auth = integracaoAutorizada(req);
  if (auth === "nao-configurada") return NextResponse.json({ erro: "integração não configurada (INTEGRACAO_TOKEN)" }, { status: 503 });
  if (!auth) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  const corpo = (await req.json().catch(() => null)) as { empresa?: unknown; notas?: unknown } | null;
  const empresa = typeof corpo?.empresa === "string" ? corpo.empresa.trim() : "";
  if (!empresa || !Array.isArray(corpo?.notas)) return NextResponse.json({ erro: "corpo esperado: { empresa, notas: [{ ref, numero, data }] }" }, { status: 400 });
  if (corpo.notas.length > MAXIMO) return NextResponse.json({ erro: `no máximo ${MAXIMO} notas por chamada` }, { status: 400 });
  const notas: NotaPedida[] = [];
  for (const n of corpo.notas as { ref?: unknown; numero?: unknown; data?: unknown }[]) {
    const data = typeof n?.data === "string" && /^\d{4}-\d{2}-\d{2}/.test(n.data) ? new Date(`${n.data.slice(0, 10)}T00:00:00.000Z`) : null;
    if (typeof n?.ref === "string" && typeof n?.numero === "string" && data && !Number.isNaN(data.getTime())) notas.push({ ref: n.ref, numero: n.numero, data });
  }
  try {
    return NextResponse.json(await notasParaGestao(empresa, notas));
  } catch (e) {
    return NextResponse.json({ erro: redigir(e instanceof Error ? e.message : "erro").slice(0, 300) }, { status: 500 });
  }
}
