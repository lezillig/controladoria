// VEÍCULO PARADO QUE CONTINUA CUSTANDO — `npm run teste:veiculo-parado`.
//
// Puro: fora da frota (inativo ou vendido antes do mês) com custo; ativo sem
// km nem abastecimento com custo; e os silêncios — vendido no próprio mês,
// em manutenção, frota sem rastro (importação da Ituran parada), custo
// abaixo do piso, combustível fora da conta.
export {};
import { veiculoParadoComCusto } from "../src/lib/controladoria/agents/rentabilidade";
import type { ContextoAuditoria } from "../src/lib/controladoria/types";
import type { LinhaCusto, ResultadoRateio } from "../src/lib/controladoria/unitEconomics";

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "  ok  " : "FALHA "} ${nome}${ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         veio     ${JSON.stringify(real)}`}`);
}

const outubro = { inicio: new Date(2026, 9, 1), fim: new Date(2026, 9, 31, 23, 59, 59, 999), rotulo: "outubro/2026" };
const veiculo = (id: string, status: string) => ({ id, plate: `ABC${id.padStart(4, "0")}`, status, currentMileage: 0, model: "Sprinter", type: "van" });
const linha = (id: string, custoCents: number, origens = ["placa-no-documento"]): LinhaCusto => ({ id, nome: id, custoCents, receitaCents: 0, margemCents: -custoCents, margemPercent: null, origens });
const rateio = (linhas: LinhaCusto[]): ResultadoRateio<LinhaCusto> => ({ linhas, naoAlocadoCents: 0, totalCents: 0, coberturaPercent: 100, combustivelDescontadoCents: 0 });

function contexto(p: {
  veiculos: ReturnType<typeof veiculo>[];
  km?: [string, number][];
  vendas?: [string, Date][];
  parcelas?: [string, number][];
  abastecimentos?: { vehicleId: string; dia: number; valorCents: number }[];
}): ContextoAuditoria {
  return {
    veiculos: p.veiculos,
    abastecimentos: (p.abastecimentos ?? []).map((a) => ({ vehicleId: a.vehicleId, dataHora: new Date(2026, 9, a.dia), valorCents: a.valorCents })),
    usosDeVeiculo: [],
    frota: {
      vendaPorVeiculo: new Map(p.vendas ?? []),
      parcelaPorVeiculo: new Map(p.parcelas ?? []),
      kmDoMesFechado: new Map((p.km ?? []).map(([id, km]) => [id, { km, fonte: "ituran" as const }])),
    },
  } as unknown as ContextoAuditoria;
}
const MATERIALIDADE = 10_000_00; // piso = max(R$ 100, R$ 500) = R$ 500
const rodar = (ctx: ContextoAuditoria, linhas: LinhaCusto[]) => veiculoParadoComCusto(ctx, outubro, rateio(linhas), MATERIALIDADE).map((a) => [a.regra, a.entidadeId, a.valorCents, a.severidade]);

// Frota com rastro: 1, 2, 3 rodaram; 4 parado; 5 em manutenção; 6 inativo; 7 vendido em agosto; 8 vendido em outubro.
const frota = ["1", "2", "3"].map((id) => veiculo(id, "ATIVO"));
const base = {
  veiculos: [...frota, veiculo("4", "ATIVO"), veiculo("5", "MANUTENCAO"), veiculo("6", "INATIVO"), veiculo("7", "INATIVO"), veiculo("8", "INATIVO")],
  km: [["1", 3200], ["2", 2900], ["3", 4100]] as [string, number][],
  vendas: [["7", new Date(2026, 7, 15)], ["8", new Date(2026, 9, 10)]] as [string, Date][],
  parcelas: [["4", 3_500_00], ["7", 2_800_00]] as [string, number][],
};
const custos = [linha("1", 9_000_00), linha("4", 1_200_00), linha("5", 4_000_00), linha("6", 900_00), linha("7", 650_00), linha("8", 2_000_00)];
conferir(
  "parado (ativo sem km), inativo e vendido antes do mês; manutenção e vendido no mês ficam de fora",
  rodar(contexto(base), custos),
  [
    ["RE-VEICULO-OCIOSO", "4", 4_700_00, "BAIXA"],
    ["RE-VEICULO-INATIVO-COM-CUSTO", "6", 900_00, "MEDIA"],
    ["RE-VEICULO-INATIVO-COM-CUSTO", "7", 3_450_00, "MEDIA"],
  ]
);
conferir("sem rastro na frota (Ituran parada): o ocioso se cala, o inativo não", rodar(contexto({ ...base, km: [] }), custos).map((a) => a[0]), ["RE-VEICULO-INATIVO-COM-CUSTO", "RE-VEICULO-INATIVO-COM-CUSTO"]);
conferir("abasteceu no mês: rodou, não é parado", rodar(contexto({ ...base, abastecimentos: [{ vehicleId: "4", dia: 12, valorCents: 300_00 }] }), custos).map((a) => a[1]), ["6", "7"]);
conferir(
  "o combustível do cartão sai do custo do inativo",
  rodar(contexto({ ...base, parcelas: [], abastecimentos: [{ vehicleId: "6", dia: 3, valorCents: 400_00 }] }), [linha("6", 900_00, ["placa-no-documento", "cartao-frota"])]).map((a) => a[2]),
  [500_00]
);
conferir("custo abaixo do piso: calado", rodar(contexto({ ...base, parcelas: [] }), [linha("6", 300_00)]), []);
conferir("só a parcela já basta (financiamento de veículo parado)", rodar(contexto(base), []).map((a) => [a[1], a[2]]), [["4", 3_500_00], ["7", 2_800_00]]);
conferir("sem a leitura da frota (contexto antigo): calado", veiculoParadoComCusto({ veiculos: base.veiculos, abastecimentos: [] } as unknown as ContextoAuditoria, outubro, rateio(custos), MATERIALIDADE), []);
const achado = veiculoParadoComCusto(contexto(base), outubro, rateio(custos), MATERIALIDADE).find((a) => a.entidadeId === "7")!;
conferir("o vendido diz quando foi vendido e o que ainda sai", [achado.titulo.includes("vendido em 15/08/2026"), achado.descricao.includes("parcela")], [true, true]);

if (falhas) {
  console.log(`\n${falhas} falha(s).`);
  process.exit(1);
}
console.log("\nVeículo parado: tudo certo.");
