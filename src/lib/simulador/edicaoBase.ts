import { prisma } from "@/lib/prisma";
import { gravarLeitura, type ResumoGravacao } from "./baseDeCustos";
import { CATALOGO_PARAMETROS, COLUNAS_FROTA, COLUNAS_MAO_DE_OBRA, COLUNAS_PEDAGIO, normalizarPct, todosOsNumeros, type DefinicaoColuna } from "./catalogo";
import { normalizarChave, type LeituraGabarito, type RegistroLido } from "./gabarito";
import { lerCaminho, PREMISSAS_PADRAO } from "./premissas";
import { PRECO_ENERGIA_PADRAO } from "./energia";

// AJUSTAR A BASE DE CUSTOS PELA TELA — sem planilha.
//
// É a mesma gravação da importação do Gabarito (gravarLeitura), com uma
// leitura de um item só: valor igual não grava nada; valor diferente fecha a
// vigência do anterior e abre uma nova, com a fonte "ajuste na tela". Nada é
// sobrescrito, e estudos já salvos continuam com a base do dia deles.
//
// "Voltar ao padrão" encerra a vigência do valor da base: a partir dali os
// estudos novos usam o padrão do simulador (marcado como estimativa).

export const FONTE_AJUSTE = "ajuste na tela";

// Onde cada parâmetro da base entra na conta. O que não está aqui é
// informativo (fica na base para consulta e para o especialista de IA).
export const USO_DA_BASE: Record<string, { caminho?: string; como: string; unidade?: string; unidadePadrao?: string; padrao?: number }> = {
  km_morto_pct: { caminho: "contrato.kmMortoPct", como: "Km improdutivo das rotas" },
  utilizacao_srp: { caminho: "contrato.utilizacao", como: "Utilização prevista do km" },
  meses_custo_fixo_escolar: { caminho: "contrato.mesesCustoFixo", como: "Meses de custo fixo no contrato escolar", unidade: "meses" },
  noturno_pct: { caminho: "pessoal.adicionalNoturnoPct", como: "Adicional sobre as horas noturnas" },
  preposto_mes: { caminho: "pessoal.supervisaoMes", como: "Supervisão local, quando o estudo tem base local", unidade: "R$/mês" },
  mot_fretamento_2p: { como: "Motoristas por veículo dos tipos de veículo (padrão 1,2)", unidade: "motoristas/veículo" },
  folha_adm: { como: "Rateio da administração central (soma dos indiretos ÷ faturamento médio)", unidade: "R$/mês" },
  contabilidade: { como: "Rateio da administração central", unidade: "R$/mês" },
  contabilidade_fornecedor: { como: "Os pagamentos a este fornecedor no Omie são o valor de Contabilidade, jurídico (padrão: JL Business)" },
  sistemas: { como: "Rateio da administração central", unidade: "R$/mês" },
  sede_garagem_sp: { como: "Rateio da administração central", unidade: "R$/mês" },
  oficina: { como: "Rateio da administração central", unidade: "R$/mês" },
  gerais: { como: "Rateio da administração central", unidade: "R$/mês" },
  faturamento_medio: { como: "Divisor do rateio da administração central", unidade: "R$/mês" },
  adm_pct: { caminho: "indiretos.administracaoPct", como: "Administração central, quando não há rateio pelos indiretos" },
  contingencia_pct: { caminho: "indiretos.contingenciaPct", como: "Contingência sobre o custo direto" },
  margem_alvo: { caminho: "preco.lucroAlvoPct", como: "Lucro líquido alvo do preço" },
  margem_minima: { como: "Margem mínima do painel de decisão (padrão: metade do alvo)" },
  reserva_tecnica: { caminho: "contrato.reservaTecnicaPct", como: "Reserva técnica de frota (van / micro / ônibus)", unidadePadrao: "da frota, para todos os tipos" },
  pis: { caminho: "preco.pis", como: "Tributo sobre o preço" },
  cofins: { caminho: "preco.cofins", como: "Tributo sobre o preço" },
  irpj: { caminho: "preco.irpj", como: "Tributo sobre o preço (Presumido)" },
  csll: { caminho: "preco.csll", como: "Tributo sobre o preço (Presumido)" },
  iss_sp: { caminho: "preco.iss", como: "ISS sobre o preço" },
  icms_sp: { caminho: "preco.icms", como: "ICMS no intermunicipal" },
  capital_giro_am: { caminho: "preco.custoCapitalGiroAm", como: "Custo financeiro do prazo de recebimento" },
  prazo_prefeituras: { caminho: "preco.prazoRecebimentoDias", como: "Prazo de recebimento em licitação", unidade: "dias" },
  prazo_empresas: { caminho: "preco.prazoRecebimentoDias", como: "Prazo de recebimento em contrato privado", unidade: "dias" },
  seguro_garantia_pct: { caminho: "preco.despesasSobrePrecoPct", como: "Garantia contratual, como despesa sobre o preço" },
  diesel_rs_l: { caminho: "variaveis.dieselLitro", como: "Preço do diesel", unidade: "R$/l" },
  gasolina_rs_l: { como: "Preço da gasolina — tipos de veículo a gasolina (carro)", unidade: "R$/l", padrao: PRECO_ENERGIA_PADRAO.GASOLINA },
  etanol_rs_l: { como: "Preço do etanol — tipos de veículo a etanol", unidade: "R$/l", padrao: PRECO_ENERGIA_PADRAO.ETANOL },
  energia_rs_kwh: { como: "Tarifa da recarga — tipos de veículo elétricos (consumo em km/kWh)", unidade: "R$/kWh", padrao: PRECO_ENERGIA_PADRAO.ELETRICO },
  oleo_rs_km: { caminho: "variaveis.oleoLavagemKm", como: "Óleo e filtros por km", unidade: "R$/km" },
  arla: { caminho: "variaveis.arlaKm", como: "ARLA por km (preço × % do diesel ÷ consumo)", unidadePadrao: "R$/km (já calculado)" },
};

