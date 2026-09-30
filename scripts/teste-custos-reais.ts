// TESTES DOS CUSTOS REAIS DO SIMULADOR — `npm run teste:custos-reais`.
//
// A conta de src/lib/simulador/custosReais.ts é PURA: recebe um `DadosReais`
// montado à mão e devolve indicadores. Aqui cada indicador é conferido contra
// o número feito de cabeça — a mesma conta que alguém faria para defender o
// preço —, junto com as regras que decidem o que NÃO entra: abastecimento sem
// km, km absurdo, consumo atípico para o tipo, preço por litro impossível,
// categoria classificada na linha errada, base com poucos meses, gestão fora
// do ar. E `aplicarIndicadores`, que leva o escolhido às premissas com origem
// REAL sem tocar no resto.
//
// Sem banco.
import { baseComIndiretosDoDre, indiretosDoDre } from "../src/lib/simulador/indiretosDoDre";
import {
  aplicarIndicadores,
  analisarCustosReais,
  indicadoresReais,
  type AbastecimentoReal,
  type CategoriaReal,
  type DadosReais,
  type IndicadorReal,
  type UsoReal,
  type VeiculoReal,
} from "../src/lib/simulador/custosReais";
import { PERFIS_PADRAO, PREMISSAS_PADRAO, premissasDaBase } from "../src/lib/simulador/premissas";

let falhas = 0;
function ok(nome: string, passou: boolean, detalhe = "") {
  if (!passou) falhas++;
  console.log(`${passou ? "  ok  " : "FALHA "} ${nome}${passou ? "" : `\n         ${detalhe}`}`);
}
function conferir(nome: string, real: unknown, esperadoValor: unknown) {
  ok(nome, JSON.stringify(real) === JSON.stringify(esperadoValor), `esperado ${JSON.stringify(esperadoValor)}\n         obtido   ${JSON.stringify(real)}`);
}
function perto(nome: string, real: number | undefined, alvo: number, tolerancia = 1e-6) {
  ok(nome, real !== undefined && Math.abs(real - alvo) <= tolerancia, `esperado ${alvo}, obtido ${real}`);
}

// ---------------------------------------------------------------------------
// O cenário: doze meses fechados, out/2025 a set/2026, referência 30/09/2026.
// ---------------------------------------------------------------------------
const MESES = ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
const REFERENCIA = new Date(2026, 8, 30);
const doze = (cents: number) => new Array<number>(12).fill(cents);
const soNoMes = (i: number, cents: number) => doze(0).map((_, j) => (j === i ? cents : 0));

function categoria(codigo: string, descricao: string, linha: string, porMesCents: number[], confirmada = true): CategoriaReal {
  return { codigo, descricao, linha, confirmada, porMesCents };
}

const VEICULOS: VeiculoReal[] = [
  { id: "v1", placa: "VAN0001", modelo: "Sprinter 416", tipo: "Van", status: "ATIVO" },
  { id: "v2", placa: "VAN0002", modelo: "Sprinter 416", tipo: "Van", status: "ATIVO" },
  { id: "v3", placa: "VAN0003", modelo: "Master", tipo: "Van", status: "ATIVO" },
  { id: "v4", placa: "VAN0004", modelo: "Master", tipo: "Van", status: "MANUTENCAO" },
  { id: "o1", placa: "ONI0001", modelo: "Marcopolo", tipo: "Ônibus", status: "ATIVO" },
  { id: "o2", placa: "ONI0002", modelo: "Marcopolo", tipo: "Ônibus", status: "ATIVO" },
  { id: "c1", placa: "CAR0001", modelo: "Corolla", tipo: "Carro executivo", status: "ATIVO" },
  // Baixado: não conta no seguro nem no IPVA.
  { id: "v9", placa: "VAN0009", modelo: "Ducato", tipo: "Van", status: "INATIVO" },
];

function abastecimento(vehicleId: string | null, mes: number, dia: number, litros: number, precoLitro: number, km: number | null, combustivel = "DIESEL S10"): AbastecimentoReal {
  const [ano, m] = MESES[mes].split("-").map(Number);
  return { vehicleId, dataHora: new Date(ano, m - 1, dia, 12, 0, 0), valorCents: Math.round(litros * precoLitro * 100), volumeLitros: litros, kmRodados: km, combustivel };
}

