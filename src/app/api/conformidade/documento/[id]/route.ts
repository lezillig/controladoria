import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { acessoDaSessao } from "@/app/(app)/_dados";
import { prisma } from "@/lib/prisma";

// Download do arquivo original recebido da consultoria.
//
// Caminho ÚNICO de saída do conteúdo binário: nenhuma tela, consulta de
// contexto ou relatório carrega o arquivo. Isso mantém duas coisas verdadeiras
// ao mesmo tempo — o documento fica guardado inteiro, como evidência, e nunca
// aparece por acidente numa consulta que só queria a lista de apontamentos.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // A MESMA regra da tela, e não o papel cru: um perfil que não dá acesso à
  // tela não pode dar acesso ao conteúdo dela por uma rota direta.
  const acesso = await acessoDaSessao(session);
  if (!acesso.permissoes.has("conformidade")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  // O companyId no filtro, e não só o id: sem ele, um id de outra empresa
  // entregaria o relatório de risco dela a um usuário autenticado deste tenant.
  const documento = await prisma.conformidadeDocumento.findFirst({
    where: { id, companyId: session.companyId },
    select: { conteudo: true, mimeType: true, arquivoNome: true },
  });

  if (!documento) return NextResponse.json({ error: "não encontrado" }, { status: 404 });

  return new NextResponse(Buffer.from(documento.conteudo) as unknown as BodyInit, {
    headers: {
      // Sempre `attachment`, e sempre com o mime-type declarado no upload —
      // que veio do navegador de quem enviou e portanto não é confiável.
      // Abrir inline um arquivo de origem externa dentro do domínio do sistema
      // é o caminho clássico de XSS por upload; baixar não é.
      "Content-Type": documento.mimeType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${nomeSeguro(documento.arquivoNome)}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-store",
    },
  });
}

// O nome vem do arquivo que a pessoa enviou. Aspas e quebras de linha nele
// permitiriam injetar diretivas no cabeçalho HTTP; o que sobra é ASCII simples.
function nomeSeguro(nome: string): string {
  const limpo = nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w.-]/g, "_")
    .slice(0, 120);
  return limpo || "documento";
}
