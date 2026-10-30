import type { FinanciamentoVeiculoGestao, PatrimonioVeiculoGestao } from "@/lib/gestao/leitura";
import type { Periodo } from "./periodos";

// CUSTO DE PROPRIEDADE DO VEÍCULO NO MÊS.
//
// O custo por veículo da Omie é custo de OPERAÇÃO: a compra e a parcela do
// financiamento saem dele de propósito (são investimento e financiamento, não
// custo do mês). Mas um contrato que só cobre a operação não repõe a frota.
// Aqui entra a DEPRECIAÇÃO: (valor de compra − residual) ÷ vida útil, linear,
// com as premissas da base de custos do simulador — as mesmas que o preço da
// proposta usa, para o realizado e o orçado falarem a mesma língua.
//
// A parcela do financiamento aparece AO LADO, como caixa, e não soma à
// depreciação: o veículo seria contado duas vezes (a parcela paga o mesmo bem
// que a depreciação reparte no tempo). Juros, quando a planilha os separar,
// entram como custo financeiro; hoje ela não separa.

export type PremissasDepreciacao = { vidaUtilAnos: number; valorResidualPct: number; fonte: string };

export type CustoDeCapital = {
  vehicleId: string;
  placa: string;
  depreciacaoCents: number | null;
  // Por que não há depreciação: dado que falta ou veículo fora do período.
  motivo: string | null;
  // "cadastro" quando a vida útil (e o residual, se houver) vieram da ficha
  // do veículo; "premissa" quando valeu a regra geral.
  base: "cadastro" | "premissa";
  parcelaCents: number;
  saldoCents: number;
  financiamentos: string[];
};

const fimDaVida = (compra: Date, meses: number) => new Date(compra.getFullYear(), compra.getMonth() + meses, compra.getDate());

export function custoDeCapitalPorVeiculo(
  veiculos: PatrimonioVeiculoGestao[],
  financiamentos: FinanciamentoVeiculoGestao[],
  premissas: PremissasDepreciacao,
  periodo: Periodo
): CustoDeCapital[] {
  const porVeiculo = new Map<string, FinanciamentoVeiculoGestao[]>();
  for (const f of financiamentos) porVeiculo.set(f.vehicleId, [...(porVeiculo.get(f.vehicleId) ?? []), f]);

  return veiculos
    .filter((v) => !(v.dataVenda && v.dataVenda < periodo.inicio))
    .map((v) => {
      let depreciacaoCents: number | null = null;
      let motivo: string | null = null;
      // A ficha do veículo vence a premissa geral: ônibus e van não têm a
      // mesma vida útil, e quem cadastra o veículo sabe a dele.
      const meses = v.vidaUtilMeses && v.vidaUtilMeses > 0 ? v.vidaUtilMeses : premissas.vidaUtilAnos * 12;
      const base: CustoDeCapital["base"] = v.vidaUtilMeses && v.vidaUtilMeses > 0 ? "cadastro" : "premissa";
      if (!v.valorCompraCents || !v.dataCompra) motivo = "sem valor ou data de compra na ficha";
      else if (v.dataCompra > periodo.fim) motivo = "comprado depois do mês";
      else if (fimDaVida(v.dataCompra, meses) < periodo.inicio) motivo = "vida útil encerrada";
      else {
        const residual =
          v.valorResidualCents != null && v.valorResidualCents >= 0 && v.valorResidualCents < v.valorCompraCents
            ? v.valorResidualCents
            : v.valorCompraCents * premissas.valorResidualPct;
        depreciacaoCents = Math.round((v.valorCompraCents - residual) / meses);
      }

      // Parcela só de quem ainda deve no mês: quitado ou com a última parcela
      // antes do mês não pesa no caixa dele.
      const ativos = (porVeiculo.get(v.id) ?? []).filter((f) => !f.quitado && !(f.dataFinal && f.dataFinal < periodo.inicio));
      return {
        vehicleId: v.id,
        placa: v.plate ?? "(sem placa)",
        depreciacaoCents,
        motivo,
        base,
        parcelaCents: ativos.reduce((s, f) => s + (f.parcelaCents ?? 0), 0),
        saldoCents: ativos.reduce((s, f) => s + (f.saldoCents ?? 0), 0),
        // Três cotas do mesmo banco são "3× consórcio Moneo", não três linhas iguais.
        financiamentos: [...ativos.reduce((m, f) => {
          const nome = `${f.modalidade === "CONSORCIO" ? "consórcio" : "financiamento"} ${f.banco}`;
          return m.set(nome, (m.get(nome) ?? 0) + 1);
        }, new Map<string, number>())].map(([nome, n]) => (n > 1 ? `${n}× ${nome}` : nome)),
      };
    })
    .sort((a, b) => (b.depreciacaoCents ?? 0) + b.parcelaCents - ((a.depreciacaoCents ?? 0) + a.parcelaCents));
}

// Premissas da base vigente do simulador; sem elas, o padrão do simulador,
// e a tela diz qual valeu.
export function premissasDaBase(parametros: Map<string, { valor: number | null }>): PremissasDepreciacao {
  const vida = parametros.get("vida_util_anos")?.valor;
  const residual = parametros.get("valor_residual_pct")?.valor;
  const daBase = vida != null && vida > 0 && residual != null && residual >= 0 && residual < 1;
  return daBase
    ? { vidaUtilAnos: vida, valorResidualPct: residual, fonte: "base de custos do simulador" }
    : { vidaUtilAnos: 8, valorResidualPct: 0.2, fonte: "padrão do simulador (a base não tem vida útil e residual cadastrados)" };
}
