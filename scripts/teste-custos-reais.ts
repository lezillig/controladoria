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
import { baseComIndiretosDoDre, indiretosDoDre, nomesDosFornecedores, padraoDoNome } from "../src/lib/simulador/indiretosDoDre";
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
import { metodoDoTexto, PERFIS_PADRAO, PREMISSAS_PADRAO, premissasDaBase, regrasDeCapitalNosPerfis } from "../src/lib/simulador/premissas";

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
  { id: "v1", placa: "VAN0001", modelo: "Sprinter 416", tipo: "Van", status: "ATIVO", ano: 2022 },
  { id: "v2", placa: "VAN0002", modelo: "Sprinter 416", tipo: "Van", status: "ATIVO", ano: 2022 },
  { id: "v3", placa: "VAN0003", modelo: "Master", tipo: "Van", status: "ATIVO", ano: 2020 },
  { id: "v4", placa: "VAN0004", modelo: "Master", tipo: "Van", status: "MANUTENCAO", ano: 2024 },
  { id: "o1", placa: "ONI0001", modelo: "Marcopolo", tipo: "Ônibus", status: "ATIVO", ano: 2018 },
  { id: "o2", placa: "ONI0002", modelo: "Marcopolo", tipo: "Ônibus", status: "ATIVO", ano: 2018 },
  { id: "c1", placa: "CAR0001", modelo: "Corolla", tipo: "Carro executivo", status: "ATIVO", ano: 2025 },
  // Baixado: não conta no seguro nem no IPVA.
  { id: "v9", placa: "VAN0009", modelo: "Ducato", tipo: "Van", status: "INATIVO", ano: 2010 },
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
  // Idade da frota ativa em 2026 (a inativa de 2010 fora): 4, 4, 6, 2, 8, 8 e 1 → 33 ÷ 7.
  conferir("manutenção: leva a idade média da frota ativa", manut?.idadeDaFrota, 4.7);
  ok("manutenção: avisa que aplicar zera a corretiva e põe a idade", !!manut?.avisos.some((a) => a.includes("zera a corretiva") && a.includes("4,7 anos")));
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
  const adm = achar(ind, "referencia:administracaoBrutaPct");
  perto("administração = (50+200+30+50) ÷ custo direto 2.670 ≈ 12,4% (sobre a receita seria 7,5%)", adm?.valor, 330 / 2670);
  conferir("administração: unidade é o custo direto, onde o motor a aplica", adm?.unidade, "% do custo direto");
  ok("administração: converte para o custo direto no aviso", !!adm?.avisos.some((a) => a.includes("CUSTO DIRETO")));
  ok("administração: avisa categoria não confirmada", !!adm?.avisos.some((a) => a.includes("apenas proposta")));
  conferir("administração: não confirmado pequeno não rebaixa", adm?.confianca, "ALTA");
  ok("administração bruta é só referência: o estudo usa o rateio da base", !!adm?.avisos.some((a) => a.includes("Uma fonte só")));
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
  conferir("administração com 4 meses de receita é BAIXA", achar(r, "referencia:administracaoBrutaPct")?.confianca, "BAIXA");
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
    ["pessoal.encargosPct", "referencia:administracaoBrutaPct", "referencia:cargaTributariaPct"]
  );

  const semSeparar = montarDados();
  semSeparar.categorias = semSeparar.categorias.filter((c) => c.codigo !== "3.02");
  const r = analisarCustosReais(semSeparar);
  conferir("sem categoria de encargos: sem encargosPct", achar(r.indicadores, "pessoal.encargosPct"), undefined);
  ok("e a lacuna diz o que falta", r.lacunas.some((l) => l.includes("sem categoria de INSS")));

  const filtrado = indicadoresReais(montarDados({ conexaoFiltrada: true }));
  ok("DRE de uma empresa × frota do grupo: avisa", !!achar(filtrado, "veiculo.seguroMes")?.avisos.some((a) => a.includes("mistura escopos")));
}

