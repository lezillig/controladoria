// TESTES DO AGENTE DE PESSOAL — `npm run teste:pessoal`.
//
// O que se paga a CPF de gente da folha, cruzado com o rastro operacional da
// gestão: ponto, escala, uso de veículo, cartão de frota e afastamento. Cada
// regra tem o caso que precisa apontar, o caso legítimo que precisa deixar
// em paz e o caso em que o dado não veio — e aí a regra fica calada em vez
// de inventar.
//
// Sem banco: o contexto é montado à mão, como nos outros conjuntos.
import { auditarPessoal } from "../src/lib/controladoria/agents/pessoal";
import type { ContextoAuditoria } from "../src/lib/controladoria/types";
import type {
  AbastecimentoGestao,
  AfastamentoGestao,
  EscalaGestao,
  MotoristaGestao,
  PontoGestao,
  UsoDeVeiculoGestao,
} from "../src/lib/gestao/leitura";

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

type Titulo = ContextoAuditoria["titulos"][number];

// CPF "sintético" por número: a regra só compara dígitos, não valida.
const cpf = (n: number) => String(n).padStart(11, "0");

const motorista = (p: Partial<MotoristaGestao> & { id: string }): MotoristaGestao => ({
  name: `MOTORISTA ${p.id.toUpperCase()}`,
  cpf: cpf(Number(p.id.replace(/\D/g, "")) || 1),
  active: true,
  valorHoraCents: null,
  clienteId: null,
  departamento: "LINHA SUL",
  admissao: d("2024-01-10"),
  funcao: "MOTORISTA DE MICRO ONIBUS",
  empregador: "AZUL MOB",
  ...p,
});

let seq = 0;
// Título a pagar ao CPF do motorista `para`, na categoria informada.
const titulo = (para: MotoristaGestao, p: Partial<Titulo> = {}): Titulo =>
  ({
    id: `t${++seq}`,
    companyId: "c",
    conexaoId: "x",
    conexaoApelido: "AZUL",
    natureza: "PAGAR",
    codigoLancamento: `L${seq}`,
    cancelado: false,
    liquidado: true,
    status: "PAGO",
    parceiroNome: para.name,
    parceiroDocumento: para.cpf,
    parceiroCodigo: `P${para.id}`,
    contaCorrenteCodigo: "100",
    numeroDocumento: null,
    numeroParcela: null,
    categoriaCodigo: "2.03.01",
    categoriaDescricao: "Diárias de viagem",
    dataEmissao: d("2026-07-01"),
    dataVencimento: d("2026-07-05"),
    dataUltimaBaixa: d("2026-07-05"),
    valorDocumentoCents: 80_00,
    valorPagoCents: 80_00,
    jurosCents: 0,
    multaCents: 0,
    descontoCents: 0,
    tarifaCents: 0,
    ...p,
  }) as Titulo;

const ponto = (driverId: string, dia: string): PontoGestao => ({ driverId, date: d(dia), clockIn: "06:00", clockOut: "15:00" });
const escala = (driverId: string, dia: string): EscalaGestao => ({ vehicleId: "v1", driverId, date: d(dia) });
const uso = (driverId: string, dia: string): UsoDeVeiculoGestao => ({
  vehicleId: "v1",
  driverId,
  checkInAt: d(`${dia}T06:00:00`),
  checkOutAt: d(`${dia}T15:00:00`),
  kmInicial: 0,
  kmFinal: 100,
});
const abastecimento = (driverId: string, dia: string): AbastecimentoGestao => ({
  id: `a${++seq}`,
  vehicleId: "v1",
  driverId,
  dataHora: d(`${dia}T10:00:00`),
  valorCents: 30_000,
  volumeLitros: 50,
  kmRodados: null,
  placaOriginal: "ABC1D23",
  combustivel: "DIESEL S10",
  posto: "POSTO",
  cidade: null,
  uf: null,
  hodometro: null,
  motoristaOriginal: null,
  modeloOriginal: null,
});
const afastamento = (driverId: string, leaveType: string, inicio: string, fim: string, paidLeave = true): AfastamentoGestao => ({
  driverId,
  leaveType,
  startDate: d(inicio),
  endDate: d(fim),
  paidLeave,
});

// Ponto em N dias úteis consecutivos a partir de uma data.
function pontos(driverId: string, inicio: string, dias: number): PontoGestao[] {
  const lista: PontoGestao[] = [];
  const base = d(inicio);
  for (let i = 0; lista.length < dias; i++) {
    const data = new Date(base);
    data.setDate(base.getDate() + i);
    if (data.getDay() === 0 || data.getDay() === 6) continue;
    lista.push({ driverId, date: data, clockIn: "06:00", clockOut: "15:00" });
  }
  return lista;
}

