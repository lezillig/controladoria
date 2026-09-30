// PLANILHA DE EXEMPLO — `npx tsx scripts/exemplo-planilha.ts <saída.xlsx>`.
// Um estudo inventado (4 itens de van executiva, dados simulados) passado pela
// mesma exportação da tela, para mostrar o modelo do que o estudo exporta.
import { writeFileSync } from "node:fs";
import { gerarPlanilhaSimulacao } from "../src/lib/simulador/exportarXlsx";
import { simular } from "../src/lib/simulador/motor";
import { PERFIS_PADRAO, PREMISSAS_PADRAO } from "../src/lib/simulador/premissas";
import type { EntradaSimulacao, Rota } from "../src/lib/simulador/tipos";

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

(async () => {
  const buffer = await gerarPlanilhaSimulacao({
    edital: { numero: "Vans executivas — EXEMPLO", orgao: "Cliente exemplo (dados simulados)", municipio: "São Paulo", uf: "SP", objeto: "Fretamento contínuo de vans executivas — EXEMPLO COM DADOS SIMULADOS", dataSessao: null, plataforma: null },
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
  console.log(r.itens.map((i) => `${i.item}: ${i.precoUnidade.toFixed(2)} R$/veículo-mês, margem ${((i.margem ?? 0) * 100).toFixed(1)}%`).join("\n"));
})();
