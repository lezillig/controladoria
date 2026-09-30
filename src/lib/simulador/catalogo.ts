// O CATÁLOGO DA BASE DE CUSTOS — o que o Gabarito de dados traz e com que
// chave cada coisa é guardada.
//
// Duas famílias de aba no Gabarito (docs/simulador_custos_handoff/planilhas_referencia/
// Gabarito_Dados_Simulador_Custos_AzulMob.xlsx):
//
// - CHAVE E VALOR (3 Jornada, 4 Indiretos, 5 Tributos e financeiro, 6 Insumos,
//   8 Regras da Azul): colunas Item | Unidade | SEU VALOR | O que é | Exemplo.
//   Cada linha vira um SimParametro, reconhecida pelo INÍCIO do rótulo (sem a
//   estrela). O rótulo, e não a posição, é o contrato: inserir uma linha no
//   meio da aba não embaralha os parâmetros.
// - TABULARES (1 Frota, 2 Mão de obra, 7 Pedágios, 9 Histórico, 10 Mercado):
//   linha 4 = cabeçalho, 5 = explicação, 6 = exemplo, dados a partir da 7.
//   Cada coluna é reconhecida pelo TEXTO do cabeçalho.

export type TipoValor = "numero" | "pct" | "texto" | "inteiro" | "simnao";

export type EntidadeParametro = "JORNADA" | "INDIRETO" | "TRIBUTO" | "FINANCEIRO" | "INSUMO" | "REGRA_AZUL";

export type DefinicaoParametro = {
  entidade: EntidadeParametro;
  chave: string;
  // Início do rótulo na coluna A do Gabarito, sem a estrela.
  rotulo: string;
  tipo: TipoValor;
  essencial: boolean;
};

export const ABAS_DE_PARAMETRO: Record<string, EntidadeParametro[]> = {
  "3_Jornada": ["JORNADA"],
  "4_Indiretos": ["INDIRETO"],
  "5_Tributos_Financeiro": ["TRIBUTO", "FINANCEIRO"],
  "6_Insumos": ["INSUMO"],
  "8_Regras_Azul": ["REGRA_AZUL"],
};

const p = (entidade: EntidadeParametro, chave: string, rotulo: string, tipo: TipoValor, essencial = true): DefinicaoParametro => ({
  entidade,
  chave,
  rotulo,
  tipo,
  essencial,
});

