import { CATEGORIA_DO_TIPO, type CategoriaVeiculo, type FonteEnergia, type PerfilVeiculo } from "./tipos";

// ENERGIA DOS VEÍCULOS — diesel, gasolina, etanol, elétrico ou híbrido.
//
// Preço padrão por unidade (R$/l ou R$/kWh) e o consumo típico do elétrico por
// categoria. ESTIMATIVAS (set/2026) enquanto a base de custos não tem o
// número da empresa; ajustáveis em Custos base.
//
// Elétrico: a tarifa é a da recarga na garagem (energia comercial em média
// tensão, com impostos), não a de posto rápido. Consumo típico: carro
// ~6,5 km/kWh; van ~3,3; micro ~1,6; ônibus urbano ~0,85 (1,2 kWh/km).
//
// Híbrido: abastece com o combustível da categoria (carro a gasolina; van,
// micro e ônibus a diesel) e rende mais por litro — o motor elétrico recupera
// a energia da frenagem. Tem motor a combustão: óleo e filtros continuam, e a
// manutenção é a de dois sistemas.

// O HIBRIDO aqui é o carro (gasolina); o pesado híbrido usa o diesel — ver
// combustivelDoHibrido.
export const PRECO_ENERGIA_PADRAO: Record<FonteEnergia, number> = { DIESEL: 6.15, GASOLINA: 6.3, ETANOL: 4.3, ELETRICO: 0.95, HIBRIDO: 6.3 };

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

// Quanto o híbrido rende a mais por litro que o mesmo veículo a combustão,
// sem recarga na tomada: carro ~45% (11 → 16 km/l; King DM-i 16,8 km/l só
// gasolina, Inmetro); pesados ~20% (ônibus urbano híbrido). ESTIMATIVAS
// (out/2026), a calibrar com a frota.
export const FATOR_CONSUMO_HIBRIDO: Record<CategoriaVeiculo, number> = { CARRO: 1.45, VAN: 1.2, MICRO: 1.2, ONIBUS: 1.2 };
// Manutenção por km do híbrido: MAIS cara que a da combustão — são dois
// sistemas (motor a combustão + elétrico) e a revisão programada custa o
// dobro: R$ 0,13–0,15/km no King e no Song DM-i contra R$ 0,07/km de Onix
// Plus e HB20S (plano de manutenção BYD 2026; Vrum, mar/2026); a Energeely
// da Geely também dá revisão do EX5 EM-i acima da combustão. Sobre a
// manutenção toda por km (revisão + desgaste), +35%.
export const FATOR_MANUTENCAO_HIBRIDO = 1.35;

export const CONSUMO_ELETRICO_PADRAO: Record<CategoriaVeiculo, number> = { CARRO: 6.5, VAN: 3.3, MICRO: 1.6, ONIBUS: 0.85 };

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

// O híbrido sobre o mesmo veículo a combustão: rende mais por litro (o
// consumo SEM recarga na tomada — o plug-in recarregado todo dia roda boa
// parte no elétrico e gasta menos: ajuste no tipo), a manutenção é mais cara;
// ARLA só se o combustível for diesel.
export function doHibrido(v: PerfilVeiculo["variaveis"], categoria: CategoriaVeiculo, arlaDiesel: number): PerfilVeiculo["variaveis"] {
  const f = FATOR_CONSUMO_HIBRIDO[categoria];
  return {
    ...v,
    arlaKm: combustivelDoHibrido(categoria) === "DIESEL" ? arlaDiesel : 0,
    consumoAsfaltoKmL: arredondar(v.consumoAsfaltoKmL * f),
    consumoTerraKmL: arredondar(v.consumoTerraKmL * f),
    manutencaoAsfaltoKm: arredondar(v.manutencaoAsfaltoKm * FATOR_MANUTENCAO_HIBRIDO),
    manutencaoTerraKm: arredondar(v.manutencaoTerraKm * FATOR_MANUTENCAO_HIBRIDO),
  };
}

// Trocar a energia de um tipo de veículo: o preço passa a ser o da nova fonte;
// ARLA só existe no diesel; no elétrico, o consumo vira km/kWh da categoria e
// sai o que o elétrico não tem (óleo, filtros, parte da manutenção); no
// híbrido, o consumo e a manutenção do mesmo veículo a combustão com os
// fatores do híbrido. Sair do elétrico ou do híbrido desfaz os fatores.
export function trocarEnergia(p: PerfilVeiculo, energia: FonteEnergia, precos: Record<FonteEnergia, number>, arlaDiesel: number, oleoCombustao?: number): PerfilVeiculo {
  const novo = structuredClone(p);
  const antes = energiaDoPerfil(p);
  if (antes === energia) return novo;
  const categoria = CATEGORIA_DO_TIPO[p.tipo];
  // 1. De volta à combustão.
  if (antes === "ELETRICO") {
    if (oleoCombustao !== undefined) novo.variaveis.oleoLavagemKm = oleoCombustao;
    novo.variaveis.manutencaoAsfaltoKm = arredondar(p.variaveis.manutencaoAsfaltoKm / FATOR_MANUTENCAO_ELETRICO);
    novo.variaveis.manutencaoTerraKm = arredondar(p.variaveis.manutencaoTerraKm / FATOR_MANUTENCAO_ELETRICO);
    novo.variaveis.pneusAsfaltoKm = arredondar(p.variaveis.pneusAsfaltoKm / FATOR_PNEUS_ELETRICO);
    novo.variaveis.pneusTerraKm = arredondar(p.variaveis.pneusTerraKm / FATOR_PNEUS_ELETRICO);
  }
  if (antes === "HIBRIDO") {
    const f = FATOR_CONSUMO_HIBRIDO[categoria];
    novo.variaveis.consumoAsfaltoKmL = arredondar(p.variaveis.consumoAsfaltoKmL / f);
    novo.variaveis.consumoTerraKmL = arredondar(p.variaveis.consumoTerraKmL / f);
    novo.variaveis.manutencaoAsfaltoKm = arredondar(p.variaveis.manutencaoAsfaltoKm / FATOR_MANUTENCAO_HIBRIDO);
    novo.variaveis.manutencaoTerraKm = arredondar(p.variaveis.manutencaoTerraKm / FATOR_MANUTENCAO_HIBRIDO);
  }
  // 2. Para a energia nova.
  novo.energia = energia;
  novo.variaveis.dieselLitro = precoDaEnergia(energia, categoria, precos);
  novo.variaveis.arlaKm = energia === "DIESEL" ? (antes === "DIESEL" ? p.variaveis.arlaKm : arlaDiesel) : 0;
  if (energia === "ELETRICO") {
    const km = CONSUMO_ELETRICO_PADRAO[categoria];
    novo.variaveis = semOQueOEletricoNaoTem(novo.variaveis);
    novo.variaveis.consumoAsfaltoKmL = km;
    novo.variaveis.consumoTerraKmL = Number((km * 0.85).toFixed(2));
  }
  if (energia === "HIBRIDO") novo.variaveis = doHibrido(novo.variaveis, categoria, antes === "DIESEL" ? p.variaveis.arlaKm : arlaDiesel);
  return novo;
}
