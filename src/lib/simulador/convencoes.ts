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
export const PLANO_MEDICO_TRANSFRETUR = 283.76;
export const ODONTO_FAMILIAR_TRANSFRETUR = 50;

// Os benefícios MENSAIS do motorista pela circular 013-A (iguais nos dois
// níveis). O vale-refeição fica fora: é por dia trabalhado (VR_TRANSFRETUR_DIA)
// e os dias saem da operação do estudo — a circular conta 26 (escala 6x1);
// um contrato de segunda a sexta paga ~22.
export const BENEFICIOS_MOTORISTA_TRANSFRETUR = {
  plrMes: 137.5,
  cesta: 190,
  planoSaude: PLANO_MEDICO_TRANSFRETUR + ODONTO_FAMILIAR_TRANSFRETUR,
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
        vrDia: VR_TRANSFRETUR_DIA,
        observacoes: nivelA
          ? "Nível A (acima de 32 lugares): R$ 3.663,66 de mai/26 a out/26, R$ 3.733,44 desde 01/11/2026. Plano = médico R$ 283,76 + odonto R$ 50. VR R$ 42 por dia trabalhado (dias da operação do estudo). Seguro de vida: cobertura mínima de 10 pisos (prêmio a informar). Jornada 44 h (7h20/dia); HE legal, domingo e feriado 100%."
          : "Nível B (van e micro, com acordo coletivo da empresa): 80% do Nível A — R$ 2.930,93 de mai/26 a out/26, R$ 2.986,75 desde 01/11/2026. Plano = médico R$ 283,76 + odonto R$ 50. VR R$ 42 por dia trabalhado (dias da operação do estudo). Sem acordo coletivo, vale o piso do Nível A.",
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
      vrDia: VR_TRANSFRETUR_DIA,
      plrMes: Math.round(((PISO_SINDRASP_AUXILIAR_ADM * 0.4) / 12) * 100) / 100,
      planoSaude: 50,
      observacoes:
        "Piso R$ 1.921,24 de mai/26 a out/26, R$ 1.957,83 desde 01/11/2026. PLR 40% do salário (até R$ 1.605/ano). VR R$ 42 por dia trabalhado. Odontológico familiar pago pela empresa (R$ 50); plano médico familiar: 60% de até R$ 472,94 por adesão.",
    },
  };
}

const semAcento = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// A sugestão (convenção) que corresponde à linha, pelo nome da função: igual,
// ou pela palavra do tipo — micro antes de ônibus, porque "micro-ônibus"
// contém os dois.
export function sugestaoDaFuncao<S extends { campos: Record<string, unknown> }>(identificacao: unknown, sugestoes: S[], campo: string): S | null {
  if (typeof identificacao !== "string" || !identificacao.trim()) return null;
  const nome = semAcento(identificacao);
  const igual = sugestoes.find((s) => typeof s.campos[campo] === "string" && semAcento(s.campos[campo] as string) === nome);
  if (igual) return igual;
  const chaves: [string, (f: string) => boolean][] = [
    ["micro", (f) => f.includes("micro")],
    ["onibus", (f) => f.includes("onibus") && !f.includes("micro")],
    ["van", (f) => f.includes("van")],
    ["carro", (f) => f.includes("carro")],
    ["adm", (f) => f.includes("administrativo")],
    ["auxiliar", (f) => f.includes("administrativo")],
  ];
  const chave = chaves.find(([k]) => nome.includes(k));
  if (!chave) return null;
  return sugestoes.find((s) => typeof s.campos[campo] === "string" && chave[1](semAcento(s.campos[campo] as string))) ?? null;
}

// O que "Completar pela convenção" preenche numa linha da base: só os campos
// vazios que a tabela tem. O VR por dia não entra se a linha já traz o VR/VA
// mensal — seria o mesmo vale duas vezes.
export function camposParaCompletar<V>(
  valores: Record<string, unknown>,
  sugestao: { campos: Record<string, V> },
  identificador: string,
  camposDaTabela: string[]
): [string, V][] {
  const vazio = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
  return Object.entries(sugestao.campos).filter(
    ([k, v]) => k !== identificador && camposDaTabela.includes(k) && vazio(valores[k]) && !vazio(v) && !(k === "vrDia" && !vazio(valores.vrVa))
  );
}
