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
