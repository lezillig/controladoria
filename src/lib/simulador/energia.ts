import { CATEGORIA_DO_TIPO, type CategoriaVeiculo, type ConfigEletrico, type ConfigHibrido, type FonteEnergia, type PerfilVeiculo, type RotaHibrido, type TipoHibrido } from "./tipos";

// ENERGIA DOS VEÍCULOS — diesel, gasolina, etanol, elétrico ou híbrido.
//
// Preço padrão por unidade (R$/l ou R$/kWh) e o consumo típico do elétrico por
// categoria. ESTIMATIVAS (set/2026) enquanto a base de custos não tem o
// número da empresa; ajustáveis em Custos base.
//
// Elétrico: o preço por kWh é o MIX de onde ele recarrega (garagem, AC e DC
// públicas — ConfigEletrico); o padrão da base (energia_rs_kwh) é a tarifa da
// garagem. Consumo típico: carro ~6,5 km/kWh; van ~3,3; micro ~1,6; ônibus
// urbano ~0,78 (SPTrans, 1,19–1,27 kWh/km nos 12 m).
//
// Híbrido: abastece com o combustível da categoria (carro a gasolina; van,
// micro e ônibus a diesel) e rende mais por litro — o motor elétrico recupera
// a energia da frenagem. Tem motor a combustão: óleo e filtros continuam, e a
// manutenção é a de dois sistemas.

// O HIBRIDO aqui é o carro (gasolina); o pesado híbrido usa o diesel — ver
// combustivelDoHibrido.
// Elétrico: tarifa da GARAGEM — Enel SP B3 tarifa branca fora de ponta, com
// tributos, ~R$ 0,89/kWh (REH ANEEL 3.596/2026); o mix de recarga sobe isso.
export const PRECO_ENERGIA_PADRAO: Record<FonteEnergia, number> = { DIESEL: 6.15, GASOLINA: 6.3, ETANOL: 4.3, ELETRICO: 0.89, HIBRIDO: 6.3 };

export const CHAVE_PRECO_ENERGIA: Record<FonteEnergia, string> = {
  DIESEL: "diesel_rs_l",
  GASOLINA: "gasolina_rs_l",
  ETANOL: "etanol_rs_l",
  ELETRICO: "energia_rs_kwh",
  HIBRIDO: "gasolina_rs_l",
};

// O combustível que o híbrido põe no tanque, pela categoria.
export function combustivelDoHibrido(categoria: CategoriaVeiculo): "GASOLINA" | "DIESEL" {
  return categoria === "CARRO" ? "GASOLINA" : "DIESEL";
}

// O preço por unidade da energia de um tipo (o híbrido, o do seu combustível).
export function precoDaEnergia(energia: FonteEnergia, categoria: CategoriaVeiculo, precos: Record<FonteEnergia, number>): number {
  return energia === "HIBRIDO" ? precos[combustivelDoHibrido(categoria)] : precos[energia];
}

// HÍBRIDO SALVO ANTES DOS TIPOS (out/2026, versão de um fator só): consumo
// +45% no carro / +20% nos pesados e manutenção +35%. Só para desfazer.
const FATOR_CONSUMO_HIBRIDO_LEGADO: Record<CategoriaVeiculo, number> = { CARRO: 1.45, VAN: 1.2, MICRO: 1.2, ONIBUS: 1.2 };
const FATOR_MANUTENCAO_HIBRIDO_LEGADO = 1.35;

