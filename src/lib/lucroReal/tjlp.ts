import type { Periodo } from "../controladoria/periodos";

// A TJLP DO PERÍODO, para o JCP — a série 256 do Banco Central (SGS): a mesma
// taxa que o BNDES publica, fixada pelo CMN a cada trimestre, em % ao ano. O
// JCP é calculado dia a dia pela TJLP de cada período sobre o patrimônio
// líquido; para os doze meses da tela, a média mensal da série faz a mesma
// conta.

export const URL_TJLP_BNDES = "https://www.bndes.gov.br/wps/portal/site/home/financiamento/guia/custos-financeiros/taxa-juros-longo-prazo-tjlp";
const SERIE = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.256/dados";

export type Tjlp = { mediaAa: number; atualAa: number; meses: number };
type LinhaSerie = { data: string; valor: string };

const dataDaSerie = (s: string) => {
  const [d, m, a] = s.split("/").map(Number);
  return new Date(a, m - 1, d);
};
const ddmmaaaa = (d: Date) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;

// Em fração ao ano. A média é dos meses do período; a atual, a do mês de hoje
// (a série já traz os meses do trimestre corrente).
export function tjlpDaSerie(linhas: LinhaSerie[], periodo: Periodo, hoje: Date): Tjlp | null {
  const pontos = linhas
    .map((l) => ({ data: dataDaSerie(l.data), valor: Number(String(l.valor).replace(",", ".")) / 100 }))
    .filter((p) => Number.isFinite(p.valor) && p.valor > 0 && !Number.isNaN(p.data.getTime()));
  const doPeriodo = pontos.filter((p) => p.data >= periodo.inicio && p.data <= periodo.fim);
  const ateHoje = pontos.filter((p) => p.data <= hoje).sort((a, b) => a.data.getTime() - b.data.getTime());
  if (doPeriodo.length === 0 || ateHoje.length === 0) return null;
  return {
    mediaAa: doPeriodo.reduce((a, p) => a + p.valor, 0) / doPeriodo.length,
    atualAa: ateHoje[ateHoje.length - 1].valor,
    meses: doPeriodo.length,
  };
}

// Nulo quando o Banco Central não responde: a tela cai no campo manual.
export async function lerTjlp(periodo: Periodo, hoje: Date): Promise<Tjlp | null> {
  try {
    const res = await fetch(`${SERIE}?formato=json&dataInicial=${ddmmaaaa(periodo.inicio)}&dataFinal=${ddmmaaaa(hoje)}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const linhas = (await res.json()) as LinhaSerie[];
    return Array.isArray(linhas) ? tjlpDaSerie(linhas, periodo, hoje) : null;
  } catch {
    return null;
  }
}
