import { lerReaisEmCents } from "@/lib/controladoria/format";
import { normalizarChassi, normalizarPlaca, normalizarRenavam } from "./normalizacao";

// A FICHA DO VEÍCULO — o que substitui a aba FROTA ATIVA da planilha
// "CONTROLE INFORMAÇÕES GERAIS". Aqui só a leitura e a conferência do
// formulário (pura, testada em scripts/teste-frota-cadastro.ts); a gravação, com
// trilha, fica na ação da tela.

export const TIPOS_VEICULO = ["van", "minivan", "micro", "onibus", "carro", "caminhao", "outro"] as const;
export const ROTULO_TIPO_VEICULO: Record<string, string> = { van: "Van", minivan: "Mini van", micro: "Micro-ônibus", onibus: "Ônibus", carro: "Carro", caminhao: "Caminhão", outro: "Outro" };
export const USOS_VEICULO = ["fretamento", "escolar", "fretamento_adaptado", "unidade_movel", "cargas", "misto"] as const;
export const ROTULO_USO: Record<string, string> = { fretamento: "Fretamento", escolar: "Escolar", fretamento_adaptado: "Fretamento adaptado", unidade_movel: "Unidade móvel", cargas: "Cargas", misto: "Misto" };
export const IPVA_SITUACOES = ["nao_isento", "em_analise", "isento_sem_restituicao", "isento_falta_restituir", "isento_liberado_restituir", "isento_restituido"] as const;
export const ROTULO_IPVA: Record<string, string> = {
  nao_isento: "não tem isenção",
  em_analise: "em análise",
  isento_sem_restituicao: "isento — sem restituição",
  isento_falta_restituir: "isento — falta restituir",
  isento_liberado_restituir: "isento — liberado para restituir",
  isento_restituido: "isento — valor restituído",
};
export const STATUS_VEICULO = ["ativo", "manutencao", "reserva", "vendido", "baixado"] as const;
export const ROTULO_STATUS_VEICULO: Record<string, string> = { ativo: "ativo", manutencao: "em manutenção", reserva: "reserva", vendido: "vendido", baixado: "baixado" };

