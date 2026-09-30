import { NextRequest, NextResponse } from "next/server";
import { requisicaoDeOutroSite, SESSION_COOKIE } from "@/lib/auth";

export async function POST(req: NextRequest) {
  // Logout forçado por outro site (formulário invisível numa página qualquer)
  // é recusado — ver `requisicaoDeOutroSite`.
  if (requisicaoDeOutroSite(req.headers)) {
    return NextResponse.json({ error: "origem recusada" }, { status: 403 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
