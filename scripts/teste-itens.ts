// Itens do estudo: os que nascem com o formulário, as rotas iniciais que
// apontam o perfil do tipo, e a duplicação de um item com as rotas dele.
import { itensIniciais, perfilDasRotasNovas } from "../src/lib/simulador/estudos";
import { codigoLivre, duplicarItem } from "../src/lib/simulador/itens";
import { PERFIS_PADRAO, PREMISSAS_PADRAO, type MapaOrigem } from "../src/lib/simulador/premissas";
import { ajustadasNoEstudo, perfisAjustados, voltarABase } from "../src/lib/simulador/voltarABase";
import { historicoSaoJoseDosPinhais } from "../src/lib/simulador/historico";

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const passou = JSON.stringify(real) === JSON.stringify(esperado);
  if (!passou) falhas++;
  console.log(`  ${passou ? "ok  " : "FALHA"} ${nome}${passou ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         obtido   ${JSON.stringify(real)}`}`);
}

console.log("ITENS INICIAIS");
const vazio = itensIniciais({ nome: "Estudo X", tipoServico: "FRETAMENTO", itens: [] });
conferir("sem itens: um item com o nome do estudo e nenhuma rota", [vazio.itens.map((i) => i.descricao), vazio.rotas.length], [["Estudo X"], 0]);
const linhaEmBranco = itensIniciais({ nome: "Estudo X", tipoServico: "FRETAMENTO", itens: [{ descricao: "  ", veiculos: 1, km: null }] });
conferir("linha em branco conta como nenhuma", linhaEmBranco.itens.map((i) => i.descricao), ["Estudo X"]);

const quatro = itensIniciais({
  nome: "Vans",
  tipoServico: "FRETAMENTO",
  tiposVeiculo: ["VAN"],
  itens: [
    { descricao: "Lote 1", tipoVeiculo: "VAN", veiculos: 4, km: 8800, precoMaximoKm: 9.5 },
    { descricao: "", tipoVeiculo: null, veiculos: 2, km: 4400, precoMaximoKm: null },
    { descricao: "Lote 3", tipoVeiculo: "ONIBUS", veiculos: 1, km: null, precoMaximoKm: 0 },
  ],
});
conferir("três itens com códigos 1..3", quatro.itens.map((i) => [i.codigo, i.descricao]), [["1", "Lote 1"], ["2", "Item 2"], ["3", "Lote 3"]]);
conferir("preço máximo zero vira sem teto", quatro.itens.map((i) => ("precoMaximoKm" in i ? i.precoMaximoKm : null)), [9.5, null, null]);
conferir("rota só para item com km", quatro.rotas.map((r) => r.itemCodigo), ["1", "2"]);
const fuVan = PERFIS_PADRAO.find((p) => p.tipo === "VAN")!.motorista.motoristasPorVeiculo;
conferir("rota do item 1: km, km/dia em 22 dias, motoristas pelo tipo", [quatro.rotas[0].kmReferencia, quatro.rotas[0].kmDia, quatro.rotas[0].motoristas, quatro.rotas[0].perfilVeiculo], [8800, 400, Math.round(4 * fuVan * 100) / 100, "VAN"]);
conferir("sem tipo na linha: o principal do estudo", quatro.rotas[1].perfilVeiculo, "VAN");
const locacao = itensIniciais({ nome: "L", tipoServico: "LOCACAO_SM", itens: [{ descricao: "a", km: 1000, veiculos: 2 }] });
conferir("locação sem motorista: item e rota sem motoristas", [locacao.itens[0].comMotorista, locacao.rotas[0].motoristas], [false, 0]);
conferir("locação sem motorista: o cliente abastece", locacao.itens[0].combustivelPorContaDoCliente, true);
// Escolar: as férias caem no recesso — 1,07 motorista por veículo, não 1,2.
const escolar = itensIniciais({ nome: "E", tipoServico: "ESCOLAR", itens: [{ descricao: "linha", km: 20000, veiculos: 10, tipoVeiculo: "VAN" }] } as never);
conferir("escolar: 10 vans × 1,07 motorista", escolar.rotas[0].motoristas, 10.7);
conferir("fretamento: a contratada abastece", quatro.itens[0].combustivelPorContaDoCliente, false);
const franquia = itensIniciais({ nome: "L", tipoServico: "LOCACAO_SM", itens: [{ descricao: "carro", km: null, veiculos: 1 }] });
conferir("locação sem km informado: nasce com a franquia de 2.000 km/mês", franquia.rotas.map((r) => r.kmReferencia), [2000]);
const franquia3 = itensIniciais({ nome: "L", tipoServico: "LOCACAO_SM", itens: [{ descricao: "carros", km: null, veiculos: 3 }] });
conferir("franquia por carro: 3 carros × 2.000 km", franquia3.rotas.map((r) => r.kmReferencia), [6000]);
const semFranquia = itensIniciais({ nome: "F", tipoServico: "FRETAMENTO", itens: [{ descricao: "linha", km: null, veiculos: 1 }] });
conferir("com motorista e sem km: sem rota (como antes)", semFranquia.rotas.length, 0);

console.log("\nPERFIL DAS ROTAS NOVAS");
const rotaBase = historicoSaoJoseDosPinhais().entrada.rotas[0];
const perfis = [
  { ...structuredClone(PERFIS_PADRAO.find((p) => p.tipo === "VAN")!), codigo: "BASE-1" },
  { ...structuredClone(PERFIS_PADRAO.find((p) => p.tipo === "ONIBUS")!), codigo: "BASE-2" },
];
perfis[1].motorista.motoristasPorVeiculo = 2;
const remapeadas = perfilDasRotasNovas(
  [
    { ...rotaBase, perfilVeiculo: "ONIBUS", veiculos: 3, motoristas: 1 },
    { ...rotaBase, perfilVeiculo: "BASE-1" },
    { ...rotaBase, perfilVeiculo: null },
    { ...rotaBase, perfilVeiculo: "ONIBUS", veiculos: 3, motoristas: 0 },
  ],
  perfis
);
conferir("tipo vira o código do perfil da base, com os motoristas dele", [remapeadas[0].perfilVeiculo, remapeadas[0].motoristas], ["BASE-2", 6]);
conferir("código que já existe e rota sem perfil ficam como estão", [remapeadas[1].perfilVeiculo, remapeadas[2].perfilVeiculo], ["BASE-1", null]);
conferir("rota sem motoristas (locação) continua sem", remapeadas[3].motoristas, 0);
conferir("tipo sem perfil cai no primeiro", perfilDasRotasNovas([{ ...rotaBase, perfilVeiculo: "CARRO" }], perfis)[0].perfilVeiculo, "BASE-1");

console.log("\nDUPLICAR ITEM");
const e = structuredClone(historicoSaoJoseDosPinhais().entrada);
const rotasDo1 = e.rotas.filter((r) => r.item === e.itens[0].codigo).length;
const totalAntes = e.rotas.length;
const novo = duplicarItem(e, 0);
conferir("cópia logo depois do original, com código novo", [e.itens[1].codigo, e.itens[1].descricao.endsWith("(cópia)"), e.itens.filter((i) => i.codigo === novo).length], [novo, true, 1]);
conferir("as rotas do original são copiadas para o item novo", [e.rotas.length, e.rotas.filter((r) => r.item === novo).length], [totalAntes + rotasDo1, rotasDo1]);
conferir("códigos continuam únicos", new Set(e.itens.map((i) => i.codigo)).size, e.itens.length);
conferir("índice inexistente não mexe", duplicarItem(e, 99), null);
conferir("código livre pula os usados", codigoLivre([{ codigo: "1" }, { codigo: "3" }]), "4");

console.log("\nVOLTAR À BASE");
{
  const base = structuredClone(historicoSaoJoseDosPinhais().entrada);
  base.premissas = { ...structuredClone(PREMISSAS_PADRAO), perfis: [structuredClone(PERFIS_PADRAO.find((p) => p.tipo === "VAN")!)] };
  const daBase = { premissas: base.premissas, origem: { "variaveis.dieselLitro": { origem: "BASE", fonte: "base Azul Mob" } } as MapaOrigem };
  const estudo = structuredClone(base);
  estudo.premissas.pessoal.salarioMotorista = 2400;
  estudo.premissas.preco.lucroAlvoPct = 0.2;
  estudo.premissas.variaveis.dieselLitro = 7.1;
  estudo.premissas.contrato.mesesCustoFixo = 12;
  estudo.premissas.perfis![0].motorista.salario = 2400;
  const origem: MapaOrigem = {
    "pessoal.salarioMotorista": { origem: "AJUSTE", fonte: "ajuste no estudo" },
    "preco.lucroAlvoPct": { origem: "AJUSTE", fonte: "ajuste no estudo" },
    "variaveis.dieselLitro": { origem: "REAL", fonte: "cartão de combustível" },
    "contrato.mesesCustoFixo": { origem: "PADRAO", fonte: "padrão do simulador" },
  };
  conferir(
    "todas: ajustadas e diferentes da base; o custo real fica",
    ajustadasNoEstudo(estudo, origem, daBase).sort(),
    ["contrato.mesesCustoFixo", "pessoal.salarioMotorista", "preco.lucroAlvoPct"]
  );
  conferir("tipo de veículo com salário mudado", perfisAjustados(estudo, daBase), [PERFIS_PADRAO.find((p) => p.tipo === "VAN")!.codigo]);
  const uma = structuredClone(estudo);
  const r1 = voltarABase(uma, origem, daBase, ["preco.lucroAlvoPct"]);
  conferir(
    "uma premissa: só ela volta, com a origem da base (sem origem, sai do mapa)",
    [uma.premissas.preco.lucroAlvoPct, uma.premissas.pessoal.salarioMotorista, r1.premissas, "preco.lucroAlvoPct" in r1.origem, uma.premissas.perfis![0].motorista.salario],
    [PREMISSAS_PADRAO.preco.lucroAlvoPct, 2400, 1, false, 2400]
  );
  const todas = structuredClone(estudo);
  const r2 = voltarABase(todas, origem, daBase);
  conferir(
    "todas: premissas e tipos voltam; diesel do custo real fica",
    [todas.premissas.pessoal.salarioMotorista, todas.premissas.contrato.mesesCustoFixo, todas.premissas.variaveis.dieselLitro, todas.premissas.perfis![0].motorista.salario, r2.premissas, r2.perfis, r2.origem["variaveis.dieselLitro"].origem],
    [PREMISSAS_PADRAO.pessoal.salarioMotorista, 1, 7.1, PERFIS_PADRAO.find((p) => p.tipo === "VAN")!.motorista.salario, 3, 1, "REAL"]
  );
  conferir("depois de voltar, nada mais a voltar", [ajustadasNoEstudo(todas, r2.origem, daBase), perfisAjustados(todas, daBase)], [[], []]);
  conferir("a base não é alterada", daBase.premissas.pessoal.salarioMotorista, PREMISSAS_PADRAO.pessoal.salarioMotorista);
}

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
