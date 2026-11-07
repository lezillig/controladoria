// Janelas de tempo do relatorio gerencial. Todas em horario LOCAL (America/
// Sao_Paulo na pratica) e sempre no formato [inicio 00:00, fim 23:59:59.999]
// — o mesmo cuidado ja documentado em src/lib/date.ts: construir data a
// partir de string ISO curta cai em UTC e volta um dia no Brasil.

export type Periodo = { inicio: Date; fim: Date; rotulo: string };

export function inicioDoDia(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function fimDoDia(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function somarDias(d: Date, dias: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + dias);
  return x;
}

export function inicioDoMes(d: Date): Date {
  return inicioDoDia(new Date(d.getFullYear(), d.getMonth(), 1));
}

export function fimDoMes(d: Date): Date {
  return fimDoDia(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

// O MÊS INTEIRO, e não "o mês até hoje".
//
// `montarJanelas().mesAtual` corta no dia de hoje, e para o relatório diário
// isso está certo: ele compara período corrente com período corrente, e somar
// agosto inteiro contra julho inteiro no dia 5 mostraria uma queda inexistente.
//
// Na tela de resultado mês a mês o corte é que está errado. Ali o regime é
// COMPETÊNCIA pela data de vencimento: um título que vence dia 30 já existe, já
// está lançado e já pertence ao resultado do mês — esperar o dia 30 chegar para
// contá-lo não mede nada. E a última linha da série sempre saía menor que as
// anteriores, com a queda vindo do calendário e não da operação.
//
// Concretamente: no dia 24 de agosto a composição mostrava R$ 4,0 milhões
// rotulados "Mês atual (agosto/2026)", sem dizer que os vencimentos de 24 a 31
// estavam de fora.
export function mesCompleto(d: Date): Periodo {
  const inicio = inicioDoMes(d);
  return { inicio, fim: fimDoMes(inicio), rotulo: rotuloMes(inicio) };
}

export function inicioDoAno(d: Date): Date {
  return inicioDoDia(new Date(d.getFullYear(), 0, 1));
}

export function mesmoDiaAnoAnterior(d: Date): Date {
  return new Date(d.getFullYear() - 1, d.getMonth(), d.getDate());
}

export function diasEntre(a: Date, b: Date): number {
  return Math.round((inicioDoDia(b).getTime() - inicioDoDia(a).getTime()) / 86_400_000);
}

export function dentro(d: Date | null | undefined, p: Periodo): boolean {
  if (!d) return false;
  const t = d.getTime();
  return t >= p.inicio.getTime() && t <= p.fim.getTime();
}

const NOMES_MES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

export function rotuloMes(d: Date): string {
  return `${NOMES_MES[d.getMonth()]}/${d.getFullYear()}`;
}

// Conjunto de janelas que o relatorio diario sempre compara. O "acumulado
// ano anterior" e recortado ATE O MESMO DIA do ano passado (year-to-date de
// verdade), nao o ano inteiro: comparar 8 meses de 2026 contra 12 de 2025
// mostraria uma queda inexistente — erro classico de relatorio gerencial.
export type JanelasRelatorio = {
  dia: Periodo;
  mesAtual: Periodo;
  // O MÊS ANTERIOR, o MESMO MÊS DO ANO ANTERIOR e o ACUMULADO DO ANO
  // ANTERIOR são sempre meses FECHADOS, inteiros — decisão da diretoria
  // (out/2026): a comparação é com meses fechados, sem recortar até o mesmo
  // dia. A tela diz em que dia está o mês
  // atual ("dia 22 de 30") para quem lê pesar o mês pela metade.
  mesAnterior: Periodo;
  ano: Periodo;
  anoAnterior: Periodo;
  mesmoMesAnoAnterior: Periodo;
  // Se o mês atual está incompleto — e, então, quantos dias ele tem e em qual
  // está. É o que a tela usa para escrever "dia 22 de 30" em vez de deixar o
  // leitor comparar um mês pela metade com um inteiro.
  mesParcial: boolean;
  diaDoMes: number;
  diasNoMes: number;
};

// O último dia do mês de `d`, como número.
export function diasNoMesDe(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

// O ÚLTIMO MÊS FECHADO na data de referência: o próprio mês, se ela é o seu
// último dia; senão, o anterior. Para o que só faz sentido em mês inteiro —
// margem por contrato, que fatura uma vez por mês e incorre custo todo dia.
export function ultimoMesFechado(dataReferencia: Date): Periodo {
  const d = inicioDoDia(dataReferencia);
  const inicio = d.getDate() === diasNoMesDe(d) ? inicioDoMes(d) : inicioDoMes(new Date(d.getFullYear(), d.getMonth() - 1, 1));
  return { inicio, fim: fimDoMes(inicio), rotulo: rotuloMes(inicio) };
}

export function montarJanelas(dataReferencia: Date): JanelasRelatorio {
  const d = inicioDoDia(dataReferencia);
  const mesAtualInicio = inicioDoMes(d);
  const mesAnteriorInicio = inicioDoMes(new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const diaDoMes = d.getDate();
  const diasNoMes = diasNoMesDe(d);
  const mesParcial = diaDoMes < diasNoMes;
  const anoAnteriorMesmoDia = mesmoDiaAnoAnterior(d);
  const mesmoMesAnoAnteriorInicio = inicioDoMes(anoAnteriorMesmoDia);

  return {
    dia: { inicio: d, fim: fimDoDia(d), rotulo: "Dia (D-1)" },
    mesAtual: {
      inicio: mesAtualInicio,
      fim: fimDoDia(d),
      rotulo: mesParcial ? `Mês atual (${rotuloMes(d)}, dia ${diaDoMes} de ${diasNoMes})` : `Mês atual (${rotuloMes(d)})`,
    },
    mesAnterior: {
      inicio: mesAnteriorInicio,
      fim: fimDoMes(mesAnteriorInicio),
      rotulo: `Mês anterior (${rotuloMes(mesAnteriorInicio)})`,
    },
    mesParcial,
    diaDoMes,
    diasNoMes,
    ano: { inicio: inicioDoAno(d), fim: fimDoDia(d), rotulo: `Acumulado ${d.getFullYear()}` },
    // Janeiro até o FIM do mesmo mês do ano anterior: meses fechados, como o
    // mês anterior e o mesmo mês do ano anterior (ver o tipo).
    anoAnterior: {
      inicio: inicioDoAno(anoAnteriorMesmoDia),
      fim: fimDoMes(mesmoMesAnoAnteriorInicio),
      rotulo: `Acumulado ${anoAnteriorMesmoDia.getFullYear()} (até ${rotuloMes(mesmoMesAnoAnteriorInicio)}, meses fechados)`,
    },
    mesmoMesAnoAnterior: {
      inicio: mesmoMesAnoAnteriorInicio,
      fim: fimDoMes(mesmoMesAnoAnteriorInicio),
      rotulo: `${rotuloMes(mesmoMesAnoAnteriorInicio)} (mês fechado)`,
    },
  };
}

// Fim de semana e feriado. Usado por duas regras distintas: pagamento
// efetivado em dia nao util (indicio a verificar) e vencimento caindo em dia
// nao util (risco operacional de atraso involuntario).
//
// Feriados: os nacionais de data fixa, os de Sao Paulo (sede das empresas:
// 25/01 municipal, 09/07 estadual) e os MOVEIS, calculados pela Pascoa —
// Sexta-feira Santa, Corpus Christi (feriado municipal em SP) e, para banco,
// a segunda e a terca de Carnaval. Conta, nao tabela: nao desatualiza.
// 20/11 (Consciência Negra) é feriado nacional desde 2024 (Lei 14.759/2023).
// Mesma lista da gestao (feriados.json gerado pelo calendario.py de la).
export const FERIADOS_FIXOS = ["01-01", "01-25", "04-21", "05-01", "07-09", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"];

// Domingo de Pascoa (algoritmo de Meeus), como "AAAA-MM-DD".
export function pascoa(ano: number): string {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}
const moveis = new Map<number, { feriados: Set<string>; carnaval: Set<string> }>();
function moveisDoAno(ano: number) {
  let r = moveis.get(ano);
  if (!r) {
    const p = new Date(`${pascoa(ano)}T00:00:00Z`).getTime();
    const dia = (n: number) => new Date(p + n * 86_400_000).toISOString().slice(0, 10);
    r = { feriados: new Set([dia(-2), dia(60)]), carnaval: new Set([dia(-48), dia(-47)]) };
    moveis.set(ano, r);
  }
  return r;
}
/** Feriado (fixo, de SP ou movel) na data AAAA-MM-DD. Carnaval nao entra: e ponto facultativo, nao feriado. */
export function ehFeriado(iso: string): boolean {
  return FERIADOS_FIXOS.includes(iso.slice(5, 10)) || moveisDoAno(Number(iso.slice(0, 4))).feriados.has(iso);
}
/** Segunda ou terca de Carnaval: banco fechado. */
export function ehCarnaval(iso: string): boolean {
  return moveisDoAno(Number(iso.slice(0, 4))).carnaval.has(iso);
}

export function ehDiaNaoUtil(d: Date): boolean {
  const diaSemana = d.getDay();
  if (diaSemana === 0 || diaSemana === 6) return true;
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return ehFeriado(iso) || ehCarnaval(iso);
}
