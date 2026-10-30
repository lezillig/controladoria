// FÉRIAS (CLT, arts. 130, 134 e 137) — a mesma regra do `findFeriasVencidas`
// da gestão de motoristas, trazida para a plataforma com o saldo em dias:
//
// - cada 12 meses de trabalho desde a admissão (período AQUISITIVO) dão 30
//   dias de férias, a gozar nos 12 meses seguintes (período CONCESSIVO);
// - férias gozadas (e dias vendidos, o abono) abatem o período mais antigo
//   com saldo — o primeiro já completo; sem nenhum completo, é antecipação;
// - o que se goza depois do fim do concessivo é pago EM DOBRO (art. 137): o
//   controle avisa antes, pelo último dia para COMEÇAR as férias do saldo
//   dentro do concessivo.
//
// O controle só enxerga férias registradas (as da gestão, que vêm do ponto, e
// as lançadas pelo RH). Período cujo concessivo terminou antes do primeiro
// registro da empresa é "anterior ao controle"; o que começou antes e termina
// depois fica "a conferir" — pode ter havido férias sem registro.

const DIA = 86_400_000;
const utc = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
const somarAnos = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear() + n, d.getUTCMonth(), d.getUTCDate()));
const somarDias = (d: Date, n: number) => new Date(utc(d) + n * DIA);
export const DIREITO_DIAS = 30;

export type FeriasRegistrada = { inicio: Date; fim: Date; abonoDias?: number };
export type SituacaoPeriodo = "em_aquisicao" | "a_gozar" | "vencido" | "quitado" | "a_conferir" | "anterior";
export const ROTULO_SITUACAO_PERIODO: Record<SituacaoPeriodo, string> = {
  em_aquisicao: "em aquisição",
  a_gozar: "a gozar",
  vencido: "vencido (em dobro)",
  quitado: "gozado",
  a_conferir: "a conferir",
  anterior: "anterior ao controle",
};

export type PeriodoFerias = {
  numero: number;
  aquisitivoInicio: Date;
  aquisitivoFim: Date;
  concessivoFim: Date;
  usados: number;
  saldo: number;
  emDobroDias: number;
  situacao: SituacaoPeriodo;
  // Último dia para começar o saldo sem cair fora do concessivo.
  inicioAte: Date | null;
  diasParaLimite: number | null;
};

export const diasDeFerias = (f: FeriasRegistrada) => Math.round((utc(f.fim) - utc(f.inicio)) / DIA) + 1 + (f.abonoDias ?? 0);
export const diasEntre = (de: Date, ate: Date) => Math.round((utc(ate) - utc(de)) / DIA);

export function periodosDeFerias(admissao: Date | null, ferias: FeriasRegistrada[], hoje: Date, controleDesde: Date | null): PeriodoFerias[] {
  if (!admissao || utc(admissao) > utc(hoje)) return [];
  const periodos: PeriodoFerias[] = [];
  // Teto de segurança contra admissão malformada (80 anos de períodos).
  for (let i = 0; i < 80; i++) {
    const inicio = somarAnos(admissao, i);
    if (utc(inicio) > utc(hoje)) break;
    periodos.push({
      numero: i + 1,
      aquisitivoInicio: inicio,
      aquisitivoFim: somarDias(somarAnos(admissao, i + 1), -1),
      concessivoFim: somarDias(somarAnos(admissao, i + 2), -1),
      usados: 0,
      saldo: DIREITO_DIAS,
      emDobroDias: 0,
      situacao: "em_aquisicao",
      inicioAte: null,
      diasParaLimite: null,
    });
  }
  // Período cujo concessivo acabou antes do controle é presumido gozado: sai
  // da conta antes de abater, senão as férias registradas iriam para ele e
  // deixariam o período certo em aberto.
  for (const p of periodos) if (controleDesde && utc(p.concessivoFim) < utc(controleDesde)) p.saldo = 0;
  for (const f of [...ferias].sort((a, b) => utc(a.inicio) - utc(b.inicio))) {
    let resto = diasDeFerias(f);
    while (resto > 0) {
      const p = periodos.find((x) => x.saldo > 0 && utc(x.aquisitivoFim) < utc(f.inicio)) ?? periodos.find((x) => x.saldo > 0);
      if (!p) break;
      const usar = Math.min(resto, p.saldo);
      p.saldo -= usar;
      p.usados += usar;
      resto -= usar;
      if (utc(f.inicio) > utc(p.concessivoFim)) p.emDobroDias += usar;
    }
  }
  for (const p of periodos) {
    if (controleDesde && utc(p.concessivoFim) < utc(controleDesde)) p.situacao = "anterior";
    else if (utc(p.aquisitivoFim) >= utc(hoje)) p.situacao = p.saldo === 0 ? "quitado" : "em_aquisicao";
    else if (p.saldo === 0) p.situacao = "quitado";
    else if (utc(p.concessivoFim) < utc(hoje)) p.situacao = controleDesde && utc(p.aquisitivoFim) < utc(controleDesde) ? "a_conferir" : "vencido";
    else p.situacao = controleDesde && utc(p.aquisitivoFim) < utc(controleDesde) ? "a_conferir" : "a_gozar";
    if (p.situacao === "a_gozar" || p.situacao === "a_conferir" || p.situacao === "em_aquisicao") {
      p.inicioAte = somarDias(p.concessivoFim, -(p.saldo - 1));
      p.diasParaLimite = diasEntre(hoje, p.inicioAte);
    }
  }
  return periodos;
}