function contexto(p: {
  titulos?: Titulo[];
  motoristas?: MotoristaGestao[];
  pontos?: PontoGestao[];
  afastamentos?: AfastamentoGestao[];
  usosDeVeiculo?: UsoDeVeiculoGestao[];
  escalas?: EscalaGestao[];
  abastecimentos?: AbastecimentoGestao[];
}): ContextoAuditoria {
  return {
    companyId: "c",
    conexaoId: null,
    dataReferencia: HOJE,
    agora: HOJE,
    janelaDesde: d("2025-01-01"),
    titulos: p.titulos ?? [],
    baixas: [],
    movimentos: [],
    notas: [],
    parceiros: [],
    categorias: [],
    departamentos: [],
    projetos: [],
    vinculos: [],
    contasCorrentes: [],
    conexoes: [],
    config: {},
    motoristas: p.motoristas ?? [],
    veiculos: [],
    clientes: [],
    abastecimentos: p.abastecimentos ?? [],
    pontos: p.pontos,
    afastamentos: p.afastamentos,
    usosDeVeiculo: p.usosDeVeiculo,
    escalas: p.escalas,
    gestao: { disponivel: true, erro: null },
  } as unknown as ContextoAuditoria;
}

const rodar = (ctx: ContextoAuditoria, regra: string) => auditarPessoal(ctx).filter((a) => a.regra === regra);

// ------------------------------------------------------- PE-PAGO-A-DESLIGADO
console.log("\nPE-PAGO-A-DESLIGADO — título a quem o cadastro diz que saiu");
{
  // Último ponto em 01/05; diária emitida em 01/07 (61 dias depois, 55 de idade).
  const m1 = motorista({ id: "m1", active: false });
  const ctx = contexto({
    motoristas: [m1],
    pontos: pontos("m1", "2026-04-20", 8),
    titulos: [titulo(m1, { dataEmissao: d("2026-07-01"), valorDocumentoCents: 600_00, valorPagoCents: 600_00 })],
  });
  const a = rodar(ctx, "PE-PAGO-A-DESLIGADO");
  conferir("diária dois meses depois do último ponto de um inativo é achado", a.length, 1);
  conferir("um achado por pessoa, chave estável", a[0]?.chave, "PE-PAGO-A-DESLIGADO|m1");
  conferir("valor agravado: R$ 600 sobre materialidade de R$ 500 é MÉDIA, agravada para ALTA", a[0]?.severidade, "ALTA");
  conferir("a evidência mascara o CPF", (a[0]?.evidencia?.documento as string).startsWith("***."), true);
  conferir("e diz de onde veio o último rastro", a[0]?.evidencia?.fonteDoUltimoRastro, "ponto");
}
{
  const m1 = motorista({ id: "m1", active: false });
  const ctx = contexto({
    motoristas: [m1],
    pontos: pontos("m1", "2026-04-20", 8),
    titulos: [titulo(m1, { dataEmissao: d("2026-07-01"), categoriaDescricao: "Rescisão contratual", valorDocumentoCents: 5_000_00 })],
  });
  conferir("rescisão depois do último ponto é o desligamento, não achado", rodar(ctx, "PE-PAGO-A-DESLIGADO").length, 0);
}
{
  const m1 = motorista({ id: "m1", active: false });
  const ctx = contexto({
    motoristas: [m1],
    pontos: pontos("m1", "2026-04-20", 8),
    titulos: [titulo(m1, { dataEmissao: d("2026-05-20") })],
  });
  conferir("diária 19 dias depois do último ponto é acerto de saída", rodar(ctx, "PE-PAGO-A-DESLIGADO").length, 0);
}
{
  // Emitido 92 dias depois do rastro, mas há só 24 dias: o ponto pode não ter chegado.
  const m1 = motorista({ id: "m1", active: false });
  const ctx = contexto({
    motoristas: [m1],
    pontos: pontos("m1", "2026-04-20", 8),
    titulos: [titulo(m1, { dataEmissao: d("2026-08-01") })],
  });
  conferir("título com menos de 45 dias espera o ponto chegar", rodar(ctx, "PE-PAGO-A-DESLIGADO").length, 0);
}
{
  // Uso de veículo em 20/06 é rastro mais recente que o ponto: 11 dias antes do título.
  const m1 = motorista({ id: "m1", active: false });
  const ctx = contexto({
    motoristas: [m1],
    pontos: pontos("m1", "2026-04-20", 8),
    usosDeVeiculo: [uso("m1", "2026-06-20")],
    titulos: [titulo(m1, { dataEmissao: d("2026-07-01") })],
  });
  conferir("retirada de veículo conta como último rastro", rodar(ctx, "PE-PAGO-A-DESLIGADO").length, 0);
}
{
  const m1 = motorista({ id: "m1", active: false });
  const ctx = contexto({ motoristas: [m1], titulos: [titulo(m1, { dataEmissao: d("2026-07-01") })] });
  conferir("sem rastro nenhum carregado, cala", rodar(ctx, "PE-PAGO-A-DESLIGADO").length, 0);
}
{
  // Ponto carregado para outra pessoa, nenhum para m1: não se sabe quando saiu.
  const m1 = motorista({ id: "m1", active: false });
  const m2 = motorista({ id: "m2" });
  const ctx = contexto({ motoristas: [m1, m2], pontos: pontos("m2", "2026-08-03", 5), titulos: [titulo(m1, { dataEmissao: d("2026-07-01") })] });
  conferir("inativo sem rastro na janela fica calado (é assunto do fantasma)", rodar(ctx, "PE-PAGO-A-DESLIGADO").length, 0);
}
{
  const m1 = motorista({ id: "m1", active: true });
  const ctx = contexto({ motoristas: [m1], pontos: pontos("m1", "2026-04-20", 8), titulos: [titulo(m1, { dataEmissao: d("2026-07-01") })] });
  conferir("ativo não é desligado", rodar(ctx, "PE-PAGO-A-DESLIGADO").length, 0);
}

