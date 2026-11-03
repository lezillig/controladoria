import { normalizarRazaoSocial } from "./documento";

// QUEM RECEBEU O DINHEIRO — o nome que o BANCO escreve na linha do pagamento.
//
// O boleto frio passa por todas as conferências que olham a Omie: o título
// tem o fornecedor certo, a nota certa, o valor certo. O que só o banco sabe é
// o beneficiário de verdade, e ele vem escrito na linha do extrato ("PAG
// BOLETO AUTO POSTO SAO JORGE", "PIX ENVIADO FULANO DE TAL"). Comparar esse
// nome com o fornecedor do título pago é a prova — e vale para qualquer mês
// de que se tenha o OFX, mesmo antes de o sistema guardar o código de barras.
//
// O formato da linha muda de banco para banco e não há layout a seguir. Por
// isso a leitura é por exclusão: tira-se o vocabulário bancário (tipo de
// operação, "outros bancos", datas, números), e o que sobra é o nome. Quando
// não sobra nome ("TARIFA", "PAGTO TITULO 12345"), a linha não é julgada.

// O vocabulário do extrato, que não é nome de ninguém.
const PALAVRAS_DO_BANCO = new Set(
  (
    "PAG PAGTO PAGAMENTO PAGAMENTOS PGTO PAGT BOLETO BOLETOS BLT COBRANCA COBR TITULO TITULOS TIT FICHA COMPENSACAO " +
    "PIX TED DOC TEV TEF TRANSF TRANSFERENCIA TRANSFERENCIAS TRANSFER ENVIADO ENVIADA ENVIO EMITIDO EMITIDA REMETIDO " +
    "SISPAG FORNECEDOR FORNECEDORES FORNEC FORN OUTROS OUTRAS BANCOS BANCO BCO INSTITUICAO CONTA CONTAS CORRENTE CC " +
    "DEBITO DEB DB AUTOMATICO AUTOM AUT ELETRONICO ELETRON ELET INTERNET BANKING NET EMPRESA EMPRESAS CEL CELULAR APP " +
    "MOBILE AGENDADO AGENDAMENTO CONVENIO LIQUIDACAO LIQ QRCODE QR CODE CHAVE DINAMICO ESTATICO " +
    "DE DA DO DAS DOS PARA PRA P EM A E O AO AOS NO NA NOS NAS COM SEM POR " +
    "TARIFA TARIFAS TAR BANCARIA BANCARIAS BANCARIO BANCARIOS PACOTE CESTA MENSALIDADE ANUIDADE MANUTENCAO IOF JUROS ENCARGOS MULTA DARF GPS DAS FGTS GRF GRRF IPVA DPVAT LICENCIAMENTO TRIBUTO TRIBUTOS IMPOSTO " +
    "IMPOSTOS SALARIO SALARIOS FOLHA PROVENTOS ADIANTAMENTO ESTORNO DEVOLUCAO RESGATE APLICACAO APLIC CDB INVEST " +
    "SALDO ANTERIOR TOTAL DISPONIVEL BLOQUEADO LIMITE CHEQUE COMPENSADO DEPOSITO SAQUE CX CAIXA ELETR"
  ).split(/\s+/)
);

// O que se tira do nome do fornecedor para comparar (tipo de sociedade e
// palavras que todo mundo tem no nome).
const PALAVRAS_DE_RAZAO_SOCIAL = new Set(
  "LTDA ME EPP EIRELI SA S A CIA COMPANHIA MEI SOCIEDADE LIMITADA UNIPESSOAL COMERCIO COMERCIAL SERVICOS SERVICO INDUSTRIA DE DA DO DAS DOS E EM".split(" ")
);

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
const palavras = (s: string) => semAcento(s).replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);

// O nome que o banco escreveu, ou nulo quando a linha não traz nome.
export function nomeNoExtrato(memo: string): string | null {
  const resto = palavras(memo).filter((p) => !/\d/.test(p) && !PALAVRAS_DO_BANCO.has(p));
  // Uma letra solta ("S", "A") não é nome; o que sobra precisa ter ao menos
  // uma palavra de três letras.
  if (!resto.some((p) => p.length >= 3)) return null;
  return resto.join(" ");
}

// Documento (CNPJ ou CPF) escrito na linha: 11 ou 14 dígitos seguidos, com ou
// sem pontuação.
export function documentoNoExtrato(memo: string): string | null {
  const m = /(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})|(\d{3}\.?\d{3}\.?\d{3}-?\d{2})/.exec(memo);
  if (!m) return null;
  const d = m[0].replace(/\D/g, "");
  return d.length === 14 || d.length === 11 ? d : null;
}

export type Veredito = "confere" | "diverge" | "sem-nome";

// A linha do banco é do fornecedor? Confere se o documento escrito é o dele
// (no CNPJ, a mesma raiz: matriz e filial são a mesma empresa) ou se uma
// palavra própria do nome dele (quatro letras ou mais) está no nome do banco.
// O banco corta o nome no meio ("AUTO POSTO SAO JO"): a última palavra vale
// pelo começo.
export function conferirBeneficiario(memo: string, fornecedor: { nomes: (string | null)[]; documento: string | null }): Veredito {
  const doc = documentoNoExtrato(memo);
  const docFornecedor = (fornecedor.documento ?? "").replace(/\D/g, "");
  if (doc && docFornecedor) {
    if (doc.length === 14 && docFornecedor.length === 14) return doc.slice(0, 8) === docFornecedor.slice(0, 8) ? "confere" : "diverge";
    return doc === docFornecedor ? "confere" : "diverge";
  }
  const nome = nomeNoExtrato(memo);
  if (!nome) return "sem-nome";
  const doBanco = nome.split(" ");
  const proprias = new Set(
    fornecedor.nomes
      .filter((n): n is string => Boolean(n))
      .flatMap((n) => palavras(normalizarRazaoSocial(n)))
      .filter((p) => p.length >= 4 && !PALAVRAS_DE_RAZAO_SOCIAL.has(p) && !PALAVRAS_DO_BANCO.has(p))
  );
  if (proprias.size === 0) return "sem-nome";
  const casa = doBanco.some((b, i) => {
    if (b.length < 3) return false;
    if (proprias.has(b)) return true;
    // Só a última palavra pode vir cortada.
    return i === doBanco.length - 1 && b.length >= 3 && [...proprias].some((p) => p.startsWith(b));
  });
  return casa ? "confere" : "diverge";
}

// CPF escrito na linha não aparece inteiro em tela (CLAUDE.md).
export function memoSemCpf(memo: string): string {
  return memo.replace(/\b(\d{3})\.?(\d{3})\.?(\d{3})-?(\d{2})\b/g, (todo, _a, b, c) => (todo.replace(/\D/g, "").length === 11 ? `***.${b}.${c}-**` : todo));
}
