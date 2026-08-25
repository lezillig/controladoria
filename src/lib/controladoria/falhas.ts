import { prisma } from "@/lib/prisma";
import { versaoPublicada } from "./versao";

// REGISTRO DE FALHA DE SERVIDOR.
//
// Nasceu de três rodadas seguidas do mesmo diálogo: a tela mostra "erro
// 3140730275", eu peço o log da hospedagem, o log chega como CSV, e só então
// dá para consertar. O identificador sozinho não é diagnóstico — é o número
// de um diagnóstico que mora em outro lugar.
//
// Aqui a mensagem passa a morar ao lado do identificador, dentro do próprio
// sistema. Quem vê o erro consegue dizer o que aconteceu, e não só que
// aconteceu.
//
// DUAS REGRAS QUE NÃO PODEM SER RELAXADAS:
//
// 1. Gravar a falha NUNCA pode falhar a requisição. Se o banco é justamente o
//    que está quebrado, insistir aqui transforma um erro de tela em erro de
//    erro — e o segundo apaga o rastro do primeiro. Toda falha de gravação é
//    engolida, de propósito.
// 2. Nada de segredo entra. Exceção de servidor carrega string de conexão,
//    chave de API e trecho de dado; este registro é lido por gente que tem
//    permissão de ver o estado do módulo, não de ver a credencial do banco.