console.log("\nSUBGRUPO DO DRE manda; o nome é o plano B");
{
  const base = montarDados();
  const antes = achar(analisarCustosReais(base).indicadores, "variaveis.manutencaoAsfaltoKm")!.valor;
  const d = montarDados();
  // "Guincho" casa com o nome de manutenção, mas está em Sinistros e socorro
  // (natureza N): fica fora. "Serviços diversos" não casa com o nome, mas a
  // pessoa o pôs em Manutenção e peças: entra.
  d.categorias.push({ ...categoria("4.90", "Guincho", "DESPESA_VEICULOS", doze(100_000)), subgrupo: "Sinistros e socorro" });
  d.categorias.push({ ...categoria("4.91", "Serviços diversos", "DESPESA_VEICULOS", doze(50_000)), subgrupo: "Manutenção e peças" });
  const depois = achar(analisarCustosReais(d).indicadores, "variaveis.manutencaoAsfaltoKm")!.valor;
  perto("guincho fora, serviços diversos dentro: + R$ 6.000 no ano ÷ km", depois - antes, (12 * 500) / KM_TOTAL);
  const arla = montarDados();
  arla.categorias.push({ ...categoria("4.92", "ARLA 32", "DESPESA_VEICULOS", doze(80_000)), subgrupo: "ARLA, óleo e lubrificantes" });
  conferir("ARLA no subgrupo de óleo não entra no óleo por km (vem do cartão)", achar(analisarCustosReais(arla).indicadores, "variaveis.oleoLavagemKm")?.valor, achar(analisarCustosReais(base).indicadores, "variaveis.oleoLavagemKm")?.valor);
}

console.log("\nCARTÃO SEM VEÍCULO VINCULADO: liga pela placa do extrato");
{
  // O mesmo extrato, mas os abastecimentos das vans chegam sem vehicleId e com
  // a placa (com traço e minúscula): o km da frota tem de ser o mesmo.
  const comId = montarDados();
  const semId = montarDados();
  semId.abastecimentos = semId.abastecimentos.map((a) => {
    const v = VEICULOS.find((x) => x.id === a.vehicleId);
    return v && v.tipo === "Van" ? { ...a, vehicleId: null, placa: `${v.placa.slice(0, 3).toLowerCase()}-${v.placa.slice(3)}` } : a;
  });
  const a = analisarCustosReais(comId);
  const b = analisarCustosReais(semId);
  perto("manutenção por km igual com o vínculo pela placa", achar(b.indicadores, "variaveis.manutencaoAsfaltoKm")?.valor, achar(a.indicadores, "variaveis.manutencaoAsfaltoKm")!.valor);
  ok("diz quantos foram ligados pela placa", b.lacunas.some((l) => l.includes("ligados ao cadastro pela placa")), JSON.stringify(b.lacunas));
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

  // Manutenção medida: já é a de uma frota com 4,7 anos e já traz a
  // corretiva — o estudo não pode corrigir de novo pela idade nem somá-la.
  const m = aplicarIndicadores(base, PERFIS_PADRAO, ind, ["variaveis.manutencaoAsfaltoKm"], origemBase);
  perto("manutenção real aplicada", m.premissas.variaveis.manutencaoAsfaltoKm, achar(ind, "variaveis.manutencaoAsfaltoKm")!.valor);
  conferir("corretiva zerada, com origem REAL", [m.premissas.variaveis.corretivaKm, m.origem["variaveis.corretivaKm"]?.origem], [0, "REAL"]);
  conferir("idade de referência = idade da frota", [m.premissas.veiculo.idadeReferenciaManutencao, m.origem["veiculo.idadeReferenciaManutencao"]?.origem], [4.7, "REAL"]);
  conferir("a base não muda", base.variaveis.corretivaKm, PREMISSAS_PADRAO.variaveis.corretivaKm);
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
  // O ESCRITÓRIO CONTRATADO: pagamentos a ele são a contabilidade, e saem da
  // linha onde estão classificados; o resto das administrativas vai para
  // "gerais". O total dos indiretos não muda.
  const soma = (m: Map<string, { valor: number }>) => [...m].filter(([k]) => k !== "faturamento_medio").reduce((a, [, v]) => a + v.valor, 0);
  const jl = { nome: "JL Business", porCategoria: new Map([["4.02", doze(30_000).map((v, i) => (i < 2 ? 0 : v))]]) };
  const comJl = indiretosDoDre(d, jl);
  perto("contabilidade = pagamentos à JL Business", comJl.get("contabilidade")?.valor, 300);
  ok("a fonte diz o fornecedor", /^JL Business — pagamentos no Omie/.test(comJl.get("contabilidade")?.fonte ?? ""), comJl.get("contabilidade")?.fonte);
  perto("gerais = comerciais + outras + administrativas sem a JL", comJl.get("gerais")?.valor, 200 + 500 + (500 - 300));
  perto("o total dos indiretos é o mesmo do DRE", soma(comJl), soma(ind));
  conferir("sem pagamento na janela, a linha do DRE", indiretosDoDre(d, { nome: "JL Business", porCategoria: new Map() }).get("contabilidade")?.valor, 500);
  conferir("padrão do nome: cada palavra pelo início", padraoDoNome("JL Bussiness"), "%JL%BUS%");
  conferir("acentos e caixa não importam", padraoDoNome("  Jl Contábil  "), "%JL%CON%");
  conferir("nome vazio desliga o fornecedor", padraoDoNome("  "), null);
  conferir("uma palavra só vai inteira", padraoDoNome("Joel"), "%JOEL%");
  conferir("vários fornecedores por ponto e vírgula", nomesDosFornecedores("JL Business; Joel ;"), ["JL Business", "Joel"]);
  const doisFornecedores = indiretosDoDre(d, {
    nome: "JL Business e Joel",
    porCategoria: new Map([["4.02", doze(40_000).map((v, i) => (i < 2 ? 0 : v))]]),
    porNome: new Map([["JL Business", doze(30_000).map((v, i) => (i < 2 ? 0 : v))], ["Joel", doze(10_000).map((v, i) => (i < 2 ? 0 : v))]]),
  });
  perto("contabilidade e jurídico somam os dois fornecedores", doisFornecedores.get("contabilidade")?.valor, 400);
  conferir("a composição mostra cada fornecedor", doisFornecedores.get("contabilidade")?.composicao, [{ descricao: "JL Business", valorMes: 300 }, { descricao: "Joel", valorMes: 100 }]);
  // A OFICINA é um centro de custo da folha corporativa: sai da folha
  // administrativa, e o total não muda.
  const comOficina = indiretosDoDre(d, null, { centros: ["Oficina"], porMes: doze(200_000).map((v, i) => (i < 2 ? 0 : v)) });
  perto("oficina própria = folha do centro de custo Oficina", comOficina.get("oficina")?.valor, 2_000);
  perto("folha administrativa sem a oficina", comOficina.get("folha_adm")?.valor, 6_000);
  ok("a fonte da folha diz que tirou a oficina", /sem a oficina$/.test(comOficina.get("folha_adm")?.fonte ?? ""), comOficina.get("folha_adm")?.fonte);
  perto("com a oficina, o total dos indiretos é o mesmo", soma(comOficina), soma(ind));
  conferir("DRE sem receita não traz nada", indiretosDoDre({ ...d, linhasDre: { ...d.linhasDre, RECEITA_BRUTA: doze(0) } }).size, 0);
}

