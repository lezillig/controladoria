// TESTES DO MOTOR DO SIMULADOR DE CUSTOS — `npm run teste:simulador`.
//
// Critério de aceite da v1 (docs/simulador_custos_handoff/docs/ESPECIFICACAO,
// seção 7): reproduzir as duas simulações de referência — Holambra PE 036/2026
// e São José dos Pinhais PE 089/2026 — com tolerância de R$ 0,01 no preço/km e
// de 0,1% nos totais, a partir das sementes do pacote. Os números esperados
// vêm de testes/casos_de_teste_esperados.json, sem edição.
//
// Sem banco: o motor é puro.
import esperado from "../src/lib/simulador/historico/casos_de_teste_esperados.json";
import { historicoHolambra, historicoSaoJoseDosPinhais } from "../src/lib/simulador/historico";
import { arredondarParaCima, custoDeCapital, simular } from "../src/lib/simulador/motor";
import { PERFIS_PADRAO } from "../src/lib/simulador/premissas";
// validarEntrada é pura (estudos.ts só toca o banco nas outras funções).
import { validarEntrada } from "../src/lib/simulador/estudos";
import type { EntradaSimulacao } from "../src/lib/simulador/tipos";

let falhas = 0;
function ok(nome: string, passou: boolean, detalhe = "") {
  if (!passou) falhas++;
  console.log(`${passou ? "  ok  " : "FALHA "} ${nome}${passou ? "" : `\n         ${detalhe}`}`);
}
function conferir(nome: string, real: unknown, esperadoValor: unknown) {
  ok(nome, JSON.stringify(real) === JSON.stringify(esperadoValor), `esperado ${JSON.stringify(esperadoValor)}\n         obtido   ${JSON.stringify(real)}`);
}
// Preço/km: R$ 0,01. Totais: 0,1%. Custo/km (4 casas na planilha): 0,1%.
function perto(nome: string, real: number, alvo: number, tipo: "preco" | "total") {
  const passou = tipo === "preco" ? Math.abs(real - alvo) <= 0.01 + 1e-9 : Math.abs(real - alvo) <= Math.abs(alvo) * 0.001 + 1e-6;
  ok(nome, passou, `esperado ${alvo}, obtido ${real} (diferença ${(real - alvo).toFixed(6)})`);
}

console.log("ROUNDUP do Excel");
conferir("7,74 exato não sobe", arredondarParaCima(7.74), 7.74);
conferir("7,7401 sobe para 7,75", arredondarParaCima(7.7401), 7.75);
conferir("18,0046 sobe para 18,01", arredondarParaCima(18.0046), 18.01);
conferir("negativo afasta do zero", arredondarParaCima(-1.231), -1.24);

console.log("\nSEMENTES — nenhum número da planilha fica de fora");
for (const h of [historicoHolambra(), historicoSaoJoseDosPinhais()]) {
  const numericas = h.leitor.todas.filter((l) => typeof l.valor === "number").map((l) => l.item);
  const naoUsadas = numericas.filter((n) => !h.leitor.consumidos.has(n));
  conferir(`${h.edital.numero}: todo número da semente foi usado ou declarado derivado`, naoUsadas, []);
}

console.log("\nHOLAMBRA PE 036/2026 — 9 linhas, julgamento por item");
{
  const h = historicoHolambra();
  const r = simular(h.entrada);
  const casos = esperado.holambra.linhas;
  conferir("nove linhas", r.itens.length, casos.length);
  for (const caso of casos) {
    const item = r.itens.find((i) => i.item === String(caso.linha))!;
    const e = caso.esperado;
    perto(`linha ${caso.linha}: preço/km`, item.precoKm, e.preco_km, "preco");
    perto(`linha ${caso.linha}: custo total`, item.custoTotal, e.custo_total, "total");
    perto(`linha ${caso.linha}: custo/km`, item.custoKm, e.custo_km, "total");
    perto(`linha ${caso.linha}: valor total`, item.faturamento, e.valor_total, "total");
    perto(`linha ${caso.linha}: lucro líquido`, item.lucro, e.lucro_liquido, "total");
    conferir(`linha ${caso.linha}: preço de referência`, item.precoReferenciaKm, caso.preco_ref);
  }
  const t = esperado.holambra.totais_esperados;
  perto("total: valor da proposta", r.totais.faturamento, t.valor_proposta, "total");
  perto("total: custo", r.totais.custoTotal, t.custo_total, "total");
  perto("total: lucro líquido", r.totais.lucro, t.lucro_liquido, "total");
  // Decisão registrada no pacote: as linhas 03 e 09 ficam acima da referência.
  conferir(
    "linhas acima do preço de referência: 03 e 09",
    r.itens.filter((i) => i.precoReferenciaKm !== null && i.precoKm > i.precoReferenciaKm).map((i) => i.item),
    ["3", "9"]
  );
  conferir("sem lote no julgamento por item", r.lote, null);
  conferir("frota e equipe", [r.totais.veiculos, r.totais.motoristas, r.totais.monitoras], [10, 10, 9]);
}