// ---------------------------------------------------------------- PE-FANTASMA
console.log("\nPE-FANTASMA — recebe, consta ativo, e a operação nunca o vê");
// Quatro motoristas ativos; m2, m3 e m4 batem ponto em agosto (cobertura 75%).
// Um afastamento qualquer na base, para a tabela existir.
const equipe = () => [motorista({ id: "m1" }), motorista({ id: "m2" }), motorista({ id: "m3" }), motorista({ id: "m4" })];
const pontoDaEquipe = () => [...pontos("m2", "2026-08-03", 10), ...pontos("m3", "2026-08-03", 10), ...pontos("m4", "2026-08-03", 10)];
const folgaDoM2 = () => [afastamento("m2", "folga", "2026-08-15", "2026-08-15")];
{
  const [m1] = equipe();
  const ctx = contexto({
    motoristas: equipe(),
    pontos: pontoDaEquipe(),
    afastamentos: folgaDoM2(),
    titulos: [titulo(m1, { dataEmissao: d("2026-08-01"), valorDocumentoCents: 300_00, valorPagoCents: 300_00 })],
  });
  const a = rodar(ctx, "PE-FANTASMA");
  conferir("ativo, de operação, pago e sem rastro nenhum em 60 dias é achado", a.length, 1);
  conferir("severidade ALTA fixa", a[0]?.severidade, "ALTA");
  conferir("chave por pessoa", a[0]?.chave, "PE-FANTASMA|m1");
  conferir("a cobertura da base vai na evidência", a[0]?.evidencia?.coberturaDaOperacao, "75%");
}
{
  const [m1] = equipe();
  const ctx = contexto({
    motoristas: equipe(),
    pontos: pontoDaEquipe(),
    afastamentos: [...folgaDoM2(), afastamento("m1", "atestado", "2026-06-20", "2026-08-30")],
    titulos: [titulo(m1, { dataEmissao: d("2026-08-01") })],
  });
  conferir("afastamento cobrindo 30+ dias do período explica o silêncio", rodar(ctx, "PE-FANTASMA").length, 0);
}
{
  const [m1] = equipe();
  const ctx = contexto({
    motoristas: equipe(),
    pontos: pontoDaEquipe(),
    afastamentos: [...folgaDoM2(), afastamento("m1", "atestado", "2026-08-10", "2026-08-14")],
    titulos: [titulo(m1, { dataEmissao: d("2026-08-01") })],
  });
  conferir("atestado de 5 dias não explica 60 sem rastro", rodar(ctx, "PE-FANTASMA").length, 1);
}
{
  const [m1] = equipe();
  const ctx = contexto({
    motoristas: equipe(),
    pontos: pontoDaEquipe(),
    afastamentos: folgaDoM2(),
    abastecimentos: [abastecimento("m1", "2026-07-20")],
    titulos: [titulo(m1, { dataEmissao: d("2026-08-01") })],
  });
  conferir("um abastecimento no período já é rastro", rodar(ctx, "PE-FANTASMA").length, 0);
}
{
  const [m1] = equipe();
  const ctx = contexto({
    motoristas: equipe(),
    pontos: pontoDaEquipe(),
    afastamentos: folgaDoM2(),
    escalas: [escala("m1", "2026-08-10")],
    titulos: [titulo(m1, { dataEmissao: d("2026-08-01") })],
  });
  conferir("uma escala no período já é rastro", rodar(ctx, "PE-FANTASMA").length, 0);
}
{
  const [, m2, m3, m4] = equipe();
  const escritorio = motorista({ id: "m1", funcao: "ANALISTA ADMINISTRATIVO" });
  const ctx = contexto({
    motoristas: [escritorio, m2, m3, m4],
    pontos: pontoDaEquipe(),
    afastamentos: folgaDoM2(),
    titulos: [titulo(escritorio, { dataEmissao: d("2026-08-01") })],
  });
  conferir("função de escritório não bate ponto de operação: fora da regra", rodar(ctx, "PE-FANTASMA").length, 0);
}
{
  const [m1] = equipe();
  const ctx = contexto({
    motoristas: equipe(),
    pontos: pontos("m2", "2026-08-03", 10), // só 1 de 4 com rastro: 25%
    afastamentos: folgaDoM2(),
    titulos: [titulo(m1, { dataEmissao: d("2026-08-01") })],
  });
  conferir("base com rastro para menos da metade dos ativos cala a regra", rodar(ctx, "PE-FANTASMA").length, 0);
}
{
  const [m1] = equipe();
  const ctx = contexto({ motoristas: equipe(), pontos: pontoDaEquipe(), titulos: [titulo(m1, { dataEmissao: d("2026-08-01") })] });
  conferir("sem a tabela de afastamentos, cala", rodar(ctx, "PE-FANTASMA").length, 0);
}
{
  const [m1] = equipe();
  const ctx = contexto({
    motoristas: equipe(),
    pontos: pontoDaEquipe(),
    afastamentos: folgaDoM2(),
    titulos: [titulo(m1, { dataEmissao: d("2026-08-22") })],
  });
  conferir("título de 3 dias espera o ponto chegar", rodar(ctx, "PE-FANTASMA").length, 0);
}
{
  const [, m2, m3, m4] = equipe();
  const novato = motorista({ id: "m1", admissao: d("2026-08-10") });
  const ctx = contexto({
    motoristas: [novato, m2, m3, m4],
    pontos: pontoDaEquipe(),
    afastamentos: folgaDoM2(),
    titulos: [titulo(novato, { dataEmissao: d("2026-08-12") })],
  });
  conferir("admitido há duas semanas ainda não tem ponto vinculado: fora", rodar(ctx, "PE-FANTASMA").length, 0);
}
{
  const [m1] = equipe();
  const ctx = contexto({
    motoristas: equipe(),
    pontos: pontoDaEquipe(),
    afastamentos: folgaDoM2(),
    titulos: [titulo(m1, { dataEmissao: d("2026-08-01"), categoriaDescricao: "Rescisão contratual" })],
  });
  conferir("rescisão a quem sumiu é desligamento não registrado (antifraude), não fantasma", rodar(ctx, "PE-FANTASMA").length, 0);
}