// Um abastecimento por veículo por mês, todos iguais dentro do tipo: van 60 l
// para 540 km (9 km/l) a R$ 6,00; ônibus 200 l para 600 km (3 km/l) a
// R$ 5,90; carro 40 l de gasolina para 480 km (12 km/l) a R$ 6,50. Mais ARLA
// dos ônibus, que não é combustível e não entra em nada.
function abastecimentosRegulares(): AbastecimentoReal[] {
  const lista: AbastecimentoReal[] = [];
  for (let m = 0; m < 12; m++) {
    for (const v of ["v1", "v2", "v3", "v4"]) lista.push(abastecimento(v, m, 10, 60, 6, 540));
    for (const o of ["o1", "o2"]) {
      lista.push(abastecimento(o, m, 10, 200, 5.9, 600));
      lista.push(abastecimento(o, m, 10, 20, 4, null, "ARLA 32"));
    }
    lista.push(abastecimento("c1", m, 10, 40, 6.5, 480, "GASOLINA COMUM"));
  }
  return lista;
}

// Os casos que as regras de corte existem para pegar — todos em ago/2026,
// dentro dos 90 dias do preço.
const ABSURDO_KM = abastecimento("v1", 10, 15, 60, 6, 5000); // 5.000 km num tanque: fora do consumo e do km
const SEM_KM = abastecimento("v2", 10, 15, 60, 6, null); // sem km: fora do consumo, dentro do preço
const ATIPICO = abastecimento("v3", 10, 15, 60, 6, 1200); // 20 km/l numa van: plausível no absoluto, atípico para o tipo
const PRECO_IMPOSSIVEL = abastecimento("v1", 10, 20, 60, 0.06, 540); // R$ 0,06/l: fora do preço, dentro do consumo
const PLACA_FORA = abastecimento(null, 10, 20, 50, 6, 400); // placa fora do cadastro

const USOS: UsoReal[] = [
  { vehicleId: "v1", checkInAt: new Date(2026, 7, 3, 7), kmInicial: 1000, kmFinal: 1100 },
  { vehicleId: "v2", checkInAt: new Date(2026, 7, 3, 7), kmInicial: 5000, kmFinal: 5100 },
  { vehicleId: "v3", checkInAt: new Date(2026, 7, 3, 7), kmInicial: 5000, kmFinal: null },
];

function montarDados(ajuste: Partial<DadosReais> = {}): DadosReais {
  const categorias: CategoriaReal[] = [
    categoria("1.01", "Clientes - Serviços Prestados", "RECEITA_BRUTA", doze(5_000_000)),
    categoria("1.02", "ISS sobre faturamento", "DEDUCOES", doze(600_000)),
    categoria("2.01", "Manutenção de veículos", "DESPESA_VEICULOS", doze(100_000)),
    categoria("2.02", "Pneus e recapagem", "DESPESA_VEICULOS", doze(30_000)),
    categoria("2.03", "Seguro de frota", "DESPESA_VEICULOS", doze(240_000)),
    // IPVA pago de uma vez, em janeiro.
    categoria("2.04", "IPVA e licenciamento", "DESPESA_VEICULOS", soNoMes(3, 1_200_000)),
    categoria("2.05", "Combustível - Óleo Diesel", "DESPESA_VEICULOS", doze(700_000)),
    categoria("3.01", "Salários e ordenados", "DESPESA_SALARIOS", doze(1_000_000)),
    categoria("3.02", "INSS e FGTS", "DESPESA_SALARIOS", doze(400_000)),
    categoria("3.03", "Vale-refeição", "DESPESA_SALARIOS", doze(100_000)),
    categoria("4.01", "Aluguel da garagem", "DESPESA_ESTRUTURA", doze(200_000)),
    categoria("4.02", "Material de escritório", "DESPESA_ADMINISTRATIVA", doze(50_000), false),
    categoria("4.03", "Licenças de software", "DESPESA_INFORMATICA", doze(30_000)),
    // Parece seguro de veículo, mas está em "outras despesas": fica fora do
    // seguro por veículo, e o aviso diz.
    categoria("4.04", "Seguros", "DESPESA_GERAL", doze(50_000)),
  ];
  const linhasDre: Record<string, number[]> = {
    RECEITA_BRUTA: doze(5_000_000),
    DEDUCOES: doze(600_000),
    RECEITA_LIQUIDA: doze(4_400_000),
    CUSTO_SERVICO: doze(0),
    DESPESA_VEICULOS: doze(1_070_000).map((v, i) => (i === 3 ? v + 1_200_000 : v)),
    DESPESA_SALARIOS: doze(1_500_000),
    DESPESA_ESTRUTURA: doze(200_000),
    DESPESA_ADMINISTRATIVA: doze(50_000),
    DESPESA_INFORMATICA: doze(30_000),
    DESPESA_GERAL: doze(50_000),
  };
  return {
    dataReferencia: REFERENCIA,
    meses: MESES,
    linhasDre,
    categorias,
    naoConfirmadoCents: 12 * 50_000,
    semCategoriaCents: 0,
    abastecimentos: [...abastecimentosRegulares(), ABSURDO_KM, SEM_KM, ATIPICO, PRECO_IMPOSSIVEL, PLACA_FORA],
    veiculos: VEICULOS,
    pessoas: [
      ...Array.from({ length: 8 }, (_, i) => ({ id: `m${i}`, ativo: true, funcao: "Motorista" })),
      { id: "a1", ativo: true, funcao: "Administrativo" },
      { id: "a2", ativo: true, funcao: null },
      { id: "x1", ativo: false, funcao: "Motorista" },
      { id: "x2", ativo: false, funcao: "Motorista" },
    ],
    usos: USOS,
    gestaoDisponivel: true,
    conexaoFiltrada: false,
    avisos: [],
    ...ajuste,
  };
}

