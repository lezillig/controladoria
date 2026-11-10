// DOCUMENTO PESSOAL NÃO VAI INTEIRO AO MODELO.
//
// Cada ferramenta já escolhe o que devolve, e as que mexem com cadastro
// mascaram o CPF por conta própria. Isso protege enquanto todo mundo lembrar:
// uma ferramenta nova que devolva a evidência crua de um achado, ou um texto
// livre da Omie com o CPF de um motorista na observação, passaria direto. Aqui
// fica a última barreira, na fronteira: TUDO que uma ferramenta devolve e todo
// briefing montado pelo sistema passa por este filtro antes de sair.
//
// O que é mascarado:
//   - CPF escrito com pontuação (123.456.789-09), sempre;
//   - sequência de 11 dígitos que fecha os dois dígitos verificadores de CPF,
//     solta no texto ou sob um campo de documento ("documento", "cpfCnpj");
//   - valor de campo cujo nome fala em CPF, CNH, RG, PIS, NIS ou CTPS.
//
// O que NÃO é mascarado: CNPJ (é dado de empresa, e a auditoria cruza
// fornecedor por ele), número que faz parte de uma sequência maior (linha
// digitável de boleto, chave de nota fiscal) e número sob um campo que não é
// de documento (valor em centavos, código da Omie).
//
// O que este filtro não alcança: arquivo enviado inteiro (PDF do relatório da
// consultoria, edital). Esses vão como o emissor os escreveu.

function cpfValido(d: string): boolean {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  const digito = (ate: number) => {
    let soma = 0;
    for (let i = 0; i < ate; i++) soma += Number(d[i]) * (ate + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(9) === Number(d[9]) && digito(10) === Number(d[10]);
}

// O mesmo formato da tela (src/lib/cadastro/normalizacao.ts): só o miolo.
const cpfMascarado = (d: string) => `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;

const CPF_PONTUADO = /(?<!\d)\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/g;
// Onze dígitos que não encostam em outro dígito nem em separador seguido de
// dígito — para não morder CNPJ, linha digitável, nem valor com decimais.
const ONZE_DIGITOS = /(?<![\d.,/-])\d{11}(?!\d|[.,/-]\d)/g;
// Par "campo: valor" com valor numérico — em JSON ou em texto de log. Quem
// decide se é documento é o NOME do campo, palavra por palavra: "numeroCnh" e
// "cpf_motorista" são; "piso" e "administrativoCents" não, embora contenham
// "pis" e "nis" no meio. Casar por pedaço de palavra mascararia salário.
const CAMPO_E_VALOR = /((?:"|')?([A-Za-z][A-Za-z0-9_]*)(?:"|')?\s*[:=]\s*(?:"|')?)(\d[\d.\-/ ]{3,22}\d)/g;
// Campo que só guarda documento de pessoa: o valor é mascarado seja qual for.
const SO_DOCUMENTO_PESSOAL = new Set(["cpf", "cnh", "rg", "pis", "nis", "ctps"]);
// Campo que guarda documento de pessoa OU de empresa (o "documento" do
// parceiro na Omie, "cpfCnpj"): só o que for CPF é mascarado.
const DOCUMENTO_DE_QUALQUER_UM = new Set(["documento", "doc", "cnpj", "inscricao"]);

function palavrasDoCampo(nome: string): string[] {
  return nome
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split("_");
}

// O campo que antecede uma posição do texto, se houver ("valorCents": ▮).
function campoAntesDe(texto: string, posicao: number): string | null {
  const antes = texto.slice(Math.max(0, posicao - 80), posicao);
  return antes.match(/([A-Za-z][A-Za-z0-9_]*)["']?\s*[:=]\s*["']?$/)?.[1] ?? null;
}

export function mascararDocumentosNoTexto(texto: string): string {
  return texto
    .replace(CAMPO_E_VALOR, (tudo: string, prefixo: string, nome: string, valor: string) => {
      if (!palavrasDoCampo(nome).some((p) => SO_DOCUMENTO_PESSOAL.has(p))) return tudo;
      const d = valor.replace(/\D/g, "");
      // CNPJ sob um campo "cpfCnpj" continua inteiro: é de empresa.
      if (d.length === 14) return tudo;
      if (d.length === 11) return `${prefixo}${cpfMascarado(d)}`;
      return d.length >= 5 ? `${prefixo}***${d.slice(-2)}` : tudo;
    })
    .replace(CPF_PONTUADO, (m) => cpfMascarado(m.replace(/\D/g, "")))
    .replace(ONZE_DIGITOS, (m: string, posicao: number, inteiro: string) => {
      if (!cpfValido(m)) return m;
      // NÚMERO SOB UM CAMPO QUE NÃO É DE DOCUMENTO FICA COMO ESTÁ. Um valor em
      // centavos, um código da Omie ou um nosso-número de onze dígitos fecha
      // os verificadores de CPF por acaso uma vez em cem; mascará-lo trocaria
      // um número de que o modelo precisa por asteriscos. Solto no texto (uma
      // observação, uma descrição), onze dígitos que fecham como CPF são CPF.
      const campo = campoAntesDe(inteiro, posicao);
      if (campo && !palavrasDoCampo(campo).some((p) => SO_DOCUMENTO_PESSOAL.has(p) || DOCUMENTO_DE_QUALQUER_UM.has(p))) return m;
      return cpfMascarado(m);
    });
}

type Bloco = { type: string; text?: string };

// Embrulha as ferramentas: o que cada uma devolve passa pelo filtro antes de
// virar resultado para o modelo. A definição (nome, descrição, parâmetros) não
// muda — só a saída.
export function comMascara<T extends { run: (...args: never[]) => unknown }>(ferramentas: T[]): T[] {
  return ferramentas.map((f) => ({
    ...f,
    run: async (...args: never[]) => {
      const saida = await f.run(...args);
      if (typeof saida === "string") return mascararDocumentosNoTexto(saida);
      if (Array.isArray(saida)) {
        return (saida as Bloco[]).map((b) => (b.type === "text" && typeof b.text === "string" ? { ...b, text: mascararDocumentosNoTexto(b.text) } : b));
      }
      return saida;
    },
  })) as T[];
}
