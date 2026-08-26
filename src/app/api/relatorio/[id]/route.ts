import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { acessoDaSessao } from "@/app/(app)/_dados";
import { prisma } from "@/lib/prisma";

// Serve o HTML de um relatório já gerado — exatamente o mesmo conteúdo que foi
// enviado por e-mail naquele dia.
//
// Rota própria, e não uma página dentro do app, por dois motivos: o HTML de
// e-mail traz o próprio <html> e estilos completos (embutir isso numa página
// do sistema quebraria os dois layouts), e assim a visualização na tela é
// literalmente o que o destinatário recebeu — não uma reconstrução parecida.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // A MESMA regra da tela, e não o papel cru: um perfil que não dá acesso à
  // tela não pode dar acesso ao conteúdo dela por uma rota direta.
  const acesso = await acessoDaSessao(session);
  if (!acesso.permissoes.has("relatorios")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  // Filtra por companyId junto do id: sem isso, um id de outra empresa
  // devolveria o relatório financeiro dela para um usuário autenticado deste
  // tenant (o resto do sistema é multiempresa, ver Company no schema).
  const relatorio = await prisma.relatorioDiario.findFirst({
    where: { id, companyId: session.companyId },
    select: { html: true, assunto: true },
  });

  if (!relatorio) {
    return NextResponse.json({ error: "não encontrado" }, { status: 404 });
  }

  return new NextResponse(relatorio.html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // O conteúdo é gerado e escapado pelo próprio sistema (ver esc() em
      // reportHtml.ts), mas ele carrega nome de fornecedor e texto de achado
      // vindos de fora. A CSP é a segunda barreira: nada de script, nada de
      // requisição externa, nem que o escape falhe um dia.
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'",
      "X-Content-Type-Options": "nosniff",
      // Relatório financeiro não deve ficar em cache de proxy compartilhado.
      "Cache-Control": "private, no-store",
    },
  });
}