// Padrões de segredo, removidos antes de gravar.
//
// A lista é deliberadamente grosseira: prefere apagar demais a deixar passar.
// Um `postgresql://...` cortado ainda diz "erro de conexão", que é a
// informação de que se precisa; um `postgresql://` inteiro na tela é uma
// credencial vazada por causa de um relatório.
const SEGREDOS: readonly [RegExp, string][] = [
  // Strings de conexão inteiras — o alvo principal.
  [/\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/\S+/gi, "$1://[REDIGIDO]"],
  // Credencial embutida em URL de qualquer esquema.
  [/\b(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDIGIDO]@"],
  // Pares chave/valor com nome sensível — em querystring, em JSON ou em texto
  // corrido.
  //
  // As aspas opcionais em volta do nome e do valor não são detalhe: sem elas,
  // `{"api_key": "sk-..."}` escapava inteiro, porque a aspa de fechamento do
  // nome não fazia parte do separador. A chave vazava exatamente na forma em
  // que ela mais costuma aparecer numa exceção — dentro do JSON da resposta.
  //
  // `Bearer` entra como prefixo opcional do VALOR, e não como regra à parte,
  // pela mesma razão: com a regra separada, `Authorization: Bearer eyJ...`
  // casava com `authorization` e apagava a palavra "Bearer", deixando o token
  // intacto logo depois. O nome do cabeçalho consumia a redação destinada ao
  // segredo.
  [
    /\b(app_key|app_secret|api[_-]?key|secret|token|password|senha|authorization)\b(["']?\s*[=:]\s*)(?:Bearer\s+)?("[^"]*"|'[^']*'|\S+)/gi,
    "$1$2[REDIGIDO]",
  ],
  // Bearer sem o nome do cabeçalho ao lado.
  [/\bBearer\s+\S+/gi, "Bearer [REDIGIDO]"],
];

export function redigir(texto: string): string {
  let saida = texto;
  for (const [padrao, troca] of SEGREDOS) saida = saida.replace(padrao, troca);
  return saida;
}

// Limites de tamanho. Uma pilha inteira de Next em produção passa de 8 KB, e
// gravar isso a cada falha enche a tabela sem acrescentar nada: o que localiza
// o defeito são as primeiras linhas.
const MAX_MENSAGEM = 1_000;
const MAX_PILHA = 2_000;
const LINHAS_DE_PILHA = 12;

export async function registrarFalha(params: {
  erro: unknown;
  digest?: string | null;
  origem?: string | null;
  rota?: string | null;
  metodo?: string | null;
}): Promise<void> {
  try {
    const erro = params.erro;
    const mensagem =
      erro instanceof Error
        ? `${erro.name}: ${erro.message}`
        : typeof erro === "string"
          ? erro
          : (() => {
              try {
                return JSON.stringify(erro);
              } catch {
                return String(erro);
              }
            })();

    const pilha =
      erro instanceof Error && erro.stack
        ? erro.stack.split("\n").slice(1, 1 + LINHAS_DE_PILHA).join("\n")
        : null;

    await prisma.falhaDeServidor.create({
      data: {
        digest: params.digest ?? null,
        origem: params.origem ?? null,
        rota: params.rota ?? null,
        metodo: params.metodo ?? null,
        mensagem: redigir(mensagem).slice(0, MAX_MENSAGEM),
        pilha: pilha ? redigir(pilha).slice(0, MAX_PILHA) : null,
        commitDoBuild: versaoPublicada().commit,
      },
    });
  } catch {
    // Silêncio proposital — ver regra 1 no cabeçalho. O erro original já foi
    // para o log da hospedagem pelo caminho normal do Next; perder a cópia é
    // aceitável, derrubar a requisição por causa da cópia não é.
  }
}

export type FalhaRegistrada = {
  id: string;
  digest: string | null;
  origem: string | null;
  rota: string | null;
  mensagem: string;
  pilha: string | null;
  commitDoBuild: string | null;
  criadoEm: Date;
};

// Busca pelo identificador que a tela de erro mostra.
//
// `findFirst` e não `findUnique`: o digest do Next é um hash da mensagem com a
// pilha, então a mesma falha repetida gera o mesmo identificador em linhas
// diferentes. A mais recente é a que interessa — é a que a pessoa acabou de
// ver.
export async function falhaPorDigest(digest: string): Promise<FalhaRegistrada | null> {
  try {
    return await prisma.falhaDeServidor.findFirst({
      where: { digest },
      orderBy: { criadoEm: "desc" },
      select: {
        id: true,
        digest: true,
        origem: true,
        rota: true,
        mensagem: true,
        pilha: true,
        commitDoBuild: true,
        criadoEm: true,
      },
    });
  } catch {
    return null;
  }
}

export async function ultimasFalhas(limite = 10): Promise<FalhaRegistrada[]> {
  try {
    return await prisma.falhaDeServidor.findMany({
      orderBy: { criadoEm: "desc" },
      take: limite,
      select: {
        id: true,
        digest: true,
        origem: true,
        rota: true,
        mensagem: true,
        pilha: true,
        commitDoBuild: true,
        criadoEm: true,
      },
    });
  } catch {
    // A tela que mostra falhas não pode ser a próxima a falhar.
    return [];
  }
}

// Poda. Falha de servidor é dado de diagnóstico, não histórico contábil: passa
// de algumas semanas e ninguém mais vai consertar aquilo. Sem poda, a tabela
// cresce sem teto justamente durante um incidente, que é quando o banco menos
// pode receber carga extra.
const DIAS_DE_RETENCAO = 30;

export async function limparFalhasAntigas(): Promise<void> {
  try {
    const corte = new Date(Date.now() - DIAS_DE_RETENCAO * 24 * 60 * 60 * 1000);
    await prisma.falhaDeServidor.deleteMany({ where: { criadoEm: { lt: corte } } });
  } catch {
    // Poda é higiene, não requisito.
  }
}

// ESTA FALHA AINDA PODE ESTAR ACONTECENDO?
//
// Responde a pergunta que o painel provocava e não respondia. Duas leituras,
// nesta ordem:
//
//   1. O COMMIT. Se a falha foi gravada por um build diferente do que está no
//      ar, o código que a causou não é mais o código que roda. É a resposta
//      exata, e vale para toda linha gravada a partir de agora.
//   2. A DATA, como reserva, para as linhas antigas que não têm commit: falha
//      anterior à publicação atual não pode ter vindo dela.
//
// Sem nenhuma das duas informações, devolve `null` — "não dá para saber" é uma
// resposta melhor que um palpite num painel de diagnóstico.
export function falhaDeVersaoAnterior(falha: FalhaRegistrada): boolean | null {
  const versao = versaoPublicada();
  if (!versao.publicado) return null;

  if (falha.commitDoBuild) return falha.commitDoBuild !== versao.commit;
  if (versao.buildEm) return falha.criadoEm < versao.buildEm;
  return null;
}