export const CATALOGO_PARAMETROS: DefinicaoParametro[] = [
  // 3 — Jornada
  p("JORNADA", "jornada_semanal_h", "Jornada semanal contratual", "numero"),
  p("JORNADA", "escalas", "Escalas praticadas", "texto"),
  p("JORNADA", "horas_dia_he", "Horas/dia a partir das quais paga HE", "numero"),
  p("JORNADA", "he_pct", "Percentual de HE praticado", "pct"),
  p("JORNADA", "noturno_pct", "Adicional noturno", "pct"),
  p("JORNADA", "intrajornada_h", "Intervalo intrajornada considerado", "numero", false),
  p("JORNADA", "espera_remunerada", "Tempo de espera remunerado?", "texto", false),
  p("JORNADA", "mot_escolar_2p", "Escolar 2 períodos", "numero"),
  p("JORNADA", "mot_escolar_3p", "Escolar 3 períodos", "numero"),
  p("JORNADA", "mot_fretamento_2p", "Fretamento contínuo 2 picos", "numero"),
  p("JORNADA", "mot_fretamento_24h", "Fretamento 3 turnos / 24h", "numero"),
  p("JORNADA", "mot_saude", "Van saúde/regulação", "numero", false),
  p("JORNADA", "monitoras_escolar", "Monitora por veículo escolar", "numero"),
  p("JORNADA", "km_morto_pct", "Km morto padrão", "pct"),
  p("JORNADA", "deslocamento_min", "Tempo de deslocamento pago ao motorista", "numero", false),
  // 4 — Indiretos
  p("INDIRETO", "folha_adm", "Folha administrativa + encargos", "numero"),
  p("INDIRETO", "contabilidade", "Contabilidade, jurídico", "numero"),
  // Não vem do Gabarito: o escritório contratado, cujo pagamento no Omie é o
  // valor de "Contabilidade, jurídico" (ver indiretosDoDre.ts).
  p("INDIRETO", "contabilidade_fornecedor", "Fornecedores da contabilidade e do jurídico (nomes no Omie)", "texto", false),
  p("INDIRETO", "sistemas", "Sistemas (gestão de motoristas", "numero"),
  p("INDIRETO", "sede_garagem_sp", "Aluguel/IPTU/energia/água da sede", "numero"),
  p("INDIRETO", "oficina", "Oficina própria", "numero"),
  p("INDIRETO", "gerais", "Marketing, viagens, despesas gerais", "numero", false),
  p("INDIRETO", "veiculos_ativos", "Total de veículos ativos", "numero"),
  p("INDIRETO", "faturamento_medio", "Faturamento mensal médio", "numero"),
  p("INDIRETO", "base_rateio", "Base de rateio preferida", "texto"),
  p("INDIRETO", "garagem_externa_mes", "Garagem/pátio em outra cidade", "numero"),
  p("INDIRETO", "preposto_mes", "Supervisor/preposto local", "numero"),
  p("INDIRETO", "veiculo_apoio_mes", "Veículo de apoio", "numero", false),
  p("INDIRETO", "implantacao", "Implantação de contrato", "numero", false),
  // 5 — Tributos
  p("TRIBUTO", "regime", "Regime tributário", "texto"),
  p("TRIBUTO", "pis", "PIS", "pct"),
  p("TRIBUTO", "cofins", "COFINS", "pct"),
  p("TRIBUTO", "irpj", "IRPJ efetivo", "pct"),
  p("TRIBUTO", "csll", "CSLL efetivo", "pct"),
  p("TRIBUTO", "iss_sp", "ISS — São Paulo capital", "pct"),
  p("TRIBUTO", "iss_outros", "ISS — outros municípios", "texto"),
  p("TRIBUTO", "icms_sp", "ICMS transporte intermunicipal", "pct"),
  p("TRIBUTO", "icms_outros", "ICMS interestadual", "pct", false),
  p("TRIBUTO", "retencoes", "Retenções na fonte", "texto", false),
  p("TRIBUTO", "cprb", "Desoneração da folha", "texto", false),
  // 5 — Financeiro
  p("FINANCEIRO", "prazo_prefeituras", "Prazo médio real de recebimento — prefeituras", "numero"),
  p("FINANCEIRO", "prazo_empresas", "Prazo médio real de recebimento — empresas", "numero"),
  p("FINANCEIRO", "capital_giro_am", "Custo do capital de giro", "pct"),
  p("FINANCEIRO", "inadimplencia_pct", "Inadimplência/glosas", "pct", false),
  p("FINANCEIRO", "seguro_garantia_pct", "Garantia contratual", "pct", false),
  // 6 — Insumos
  p("INSUMO", "diesel_rs_l", "Diesel S10", "numero"),
  p("INSUMO", "gasolina_rs_l", "Gasolina / etanol", "numero", false),
  // Sem linha no Gabarito: preenchidos na tela Custos base.
  p("INSUMO", "etanol_rs_l", "Etanol", "numero", false),
  p("INSUMO", "energia_rs_kwh", "Energia elétrica (recarga)", "numero", false),
  p("INSUMO", "forma_abastecimento", "Forma de abastecimento", "texto"),
  p("INSUMO", "reajuste_diesel_pct", "Reajuste médio anual do diesel", "pct", false),
  p("INSUMO", "arla", "ARLA 32", "texto"),
  p("INSUMO", "oleo_rs_km", "Óleo lubrificante + filtros", "numero"),
  p("INSUMO", "lavagem", "Lavagem e higienização", "texto"),
  p("INSUMO", "recapagem", "Pneus — recapagem", "texto"),
  p("INSUMO", "alinhamento_rs_km", "Alinhamento/balanceamento", "numero", false),
  p("INSUMO", "multas_veic_mes", "Multas de trânsito", "numero", false),
  p("INSUMO", "sinistros_veic_mes", "Sinistros/franquias", "numero", false),
  // 8 — Regras da Azul
  p("REGRA_AZUL", "margem_minima", "Margem líquida mínima", "pct"),
  p("REGRA_AZUL", "margem_alvo", "Margem líquida alvo", "pct"),
  p("REGRA_AZUL", "contingencia_pct", "Contingência/risco padrão", "pct"),
  p("REGRA_AZUL", "adm_pct", "Administração central padrão", "pct", false),
  p("REGRA_AZUL", "passo_lance", "Passo mínimo de lance", "texto", false),
  p("REGRA_AZUL", "reserva_tecnica", "Reserva técnica — van / micro / ônibus", "texto"),
  p("REGRA_AZUL", "idade_max", "Idade máxima de veículo", "numero"),
  p("REGRA_AZUL", "km_max_ano", "Km máximo por veículo/ano", "numero", false),
  p("REGRA_AZUL", "dist_max_sem_base", "Distância máxima da sede", "numero"),
  p("REGRA_AZUL", "utilizacao_srp", "Utilização esperada em SRP", "pct"),
  p("REGRA_AZUL", "meses_custo_fixo_escolar", "Meses de custo fixo em contrato escolar", "numero"),
  // Capital e depreciação da frota: não vêm do Gabarito; valem para todos os
  // tipos de veículo dos estudos novos (ver regrasDeCapital em premissas.ts).
  p("REGRA_AZUL", "capital_proprio_aa", "Remuneração do capital próprio", "pct", false),
  p("REGRA_AZUL", "fracao_financiada", "Parte da frota financiada", "pct", false),
  p("REGRA_AZUL", "taxa_financiamento_aa", "Taxa do financiamento da frota", "pct", false),
  p("REGRA_AZUL", "depreciacao_metodo", "Método de depreciação", "texto", false),
  p("REGRA_AZUL", "vida_util_anos", "Vida útil do veículo", "numero", false),
  p("REGRA_AZUL", "valor_residual_pct", "Valor residual ao fim da vida útil", "pct", false),
  p("REGRA_AZUL", "saida", "Como quer ver o resultado", "texto", false),
  p("REGRA_AZUL", "arredondamento", "Moeda e arredondamento", "texto", false),
  p("REGRA_AZUL", "aprovador", "Quem aprova o preço final", "texto", false),
];