console.log("\nSÃO JOSÉ DOS PINHAIS PE 089/2026 — lote único, SRP a 85%");
{
  const h = historicoSaoJoseDosPinhais();
  const r = simular(h.entrada);
  const e = esperado.sjpinhais.itens;
  const i1 = r.itens.find((i) => i.item === "1")!;
  const i2 = r.itens.find((i) => i.item === "2")!;
  for (const [nome, item, alvo] of [
    ["item 1 (pacientes)", i1, e.item1_pacientes],
    ["item 2 (servidores)", i2, e.item2_servidores],
  ] as const) {
    perto(`${nome}: km útil/mês`, item.kmUtil, alvo.km_util_mes, "total");
    perto(`${nome}: custo total/mês`, item.custoTotal, alvo.custo_total_mes, "total");
    perto(`${nome}: custo/km`, item.custoKm, alvo.custo_km, "total");
    perto(`${nome}: preço/km`, item.precoKm, alvo.preco_km, "preco");
    perto(`${nome}: lucro/mês`, item.lucro, alvo.lucro_mes, "total");
  }
  const lote = r.lote!;
  perto("lote: km útil/mês", lote.kmUtil, e.lote.km_util_mes, "total");
  perto("lote: custo total/mês", lote.custoTotal, e.lote.custo_total_mes, "total");
  perto("lote: custo/km", lote.custoKm, e.lote.custo_km, "total");
  perto("lote: preço/km médio ponderado", lote.precoKm, e.lote.preco_km, "preco");
  perto("lote: lucro/mês", lote.lucro, e.lote.lucro_mes, "total");
  conferir("lote: preço único da proposta (2 casas, para cima)", lote.precoProposta, 9.31);
  conferir("item 2 isolado fica acima do teto de R$ 11,11", lote.itensAcimaDoTeto, ["2"]);
  // Decisão registrada: o lote a R$ 9,31 dá lucro de ~9%.
  ok("lote a R$ 9,31: margem perto de 9%", Math.abs((lote.margemAoPrecoProposta ?? 0) - 0.09) < 0.005, `margem ${lote.margemAoPrecoProposta}`);

  console.log("\n  cenários a R$ 9,89/km");
  const c = r.cenarios;
  conferir("preço de teste", c.precoTesteKm, 9.89);
  const cen = esperado.sjpinhais.cenarios_a_9_89_por_km_8_vans;
  for (const [rotulo, u] of [["60%", 0.6], ["70%", 0.7], ["80%", 0.8], ["85%", 0.85], ["90%", 0.9], ["100%", 1]] as const) {
    const linha = c.linhas.find((l) => l.utilizacao === u)!;
    const alvo = cen[rotulo];
    // O esperado vem arredondado a reais e a 0,1 ponto de margem.
    ok(`${rotulo}: lucro/mês ≈ ${alvo.lucro_mes}`, Math.abs(linha.lucro - alvo.lucro_mes) < 1, `obtido ${linha.lucro.toFixed(2)}`);
    ok(`${rotulo}: margem ≈ ${alvo.margem}`, Math.abs((linha.margem ?? 0) - alvo.margem) < 0.0006, `obtido ${linha.margem}`);
  }
  ok(
    `ponto de equilíbrio ≈ ${cen.ponto_equilibrio_utilizacao}`,
    c.pontoEquilibrio !== null && Math.abs(c.pontoEquilibrio - cen.ponto_equilibrio_utilizacao) < 0.005,
    `obtido ${c.pontoEquilibrio}`
  );
  const linha85 = c.linhas.find((l) => l.utilizacao === 0.85)!;
  perto("85%: lucro/ano = lucro/mês × 12", linha85.lucroAno, linha85.lucro * 12, "total");
  perto("85%: lucro/van/mês = lucro ÷ 7 vans operacionais", linha85.lucroVeiculoMes, linha85.lucro / 7, "total");
  // Preço para o lucro alvo cai com a utilização: o fixo se dilui.
  const precos = c.linhas.map((l) => l.precoLucroAlvoKm);
  conferir("preço p/ lucro alvo decresce com a utilização", precos.every((p, i) => i === 0 || p <= precos[i - 1]), true);
}