// ---------------------------------------------------------- PE-DIARIA-OUTLIER
console.log("\nPE-DIARIA-OUTLIER — diária por dia trabalhado fora do padrão do departamento");
// Seis pessoas do mesmo departamento em julho, 20 dias de ponto cada, R$ 1.000
// de diária cada (R$ 50/dia).
const departamento = () => Array.from({ length: 6 }, (_, i) => motorista({ id: `m${i + 1}` }));
const pontoDeJulho = (ids: string[]) => ids.flatMap((id) => pontos(id, "2026-07-01", 20));
const diariasDeJulho = (pessoas: MotoristaGestao[], valores: Record<string, number> = {}) =>
  pessoas.map((m) => titulo(m, { dataEmissao: d("2026-07-10"), valorDocumentoCents: valores[m.id] ?? 1_000_00, valorPagoCents: valores[m.id] ?? 1_000_00 }));
{
  const pessoas = departamento();
  const ctx = contexto({ motoristas: pessoas, pontos: pontoDeJulho(pessoas.map((m) => m.id)), titulos: diariasDeJulho(pessoas) });
  conferir("todo mundo com a mesma diária por dia: nada", rodar(ctx, "PE-DIARIA-OUTLIER").length, 0);
}
{
  const pessoas = departamento();
  const ctx = contexto({
    motoristas: pessoas,
    pontos: pontoDeJulho(pessoas.map((m) => m.id)),
    titulos: diariasDeJulho(pessoas, { m1: 3_000_00 }),
  });
  const a = rodar(ctx, "PE-DIARIA-OUTLIER");
  conferir("R$ 150/dia contra R$ 50 do departamento é achado", a.length, 1);
  conferir("é erro de processo, MÉDIA", [a[0]?.categoria, a[0]?.severidade], ["ERRO_PROCESSO", "MEDIA"]);
  conferir("o impacto é o excesso sobre a mediana (R$ 3.000 − 20 × R$ 50)", a[0]?.impactoCents, 200_000);
  conferir("chave por pessoa e mês", a[0]?.chave, "PE-DIARIA-OUTLIER|m1|2026-07");
  conferir("a evidência traz a mediana do departamento", a[0]?.evidencia?.medianaDoDepartamentoCents, 5_000);
}
{
  // R$ 55/dia: passa do limite, mas o excesso (R$ 100) fica abaixo de 1/4 da materialidade.
  const pessoas = departamento();
  const ctx = contexto({
    motoristas: pessoas,
    pontos: pontoDeJulho(pessoas.map((m) => m.id)),
    titulos: diariasDeJulho(pessoas, { m1: 1_100_00 }),
  });
  conferir("excesso abaixo de 1/4 da materialidade não vale um achado", rodar(ctx, "PE-DIARIA-OUTLIER").length, 0);
}
{
  // m7 recebe diária em julho sem ponto nem veículo no mês.
  const pessoas = [...departamento(), motorista({ id: "m7" })];
  const ctx = contexto({
    motoristas: pessoas,
    pontos: pontoDeJulho(pessoas.slice(0, 6).map((m) => m.id)),
    titulos: diariasDeJulho(pessoas, { m7: 400_00 }),
  });
  const a = rodar(ctx, "PE-DIARIA-OUTLIER");
  conferir("diária sem nenhum dia trabalhado é achado", a.length, 1);
  conferir("categoria fraude a verificar, MÉDIA", [a[0]?.categoria, a[0]?.severidade], ["FRAUDE", "MEDIA"]);
  conferir("aponta a pessoa certa", a[0]?.entidadeId, "m7");
}
{
  // m7 sem ponto, mas com dez retiradas de veículo: os dias vêm do uso.
  const pessoas = [...departamento(), motorista({ id: "m7" })];
  const usos = Array.from({ length: 10 }, (_, i) => uso("m7", `2026-07-${String(i + 1).padStart(2, "0")}`));
  const ctx = contexto({
    motoristas: pessoas,
    pontos: pontoDeJulho(pessoas.slice(0, 6).map((m) => m.id)),
    usosDeVeiculo: usos,
    titulos: diariasDeJulho(pessoas, { m7: 400_00 }),
  });
  conferir("sem ponto, o uso de veículo conta os dias (R$ 40/dia é normal)", rodar(ctx, "PE-DIARIA-OUTLIER").length, 0);
}
{
  // Mês corrente (agosto): o ponto ainda está chegando.
  const pessoas = departamento();
  const titulos = pessoas.map((m) => titulo(m, { dataEmissao: d("2026-08-10"), valorDocumentoCents: m.id === "m1" ? 3_000_00 : 1_000_00 }));
  const ctx = contexto({ motoristas: pessoas, pontos: pessoas.flatMap((m) => pontos(m.id, "2026-08-03", 10)), titulos });
  conferir("mês ainda aberto fica de fora", rodar(ctx, "PE-DIARIA-OUTLIER").length, 0);
}
{
  // Só m1 tem ponto em julho: o mês não está registrado.
  const pessoas = departamento();
  const ctx = contexto({ motoristas: pessoas, pontos: pontos("m1", "2026-07-01", 20), titulos: diariasDeJulho(pessoas, { m1: 3_000_00 }) });
  conferir("metade das pessoas sem dia trabalhado: é o ponto que não veio, cala", rodar(ctx, "PE-DIARIA-OUTLIER").length, 0);
}
{
  // Quatro pessoas no departamento: mediana sem base.
  const pessoas = departamento().slice(0, 4);
  const ctx = contexto({ motoristas: pessoas, pontos: pontoDeJulho(pessoas.map((m) => m.id)), titulos: diariasDeJulho(pessoas, { m1: 3_000_00 }) });
  conferir("departamento com menos de 5 pessoas não forma referência", rodar(ctx, "PE-DIARIA-OUTLIER").length, 0);
}
{
  const pessoas = departamento();
  const ctx = contexto({ motoristas: pessoas, titulos: diariasDeJulho(pessoas, { m1: 3_000_00 }) });
  conferir("sem ponto nem uso carregados, cala", rodar(ctx, "PE-DIARIA-OUTLIER").length, 0);
}