// ---------------------------------------------------------------- tabulares

export type DefinicaoColuna = { cabecalho: string; campo: string; tipo: TipoValor | "pneus" };

export const COLUNAS_FROTA: DefinicaoColuna[] = [
  { cabecalho: "Tipo", campo: "tipo", tipo: "texto" },
  { cabecalho: "Modelo / marca", campo: "modelo", tipo: "texto" },
  { cabecalho: "Ano fab./modelo", campo: "ano", tipo: "inteiro" },
  { cabecalho: "Qtde na frota", campo: "quantidade", tipo: "inteiro" },
  { cabecalho: "Lotação (lugares)", campo: "lotacao", tipo: "inteiro" },
  { cabecalho: "Acessível (PCD)?", campo: "acessivel", tipo: "simnao" },
  { cabecalho: "Km atual médio", campo: "kmAtualMedio", tipo: "inteiro" },
  { cabecalho: "Valor de compra (R$)", campo: "valorCompra", tipo: "numero" },
  { cabecalho: "Valor FIPE atual (R$)", campo: "valorFipe", tipo: "numero" },
  { cabecalho: "Forma de aquisição", campo: "formaAquisicao", tipo: "texto" },
  // A parcela do financiamento é GUARDADA para o fluxo de caixa, e nunca entra
  // no custo: o veículo já é pago por depreciação + remuneração do capital, e
  // somar a parcela contaria o veículo duas vezes (PESQUISA.md, 9.3).
  { cabecalho: "Parcela mensal (R$)", campo: "parcelaMensal", tipo: "numero" },
  { cabecalho: "Taxa efetiva (% a.a.)", campo: "taxaAa", tipo: "pct" },
  { cabecalho: "Parcelas restantes", campo: "parcelasRestantes", tipo: "inteiro" },
  { cabecalho: "Consumo real (km/l)", campo: "consumoKmL", tipo: "numero" },
  { cabecalho: "Combustível", campo: "combustivel", tipo: "texto" },
  { cabecalho: "Manutenção (R$/km)", campo: "manutencaoKm", tipo: "numero" },
  { cabecalho: "Pneus: qtde × preço (R$)", campo: "pneus", tipo: "pneus" },
  { cabecalho: "Vida útil pneu (km)", campo: "pneuVidaKm", tipo: "inteiro" },
  { cabecalho: "Seguro anual (R$)", campo: "seguroAnual", tipo: "numero" },
  { cabecalho: "IPVA + licenciamento (R$/ano)", campo: "ipvaLicenciamentoAnual", tipo: "numero" },
  { cabecalho: "Licenças/registros (R$/ano)", campo: "licencasAnual", tipo: "numero" },
  { cabecalho: "Rastreador (R$/mês)", campo: "rastreadorMensal", tipo: "numero" },
  { cabecalho: "Idade de venda (anos)", campo: "idadeVenda", tipo: "inteiro" },
  { cabecalho: "Valor de revenda típico (% FIPE)", campo: "revendaPctFipe", tipo: "pct" },
  { cabecalho: "Reserva técnica usual (%)", campo: "reservaTecnicaPct", tipo: "pct" },
  { cabecalho: "Observações", campo: "observacoes", tipo: "texto" },
];

