import type { CategoriaVeiculo } from "./tipos";

// AS CONVENÇÕES COLETIVAS de cada tipo de veículo, como PADRÃO da mão de obra
// na base de custos.
//
// Fretamento (van, micro, ônibus): CCT 2026/2028 TRANSFRETUR × SINDIFRETUR
// (São Paulo e região, vigência 01/05/2026 a 30/04/2028) e a Circular
// TRANSFRETUR 013-A/2026, que traz o custo por nível:
//   - Nível A, ônibus acima de 32 lugares: R$ 3.663,66 em mai/26 e
//     R$ 3.733,44 a partir de 01/11/2026;
//   - Nível B, van e micro (empresa com acordo coletivo): 80% do A —
//     R$ 2.930,93 e R$ 2.986,75;
//   - PLR R$ 1.650/ano (R$ 137,50/mês), cesta R$ 190, VR R$ 42 por dia
//     trabalhado (R$ 1.092 em 26 dias), plano médico R$ 283,76, odontológico
//     familiar R$ 50, tudo por mês.
// Administrativo: acordo TRANSFRETUR × SINDRASP 2026/2028 (Circular
// 028/2026) — auxiliar administrativo R$ 1.921,24 em mai/26 e R$ 1.957,83 a
// partir de 01/11/2026; PLR de 40% do salário (até R$ 1.605/ano), VR R$ 42
// por dia, odontológico familiar pago pela empresa.
// Carro de passeio: SINDILOCADESP (locação) — a convenção não foi obtida; a
// sugestão traz o sindicato e o padrão do simulador.
//
// Os valores são os de 01/11/2026, que valem na maior parte da vida de um
// contrato orçado agora; a observação da função guarda os de maio.

export type Convencao = {
  chave: "TRANSFRETUR" | "SINDRASP" | "SINDILOCADESP";
  nome: string;
  abrangencia: string;
};

export const CONVENCOES: Record<Convencao["chave"], Convencao> = {
  TRANSFRETUR: { chave: "TRANSFRETUR", nome: "TRANSFRETUR × SINDIFRETUR 2026/2028", abrangencia: "São Paulo e região" },
  SINDRASP: { chave: "SINDRASP", nome: "TRANSFRETUR × SINDRASP 2026/2028 (administrativos)", abrangencia: "São Paulo e Itapecerica da Serra" },
  SINDILOCADESP: { chave: "SINDILOCADESP", nome: "SINDILOCADESP (locação de veículos)", abrangencia: "Estado de SP" },
};

export const CONVENCAO_DA_CATEGORIA: Record<CategoriaVeiculo, Convencao["chave"]> = {
  CARRO: "SINDILOCADESP",
  VAN: "TRANSFRETUR",
  MICRO: "TRANSFRETUR",
  ONIBUS: "TRANSFRETUR",
};

export const PISO_TRANSFRETUR_NIVEL_A = 3733.44;
export const PISO_TRANSFRETUR_NIVEL_B = 2986.75;
export const PISO_SINDRASP_AUXILIAR_ADM = 1957.83;
export const VR_TRANSFRETUR_DIA = 42;

// Os benefícios mensais do motorista pela circular 013-A (iguais nos dois
// níveis). O vale-refeição da circular conta 26 dias trabalhados.
export const BENEFICIOS_MOTORISTA_TRANSFRETUR = {
  plrMes: 137.5,
  cesta: 190,
  vrVa: 1092,
  planoSaude: 283.76 + 50,
};

// PRÊMIO DO FRETAMENTO EVENTUAL (CCT, cláusula 9ª): sobre o valor da nota da
// viagem sem os tributos, 8% em sábado, domingo, feriado ou viagem longa e 5%
// em dia útil fora do expediente. Compensa as horas extras e o adicional
// noturno da viagem.
export const PREMIO_EVENTUAL_FIM_DE_SEMANA = 0.08;
export const PREMIO_EVENTUAL_DIA_UTIL = 0.05;

// Os campos de uma função "Motorista de …" pela convenção do tipo, prontos
// para a tabela de mão de obra. `salarioPadrao` é o do simulador, usado onde
// a convenção não é conhecida.
export function funcaoPelaConvencao(categoria: CategoriaVeiculo, salarioPadrao: number): { convencao: Convencao; campos: Record<string, string | number> } {
  const convencao = CONVENCOES[CONVENCAO_DA_CATEGORIA[categoria]];
  const base = { cct: convencao.nome, regiao: convencao.abrangencia };
  if (convencao.chave === "TRANSFRETUR") {
    const nivelA = categoria === "ONIBUS";
    return {
      convencao,
      campos: {
        ...base,
        salarioBase: nivelA ? PISO_TRANSFRETUR_NIVEL_A : PISO_TRANSFRETUR_NIVEL_B,
        ...BENEFICIOS_MOTORISTA_TRANSFRETUR,
        observacoes: nivelA
          ? "Nível A (acima de 32 lugares): R$ 3.663,66 de mai/26 a out/26, R$ 3.733,44 desde 01/11/2026. Plano = médico R$ 283,76 + odonto R$ 50. VR R$ 42 × 26 dias. Seguro de vida: cobertura mínima de 10 pisos (prêmio a informar). Jornada 44 h (7h20/dia); HE legal, domingo e feriado 100%."
          : "Nível B (van e micro, com acordo coletivo da empresa): 80% do Nível A — R$ 2.930,93 de mai/26 a out/26, R$ 2.986,75 desde 01/11/2026. Plano = médico R$ 283,76 + odonto R$ 50. VR R$ 42 × 26 dias. Sem acordo coletivo, vale o piso do Nível A.",
      },
    };
  }
  return {
    convencao,
    campos: {
      ...base,
      salarioBase: salarioPadrao,
      observacoes: "Convenção da SINDILOCADESP a conferir: piso e benefícios do motorista de carro são o padrão do simulador até lá.",
    },
  };
}

// O auxiliar administrativo pelo acordo com a SINDRASP.
export function funcaoAdministrativa(): { convencao: Convencao; campos: Record<string, string | number> } {
  const convencao = CONVENCOES.SINDRASP;
  return {
    convencao,
    campos: {
      funcao: "Auxiliar administrativo",
      cct: convencao.nome,
      regiao: convencao.abrangencia,
      salarioBase: PISO_SINDRASP_AUXILIAR_ADM,
      vrVa: VR_TRANSFRETUR_DIA * 22,
      plrMes: Math.round(((PISO_SINDRASP_AUXILIAR_ADM * 0.4) / 12) * 100) / 100,
      planoSaude: 50,
      observacoes:
        "Piso R$ 1.921,24 de mai/26 a out/26, R$ 1.957,83 desde 01/11/2026. PLR 40% do salário (até R$ 1.605/ano). VR R$ 42 por dia (22 dias). Odontológico familiar pago pela empresa (R$ 50); plano médico familiar: 60% de até R$ 472,94 por adesão.",
    },
  };
}
