import { CATEGORIA_DO_TIPO, type CategoriaVeiculo, type FonteEnergia, type PerfilVeiculo } from "./tipos";

// ENERGIA DOS VEÍCULOS — diesel, gasolina, etanol ou elétrico.
//
// Preço padrão por unidade (R$/l ou R$/kWh) e o consumo típico do elétrico por
// categoria. ESTIMATIVAS (set/2026) enquanto a base de custos não tem o
// número da empresa; ajustáveis em Custos base.
//
// Elétrico: a tarifa é a da recarga na garagem (energia comercial em média
// tensão, com impostos), não a de posto rápido. Consumo típico: carro
// ~6,5 km/kWh; van ~3,3; micro ~1,6; ônibus urbano ~0,85 (1,2 kWh/km).

export const PRECO_ENERGIA_PADRAO: Record<FonteEnergia, number> = { DIESEL: 6.15, GASOLINA: 6.3, ETANOL: 4.3, ELETRICO: 0.95 };

export const CHAVE_PRECO_ENERGIA: Record<FonteEnergia, string> = {
  DIESEL: "diesel_rs_l",
  GASOLINA: "gasolina_rs_l",
  ETANOL: "etanol_rs_l",
  ELETRICO: "energia_rs_kwh",
};

export const CONSUMO_ELETRICO_PADRAO: Record<CategoriaVeiculo, number> = { CARRO: 6.5, VAN: 3.3, MICRO: 1.6, ONIBUS: 0.85 };

export function energiaDoTexto(texto: string | null | undefined): FonteEnergia | null {
  const t = (texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/eletric|bateria|\bev\b|kwh/.test(t)) return "ELETRICO";
  if (/etanol|alcool/.test(t)) return "ETANOL";
  if (/gasolina|flex/.test(t)) return "GASOLINA";
  if (/diesel|s10|s-10|s500/.test(t)) return "DIESEL";
  return null;
}

export const energiaDoPerfil = (p: PerfilVeiculo): FonteEnergia => p.energia ?? "DIESEL";

// Trocar a energia de um tipo de veículo: o preço passa a ser o da nova fonte;
// ARLA só existe no diesel; no elétrico, o consumo vira km/kWh da categoria.
// O que a pessoa já tinha ajustado em manutenção, pneus e óleo fica — ela
// decide se o elétrico gasta menos ali.
export function trocarEnergia(p: PerfilVeiculo, energia: FonteEnergia, precos: Record<FonteEnergia, number>, arlaDiesel: number): PerfilVeiculo {
  const novo = structuredClone(p);
  const antes = energiaDoPerfil(p);
  novo.energia = energia;
  novo.variaveis.dieselLitro = precos[energia];
  novo.variaveis.arlaKm = energia === "DIESEL" ? (antes === "DIESEL" ? p.variaveis.arlaKm : arlaDiesel) : 0;
  if (energia === "ELETRICO" && antes !== "ELETRICO") {
    const km = CONSUMO_ELETRICO_PADRAO[CATEGORIA_DO_TIPO[p.tipo]];
    novo.variaveis.consumoAsfaltoKmL = km;
    novo.variaveis.consumoTerraKmL = Number((km * 0.85).toFixed(2));
  }
  return novo;
}
