// NÚMERO DIGITADO NO PADRÃO BRASILEIRO — uma regra para a tela e o servidor.
//
// Vírgula é decimal e ponto é milhar. Sem vírgula, o ponto só é milhar quando
// separa grupos de três ("2.000", "1.234.567"); "6.05" e "9.31" continuam
// decimais, como quem cola de uma planilha em inglês. As duas leituras
// ingênuas erravam por mil: "2.000" lido como 2 dividia um salário, e "9.31"
// lido como 931 multiplicava um lance.
export function lerNumero(texto: string): number | null {
  const s = texto.trim().replace(/\s|R\$|%/g, "");
  if (s === "") return null;
  const normalizado = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : /^-?\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "") : s;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

// Inteiro digitado (vigência em meses, prazo em dias, posição na disputa):
// as colunas são Int no banco, e o Prisma TRUNCA o decimal sem avisar —
// "12,5" meses virava 12 e a posição "1,5" virava 1. Fracionário é recusado
// (null), para a ação devolver o erro em vez de gravar outro número.
export function lerInteiro(texto: string): number | null {
  const n = lerNumero(texto);
  return n !== null && Number.isInteger(n) ? n : null;
}

// DATA E HORA DIGITADAS NUM <input type="datetime-local"> ("2026-09-30T10:00"),
// que não traz fuso. `new Date(texto)` lia no fuso do SERVIDOR (UTC na
// Vercel): o lance das 10h de Brasília era gravado às 10h UTC e aparecia às
// 7h na tela. Aqui o texto é lido como hora de Brasília (−03:00 fixo, sem
// horário de verão desde 2019, como `dataReferenciaPadrao`). Texto que não é
// data e hora válida → null.
export function lerDataHoraDeBrasilia(texto: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(texto.trim());
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}-03:00`);
  if (Number.isNaN(d.getTime())) return null;
  // "2026-02-30T10:00" pode rolar para março: o dia lido tem de ser o digitado.
  const deVolta = new Date(d.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 16);
  return deVolta === `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}` ? d : null;
}
