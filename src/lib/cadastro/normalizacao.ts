// AS CHAVES NATURAIS DO CADASTRO MESTRE (spec 01, regra 1): placa maiúscula e
// sem hífen; CPF e CNPJ só dígitos, com os dígitos verificadores conferidos.
// Tudo que entra no cadastro passa por aqui — planilha, Omie, gestão, tela —,
// para "ABC-1234", "abc1234" e "ABC 1234" serem o mesmo veículo.

const somenteDigitos = (v: string | number | null | undefined) => String(v ?? "").replace(/\D/g, "");

// Placa antiga (ABC1234) ou Mercosul (ABC1D23). Inválida: nulo.
export function normalizarPlaca(valor: string | null | undefined): string | null {
  const p = String(valor ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(p) ? p : null;
}

// Planilha costuma comer o zero à esquerda (CPF virou número): completa até
// o tamanho quando faltam no máximo dois dígitos.
function completar(digitos: string, tamanho: number): string {
  return digitos.length < tamanho && digitos.length >= tamanho - 2 ? digitos.padStart(tamanho, "0") : digitos;
}

export function cpfValido(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const dv = (base: string, pesoInicial: number) => {
    const soma = [...base].reduce((s, d, i) => s + Number(d) * (pesoInicial - i), 0);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(cpf.slice(0, 9), 10) === Number(cpf[9]) && dv(cpf.slice(0, 10), 11) === Number(cpf[10]);
}

export function cnpjValido(cnpj: string): boolean {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const dv = (base: string) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = [...base].reduce((s, d, i) => s + Number(d) * pesos[i], 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(cnpj.slice(0, 12)) === Number(cnpj[12]) && dv(cnpj.slice(0, 13)) === Number(cnpj[13]);
}

export function normalizarCpf(valor: string | number | null | undefined): string | null {
  const c = completar(somenteDigitos(valor), 11);
  return cpfValido(c) ? c : null;
}

export function normalizarCnpj(valor: string | number | null | undefined): string | null {
  const c = completar(somenteDigitos(valor), 14);
  return cnpjValido(c) ? c : null;
}

// Para tela: só o miolo do CPF aparece (***.456.789-**).
export function mascararCpf(cpf: string | null | undefined): string {
  const c = somenteDigitos(cpf);
  return c.length === 11 ? `***.${c.slice(3, 6)}.${c.slice(6, 9)}-**` : "—";
}

export function formatarCnpj(cnpj: string | null | undefined): string {
  const c = somenteDigitos(cnpj);
  return c.length === 14 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : (cnpj ?? "—");
}

// O tipo do veículo a partir do texto livre de cada fonte.
export function tipoDeVeiculo(texto: string | null | undefined): "van" | "micro" | "onibus" | "outro" {
  const t = String(texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/micro/.test(t)) return "micro";
  if (/onibus|bus\b|rodoviario|urbano/.test(t)) return "onibus";
  if (/\bvan\b|sprinter|master|ducato|daily|boxer|jumper|transit|kombi/.test(t)) return "van";
  return "outro";
}