// ----------------------------------------------------- PE-REEMBOLSO-DUPLICADO
console.log("\nPE-REEMBOLSO-DUPLICADO — o mesmo cupom, ou o mesmo valor, pago duas vezes");
{
  const m1 = motorista({ id: "m1" });
  const ctx = contexto({
    motoristas: [m1],
    titulos: [
      titulo(m1, { dataEmissao: d("2026-07-01"), numeroDocumento: "123456", categoriaDescricao: "Reembolso de pedágio" }),
      titulo(m1, { dataEmissao: d("2026-07-15"), numeroDocumento: "123456", categoriaDescricao: "Reembolso de pedágio" }),
    ],
  });
  const a = rodar(ctx, "PE-REEMBOLSO-DUPLICADO");
  conferir("o mesmo cupom duas vezes para a mesma pessoa é achado", a.length, 1);
  conferir("EVENTO, a verificar como fraude", [a[0]?.tipo, a[0]?.categoria], ["EVENTO", "FRAUDE"]);
  conferir("o valor é o que se pagou a mais (o segundo)", a[0]?.valorCents, 80_00);
  conferir("valor pequeno fica em BAIXA, nunca INFO", a[0]?.severidade, "BAIXA");
}
{
  const m1 = motorista({ id: "m1" });
  const m2 = motorista({ id: "m2" });
  const ctx = contexto({
    motoristas: [m1, m2],
    titulos: [
      titulo(m1, { dataEmissao: d("2026-07-01"), numeroDocumento: "123456" }),
      titulo(m2, { dataEmissao: d("2026-07-03"), numeroDocumento: "123456", valorDocumentoCents: 80_00 }),
    ],
  });
  conferir("o mesmo cupom com o mesmo valor em duas pessoas é achado", rodar(ctx, "PE-REEMBOLSO-DUPLICADO").length, 1);
}
{
  const m1 = motorista({ id: "m1" });
  const m2 = motorista({ id: "m2" });
  const ctx = contexto({
    motoristas: [m1, m2],
    titulos: [
      titulo(m1, { dataEmissao: d("2026-07-01"), numeroDocumento: "123456" }),
      titulo(m2, { dataEmissao: d("2026-07-20"), numeroDocumento: "123456", valorDocumentoCents: 213_40 }),
    ],
  });
  conferir("número igual, pessoas e valores diferentes, é coincidência de numeração", rodar(ctx, "PE-REEMBOLSO-DUPLICADO").length, 0);
}
{
  // "DIARIA" como número de documento em todo título da pessoa: rótulo.
  const m1 = motorista({ id: "m1" });
  const ctx = contexto({
    motoristas: [m1],
    titulos: ["2026-06-01", "2026-06-15", "2026-07-01", "2026-07-15"].map((dia) => titulo(m1, { dataEmissao: d(dia), numeroDocumento: "DIARIA" })),
  });
  conferir("número que se repete todo mês é rótulo, não cupom", rodar(ctx, "PE-REEMBOLSO-DUPLICADO").length, 0);
}
{
  const m1 = motorista({ id: "m1" });
  const ctx = contexto({
    motoristas: [m1],
    titulos: [
      titulo(m1, { dataEmissao: d("2026-07-01"), numeroDocumento: "555", numeroParcela: "1/2" }),
      titulo(m1, { dataEmissao: d("2026-07-01"), numeroDocumento: "555", numeroParcela: "2/2" }),
    ],
  });
  conferir("parcelas do mesmo documento não são duplicidade", rodar(ctx, "PE-REEMBOLSO-DUPLICADO").length, 0);
}
{
  const m1 = motorista({ id: "m1" });
  const ctx = contexto({
    motoristas: [m1],
    titulos: [titulo(m1, { dataEmissao: d("2026-07-01") }), titulo(m1, { dataEmissao: d("2026-07-04") })],
  });
  const a = rodar(ctx, "PE-REEMBOLSO-DUPLICADO");
  conferir("mesmo valor, mesma categoria, 3 dias, sem cupom: achado", a.length, 1);
  conferir("sem cupom é erro de processo, não fraude", a[0]?.categoria, "ERRO_PROCESSO");
}
{
  const m1 = motorista({ id: "m1" });
  const ctx = contexto({
    motoristas: [m1],
    titulos: [titulo(m1, { dataEmissao: d("2026-07-01") }), titulo(m1, { dataEmissao: d("2026-07-11") })],
  });
  conferir("dez dias de intervalo é outra viagem", rodar(ctx, "PE-REEMBOLSO-DUPLICADO").length, 0);
}
{
  // Diária fixa de R$ 80 a cada dois dias: rotina da pessoa.
  const m1 = motorista({ id: "m1" });
  const ctx = contexto({
    motoristas: [m1],
    titulos: [1, 3, 5, 7, 9, 11].map((dia) => titulo(m1, { dataEmissao: d(`2026-07-${String(dia).padStart(2, "0")}`) })),
  });
  conferir("diária fixa paga a cada dois dias é ritmo, não duplicidade", rodar(ctx, "PE-REEMBOLSO-DUPLICADO").length, 0);
}
{
  const m1 = motorista({ id: "m1" });
  const ctx = contexto({
    motoristas: [m1],
    titulos: [
      titulo(m1, { dataEmissao: d("2026-07-01"), numeroDocumento: "123456", categoriaDescricao: "Manutenção de veículos" }),
      titulo(m1, { dataEmissao: d("2026-07-03"), numeroDocumento: "123456", categoriaDescricao: "Manutenção de veículos" }),
    ],
  });
  conferir("fora das categorias de reembolso/diária a regra não olha", rodar(ctx, "PE-REEMBOLSO-DUPLICADO").length, 0);
}

