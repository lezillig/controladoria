// CLIENTE PÚBLICO DE CNPJ — a base da Receita Federal pela BrasilAPI.
//
// GET https://brasilapi.com.br/api/cnpj/v1/{cnpj}, sem autenticação. A
// BrasilAPI republica o cadastro público de CNPJ da Receita (situação,
// abertura, CNAE, porte, capital social, quadro societário com o CPF já
// mascarado) — é o que permite conferir um fornecedor sem cadastrar chave em
// serviço nenhum.
//
// Três cuidados que valem para qualquer consulta daqui:
//
//   RITMO. É um serviço público e gratuito: 400 ms entre chamadas, e 429 ou
//   5xx encerram a rodada em vez de insistir. Quem chama (enriquecer.ts)
//   volta no ciclo seguinte; o CNPJ não foge.
//
//   TEMPO. 10 s por chamada. A consulta roda dentro do orçamento de uma
//   função serverless, e uma resposta que não chega não pode segurar a
//   auditoria.
//
//   SILÊNCIO. O JSON bruto NUNCA vai para o log: ele traz o quadro
//   societário e o endereço de terceiros, e log de hospedagem é o lugar
//   mais fácil de vazar dado que não é nosso. O que se registra é o campo
//   já extraído e a mensagem de erro curta.

const BASE_URL = "https://brasilapi.com.br/api/cnpj/v1";
const TIMEOUT_MS = 10_000;
const INTERVALO_MS = 400;

export type SocioReceita = { nome: string; qualificacao: string | null };

export type DadosReceita = {
  cnpj: string;
  razaoSocial: string | null;
  situacao: string | null;
  situacaoEm: Date | null;
  inicioAtividade: Date | null;
  cnaeCodigo: string | null;
  cnaeDescricao: string | null;
  porte: string | null;
  capitalSocialCents: number | null;
  naturezaJuridica: string | null;
  municipio: string | null;
  uf: string | null;
  mei: boolean | null;
  simples: boolean | null;
  socios: SocioReceita[];
};

// O resultado distingue "não existe" de "não deu para saber agora": o
// primeiro é um fato sobre o CNPJ e fica gravado por 30 dias; o segundo é
// um fato sobre a rede e é retentado amanhã.
export type ResultadoConsultaCnpj =
  | { status: "ok"; dados: DadosReceita }
  | { status: "nao-encontrado" }
  | { status: "tentar-depois"; motivo: string }
  | { status: "erro"; motivo: string };

// Teto do Int4 do Postgres, em centavos. Ver o comentário de
// ParceiroReceita.capitalSocialCents no schema.
const TETO_INT4 = 2_147_483_647;

// Quando a próxima chamada pode sair. Fica no módulo, e não na função que
// enriquece, porque qualquer outro chamador (um botão, um teste manual)
// precisa respeitar o mesmo ritmo — o limite é da API, não do chamador.
let proximaChamadaEm = 0;

async function respeitarRitmo(): Promise<void> {
  const espera = proximaChamadaEm - Date.now();
  if (espera > 0) await new Promise((r) => setTimeout(r, espera));
  proximaChamadaEm = Date.now() + INTERVALO_MS;
}

// Só os 14 dígitos: a mesma normalização do espelho. Devolve null para
// qualquer coisa que não seja um CNPJ inteiro — a API responderia 400 e o
// erro seria gravado como se fosse da Receita.
export function normalizarCnpj(valor: string | null | undefined): string | null {
  const digitos = (valor ?? "").replace(/\D/g, "");
  return digitos.length === 14 ? digitos : null;
}

// "4929901" → "4929-9/01", a grafia que a Receita usa e que a pessoa
// reconhece no cartão CNPJ.
export function fmtCnae(codigo: string | null | undefined): string {
  const d = (codigo ?? "").replace(/\D/g, "").padStart(7, "0");
  if (d.length !== 7 || !/\d/.test(codigo ?? "")) return codigo ?? "";
  return `${d.slice(0, 4)}-${d[4]}/${d.slice(5)}`;
}

