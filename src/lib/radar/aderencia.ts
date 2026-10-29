// Aderência do objeto da licitação ao que a Azul Mob faz.
//
// Regra escrita, não modelo: quem decide participar precisa saber por que a
// licitação apareceu (os termos encontrados vão junto) e por que uma outra
// não apareceu. A leitura do edital pela IA continua no simulador, depois que
// alguém decide olhar.
//
// - EXCLUSÃO vence tudo: "aquisição de ônibus para o transporte escolar" é
//   compra de veículo, não serviço; "combustível para o transporte de
//   pacientes" é insumo.
// - FORTE = ALTA: o objeto descreve o serviço.
// - FRACO = MÉDIA: fala de ônibus, van ou locação de veículo sem dizer que é
//   transporte de gente com motorista. Vale um olhar rápido.

export type Aderencia = "ALTA" | "MEDIA";
export type Classificacao = { aderencia: Aderencia; termos: string[] } | null;

export const normalizar = (s: string) =>
  ` ${s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;

const FORTES = [
  "transporte escolar",
  "transporte de alunos",
  "transporte de estudantes",
  "transporte universitario",
  "fretamento",
  "transporte de passageiros",
  "transporte de pessoas",
  "transporte de servidores",
  "transporte de funcionarios",
  "transporte de colaboradores",
  "transporte de trabalhadores",
  "transporte de pacientes",
  "transporte sanitario",
  "transporte de equipes",
  "locacao de veiculos com motorista",
  "locacao de veiculo com motorista",
  "locacao de veiculos com condutor",
  "locacao de veiculo com condutor",
  "veiculos com motorista",
  "veiculo com motorista",
];

const FRACOS = ["onibus", "micro onibus", "microonibus", "van", "vans", "locacao de veiculos", "locacao de veiculo", "transporte intermunicipal"];

const EXCLUSOES = [
  "aquisicao de veiculo",
  "aquisicao de veiculos",
  "aquisicao de onibus",
  "aquisicao de micro onibus",
  "aquisicao de van",
  "aquisicao de vans",
  "aquisicao de ambulancia",
  "compra de veiculo",
  "compra de onibus",
  "pecas",
  "pneus",
  "combustivel",
  "combustiveis",
  "lubrificantes",
  "manutencao preventiva",
  "manutencao corretiva",
  "uniformes",
  "rastreamento",
  "seguro de veiculos",
  "seguro dos veiculos",
  "carroceria",
  "leilao",
  "alienacao",
  "seguro",
  "abrigos",
  "ar condicionado",
  "zero quilometro",
  "zero km",
  "0km",
  "0 km",
];

// Compra de veículo escreve "aquisição de 01 (um) veículo", "aquisição de
// micro-ônibus escolar novo": a lista fixa não cobre os números no meio. Se
// o objeto fala em aquisição e não fala em serviço, é compra — visto na
// primeira varredura real (26 a 28/10/2026).
const COMPRA_DE_VEICULO = / (aquisicao|compra) de (\d+ )?([a-z]+ )?(veiculo|veiculos|onibus|micro onibus|microonibus|van|vans|minibus|ambulancia|ambulancias) /;
const SERVICO = ["servico", "servicos", "prestacao", "locacao", "fretamento", "contratacao de empresa"];

const tem = (texto: string, termo: string) => texto.includes(` ${termo} `);

export function classificar(objeto: string): Classificacao {
  const t = normalizar(objeto);
  if (EXCLUSOES.some((e) => tem(t, e))) return null;
  if ((tem(t, "aquisicao") || tem(t, "compra")) && !SERVICO.some((x) => tem(t, x))) return null;
  // "Aquisição de 02 (dois) veículos ... para os serviços de transporte de
  // servidores": fala em serviço, mas compra o veículo.
  if (COMPRA_DE_VEICULO.test(t)) return null;
  const fortes = FORTES.filter((f) => tem(t, f));
  if (fortes.length) return { aderencia: "ALTA", termos: fortes };
  const fracos = FRACOS.filter((f) => tem(t, f));
  if (fracos.length) return { aderencia: "MEDIA", termos: fracos };
  return null;
}

// Tipo de serviço do estudo que nasce do radar (o simulador pede um).
export function tipoServicoProvavel(objeto: string): "ESCOLAR" | "SAUDE" | "LOCACAO_CM" | "FRETAMENTO" {
  const t = normalizar(objeto);
  if (["escolar", "alunos", "estudantes", "universitario"].some((x) => tem(t, x))) return "ESCOLAR";
  if (["pacientes", "sanitario", "saude"].some((x) => tem(t, x))) return "SAUDE";
  if (["com motorista", "com condutor"].some((x) => tem(t, x)) && tem(t, "locacao")) return "LOCACAO_CM";
  return "FRETAMENTO";
}