export const COLUNAS_MAO_DE_OBRA: DefinicaoColuna[] = [
  { cabecalho: "Função", campo: "funcao", tipo: "texto" },
  { cabecalho: "CCT / sindicato", campo: "cct", tipo: "texto" },
  { cabecalho: "Região", campo: "regiao", tipo: "texto" },
  { cabecalho: "Salário base (R$/mês)", campo: "salarioBase", tipo: "numero" },
  { cabecalho: "Adicionais fixos (R$/mês)", campo: "adicionaisFixos", tipo: "numero" },
  { cabecalho: "Horas extras médias (%)", campo: "hePct", tipo: "pct" },
  { cabecalho: "Adicional noturno médio (%)", campo: "noturnoPct", tipo: "pct" },
  { cabecalho: "Encargos sociais (%)", campo: "encargosPct", tipo: "pct" },
  { cabecalho: "VR/VA (R$/mês)", campo: "vrVa", tipo: "numero" },
  { cabecalho: "Cesta básica (R$/mês)", campo: "cesta", tipo: "numero" },
  { cabecalho: "Vale-transporte líquido (R$/mês)", campo: "valeTransporte", tipo: "numero" },
  { cabecalho: "Plano de saúde/odonto (R$/mês)", campo: "planoSaude", tipo: "numero" },
  { cabecalho: "Seguro de vida (R$/mês)", campo: "seguroVida", tipo: "numero" },
  { cabecalho: "Uniforme + EPI (R$/mês)", campo: "uniformeEpi", tipo: "numero" },
  { cabecalho: "Exames e cursos (R$/mês)", campo: "examesCursos", tipo: "numero" },
  { cabecalho: "Absenteísmo/folguista (%)", campo: "absenteismoPct", tipo: "pct" },
  { cabecalho: "Rotatividade anual (%)", campo: "rotatividadePct", tipo: "pct" },
  { cabecalho: "Custo total do posto (R$/mês)", campo: "custoTotalPosto", tipo: "numero" },
  { cabecalho: "Observações", campo: "observacoes", tipo: "texto" },
];

export const COLUNAS_PEDAGIO: DefinicaoColuna[] = [
  { cabecalho: "Rodovia / praça", campo: "praca", tipo: "texto" },
  { cabecalho: "Concessionária", campo: "concessionaria", tipo: "texto" },
  { cabecalho: "Tarifa carro / van 2 eixos (R$)", campo: "tarifaVan", tipo: "numero" },
  { cabecalho: "Tarifa micro-ônibus (R$)", campo: "tarifaMicro", tipo: "numero" },
  { cabecalho: "Tarifa ônibus 2 eixos (R$)", campo: "tarifaOnibus2", tipo: "numero" },
  { cabecalho: "Tarifa ônibus 3 eixos (R$)", campo: "tarifaOnibus3", tipo: "numero" },
  { cabecalho: "Desconto tag / DUF (%)", campo: "descontoTagPct", tipo: "pct" },
  { cabecalho: "Usado em quais operações", campo: "operacoes", tipo: "texto" },
  { cabecalho: "Data da tarifa", campo: "dataTarifa", tipo: "texto" },
  { cabecalho: "Observações", campo: "observacoes", tipo: "texto" },
];

// Colunas-chave das abas de referência (9 e 10): identificam a linha entre
// importações. O resto vai como veio para `dados`.
export const CHAVE_REFERENCIA: Record<"9_Historico_Contratos" | "10_Mercado", string> = {
  "9_Historico_Contratos": "Contrato / cliente",
  "10_Mercado": "Edital / órgão",
};

// ---------------------------------------------------------------- leitura de valores

// A ordem das alternativas importa: milhar pt-BR ("1.150", "1.150,50") antes
// de decimal com vírgula ("4,20"), antes de decimal com ponto ("0.18", "6.15"),
// antes de inteiro. Milhar exige primeiro dígito de 1 a 9 — "0.045" é decimal.
const RE_NUMERO_BR = /-?(?:[1-9]\d{0,2}(?:\.\d{3})+(?:,\d+)?|\d+,\d+|\d+\.\d+|\d+)/;

function converterNumero(bruto: string): number {
  if (bruto.includes(",")) return Number(bruto.replace(/\./g, "").replace(",", "."));
  if (/^-?[1-9]\d{0,2}(\.\d{3})+$/.test(bruto)) return Number(bruto.replace(/\./g, ""));
  return Number(bruto);
}

// "R$ 6,15" → 6.15; "1.150" → 1150; "0.18" → 0.18; "12%" → 12 (o % é tratado
// por quem chama). Texto sem número → null.
export function numeroDoTexto(texto: string): number | null {
  const m = texto.match(RE_NUMERO_BR);
  return m ? converterNumero(m[0]) : null;
}

export function todosOsNumeros(texto: string): number[] {
  const re = new RegExp(RE_NUMERO_BR.source, "g");
  return [...texto.matchAll(re)].map((m) => converterNumero(m[0])).filter((n) => Number.isFinite(n));
}

// Percentual: o Gabarito aceita "70" ou "0,70" para 70%. Acima de 1 é lido
// como pontos percentuais. Um percentual legítimo acima de 100% (revenda de
// 120% da FIPE) não existe nas abas; se aparecer, sai como aviso de quem chama.
export function normalizarPct(n: number): number {
  return Math.abs(n) > 1 ? n / 100 : n;
}

export function normalizarRotulo(s: string): string {
  return s
    .replace(/★/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizarCabecalho(s: string): string {
  return normalizarRotulo(s).toLowerCase();
}
