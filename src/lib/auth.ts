import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

// Cookie próprio: os dois sistemas são aplicações distintas, e uma sessão
// compartilhada faria o logout de um derrubar o outro (e, pior, um problema de
// sessão num contaminaria o outro). O que é compartilhado é o CADASTRO de
// usuário, não a sessão.
export const SESSION_COOKIE = "controladoria_session";

// Sem fallback proposital: assinar/verificar sessao com uma chave publica e
// conhecida (ex.: um valor padrao hardcoded) permitiria forjar um JWT valido
// para qualquer usuario/empresa caso a variavel de ambiente nao esteja
// configurada. Falha alto (throw) em vez de falhar aberto (fallback inseguro).
function getSecret(): Uint8Array {
  const value = process.env.JWT_SECRET;
  if (!value) {
    throw new Error(
      "JWT_SECRET não configurado. Defina essa variável de ambiente antes de autenticar usuários."
    );
  }
  return new TextEncoder().encode(value);
}

// `role` é texto, não enum: o papel vem da tabela de usuários do sistema de
// gestão, que é dono daquele enum. Copiar o enum para cá criaria dois lugares
// para manter em sincronia — e um papel novo lá quebraria o login aqui.
export type SessionPayload = {
  userId: string;
  name: string;
  email: string;
  role: string;
  companyId: string;
};

export async function signSession(payload: SessionPayload) {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(getSecret());
}

export async function verifySession(
  token: string
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function requireRole(...roles: string[]): Promise<SessionPayload> {
  const session = await requireSession();
  if (!roles.includes(session.role)) {
    // Destino fixo e sem permissão própria: /sem-acesso. Redirecionar para
    // uma rota que também exige papel criaria loop infinito de redirect — bug
    // real já visto neste código quando o destino era o painel.
    redirect("/sem-acesso");
  }
  return session;
}