// QUANTO O HÍBRIDO RENDE A MAIS POR LITRO que o mesmo veículo a combustão,
// pelo tipo e pela rota — o ganho é da frenagem regenerativa, e some na
// estrada. Inmetro/PBEV, combinado 55% cidade + 45% estrada: Corolla Cross
// híbrido +52% cidade, +9% estrada; BYD Song Pro / King sem recarga +11%
// combinado, abaixo do flex na estrada; Fiat Bio-Hybrid (12 V) ~+6%.
// Pesados: sem dado brasileiro, o ônibus urbano híbrido ~+20%.
export const FATOR_CONSUMO_HIBRIDO: Record<TipoHibrido, { leve: Record<RotaHibrido, number>; pesado: Record<RotaHibrido, number> }> = {
  HEV: { leve: { URBANO: 1.5, MISTO: 1.3, RODOVIARIO: 1.07 }, pesado: { URBANO: 1.2, MISTO: 1.1, RODOVIARIO: 1.0 } },
  PHEV: { leve: { URBANO: 1.3, MISTO: 1.12, RODOVIARIO: 1.0 }, pesado: { URBANO: 1.15, MISTO: 1.05, RODOVIARIO: 1.0 } },
  MHEV: { leve: { URBANO: 1.1, MISTO: 1.06, RODOVIARIO: 1.0 }, pesado: { URBANO: 1.05, MISTO: 1.03, RODOVIARIO: 1.0 } },
};
// Manutenção sobre a da combustão: o Toyota híbrido tem revisão no nível do
// flex (R$ 0,08–0,09/km até 60 mil km); o plug-in BYD, 31–42% acima (dois
// sistemas, R$ 0,13–0,15/km); o leve, igual.
export const FATOR_MANUTENCAO_HIBRIDO: Record<TipoHibrido, number> = { HEV: 1.0, PHEV: 1.35, MHEV: 1.0 };
// Depreciação sobre a da combustão (FIPE 2025–26): Toyota híbrido perde menos
// (−6% a −15% no 1º ano); BYD plug-in perde mais (King −19%, Song Plus −18%).
export const FATOR_DEPRECIACAO_HIBRIDO: Record<TipoHibrido, number> = { HEV: 0.8, PHEV: 1.3, MHEV: 1.0 };
// Etanol rende ~70% da gasolina por litro.
export const RENDIMENTO_ETANOL = 0.7;
// Plug-in no elétrico: ~0,23 kWh/km no carro (King/Song DM-i).
export const KWH_KM_PHEV = 0.23;

// ELÉTRICO: depreciação sobre a da combustão — o compacto de alto volume
// (Dolphin Mini −3,6% no 1º ano) fica igual; o médio e o premium (Dolphin
// −14,8%, Seal −21,2%) perdem ~40% mais. Linha de corte: R$ 200 mil.
export const VALOR_ELETRICO_PREMIUM = 200_000;
export const fatorDepreciacaoEletrico = (valor: number) => (valor >= VALOR_ELETRICO_PREMIUM ? 1.4 : 1.0);
// Recarga pública em SP (2026): AC R$ 0,89–1,40/kWh; DC R$ 1,77–2,50.
export const TARIFA_AC_PUBLICA = 1.15;
export const TARIFA_DC_PUBLICA = 2.1;
// Mix padrão: 90% na garagem, 10% em DC pública (carro e van que voltam à
// base); carregador AC instalado por veículo (wallbox 7–22 kW, R$ 3,5–8 mil +
// instalação R$ 1,5–5 mil).
export const MIX_RECARGA_PADRAO = { garagemPct: 0.9, acPct: 0 };
export const CARREGADOR_POR_VEICULO_PADRAO = 7_000;

export function tarifaDoMix(c: Pick<ConfigEletrico, "garagemPct" | "acPct" | "tarifaGaragem" | "tarifaAc" | "tarifaDc">): number {
  const dc = Math.max(0, 1 - c.garagemPct - c.acPct);
  return Number((c.garagemPct * c.tarifaGaragem + c.acPct * c.tarifaAc + dc * c.tarifaDc).toFixed(4));
}

export const CONSUMO_ELETRICO_PADRAO: Record<CategoriaVeiculo, number> = { CARRO: 6.5, VAN: 3.3, MICRO: 1.6, ONIBUS: 0.78 };

export function energiaDoTexto(texto: string | null | undefined): FonteEnergia | null {
  const t = (texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/hibrid|hybrid|\bphev\b|\bhev\b|plug-?in|\bdm-?i\b/.test(t)) return "HIBRIDO";
  if (/eletric|bateria|\bev\b|kwh/.test(t)) return "ELETRICO";
  if (/etanol|alcool/.test(t)) return "ETANOL";
  if (/gasolina|flex/.test(t)) return "GASOLINA";
  if (/diesel|s10|s-10|s500/.test(t)) return "DIESEL";
  return null;
}

export const energiaDoPerfil = (p: PerfilVeiculo): FonteEnergia => p.energia ?? "DIESEL";

