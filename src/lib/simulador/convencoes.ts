import type { CategoriaVeiculo } from "./tipos";

// AS CONVENÇÕES COLETIVAS de cada tipo de veículo, como PADRÃO da mão de obra
// na base de custos: fretamento (van, micro, ônibus) pela TRANSFRETUR-SP ×
// SINDIFRETUR; carro de passeio pela SINDILOCADESP (locação de veículos).
//
// Só o que a convenção publicada fixa entra como número. A TRANSFRETUR
// 2025/2027 fixa o piso do Nível A (ônibus acima de 32 lugares) e o
// vale-refeição por dia; o Nível B (van, micro) fica para acordo coletivo de
// cada empresa, e a SINDILOCADESP não foi encontrada publicada — nesses
// casos a sugestão traz o sindicato e o padrão do simulador, e a observação
// diz o que conferir.

export type Convencao = {
  chave: "TRANSFRETUR" | "SINDILOCADESP";
  nome: string;
  abrangencia: string;
  fonte: string;
};

export const CONVENCOES: Record<Convencao["chave"], Convencao> = {
  TRANSFRETUR: {
    chave: "TRANSFRETUR",
    nome: "TRANSFRETUR-SP × SINDIFRETUR 2025/2027",
    abrangencia: "Estado de SP",
    fonte: "CCT 2025/2027 TRANSFRETUR-SP × SINDIFRETUR",
  },
  SINDILOCADESP: {
    chave: "SINDILOCADESP",
    nome: "SINDILOCADESP (locação de veículos)",
    abrangencia: "Estado de SP",
    fonte: "CCT SINDILOCADESP",
  },
};

export const CONVENCAO_DA_CATEGORIA: Record<CategoriaVeiculo, Convencao["chave"]> = {
  CARRO: "SINDILOCADESP",
  VAN: "TRANSFRETUR",
  MICRO: "TRANSFRETUR",
  ONIBUS: "TRANSFRETUR",
};

// TRANSFRETUR 2025/2027: piso do Nível A a partir de 01/01/2026 e VR/VA de
// R$ 38,00 por dia trabalhado (jan/2026), em 22 dias.
export const PISO_TRANSFRETUR_NIVEL_A = 3489.2;
export const VR_TRANSFRETUR_DIA = 38;
export const DIAS_TRABALHADOS_MES = 22;

// Os campos de uma função "Motorista de …" pela convenção do tipo, prontos
// para a tabela de mão de obra. `salarioPadrao` é o do simulador, usado onde
// a convenção não fixa piso.
export function funcaoPelaConvencao(categoria: CategoriaVeiculo, salarioPadrao: number): { convencao: Convencao; campos: Record<string, string | number> } {
  const convencao = CONVENCOES[CONVENCAO_DA_CATEGORIA[categoria]];
  const base = { cct: convencao.nome, regiao: convencao.abrangencia };
  if (convencao.chave === "TRANSFRETUR") {
    const vr = VR_TRANSFRETUR_DIA * DIAS_TRABALHADOS_MES;
    if (categoria === "ONIBUS") {
      return {
        convencao,
        campos: {
          ...base,
          salarioBase: PISO_TRANSFRETUR_NIVEL_A,
          vrVa: vr,
          observacoes:
            "Piso Nível A (acima de 32 lugares) desde 01/01/2026; VR R$ 38/dia; PLR de R$ 1.500/ano; convênio médico individual gratuito e cesta básica fornecida — informe os valores de plano e cesta.",
        },
      };
    }
    return {
      convencao,
      campos: {
        ...base,
        salarioBase: salarioPadrao,
        vrVa: vr,
        observacoes: "Nível B: o piso de van e micro sai de acordo coletivo da empresa com o sindicato — confira o salário. VR R$ 38/dia e PLR de R$ 1.500/ano da convenção.",
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
