// TESTES DO PAINEL DE DECISÃO E DA CALIBRAÇÃO — `npm run teste:decisao`.
//
// O painel é o motor rodado de outros jeitos: a faixa de lance com outras
// margens, a sensibilidade com cada premissa 10% pior. O teste confere que o
// veredicto segue as regras (margem mínima, teto, folga de utilização), que a
// faixa está em ordem e que a calibração compara o custo por km, não o total.
//
// Sem banco.
import { historicoHolambra, historicoSaoJoseDosPinhais } from "../src/lib/simulador/historico";
import { simular } from "../src/lib/simulador/motor";
import { montarPainel } from "../src/lib/simulador/decisao";
import { calibrar } from "../src/lib/simulador/calibracao";
import { PERFIS_PADRAO, PREMISSAS_PADRAO } from "../src/lib/simulador/premissas";
import type { EntradaSimulacao } from "../src/lib/simulador/tipos";

let falhas = 0;
function ok(nome: string, passou: boolean, detalhe = "") {
  if (!passou) falhas++;
  console.log(`${passou ? "  ok  " : "FALHA "} ${nome}${passou ? "" : `\n         ${detalhe}`}`);
}
function conferir(nome: string, real: unknown, esperado: unknown) {
  ok(nome, JSON.stringify(real) === JSON.stringify(esperado), `esperado ${JSON.stringify(esperado)}\n         obtido   ${JSON.stringify(real)}`);
}

console.log("SJP — lote a R$ 9,31, margem ~9%, equilíbrio ~68%");
{
  const e = historicoSaoJoseDosPinhais().entrada;
  const entrada = { ...e, precoTesteKm: null };
  const r = simular(entrada);
  const painel = montarPainel(entrada, r, { margemMinima: 0.07, margemAlvo: 0.09 });
  const f = painel.faixa;
  ok("faixa em ordem: piso < margem mínima < alvo ≤ teto", f.piso < f.margemMinima && f.margemMinima < f.alvo && f.alvo <= (f.teto ?? Infinity), JSON.stringify(f));
  conferir("alvo = preço do lote", f.alvo, 9.31);
  conferir("teto do edital", f.teto, 11.11);
  ok("folga de utilização ≈ 85% − 68%", painel.folgaUtilizacao !== null && Math.abs(painel.folgaUtilizacao - (0.85 - (r.cenarios.pontoEquilibrio ?? 0))) < 1e-9);
  conferir("item 2 acima do teto vira atenção (o lote compensa)", painel.alertas.filter((a) => a.titulo.includes("Item 2")).map((a) => a.nivel), ["ATENCAO"]);
  conferir("veredicto: lançar com ressalva", painel.veredicto, "LANCAR_COM_RESSALVA");
  ok("sensibilidade ordenada do pior para o melhor", painel.sensibilidade.every((s, i) => i === 0 || s.efeitoLucro >= painel.sensibilidade[i - 1].efeitoLucro));
  ok("toda piora de 10% reduz o lucro", painel.sensibilidade.every((s) => s.efeitoLucro < 0), JSON.stringify(painel.sensibilidade.map((s) => [s.rotulo, Math.round(s.efeitoLucro)])));
  conferir("a utilização está entre as três que mais pesam", painel.sensibilidade.slice(0, 3).some((s) => s.caminho === "contrato.utilizacao"), true);

  const alta = montarPainel(entrada, r, { margemMinima: 0.12, margemAlvo: 0.15 });
  conferir("margem mínima acima da obtida: não lançar", alta.veredicto, "NAO_LANCAR");
  const semRegras = montarPainel(entrada, r);
  conferir("sem regras da base: margem mínima = metade do alvo", semRegras.margemMinima, 0.045);
  ok("… e avisa", semRegras.alertas.some((a) => a.titulo === "Margem mínima padrão"));
}

console.log("\nPREMISSAS ESTIMADAS — as decisivas aparecem");
{
  const e = historicoSaoJoseDosPinhais().entrada;
  const r = simular(e);
  const origem = {
    "variaveis.dieselLitro": { origem: "PADRAO" as const, fonte: "padrão" },
    "pessoal.salarioMotorista": { origem: "BASE" as const, fonte: "Gabarito" },
    "contrato.utilizacao": { origem: "HISTORICO" as const, fonte: "estimativa" },
  };
  const p = montarPainel(e, r, { margemMinima: 0.05, margemAlvo: 0.09, origem });
  conferir("duas de três estimadas", [p.premissasEstimadas.estimadas, p.premissasEstimadas.total], [2, 3]);
  ok("utilização (decisiva) listada", p.premissasEstimadas.principais.includes("Utilização do km"), JSON.stringify(p.premissasEstimadas.principais));
}

