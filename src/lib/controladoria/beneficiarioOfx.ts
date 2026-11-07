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

// Palavras de SETOR: estão no nome de muita empresa diferente. "AUTO" não
// distingue o AUTO POSTO SAO JORGE da AUTO PECAS RAPIDA — confere-se pelo que
// é próprio do nome. Só quando o nome não tem nada além delas é que elas
// valem, e aí é preciso casar duas.
const PALAVRAS_DE_SETOR = new Set(
  (
    "AUTO POSTO POSTOS PECAS TRANSPORTE TRANSPORTES TRANSPORTADORA LOGISTICA LOCACAO LOCACOES LOCADORA VEICULOS VEICULO " +
    "DISTRIBUIDORA DISTRIBUIDOR INDUSTRIA ENGENHARIA TECNOLOGIA SISTEMAS CONSULTORIA ASSESSORIA CONSTRUCOES CONSTRUTORA " +
    "MATERIAIS BRASIL BRASILEIRA GRUPO EMPRESA REDE CENTRO NACIONAL PAULISTA PAULO SANTO SANTA MECANICA OFICINA PNEUS " +
    "COMBUSTIVEIS COMBUSTIVEL TURISMO FRETAMENTO VIAGENS SEGUROS SEGURADORA CORRETORA ADMINISTRADORA PARTICIPACOES"
  ).split(/\s+/)
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
  // Isolado: dígito colado antes ou depois é outro número (nosso número,
  // código de barras), e um pedaço dele lido como CNPJ dava "diverge".
  const m = /(?<!\d)(?:\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}|\d{3}\.?\d{3}\.?\d{3}-?\d{2})(?!\d)/.exec(memo);
  if (!m) return null;
  const d = m[0].replace(/\D/g, "");
  return d.length === 14 || d.length === 11 ? d : null;
}

export type Veredito = "confere" | "diverge" | "sem-nome";
// "sem-nome" também cobre o INCONCLUSIVO: documento de outro com o nome do
// fornecedor (o banco pode escrever o CNPJ de quem cobra pelo fornecedor).

// A linha do banco é do fornecedor? Confere se o documento escrito é o dele
// (no CNPJ, a mesma raiz: matriz e filial são a mesma empresa) ou se uma
// palavra própria do nome dele (quatro letras ou mais) está no nome do banco.
// O banco corta o nome no meio ("AUTO POSTO SAO JO"): a última palavra vale
// pelo começo.
export function conferirBeneficiario(memo: string, fornecedor: { nomes: (string | null)[]; documento: string | null }): Veredito {
  const nome = nomeNoExtrato(memo);
  const doBanco = nome ? nome.split(" ") : [];
  const todas = [
    ...new Set(
      fornecedor.nomes
        .filter((n): n is string => Boolean(n))
        .flatMap((n) => palavras(normalizarRazaoSocial(n)))
        .filter((p) => p.length >= 4 && !PALAVRAS_DE_RAZAO_SOCIAL.has(p) && !PALAVRAS_DO_BANCO.has(p))
    ),
  ];
  const proprias = todas.filter((p) => !PALAVRAS_DE_SETOR.has(p));
  // Quantas palavras do nome do fornecedor estão no nome do banco. Só a
  // última palavra do banco pode vir cortada ("AUTO POSTO SAO JO").
  const casadas = (lista: string[]) =>
    lista.filter((p) => doBanco.some((b, i) => b.length >= 3 && (b === p || (i === doBanco.length - 1 && p.startsWith(b))))).length;
  // O banco corta o nome no meio: "AUTO POSTO SAO JO" é o começo de "AUTO
  // POSTO SAO JORGE". Começo com dez letras ou mais conta como o nome.
  const comeco =
    !!nome &&
    nome.length >= 10 &&
    fornecedor.nomes.some((n) => !!n && palavras(n).join(" ").startsWith(nome));
  const nomeConfere = comeco || (proprias.length > 0 ? casadas(proprias) >= 1 : todas.length > 0 && casadas(todas) >= Math.min(2, todas.length));

  const doc = documentoNoExtrato(memo);
  const docFornecedor = (fornecedor.documento ?? "").replace(/\D/g, "");
  if (doc && docFornecedor) {
    const mesmo = doc.length === 14 && docFornecedor.length === 14 ? doc.slice(0, 8) === docFornecedor.slice(0, 8) : doc === docFornecedor;
    if (mesmo) return "confere";
    // Documento de outro, mas com o nome do fornecedor: inconclusivo.
    return nomeConfere ? "sem-nome" : "diverge";
  }
  if (!nome || todas.length === 0) return "sem-nome";
  return nomeConfere ? "confere" : "diverge";
}

// CPF escrito na linha não aparece inteiro em tela (CLAUDE.md).
export function memoSemCpf(memo: string): string {
  return memo.replace(/\b(\d{3})\.?(\d{3})\.?(\d{3})-?(\d{2})\b/g, (todo, _a, b, c) => (todo.replace(/\D/g, "").length === 11 ? `***.${b}.${c}-**` : todo));
}
