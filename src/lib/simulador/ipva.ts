import type { FonteEnergia, TipoHibrido } from "./tipos";

// IPVA EM SÃO PAULO, ANO A ANO DO CONTRATO (pesquisa out/2026).
//
// - Alíquota de 4% para automóvel, combustão ou 100% elétrico — SP não isenta
//   o elétrico. Veículo de LOCADORA (frota de empresa de locação registrada)
//   paga 1% (Lei 13.296/2008, art. 9º); ônibus e micro de passageiros, 2%
//   (art. 9º, III) — a lei dá 2% a "ônibus e micro-ônibus".
// - Híbrido com motor a etanol (flex) de até R$ 261.154,45 (2026): isento em
//   2026 e escalonado depois — 1% em 2027, 2% em 2028, 3% em 2029, 4% a partir
//   de 2030 (PL 1510/2023). Locadora: no máximo 1%.
// - Elétrico na cidade de São Paulo: a Prefeitura devolve a parte municipal
//   (50% do IPVA) até 103 Ufesp por ano (R$ 3.642,08 em 2024), até 2030 (Lei
//   15.997/2014, prorrogação do PL 414/2024 — sanção a confirmar).
//
// O valor venal cai a cada ano pela depreciação do veículo. É estimativa: o
// enquadramento (locadora, município de registro) é da contabilidade.

export const ALIQUOTA_IPVA_SP = 0.04;
export const ALIQUOTA_IPVA_SP_LOCADORA = 0.01;
export const ALIQUOTA_IPVA_SP_ONIBUS = 0.02;
export const TETO_HIBRIDO_FLEX_ISENTO = 261_154.45;
export const RAMPA_HIBRIDO_FLEX: Record<number, number> = { 2026: 0, 2027: 0.01, 2028: 0.02, 2029: 0.03 };
export const TETO_DEVOLUCAO_ELETRICO_SP = 3_642.08;
export const ULTIMO_ANO_DEVOLUCAO_SP = 2030;

export type EntradaIpva = {
  valor: number;
  energia: FonteEnergia;
  tipoHibrido?: TipoHibrido | null;
  // O híbrido roda/aceita etanol (flex) — condição da isenção.
  hibridoFlex?: boolean;
  onibusOuMicro?: boolean;
  anoInicio: number;
  vigenciaMeses: number;
  depreciacaoAa: number;
  locadora?: boolean;
  // Registrado na cidade de São Paulo (devolução municipal do elétrico).
  capital?: boolean;
};

export type IpvaAno = { ano: number; valorVenal: number; aliquota: number; ipva: number; devolucao: number; liquido: number };

export function ipvaSP(e: EntradaIpva): { anos: IpvaAno[]; mediaAnual: number } {
  const anos = Math.max(1, Math.ceil(e.vigenciaMeses / 12));
  const lista: IpvaAno[] = [];
  for (let k = 0; k < anos; k++) {
    const ano = e.anoInicio + k;
    const valorVenal = Math.max(e.valor * 0.3, e.valor * (1 - e.depreciacaoAa * k));
    let aliquota = e.onibusOuMicro ? ALIQUOTA_IPVA_SP_ONIBUS : ALIQUOTA_IPVA_SP;
    const hibridoIsento = e.energia === "HIBRIDO" && e.hibridoFlex && e.tipoHibrido !== "MHEV" && e.valor <= TETO_HIBRIDO_FLEX_ISENTO;
    if (hibridoIsento) aliquota = Math.min(aliquota, RAMPA_HIBRIDO_FLEX[ano] ?? (ano < 2026 ? 0 : aliquota));
    if (e.locadora) aliquota = Math.min(aliquota, ALIQUOTA_IPVA_SP_LOCADORA);
    const ipva = valorVenal * aliquota;
    const devolucao = e.energia === "ELETRICO" && e.capital && ano <= ULTIMO_ANO_DEVOLUCAO_SP ? Math.min(ipva / 2, TETO_DEVOLUCAO_ELETRICO_SP) : 0;
    lista.push({ ano, valorVenal, aliquota, ipva, devolucao, liquido: ipva - devolucao });
  }
  return { anos: lista, mediaAnual: lista.reduce((a, x) => a + x.liquido, 0) / lista.length };
}
