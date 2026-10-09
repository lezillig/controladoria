import { CAMPOS_PREMISSAS, escreverCaminho, type MapaOrigem } from "./premissas";
import { CATEGORIA_DO_TIPO, type PerfilVeiculo, type Premissas } from "./tipos";

// A PARTE DOS CUSTOS REAIS QUE RODA NO NAVEGADOR — o tipo do indicador e a
// aplicação dele às premissas. A coleta (custosReais.ts) consulta o banco e
// fica no servidor; aplicar um indicador é pura troca de valor com a origem
// marcada como REAL, e o editor do estudo faz isso sem ida ao servidor.

export const ROTULO_CONFIANCA: Record<Confianca, string> = { ALTA: "alta", MEDIA: "média", BAIXA: "baixa" };

export type Confianca = "ALTA" | "MEDIA" | "BAIXA";

export type IndicadorReal = {
  // O caminho da premissa ("variaveis.dieselLitro"), de uma premissa de perfil
  // por tipo de veículo ("perfil:VAN:variaveis.consumoAsfaltoKmL") ou de um
  // número só de REFERÊNCIA, que não é premissa ("referencia:kmPorVeiculoMes")
  // — este último informa a discussão, e `aplicarIndicadores` o ignora.
  caminho: string;
  rotulo: string;
  // Na unidade das premissas: reais (não centavos) e FRAÇÕES (0,07 = 7%).
  valor: number;
  unidade: string;
  // A conta, em português, com os números.
  base: string;
  periodo: string;
  // Registros (abastecimentos) ou meses que sustentam o número — o que for a
  // unidade natural do indicador; a `base` diz qual.
  amostra: number;
  confianca: Confianca;
  avisos: string[];
  // Só na manutenção por km: a idade média da frota ativa (anos) — a idade do
  // veículo cuja manutenção o número mede. Ausente sem o ano dos veículos.
  idadeDaFrota?: number;
};

// Uma categoria da Omie como entrou no DRE de cada mês.
// Leva às premissas os indicadores que a pessoa escolheu, marcando a origem
// REAL com a conta ao lado. Nada muda sem escolha: o indicador é uma oferta,
// e quem monta a proposta decide se o número medido serve àquele edital
// (a manutenção de uma frota velha não é a de uma frota nova).
//
// PERFIS: um indicador `perfil:VAN:…` vale para TODO perfil do tipo VAN, e a
// origem é gravada por perfil (`perfil:<código>:<campo>`), porque é o código
// que a rota aponta. Um indicador GLOBAL (`variaveis.manutencaoAsfaltoKm`)
// muda só o veículo padrão das premissas, e não os perfis — a média da frota
// inteira não é o número de nenhum tipo, e copiá-la para os perfis apagaria a
// diferença que eles existem para guardar.
//
// Os perfis voltam à parte, como em `perfisDaBase`; quem monta a simulação os
// põe em `premissas.perfis`. As entradas não são alteradas.
export function aplicarIndicadores(
  premissas: Premissas,
  perfis: PerfilVeiculo[],
  indicadores: IndicadorReal[],
  caminhosEscolhidos: string[],
  origemAtual: MapaOrigem = {}
): { premissas: Premissas; perfis: PerfilVeiculo[]; origem: MapaOrigem; aplicados: string[]; ignorados: string[] } {
  const novas = structuredClone(premissas);
  const novosPerfis = structuredClone(perfis);
  const origem: MapaOrigem = { ...origemAtual };
  const aplicados: string[] = [];
  const ignorados: string[] = [];
  const numericos = new Map(CAMPOS_PREMISSAS.filter((c) => c.tipo === "moeda" || c.tipo === "pct" || c.tipo === "numero").map((c) => [c.caminho, c]));

  for (const caminho of new Set(caminhosEscolhidos)) {
    const ind = indicadores.find((i) => i.caminho === caminho);
    if (!ind || !Number.isFinite(ind.valor)) {
      ignorados.push(caminho);
      continue;
    }
    const fonte = `custo real — ${ind.rotulo} (${ind.periodo}; confiança ${ROTULO_CONFIANCA[ind.confianca]})`;

    const doPerfil = /^perfil:([A-Z_]+):((veiculo|variaveis)\.(\w+))$/.exec(caminho);
    if (doPerfil) {
      const [, tipo, campo, grupo, chave] = doPerfil;
      // O indicador da categoria (medido em todas as vans) vale para as
      // variantes dela (van adaptada, van unidade móvel), salvo se a pessoa
      // escolheu também um indicador próprio da variante.
      // Preço e consumo medidos no cartão de combustível não servem ao
      // elétrico (R$/kWh e km/kWh) nem ao híbrido (rende mais por litro que
      // a frota medida): eles ficam de fora.
      const deCombustivel = /^variaveis\.(dieselLitro|consumoAsfaltoKmL|consumoTerraKmL|arlaKm)$/.test(campo);
      const alvos = novosPerfis.filter(
        (p) =>
          (p.tipo === tipo || (CATEGORIA_DO_TIPO[p.tipo] === tipo && !caminhosEscolhidos.includes(`perfil:${p.tipo}:${campo}`))) &&
          !(deCombustivel && (p.energia === "ELETRICO" || p.energia === "HIBRIDO"))
      );
      const grupoDe = (p: PerfilVeiculo) => p[grupo as "veiculo" | "variaveis"] as Record<string, unknown>;
      if (alvos.length === 0 || !numericos.has(campo) || typeof grupoDe(alvos[0])[chave] !== "number") {
        ignorados.push(caminho);
        continue;
      }
      for (const p of alvos) {
        grupoDe(p)[chave] = ind.valor;
        origem[`perfil:${p.codigo}:${campo}`] = { origem: "REAL", fonte, detalhe: ind.base };
      }
      aplicados.push(caminho);
      continue;
    }

    // Referências e caminhos que não são premissa numérica ficam de fora.
    if (!numericos.has(caminho)) {
      ignorados.push(caminho);
      continue;
    }
    escreverCaminho(novas, caminho, ind.valor);
    origem[caminho] = { origem: "REAL", fonte, detalhe: ind.base };
    aplicados.push(caminho);

    // A manutenção medida é a de uma frota com a idade dela e já traz a
    // corretiva que essa frota teve. Sem isto, o motor a corrigia pela curva
    // de idade a partir de 0 km (uma frota de 5 anos sairia ~1,4× mais cara)
    // e somava a corretiva por cima.
    if (caminho === "variaveis.manutencaoAsfaltoKm") {
      novas.variaveis.corretivaKm = 0;
      origem["variaveis.corretivaKm"] = { origem: "REAL", fonte, detalhe: "zerada: a manutenção medida já inclui a corretiva da frota" };
      if (ind.idadeDaFrota !== undefined) {
        novas.veiculo.idadeReferenciaManutencao = ind.idadeDaFrota;
        origem["veiculo.idadeReferenciaManutencao"] = { origem: "REAL", fonte, detalhe: `idade média da frota ativa: ${ind.idadeDaFrota.toLocaleString("pt-BR")} anos` };
      }
    }
  }

  return { premissas: novas, perfis: novosPerfis, origem, aplicados, ignorados };
}
