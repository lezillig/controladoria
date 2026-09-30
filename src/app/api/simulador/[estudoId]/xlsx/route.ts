import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/app/(app)/_dados";
import { exportarEstudo } from "@/lib/simulador/exportacaoEstudo";
import type { EntradaSimulacao } from "@/lib/simulador/tipos";

// PLANILHA DO ESTUDO, EM FÓRMULAS.
//
// GET ?versao=<id>: a versão salva, reexecutada do snapshot.
// POST { entrada }: o rascunho que está na tela, sem gravar nada.
//
// Basta a permissão de ver o simulador: exportar não altera o estudo. A
// empresa vem da sessão — o id do estudo de outra empresa responde 404.

export const runtime = "nodejs";

const TAMANHO_MAXIMO = 2_000_000;

function resposta(r: Awaited<ReturnType<typeof exportarEstudo>>) {
  if ("erro" in r) return NextResponse.json({ erro: r.erro }, { status: r.erro.includes("não encontrad") ? 404 : 400 });
  return new NextResponse(new Uint8Array(r.conteudo), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${r.nome}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ estudoId: string }> }) {
  const session = await exigirPermissao("simulador");
  const { estudoId } = await params;
  const versao = req.nextUrl.searchParams.get("versao");
  if (!versao) return NextResponse.json({ erro: "Informe a versão." }, { status: 400 });
  return resposta(await exportarEstudo(session.companyId, estudoId, { simulacaoId: versao }));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ estudoId: string }> }) {
  const session = await exigirPermissao("simulador");
  const { estudoId } = await params;
  const texto = await req.text();
  if (texto.length > TAMANHO_MAXIMO) return NextResponse.json({ erro: "Simulação grande demais." }, { status: 413 });
  let corpo: { entrada?: EntradaSimulacao };
  try {
    corpo = JSON.parse(texto);
  } catch {
    return NextResponse.json({ erro: "Corpo inválido." }, { status: 400 });
  }
  if (!corpo?.entrada) return NextResponse.json({ erro: "Envie a entrada da simulação." }, { status: 400 });
  return resposta(await exportarEstudo(session.companyId, estudoId, { entrada: corpo.entrada }));
}