const achar = (lista: IndicadorReal[], caminho: string) => lista.find((i) => i.caminho === caminho);

// ---------------------------------------------------------------------------
console.log("COMBUSTÍVEL — preço pago nos últimos 90 dias");
const cheio = analisarCustosReais(montarDados());
const ind = cheio.indicadores;
{
  // Diesel: 15 da van (12 regulares + sem km + absurdo + atípico) × 60 l a
  // R$ 6,00, a placa fora do cadastro (50 l a R$ 6,00 — a empresa pagou) e 6
  // do ônibus × 200 l a R$ 5,90. O de R$ 0,06/l fica fora; ARLA não é
  // combustível.
  const diesel = achar(ind, "variaveis.dieselLitro");
  perto("diesel = Σ valor ÷ Σ litros", diesel?.valor, ((15 * 60 + 50) * 6 + 6 * 200 * 5.9) / (15 * 60 + 50 + 6 * 200));
  conferir("diesel: amostra de 22 abastecimentos", diesel?.amostra, 22);
  conferir("diesel: 22 registros é confiança MÉDIA", diesel?.confianca, "MEDIA");
  ok("diesel: a base diz o registro de preço impossível que ficou fora", !!diesel?.base.includes("1 registro(s) com preço por litro fora"), diesel?.base);
  perto("gasolina (referência): R$ 6,50", achar(ind, "referencia:gasolinaLitro")?.valor, 6.5);
  conferir("gasolina: 3 registros é confiança BAIXA", achar(ind, "referencia:gasolinaLitro")?.confianca, "BAIXA");
  perto("perfil VAN: R$ 6,00", achar(ind, "perfil:VAN:variaveis.dieselLitro")?.valor, 6);
  perto("perfil ÔNIBUS: R$ 5,90", achar(ind, "perfil:ONIBUS:variaveis.dieselLitro")?.valor, 5.9);
  perto("perfil CARRO: R$ 6,50", achar(ind, "perfil:CARRO:variaveis.dieselLitro")?.valor, 6.5);
  conferir("sem micro-ônibus na frota, sem preço de micro", achar(ind, "perfil:MICRO:variaveis.dieselLitro"), undefined);
}