// ---------------------------------------------------- PE-ADIANTAMENTO-ABERTO
console.log("\nPE-ADIANTAMENTO-ABERTO — adiantamento sem acerto em dois meses");
const adiantamento = (m: MotoristaGestao, dia: string, valor = 500_00) =>
  titulo(m, { dataEmissao: d(dia), categoriaDescricao: "Adiantamento a funcionários", valorDocumentoCents: valor, valorPagoCents: valor });
{
  const m1 = motorista({ id: "m1" });
  const m2 = motorista({ id: "m2" });
  const ctx = contexto({
    motoristas: [m1, m2],
    titulos: [
      adiantamento(m1, "2026-05-01"),
      adiantamento(m2, "2026-05-01"),
      titulo(m2, { dataEmissao: d("2026-05-30"), categoriaDescricao: "Acerto de adiantamento", valorDocumentoCents: 0, valorPagoCents: 0 }),
    ],
  });
  const a = rodar(ctx, "PE-ADIANTAMENTO-ABERTO");
  conferir("adiantamento de maio sem acerto é achado; o de m2, acertado, não", a.map((x) => x.entidadeId), ["m1"]);
  conferir("risco financeiro, agregado por pessoa", [a[0]?.categoria, a[0]?.chave], ["RISCO_FINANCEIRO", "PE-ADIANTAMENTO-ABERTO|m1"]);
  conferir("valor pago em aberto", a[0]?.valorCents, 500_00);
}
{
  const m1 = motorista({ id: "m1" });
  const receber = titulo(m1, { natureza: "RECEBER", dataEmissao: d("2026-06-10"), categoriaDescricao: "Devolução de adiantamento" });
  const ctx = contexto({ motoristas: [m1], titulos: [adiantamento(m1, "2026-05-01"), receber] });
  conferir("título a receber do CPF em 60 dias é acerto", rodar(ctx, "PE-ADIANTAMENTO-ABERTO").length, 0);
}
{
  const m1 = motorista({ id: "m1", active: false });
  const ctx = contexto({
    motoristas: [m1],
    titulos: [adiantamento(m1, "2026-05-01"), titulo(m1, { dataEmissao: d("2026-06-01"), categoriaDescricao: "Rescisão contratual", valorDocumentoCents: 4_000_00 })],
  });
  conferir("rescisão em 60 dias desconta o adiantamento", rodar(ctx, "PE-ADIANTAMENTO-ABERTO").length, 0);
}
{
  const m1 = motorista({ id: "m1" });
  const ctx = contexto({ motoristas: [m1], titulos: [adiantamento(m1, "2026-07-30")] });
  conferir("adiantamento de 26 dias ainda está no prazo", rodar(ctx, "PE-ADIANTAMENTO-ABERTO").length, 0);
}
{
  // Dez adiantamentos vencidos, nenhum com acerto: o acerto é feito na folha, fora da Omie.
  const pessoas = Array.from({ length: 10 }, (_, i) => motorista({ id: `m${i + 1}` }));
  const ctx = contexto({ motoristas: pessoas, titulos: pessoas.map((m) => adiantamento(m, "2026-05-01")) });
  conferir("empresa que nunca lança acerto na Omie: a regra cala em vez de apontar a folha", rodar(ctx, "PE-ADIANTAMENTO-ABERTO").length, 0);
}
{
  const m1 = motorista({ id: "m1" });
  const ctx = contexto({
    motoristas: [m1],
    titulos: [titulo(m1, { dataEmissao: d("2026-05-01"), categoriaDescricao: "Vale Alimentação", valorDocumentoCents: 500_00, valorPagoCents: 500_00 })],
  });
  conferir("vale-alimentação é benefício, não adiantamento", rodar(ctx, "PE-ADIANTAMENTO-ABERTO").length, 0);
}
{
  const m1 = motorista({ id: "m1" });
  const ctx = contexto({ motoristas: [m1], titulos: [titulo(m1, { dataEmissao: d("2026-05-01"), categoriaDescricao: "Adiantamento", liquidado: false, valorPagoCents: 0 })] });
  conferir("adiantamento ainda não pago não é dinheiro na mão de ninguém", rodar(ctx, "PE-ADIANTAMENTO-ABERTO").length, 0);
}