console.log("\nPROPRIEDADES — a conta responde às premissas como deveria");
{
  const base = historicoSaoJoseDosPinhais().entrada;
  const r0 = simular(base);
  const maisDiesel = simular({ ...base, premissas: { ...base.premissas, variaveis: { ...base.premissas.variaveis, dieselLitro: base.premissas.variaveis.dieselLitro * 1.1 } } });
  ok("diesel +10% aumenta o custo", maisDiesel.totais.custoTotal > r0.totais.custoTotal);
  ok("diesel +10% não mexe no custo fixo", Math.abs(maisDiesel.itens[0].custoFixo - r0.itens[0].custoFixo) < 1e-6);
  const semReserva = simular({ ...base, premissas: { ...base.premissas, contrato: { ...base.premissas.contrato, reservaTecnicaPct: 0 } } });
  ok("sem reserva técnica o custo do veículo cai", semReserva.itens[0].veiculoMes < r0.itens[0].veiculoMes);
  const vazio = simular({ ...base, rotas: [] });
  conferir("sem rotas: nada a custar, nada quebra", [vazio.totais.custoTotal, vazio.itens[0].precoKm, vazio.cenarios.pontoEquilibrio], [0, 0, null]);
}

console.log("\nUNIDADES DE PREÇO — o mesmo custo, cobrado de outro jeito");
{
  const base = historicoSaoJoseDosPinhais().entrada;
  const km = simular(base);
  const i1 = km.itens[0];
  // SJP: 4 vans no item 1, 26 dias; custo/veículo-mês = custo ÷ 4.
  perto("custo por veículo-mês = custo ÷ veículos", i1.indicadores.veiculoMes.custo, i1.custoTotal / 4, "total");
  perto("custo por diária = custo ÷ (veículos × dias)", i1.indicadores.diaria.custo, i1.custoTotal / (4 * 26), "total");
  conferir("sem horas por dia não há preço por hora", i1.indicadores.hora, null);
  const porVeiculo = simular({ ...base, unidadePreco: "VEICULO_MES", precoTesteKm: null });
  const v1 = porVeiculo.itens[0];
  conferir("por veículo-mês: preço é o indicador arredondado", v1.precoUnidade, v1.indicadores.veiculoMes.preco);
  perto("por veículo-mês: faturamento = preço × veículos", v1.faturamento, v1.precoUnidade * 4, "total");
  perto("mesma margem-alvo, qualquer unidade (±arredondamento)", v1.lucro / v1.faturamento, i1.lucro / i1.faturamento, "total");
  const c = porVeiculo.cenarios;
  conferir("por veículo-mês o faturamento não depende da utilização", c.linhas[0].faturamento === c.linhas[5].faturamento, true);
  conferir("… e o equilíbrio é um teto de utilização", c.tipoEquilibrio, "MAXIMA");
  ok("… com lucro caindo quando o km sobe", c.linhas[0].lucro > c.linhas[5].lucro);
  const comHoras = simular({ ...base, unidadePreco: "HORA", rotas: base.rotas.map((r) => ({ ...r, horasDia: r.item === "1" ? 15 : 10 })) });
  perto("por hora: quantidade = veículos × dias × horas", comHoras.itens[0].indicadores.hora!.quantidade, 4 * 26 * 15, "total");

  const binomia = simular({ ...base, unidadePreco: "BINOMIA", precoTesteKm: null });
  const b1 = binomia.itens[0];
  const fatEsperado = b1.indicadores.binomia.fixoVeiculoMes * 4 + b1.indicadores.binomia.variavelKm * b1.kmUtil;
  perto("binômia: faturamento = fixo × veículos + variável × km", b1.faturamento, fatEsperado, "total");
  ok("binômia: lucro perto do alvo (só arredondamento acima)", b1.lucro >= 0 && Math.abs(b1.margem! - 0.09) < 0.005, `margem ${b1.margem}`);
  const cb = binomia.cenarios;
  ok("binômia: a queda de km custa menos que no preço por km", cb.linhas[0].lucro > km.cenarios.linhas[0].lucro - 1e-6 || cb.linhas[0].lucro > 0);
}

