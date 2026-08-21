import { prisma } from "@/lib/prisma";

// FREIO DE FORÇA BRUTA NO LOGIN.
//
// O login aceitava tentativas ilimitadas. O bcrypt encarece cada uma, mas
// encarecer não é impedir: com uma lista de senhas comuns e paciência, chega-se
// lá — e o que está do outro lado é o caixa, os títulos e os fornecedores de
// duas empresas.
//
// O freio conta as falhas RECENTES em duas dimensões, porque elas cobrem
// ataques diferentes:
//
//   - por e-mail, contra quem martela uma conta específica (tipicamente a de
//     alguém que se sabe ter acesso ao financeiro);
//   - por origem, contra quem varre muitas contas de um mesmo lugar — o
//     ataque que o freio por e-mail sozinho não vê, porque nenhuma conta
//     isolada chega perto do limite.
//
// Os dois limites são folgados o bastante para não incomodar quem esqueceu a
// senha, e apertados o bastante para que um ataque automatizado pare antes de
// valer a pena.

const JANELA_MS = 15 * 60 * 1000;

// Oito falhas seguidas na MESMA conta. Quem digitou errado tenta três, quatro
// vezes; passar disso já não é distração.
const LIMITE_POR_EMAIL = 8;

// Vinte e cinco falhas da mesma origem. O teto é mais alto de propósito:
// escritório inteiro atrás de um IP compartilhado, na manhã seguinte à troca
// de senha, produz um punhado de erros legítimos ao mesmo tempo.
const LIMITE_POR_ORIGEM = 25;

export type MotivoTentativa =
  | "ok"
  | "senha"
  | "desconhecido"
  | "inativo"
  | "sem_permissao"
  | "bloqueado"
  // Banco de usuários fora do ar. Distinto de "senha": um é tentativa de
  // acesso, o outro é falha de infraestrutura, e contá-los juntos faria uma
  // queda de banco parecer um ataque em curso na trilha.
  | "indisponivel";

export type Veredicto = { bloqueado: false } | { bloqueado: true; segundosParaLiberar: number };

function desde(): Date {
  return new Date(Date.now() - JANELA_MS);
}

// Conta as falhas do e-mail DEPOIS do último acerto.
//
// Sem esse corte, quem errou seis vezes, acertou e voltou meia hora depois
// continuaria carregando as seis — e seria bloqueado por um erro já resolvido.
// O acerto é a prova de que quem está ali sabe a senha; ele zera o contador.
async function falhasDoEmail(email: string): Promise<number> {
  const recentes = await prisma.tentativaLogin.findMany({
    where: { email, criadoEm: { gte: desde() } },
    orderBy: { criadoEm: "desc" },
    // Teto de leitura: passado o limite, o número exato não muda a decisão.
    take: LIMITE_POR_EMAIL + 1,
    select: { sucesso: true },
  });

  let falhas = 0;
  for (const t of recentes) {
    if (t.sucesso) break;
    falhas += 1;
  }
  return falhas;
}

// Na origem o acerto NÃO zera o contador. Um atacante que varre contas acerta
// uma cedo ou tarde, e deixar esse acerto limpar o histórico dele seria
// entregar a chave do freio a quem o freio existe para conter.
async function falhasDaOrigem(ip: string): Promise<number> {
  return prisma.tentativaLogin.count({
    where: { ip, sucesso: false, criadoEm: { gte: desde() } },
  });
}

export async function conferirFreio(email: string, ip: string | null): Promise<Veredicto> {
  try {
    const [porEmail, porOrigem] = await Promise.all([
      falhasDoEmail(email),
      ip ? falhasDaOrigem(ip) : Promise.resolve(0),
    ]);

    if (porEmail >= LIMITE_POR_EMAIL || porOrigem >= LIMITE_POR_ORIGEM) {
      return { bloqueado: true, segundosParaLiberar: Math.ceil(JANELA_MS / 1000) };
    }
    return { bloqueado: false };
  } catch {
    // Freio que não consegue contar não pode trancar o sistema.
    //
    // A escolha é entre deixar passar tentativas enquanto o banco está ruim, ou
    // impedir TODO MUNDO de entrar por causa de uma consulta que falhou. A
    // segunda seria uma negação de serviço construída por mim, acionável por
    // qualquer instabilidade — e sem ninguém conseguir entrar para consertar.
    // A senha continua sendo exigida normalmente; o que se perde é o teto de
    // tentativas, por alguns minutos.
    return { bloqueado: false };
  }
}

export async function registrarTentativa(params: {
  email: string;
  ip: string | null;
  sucesso: boolean;
  motivo: MotivoTentativa;
  userAgent: string | null;
}): Promise<void> {
  try {
    await prisma.tentativaLogin.create({
      data: {
        email: params.email,
        ip: params.ip,
        sucesso: params.sucesso,
        motivo: params.motivo,
        userAgent: params.userAgent?.slice(0, 300) ?? null,
      },
    });
  } catch {
    // Falha ao registrar não pode derrubar o login de quem tem a senha certa.
    // Perde-se uma linha de trilha; não se perde o acesso de ninguém.
  }
}

// Limpeza da trilha. Chamada pelo ciclo diário.
//
// Noventa dias cobrem com folga a pergunta que essa tabela existe para
// responder ("andaram tentando entrar?") sem virar depósito de endereço IP
// indefinidamente — dado pessoal guardado além da necessidade é passivo, não
// patrimônio.
export async function limparTentativasAntigas(): Promise<number> {
  const corte = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const { count } = await prisma.tentativaLogin.deleteMany({ where: { criadoEm: { lt: corte } } });
  return count;
}