// O resumo de uma pessoa: o que vence primeiro, o que já venceu, se está de
// férias e as próximas programadas.
export type ResumoFerias = {
  vencidos: number;
  saldoVencidoDias: number;
  limite: { inicioAte: Date; dias: number; saldo: number; situacao: SituacaoPeriodo } | null;
  deFeriasAte: Date | null;
  proximas: Date | null;
  aConferir: number;
};

export function resumoDeFerias(admissao: Date | null, ferias: FeriasRegistrada[], hoje: Date, controleDesde: Date | null): ResumoFerias {
  const periodos = periodosDeFerias(admissao, ferias, hoje, controleDesde);
  const vencidos = periodos.filter((p) => p.situacao === "vencido");
  const abertos = periodos.filter((p) => (p.situacao === "a_gozar" || p.situacao === "a_conferir") && p.inicioAte).sort((a, b) => utc(a.inicioAte!) - utc(b.inicioAte!));
  const agora = feriasNoDia(ferias, hoje);
  const futuras = ferias.filter((f) => utc(f.inicio) > utc(hoje)).sort((a, b) => utc(a.inicio) - utc(b.inicio));
  return {
    vencidos: vencidos.length,
    saldoVencidoDias: vencidos.reduce((s, p) => s + p.saldo, 0),
    limite: abertos[0] ? { inicioAte: abertos[0].inicioAte!, dias: abertos[0].diasParaLimite!, saldo: abertos[0].saldo, situacao: abertos[0].situacao } : null,
    deFeriasAte: agora?.fim ?? null,
    proximas: futuras[0]?.inicio ?? null,
    aConferir: periodos.filter((p) => p.situacao === "a_conferir").length,
  };
}

export function feriasNoDia<T extends FeriasRegistrada>(ferias: T[], dia: Date): T | null {
  return ferias.find((f) => utc(f.inicio) <= utc(dia) && utc(dia) <= utc(f.fim)) ?? null;
}

// Os afastamentos de férias da gestão chegam picados (um por semana, por
// mês, ou um por dia): os contíguos viram um bloco só.
export function juntarFerias<T extends { inicio: Date; fim: Date; id: string }>(lista: T[]): { inicio: Date; fim: Date; ids: string[] }[] {
  const ordenada = [...lista].sort((a, b) => utc(a.inicio) - utc(b.inicio));
  const blocos: { inicio: Date; fim: Date; ids: string[] }[] = [];
  for (const f of ordenada) {
    const ultimo = blocos[blocos.length - 1];
    if (ultimo && utc(f.inicio) <= utc(ultimo.fim) + DIA) {
      if (utc(f.fim) > utc(ultimo.fim)) ultimo.fim = new Date(utc(f.fim));
      ultimo.ids.push(f.id);
    } else blocos.push({ inicio: new Date(utc(f.inicio)), fim: new Date(utc(f.fim)), ids: [f.id] });
  }
  return blocos;
}