// O tipo de híbrido pelo texto do cadastro: plug-in (PHEV, DM-i, "plug-in"),
// leve (MHEV, 12/48 V, Bio-Hybrid) ou pleno (o resto).
export function tipoHibridoDoTexto(texto: string | null | undefined): TipoHibrido {
  const t = (texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/\bphev\b|plug-?in|\bdm-?[io]\b|em-?i\b/.test(t)) return "PHEV";
  if (/\bmhev\b|\b(12|48) ?v\b|bio-?hybrid|hibrido leve|mild/.test(t)) return "MHEV";
  return "HEV";
}

// O QUE O ELÉTRICO NÃO TEM: troca de óleo e filtros, ARLA, embreagem, correia,
// velas e escapamento; o freio regenerativo poupa pastilhas e discos. Óleo e
// lavagem vira só lavagem e consumíveis; a manutenção por km perde a parte
// desses itens (revisão programada R$ 0,04–0,05/km no Dolphin e no Yuan Pro,
// R$ 0,02–0,03 na MG, contra R$ 0,07 da combustão). O que ele gasta a MAIS:
// pneu — o carro é mais pesado e o torque é instantâneo (troca a cada 40–50
// mil km contra 60 mil: BYD Mais Gold; calculadoracarroeletrico). ESTIMATIVAS
// (out/2026), ajustáveis no tipo de veículo.
export const OLEO_LAVAGEM_ELETRICO_KM = 0.02;
export const FATOR_MANUTENCAO_ELETRICO = 0.7;
export const FATOR_PNEUS_ELETRICO = 1.2;

const arredondar = (v: number) => Number(v.toFixed(4));

// Tira do tipo elétrico o que ele não tem (sobre os valores a combustão).
export function semOQueOEletricoNaoTem(v: PerfilVeiculo["variaveis"]): PerfilVeiculo["variaveis"] {
  return {
    ...v,
    arlaKm: 0,
    oleoLavagemKm: Math.min(v.oleoLavagemKm, OLEO_LAVAGEM_ELETRICO_KM),
    manutencaoAsfaltoKm: arredondar(v.manutencaoAsfaltoKm * FATOR_MANUTENCAO_ELETRICO),
    manutencaoTerraKm: arredondar(v.manutencaoTerraKm * FATOR_MANUTENCAO_ELETRICO),
    pneusAsfaltoKm: arredondar(v.pneusAsfaltoKm * FATOR_PNEUS_ELETRICO),
    pneusTerraKm: arredondar(v.pneusTerraKm * FATOR_PNEUS_ELETRICO),
  };
}

// O HÍBRIDO SOBRE O VEÍCULO A COMBUSTÃO. O plug-in recarregado vira um
// consumo EQUIVALENTE em km/l: o custo por km é a mistura do litro e do kWh,
// convertida de volta ao preço do litro (mostra o "30 km/l" que a BYD anuncia).
export function configHibridoPadrao(categoria: CategoriaVeiculo, precos: Record<FonteEnergia, number>): ConfigHibrido {
  return {
    tipo: "HEV",
    rota: "URBANO",
    combustivel: combustivelDoHibrido(categoria),
    pctEletrico: 0,
    kwhKm: categoria === "CARRO" ? KWH_KM_PHEV : 0,
    tarifaKwh: precos.ELETRICO,
    fatorConsumo: 1,
    fatorManutencao: 1,
    fatorDepreciacao: 1,
  };
}