console.log("\nCUSTOS DOS MODELOS DE CONCORRENTES — somam o que devem");
{
  const base = historicoSaoJoseDosPinhais().entrada;
  const r0 = simular(base);
  const com = (mudar: (p: typeof base.premissas) => void) => {
    const premissas = structuredClone(base.premissas);
    mudar(premissas);
    return simular({ ...base, premissas });
  };
  // Adaptação de R$ 12.000 por van, 60 meses, capital 15% a.a.: por van com reserva.
  const adap = com((p) => {
    p.veiculo.adaptacaoValor = 12000;
    p.veiculo.adaptacaoMesesDepreciacao = 60;
  });
  perto("adaptação: 4 × 1,15 × 12.000 × (1/60 + 0,15/12)", adap.itens[0].adaptacao, 4 * 1.15 * 12000 * (1 / 60 + 0.15 / 12), "total");
  perto("adaptação entra no custo do veículo", adap.itens[0].veiculoMes - r0.itens[0].veiculoMes, adap.itens[0].adaptacao, "total");
  const manut = com((p) => {
    p.veiculo.manutencaoFixaPctMes = 0.008;
  });
  perto("manutenção fixa: 4 × 1,15 × 290.000 × 0,8%", manut.itens[0].manutencaoFixa, 4 * 1.15 * 290000 * 0.008, "total");
  const impl = com((p) => {
    p.contrato.implantacaoTotal = 24000;
  });
  perto("implantação: 24.000 ÷ 12 meses, rateada pelo km", impl.itens[0].implantacaoMes + impl.itens[1].implantacaoMes, 2000, "total");
  perto("… item 1 fica com a parte do km dele", impl.itens[0].implantacaoMes, (2000 * 26520) / 31280, "total");
  const horas = com((p) => {
    p.pessoal.horasExtras50Mes = 20;
  });
  perto("20 h extras a 50%: motoristas × 2950/220 × 1,5 × 20", horas.itens[0].salarios - r0.itens[0].salarios, 7.2 * (2950 / 220) * 1.5 * 20, "total");
  const sobrePreco = com((p) => {
    p.preco.despesasSobrePrecoPct = 0.02;
  });
  ok("2% sobre o preço sobem o preço", sobrePreco.itens[0].precoKm > r0.itens[0].precoKm);
  ok("… e a margem continua perto do alvo", Math.abs(sobrePreco.itens[0].margem! - 0.09) < 0.005, `margem ${sobrePreco.itens[0].margem}`);
}

console.log("\nTIPO DE VEÍCULO — muda o veículo, o variável e a mão de obra");
{
  const base = historicoSaoJoseDosPinhais().entrada;
  const r0 = simular(base);
  const onibus = PERFIS_PADRAO.find((p) => p.tipo === "ONIBUS")!;
  const carro = PERFIS_PADRAO.find((p) => p.tipo === "CARRO")!;
  const comPerfil = (codigo: string) =>
    simular({ ...base, premissas: { ...base.premissas, perfis: PERFIS_PADRAO }, rotas: base.rotas.map((r) => (r.item === "2" ? { ...r, perfilVeiculo: codigo } : r)) });
  const rOnibus = comPerfil("ONIBUS");
  const rCarro = comPerfil("CARRO");
  // Item 2: 3 motoristas, sem HE de horas; HE% 12% e encargos 70% de SJP.
  perto("salário do item 2 com ônibus = 3 × 3.200 × 1,12", rOnibus.itens[1].salarios, 3 * onibus.motorista.salario * 1.12, "total");
  perto("salário do item 2 com carro = 3 × 2.400 × 1,12", rCarro.itens[1].salarios, 3 * carro.motorista.salario * 1.12, "total");
  ok("ônibus custa mais que carro no mesmo trajeto", rOnibus.itens[1].custoTotal > rCarro.itens[1].custoTotal);
  perto("o item 1 (sem perfil) não muda", rOnibus.itens[0].custoTotal, r0.itens[0].custoTotal, "total");
  ok("diesel do ônibus (2,9 km/l) acima do da van (8,5 km/l)", rOnibus.itens[1].diesel > r0.itens[1].diesel);

  console.log("\n  sem motorista e combustível do cliente");
  const semMotorista = simular({ ...base, itens: base.itens.map((i) => (i.codigo === "2" ? { ...i, comMotorista: false } : i)) });
  conferir("sem motorista: nenhum salário no item 2", [semMotorista.itens[1].salarios, semMotorista.itens[1].motoristas], [0, 0]);
  perto("… e a supervisão inteira vai para o item 1", semMotorista.itens[0].supervisao, 7500, "total");
  const combustivelCliente = simular({ ...base, itens: base.itens.map((i) => ({ ...i, combustivelPorContaDoCliente: true })) });
  conferir("combustível do cliente: sem diesel nem ARLA", [combustivelCliente.itens[0].diesel, combustivelCliente.itens[0].arla], [0, 0]);
}