export function padraoDoSimulador(chave: string): number | null {
  if (USO_DA_BASE[chave]?.padrao !== undefined) return USO_DA_BASE[chave].padrao!;
  const caminho = USO_DA_BASE[chave]?.caminho;
  if (!caminho) return null;
  const v = lerCaminho(PREMISSAS_PADRAO, caminho);
  return typeof v === "number" ? v : null;
}

const vazia = (): LeituraGabarito => ({ parametros: [], veiculos: [], funcoes: [], pedagios: [], referencias: [], avisos: [] });

export async function ajustarParametro(
  companyId: string,
  chave: string,
  entrada: { valor: number | null; texto: string | null },
  autor: string | null
): Promise<{ erro?: string; resumo?: ResumoGravacao }> {
  const def = CATALOGO_PARAMETROS.find((p) => p.chave === chave);
  if (!def) return { erro: "Parâmetro desconhecido." };
  const atual = await prisma.simParametro.findFirst({ where: { companyId, chave, vigenciaFim: null }, select: { unidade: true } });
  let valor: number | null = null;
  let texto: string | null = null;
  if (def.tipo === "texto") {
    texto = entrada.texto?.trim().slice(0, 300) || null;
    if (!texto) return { erro: "Escreva o valor." };
    // Textos que o cálculo lê por números ("R$ 4,20; 4,5%") guardam o número
    // também, como a importação.
    const nums = todosOsNumeros(texto);
    valor = nums.length === 1 ? nums[0] : null;
  } else {
    valor = entrada.valor;
    if (valor === null || !Number.isFinite(valor)) return { erro: "Informe um número." };
    if (def.tipo === "pct") valor = normalizarPct(valor);
    if (valor < 0) return { erro: "O valor não pode ser negativo." };
  }
  const leitura = vazia();
  leitura.parametros.push({ entidade: def.entidade, chave, rotulo: def.rotulo, unidade: atual?.unidade ?? (def.tipo === "pct" ? "%" : null), valor, texto });
  return { resumo: await gravarLeitura(companyId, leitura, { fonte: FONTE_AJUSTE, autor }) };
}

export async function voltarAoPadrao(companyId: string, chave: string): Promise<{ erro?: string }> {
  const r = await prisma.simParametro.updateMany({ where: { companyId, chave, vigenciaFim: null }, data: { vigenciaFim: new Date() } });
  return r.count > 0 ? {} : { erro: "Este parâmetro já está no padrão." };
}

// ---------------------------------------------------------------- tabulares

export type TipoTabela = "veiculo" | "funcao" | "pedagio";

