// PLANILHA DE EXEMPLO — `npx tsx scripts/exemplo-planilha.ts <saída.xlsx> [KM|VEICULO_MES|BINOMIA|DIARIA|HORA|EVENTUAL]`.
// Um estudo inventado (4 itens de van executiva, dados simulados) passado pela
// mesma exportação da tela, para mostrar o modelo do que o estudo exporta.
import { writeFileSync } from "node:fs";
import { gerarPlanilhaSimulacao } from "../src/lib/simulador/exportarXlsx";
import { simular } from "../src/lib/simulador/motor";
import { PERFIS_PADRAO, PREMISSAS_PADRAO } from "../src/lib/simulador/premissas";
import type { EntradaSimulacao, Rota, UnidadePreco } from "../src/lib/simulador/tipos";

const criterio = (process.argv[3] ?? "VEICULO_MES").toUpperCase();

const van = structuredClone(PERFIS_PADRAO.find((p) => p.tipo === "VAN")!);
van.codigo = "VAN-EXEC";
van.descricao = "Van executiva 15 lugares (ar, poltronas reclináveis)";
van.veiculo.valor = 330000;
van.veiculo.seguroMes = 750;
van.motorista.salario = 3100;

const rota = (item: string, nome: string, kmMes: number, kmDia: number, veiculos: number, horasDia: number, noturno = false): Rota => ({
  item,
  nome,
  kmReferencia: kmMes,
  kmDia,
  kmTerraDia: 0,
  diasMes: 22,
  veiculos,
  motoristas: Number((veiculos * van.motorista.motoristasPorVeiculo).toFixed(1)),
  monitoras: 0,
  noturno,
  passagensPedagioMes: 0,
  tarifaPedagio: 0,
  horasDia,
  perfilVeiculo: van.codigo,
});

const entrada: EntradaSimulacao = {
  premissas: { ...structuredClone(PREMISSAS_PADRAO), perfis: [van] },
  criterio: "ITEM",
  unidadePreco: "VEICULO_MES",
  itens: [
    { codigo: "1", descricao: "Diretoria — traslados executivos", shareIntermunicipal: 0 },
    { codigo: "2", descricao: "Turnos administrativos — sede", shareIntermunicipal: 0 },
    { codigo: "3", descricao: "Aeroporto e rodoviária", shareIntermunicipal: 1 },
    { codigo: "4", descricao: "Eventos e visitas técnicas", shareIntermunicipal: 0.5 },
  ],
  rotas: [
    rota("1", "Diretoria — manhã e noite", 2600, 118, 2, 10),
    rota("2", "Turno A — bairros norte", 3300, 150, 1, 9),
    rota("2", "Turno B — bairros sul", 3100, 141, 1, 9, true),
    rota("3", "Aeroporto — ida e volta", 4400, 200, 1, 8),
    rota("4", "Eventos — agenda mensal", 1800, 82, 1, 8),
  ],
};
entrada.premissas.contrato.vigenciaMeses = 24;
if (criterio !== "EVENTUAL") entrada.unidadePreco = criterio as UnidadePreco;

// VIAGEM EVENTUAL: um ônibus executivo São Paulo–Santos, 2 dias, preço por
// diária; o custo fixo do mês se paga pelos dias vendidos (8 por mês).
if (criterio === "EVENTUAL") {
  const onibus = structuredClone(PERFIS_PADRAO.find((p) => p.tipo === "ONIBUS")!);
  onibus.codigo = "ONIBUS-EXEC";
  onibus.descricao = "Ônibus executivo 46 lugares";
  entrada.premissas.perfis = [onibus];
  entrada.premissas.contrato.utilizacao = 1;
  entrada.premissas.contrato.vigenciaMeses = 1;
  entrada.unidadePreco = "DIARIA";
  entrada.itens = [{ codigo: "1", descricao: "Viagem São Paulo–Santos (evento), ida e volta, 2 diárias", shareIntermunicipal: 1 }];
  entrada.rotas = [
    { item: "1", nome: "SP–Santos–SP, 8 diárias vendidas no mês", kmReferencia: 8 * 180, kmDia: 180, kmTerraDia: 0, diasMes: 8, veiculos: 1, motoristas: 1.2, monitoras: 0, noturno: false, passagensPedagioMes: 8, tarifaPedagio: 81.2, horasDia: 12, perfilVeiculo: onibus.codigo },
  ];
}

(async () => {
  const buffer = await gerarPlanilhaSimulacao({
    edital: { numero: criterio === "EVENTUAL" ? "Viagem eventual — EXEMPLO" : "Vans executivas — EXEMPLO", orgao: "Cliente exemplo (dados simulados)", municipio: "São Paulo", uf: "SP", objeto: "Fretamento contínuo de vans executivas — EXEMPLO COM DADOS SIMULADOS", dataSessao: null, plataforma: null },
    licitante: { razaoSocial: "Empresa proponente (exemplo)", cnpj: "" },
    esfera: "PRIVADO",
    comercial: { validadeProposta: "2026-10-31T00:00:00.000Z", inicioPrevisto: "2026-11-03T00:00:00.000Z", indiceReajuste: "IPCA", formaFaturamento: "Mensal", avisoRescisaoDias: 60 },
    regras: [],
    entrada,
    resultado: simular(entrada),
    versao: 1,
    geradoEm: new Date(),
  });
  writeFileSync(process.argv[2] ?? "exemplo.xlsx", buffer);
  const r = simular(entrada);
  console.log(r.itens.map((i) => `${i.item}: ${i.precoUnidade.toFixed(2)} (${r.unidade}), margem ${((i.margem ?? 0) * 100).toFixed(1)}%`).join("\n"));
})();