console.log("\nCAPITAL, DEPRECIAÇÃO E REGIME TRIBUTÁRIO");
{
  const base = historicoSaoJoseDosPinhais().entrada;
  const v = base.premissas.veiculo;
  // Capital composto: 80% a 18% + 20% a 12% = 16,8% a.a.
  const comp = custoDeCapital({ ...v, capitalComposto: true, fracaoFinanciada: 0.8, taxaFinanciamentoAa: 0.18, custoCapitalProprioAa: 0.12 }, 12);
  ok("capital composto = 0,8 × 18% + 0,2 × 12%", Math.abs(comp.taxaCapitalAa - 0.168) < 1e-12, `${comp.taxaCapitalAa}`);
  // Linear: 290.000 × (1 − 20%) ÷ 5 anos = 46.400/ano.
  const lin = custoDeCapital({ ...v, metodoDepreciacao: "LINEAR", vidaUtilAnos: 5, valorResidualPct: 0.2, idadeInicialAnos: 0 }, 12);
  perto("linear: 290.000 × 0,8 ÷ 5", lin.depreciacaoAnual, 46400, "total");
  // Soma dos dígitos, 5 anos: 1º ano = 5/15 do depreciável; 3º ano = 3/15.
  const sd1 = custoDeCapital({ ...v, metodoDepreciacao: "SOMA_DIGITOS", vidaUtilAnos: 5, valorResidualPct: 0.2, idadeInicialAnos: 0 }, 12);
  const sd3 = custoDeCapital({ ...v, metodoDepreciacao: "SOMA_DIGITOS", vidaUtilAnos: 5, valorResidualPct: 0.2, idadeInicialAnos: 2 }, 12);
  perto("soma dos dígitos, 1º ano: 232.000 × 5/15", sd1.depreciacaoAnual, (232000 * 5) / 15, "total");
  perto("soma dos dígitos, 3º ano: 232.000 × 3/15", sd3.depreciacaoAnual, (232000 * 3) / 15, "total");
  const velho = custoDeCapital({ ...v, metodoDepreciacao: "LINEAR", vidaUtilAnos: 5, valorResidualPct: 0.2, idadeInicialAnos: 6 }, 12);
  conferir("veículo além da vida útil não deprecia mais", velho.depreciacaoAnual, 0);
  // Contrato de 3 anos, linear 5 anos, idade 0: média constante; valor médio
  // não depreciado = 290.000 − 46.400 × (0,5 + 1,5 + 2,5)/3.
  const medio = custoDeCapital({ ...v, metodoDepreciacao: "LINEAR", vidaUtilAnos: 5, valorResidualPct: 0.2, idadeInicialAnos: 0, remuneracaoSobreValorMedio: true }, 36);
  perto("remuneração sobre o valor médio não depreciado", medio.valorMedio, 290000 - 46400 * 1.5, "total");
  // PERCENTUAL com veículo usado: o valor já é o de hoje (FIPE na idade
  // atual), então a idade não tira nada dele — só os anos do contrato. Ônibus
  // de 8 anos, R$ 280 mil, 12% a.a., 24 meses: meios = 280k − 33,6k × 0,5 e
  // 280k − 33,6k × 1,5. Antes, os 8 anos de vida zeravam a remuneração.
  const usado = custoDeCapital({ ...v, metodoDepreciacao: "PERCENTUAL", valor: 280000, depreciacaoAa: 0.12, idadeInicialAnos: 8, remuneracaoSobreValorMedio: true }, 24);
  perto("PERCENTUAL usado: valor médio não desconta a idade", usado.valorMedio, 280000 - 33600, "total");
  perto("PERCENTUAL usado: remuneração sobre o valor de hoje", usado.remuneracaoAnual, (280000 - 33600) * usado.taxaCapitalAa, "total");
  const usadoNovo = custoDeCapital({ ...v, metodoDepreciacao: "PERCENTUAL", valor: 280000, depreciacaoAa: 0.12, idadeInicialAnos: 0, remuneracaoSobreValorMedio: true }, 24);
  conferir("PERCENTUAL: idade não muda o capital", usado.valorMedio, usadoNovo.valorMedio);

  console.log("\n  Lucro Real × Presumido");
  const r0 = simular(base);
  const real = simular({
    ...base,
    premissas: { ...base.premissas, preco: { ...base.premissas.preco, pis: 0.0165, cofins: 0.076, irpj: 0, csll: 0, irpjCsllSobreLucroPct: 0.34, creditoPisCofinsPct: 0.0925 } },
  });
  const i = real.itens[0];
  ok("crédito = 9,25% dos custos com crédito", Math.abs(i.creditoPisCofins - i.custoComCredito * 0.0925) < 1e-6);
  ok("custos com crédito incluem combustível e depreciação", i.custoComCredito >= i.diesel + i.depreciacao);
  // A base do IR é o lucro antes do IR + os não dedutíveis (ver abaixo).
  perto("lucro = lucro antes do IR − 34% × (lucro antes do IR + não dedutíveis)", i.lucro, i.lucroAntesIr - 0.34 * (i.lucroAntesIr + i.naoDedutiveis), "total");
  ok("margem líquida perto do alvo (9%) também no Real", Math.abs(i.margem! - 0.09) < 0.005, `margem ${i.margem}`);
  ok("preço muda com o regime", i.precoKm !== r0.itens[0].precoKm, `${i.precoKm} × ${r0.itens[0].precoKm}`);
}

