import { classificar, type Aderencia } from "./aderencia";

// Cliente da API pública de consulta do PNCP (sem chave). Só leitura.
// Documentação: https://pncp.gov.br/api/consulta/swagger-ui/index.html
const BASE = "https://pncp.gov.br/api/consulta/v1";
const TAMANHO_PAGINA = 50;
const TIMEOUT_MS = 20_000;
const PAUSA_MS = 700;

// Modalidades que a Azul disputa. Dispensa (8) fica de fora: no PNCP de SP
// são ~700 por dia, quase tudo compra pequena, e serviço de transporte de
// valor relevante não cabe em dispensa.
export const MODALIDADES: Record<number, string> = {
  4: "Concorrência eletrônica",
  5: "Concorrência presencial",
  6: "Pregão eletrônico",
  7: "Pregão presencial",
  12: "Credenciamento",
};

// UFs do radar. Padrão SP; outras entram pela variável RADAR_PNCP_UFS
// ("SP,MG,PR"), sem mexer em código.
export function ufsDoRadar(): string[] {
  const lista = (process.env.RADAR_PNCP_UFS ?? "SP")
    .split(",")
    .map((u) => u.trim().toUpperCase())
    .filter((u) => /^[A-Z]{2}$/.test(u));
  return lista.length ? lista : ["SP"];
}

type ContratacaoRaw = {
  numeroControlePNCP?: string;
  orgaoEntidade?: { cnpj?: string; razaoSocial?: string };
  unidadeOrgao?: { ufSigla?: string; municipioNome?: string; nomeUnidade?: string };
  anoCompra?: number;
  sequencialCompra?: number;
  numeroCompra?: string;
  processo?: string;
  objetoCompra?: string;
  valorTotalEstimado?: number | null;
  srp?: boolean;
  dataPublicacaoPncp?: string;
  dataAberturaProposta?: string | null;
  dataEncerramentoProposta?: string | null;
  linkSistemaOrigem?: string | null;
  modalidadeNome?: string;
};

export type LicitacaoDoRadar = {
  numeroControle: string;
  orgaoCnpj: string;
  orgaoNome: string;
  unidadeNome: string | null;
  uf: string | null;
  municipio: string | null;
  modalidade: string;
  numeroCompra: string | null;
  processo: string | null;
  objeto: string;
  valorEstimadoCents: bigint | null;
  srp: boolean;
  publicadaEm: Date;
  aberturaPropostaEm: Date | null;
  encerramentoPropostaEm: Date | null;
  urlPncp: string;
  urlOrigem: string | null;
  aderencia: Aderencia;
  termos: string[];
};

// O PNCP escreve as datas sem fuso, no horário de Brasília.
export function dataDeBrasilia(texto: string | null | undefined): Date | null {
  if (!texto) return null;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(:\d{2})?)/.exec(texto);
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2].length === 5 ? `${m[2]}:00` : m[2]}-03:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Normaliza e filtra: devolve null para o que não interessa ao radar.
export function paraRadar(r: ContratacaoRaw, modalidadePadrao: string): LicitacaoDoRadar | null {
  const objeto = r.objetoCompra?.trim();
  const cnpj = r.orgaoEntidade?.cnpj?.replace(/\D/g, "");
  const publicadaEm = dataDeBrasilia(r.dataPublicacaoPncp);
  if (!objeto || !cnpj || !r.numeroControlePNCP || !publicadaEm) return null;
  const c = classificar(objeto);
  if (!c) return null;
  const valor = typeof r.valorTotalEstimado === "number" && r.valorTotalEstimado > 0 ? BigInt(Math.round(r.valorTotalEstimado * 100)) : null;
  return {
    numeroControle: r.numeroControlePNCP,
    orgaoCnpj: cnpj,
    orgaoNome: r.orgaoEntidade?.razaoSocial?.trim() || cnpj,
    unidadeNome: r.unidadeOrgao?.nomeUnidade?.trim() || null,
    uf: r.unidadeOrgao?.ufSigla ?? null,
    municipio: r.unidadeOrgao?.municipioNome ?? null,
    modalidade: r.modalidadeNome?.trim() || modalidadePadrao,
    numeroCompra: r.numeroCompra?.trim() || null,
    processo: r.processo?.trim() || null,
    objeto: objeto.slice(0, 4000),
    valorEstimadoCents: valor,
    srp: r.srp === true,
    publicadaEm,
    aberturaPropostaEm: dataDeBrasilia(r.dataAberturaProposta),
    encerramentoPropostaEm: dataDeBrasilia(r.dataEncerramentoProposta),
    urlPncp:
      r.anoCompra && r.sequencialCompra
        ? `https://pncp.gov.br/app/editais/${cnpj}/${r.anoCompra}/${r.sequencialCompra}`
        : "https://pncp.gov.br/app/editais",
    urlOrigem: r.linkSistemaOrigem?.startsWith("http") ? r.linkSistemaOrigem : null,
    aderencia: c.aderencia,
    termos: c.termos,
  };
}

const aaaammdd = (dia: string) => dia.replaceAll("-", "");

// Uma página das publicações de um dia (AAAA-MM-DD). 204 = nada publicado.
export async function buscarPublicacoes(
  dia: string,
  uf: string,
  modalidade: number,
  pagina: number
): Promise<{ registros: ContratacaoRaw[]; totalPaginas: number }> {
  const url = new URL(`${BASE}/contratacoes/publicacao`);
  url.searchParams.set("dataInicial", aaaammdd(dia));
  url.searchParams.set("dataFinal", aaaammdd(dia));
  url.searchParams.set("codigoModalidadeContratacao", String(modalidade));
  url.searchParams.set("uf", uf);
  url.searchParams.set("pagina", String(pagina));
  url.searchParams.set("tamanhoPagina", String(TAMANHO_PAGINA));
  for (let tentativa = 0; ; tentativa++) {
    // O PNCP limita a frequência (429 visto em 24/10/2026 com chamadas
    // seguidas): um intervalo fixo entre páginas evita a maior parte, e o
    // 429 que vier espera o Retry-After.
    await new Promise((r) => setTimeout(r, PAUSA_MS));
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 204) return { registros: [], totalPaginas: 0 };
    if ((res.status === 429 || res.status >= 500) && tentativa < 3) {
      const pedido = Number(res.headers.get("retry-after"));
      await new Promise((r) => setTimeout(r, Number.isFinite(pedido) && pedido > 0 ? Math.min(pedido, 30) * 1000 : 3000 * 2 ** tentativa));
      continue;
    }
    if (!res.ok) throw new Error(`PNCP respondeu ${res.status} (${uf}, modalidade ${modalidade}, ${dia}, página ${pagina})`);
    const corpo = (await res.json()) as { data?: ContratacaoRaw[]; totalPaginas?: number };
    return { registros: corpo.data ?? [], totalPaginas: corpo.totalPaginas ?? 1 };
  }
}
