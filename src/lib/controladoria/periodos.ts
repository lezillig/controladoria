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
  mesAnterior: Periodo;
  ano: Periodo;
  anoAnterior: Periodo;
  mesmoMesAnoAnterior: Periodo;
};

export function montarJanelas(dataReferencia: Date): JanelasRelatorio {
  const d = inicioDoDia(dataReferencia);
  const mesAtualInicio = inicioDoMes(d);
  const mesAnteriorInicio = inicioDoMes(new Date(d.getFullYear(), d.getMonth() - 1, 1));

  const anoAnteriorMesmoDia = mesmoDiaAnoAnterior(d);
  const mesmoMesAnoAnteriorInicio = inicioDoMes(anoAnteriorMesmoDia);

  return {
    dia: { inicio: d, fim: fimDoDia(d), rotulo: "Dia (D-1)" },
    mesAtual: { inicio: mesAtualInicio, fim: fimDoDia(d), rotulo: `Mês atual (${rotuloMes(d)})` },
    mesAnterior: {
      inicio: mesAnteriorInicio,
      fim: fimDoMes(mesAnteriorInicio),
      rotulo: `Mês anterior (${rotuloMes(mesAnteriorInicio)})`,
    },
    ano: { inicio: inicioDoAno(d), fim: fimDoDia(d), rotulo: `Acumulado ${d.getFullYear()}` },
    anoAnterior: {
      inicio: inicioDoAno(anoAnteriorMesmoDia),
      fim: fimDoDia(anoAnteriorMesmoDia),
      rotulo: `Acumulado ${anoAnteriorMesmoDia.getFullYear()} (até ${anoAnteriorMesmoDia.toLocaleDateString("pt-BR")})`,
    },
    mesmoMesAnoAnterior: {
      inicio: mesmoMesAnoAnteriorInicio,
      fim: fimDoDia(anoAnteriorMesmoDia),
      rotulo: `${rotuloMes(mesmoMesAnoAnteriorInicio)} (mesmo período)`,
    },
  };
}

// Fim de semana e feriado nacional fixo. Usado por duas regras distintas:
// pagamento efetivado em dia nao util (indicio a verificar) e vencimento
// caindo em dia nao util (risco operacional de atraso involuntario).
// Deliberadamente so os feriados de data FIXA: feriado movel (Carnaval,
// Corpus Christi, Sexta-Feira Santa) exigiria calendario externo, e um
// falso-negativo aqui e melhor que uma tabela desatualizada em producao
// dando alerta errado.
const FERIADOS_FIXOS = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "12-25"];

export function ehDiaNaoUtil(d: Date): boolean {
  const diaSemana = d.getDay();
  if (diaSemana === 0 || diaSemana === 6) return true;
  const chave = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return FERIADOS_FIXOS.includes(chave);
}
