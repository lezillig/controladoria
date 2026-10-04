import { CAMPOS_PREMISSAS, escreverCaminho, lerCaminho, type MapaOrigem } from "./premissas";
import type { EntradaSimulacao, Premissas } from "./tipos";

// VOLTAR À BASE — desfaz os ajustes de um estudo.
//
// O destino é o que um estudo NOVO teria hoje (premissasNovasDoEstudo): a base
// vigente da Azul Mob, o padrão do simulador onde a base está vazia, e as
// regras do tipo de serviço. Uma premissa volta com o valor e a origem da
// base; "todas" volta as que foram ajustadas no estudo ou ficaram diferentes
// da base de hoje, e os tipos de veículo que a base também tem (pelo código).
// O custo real aplicado de propósito (origem REAL) fica: é uma escolha
// medida, não um ajuste solto.

export type DaBase = { premissas: Premissas; origem: MapaOrigem };

const CAMINHO = /^[a-z]+\.[A-Za-z0-9]+$/;

function existeNaBase(base: Premissas, caminho: string): boolean {
  if (!CAMINHO.test(caminho)) return false;
  const [g] = caminho.split(".");
  if (!(g in base) || typeof (base as unknown as Record<string, unknown>)[g] !== "object") return false;
  return lerCaminho(base, caminho) !== undefined;
}

export function diferenteDaBase(entrada: EntradaSimulacao, origem: MapaOrigem, daBase: DaBase, caminho: string): boolean {
  if (!existeNaBase(daBase.premissas, caminho)) return false;
  return origem[caminho]?.origem === "AJUSTE" || lerCaminho(entrada.premissas, caminho) !== lerCaminho(daBase.premissas, caminho);
}

// As premissas que o "todas" volta: as ajustadas no estudo e as que ficaram
// diferentes da base de hoje (versão salva quando a base era outra — a
// administração central recalculada, o diesel novo). Menos o custo real.
export function ajustadasNoEstudo(entrada: EntradaSimulacao, origem: MapaOrigem, daBase: DaBase): string[] {
  const caminhos = new Set([...CAMPOS_PREMISSAS.map((c) => c.caminho), ...Object.keys(origem)]);
  return [...caminhos].filter((c) => origem[c]?.origem !== "REAL" && diferenteDaBase(entrada, origem, daBase, c));
}

// Os tipos de veículo do estudo que a base tem com o mesmo código e que
// mudaram (salário do motorista, valor do veículo, consumo…).
export function perfisAjustados(entrada: EntradaSimulacao, daBase: DaBase): string[] {
  const daBasePorCodigo = new Map((daBase.premissas.perfis ?? []).map((p) => [p.codigo, p]));
  return (entrada.premissas.perfis ?? []).filter((p) => {
    const b = daBasePorCodigo.get(p.codigo);
    return b !== undefined && JSON.stringify(b) !== JSON.stringify(p);
  }).map((p) => p.codigo);
}

// Aplica na entrada (mutável, dentro do `alterar` do editor) e devolve a
// origem nova. Sem `caminhos`, volta tudo o que foi ajustado.
export function voltarABase(
  entrada: EntradaSimulacao,
  origem: MapaOrigem,
  daBase: DaBase,
  caminhos?: string[]
): { origem: MapaOrigem; premissas: number; perfis: number } {
  const todas = caminhos === undefined;
  const alvo = (caminhos ?? ajustadasNoEstudo(entrada, origem, daBase)).filter((c) => existeNaBase(daBase.premissas, c));
  const nova: MapaOrigem = { ...origem };
  for (const c of alvo) {
    escreverCaminho(entrada.premissas, c, structuredClone(lerCaminho(daBase.premissas, c)));
    if (daBase.origem[c]) nova[c] = { ...daBase.origem[c] };
    else delete nova[c];
  }
  let perfis = 0;
  if (todas) {
    const codigos = new Set(perfisAjustados(entrada, daBase));
    const daBasePorCodigo = new Map((daBase.premissas.perfis ?? []).map((p) => [p.codigo, p]));
    entrada.premissas.perfis = (entrada.premissas.perfis ?? []).map((p) => {
      if (!codigos.has(p.codigo)) return p;
      perfis++;
      return structuredClone(daBasePorCodigo.get(p.codigo)!);
    });
  }
  return { origem: nova, premissas: alvo.length, perfis };
}