console.log("\nREGRAS DE CAPITAL E DEPRECIAÇÃO da Azul Mob");
{
  const valor = (v: number | null, texto: string | null = null) => ({ valor: v, texto, fonte: "ajuste na tela", vigenciaInicio: new Date() });
  const base = {
    em: new Date(),
    parametros: new Map([
      ["capital_proprio_aa", valor(0.105)],
      ["fracao_financiada", valor(0.6)],
      ["depreciacao_metodo", valor(null, "Soma dos dígitos (Cole)")],
      ["vida_util_anos", valor(7)],
      ["valor_residual_pct", valor(0.25)],
    ]),
    veiculos: [],
    funcoes: [],
    pedagios: [],
  };
  const { premissas, origem } = premissasDaBase(base, { clientePublico: false, escolar: false, baseLocal: false });
  conferir(
    "capital: próprio, financiado e composto ligado; taxa do financiamento fica a padrão",
    [premissas.veiculo.custoCapitalProprioAa, premissas.veiculo.fracaoFinanciada, premissas.veiculo.capitalComposto, premissas.veiculo.taxaFinanciamentoAa],
    [0.105, 0.6, true, PREMISSAS_PADRAO.veiculo.taxaFinanciamentoAa]
  );
  conferir("depreciação: soma dos dígitos, 7 anos, 25% residual", [premissas.veiculo.metodoDepreciacao, premissas.veiculo.vidaUtilAnos, premissas.veiculo.valorResidualPct], ["SOMA_DIGITOS", 7, 0.25]);
  conferir("a origem é a base", [origem["veiculo.custoCapitalProprioAa"].origem, origem["veiculo.metodoDepreciacao"].origem], ["BASE", "BASE"]);
  premissas.perfis = PERFIS_PADRAO.map((x) => structuredClone(x));
  regrasDeCapitalNosPerfis(premissas, origem);
  ok(
    "todos os tipos de veículo recebem as regras",
    premissas.perfis.every((x) => x.veiculo.custoCapitalProprioAa === 0.105 && x.veiculo.metodoDepreciacao === "SOMA_DIGITOS" && x.veiculo.capitalComposto === true && x.veiculo.vidaUtilAnos === 7)
  );
  ok("o que não veio da base fica como o tipo tinha", premissas.perfis.every((x, i) => x.veiculo.taxaFinanciamentoAa === PERFIS_PADRAO[i].veiculo.taxaFinanciamentoAa));
  conferir("método pelo texto", [metodoDoTexto("linear"), metodoDoTexto("GEIPOT"), metodoDoTexto("percentual a.a."), metodoDoTexto("?")], ["LINEAR", "SOMA_DIGITOS", "PERCENTUAL", null]);
}

console.log(falhas === 0 ? "\nTodos os testes passaram." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
