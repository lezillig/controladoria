import { NextRequest, NextResponse } from "next/server";
import { redigir } from "@/lib/controladoria/falhas";
import { integracaoAutorizada, multasParaGestao, type MultaPedida } from "@/lib/integracao/gestao";

// O PAGAMENTO DAS MULTAS NA OMIE, pelo AIT — pedido pela gestão, que é dona
// das multas (src/lib/integracao/gestao.ts explica o contrato).
// Corpo: { empresa, multas: [{ ait, dataInfracao: "AAAA-MM-DD" }], desde?: "AAAA-MM-DD" }.

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MAXIMO = 3000;
const data = (v: unknown) => {
  const d = typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(`${v.slice(0, 10)}T00:00:00.000Z`) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

export async function POST(req: NextRequest) {
  const auth = integracaoAutorizada(req);
  if (auth === "nao-configurada") return NextResponse.json({ erro: "integração não configurada (INTEGRACAO_TOKEN)" }, { status: 503 });
  if (!auth) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  const corpo = (await req.json().catch(() => null)) as { empresa?: unknown; multas?: unknown; desde?: unknown } | null;
  const empresa = typeof corpo?.empresa === "string" ? corpo.empresa.trim() : "";
  if (!empresa || !Array.isArray(corpo?.multas)) return NextResponse.json({ erro: "corpo esperado: { empresa, multas: [{ ait, dataInfracao }], desde? }" }, { status: 400 });
  if (corpo.multas.length > MAXIMO) return NextResponse.json({ erro: `no máximo ${MAXIMO} multas por chamada` }, { status: 400 });
  const multas: MultaPedida[] = [];
  for (const m of corpo.multas as { ait?: unknown; dataInfracao?: unknown }[]) {
    const dataInfracao = data(m?.dataInfracao);
    if (typeof m?.ait === "string" && dataInfracao) multas.push({ ait: m.ait, dataInfracao });
  }
  try {
    return NextResponse.json(await multasParaGestao(empresa, multas, data(corpo.desde)));
  } catch (e) {
    return NextResponse.json({ erro: redigir(e instanceof Error ? e.message : "erro").slice(0, 300) }, { status: 500 });
  }
}
