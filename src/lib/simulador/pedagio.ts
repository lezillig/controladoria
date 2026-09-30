import { CATEGORIA_DO_TIPO, MULTIPLICADOR_PEDAGIO, type CategoriaPedagio, type PerfilVeiculo } from "./tipos";

// A TARIFA DE UMA PRAÇA PARA UM TIPO DE VEÍCULO.
//
// A base guarda, por praça, a tarifa de carro/van de rodagem simples, de
// micro, de ônibus de 2 e de 3 eixos, e o desconto da tag. A coluna usada é a
// da categoria do tipo de veículo; faltando a coluna, a tarifa de rodagem
// simples vezes o multiplicador da categoria (é assim que as praças cobram).

export type PracaPedagio = {
  chave: string;
  praca: string;
  concessionaria: string | null;
  tarifaVan: number | null;
  tarifaMicro: number | null;
  tarifaOnibus2: number | null;
  tarifaOnibus3: number | null;
  descontoTagPct: number | null;
};

export function categoriaPedagioDe(p: PerfilVeiculo | null | undefined): CategoriaPedagio {
  if (!p) return "DOIS_EIXOS";
  if (p.categoriaPedagio) return p.categoriaPedagio;
  const c = CATEGORIA_DO_TIPO[p.tipo];
  return c === "CARRO" || c === "VAN" ? "RODAGEM_SIMPLES" : "DOIS_EIXOS";
}

export function tarifaDaPraca(praca: PracaPedagio, categoria: CategoriaPedagio, micro = false): number | null {
  const base = praca.tarifaVan;
  const direta =
    categoria === "RODAGEM_SIMPLES"
      ? praca.tarifaVan
      : categoria === "TRES_EIXOS"
        ? praca.tarifaOnibus3
        : micro
          ? (praca.tarifaMicro ?? praca.tarifaOnibus2)
          : (praca.tarifaOnibus2 ?? praca.tarifaMicro);
  const tarifa = direta ?? (base !== null ? base * MULTIPLICADOR_PEDAGIO[categoria] : null);
  if (tarifa === null) return null;
  return Number((tarifa * (1 - (praca.descontoTagPct ?? 0))).toFixed(2));
}

export function tarifaParaPerfil(praca: PracaPedagio, perfil: PerfilVeiculo | null | undefined): number | null {
  return tarifaDaPraca(praca, categoriaPedagioDe(perfil), perfil ? CATEGORIA_DO_TIPO[perfil.tipo] === "MICRO" : false);
}