console.log("\nREVISÃO DE PRECIFICAÇÃO — adicional noturno, locação sem motorista, base do IR no Real");
{
  const base = historicoSaoJoseDosPinhais().entrada;
  const r0 = simular(base);
  const com = (mudar: (e: typeof base) => void) => {
    const e = structuredClone(base);
    mudar(e);
    return simular(e);
  };

  // Os históricos não passam por nenhuma das três correções — por isso a
  // reprodução acima continua exata.
  for (const h of [historicoHolambra(), historicoSaoJoseDosPinhais()]) {
    const { premissas: p, itens } = h.entrada;
    conferir(
      `${h.edital.numero}: sem horas noturnas, sem item sem motorista, Presumido`,
      [p.pessoal.horasNoturnasMes, itens.some((i) => i.comMotorista === false), p.preco.irpjCsllSobreLucroPct],
      [0, false, 0]
    );
  }

  console.log("\n  adicional noturno: só o adicional, com a hora reduzida");
  // SJP item 1: 7,2 motoristas a R$ 2.950 ÷ 220 = R$ 13,4091/h. 20 h noturnas
  // por motorista a 20%: 1,2 × 60 ÷ 52,5 − 1 = 13/35 = 0,371429 da hora →
  // 7,2 × 13,4091 × 20 × 0,371429 = R$ 717,19 (antes: × 1,2 = R$ 2.317,09,
  // pagando de novo a hora-base que o salário já paga).
  const noturnas20 = com((e) => {
    e.premissas.pessoal.horasNoturnasMes = 20;
  });
  perto("20 h noturnas a 20%: 7,2 × 2.950/220 × 20 × 0,371429 = 717,19", noturnas20.itens[0].salarios - r0.itens[0].salarios, 717.1948, "total");
  // A 25% (CCT RP/Franca): 1,25 × 60 ÷ 52,5 − 1 = 3/7 → 1.930,91 × 3/7 = 827,53.
  const noturnas25 = com((e) => {
    e.premissas.pessoal.horasNoturnasMes = 20;
    e.premissas.pessoal.adicionalNoturnoPct = 0.25;
  });
  perto("… a 25%: 7,2 × 2.950/220 × 20 × 3/7 = 827,53", noturnas25.itens[0].salarios - r0.itens[0].salarios, 827.5325, "total");
  // Versão salva antes da premissa (sem o campo): vale a CLT, 20%.
  const semCampo = com((e) => {
    e.premissas.pessoal.horasNoturnasMes = 20;
    delete e.premissas.pessoal.adicionalNoturnoPct;
  });
  perto("… sem a premissa (versão antiga), 20%", semCampo.itens[0].salarios, noturnas20.itens[0].salarios, "total");

  console.log("\n  locação sem motorista: sem ISS/ICMS, presunção de 32% no Presumido");
  // SJP: PIS 0,65% + COFINS 3%. Item 2 sem motorista no Presumido:
  // 0,65% + 3% + IRPJ 8% (25% × 32%) + CSLL 2,88% = 14,53% (com motorista eram
  // 0,65 + 3 + 1,35 + 1,08 + ISS 3 = 9,08%). O item 1 (35% intermunicipal)
  // fica em 6,08% + 3% × 0,65 + 12% × 0,35 = 12,23%.
  const locacao = com((e) => {
    e.itens[1].comMotorista = false;
  });
  perto("item 2 sem motorista: 0,65% + 3% + 8% + 2,88% = 14,53%", locacao.itens[1].tributosPct, 0.1453, "total");
  perto("item 1 com motorista continua em 12,23%", locacao.itens[0].tributosPct, 0.1223, "total");
  perto("… e o lote pondera os tributos dos dois", locacao.lote!.tributosPct, (0.1223 * locacao.itens[0].faturamento + 0.1453 * locacao.itens[1].faturamento) / locacao.totais.faturamento, "total");
  ok("… com a margem do item sem motorista perto do alvo (9%)", Math.abs(locacao.itens[1].margem! - 0.09) < 0.005, `margem ${locacao.itens[1].margem}`);
  const locacaoPropria = com((e) => {
    e.itens[1].comMotorista = false;
    e.premissas.preco.irpjLocacao = 0.06;
    e.premissas.preco.csllLocacao = 0.03;
  });
  perto("presunção da locação é premissa: 0,65% + 3% + 6% + 3% = 12,65%", locacaoPropria.itens[1].tributosPct, 0.1265, "total");
  // No Real, IR/CSLL vão para o lucro: o item sem motorista paga só PIS/COFINS.
  const locacaoReal = com((e) => {
    e.itens[1].comMotorista = false;
    Object.assign(e.premissas.preco, { irpj: 0, csll: 0, irpjCsllSobreLucroPct: 0.34 });
  });
  perto("no Real, sem motorista: só PIS + COFINS = 3,65%", locacaoReal.itens[1].tributosPct, 0.0365, "total");

  console.log("\n  Lucro Real: capital próprio e contingência não saem da base do IR");
  // Sem capital composto, a remuneração inteira é tratada como capital próprio.
  conferir("capital simples: remuneração própria = remuneração inteira", r0.itens[0].remuneracaoCapitalProprio, r0.itens[0].remuneracaoCapital);
  // Real (IR/CSLL 34% sobre o lucro, PIS/COFINS cumulativos), capital
  // composto 80% a 18% + 20% a 12%. Item 1: 4 vans × 1,15 = 4,6 com reserva;
  // capital próprio = 4,6 × 290.000 × 20% × 12% ÷ 12 = R$ 2.668/mês (os juros
  // dos 80% financiados são despesa e saem da base). Contingência de 3% sobre
  // o custo direto. N = 2.668 + 3% × custo direto.
  const real = com((e) => {
    Object.assign(e.premissas.preco, { irpj: 0, csll: 0, irpjCsllSobreLucroPct: 0.34 });
    Object.assign(e.premissas.veiculo, { capitalComposto: true, fracaoFinanciada: 0.8, taxaFinanciamentoAa: 0.18, custoCapitalProprioAa: 0.12 });
  });
  const i1 = real.itens[0];
  perto("capital próprio: 4,6 × 290.000 × 0,2 × 0,12 ÷ 12 = 2.668", i1.remuneracaoCapitalProprio, 2668, "total");
  perto("… a remuneração inteira é 4,6 × 290.000 × 16,8% ÷ 12 = 18.676", i1.remuneracaoCapital, 18676, "total");
  perto("não dedutíveis = 2.668 + 3% × custo direto", i1.naoDedutiveis, 2668 + 0.03 * i1.custoDireto, "total");
  perto("IR = 34% × (lucro antes do IR + não dedutíveis)", i1.irpjCsllSobreLucro, 0.34 * (i1.lucroAntesIr + i1.naoDedutiveis), "total");
  // Preço: P = (C + N × 0,34/0,66) ÷ km ÷ (L − 9%/0,66). Item 1: tributos
  // 0,65 + 3 + 3 × 0,65 + 12 × 0,35 = 9,8%; financeiro 1,8% → L = 0,884;
  // divisor = 0,884 − 0,136364 = 0,747636.
  const divisor = 0.884 - 0.09 / 0.66;
  perto(
    "preço/km = (custo líquido + N × 0,34 ÷ 0,66) ÷ km ÷ 0,747636",
    i1.precoKm,
    arredondarParaCima((i1.custoTotal - i1.creditoPisCofins + (i1.naoDedutiveis * 0.34) / 0.66) / i1.kmUtil / divisor),
    "preco"
  );
  ok("margem líquida no alvo (9%, só o arredondamento acima)", i1.margem! >= 0.09 - 1e-9 && i1.margem! < 0.0915, `margem ${i1.margem}`);
  // Sem o IR sobre N no preço, a margem ficaria abaixo do alvo em ≈ 34% × N ÷ faturamento.
  const precoAntigo = (i1.custoTotal - i1.creditoPisCofins) / i1.kmUtil / divisor;
  const fatAntigo = precoAntigo * i1.kmUtil;
  const lairAntigo = fatAntigo * 0.884 - (i1.custoTotal - i1.creditoPisCofins);
  const margemAntiga = (lairAntigo - 0.34 * (lairAntigo + i1.naoDedutiveis)) / fatAntigo;
  ok("… o preço pela conta antiga daria margem abaixo do alvo", margemAntiga < 0.085, `margem ${margemAntiga}`);
  // Lote, ao preço único: mesma base.
  const l = real.lote!;
  const lairLote = l.faturamentoAoPrecoProposta * (1 - l.tributosPct - 0.018) - (l.custoTotal - real.itens.reduce((a, i) => a + i.creditoPisCofins, 0));
  perto(
    "lote: lucro ao preço único = lucro antes do IR − 34% × (lucro antes do IR + N)",
    l.lucroAoPrecoProposta,
    lairLote - 0.34 * (lairLote + real.itens.reduce((a, i) => a + i.naoDedutiveis, 0)),
    "total"
  );
  // Cenários: no ponto de equilíbrio, o lucro DEPOIS do IR é zero.
  const pe = real.cenarios.pontoEquilibrio!;
  const noEquilibrio = com((e) => {
    Object.assign(e.premissas.preco, { irpj: 0, csll: 0, irpjCsllSobreLucroPct: 0.34 });
    Object.assign(e.premissas.veiculo, { capitalComposto: true, fracaoFinanciada: 0.8, taxaFinanciamentoAa: 0.18, custoCapitalProprioAa: 0.12 });
    e.utilizacoesCenario = [pe];
  });
  ok("cenários: lucro depois do IR zero no ponto de equilíbrio", Math.abs(noEquilibrio.cenarios.linhas[0].lucro) < 0.01, `lucro ${noEquilibrio.cenarios.linhas[0].lucro} em u = ${pe}`);
  const linha85 = real.cenarios.linhas.find((x) => x.utilizacao === 0.85)!;
  // Real de passageiros: PIS/COFINS cumulativos, sem crédito — custo líquido = custo total.
  const lair85 = linha85.faturamento * (1 - real.cenarios.tributosPct - 0.018) - linha85.custoTotal;
  // N(u) = capital próprio × meses + contingência × custo direto(u); custo direto = custo total ÷ 1,10.
  const n85 = real.itens.reduce((a, i) => a + i.remuneracaoCapitalProprio, 0) + (0.03 * linha85.custoTotal) / 1.1;
  perto("cenário 85%: lucro = lucro antes do IR − 34% × (lucro antes do IR + N(u))", linha85.lucro, lair85 - 0.34 * (lair85 + n85), "total");
}

