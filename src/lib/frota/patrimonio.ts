import { lerAdaptacoes, lerPatrimonioDaFrota, type FinanciamentoVeiculoGestao, type PatrimonioVeiculoGestao } from "@/lib/gestao/leitura";
import { rateioDoContrato } from "./financiamentos";
import { contratosComSituacao } from "./contratosDaGestao";

// O PATRIMÔNIO DA FROTA PARA A RENTABILIDADE (custo de propriedade): a compra
// e a venda são as da ficha do veículo na gestão, e o investimento soma as
// adaptações; a parcela e o saldo de cada contrato vão para os veículos pela
// parte de cada um, com o saldo andando pelos pagamentos na Omie. Junto, os
// JUROS DO MÊS estimados (saldo × taxa do contrato; consórcio não tem juros).
// Se os contratos não puderem ser conferidos, vale a posição informada na
// gestão, sem juros.

export type PatrimonioDaFrota = {
  veiculos: PatrimonioVeiculoGestao[];
  financiamentos: FinanciamentoVeiculoGestao[];
  juros: Map<string, number>;
  saldoPelaOmie: boolean;
};

export async function patrimonioDaFrota(companyId: string, periodo: { inicio: Date; fim: Date }): Promise<PatrimonioDaFrota> {
  const [lido, adaptacoes, conferidos] = await Promise.all([lerPatrimonioDaFrota(companyId), lerAdaptacoes(companyId), contratosComSituacao(companyId, periodo.fim)]);
  const veiculos = lido.veiculos.map((v) => ({ ...v, valorCompraCents: v.valorCompraCents !== null ? Number(v.valorCompraCents) + (adaptacoes.get(v.id) ?? 0) : null }));
  if (!conferidos.gestaoDisponivel) return { veiculos, financiamentos: lido.financiamentos, juros: new Map(), saldoPelaOmie: false };
  const financiamentos: FinanciamentoVeiculoGestao[] = [];
  const juros = new Map<string, number>();
  for (const c of conferidos.contratos) {
    const fatias = rateioDoContrato(c.veiculos);
    for (const v of c.veiculos) {
      const f = fatias.get(v.veiculoId) ?? 0;
      const saldo = c.situacao.saldoCents !== null ? Math.round(c.situacao.saldoCents * f) : null;
      financiamentos.push({
        vehicleId: v.veiculoId,
        banco: c.instituicao,
        modalidade: c.produto === "consorcio" ? "CONSORCIO" : "CDC",
        parcelaCents: c.valorParcelaCents !== null ? Math.round(c.valorParcelaCents * f) : null,
        saldoCents: saldo,
        quitado: c.situacao.quitado,
        dataFinal: c.dataFinal,
        posicaoEm: periodo.fim,
      });
      if (!c.situacao.quitado && c.produto !== "consorcio" && c.taxaPct !== null && saldo) juros.set(v.veiculoId, (juros.get(v.veiculoId) ?? 0) + Math.round((saldo * c.taxaPct) / 100));
    }
  }
  return { veiculos, financiamentos, juros, saldoPelaOmie: true };
}
