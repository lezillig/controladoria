import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { buscarUsuarioPorEmail } from "@/lib/gestao/leitura";
import { canViewControladoria } from "@/lib/permissions";
import { signSession, SESSION_COOKIE } from "@/lib/auth";
import { conferirFreio, registrarTentativa, type MotivoTentativa } from "@/lib/seguranca/freioDeLogin";

// Autenticação contra o cadastro de usuários do sistema de gestão (mesmo
// banco, schema `public`). Ganha-se credencial única e, principalmente,
// desligamento único: quem é desativado lá perde o acesso ao financeiro no
// mesmo ato — e isso vale para a sessão JÁ ABERTA, porque `getSession`
// reconfere o cadastro a cada requisição. Cadastro separado significaria, mais
// cedo ou mais tarde, um ex-funcionário com acesso ao módulo que mostra o
// caixa da empresa.

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Hash descartável, usado só para gastar o mesmo tempo quando o e-mail não
// existe.
//
// Sem isso, e-mail desconhecido respondia na hora e e-mail conhecido esperava
// o bcrypt. A diferença é medível de fora e transforma o login num confirmador
// de endereços: dá para descobrir QUEM tem acesso ao financeiro sem acertar
// nenhuma senha — que é exatamente a lista que um ataque dirigido quer ter
// antes de começar.
const HASH_DE_COMPARACAO = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

function origemDaRequisicao(req: NextRequest): string | null {
  const encaminhado = req.headers.get("x-forwarded-for");
  if (encaminhado) return encaminhado.split(",")[0]?.trim() || null;
  return req.headers.get("x-real-ip");
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }

  // Minúsculas na normalização, aqui e na gravação da trilha: senão
  // "Fulano@x.com" e "fulano@x.com" viram dois contadores e o freio conta pela
  // metade — o atacante ganha o dobro de tentativas trocando a caixa.
  const email = parsed.data.email.trim().toLowerCase();
  const { password } = parsed.data;
  const ip = origemDaRequisicao(req);
  const userAgent = req.headers.get("user-agent");

  const anotar = (sucesso: boolean, motivo: MotivoTentativa) =>
    registrarTentativa({ email, ip, sucesso, motivo, userAgent });

  const freio = await conferirFreio(email, ip);
  if (freio.bloqueado) {
    await anotar(false, "bloqueado");
    return NextResponse.json(
      {
        error:
          "Muitas tentativas seguidas. Por segurança, este acesso está bloqueado por alguns minutos. Se a senha foi esquecida, peça a um administrador para redefini-la.",
      },
      { status: 429, headers: { "Retry-After": String(freio.segundosParaLiberar) } }
    );
  }

  const busca = await buscarUsuarioPorEmail(email);

  // Banco fora do ar não é senha errada, e dizer que é manda a pessoa para o
  // caminho errado: ela troca a senha, pede reset, abre chamado — enquanto o
  // problema é outro e ninguém está olhando para ele. 503 com a causa nomeada.
  //
  // Não vaza nada: a resposta é idêntica para qualquer e-mail, exista ou não,
  // porque nem chegou a consultar.
  if (busca.situacao === "indisponivel") {
    await anotar(false, "indisponivel");
    return NextResponse.json(
      {
        error:
          "O banco de dados não respondeu. Não é a sua senha — tente de novo em alguns minutos. Se persistir, avise quem cuida do sistema: pode ser configuração de conexão.",
      },
      { status: 503 }
    );
  }

  const user = busca.situacao === "encontrado" ? busca.usuario : null;

  // A comparação roda SEMPRE, inclusive sem usuário, para o tempo de resposta
  // não revelar quais e-mails existem.
  const senhaConfere = await bcrypt.compare(password, user?.passwordHash ?? HASH_DE_COMPARACAO);

  if (!user) {
    await anotar(false, "desconhecido");
    return NextResponse.json({ error: "Credenciais inválidas" }, { status: 401 });
  }
  if (!user.active) {
    await anotar(false, "inativo");
    return NextResponse.json({ error: "Credenciais inválidas" }, { status: 401 });
  }
  if (!senhaConfere) {
    await anotar(false, "senha");
    return NextResponse.json({ error: "Credenciais inválidas" }, { status: 401 });
  }

  // Senha correta, mas sem permissão para este sistema: mensagem diferente da
  // de credencial inválida, de propósito. Dizer "credenciais inválidas" a quem
  // digitou a senha certa faz a pessoa tentar de novo, resetar a senha e abrir
  // chamado — quando o problema é permissão, não senha. Não vaza nada: só
  // chega aqui quem já provou saber a senha.
  if (!canViewControladoria(user.role)) {
    await anotar(false, "sem_permissao");
    return NextResponse.json(
      { error: "Seu usuário não tem acesso à Controladoria. Peça a um administrador o perfil adequado." },
      { status: 403 }
    );
  }

  await anotar(true, "ok");

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
