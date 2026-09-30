// TESTES DA LEITURA DO GABARITO E DA MONTAGEM DAS PREMISSAS —
// `npm run teste:gabarito`.
//
// O Gabarito do pacote veio EM BRANCO (só a linha de exemplo). O teste monta
// uma cópia preenchida a partir dos próprios exemplos — linha 6 copiada para a
// 7 nas abas tabulares, coluna "Exemplo" copiada para "SEU VALOR" nas de chave
// e valor — e confere que a leitura traz cada número e que as premissas da
// simulação passam a vir dele, com a origem certa.
//
// Sem banco.
import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import { baseDaLeitura, lerGabarito } from "../src/lib/simulador/gabarito";
import { CATALOGO_PARAMETROS, numeroDoTexto, todosOsNumeros } from "../src/lib/simulador/catalogo";
import { CAMPOS_PREMISSAS, PREMISSAS_PADRAO, lerCaminho, premissasDaBase, problemasNasPremissas } from "../src/lib/simulador/premissas";
import { simular } from "../src/lib/simulador/motor";
import { historicoSaoJoseDosPinhais } from "../src/lib/simulador/historico";

let falhas = 0;
function ok(nome: string, passou: boolean, detalhe = "") {
  if (!passou) falhas++;
  console.log(`${passou ? "  ok  " : "FALHA "} ${nome}${passou ? "" : `\n         ${detalhe}`}`);
}
function conferir(nome: string, real: unknown, esperado: unknown) {
  ok(nome, JSON.stringify(real) === JSON.stringify(esperado), `esperado ${JSON.stringify(esperado)}\n         obtido   ${JSON.stringify(real)}`);
}

const MODELO = "docs/simulador_custos_handoff/planilhas_referencia/Gabarito_Dados_Simulador_Custos_AzulMob.xlsx";