console.log("\nCONSUMO — km/l por tipo, com os cortes");
{
  const van = achar(ind, "perfil:VAN:variaveis.consumoAsfaltoKmL");
  // 48 regulares + o de preço impossível (540 km em 60 l, consumo normal);
  // fora: o sem km, o de 5.000 km e o de 20 km/l (Tukey).
  perto("van: 9 km/l, sem o atípico de 20 km/l", van?.valor, 9);
  conferir("van: 49 abastecimentos", van?.amostra, 49);
  conferir("van: 49 registros em 4 veículos é ALTA", van?.confianca, "ALTA");
  ok("van: a base explica a regra de exclusão", !!van?.base.includes("Regra de exclusão") && !!van?.base.includes("1 registro(s) fora"), van?.base);
  const onibus = achar(ind, "perfil:ONIBUS:variaveis.consumoAsfaltoKmL");
  perto("ônibus: 3 km/l", onibus?.valor, 3);
  conferir("ônibus: 24 registros é MÉDIA", onibus?.confianca, "MEDIA");
  ok("ônibus: avisa que são só 2 veículos", !!onibus?.avisos.some((a) => a.includes("só 2 veículo")), JSON.stringify(onibus?.avisos));
  perto("carro: 12 km/l", achar(ind, "perfil:CARRO:variaveis.consumoAsfaltoKmL")?.valor, 12);
  ok("placa fora do cadastro vira lacuna", cheio.lacunas.some((l) => l.includes("placa fora do cadastro")), JSON.stringify(cheio.lacunas));
}

console.log("\nKM DA FROTA e CUSTOS POR KM");
// Km do cartão por mês: 4 vans × 540 + 2 ônibus × 600 + carro 480 = 3.840;
// em ago/2026 mais o atípico (1.200 km: atípico para o consumo, mas km
// rodado) e o de preço impossível (540). O de 5.000 km e o sem km, fora.
const KM_TOTAL = 12 * 3840 + 1200 + 540;
{
  const manut = achar(ind, "variaveis.manutencaoAsfaltoKm");
  perto("manutenção = R$ 12.000 ÷ km da frota", manut?.valor, 12_000 / KM_TOTAL);
  conferir("manutenção: 12 meses é ALTA", manut?.confianca, "ALTA");
  conferir("manutenção: amostra em meses", manut?.amostra, 12);
  ok("manutenção: avisa que é média da frota", !!manut?.avisos.some((a) => a.includes("Média da frota inteira")));
  ok("manutenção: diz o km do uso de veículo que ficou de fora", !!manut?.avisos.some((a) => a.includes("uso de veículo") && a.includes("200 km")), JSON.stringify(manut?.avisos));
  perto("pneus = R$ 3.600 ÷ km da frota", achar(ind, "variaveis.pneusAsfaltoKm")?.valor, 3_600 / KM_TOTAL);
  conferir("óleo diesel NÃO é troca de óleo", achar(ind, "variaveis.oleoLavagemKm"), undefined);
  ok("sem categoria de óleo/lavagem vira lacuna", cheio.lacunas.some((l) => l.includes("óleo, filtros ou lavagem")));
  const km = achar(ind, "referencia:kmPorVeiculoMes");
  perto("km por veículo-mês = km ÷ 84 veículos-mês", km?.valor, KM_TOTAL / 84);
}

console.log("\nSEGURO E IPVA por veículo ativo (7: o inativo fica fora, o em manutenção entra)");
{
  const seguro = achar(ind, "veiculo.seguroMes");
  perto("seguro = R$ 2.400/mês ÷ 7", seguro?.valor, 2400 / 7);
  ok("seguro: avisa a categoria 'Seguros' em outras despesas", !!seguro?.avisos.some((a) => a.includes("Seguros (DESPESA_GERAL")), JSON.stringify(seguro?.avisos));
  const ipva = achar(ind, "veiculo.ipvaLicenciamentoAno");
  perto("IPVA = R$ 12.000/ano ÷ 7", ipva?.valor, 12_000 / 7);
  conferir("IPVA: 12 meses é ALTA", ipva?.confianca, "ALTA");
}

console.log("\nMÃO DE OBRA");
{
  const pessoa = achar(ind, "referencia:custoPorPessoaMes");
  perto("custo por pessoa = R$ 15.000/mês ÷ 10 ativas", pessoa?.valor, 1500);
  ok("a base conta os motoristas", !!pessoa?.base.includes("8 com função de motorista"), pessoa?.base);
  const encargos = achar(ind, "pessoal.encargosPct");
  perto("encargos = INSS e FGTS ÷ salários = 40%", encargos?.valor, 0.4);
  ok("vale-refeição fica fora dos encargos", !encargos?.base.includes("Vale"), encargos?.base);
  conferir("encargos: 12 meses é ALTA", encargos?.confianca, "ALTA");
}