// A BrasilAPI escreve datas como "2013-10-03". À meia-noite local, como o
// resto do sistema grava datas (ver CLAUDE.md, convenções).
function dataLocal(valor: unknown): Date | null {
  if (typeof valor !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function texto(valor: unknown): string | null {
  if (typeof valor === "number") return String(valor);
  if (typeof valor !== "string") return null;
  const t = valor.trim();
  return t.length > 0 ? t : null;
}

function booleano(valor: unknown): boolean | null {
  return typeof valor === "boolean" ? valor : null;
}

// Extrai só o que o sistema usa. É aqui que o JSON inteiro vira um punhado
// de campos — e é o único lugar do sistema que toca no JSON.
export function extrairDados(cnpj: string, corpo: Record<string, unknown>): DadosReceita {
  // O CNAE vem como número (4929901) e perde o zero à esquerda quando o
  // código começa com 0 (0111301 → 111301). Sete dígitos, sempre.
  const cnaeBruto = corpo.cnae_fiscal;
  const cnaeCodigo =
    typeof cnaeBruto === "number" || typeof cnaeBruto === "string"
      ? String(cnaeBruto).replace(/\D/g, "").padStart(7, "0")
      : null;

  const capital = typeof corpo.capital_social === "number" ? corpo.capital_social : null;
  const capitalSocialCents = capital === null ? null : Math.min(TETO_INT4, Math.round(capital * 100));

  const qsa = Array.isArray(corpo.qsa) ? corpo.qsa : [];
  const socios: SocioReceita[] = [];
  for (const s of qsa) {
    if (!s || typeof s !== "object") continue;
    const socio = s as Record<string, unknown>;
    const nome = texto(socio.nome_socio);
    if (!nome) continue;
    socios.push({ nome, qualificacao: texto(socio.qualificacao_socio) });
  }

  return {
    cnpj,
    razaoSocial: texto(corpo.razao_social),
    situacao: texto(corpo.descricao_situacao_cadastral)?.toUpperCase() ?? null,
    situacaoEm: dataLocal(corpo.data_situacao_cadastral),
    inicioAtividade: dataLocal(corpo.data_inicio_atividade),
    cnaeCodigo: cnaeCodigo && cnaeCodigo.length === 7 ? cnaeCodigo : null,
    cnaeDescricao: texto(corpo.cnae_fiscal_descricao),
    porte: texto(corpo.porte)?.toUpperCase() ?? null,
    capitalSocialCents,
    naturezaJuridica: texto(corpo.natureza_juridica),
    municipio: texto(corpo.municipio),
    uf: texto(corpo.uf)?.toUpperCase() ?? null,
    mei: booleano(corpo.opcao_pelo_mei),
    simples: booleano(corpo.opcao_pelo_simples),
    socios,
  };
}

export async function consultarCnpj(valor: string): Promise<ResultadoConsultaCnpj> {
  const cnpj = normalizarCnpj(valor);
  if (!cnpj) return { status: "erro", motivo: "CNPJ inválido: precisa ter 14 dígitos." };

  await respeitarRitmo();

  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/${cnpj}`, {
      headers: { Accept: "application/json" },
      signal: controle.signal,
      // Sem cache do Next: a situação cadastral de hoje é o dado; a de
      // ontem, guardada em cache de rota, seria justamente o que a regra não
      // pode ler como atual.
      cache: "no-store",
    });
  } catch (e) {
    const abortou = e instanceof Error && e.name === "AbortError";
    return {
      status: "tentar-depois",
      motivo: abortou ? `Sem resposta em ${TIMEOUT_MS / 1000} s.` : `Falha de rede: ${e instanceof Error ? e.message.slice(0, 120) : "erro desconhecido"}`,
    };
  } finally {
    clearTimeout(relogio);
  }

  if (res.status === 404) return { status: "nao-encontrado" };
  if (res.status === 429 || res.status >= 500) {
    return { status: "tentar-depois", motivo: `HTTP ${res.status} ${res.statusText}`.trim() };
  }
  if (!res.ok) return { status: "erro", motivo: `HTTP ${res.status} ${res.statusText}`.trim() };

  let corpo: unknown;
  try {
    corpo = await res.json();
  } catch {
    return { status: "tentar-depois", motivo: "Resposta não é JSON." };
  }
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) {
    return { status: "erro", motivo: "Resposta em formato inesperado." };
  }

  return { status: "ok", dados: extrairDados(cnpj, corpo as Record<string, unknown>) };
}
