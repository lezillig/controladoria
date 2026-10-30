// O CUSTO POR KM de cada veículo no mês: o custo total (operação + depreciação
// + juros + multas assumidas) dividido pelos km rodados — da Ituran, ou dos
// check-ins quando o veículo não tem viagem da Ituran no período. Veículo sem
// km fica sem custo por km (e não com custo infinito); a média da frota é
// custo somado ÷ km somados só dos que têm os dois.

export type LinhaCustoKm = { vehicleId: string; custoCents: number | null; km: number | null; fonteKm: "ituran" | "check-in" | null; custoPorKmCents: number | null };

export function custoPorKm(
  linhas: { vehicleId: string; custoCents: number | null }[],
  km: Map<string, { km: number; fonte: "ituran" | "check-in" }>
): { linhas: LinhaCustoKm[]; frota: { custoCents: number; km: number; custoPorKmCents: number | null; veiculos: number } } {
  const r: LinhaCustoKm[] = linhas.map((l) => {
    const k = km.get(l.vehicleId) ?? null;
    return {
      vehicleId: l.vehicleId,
      custoCents: l.custoCents,
      km: k?.km ?? null,
      fonteKm: k?.fonte ?? null,
      custoPorKmCents: l.custoCents !== null && k && k.km > 0 ? Math.round(l.custoCents / k.km) : null,
    };
  });
  const com = r.filter((l) => l.custoPorKmCents !== null);
  const custo = com.reduce((s, l) => s + (l.custoCents ?? 0), 0);
  const kmTotal = com.reduce((s, l) => s + (l.km ?? 0), 0);
  return { linhas: r, frota: { custoCents: custo, km: kmTotal, custoPorKmCents: kmTotal > 0 ? Math.round(custo / kmTotal) : null, veiculos: com.length } };
}