console.log("\nADMINISTRAÇÃO E CARGA TRIBUTÁRIA");
{
  const adm = achar(ind, "indiretos.administracaoPct");
  perto("administração = (50+200+30+50) ÷ custo direto 2.670 ≈ 12,4% (sobre a receita seria 7,5%)", adm?.valor, 330 / 2670);
  conferir("administração: unidade é o custo direto, onde o motor a aplica", adm?.unidade, "% do custo direto");
  ok("administração: converte para o custo direto no aviso", !!adm?.avisos.some((a) => a.includes("CUSTO DIRETO")));
  ok("administração: avisa categoria não confirmada", !!adm?.avisos.some((a) => a.includes("apenas proposta")));
  conferir("administração: não confirmado pequeno não rebaixa", adm?.confianca, "ALTA");
  perto("carga tributária = 600 ÷ 5.000 = 12%", achar(ind, "referencia:cargaTributariaPct")?.valor, 0.12);
}

console.log("\nCONFIANÇA — classificação só proposta, base curta");
{
  const d = montarDados();
  d.categorias.find((c) => c.codigo === "2.01")!.confirmada = false;
  const manut = achar(indicadoresReais(d), "variaveis.manutencaoAsfaltoKm");
  conferir("manutenção 100% proposta cai para MÉDIA", manut?.confianca, "MEDIA");
  ok("e diz por quê", !!manut?.avisos.some((a) => a.includes("100% do valor") && a.includes("Manutenção de veículos")), JSON.stringify(manut?.avisos));

  // Base espelhada há só quatro meses: jun a set/2026.
  const curta = montarDados();
  const corta = (xs: number[]) => xs.map((v, i) => (i >= 8 ? v : 0));
  for (const c of curta.categorias) c.porMesCents = corta(c.porMesCents);
  for (const k of Object.keys(curta.linhasDre)) curta.linhasDre[k] = corta(curta.linhasDre[k]);
  curta.categorias.find((c) => c.codigo === "2.04")!.porMesCents = soNoMes(9, 300_000);
  curta.abastecimentos = curta.abastecimentos.filter((a) => a.dataHora >= new Date(2026, 5, 1));
  const r = indicadoresReais(curta);
  const seguro = achar(r, "veiculo.seguroMes");
  perto("seguro com 4 meses: divide por 4, não por 12", seguro?.valor, 2400 / 7);
  conferir("seguro com 4 meses é BAIXA", seguro?.confianca, "BAIXA");
  const ipva = achar(r, "veiculo.ipvaLicenciamentoAno");
  perto("IPVA anualizado de 4 meses", ipva?.valor, ((3000 / 4) * 12) / 7);
  conferir("IPVA de base curta é BAIXA", ipva?.confianca, "BAIXA");
  ok("IPVA de base curta avisa a sazonalidade", !!ipva?.avisos.some((a) => a.includes("começo do ano")));
  conferir("manutenção com 4 meses de km é BAIXA", achar(r, "variaveis.manutencaoAsfaltoKm")?.confianca, "BAIXA");
  conferir("administração com 4 meses de receita é BAIXA", achar(r, "indiretos.administracaoPct")?.confianca, "BAIXA");
}

