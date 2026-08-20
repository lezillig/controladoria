// Validacao de CPF/CNPJ pelo digito verificador.
//
// Serve a um proposito de auditoria, nao de formulario: um fornecedor com
// documento invalido no cadastro do ERP e um dos indicios mais baratos de
// verificar e mais reveladores que existem — ou o cadastro foi feito sem
// nenhuma conferencia (falha de processo), ou o "fornecedor" nao existe
// (fachada). Os dois casos precisam aparecer.

export function cpfValido(valor: string): boolean {
  const cpf = valor.replace(/\D/g, "");
  if (cpf.length !== 11) return false;
  // Sequencias repetidas (000..., 111...) passam no calculo do DV mas nunca
  // sao documentos reais.
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  for (const [tamanho, posicaoDv] of [
    [9, 9],
    [10, 10],
  ] as const) {
    let soma = 0;
    for (let i = 0; i < tamanho; i++) {
      soma += Number(cpf[i]) * (tamanho + 1 - i);
    }
    const resto = (soma * 10) % 11;
    const dv = resto === 10 || resto === 11 ? 0 : resto;
    if (dv !== Number(cpf[posicaoDv])) return false;
  }
  return true;
}

export function cnpjValido(valor: string): boolean {
  const cnpj = valor.replace(/\D/g, "");
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;

  const calcular = (base: string, pesos: number[]): number => {
    const soma = base.split("").reduce((acc, d, i) => acc + Number(d) * pesos[i], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const dv1 = calcular(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (dv1 !== Number(cnpj[12])) return false;
  const dv2 = calcular(cnpj.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return dv2 === Number(cnpj[13]);
}

export function documentoValido(valor: string | null | undefined): boolean {
  if (!valor) return false;
  const d = valor.replace(/\D/g, "");
  if (d.length === 11) return cpfValido(d);
  if (d.length === 14) return cnpjValido(d);
  return false;
}

export function ehPessoaFisica(valor: string | null | undefined): boolean {
  return (valor ?? "").replace(/\D/g, "").length === 11;
}

// Normalizacao de nome para comparar cadastros possivelmente duplicados:
// remove acentos, pontuacao, formas societarias e palavras vazias, para que
// "TRANSPORTES SÃO JOÃO LTDA." e "Transportes Sao Joao Ltda ME" caiam no
// mesmo texto.
const RUIDO_RAZAO_SOCIAL = /\b(ltda|me|epp|eireli|sa|s\/a|cia|comercio|servicos|transportes?|do|da|de|dos|das|e)\b/g;

export function normalizarRazaoSocial(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(RUIDO_RAZAO_SOCIAL, " ")
    .replace(/\s+/g, " ")
    .trim();
}