// O texto livre da planilha → a situação do IPVA.
export function situacaoIpva(texto: string | null | undefined): string | null {
  const t = String(texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  if (!t.trim() || t.trim() === "?") return null;
  if (/NAO TEM/.test(t)) return "nao_isento";
  if (/ANALISE/.test(t)) return "em_analise";
  if (/FALTA RESTITUIR/.test(t)) return "isento_falta_restituir";
  if (/LIBERADO/.test(t)) return "isento_liberado_restituir";
  if (/RESTITUIDO/.test(t)) return "isento_restituido";
  if (/SEM RESTITUICAO|ISENTO/.test(t)) return "isento_sem_restituicao";
  return null;
}

// A categoria de uso da planilha ("ADAPTADA FRETAMENTO", "UNIDADE MÓVEL"…).
export function usoDoTexto(texto: string | null | undefined): string | null {
  const t = String(texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  if (/ADAPTAD/.test(t)) return "fretamento_adaptado";
  if (/UNIDADE MOVEL/.test(t)) return "unidade_movel";
  if (/ESCOLAR/.test(t)) return "escolar";
  if (/FRETAMENTO/.test(t)) return "fretamento";
  if (/CARGA/.test(t)) return "cargas";
  return null;
}

export type DadosVeiculo = {
  placa: string | null;
  renavam: string | null;
  chassi: string | null;
  prefixo: string | null;
  tipo: string;
  eletrico: boolean;
  marca: string | null;
  modelo: string | null;
  cor: string | null;
  anoFab: number | null;
  anoMod: number | null;
  capacidade: number | null;
  adaptacao: string | null;
  categoriaUso: string | null;
  categoriaRegistro: string | null;
  empresa: string | null;
  alocacao: string | null;
  dataCompra: Date | null;
  notaFiscalCompra: string | null;
  vendedorNome: string | null;
  vidaUtilMeses: number;
  crlvExercicio: number | null;
  crvSituacao: string | null;
  ipvaSituacao: string | null;
  ipvaIsencaoInicio: Date | null;
  tagPedagio: boolean | null;
  apoliceId: string | null;
  apoliceVencimento: Date | null;
  idIturan: string | null;
  observacoes: string | null;
  // Só quem vê valores (permissão "frota-valores") manda estes; ausentes,
  // a gravação não toca neles.
  valorCompraCents?: bigint | null;
};

type Leitura<T> = { ok: true; dados: T } | { ok: false; erro: string };
const txt = (v: unknown) => {
  const t = String(v ?? "").trim();
  return t === "" ? null : t;
};
export function lerData(v: unknown): Date | null | "invalida" {
  const t = txt(v);
  if (!t) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return "invalida";
  const d = new Date(`${t}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? "invalida" : d;
}
export function lerInteiro(v: unknown, min: number, max: number): number | null | "invalido" {
  const t = txt(v);
  if (!t) return null;
  const x = Number(t.replace(/\./g, ""));
  return Number.isInteger(x) && x >= min && x <= max ? x : "invalido";
}
const marcado = (v: unknown) => v === "1" || v === "on" || v === true;

export function lerVeiculo(f: Record<string, unknown>, hoje = new Date(), comValores = false): Leitura<DadosVeiculo> {
  const placaTxt = txt(f.placa);
  const placa = placaTxt ? normalizarPlaca(placaTxt) : null;
  if (placaTxt && !placa) return { ok: false, erro: "Placa inválida (use ABC1234 ou ABC1D23)." };
  const chassiTxt = txt(f.chassi);
  const chassi = chassiTxt ? normalizarChassi(chassiTxt) : null;
  if (chassiTxt && !chassi) return { ok: false, erro: "Chassi inválido (17 caracteres, sem as letras I, O e Q)." };
  if (!placa && !chassi) return { ok: false, erro: "Informe a placa ou, no veículo ainda não emplacado, o chassi." };
  const renavamTxt = txt(f.renavam);
  const renavam = renavamTxt ? normalizarRenavam(renavamTxt) : null;
  if (renavamTxt && !renavam) return { ok: false, erro: "RENAVAM inválido (o dígito verificador não confere)." };
  const tipo = String(f.tipo ?? "outro");
  if (!(TIPOS_VEICULO as readonly string[]).includes(tipo)) return { ok: false, erro: "Tipo de veículo inválido." };
  const uso = txt(f.categoriaUso);
  if (uso && !(USOS_VEICULO as readonly string[]).includes(uso)) return { ok: false, erro: "Categoria de uso inválida." };
  const registro = txt(f.categoriaRegistro);
  if (registro && !["aluguel", "particular"].includes(registro)) return { ok: false, erro: "Categoria do registro: aluguel ou particular." };
  const ipva = txt(f.ipvaSituacao);
  if (ipva && !(IPVA_SITUACOES as readonly string[]).includes(ipva)) return { ok: false, erro: "Situação do IPVA inválida." };
  const anoMax = hoje.getUTCFullYear() + 1;
  const anoFab = lerInteiro(f.anoFab, 1970, anoMax);
  const anoMod = lerInteiro(f.anoMod, 1970, anoMax + 1);
  if (anoFab === "invalido" || anoMod === "invalido") return { ok: false, erro: `Ano inválido (entre 1970 e ${anoMax}).` };
  if (anoFab && anoMod && (anoMod < anoFab || anoMod > anoFab + 1)) return { ok: false, erro: "O ano do modelo é o de fabricação ou o seguinte." };
  const capacidade = lerInteiro(f.capacidade, 1, 99);
  if (capacidade === "invalido") return { ok: false, erro: "Capacidade inválida (lugares, de 1 a 99)." };
  const vida = lerInteiro(f.vidaUtilMeses, 12, 360);
  if (vida === "invalido") return { ok: false, erro: "Vida útil inválida (de 12 a 360 meses)." };
  const crlv = lerInteiro(f.crlvExercicio, 2000, anoMax);
  if (crlv === "invalido") return { ok: false, erro: "Exercício do CRLV inválido (o ano)." };
  const datas: Record<string, Date | null> = {};
  for (const [campo, rotulo] of [["dataCompra", "compra"], ["ipvaIsencaoInicio", "início da isenção"], ["apoliceVencimento", "vencimento da apólice"]] as const) {
    const d = lerData(f[campo]);
    if (d === "invalida") return { ok: false, erro: `Data de ${rotulo} inválida.` };
    datas[campo] = d;
  }
  if (datas.dataCompra && datas.dataCompra > hoje) return { ok: false, erro: "A data de compra não pode ser no futuro." };
  let valorCompraCents: bigint | null | undefined;
  if (comValores) {
    const v = lerReaisEmCents(String(f.valorCompra ?? ""));
    if (v === "invalido" || (typeof v === "number" && v < 0)) return { ok: false, erro: "Valor de compra inválido." };
    valorCompraCents = v === null ? null : BigInt(v);
  }
  const tag = txt(f.tagPedagio);
  return {
    ok: true,
    dados: {
      placa,
      renavam,
      chassi,
      prefixo: txt(f.prefixo),
      tipo,
      eletrico: marcado(f.eletrico),
      marca: txt(f.marca),
      modelo: txt(f.modelo),
      cor: txt(f.cor),
      anoFab,
      anoMod,
      capacidade,
      adaptacao: txt(f.adaptacao),
      categoriaUso: uso,
      categoriaRegistro: registro,
      empresa: txt(f.empresa),
      alocacao: txt(f.alocacao),
      dataCompra: datas.dataCompra,
      notaFiscalCompra: txt(f.notaFiscalCompra),
      vendedorNome: txt(f.vendedorNome),
      vidaUtilMeses: vida ?? 60,
      crlvExercicio: crlv,
      crvSituacao: txt(f.crvSituacao),
      ipvaSituacao: ipva,
      ipvaIsencaoInicio: datas.ipvaIsencaoInicio,
      tagPedagio: tag === "sim" ? true : tag === "nao" ? false : null,
      apoliceId: txt(f.apoliceId),
      apoliceVencimento: datas.apoliceVencimento,
      idIturan: txt(f.idIturan),
      observacoes: txt(f.observacoes)?.slice(0, 2000) ?? null,
      ...(comValores ? { valorCompraCents } : {}),
    },
  };
}

// VENDA E BAIXA — o que substitui a aba VENDIDOS. O veículo não é apagado.
export type Situacao =
  | { status: "vendido"; dataVenda: Date; valorVendaCents: bigint | null; compradorNome: string | null; transferenciaSituacao: string | null }
  | { status: "baixado"; dataBaixa: Date; motivoBaixa: string };

export function lerSituacao(f: Record<string, unknown>, hoje = new Date()): Leitura<Situacao> {
  const acao = String(f.acao ?? "");
  const data = lerData(f.data);
  if (!data || data === "invalida" || data > hoje) return { ok: false, erro: "Informe a data (até hoje)." };
  if (acao === "vender") {
    const valor = lerReaisEmCents(String(f.valor ?? ""));
    if (valor === "invalido" || (typeof valor === "number" && valor < 0)) return { ok: false, erro: "Valor de venda inválido." };
    const comprador = txt(f.comprador);
    if (!comprador) return { ok: false, erro: "Informe o comprador." };
    return { ok: true, dados: { status: "vendido", dataVenda: data, valorVendaCents: valor === null ? null : BigInt(valor), compradorNome: comprador.slice(0, 200), transferenciaSituacao: txt(f.transferencia) } };
  }
  if (acao === "baixar") {
    const motivo = txt(f.motivo);
    if (!motivo) return { ok: false, erro: "Informe o motivo da baixa (perda total, sucata, roubo…)." };
    return { ok: true, dados: { status: "baixado", dataBaixa: data, motivoBaixa: motivo.slice(0, 300) } };
  }
  return { ok: false, erro: "Ação inválida." };
}

// O investimento no veículo: compra + adaptações; a depreciação linear no
// mês, pela vida útil; e o valor de mercado (ajustado > FIPE).
export function investimentoDoVeiculo(v: { valorCompraCents: bigint | number | null; vidaUtilMeses: number; dataCompra: Date | null; fipeValorCents: bigint | number | null; valorAjustadoCents: bigint | number | null }, adaptacoesCents: number, hoje: Date) {
  const compra = v.valorCompraCents === null ? null : Number(v.valorCompraCents);
  const investido = compra === null && adaptacoesCents === 0 ? null : (compra ?? 0) + adaptacoesCents;
  const meses = v.dataCompra ? Math.max(0, (hoje.getUTCFullYear() - v.dataCompra.getUTCFullYear()) * 12 + hoje.getUTCMonth() - v.dataCompra.getUTCMonth()) : null;
  const depreciacaoMensal = investido !== null ? Math.round(investido / v.vidaUtilMeses) : null;
  const residualContabil = investido !== null && meses !== null ? Math.max(0, investido - (depreciacaoMensal ?? 0) * Math.min(meses, v.vidaUtilMeses)) : null;
  const mercado = v.valorAjustadoCents !== null ? Number(v.valorAjustadoCents) : v.fipeValorCents !== null ? Number(v.fipeValorCents) : null;
  return { investidoCents: investido, depreciacaoMensalCents: depreciacaoMensal, residualContabilCents: residualContabil, mercadoCents: mercado, fonteMercado: v.valorAjustadoCents !== null ? "ajustado" : v.fipeValorCents !== null ? "FIPE" : null };
}