console.log("\nAUSÊNCIA — sem cartão, só uso de veículo; gestão fora do ar");
{
  const semCartao = analisarCustosReais(montarDados({ abastecimentos: [] }));
  const i = semCartao.indicadores;
  conferir("sem cartão: nenhum indicador de combustível", i.filter((x) => /dieselLitro|gasolina|consumo/.test(x.caminho)).map((x) => x.caminho), []);
  ok("sem cartão: lacuna explica", semCartao.lacunas.some((l) => l.includes("Nenhum abastecimento do cartão")), JSON.stringify(semCartao.lacunas));
  // O km vem do uso de veículo: 200 km em ago/2026 (o sem km final fica fora).
  const manut = achar(i, "variaveis.manutencaoAsfaltoKm");
  perto("sem cartão: manutenção sobre o km do uso, só no mês com km", manut?.valor, 1000 / 200);
  conferir("sem cartão: 1 mês de km é BAIXA", manut?.confianca, "BAIXA");
  ok("sem cartão: avisa o custo de meses sem km que ficou fora", !!manut?.avisos.some((a) => a.includes("meses sem km")));
  ok("sem cartão: avisa o uso descartado", !!manut?.avisos.some((a) => a.includes("sem km final")));

  const nada = analisarCustosReais(montarDados({ abastecimentos: [], usos: [] }));
  conferir("sem km nenhum: nenhum custo por km", nada.indicadores.filter((x) => x.unidade === "R$/km").length, 0);
  ok("sem km nenhum: lacuna", nada.lacunas.some((l) => l.includes("Sem km da frota")));

  const fora = analisarCustosReais(
    montarDados({ gestaoDisponivel: false, abastecimentos: [], veiculos: [], pessoas: [], usos: [], avisos: ["Não foi possível ler os veículos do sistema de gestão: conexão recusada"] })
  );
  ok("gestão fora: o aviso da coleta vira lacuna", fora.lacunas.some((l) => l.includes("conexão recusada")));
  ok("gestão fora: lacuna geral", fora.lacunas.some((l) => l.includes("Sistema de gestão indisponível")));
  conferir(
    "gestão fora: só os indicadores do DRE",
    fora.indicadores.map((x) => x.caminho).sort(),
    ["indiretos.administracaoPct", "pessoal.encargosPct", "referencia:cargaTributariaPct"]
  );

  const semSeparar = montarDados();
  semSeparar.categorias = semSeparar.categorias.filter((c) => c.codigo !== "3.02");
  const r = analisarCustosReais(semSeparar);
  conferir("sem categoria de encargos: sem encargosPct", achar(r.indicadores, "pessoal.encargosPct"), undefined);
  ok("e a lacuna diz o que falta", r.lacunas.some((l) => l.includes("sem categoria de INSS")));

  const filtrado = indicadoresReais(montarDados({ conexaoFiltrada: true }));
  ok("DRE de uma empresa × frota do grupo: avisa", !!achar(filtrado, "veiculo.seguroMes")?.avisos.some((a) => a.includes("mistura escopos")));
}

console.log("\nAPLICAR os indicadores escolhidos");
{
  const { premissas: base, origem: origemBase } = premissasDaBase(null, { clientePublico: false, escolar: false, baseLocal: false });
  const antes = JSON.stringify({ base, perfis: PERFIS_PADRAO });
  const r = aplicarIndicadores(
    base,
    PERFIS_PADRAO,
    ind,
    ["variaveis.dieselLitro", "perfil:VAN:variaveis.consumoAsfaltoKmL", "pessoal.encargosPct", "referencia:kmPorVeiculoMes", "variaveis.naoExiste", "perfil:MICRO:variaveis.dieselLitro"],
    origemBase
  );
  conferir("as entradas não mudam", JSON.stringify({ base, perfis: PERFIS_PADRAO }), antes);
  perto("diesel aplicado", r.premissas.variaveis.dieselLitro, achar(ind, "variaveis.dieselLitro")!.valor);
  perto("encargos aplicados", r.premissas.pessoal.encargosPct, 0.4);
  conferir("origem do diesel é REAL", r.origem["variaveis.dieselLitro"].origem, "REAL");
  ok("a fonte diz o indicador e a confiança", r.origem["variaveis.dieselLitro"].fonte.includes("Diesel pago") && r.origem["variaveis.dieselLitro"].fonte.includes("confiança média"), r.origem["variaveis.dieselLitro"].fonte);
  ok("o detalhe traz a conta", (r.origem["variaveis.dieselLitro"].detalhe ?? "").startsWith("Σ "));
  perto("consumo da VAN aplicado ao perfil VAN", r.perfis.find((p) => p.tipo === "VAN")?.variaveis.consumoAsfaltoKmL, 9);
  conferir("origem do perfil gravada pelo código do perfil", r.origem["perfil:VAN:variaveis.consumoAsfaltoKmL"]?.origem, "REAL");
  conferir("ônibus não muda", r.perfis.find((p) => p.tipo === "ONIBUS")?.variaveis.consumoAsfaltoKmL, PERFIS_PADRAO.find((p) => p.tipo === "ONIBUS")?.variaveis.consumoAsfaltoKmL);
  conferir("global não vaza para os perfis", r.perfis.find((p) => p.tipo === "VAN")?.variaveis.dieselLitro, PERFIS_PADRAO.find((p) => p.tipo === "VAN")?.variaveis.dieselLitro);
  conferir("consumo do veículo padrão continua PADRÃO", r.origem["variaveis.consumoAsfaltoKmL"].origem, "PADRAO");
  conferir("aplicados", r.aplicados, ["variaveis.dieselLitro", "perfil:VAN:variaveis.consumoAsfaltoKmL", "pessoal.encargosPct"]);
  conferir("ignorados: referência, caminho inexistente, indicador ausente", r.ignorados, ["referencia:kmPorVeiculoMes", "variaveis.naoExiste", "perfil:MICRO:variaveis.dieselLitro"]);
  conferir("padrão intacto", PREMISSAS_PADRAO.variaveis.dieselLitro, 6.15);
}

