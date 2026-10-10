import { NextResponse } from "next/server";
import { exigirPermissao } from "@/app/(app)/_dados";
import { prisma } from "@/lib/prisma";

// Download de um arquivo guardado com o estudo (edital, ata, contrato). Único
// caminho de saída do conteúdo: as telas só listam nome e tamanho. Sempre como
// anexo, com o cabeçalho que impede o navegador de executar o arquivo — ele
// veio de fora (o edital do órgão, o envio de alguém).

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ estudoId: string; arquivoId: string }> }) {
  const session = await exigirPermissao("simulador");
  const { estudoId, arquivoId } = await params;
  const a = await prisma.simArquivo.findFirst({
    where: { id: arquivoId, estudoId, companyId: session.companyId },
    select: { conteudo: true, mimeType: true, nome: true },
  });
  if (!a) return NextResponse.json({ error: "não encontrado" }, { status: 404 });
  return new NextResponse(Buffer.from(a.conteudo) as unknown as BodyInit, {
    headers: {
      "Content-Type": a.mimeType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${nomeSeguro(a.nome)}"; filename*=UTF-8''${encodeURIComponent(a.nome.slice(0, 150))}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-store",
    },
  });
}

function nomeSeguro(nome: string): string {
  const limpo = nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w.-]/g, "_")
    .slice(0, 120);
  return limpo || "arquivo";
}
