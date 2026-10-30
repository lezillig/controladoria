// O ENDEREÇO DO SISTEMA DE GESTÃO, para as telas daqui mandarem a pessoa ao
// cadastro que é de lá (contratos, veículos, multas). Sem GESTAO_URL, a tela
// diz o caminho no menu em vez do link.
export function linkDaGestao(caminho: string): string | null {
  const base = process.env.GESTAO_URL?.trim().replace(/\/+$/, "");
  return base ? `${base}${caminho}` : null;
}