// ----------------------------------------------- PE-AFASTADO-COM-OPERACAO
console.log("\nPE-AFASTADO-COM-OPERACAO — ponto batido em dia de atestado ou férias");
{
  const m1 = motorista({ id: "m1" });
  const ctx = contexto({
    motoristas: [m1],
    afastamentos: [afastamento("m1", "atestado", "2026-07-10", "2026-07-20")],
    pontos: [ponto("m1", "2026-07-08"), ponto("m1", "2026-07-15"), ponto("m1", "2026-07-22")],
  });
  const a = rodar(ctx, "PE-AFASTADO-COM-OPERACAO");
  conferir("ponto no meio do atestado é achado", a.length, 1);
  conferir("informativo, erro de registro até prova em contrário", [a[0]?.severidade, a[0]?.categoria], ["INFO", "ERRO_PROCESSO"]);
  conferir("só o dia dentro do afastamento conta", a[0]?.evidencia?.diasComOperacao, 1);
  conferir("chave por pessoa, início e tipo", a[0]?.chave, "PE-AFASTADO-COM-OPERACAO|m1|2026-07-10|atestado");
}
{
  const m1 = motorista({ id: "m1" });
  const ctx = contexto({
    motoristas: [m1],
    afastamentos: [afastamento("m1", "ferias", "2026-07-01", "2026-07-30")],
    abastecimentos: [abastecimento("m1", "2026-07-12")],
  });
  conferir("cartão de frota passado em férias é achado", rodar(ctx, "PE-AFASTADO-COM-OPERACAO").length, 1);
}
{
  const m1 = motorista({ id: "m1" });
  const ctx = contexto({
    motoristas: [m1],
    afastamentos: [afastamento("m1", "folga", "2026-07-15", "2026-07-15")],
    pontos: [ponto("m1", "2026-07-15")],
  });
  conferir("folga trocada de dia é rotina de escala, não achado", rodar(ctx, "PE-AFASTADO-COM-OPERACAO").length, 0);
}
{
  const m1 = motorista({ id: "m1" });
  const ctx = contexto({
    motoristas: [m1],
    afastamentos: [afastamento("m1", "atestado", "2026-07-10", "2026-07-20")],
    pontos: [ponto("m1", "2026-07-08")],
    escalas: [escala("m1", "2026-07-15")],
  });
  conferir("escala em dia de atestado é plano, não presença", rodar(ctx, "PE-AFASTADO-COM-OPERACAO").length, 0);
}
{
  const m1 = motorista({ id: "m1" });
  const ctx = contexto({ motoristas: [m1], afastamentos: [afastamento("m1", "atestado", "2026-07-10", "2026-07-20")] });
  conferir("sem ponto, uso nem abastecimento carregados, cala", rodar(ctx, "PE-AFASTADO-COM-OPERACAO").length, 0);
}

// ------------------------------------------------------------------ vazio
console.log("\nContexto vazio");
conferir("sem motorista, título nem afastamento, nada é emitido", auditarPessoal(contexto({})).length, 0);

console.log(falhas === 0 ? "\nTodos os casos passaram." : `\n${falhas} caso(s) falharam.`);
process.exit(falhas === 0 ? 0 : 1);
