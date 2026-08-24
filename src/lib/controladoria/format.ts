// Formatacao monetaria e percentual usada na tela E no e-mail. Um lugar so:
// numero de relatorio gerencial que aparece diferente em dois canais gera
// duvida sobre qual esta certo, e duvida sobre o numero mata a confianca no
// relatorio inteiro.

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
});

const BRL_COMPACTO = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});

export function fmtBRL(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return BRL.format(cents / 100);
}

// Para cartoes de KPI, onde "R$ 1,2 mi" cabe e "R$ 1.234.567,89" nao —
// especialmente no relatorio aberto no celular.
export function fmtBRLCompacto(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  if (Math.abs(cents) < 100_000) return BRL.format(cents / 100);
  return BRL_COMPACTO.format(cents / 100);
}

export function fmtPercent(valor: number | null | undefined, casas = 1): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return "—";
  return `${valor.toFixed(casas).replace(".", ",")}%`;
}

export function fmtNumero(valor: number | null | undefined, casas = 0): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return "—";
  return valor.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

export function fmtData(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

// Data COM HORA. Existe para o registro de falhas: duas falhas no mesmo dia
// são a regra, não a exceção, e sem a hora não dá para dizer qual delas é a
// que a pessoa acabou de ver na tela.
export function fmtDataHora(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Variacao percentual entre dois periodos. Devolve null quando a base e zero
// — "aumento de infinito%" nao e informacao, e o relatorio deve dizer "sem
// base comparativa" em vez de imprimir um numero sem sentido.
export function variacaoPercent(atual: number, anterior: number): number | null {
  if (anterior === 0) return null;
  return ((atual - anterior) / Math.abs(anterior)) * 100;
}

export function fmtVariacao(valor: number | null): string {
  if (valor === null) return "sem base";
  const sinal = valor > 0 ? "+" : "";
  return `${sinal}${fmtPercent(valor)}`;
}

// Rotulo de documento (CNPJ/CPF) para exibicao. Mascara o CPF de pessoa
// fisica (11 digitos) porque a lista de fornecedores pode conter autonomo, e
// nem todo usuario do modulo precisa ver o documento completo de uma pessoa
// (LGPD, principio da minimizacao) — o CNPJ de empresa sai inteiro.
export function fmtDocumento(documento: string | null | undefined): string {
  if (!documento) return "—";
  const d = documento.replace(/\D/g, "");
  if (d.length === 14) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  }
  if (d.length === 11) return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
  return documento;
}