console.log("\nHOLAMBRA — por item, sem teto; linhas 03 e 09 caras mas lançáveis");
{
  const e = historicoHolambra().entrada;
  const p = montarPainel(e, simular(e), { margemMinima: 0.07, margemAlvo: 0.1 });
  conferir("sem teto no edital", p.faixa.teto, null);
  ok("margem ~10% ≥ mínima", (p.margem ?? 0) >= 0.07);
  ok("veredicto não é 'não lançar'", p.veredicto !== "NAO_LANCAR", p.resumo);
}

console.log("\nPREÇO POR VEÍCULO — km a mais é o risco");
{
  const e = { ...historicoSaoJoseDosPinhais().entrada, unidadePreco: "VEICULO_MES" as const, precoTesteKm: null };
  const p = montarPainel(e, simular(e), { margemMinima: 0.05, margemAlvo: 0.09 });
  conferir("sem folga de utilização (o equilíbrio é teto)", p.folgaUtilizacao, null);
}

console.log("\nCALIBRAÇÃO — realizado × previsto");
{
  const e = historicoSaoJoseDosPinhais().entrada;
  const r = simular(e);
  const kmPrev = r.totais.kmUtil;
  const comb = r.itens.reduce((a, i) => a + i.diesel + i.arla, 0);
  const folha = r.itens.reduce((a, i) => a + i.maoDeObraMes, 0);
  // Rodou 10% a mais; combustível subiu 21% (consumo pior); folha igual.
  const c = calibrar(r, 1, [
    { competencia: "2027-01", kmRealizado: kmPrev * 1.1, faturamento: 300000, custos: { combustivel: comb * 1.21, folha } },
    { competencia: "2027-02", kmRealizado: kmPrev * 1.1, faturamento: 310000, custos: { combustivel: comb * 1.21, folha } },
  ]);
  const lc = c.linhas.find((l) => l.natureza === "combustivel")!;
  ok("combustível previsto ajustado ao km (+10%)", Math.abs(lc.previstoAjustado - comb * 1.1) < 1e-6);
  ok("desvio por km = +10% (1,21 ÷ 1,1)", Math.abs((lc.desvioPct ?? 0) - 0.1) < 1e-9, `${lc.desvioPct}`);
  conferir("folha sem desvio", c.linhas.find((l) => l.natureza === "folha")!.desvioPct, 0);
  ok("utilização real = 110% × 85%", Math.abs((c.utilizacaoReal ?? 0) - 0.935) < 1e-9, `${c.utilizacaoReal}`);
  ok("sugere revisar consumo e utilização", c.sugestoes.some((s) => s.startsWith("Combustível")) && c.sugestoes.some((s) => s.startsWith("Km realizado")), c.sugestoes.join(" | "));
  conferir("sem dado de manutenção: sem desvio", c.linhas.find((l) => l.natureza === "manutencao")!.realizadoMedio, null);
  const esc = historicoHolambra().entrada;
  const ce = calibrar(simular(esc), 12, []);
  ok("escolar: previsto mensal = período ÷ 12", Math.abs(ce.kmPrevistoMes - simular(esc).totais.kmUtil / 12) < 1e-6);

  // Regressão: a manutenção fixa (% do valor ao mês) era escalada com o km
  // realizado junto com a manutenção por km — 20% mais km "previa" 20% mais
  // manutenção fixa e inventava desvio.
  const mf = structuredClone(e);
  mf.premissas.veiculo.manutencaoFixaPctMes = 0.002;
  const rmf = simular(mf);
  const fixa = rmf.itens.reduce((a, i) => a + i.manutencaoFixa, 0);
  const porKm = rmf.itens.reduce((a, i) => a + i.manutencao + i.pneus + i.oleoLavagem, 0);
  const cmf = calibrar(rmf, 1, [{ competencia: "2027-01", kmRealizado: rmf.totais.kmUtil * 1.2, faturamento: null, custos: { manutencao: porKm * 1.2 + fixa } }]);
  const lm = cmf.linhas.find((l) => l.natureza === "manutencao")!;
  ok("manutenção: só a parte por km acompanha o km (fixa não)", fixa > 0 && Math.abs(lm.previstoAjustado - (porKm * 1.2 + fixa)) < 1e-6, `${lm.previstoAjustado} × ${porKm * 1.2 + fixa}`);
  ok("… e o realizado igual ao previsto não dá desvio", Math.abs(lm.desvioPct ?? 1) < 1e-12, `${lm.desvioPct}`);
  // Regressão: no lote, o faturamento previsto é o do preço único da proposta.
  ok("lote: faturamento previsto ao preço único", r.lote !== null && Math.abs(calibrar(r, 1, []).faturamentoPrevistoMes - r.lote.faturamentoAoPrecoProposta) < 1e-6);
}