console.log("\nINDIRETOS DA BASE vindos do DRE consolidado");
{
  const d = montarDados();
  // Dez meses com receita: os dois primeiros sem movimento não puxam a média.
  d.linhasDre.RECEITA_BRUTA = d.linhasDre.RECEITA_BRUTA.map((v, i) => (i < 2 ? 0 : v));
  d.linhasDre.DESPESA_SALARIOS_CORPORATIVO = doze(800_000).map((v, i) => (i < 2 ? 0 : v));
  d.linhasDre.DESPESA_COMERCIAL = doze(20_000);
  d.categorias.push(categoria("3.01@corporativo", "Salários e ordenados", "DESPESA_SALARIOS_CORPORATIVO", doze(500_000).map((v, i) => (i < 2 ? 0 : v))));
  d.categorias.push(categoria("3.02@corporativo", "INSS e FGTS", "DESPESA_SALARIOS_CORPORATIVO", doze(300_000).map((v, i) => (i < 2 ? 0 : v))));
  const ind = indiretosDoDre(d);
  perto("folha administrativa = pessoas — corporativo, média dos meses com receita", ind.get("folha_adm")?.valor, 8_000);
  conferir("composição da folha, maior primeiro", ind.get("folha_adm")?.composicao, [
    { descricao: "Salários e ordenados", valorMes: 5_000 },
    { descricao: "INSS e FGTS", valorMes: 3_000 },
  ]);
  perto("contabilidade = despesas administrativas", ind.get("contabilidade")?.valor, 500);
  perto("sistemas = informática", ind.get("sistemas")?.valor, 300);
  perto("sede = estrutura", ind.get("sede_garagem_sp")?.valor, 2_000);
  perto("gerais = comercial + outras despesas", ind.get("gerais")?.valor, 200 + 500);
  perto("faturamento médio = receita bruta", ind.get("faturamento_medio")?.valor, 50_000);
  ok("oficina própria não tem linha no DRE", !ind.has("oficina"));
  ok("a fonte diz o período", /média de 10 meses fechados/.test(ind.get("folha_adm")?.fonte ?? ""), ind.get("folha_adm")?.fonte);

  const baseComValor = {
    em: new Date(),
    parametros: new Map([["sistemas", { valor: 999, texto: null, fonte: "ajuste na tela", vigenciaInicio: new Date() }]]),
    veiculos: [],
    funcoes: [],
    pedagios: [],
  };
  const mesclada = baseComIndiretosDoDre(baseComValor, ind);
  conferir("valor digitado na base prevalece", mesclada.parametros.get("sistemas")?.valor, 999);
  perto("o que falta vem do DRE", mesclada.parametros.get("folha_adm")?.valor ?? undefined, 8_000);
  ok("a base original não muda", !baseComValor.parametros.has("folha_adm"));
  const semBase = baseComIndiretosDoDre(null, ind);
  conferir("sem base, nasce uma só com os indiretos", [semBase?.parametros.size, semBase?.veiculos.length], [6, 0]);
  const { premissas, origem } = premissasDaBase(semBase, { clientePublico: false, escolar: false, baseLocal: false });
  const total = 8_000 + 500 + 300 + 2_000 + 700;
  ok("a administração do estudo sai do rateio real", premissas.indiretos.administracaoPct > (total / 50_000) * 0.99, `${premissas.indiretos.administracaoPct}`);
  ok("e diz que veio do DRE", /DRE consolidado/.test(origem["indiretos.administracaoPct"]?.fonte ?? ""), origem["indiretos.administracaoPct"]?.fonte);
  conferir("DRE sem receita não traz nada", indiretosDoDre({ ...d, linhasDre: { ...d.linhasDre, RECEITA_BRUTA: doze(0) } }).size, 0);
}

console.log(falhas === 0 ? "\nTodos os testes passaram." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