console.log("\nVALIDAÇÃO DA ENTRADA — o que chega do navegador antes do motor e do banco");
{
  // Regressões: unidade de preço desconhecida fazia o faturamento sair NaN e
  // a gravação estourar no Prisma; texto no lugar de número passava por
  // numerosFinitos; diasMes 21,5 era truncado para 21 na definição corrente
  // (SimRota.diasMes é Int) e reabrir o estudo dava outra conta.
  const base = historicoSaoJoseDosPinhais().entrada;
  const variar = (mudar: (e: EntradaSimulacao) => void) => {
    const e = structuredClone(base);
    mudar(e);
    return validarEntrada(e);
  };
  conferir("SJP válida", validarEntrada(base), null);
  conferir("Holambra válida", validarEntrada(historicoHolambra().entrada), null);
  const semNaN = simular({ ...structuredClone(base), unidadePreco: "XYZ" as never }).totais.faturamento;
  ok("unidade desconhecida dava faturamento NaN no motor…", Number.isNaN(semNaN), String(semNaN));
  ok("… e é recusada", variar((e) => (e.unidadePreco = "XYZ" as never)) !== null);
  ok("critério desconhecido é recusado", variar((e) => (e.criterio = "GLOBAL" as never)) !== null);
  ok("km/dia em texto é recusado", variar((e) => (e.rotas[0].kmDia = "100" as never)) !== null);
  ok("pedágio negativo é recusado", variar((e) => (e.rotas[0].tarifaPedagio = -1)) !== null);
  ok("noturno fora de sim/não é recusado", variar((e) => (e.rotas[0].noturno = "S" as never)) !== null);
  ok("dias por mês fracionário é recusado", variar((e) => (e.rotas[0].diasMes = 21.5)) !== null);
  ok("dias por mês acima de 31 é recusado", variar((e) => (e.rotas[0].diasMes = 40)) !== null);
  conferir("dias por mês vazio continua válido", variar((e) => (e.rotas[0].diasMes = null)), null);
  ok("parcela intermunicipal acima de 100% é recusada", variar((e) => (e.itens[0].shareIntermunicipal = 1.5)) !== null);
}

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