export function aplicarHibrido(p: PerfilVeiculo, cfg: Omit<ConfigHibrido, "fatorConsumo" | "fatorManutencao" | "fatorDepreciacao">, precos: Record<FonteEnergia, number>, arlaDiesel: number): PerfilVeiculo {
  const novo = structuredClone(p);
  const categoria = CATEGORIA_DO_TIPO[p.tipo];
  const leve = categoria === "CARRO";
  const combustivel = leve ? (cfg.combustivel === "DIESEL" ? "GASOLINA" : cfg.combustivel) : "DIESEL";
  const preco = precos[combustivel];
  const fRota = FATOR_CONSUMO_HIBRIDO[cfg.tipo][leve ? "leve" : "pesado"][cfg.rota];
  const fCombustivel = combustivel === "ETANOL" ? RENDIMENTO_ETANOL : 1;
  const pct = cfg.tipo === "PHEV" ? Math.min(1, Math.max(0, cfg.pctEletrico)) : 0;
  const base = p.variaveis.consumoAsfaltoKmL;
  const consumoHibrido = base * fRota * fCombustivel;
  const custoKm = (1 - pct) * (consumoHibrido > 0 ? preco / consumoHibrido : 0) + pct * cfg.kwhKm * cfg.tarifaKwh;
  const consumoEquivalente = custoKm > 0 ? preco / custoKm : consumoHibrido;
  const fatorConsumo = base > 0 ? consumoEquivalente / base : 1;
  const fatorManutencao = FATOR_MANUTENCAO_HIBRIDO[cfg.tipo];
  const fatorDepreciacao = FATOR_DEPRECIACAO_HIBRIDO[cfg.tipo];
  novo.energia = "HIBRIDO";
  novo.variaveis.dieselLitro = preco;
  novo.variaveis.arlaKm = combustivel === "DIESEL" ? arredondar(arlaDiesel * (1 - pct)) : 0;
  novo.variaveis.consumoAsfaltoKmL = arredondar(p.variaveis.consumoAsfaltoKmL * fatorConsumo);
  novo.variaveis.consumoTerraKmL = arredondar(p.variaveis.consumoTerraKmL * fatorConsumo);
  novo.variaveis.manutencaoAsfaltoKm = arredondar(p.variaveis.manutencaoAsfaltoKm * fatorManutencao);
  novo.variaveis.manutencaoTerraKm = arredondar(p.variaveis.manutencaoTerraKm * fatorManutencao);
  novo.veiculo.depreciacaoAa = arredondar(p.veiculo.depreciacaoAa * fatorDepreciacao);
  novo.hibrido = { ...cfg, combustivel, pctEletrico: pct, fatorConsumo, fatorManutencao, fatorDepreciacao };
  return novo;
}

// Volta o híbrido ao veículo a combustão (sem trocar a energia).
export function desfazerHibrido(p: PerfilVeiculo): PerfilVeiculo {
  const novo = structuredClone(p);
  const categoria = CATEGORIA_DO_TIPO[p.tipo];
  const fc = p.hibrido?.fatorConsumo ?? FATOR_CONSUMO_HIBRIDO_LEGADO[categoria];
  const fm = p.hibrido?.fatorManutencao ?? FATOR_MANUTENCAO_HIBRIDO_LEGADO;
  const fd = p.hibrido?.fatorDepreciacao ?? 1;
  novo.variaveis.consumoAsfaltoKmL = arredondar(p.variaveis.consumoAsfaltoKmL / fc);
  novo.variaveis.consumoTerraKmL = arredondar(p.variaveis.consumoTerraKmL / fc);
  novo.variaveis.manutencaoAsfaltoKm = arredondar(p.variaveis.manutencaoAsfaltoKm / fm);
  novo.variaveis.manutencaoTerraKm = arredondar(p.variaveis.manutencaoTerraKm / fm);
  novo.veiculo.depreciacaoAa = arredondar(p.veiculo.depreciacaoAa / fd);
  delete novo.hibrido;
  return novo;
}

// Mudar tipo, rota, combustível ou recarga de um híbrido já montado.
export function reconfigurarHibrido(p: PerfilVeiculo, mudanca: Partial<ConfigHibrido>, precos: Record<FonteEnergia, number>, arlaDiesel: number): PerfilVeiculo {
  const categoria = CATEGORIA_DO_TIPO[p.tipo];
  const atual = p.hibrido ?? configHibridoPadrao(categoria, precos);
  const base = desfazerHibrido(p);
  return aplicarHibrido(base, { ...atual, ...mudanca }, precos, arlaDiesel);
}

// O ELÉTRICO SOBRE O VEÍCULO A COMBUSTÃO: preço do kWh pelo mix de recarga,
// carregador somado às adaptações, depreciação pelo valor.
export function configEletricoPadrao(precos: Record<FonteEnergia, number>, valor: number): ConfigEletrico {
  return {
    ...MIX_RECARGA_PADRAO,
    tarifaGaragem: precos.ELETRICO,
    tarifaAc: TARIFA_AC_PUBLICA,
    tarifaDc: TARIFA_DC_PUBLICA,
    carregadorPorVeiculo: CARREGADOR_POR_VEICULO_PADRAO,
    fatorDepreciacao: fatorDepreciacaoEletrico(valor),
  };
}

