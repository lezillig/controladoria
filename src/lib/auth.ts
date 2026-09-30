import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { conferirAcessoDoUsuario, type AcessoAtual } from "@/lib/gestao/leitura";

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

// A DECISÃO, separada da consulta para ser testável sem banco
// (`npm run teste:acessos`).
export function sessaoVigente(sessao: SessionPayload, acesso: AcessoAtual): SessionPayload | null {
  // Banco fora do ar não expulsa ninguém. É uma escolha consciente entre dois
  // riscos: manter por alguns minutos um acesso que talvez já tenha sido
  // revogado, ou trancar todo mundo para fora do sistema financeiro sempre que
  // o Postgres tiver um soluço. O primeiro é recuperável; o segundo é um
  // apagão. O token continua expirando em doze horas de qualquer forma.
  if (acesso.situacao === "indisponivel") return sessao;
  if (acesso.situacao === "revogado") return null;

  // A EMPRESA também é reconferida, pelo mesmo motivo do papel. Todo filtro do
  // sistema usa o `companyId` da sessão; conferir só o papel deixava quem foi
  // transferido de empresa na gestão enxergando o caixa da empresa ANTIGA até
  // o token vencer. Empresa diferente derruba a sessão em vez de trocá-la em
  // silêncio: o novo login emite o token certo, e perfil e trilha passam a
  // valer para a empresa nova sem mistura.
  if (acesso.companyId !== sessao.companyId) return null;

  return { ...sessao, role: acesso.role };
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const sessao = await verifySession(token);
  if (!sessao) return null;

  return sessaoVigente(sessao, await conferirAcesso(sessao.userId));
}

// REQUISIÇÃO DISPARADA POR OUTRO SITE — para as rotas que mudam estado sem
// depender da sessão (o logout). As rotas protegidas por sessão já estão
// cobertas pelo cookie `SameSite=Lax`, que não viaja em POST vindo de outro
// site; o logout não precisa de sessão para agir, então qualquer página da
// internet conseguia derrubar a sessão de quem a visitasse com um formulário
// invisível.
//
// Recusa só o que o navegador AFIRMA ser de outro site (`Sec-Fetch-Site`).
// Comparar Origin com Host seria mais amplo, mas quebraria o próprio logout
// atrás de um proxy que reescreva o Host — e um botão de sair que não sai é
// pior que o ataque que ele evitaria. Sem o cabeçalho (curl, navegador antigo)
// deixa passar: quem não é navegador não tem cookie de vítima para usar.
export function requisicaoDeOutroSite(cabecalhos: Headers): boolean {
  return cabecalhos.get("sec-fetch-site") === "cross-site";
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