console.log("\nALERTAS DA PESQUISA — depreciação, ARLA, reforma tributária");
{
  const e = structuredClone(historicoSaoJoseDosPinhais().entrada);
  e.premissas.perfis = [structuredClone(PERFIS_PADRAO.find((p) => p.tipo === "VAN")!)];
  e.premissas.perfis[0].veiculo.metodoDepreciacao = "PERCENTUAL";
  e.premissas.perfis[0].veiculo.depreciacaoAa = 0.05;
  const r = simular(e);
  const titulos = (p: ReturnType<typeof montarPainel>) => p.alertas.map((a) => a.titulo);
  const p1 = montarPainel(e, r, { margemMinima: 0.05, margemAlvo: 0.09, inicioContrato: new Date(2026, 9, 1) });
  ok("van a 5% a.a. pelo método percentual gera alerta", titulos(p1).includes("Depreciação baixa para van ou micro"), JSON.stringify(titulos(p1)));
  ok("contrato de 12 meses a partir de out/2026 atravessa 2027", titulos(p1).includes("Contrato atravessa a reforma tributária"));
  const e2 = structuredClone(e);
  e2.premissas.perfis![0].veiculo.depreciacaoAa = 0.15;
  e2.premissas.contrato.vigenciaMeses = 2;
  const p2 = montarPainel(e2, simular(e2), { margemMinima: 0.05, margemAlvo: 0.09, inicioContrato: new Date(2026, 0, 1) });
  ok("15% a.a. não alerta depreciação", !titulos(p2).includes("Depreciação baixa para van ou micro"));
  ok("contrato jan–fev/2026 não atravessa a reforma", !titulos(p2).includes("Contrato atravessa a reforma tributária"));
  ok("reforma é informativa: não muda o veredicto", p1.alertas.find((a) => a.titulo.startsWith("Contrato atravessa"))?.nivel === "INFO");
  const e3 = structuredClone(e2);
  e3.premissas.variaveis.arlaKm = e3.premissas.variaveis.dieselLitro / e3.premissas.variaveis.consumoAsfaltoKmL;
  ok("ARLA do tamanho do diesel é apontada", titulos(montarPainel(e3, simular(e3), { inicioContrato: new Date(2026, 0, 1) })).includes("ARLA acima do usual"));
  ok("o padrão do simulador deprecia 15% a.a.", Math.abs(PREMISSAS_PADRAO.veiculo.depreciacaoAa - 0.15) < 1e-12);
}

console.log("\nREGIME TRIBUTÁRIO — imposto em dobro e adicional do IRPJ");
{
  const e = structuredClone(historicoSaoJoseDosPinhais().entrada);
  const titulos = (x: EntradaSimulacao) => montarPainel(x, simular(x), { inicioContrato: new Date(2026, 0, 1) }).alertas.map((a) => `${a.nivel}:${a.titulo}`);
  const dobro = structuredClone(e);
  dobro.premissas.preco.irpjCsllSobreLucroPct = 0.34;
  ok("IRPJ/CSLL na receita e no lucro é crítico", titulos(dobro).includes("CRITICO:IRPJ/CSLL contados duas vezes"));
  const credito = structuredClone(e);
  credito.premissas.preco.creditoPisCofinsPct = 0.0925;
  ok("crédito com PIS/COFINS cumulativo é crítico", titulos(credito).includes("CRITICO:Crédito de PIS/COFINS no regime cumulativo"));
  const semAdicional = structuredClone(e);
  semAdicional.premissas.preco.irpj = 0.024;
  ok("IRPJ de 2,4% avisa o adicional", titulos(semAdicional).includes("INFO:IRPJ sem o adicional"));
  ok("o padrão do simulador já tem o adicional (4%)", Math.abs(PREMISSAS_PADRAO.preco.irpj - 0.04) < 1e-12);
}

console.log("\nSENSIBILIDADE — o sentido da utilização depende da unidade");
{
  const e = structuredClone(historicoSaoJoseDosPinhais().entrada);
  const efeito = (x: EntradaSimulacao) => montarPainel(x, simular(x)).sensibilidade.find((s) => s.caminho === "contrato.utilizacao")?.efeitoLucro ?? 0;
  ok("por km, menos utilização piora o lucro", efeito(e) < 0, String(efeito(e)));
  const vm = { ...e, criterio: "ITEM" as const, unidadePreco: "VEICULO_MES" as const };
  ok("por veículo-mês, mais utilização (mais km) piora o lucro", efeito(vm) < 0, String(efeito(vm)));
}

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