function aplicarEletrico(novo: PerfilVeiculo, cfg: ConfigEletrico): void {
  novo.variaveis.dieselLitro = tarifaDoMix(cfg);
  novo.veiculo.adaptacaoValor = (novo.veiculo.adaptacaoValor ?? 0) + cfg.carregadorPorVeiculo;
  novo.veiculo.depreciacaoAa = arredondar(novo.veiculo.depreciacaoAa * cfg.fatorDepreciacao);
  novo.eletrico = cfg;
}

function desfazerEletrico(novo: PerfilVeiculo): void {
  const cfg = novo.eletrico;
  if (!cfg) return;
  novo.veiculo.adaptacaoValor = Math.max(0, (novo.veiculo.adaptacaoValor ?? 0) - cfg.carregadorPorVeiculo);
  novo.veiculo.depreciacaoAa = arredondar(novo.veiculo.depreciacaoAa / cfg.fatorDepreciacao);
  delete novo.eletrico;
}

// Mudar o mix de recarga ou o carregador de um elétrico já montado.
export function reconfigurarEletrico(p: PerfilVeiculo, mudanca: Partial<ConfigEletrico>, precos: Record<FonteEnergia, number>): PerfilVeiculo {
  const novo = structuredClone(p);
  const atual = p.eletrico ?? configEletricoPadrao(precos, p.veiculo.valor);
  desfazerEletrico(novo);
  aplicarEletrico(novo, { ...atual, ...mudanca, fatorDepreciacao: atual.fatorDepreciacao });
  return novo;
}

// Trocar a energia de um tipo de veículo: o preço passa a ser o da nova fonte;
// ARLA só existe no diesel; no elétrico, o consumo vira km/kWh da categoria e
// sai o que o elétrico não tem (óleo, filtros, parte da manutenção), com o mix
// de recarga, o carregador e a depreciação dele; no híbrido, o tipo, a rota e
// o combustível (configHibridoPadrao). Sair do elétrico ou do híbrido desfaz.
export function trocarEnergia(p: PerfilVeiculo, energia: FonteEnergia, precos: Record<FonteEnergia, number>, arlaDiesel: number, oleoCombustao?: number): PerfilVeiculo {
  const antes = energiaDoPerfil(p);
  if (antes === energia) return structuredClone(p);
  const categoria = CATEGORIA_DO_TIPO[p.tipo];
  // 1. De volta à combustão.
  const novo = antes === "HIBRIDO" ? desfazerHibrido(p) : structuredClone(p);
  if (antes === "ELETRICO") {
    if (oleoCombustao !== undefined) novo.variaveis.oleoLavagemKm = oleoCombustao;
    novo.variaveis.manutencaoAsfaltoKm = arredondar(p.variaveis.manutencaoAsfaltoKm / FATOR_MANUTENCAO_ELETRICO);
    novo.variaveis.manutencaoTerraKm = arredondar(p.variaveis.manutencaoTerraKm / FATOR_MANUTENCAO_ELETRICO);
    novo.variaveis.pneusAsfaltoKm = arredondar(p.variaveis.pneusAsfaltoKm / FATOR_PNEUS_ELETRICO);
    novo.variaveis.pneusTerraKm = arredondar(p.variaveis.pneusTerraKm / FATOR_PNEUS_ELETRICO);
    desfazerEletrico(novo);
  }
  // 2. Para a energia nova.
  if (energia === "HIBRIDO") {
    novo.energia = undefined;
    return aplicarHibrido(novo, configHibridoPadrao(categoria, precos), precos, antes === "DIESEL" ? p.variaveis.arlaKm : arlaDiesel);
  }
  novo.energia = energia;
  novo.variaveis.dieselLitro = precoDaEnergia(energia, categoria, precos);
  novo.variaveis.arlaKm = energia === "DIESEL" ? (antes === "DIESEL" ? p.variaveis.arlaKm : arlaDiesel) : 0;
  if (energia === "ELETRICO") {
    const km = CONSUMO_ELETRICO_PADRAO[categoria];
    novo.variaveis = semOQueOEletricoNaoTem(novo.variaveis);
    novo.variaveis.consumoAsfaltoKmL = km;
    novo.variaveis.consumoTerraKmL = Number((km * 0.85).toFixed(2));
    aplicarEletrico(novo, configEletricoPadrao(precos, novo.veiculo.valor));
  }
  return novo;
}
