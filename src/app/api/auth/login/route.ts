import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { buscarUsuarioPorEmail } from "@/lib/gestao/leitura";
import { canViewControladoria } from "@/lib/permissions";
import { signSession, SESSION_COOKIE } from "@/lib/auth";

// Autenticação contra o cadastro de usuários do sistema de gestão (mesmo
// banco, schema `public`). Ganha-se credencial única e, principalmente,
// desligamento único: quem é desativado lá perde o acesso ao financeiro no
// mesmo ato. Cadastro separado significaria, mais cedo ou mais tarde, um
// ex-funcionário com acesso ao módulo que mostra o caixa da empresa.

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }

  const { email, password } = parsed.data;
  const user = await buscarUsuarioPorEmail(email);

  if (!user || !user.active) {
    return NextResponse.json({ error: "Credenciais inválidas" }, { status: 401 });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "Credenciais inválidas" }, { status: 401 });
  }

  // Senha correta, mas sem permissão para este sistema: mensagem diferente da
  // de credencial inválida, de propósito. Dizer "credenciais inválidas" a quem
  // digitou a senha certa faz a pessoa tentar de novo, resetar a senha e abrir
  // chamado — quando o problema é permissão, não senha.
  if (!canViewControladoria(user.role)) {
    return NextResponse.json(
      { error: "Seu usuário não tem acesso à Controladoria. Peça a um administrador o perfil adequado." },
      { status: 403 }
    );
  }

  const token = await signSession({
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    companyId: user.companyId,
  });

  const res = NextResponse.json({ ok: true, role: user.role });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return res;
}