async function preenchidoComExemplos(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(readFileSync(MODELO) as unknown as ArrayBuffer);
  for (const nome of ["1_Frota", "2_MaoDeObra", "7_Pedagios_Rotas", "9_Historico_Contratos", "10_Mercado"]) {
    const ws = wb.getWorksheet(nome)!;
    ws.getRow(6).eachCell({ includeEmpty: false }, (cell, col) => {
      ws.getRow(7).getCell(col).value = cell.value;
    });
  }
  for (const nome of ["3_Jornada", "4_Indiretos", "5_Tributos_Financeiro", "6_Insumos", "8_Regras_Azul"]) {
    const ws = wb.getWorksheet(nome)!;
    ws.eachRow((row, n) => {
      if (n > 4 && row.getCell(5).value !== null) row.getCell(3).value = row.getCell(5).value;
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function principal() {
  console.log("NÚMEROS EM TEXTO");
  conferir("R$ 6,15", numeroDoTexto("R$ 6,15"), 6.15);
  conferir("primeiro número de 6 × R$ 1.150", numeroDoTexto("6 × R$ 1.150"), 6);
  conferir("todos: 6 × R$ 1.150", todosOsNumeros("6 × R$ 1.150"), [6, 1150]);
  conferir("0.18 com ponto", numeroDoTexto("0.18"), 0.18);
  conferir("0.045 não é milhar", numeroDoTexto("0.045"), 0.045);
  conferir("R$ 4,20; 4,5%", todosOsNumeros("R$ 4,20; 4,5%"), [4.2, 4.5]);
  conferir("10% / 10% / 15%", todosOsNumeros("10% / 10% / 15%"), [10, 10, 15]);
  conferir("sem número", numeroDoTexto("Lucro Presumido"), null);

  console.log("\nGABARITO EM BRANCO — lê sem erro e avisa o que falta");
  const vazio = await lerGabarito(readFileSync(MODELO));
  conferir("nenhum parâmetro, veículo ou função", [vazio.parametros.length, vazio.veiculos.length, vazio.funcoes.length], [0, 0, 0]);
  ok("avisa os essenciais vazios", vazio.avisos.filter((a) => a.includes("essencial")).length === CATALOGO_PARAMETROS.filter((d) => d.essencial).length, `${vazio.avisos.length} avisos`);
  ok("toda linha do catálogo existe no modelo", !vazio.avisos.some((a) => a.includes("não foi encontrada")), vazio.avisos.filter((a) => a.includes("não foi encontrada")).join(" · "));
  ok("toda coluna tabular existe no modelo", !vazio.avisos.some((a) => a.includes("não encontrada no cabeçalho")), vazio.avisos.filter((a) => a.includes("cabeçalho")).join(" · "));

  console.log("\nGABARITO PREENCHIDO COM OS EXEMPLOS");
  const leitura = await lerGabarito(await preenchidoComExemplos());
  const par = new Map(leitura.parametros.map((p) => [p.chave, p]));
  conferir("diesel", par.get("diesel_rs_l")?.valor, 6.15);
  conferir("margem alvo", par.get("margem_alvo")?.valor, 0.12);
  conferir("km morto", par.get("km_morto_pct")?.valor, 0.12);
  conferir("regime (texto)", par.get("regime")?.texto, "Lucro Presumido");
  conferir("prazo prefeituras", par.get("prazo_prefeituras")?.valor, 55);
  conferir("reserva por tipo (texto)", par.get("reserva_tecnica")?.texto, "10% / 10% / 15%");
  ok("todo parâmetro com exemplo foi lido", leitura.parametros.length >= 60, `${leitura.parametros.length} lidos`);
  conferir("um modelo de veículo", leitura.veiculos.length, 1);
  const van = leitura.veiculos[0].campos;
  conferir("van: tipo, modelo, ano", [van.tipo, van.modelo, van.ano], ["Van", "Sprinter 517 CDI 19+1", 2023]);
  conferir("van: FIPE, taxa, consumo", [van.valorFipe, van.taxaAa, van.consumoKmL], [285000, 0.18, 8.7]);
  conferir("van: pneus 6 × 1.150", [van.pneusQtde, van.pneuPreco], [6, 1150]);
  conferir("van: acessível", van.acessivel, false);
  conferir("uma função", leitura.funcoes.length, 1);
  conferir("função: salário e encargos", [leitura.funcoes[0].campos.salarioBase, leitura.funcoes[0].campos.encargosPct], [3450, 0.68]);
  conferir("uma praça de pedágio", leitura.pedagios.map((p) => p.campos.tarifaVan), [13.9]);
  conferir("referências: histórico e mercado", leitura.referencias.map((r) => r.aba).sort(), ["HISTORICO_CONTRATO", "MERCADO"]);

  console.log("\nPREMISSAS A PARTIR DA BASE");
  const base = baseDaLeitura(leitura, new Date(2026, 8, 30), "Gabarito teste");
  const { premissas, origem } = premissasDaBase(base, {
    veiculoId: base.veiculos[0].id,
    motoristaId: base.funcoes[0].id,
    clientePublico: true,
    escolar: false,
    baseLocal: true,
  });
  conferir("valor do veículo = FIPE", premissas.veiculo.valor, 285000);
  conferir("… com origem na base", origem["veiculo.valor"].origem, "BASE");
  // 2023, vende com 6 anos a 90% da FIPE: em 2026 faltam 3 anos → 10% ÷ 3.
  ok("depreciação econômica = (1 − 90%) ÷ 3 anos", Math.abs(premissas.veiculo.depreciacaoAa - 0.1 / 3) < 1e-9, `${premissas.veiculo.depreciacaoAa}`);
  conferir("seguro mensal = anual ÷ 12", premissas.veiculo.seguroMes, 650);
  ok("pneus = 6 × 1.150 ÷ 60.000", Math.abs(premissas.variaveis.pneusAsfaltoKm - 0.115) < 1e-9);
  conferir("benefícios = VR + cesta + VT + plano + seguro", premissas.pessoal.beneficiosPorFuncionario, 660 + 210 + 190 + 0 + 12);
  conferir("uniforme + exames", premissas.pessoal.uniformeEpiPorFuncionario, 100);
  conferir("prazo de órgão público", premissas.preco.prazoRecebimentoDias, 55);
  conferir("preposto local", premissas.pessoal.supervisaoMes, 9500);
  // (95.000 + 9.000 + 7.500 + 32.000 + 0 + 6.000) ÷ 3.200.000
  ok("administração = indiretos reais ÷ faturamento", Math.abs(premissas.indiretos.administracaoPct - 149500 / 3200000) < 1e-9, `${premissas.indiretos.administracaoPct}`);
  ok("ARLA = 4,20 × 4,5% ÷ 8,7 km/l", Math.abs(premissas.variaveis.arlaKm - (4.2 * 0.045) / 8.7) < 1e-9, `${premissas.variaveis.arlaKm}`);
  conferir("reserva: a do veículo (10%)", premissas.contrato.reservaTecnicaPct, 0.1);
  conferir("consumo em terra não está na base: padrão", origem["variaveis.consumoTerraKmL"].origem, "PADRAO");

  console.log("\nCOBERTURA — o formulário descreve toda premissa");
  const caminhos = Object.entries(PREMISSAS_PADRAO).flatMap(([g, campos]) => Object.keys(campos).map((k) => `${g}.${k}`));
  conferir("todo campo de Premissas tem descrição", caminhos.filter((c) => !CAMPOS_PREMISSAS.some((d) => d.caminho === c)), []);
  conferir("nenhuma descrição sem campo", CAMPOS_PREMISSAS.filter((d) => lerCaminho(PREMISSAS_PADRAO, d.caminho) === undefined).map((d) => d.caminho), []);
  conferir("padrão sem problemas", problemasNasPremissas(PREMISSAS_PADRAO), []);

  console.log("\nSIMULAÇÃO COM A BASE — as rotas de SJP, os custos do Gabarito");
  const sjp = historicoSaoJoseDosPinhais().entrada;
  const r = simular({ ...sjp, premissas });
  ok("simula e dá preço positivo", r.itens.every((i) => i.precoKm > 0), JSON.stringify(r.itens.map((i) => i.precoKm)));
  ok("margem perto do alvo da base (12%)", r.itens.every((i) => Math.abs((i.margem ?? 0) - 0.12) < 0.01));

  console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
  process.exit(falhas === 0 ? 0 : 1);
}
principal();