export const TABELAS: Record<TipoTabela, { colunas: DefinicaoColuna[]; modelo: "simVeiculoModelo" | "simFuncao" | "simPedagioPraca"; chave: (c: RegistroLido["campos"]) => string | null; obrigatorios: string[] }> = {
  veiculo: {
    colunas: COLUNAS_FROTA,
    modelo: "simVeiculoModelo",
    chave: (c) => (c.tipo && c.modelo ? normalizarChave(c.tipo as string, c.modelo as string, c.ano as number | null) : null),
    obrigatorios: ["tipo", "modelo"],
  },
  funcao: {
    colunas: COLUNAS_MAO_DE_OBRA,
    modelo: "simFuncao",
    chave: (c) => (c.funcao ? normalizarChave(c.funcao as string, c.regiao as string | null, c.cct as string | null) : null),
    obrigatorios: ["funcao"],
  },
  pedagio: {
    colunas: COLUNAS_PEDAGIO,
    modelo: "simPedagioPraca",
    chave: (c) => (c.praca ? normalizarChave(c.praca as string) : null),
    obrigatorios: ["praca"],
  },
};

// Campos que a tela edita: os das colunas do Gabarito, com os pneus em dois
// números (quantidade e preço) em vez do texto "6 × R$ 1.150".
export function camposEditaveis(tipo: TipoTabela): { campo: string; rotulo: string; tipo: "texto" | "numero" | "pct" | "inteiro" | "simnao" }[] {
  return TABELAS[tipo].colunas.flatMap((c) =>
    c.tipo === "pneus"
      ? [
          { campo: "pneusQtde", rotulo: "Pneus (qtde)", tipo: "inteiro" as const },
          { campo: "pneuPreco", rotulo: "Preço do pneu (R$)", tipo: "numero" as const },
        ]
      : [{ campo: c.campo, rotulo: c.cabecalho, tipo: c.tipo as "texto" | "numero" | "pct" | "inteiro" | "simnao" }]
  );
}

export async function salvarRegistro(
  companyId: string,
  tipo: TipoTabela,
  camposBrutos: Record<string, unknown>,
  idAnterior: string | null,
  autor: string | null
): Promise<{ erro?: string; resumo?: ResumoGravacao }> {
  const tabela = TABELAS[tipo];
  const campos: RegistroLido["campos"] = {};
  for (const c of camposEditaveis(tipo)) {
    const v = camposBrutos[c.campo];
    if (v === undefined || v === null || v === "") {
      campos[c.campo] = null;
      continue;
    }
    if (c.tipo === "texto") campos[c.campo] = String(v).trim().slice(0, 300) || null;
    else if (c.tipo === "simnao") campos[c.campo] = v === true || v === "true";
    else {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n) || n < 0) return { erro: `${c.rotulo}: número inválido.` };
      campos[c.campo] = c.tipo === "inteiro" ? Math.round(n) : c.tipo === "pct" ? normalizarPct(n) : n;
    }
  }
  if (tipo === "veiculo") campos.pneusDescricao = campos.pneusQtde && campos.pneuPreco ? `${campos.pneusQtde} × R$ ${campos.pneuPreco}` : null;
  const faltando = tabela.obrigatorios.filter((k) => !campos[k]);
  if (faltando.length > 0) return { erro: `Preencha: ${faltando.map((k) => camposEditaveis(tipo).find((c) => c.campo === k)?.rotulo ?? k).join(", ")}.` };
  const chave = tabela.chave(campos);
  if (!chave) return { erro: "Registro sem identificação." };
  const leitura = vazia();
  const lista = tipo === "veiculo" ? leitura.veiculos : tipo === "funcao" ? leitura.funcoes : leitura.pedagios;
  lista.push({ chave, campos });
  const resumo = await gravarLeitura(companyId, leitura, { fonte: FONTE_AJUSTE, autor });
  // Mudou o que identifica a linha (tipo, modelo, ano; função, região, CCT;
  // praça): é outro registro. O anterior sai de vigência para não ficar dois.
  if (idAnterior) {
    const delegado = prisma[tabela.modelo] as unknown as { updateMany: (a: unknown) => Promise<{ count: number }> };
    await delegado.updateMany({ where: { id: idAnterior, companyId, vigenciaFim: null, NOT: { chave } }, data: { vigenciaFim: new Date() } });
  }
  return { resumo };
}

export async function encerrarRegistro(companyId: string, tipo: TipoTabela, id: string): Promise<{ erro?: string }> {
  const delegado = prisma[TABELAS[tipo].modelo] as unknown as { updateMany: (a: unknown) => Promise<{ count: number }> };
  const r = await delegado.updateMany({ where: { id, companyId, vigenciaFim: null }, data: { vigenciaFim: new Date() } });
  return r.count > 0 ? {} : { erro: "Registro não encontrado." };
}
