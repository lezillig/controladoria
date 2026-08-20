// Inputs type="date" enviam "YYYY-MM-DD" sem fuso. `new Date(string)` (e por
// extensao z.coerce.date()) trata esse formato como meia-noite UTC, o que em
// fusos negativos (Brasil, UTC-3) volta um dia no calendario local — bug real
// verificado neste projeto. Este parser sempre le como meia-noite local.
export function parseLocalDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return new Date(NaN);
  const [, y, m, d] = match;
  return new Date(Number(y), Number(m) - 1, Number(d));
}

// Combina um input type="date" com um input type="time" num Date local unico
// (ex: check-in de utilizacao de veiculo). Mesma logica de fuso do
// parseLocalDate acima.
export function combineLocalDateTime(dateValue: string, timeValue: string): Date {
  const date = parseLocalDate(dateValue);
  const match = /^(\d{2}):(\d{2})$/.exec(timeValue);
  if (!match || Number.isNaN(date.getTime())) return new Date(NaN);
  const [, h, min] = match;
  date.setHours(Number(h), Number(min), 0, 0);
  return date;
}
