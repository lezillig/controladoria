import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { conferirAcessoDoUsuario } from "@/lib/gestao/leitura";

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

// A SESSÃO É RECONFERIDA NO CADASTRO A CADA REQUISIÇÃO.
//
// O login documenta uma promessa: "quem é desativado na gestão perde o acesso
// ao financeiro no mesmo ato". Só verificar a assinatura do JWT não cumpre
// essa promessa — cumpre o contrário. O token vale doze horas e não sabe nada
// do que aconteceu depois de emitido, então desativar alguém às nove da manhã
// deixava a sessão aberta dele funcionando até as nove da noite, com acesso ao
// caixa das duas empresas.
//
// Papel também é reconferido, e pelo mesmo motivo: rebaixar alguém de GESTOR
// para FOLHA não podia depender de a pessoa fazer logout para valer.
//
// O custo é uma consulta indexada por id. `cache` do React resolve a
// duplicação DENTRO de uma requisição — layout, página e ações chamam
// `getSession` várias vezes e todas compartilham o mesmo resultado.
const conferirAcesso = cache(async (userId: string) => conferirAcessoDoUsuario(userId));

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const sessao = await verifySession(token);
  if (!sessao) return null;

  const acesso = await conferirAcesso(sessao.userId);

  // Banco fora do ar não expulsa ninguém. É uma escolha consciente entre dois
  // riscos: manter por alguns minutos um acesso que talvez já tenha sido
  // revogado, ou trancar todo mundo para fora do sistema financeiro sempre que
  // o Postgres tiver um soluço. O primeiro é recuperável; o segundo é um
  // apagão. O token continua expirando em doze horas de qualquer forma.
  if (acesso.situacao === "indisponivel") return sessao;
  if (acesso.situacao === "revogado") return null;

  return { ...sessao, role: acesso.role };
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
