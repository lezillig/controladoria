// TESTES DO RADAR DE LICITAÇÕES — `npm run teste:radar`.
//
// Os objetos abaixo vieram da primeira varredura real do PNCP (SP, 26 a
// 28/10/2026). Cada falso positivo que aparecer na tela vira um caso aqui
// antes de a regra mudar. Sem rede e sem banco.
import { classificar, tipoServicoProvavel } from "../src/lib/radar/aderencia";
import { dataDeBrasilia, paraRadar } from "../src/lib/radar/pncp";

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(
    `${ok ? "  ok  " : "FALHA "} ${nome}` +
      (ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         obtido   ${JSON.stringify(real)}`)
  );
}

const nivel = (o: string) => classificar(o)?.aderencia ?? null;

console.log("Serviço que a Azul presta: ALTA");
conferir("transporte escolar rural", nivel("CONTRATAÇÃO DE SERVIÇOS DE TRANSPORTE ESCOLAR RURAL"), "ALTA");
conferir("transporte de alunos", nivel("CONTRATAÇÃO DE EMPRESA ESPECIALIZADA NA PRESTAÇÃO DE SERVIÇOS DE TRANSPORTE DE ALUNOS"), "ALTA");
conferir("transporte de pacientes abreviado", nivel("Contrat. de Empresa p/ Serviço de Transporte de Pacientes"), "ALTA");
conferir(
  "transporte sanitário com condutor",
  nivel("prestação de serviços contínuos de transporte sanitário, incluindo a disponibilização de veículos com condutor"),
  "ALTA"
);
conferir("fretamento", nivel("Fretamento contínuo de ônibus para colaboradores"), "ALTA");

console.log("Compra, insumo e acessório: fora");
conferir("aquisição de 01 (um) veículo", nivel("Aquisição de 01 (um) veículo, tipo SUV mini van de 07 (sete) lugares, zero-quilômetro"), null);
conferir("micro-ônibus escolar novo 0km", nivel("AQUISIÇÃO DE UM MICRO-ÔNIBUS ESCOLAR, NOVO, 0KM, DESTINADO AO TRANSPORTE COLETIVO DE ESTUDANTES"), null);
conferir(
  "compra que cita serviço de transporte de servidores",
  nivel("Aquisição de 02 (dois) veículos tipo minibus, destinados à incorporação na frota municipal para os serviços de transporte de servidores"),
  null
);
conferir("seguro da frota do transporte escolar", nivel("Contratação de Seguro para veículos da frota do Transporte Escolar"), null);
conferir("ar condicionado para van", nivel("Ar Condicionado - Veículo Modelo: Teto , Aplicação: Van"), null);
conferir("abrigos de ônibus", nivel("AQUISIÇÃO E INSTALAÇÃO DE ABRIGOS DE ÔNIBUS PARA PASSAGEIROS"), null);
conferir("combustível do transporte de pacientes", nivel("Fornecimento de combustível para os veículos do transporte de pacientes"), null);
conferir("objeto sem relação", nivel("Aquisição de material de escritório"), null);

console.log("Só cita veículo: MEDIA");
conferir("locação de ônibus com mão de obra vale um olhar", nivel("RP LOC MAQ CAMINHOES E ONIBUS C FORN MAO DE OBRA E COMBUST P HORA PRODUTIVA"), "MEDIA");
conferir("locação de vans", nivel("Locação de vans para a Secretaria de Esportes"), "MEDIA");
conferir("palavra dentro de outra não conta (vanguarda)", nivel("Serviços de vanguarda tecnológica"), null);

console.log("Tipo de serviço do estudo");
conferir("escolar", tipoServicoProvavel("transporte escolar rural"), "ESCOLAR");
conferir("saúde", tipoServicoProvavel("transporte sanitário de pacientes"), "SAUDE");
conferir("locação com motorista", tipoServicoProvavel("locação de veículos com motorista"), "LOCACAO_CM");
conferir("o resto é fretamento", tipoServicoProvavel("transporte de servidores"), "FRETAMENTO");

console.log("Leitura do registro do PNCP");
conferir("data sem fuso é de Brasília", dataDeBrasilia("2026-11-09T10:00:00")?.toISOString(), "2026-11-09T13:00:00.000Z");
const r = paraRadar(
  {
    numeroControlePNCP: "46395000000139-1-000123/2026",
    orgaoEntidade: { cnpj: "46.395.000/0001-39", razaoSocial: "MUNICIPIO X" },
    unidadeOrgao: { ufSigla: "SP", municipioNome: "Guaíra" },
    anoCompra: 2026,
    sequencialCompra: 123,
    objetoCompra: "CONTRATAÇÃO DE SERVIÇOS DE TRANSPORTE ESCOLAR RURAL",
    valorTotalEstimado: 25_000_000.5,
    dataPublicacaoPncp: "2026-10-27T08:00:00",
    dataEncerramentoProposta: "2026-11-16T11:50:00",
  },
  "Pregão eletrônico"
);
conferir(
  "normaliza chave, link, valor em centavos e prazo",
  r && [r.orgaoCnpj, r.urlPncp, String(r.valorEstimadoCents), r.encerramentoPropostaEm?.toISOString(), r.modalidade],
  ["46395000000139", "https://pncp.gov.br/app/editais/46395000000139/2026/123", "2500000050", "2026-11-16T14:50:00.000Z", "Pregão eletrônico"]
);
conferir("objeto fora do radar não é gravado", paraRadar({ numeroControlePNCP: "x", orgaoEntidade: { cnpj: "1" }, objetoCompra: "Pneus", dataPublicacaoPncp: "2026-10-27T08:00:00" }, "x"), null);

if (falhas > 0) {
  console.log(`\n${falhas} falha(s).`);
  process.exit(1);
}
console.log("\nTodos os casos passaram.");
