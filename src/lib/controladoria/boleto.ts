// O QUE O CÓDIGO DE BARRAS DO BOLETO DIZ — sem consultar banco nenhum.
//
// O boleto frio (ou adulterado) é o golpe em que o código de barras de um
// boleto verdadeiro é trocado pelo de outra conta: o fornecedor é o mesmo, a
// nota é a mesma, o valor às vezes até é o mesmo — e o dinheiro cai na conta
// de quem trocou. O código de barras (44 dígitos, padrão Febraban) carrega o
// banco que emitiu, o vencimento, o valor e um dígito verificador; a linha
// digitável (47) é o mesmo código com mais três dígitos de conferência. Ler
// isso basta para os sinais que não dependem do banco: código que não fecha o
// dígito, valor ou vencimento diferente do título, banco diferente do que o
// fornecedor sempre usou, o mesmo código em dois títulos.
//
// Boleto de arrecadação (concessionária, tributo) começa com 8 e tem outro
// layout: aqui só se lê o valor.

export type Boleto =
  | {
      tipo: "bancario";
      codigoDeBarras: string;
      banco: string;
      valorCents: number;
      // Nulo quando o boleto não traz vencimento (fator zero).
      vencimento: Date | null;
      digitoValido: boolean;
    }
  | { tipo: "arrecadacao"; codigoDeBarras: string; valorCents: number | null };

const DIA = 86_400_000;
// O fator de vencimento conta dias desde 07/10/1997 e chegou a 9999 em
// 21/02/2025; em 22/02/2025 recomeçou em 1000.
const BASE_1997 = Date.UTC(1997, 9, 7);
const BASE_2025 = Date.UTC(2025, 1, 22);

function modulo10(numero: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = numero.length - 1; i >= 0; i--) {
    let p = Number(numero[i]) * peso;
    if (p > 9) p = Math.floor(p / 10) + (p % 10);
    soma += p;
    peso = peso === 2 ? 1 : 2;
  }
  const resto = soma % 10;
  return resto === 0 ? 0 : 10 - resto;
}

// O dígito geral do boleto bancário (posição 5): módulo 11, pesos 2 a 9 da
// direita para a esquerda; 0, 10 e 11 viram 1.
export function digitoGeral(semDigito43: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = semDigito43.length - 1; i >= 0; i--) {
    soma += Number(semDigito43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const dv = 11 - (soma % 11);
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
}

// Linha digitável (47) → código de barras (44), conferindo os três dígitos
// dos campos. Nulo se algum não fechar.
function deLinhaDigitavel(d: string): { codigo: string; camposValidos: boolean } {
  const campo1 = d.slice(0, 9);
  const campo2 = d.slice(10, 20);
  const campo3 = d.slice(21, 31);
  const camposValidos = modulo10(campo1) === Number(d[9]) && modulo10(campo2) === Number(d[20]) && modulo10(campo3) === Number(d[31]);
  const codigo = d.slice(0, 4) + d[32] + d.slice(33, 47) + d.slice(4, 9) + campo2 + campo3;
  return { codigo, camposValidos };
}

// O vencimento pelo fator: das duas bases, a data mais perto da referência
// (o vencimento que o título diz), que é como os bancos desambiguam.
export function vencimentoDoFator(fator: number, referencia: Date): Date | null {
  if (fator === 0) return null;
  const candidatas = [BASE_1997 + fator * DIA];
  if (fator >= 1000) candidatas.push(BASE_2025 + (fator - 1000) * DIA);
  const alvo = Date.UTC(referencia.getFullYear(), referencia.getMonth(), referencia.getDate());
  candidatas.sort((a, b) => Math.abs(a - alvo) - Math.abs(b - alvo));
  return new Date(candidatas[0]);
}

export function lerBoleto(texto: string | null | undefined, referencia: Date): Boleto | null {
  const d = (texto ?? "").replace(/\D/g, "");
  if (d.startsWith("8")) {
    // Arrecadação: 44 dígitos (código) ou 48 (linha, quatro blocos de 11 + 1).
    const codigo = d.length === 48 ? [0, 12, 24, 36].map((i) => d.slice(i, i + 11)).join("") : d;
    if (codigo.length !== 44) return null;
    // O 3º dígito diz se o valor é real (6, 7) ou referência (8, 9).
    const valorReal = codigo[2] === "6" || codigo[2] === "7";
    return { tipo: "arrecadacao", codigoDeBarras: codigo, valorCents: valorReal ? Number(codigo.slice(4, 15)) : null };
  }
  let codigo: string;
  let camposValidos = true;
  if (d.length === 47) ({ codigo, camposValidos } = deLinhaDigitavel(d));
  else if (d.length === 44) codigo = d;
  else return null;
  const dv = Number(codigo[4]);
  const digitoValido = camposValidos && digitoGeral(codigo.slice(0, 4) + codigo.slice(5)) === dv;
  return {
    tipo: "bancario",
    codigoDeBarras: codigo,
    banco: codigo.slice(0, 3),
    valorCents: Number(codigo.slice(9, 19)),
    vencimento: vencimentoDoFator(Number(codigo.slice(5, 9)), referencia),
    digitoValido,
  };
}

// Os bancos mais comuns na cobrança, para o achado dizer o nome.
const BANCOS: Record<string, string> = {
  "001": "Banco do Brasil",
  "004": "Banco do Nordeste",
  "021": "Banestes",
  "033": "Santander",
  "041": "Banrisul",
  "070": "BRB",
  "077": "Inter",
  "104": "Caixa",
  "136": "Unicred",
  "197": "Stone",
  "208": "BTG Pactual",
  "212": "Banco Original",
  "237": "Bradesco",
  "260": "Nubank",
  "290": "PagSeguro",
  "323": "Mercado Pago",
  "336": "C6 Bank",
  "341": "Itaú",
  "380": "PicPay",
  "403": "Cora",
  "422": "Safra",
  "633": "Rendimento",
  "655": "Votorantim",
  "748": "Sicredi",
  "756": "Sicoob",
};
export const nomeDoBanco = (codigo: string) => (BANCOS[codigo] ? `${BANCOS[codigo]} (${codigo})` : `banco ${codigo}`);
