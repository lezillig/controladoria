// O HORÁRIO DA ROTA: início e fim da operação do veículo no dia ("06:00" a
// "18:30"). Dele saem as horas por dia e se há trabalho noturno (22h às 5h,
// CLT art. 73). Fim antes do início passa da meia-noite ("22:00" a "06:00").

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function minutosDoHorario(texto: string | null | undefined): number | null {
  const m = HHMM.exec((texto ?? "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function horarioValido(texto: string | null | undefined): boolean {
  return texto === null || texto === undefined || texto === "" || minutosDoHorario(texto) !== null;
}

// Horas por dia e noturno. Sem os dois horários válidos, null.
export function jornadaDoHorario(inicio: string | null | undefined, fim: string | null | undefined): { horas: number; noturno: boolean } | null {
  const a = minutosDoHorario(inicio);
  const b = minutosDoHorario(fim);
  if (a === null || b === null || a === b) return null;
  const fimCorrido = b > a ? b : b + 24 * 60;
  // A janela noturna de cada dia: 22h às 5h do dia seguinte, e a da véspera
  // (0h às 5h) para quem começa de madrugada.
  const noturnas = [
    [-2 * 60, 5 * 60],
    [22 * 60, 29 * 60],
    [46 * 60, 53 * 60],
  ];
  const noturno = noturnas.some(([n0, n1]) => Math.min(fimCorrido, n1) > Math.max(a, n0));
  return { horas: Math.round(((fimCorrido - a) / 60) * 100) / 100, noturno };
}

// Horas de relógio entre 22h e 5h no horário da rota, por dia — as que pagam o
// adicional noturno. Sem os dois horários válidos, null.
export function horasNoturnasDoHorario(inicio: string | null | undefined, fim: string | null | undefined): number | null {
  const a = minutosDoHorario(inicio);
  const b = minutosDoHorario(fim);
  if (a === null || b === null || a === b) return null;
  const fimCorrido = b > a ? b : b + 24 * 60;
  const janelas = [
    [-2 * 60, 5 * 60],
    [22 * 60, 29 * 60],
    [46 * 60, 53 * 60],
  ];
  const minutos = janelas.reduce((soma, [n0, n1]) => soma + Math.max(0, Math.min(fimCorrido, n1) - Math.max(a, n0)), 0);
  return Math.round((minutos / 60) * 100) / 100;
}
