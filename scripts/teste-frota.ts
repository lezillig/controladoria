// TESTES DO ANTIFRAUDE DE FROTA — `npm run teste:frota`.
//
// Combustível é onde o dinheiro de transportadora vaza em gotas: um tanque a
// mais, um posto 10% mais caro, um veículo parado que abastece. As regras
// olham o extrato do cartão transação por transação, e cada uma tem um caso
// que precisa apontar e um caso legítimo que precisa deixar em paz.
//
// Sem banco: o contexto é montado à mão, como nos outros conjuntos.
import { auditarFrota, familiaDoCombustivel, percentil } from "../src/lib/controladoria/agents/frota";
import type { ContextoAuditoria } from "../src/lib/controladoria/types";
import type { AbastecimentoGestao, EscalaGestao, UsoDeVeiculoGestao, VeiculoGestao } from "../src/lib/gestao/leitura";

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(
    `${ok ? "  ok  " : "FALHA "} ${nome}` +
      (ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         obtido   ${JSON.stringify(real)}`)
  );
}

const HOJE = new Date("2026-08-25T00:00:00");
const d = (iso: string) => new Date(iso);

let seq = 0;
const abastecimento = (p: Partial<AbastecimentoGestao> & { dataHora: Date }): AbastecimentoGestao => ({
  id: `a${++seq}`,
  vehicleId: "v1",
  driverId: "m1",
  valorCents: 60_000,
  volumeLitros: 100,
  kmRodados: null,
  placaOriginal: "ABC1D23",
  combustivel: "DIESEL S10",
  posto: "POSTO CENTRAL",
  cidade: "CAMPINAS",
  uf: "SP",
  hodometro: null,
  motoristaOriginal: null,
  modeloOriginal: null,
  ...p,
});

const veiculo = (p: Partial<VeiculoGestao> = {}): VeiculoGestao => ({
  id: "v1",
  plate: "ABC1D23",
  status: "ATIVO",
  currentMileage: 0,
  model: "SPRINTER",
  type: "VAN",
  ...p,
});

function contexto(p: {
  abastecimentos: AbastecimentoGestao[];
  veiculos?: VeiculoGestao[];
  usosDeVeiculo?: UsoDeVeiculoGestao[];
  escalas?: EscalaGestao[];
}): ContextoAuditoria {
  return {
    companyId: "c",
    conexaoId: null,
    dataReferencia: HOJE,
    agora: HOJE,
    janelaDesde: d("2025-01-01"),
    titulos: [],
    baixas: [],
    movimentos: [],
    notas: [],
    parceiros: [],
    categorias: [],
    departamentos: [],
    vinculos: [],
    contasCorrentes: [],
    config: {},
    motoristas: [{ id: "m1", name: "JOSE DA SILVA", cpf: "00000000000", active: true, valorHoraCents: null, clienteId: null, departamento: null }],
    veiculos: p.veiculos ?? [veiculo()],
    abastecimentos: p.abastecimentos,
    usosDeVeiculo: p.usosDeVeiculo,
    escalas: p.escalas,
    gestao: { disponivel: true, erro: null },
  } as unknown as ContextoAuditoria;
}

const rodar = (ctx: ContextoAuditoria, regra: string) => auditarFrota(ctx).filter((a) => a.regra === regra);

// Doze abastecimentos "normais" de 100 L, um por semana, para dar base ao
// veículo — todos com hodômetro coerente (500 km entre eles = 5 km/L).
function historicoNormal(inicio = "2026-05-01", litros = 100): AbastecimentoGestao[] {
  const lista: AbastecimentoGestao[] = [];
  const base = d(inicio);
  for (let i = 0; i < 12; i++) {
    const data = new Date(base);
    data.setDate(base.getDate() + i * 7);
    lista.push(abastecimento({ dataHora: data, volumeLitros: litros, valorCents: litros * 600, hodometro: 100_000 + i * 500 }));
  }
  return lista;
}

// -------------------------------------------------------------- percentil
console.log("\npercentil — a base do tanque plausível");
conferir("p90 de 1..10 é 9,1", Math.round(percentil([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9) * 10) / 10, 9.1);
conferir("lista vazia dá 0", percentil([], 0.9), 0);

// ------------------------------------------------------ FR-COMBUSTIVEL-VOLUME
console.log("\nFR-COMBUSTIVEL-VOLUME — mais litros do que o tanque comporta");
{
  const historico = historicoNormal();
  const ctx = contexto({ abastecimentos: historico });
  conferir("doze abastecimentos iguais não são achado", rodar(ctx, "FR-COMBUSTIVEL-VOLUME").length, 0);
}
{
  // 100 L típicos → tanque plausível 150 L. Um abastecimento de 220 L não coube.
  const historico = historicoNormal();
  const fora = abastecimento({ dataHora: d("2026-08-10T10:00:00"), volumeLitros: 220, valorCents: 220 * 600 });
  const ctx = contexto({ abastecimentos: [...historico, fora] });
  const a = rodar(ctx, "FR-COMBUSTIVEL-VOLUME");
  conferir("220 L num tanque de 150 L é achado", a.length, 1);
  conferir("um achado por veículo e mês, com a placa", a[0]?.entidadeRef, "ABC1D23");
  conferir("o valor é só o excedente (70 L x R$ 6,00)", a[0]?.valorCents, 70 * 600);
  conferir("categoria fraude, a verificar", a[0]?.categoria, "FRAUDE");
  conferir("a chave carrega o mês", a[0]?.chave, "FR-COMBUSTIVEL-VOLUME|v1|08/2026");
}
{
  // 120 L cabe (abaixo de 150 + 20 de folga): não é achado.
  const historico = historicoNormal();
  const quaseCheio = abastecimento({ dataHora: d("2026-08-10T10:00:00"), volumeLitros: 160, valorCents: 160 * 600 });
  const ctx = contexto({ abastecimentos: [...historico, quaseCheio] });
  conferir("160 L (10 L acima do tanque) é folga de bomba, não achado", rodar(ctx, "FR-COMBUSTIVEL-VOLUME").length, 0);
}
{
  // Dois abastecimentos de 100 L com 3 horas de diferença: 200 L num tanque de 150.
  const historico = historicoNormal();
  const primeiro = abastecimento({ dataHora: d("2026-08-10T08:00:00"), volumeLitros: 100 });
  const segundo = abastecimento({ dataHora: d("2026-08-10T11:00:00"), volumeLitros: 100 });
  const ctx = contexto({ abastecimentos: [...historico, primeiro, segundo] });
  const a = rodar(ctx, "FR-COMBUSTIVEL-VOLUME");
  conferir("dois tanques em 3 horas é achado", a.length, 1);
  conferir("aponta o segundo, com a soma na leitura", (a[0]?.evidencia?.casos as { modo: string }[])[0]?.modo.startsWith("soma de 200"), true);
}
{
  // Veículo novo (3 abastecimentos) sem modelo conhecido: sem base, sem achado.
  const novo = [
    abastecimento({ dataHora: d("2026-08-01"), vehicleId: "v9", placaOriginal: "NOV0A00", volumeLitros: 300 }),
    abastecimento({ dataHora: d("2026-08-08"), vehicleId: "v9", placaOriginal: "NOV0A00", volumeLitros: 300 }),
    abastecimento({ dataHora: d("2026-08-15"), vehicleId: "v9", placaOriginal: "NOV0A00", volumeLitros: 300 }),
  ];
  const ctx = contexto({ abastecimentos: novo, veiculos: [veiculo({ id: "v9", plate: "NOV0A00", model: "ÔNIBUS" })] });
  conferir("veículo sem história e sem modelo na frota fica calado", rodar(ctx, "FR-COMBUSTIVEL-VOLUME").length, 0);
}
{
  // Veículo novo do MESMO modelo que a frota conhece (15+ abastecimentos do
  // modelo): o tanque do modelo vale para ele.
  const frotaDoModelo = [...historicoNormal("2026-04-01"), ...historicoNormal("2026-04-03").map((a) => ({ ...a, id: `${a.id}b`, vehicleId: "v2", placaOriginal: "DEF4G56" }))];
  const novo = abastecimento({ dataHora: d("2026-08-10"), vehicleId: "v9", placaOriginal: "NOV0A00", volumeLitros: 300, valorCents: 300 * 600 });
  const ctx = contexto({
    abastecimentos: [...frotaDoModelo, novo],
    veiculos: [veiculo(), veiculo({ id: "v2", plate: "DEF4G56" }), veiculo({ id: "v9", plate: "NOV0A00" })],
  });
  const a = rodar(ctx, "FR-COMBUSTIVEL-VOLUME");
  conferir("veículo novo herda o tanque do modelo", a.length, 1);
  conferir("e a evidência diz de onde veio o tanque", String(a[0]?.evidencia?.baseDoTanque).includes("modelo SPRINTER"), true);
}

// ----------------------------------------------------- FR-COMBUSTIVEL-CONSUMO
console.log("\nFR-COMBUSTIVEL-CONSUMO — litros que não viraram quilômetro");
{
  const ctx = contexto({ abastecimentos: historicoNormal() });
  conferir("consumo constante de 5 km/L não é achado", rodar(ctx, "FR-COMBUSTIVEL-CONSUMO").length, 0);
}
{
  // Último intervalo: 100 L para 100 km = 1 km/L, contra 5 típicos.
  const historico = historicoNormal();
  const ultimo = historico[historico.length - 1];
  const suspeito = abastecimento({
    dataHora: new Date(ultimo.dataHora.getTime() + 7 * 86_400_000),
    volumeLitros: 100,
    valorCents: 60_000,
    hodometro: (ultimo.hodometro as number) + 100,
  });
  const ctx = contexto({ abastecimentos: [...historico, suspeito] });
  const a = rodar(ctx, "FR-COMBUSTIVEL-CONSUMO");
  conferir("1 km/L contra 5 típicos é achado", a.length, 1);
  // 100 km a 5 km/L consomem 20 L; 80 L não rodaram → R$ 48,00.
  conferir("o valor é dos litros que não rodaram", a[0]?.valorCents, 80 * 600);
  conferir("o consumo típico está na evidência", a[0]?.evidencia?.kmPorLitroTipico, 5);
}
{
  // Hodômetro que anda para trás entra no mesmo achado.
  const historico = historicoNormal();
  const ultimo = historico[historico.length - 1];
  const regressao = abastecimento({
    dataHora: new Date(ultimo.dataHora.getTime() + 7 * 86_400_000),
    hodometro: (ultimo.hodometro as number) - 2_000,
  });
  const ctx = contexto({ abastecimentos: [...historico, regressao] });
  const a = rodar(ctx, "FR-COMBUSTIVEL-CONSUMO");
  conferir("hodômetro para trás é achado", a.length, 1);
  conferir("e a leitura diz isso", String((a[0]?.evidencia?.casos as { leitura: string }[])[0]?.leitura).includes("para trás"), true);
}
{
  // Sem hodômetro não há consumo — e não há achado, por mais estranho que
  // seja o volume (isso é da regra de volume).
  const semHodometro = historicoNormal().map((a) => ({ ...a, hodometro: null }));
  const ctx = contexto({ abastecimentos: semHodometro });
  conferir("sem hodômetro a regra fica calada", rodar(ctx, "FR-COMBUSTIVEL-CONSUMO").length, 0);
}

// ------------------------------------------------- FR-COMBUSTIVEL-SEM-OPERACAO
console.log("\nFR-COMBUSTIVEL-SEM-OPERACAO — abasteceu num dia em que não rodou");
{
  const historico = historicoNormal();
  // Escala em todos os dias de abastecimento, menos o último.
  const escalas: EscalaGestao[] = historico.slice(0, -1).map((a) => ({ vehicleId: "v1", driverId: "m1", date: new Date(a.dataHora) }));
  const ctx = contexto({ abastecimentos: historico, escalas });
  const a = rodar(ctx, "FR-COMBUSTIVEL-SEM-OPERACAO");
  conferir("um abastecimento sem escala, numa empresa que registra escala, é achado", a.length, 1);
  conferir("com o valor do abastecimento", a[0]?.valorCents, 60_000);
}
{
  // Empresa que não registra escala: só 2 de 12 têm escala → cobertura 17%,
  // a regra não pode apontar os outros dez.
  const historico = historicoNormal();
  const escalas: EscalaGestao[] = historico.slice(0, 2).map((a) => ({ vehicleId: "v1", driverId: "m1", date: new Date(a.dataHora) }));
  const ctx = contexto({ abastecimentos: historico, escalas });
  conferir("cobertura baixa de escala cala a regra", rodar(ctx, "FR-COMBUSTIVEL-SEM-OPERACAO").length, 0);
}
{
  // Uso real (check-in) vale como operação, mesmo sem escala.
  const historico = historicoNormal();
  const usos: UsoDeVeiculoGestao[] = historico.map((a) => ({
    vehicleId: "v1",
    driverId: "m1",
    checkInAt: new Date(a.dataHora.getTime() - 3_600_000),
    checkOutAt: new Date(a.dataHora.getTime() + 5 * 3_600_000),
    kmInicial: 0,
    kmFinal: 100,
  }));
  const ctx = contexto({ abastecimentos: historico, usosDeVeiculo: usos });
  conferir("check-in cobrindo o dia é operação", rodar(ctx, "FR-COMBUSTIVEL-SEM-OPERACAO").length, 0);
}
{
  const ctx = contexto({ abastecimentos: historicoNormal() });
  conferir("sem escala nem uso carregados, nada é apontado", rodar(ctx, "FR-COMBUSTIVEL-SEM-OPERACAO").length, 0);
}

// ------------------------------------------------ FR-COMBUSTIVEL-FORA-DA-FROTA
console.log("\nFR-COMBUSTIVEL-FORA-DA-FROTA — placa que não é da empresa, veículo inativo");
{
  const historico = historicoNormal();
  const estranha = [
    abastecimento({ dataHora: d("2026-08-01"), vehicleId: null, placaOriginal: "XYZ-9Z99", valorCents: 40_000 }),
    abastecimento({ dataHora: d("2026-08-15"), vehicleId: null, placaOriginal: "XYZ9Z99", valorCents: 40_000 }),
  ];
  const ctx = contexto({ abastecimentos: [...historico, ...estranha] });
  const a = rodar(ctx, "FR-COMBUSTIVEL-FORA-DA-FROTA");
  conferir("placa sem veículo, com 86% da frota vinculada, é achado", a.length, 1);
  conferir("uma placa normalizada, um achado", a[0]?.entidadeRef, "XYZ9Z99");
  conferir("com a soma dos abastecimentos", a[0]?.valorCents, 80_000);
  conferir("é ESTADO: some quando a placa for cadastrada", a[0]?.tipo, "ESTADO");
}
{
  // Cadastro incompleto (metade sem vínculo): a regra não pode apontar
  // placa por placa — apontaria a frota inteira.
  const historico = historicoNormal();
  const semVinculo = historico.map((a) => ({ ...a, id: `${a.id}s`, vehicleId: null, placaOriginal: `PL${a.id}` }));
  const ctx = contexto({ abastecimentos: [...historico, ...semVinculo] });
  conferir("vínculo incompleto cala a regra de placa", rodar(ctx, "FR-COMBUSTIVEL-FORA-DA-FROTA").length, 0);
}
{
  // Veículo INATIVO abastecendo nos últimos 30 dias (histórico semanal de
  // 10/06 a 26/08: cinco abastecimentos caem depois de 26/07).
  const historico = historicoNormal("2026-06-10");
  const ctx = contexto({ abastecimentos: historico, veiculos: [veiculo({ status: "INATIVO" })] });
  const a = rodar(ctx, "FR-COMBUSTIVEL-FORA-DA-FROTA");
  conferir("veículo inativo que abastece é achado", a.length, 1);
  conferir("só os abastecimentos dos últimos 30 dias contam", a[0]?.evidencia?.quantidade, 5);
}
{
  // Inativo cujo último abastecimento tem mais de 30 dias: o status é o de
  // hoje, e ele pode ter sido desativado depois — não aponta.
  const ctx = contexto({ abastecimentos: historicoNormal("2026-03-01"), veiculos: [veiculo({ status: "INATIVO" })] });
  conferir("inativo sem abastecimento recente fica calado", rodar(ctx, "FR-COMBUSTIVEL-FORA-DA-FROTA").length, 0);
}

// ---------------------------------------------------- FR-COMBUSTIVEL-PRODUTO
console.log("\nFR-COMBUSTIVEL-PRODUTO — o veículo não usa esse combustível");
conferir("famílias: diesel", familiaDoCombustivel("Diesel S10"), "DIESEL");
conferir("famílias: gasolina", familiaDoCombustivel("GASOLINA ADITIVADA"), "OTTO");
conferir("famílias: etanol", familiaDoCombustivel("Etanol"), "OTTO");
conferir("famílias: arla é à parte", familiaDoCombustivel("ARLA 32"), "ARLA");
conferir("famílias: desconhecido", familiaDoCombustivel("LUBRIFICANTE"), null);
{
  const historico = historicoNormal();
  const gasolina = abastecimento({ dataHora: d("2026-08-12"), combustivel: "GASOLINA COMUM", volumeLitros: 40, valorCents: 24_000 });
  const ctx = contexto({ abastecimentos: [...historico, gasolina] });
  const a = rodar(ctx, "FR-COMBUSTIVEL-PRODUTO");
  conferir("gasolina num veículo a diesel é achado", a.length, 1);
  conferir("com o valor do abastecimento errado", a[0]?.valorCents, 24_000);
}
{
  const historico = historicoNormal();
  const arla = abastecimento({ dataHora: d("2026-08-12"), combustivel: "ARLA 32", volumeLitros: 20, valorCents: 6_000 });
  const ctx = contexto({ abastecimentos: [...historico, arla] });
  conferir("Arla num veículo a diesel é normal", rodar(ctx, "FR-COMBUSTIVEL-PRODUTO").length, 0);
}

// ------------------------------------------------------ FR-COMBUSTIVEL-PRECO
console.log("\nFR-COMBUSTIVEL-PRECO — o posto que cobra acima da frota");
{
  // Mesmo mês, mesmo produto: 4 postos a R$ 6,00 e um a R$ 6,90 (15% acima).
  const lista: AbastecimentoGestao[] = [];
  for (const posto of ["POSTO A", "POSTO B", "POSTO C", "POSTO D"]) {
    for (let i = 0; i < 3; i++) lista.push(abastecimento({ dataHora: d(`2026-07-${10 + i}`), posto, volumeLitros: 100, valorCents: 60_000 }));
  }
  for (let i = 0; i < 3; i++) lista.push(abastecimento({ dataHora: d(`2026-07-${20 + i}`), posto: "POSTO CARO", volumeLitros: 100, valorCents: 69_000 }));
  const ctx = contexto({ abastecimentos: lista });
  const a = rodar(ctx, "FR-COMBUSTIVEL-PRECO");
  conferir("posto 15% acima da frota é achado", a.length, 1);
  conferir("nomeia o posto", a[0]?.entidadeRef, "POSTO CARO");
  conferir("sobrepreço = (6,90 − 6,00) x 300 L", a[0]?.valorCents, 90 * 300);
  conferir("os baratos não aparecem", a.filter((x) => x.entidadeRef !== "POSTO CARO").length, 0);
}
{
  // Posto 15% acima da frota mas DENTRO da ANP: é a frota que compra barato.
  const lista: AbastecimentoGestao[] = [];
  for (const posto of ["POSTO A", "POSTO B", "POSTO C", "POSTO D"]) {
    for (let i = 0; i < 3; i++) lista.push(abastecimento({ dataHora: d(`2026-07-${10 + i}`), posto, volumeLitros: 100, valorCents: 60_000 }));
  }
  for (let i = 0; i < 3; i++) lista.push(abastecimento({ dataHora: d(`2026-07-${20 + i}`), posto: "POSTO CARO", volumeLitros: 100, valorCents: 69_000 }));
  const ctx = contexto({ abastecimentos: lista });
  ctx.precosAnp = [{ uf: "SP", produto: "OLEO DIESEL S10", semanaInicio: d("2026-07-01"), semanaFim: d("2026-07-31"), precoMedioCents: 680 }];
  conferir("dentro da ANP não é achado", rodar(ctx, "FR-COMBUSTIVEL-PRECO").length, 0);
}
{
  // Poucos postos no mês: não há "frota" para comparar.
  const lista: AbastecimentoGestao[] = [];
  for (let i = 0; i < 6; i++) lista.push(abastecimento({ dataHora: d(`2026-07-${10 + i}`), posto: "POSTO A", valorCents: 60_000 }));
  for (let i = 0; i < 6; i++) lista.push(abastecimento({ dataHora: d(`2026-07-${20 + i}`), posto: "POSTO CARO", valorCents: 69_000 }));
  const ctx = contexto({ abastecimentos: lista });
  conferir("dois postos só não formam referência", rodar(ctx, "FR-COMBUSTIVEL-PRECO").length, 0);
}

// -------------------------------------------------- FR-COMBUSTIVEL-MOTORISTA
console.log("\nFR-COMBUSTIVEL-MOTORISTA — um motorista, vários veículos no mesmo dia");
{
  const dia = [
    abastecimento({ dataHora: d("2026-08-10T08:00:00"), vehicleId: "v1" }),
    abastecimento({ dataHora: d("2026-08-10T09:00:00"), vehicleId: "v2" }),
    abastecimento({ dataHora: d("2026-08-10T10:00:00"), vehicleId: "v3" }),
  ];
  const outrosDias = [
    abastecimento({ dataHora: d("2026-08-03T08:00:00"), vehicleId: "v1" }),
    abastecimento({ dataHora: d("2026-08-17T08:00:00"), vehicleId: "v1" }),
    abastecimento({ dataHora: d("2026-08-24T08:00:00"), vehicleId: "v1" }),
  ];
  const ctx = contexto({ abastecimentos: [...dia, ...outrosDias] });
  const a = rodar(ctx, "FR-COMBUSTIVEL-MOTORISTA");
  conferir("três veículos num dia, fora da rotina, é achado BAIXA", a[0]?.severidade, "BAIXA");
  conferir("nomeia a pessoa", a[0]?.entidadeRef, "JOSE DA SILVA");
}
{
  // Quem abastece a frota toda todo dia é o manobrista: INFO.
  const lista: AbastecimentoGestao[] = [];
  for (let dia = 1; dia <= 4; dia++) {
    for (const v of ["v1", "v2", "v3"]) lista.push(abastecimento({ dataHora: d(`2026-08-0${dia}T08:00:00`), vehicleId: v }));
  }
  const ctx = contexto({ abastecimentos: lista });
  const a = rodar(ctx, "FR-COMBUSTIVEL-MOTORISTA");
  conferir("rotina de pátio é informativo", a[0]?.severidade, "INFO");
}

// ------------------------------------------------------------------ vazio
console.log("\nContexto sem abastecimento");
conferir("sem extrato do cartão, nada é emitido", auditarFrota(contexto({ abastecimentos: [] })).length, 0);

console.log(falhas === 0 ? "\nTodos os casos passaram." : `\n${falhas} caso(s) falharam.`);
process.exit(falhas === 0 ? 0 : 1);
