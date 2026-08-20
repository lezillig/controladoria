import { createHash } from "crypto";
import type {
  BaixaNormalizada,
  CategoriaNormalizada,
  ContaCorrenteNormalizada,
  DepartamentoNormalizado,
  MovimentoNormalizado,
  NotaNormalizada,
  OmieNatureza,
  ParceiroNormalizado,
  ProjetoNormalizado,
  TituloNormalizado,
} from "./types";

// Leitura tolerante da resposta da Omie.
//
// Cada coletor recebe a LISTA de nomes conhecidos daquele campo e devolve o
// primeiro que existir. Isso nao e preguica de tipar: a mesma informacao tem
// nome diferente entre os endpoints da Omie (o valor do titulo e
// `nValorTitulo` em pesquisartitulos e `valor_documento` em contapagar; a
// data de vencimento e `dDtVenc` num e `data_vencimento` no outro), e a
// documentacao publica nao cobre todas as variacoes. Um campo que muda de
// nome vira `null` — o registro entra no espelho com aquele campo vazio e a
// auditoria aponta o vazio — em vez de derrubar o sync inteiro.
//
// Consequencia pratica, registrada aqui de proposito: apos a PRIMEIRA
// execucao real contra a conta Omie do cliente, vale conferir a pagina
// /controladoria/sincronizacao, que mostra a taxa de campos vazios por
// entidade justamente pra revelar um alias que ficou faltando nesta lista.

type Bruto = Record<string, unknown>;

export function str(obj: Bruto | null | undefined, ...keys: string[]): string | null {
  if (!obj) return null;
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

export function num(obj: Bruto | null | undefined, ...keys: string[]): number | null {
  if (!obj) return null;
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      // A Omie devolve numero como number na maioria dos casos, mas alguns
      // campos vem como texto — e ai pode vir no formato brasileiro
      // ("1.234,56"), que Number() leria como NaN.
      const limpo = v.trim().replace(/\./g, "").replace(",", ".");
      const n = Number(limpo);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

// Reais -> centavos. Math.round e obrigatorio: 19.99 * 100 = 1998.9999... em
// ponto flutuante, e truncar geraria um centavo de diferenca por linha que a
// propria auditoria depois apontaria como divergencia.
export function cents(obj: Bruto | null | undefined, ...keys: string[]): number | null {
  const v = num(obj, ...keys);
  return v === null ? null : Math.round(v * 100);
}

export function centsOuZero(obj: Bruto | null | undefined, ...keys: string[]): number {
  return cents(obj, ...keys) ?? 0;
}

export function bool(obj: Bruto | null | undefined, ...keys: string[]): boolean | null {
  if (!obj) return null;
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "boolean") return v;
    if (typeof v === "string") {
      const t = v.trim().toUpperCase();
      if (t === "S" || t === "SIM" || t === "TRUE") return true;
      if (t === "N" || t === "NAO" || t === "NÃO" || t === "FALSE") return false;
    }
  }
  return null;
}

// A Omie usa DD/MM/AAAA em todo campo de data. Construir como data LOCAL
// (nao `new Date("2026-01-31")`, que e meia-noite UTC e volta um dia em
// UTC-3) — mesmo cuidado ja documentado em src/lib/date.ts.
export function parseDataOmie(valor: string | null): Date | null {
  if (!valor) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(valor.trim());
  if (m) {
    const [, d, mes, a] = m;
    const data = new Date(Number(a), Number(mes) - 1, Number(d));
    return Number.isNaN(data.getTime()) ? null : data;
  }
  // Alguns endpoints devolvem AAAA-MM-DD.
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor.trim());
  if (iso) {
    const [, a, mes, d] = iso;
    return new Date(Number(a), Number(mes) - 1, Number(d));
  }
  return null;
}

export function data(obj: Bruto | null | undefined, ...keys: string[]): Date | null {
  return parseDataOmie(str(obj, ...keys));
}

export function formatarDataOmie(d: Date): string {
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  return `${dia}/${mes}/${d.getFullYear()}`;
}

// Somente digitos — o cruzamento entre fornecedor da Omie e CPF de motorista
// deste sistema (red flag de fornecedor que e funcionario) so casa com os
// dois lados normalizados, ja que a Omie grava com pontuacao e o cadastro de
// motorista nem sempre.
export function normalizeDocumento(valor: string | null): string | null {
  if (!valor) return null;
  const digitos = valor.replace(/\D/g, "");
  return digitos.length >= 11 ? digitos : null;
}

// Hash dos dados bancarios do fornecedor. Ver comentario em
// OmieParceiro.contaBancariaHash (schema): guarda-se o hash, nunca a conta.
export function hashContaBancaria(banco: string | null, agencia: string | null, conta: string | null): string | null {
  const partes = [banco, agencia, conta].map((p) => (p ?? "").replace(/\D/g, ""));
  if (partes.every((p) => p === "")) return null;
  return createHash("sha256").update(partes.join("|")).digest("hex");
}

export function obj(bruto: Bruto, ...keys: string[]): Bruto | null {
  for (const key of keys) {
    const v = bruto[key];
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Bruto;
  }
  return null;
}

export function arr(bruto: Bruto | null | undefined, ...keys: string[]): Bruto[] {
  if (!bruto) return [];
  for (const key of keys) {
    const v = bruto[key];
    if (Array.isArray(v)) return v as Bruto[];
  }
  return [];
}

// ---------- Normalizadores por entidade ----------

export function normalizarParceiro(bruto: Bruto): ParceiroNormalizado | null {
  const codigoOmie = str(bruto, "codigo_cliente_omie", "nCodCliente", "codigo_cliente");
  const nome = str(bruto, "razao_social", "nome_fantasia", "cRazao", "nome");
  if (!codigoOmie || !nome) return null;

  // A Omie marca papel por tags e por flags; nem toda conta usa as duas.
  // Sem nenhum indicativo, o parceiro entra como fornecedor E cliente
  // desligados — e o proprio uso (aparecer num titulo a pagar ou a receber)
  // define o papel na hora do relatorio.
  const tags = arr(bruto, "tags")
    .map((t) => str(t, "tag") ?? "")
    .join(" ")
    .toLowerCase();
  const ehCliente = bool(bruto, "cliente") ?? /cliente/.test(tags);
  const ehFornecedor = bool(bruto, "fornecedor") ?? /fornecedor/.test(tags);

  const dadosBancarios = obj(bruto, "dadosBancarios", "dados_bancarios");

  return {
    codigoOmie,
    codigoIntegracao: str(bruto, "codigo_cliente_integracao", "cCodIntCliente"),
    nome,
    nomeFantasia: str(bruto, "nome_fantasia"),
    documento: normalizeDocumento(str(bruto, "cnpj_cpf", "cCNPJCPF", "documento")),
    ehCliente,
    ehFornecedor,
    email: str(bruto, "email"),
    cidade: str(bruto, "cidade"),
    estado: str(bruto, "estado"),
    inativo: (bool(bruto, "inativo") ?? false) || str(bruto, "inativo") === "S",
    bloqueado: bool(bruto, "bloquear_faturamento", "bloqueado") ?? false,
    contaBancariaHash: hashContaBancaria(
      str(dadosBancarios, "codigo_banco", "cCodBanco"),
      str(dadosBancarios, "agencia", "cAgencia"),
      str(dadosBancarios, "conta_corrente", "cConta")
    ),
  };
}

export function normalizarCategoria(bruto: Bruto): CategoriaNormalizada | null {
  const codigo = str(bruto, "codigo", "cCodCateg");
  const descricao = str(bruto, "descricao", "descricao_padrao", "cDescCateg");
  if (!codigo || !descricao) return null;
  return {
    codigo,
    descricao,
    natureza: str(bruto, "natureza", "tipo_categoria"),
    categoriaSuperior: str(bruto, "categoria_superior"),
    totalizadora: (bool(bruto, "totalizadora") ?? false) || str(bruto, "totalizadora") === "S",
    inativa: (bool(bruto, "conta_inativa") ?? false) || str(bruto, "conta_inativa") === "S",
  };
}

export function normalizarDepartamento(bruto: Bruto): DepartamentoNormalizado | null {
  const codigo = str(bruto, "codigo", "codDepto", "cCodDepto");
  const descricao = str(bruto, "descricao", "nome");
  if (!codigo || !descricao) return null;
  return {
    codigo,
    descricao,
    estrutura: str(bruto, "estrutura"),
    inativo: (bool(bruto, "inativo") ?? false) || str(bruto, "inativo") === "S",
  };
}

export function normalizarProjeto(bruto: Bruto): ProjetoNormalizado | null {
  const codigo = str(bruto, "codigo", "codint", "nCodProj");
  const nome = str(bruto, "nome", "descricao", "cNomProj");
  if (!codigo || !nome) return null;
  return {
    codigo,
    nome,
    inativo: (bool(bruto, "inativo") ?? false) || str(bruto, "inativo") === "S",
  };
}

export function normalizarContaCorrente(bruto: Bruto): ContaCorrenteNormalizada | null {
  const codigo = str(bruto, "nCodCC", "codigo", "nCodConta");
  const descricao = str(bruto, "descricao", "cDescricao", "cNome");
  if (!codigo || !descricao) return null;
  return {
    codigo,
    descricao,
    tipo: str(bruto, "tipo", "cTipo"),
    banco: str(bruto, "codigo_banco", "cCodBanco"),
    agencia: str(bruto, "codigo_agencia", "cAgencia"),
    numeroConta: str(bruto, "conta_corrente", "cConta", "numero_conta"),
    saldoInicialCents: centsOuZero(bruto, "saldo_inicial", "nSaldoInicial"),
    inativa: (bool(bruto, "inativo") ?? false) || str(bruto, "inativo") === "S",
  };
}

// Status que significam titulo cancelado — nao entram em nenhuma soma de
// custo/receita, mas continuam no espelho (cancelamento e justamente um dos
// pontos que a auditoria olha).
const STATUS_CANCELADO = /cancelad/i;
// Status de titulo quitado. "LIQUIDADO"/"PAGO"/"RECEBIDO" convivem na mesma
// base porque dependem da natureza e da versao do ERP.
const STATUS_LIQUIDADO = /liquidad|^pago$|^recebido$|quitad/i;

export function normalizarTitulo(bruto: Bruto, natureza: OmieNatureza): TituloNormalizado | null {
  // Resposta de pesquisartitulos vem aninhada em cabecTitulo/resumo/
  // lancamentos; a de contapagar/contareceber vem achatada. Aceitar as duas
  // formas custa uma linha e evita que trocar a fonte primaria depois
  // (ver OMIE_ENDPOINTS.titulos) obrigue a reescrever o normalizador.
  const cabec = obj(bruto, "cabecTitulo", "cabec_titulo") ?? bruto;
  const resumo = obj(bruto, "resumo") ?? {};

  const codigoLancamento = str(cabec, "nCodTitulo", "codigo_lancamento_omie", "nCodLanc");
  const valorDocumentoCents = cents(cabec, "nValorTitulo", "valor_documento", "nValorDocumento");
  const dataVencimento = data(cabec, "dDtVenc", "data_vencimento", "dDtVencimento");
  if (!codigoLancamento || valorDocumentoCents === null || !dataVencimento) return null;

  const status = (str(cabec, "cStatus", "status_titulo") ?? "DESCONHECIDO").toUpperCase();

  const lancamentos = arr(bruto, "lancamentos", "lancamento", "baixas");
  const baixas: BaixaNormalizada[] = [];
  for (const lanc of lancamentos) {
    const dataBaixa = data(lanc, "dDtPagamento", "data_baixa", "dDtLanc", "dDtBaixa");
    const valor = cents(lanc, "nValPago", "valor_baixa", "nValLanc", "nValor");
    if (!dataBaixa || valor === null) continue;
    const codigoBaixa = str(lanc, "nCodBaixa", "nCodLanc", "codigo_baixa");
    baixas.push({
      // Chave estavel da baixa: o codigo da Omie quando existe; senao o par
      // titulo+data+valor, que e o que identifica a baixa de forma unica na
      // pratica. Sem isso, reimportar o mesmo periodo duplicaria as baixas e
      // dobraria o juros do relatorio — o pior tipo de bug num sistema de
      // auditoria, porque o numero errado parece plausivel.
      chave: codigoBaixa
        ? `${natureza}:${codigoLancamento}:${codigoBaixa}`
        : `${natureza}:${codigoLancamento}:${dataBaixa.toISOString().slice(0, 10)}:${valor}`,
      dataBaixa,
      valorCents: valor,
      jurosCents: centsOuZero(lanc, "nJuros", "juros", "nValJuros"),
      multaCents: centsOuZero(lanc, "nMulta", "multa", "nValMulta"),
      descontoCents: centsOuZero(lanc, "nDesconto", "desconto", "nValDesconto"),
      tarifaCents: centsOuZero(lanc, "nTarifa", "nValTarifa", "tarifa"),
      contaCorrenteCodigo: str(lanc, "nCodCC", "codigo_conta_corrente"),
      observacao: str(lanc, "cObs", "observacao", "cObsBaixa"),
      liquidaTitulo: bool(lanc, "cLiqTitulo", "liquida_titulo") ?? true,
    });
  }

  // Totais: prefere o `resumo` da Omie (autoridade) e cai para a soma das
  // baixas quando o resumo nao veio. As duas fontes divergindo e, por si so,
  // um achado — ver regra CP-DIVERGENCIA-BAIXA no agente de contas a pagar.
  const somaBaixas = (campo: keyof BaixaNormalizada) =>
    baixas.reduce((acc, b) => acc + (typeof b[campo] === "number" ? (b[campo] as number) : 0), 0);

  const valorPagoCents = cents(resumo, "nValPago", "nValRecebido", "valor_pago") ?? somaBaixas("valorCents");
  const jurosCents = cents(resumo, "nValJuros", "juros") ?? somaBaixas("jurosCents");
  const multaCents = cents(resumo, "nValMulta", "multa") ?? somaBaixas("multaCents");
  const descontoCents = cents(resumo, "nValDesconto", "desconto") ?? somaBaixas("descontoCents");
  const tarifaCents = cents(resumo, "nValTarifas", "nValTarifa") ?? somaBaixas("tarifaCents");
  const saldoCents = cents(resumo, "nValAberto", "saldo", "valor_saldo");

  const departamentos = arr(bruto, "departamentos", "distribuicao", "cDadosDepto");

  return {
    natureza,
    codigoLancamento,
    codigoIntegracao: str(cabec, "cCodIntTitulo", "codigo_lancamento_integracao"),
    parceiroCodigo: str(cabec, "nCodCliente", "codigo_cliente_fornecedor", "nCodFornecedor"),
    parceiroNome: str(cabec, "cRazaoSocial", "razao_social", "cNomeCliente", "cNomeFornecedor"),
    parceiroDocumento: normalizeDocumento(str(cabec, "cCPFCNPJCliente", "cnpj_cpf", "cCPFCNPJ")),
    numeroDocumento: str(cabec, "cNumDocFiscal", "numero_documento", "cNumTitulo"),
    numeroParcela: str(cabec, "cNumParcela", "numero_parcela"),
    tipoDocumento: str(cabec, "cTipo", "codigo_tipo_documento", "cCodTipoDoc"),
    categoriaCodigo: str(cabec, "cCodCateg", "codigo_categoria"),
    categoriaDescricao: str(cabec, "cDescCateg", "descricao_categoria"),
    departamentoCodigo:
      str(cabec, "cCodDepartamento", "codigo_departamento") ??
      str(departamentos[0], "cCodDepartamento", "codigo_departamento", "cCodDepto"),
    projetoCodigo: str(cabec, "nCodProjeto", "codigo_projeto"),
    contaCorrenteCodigo: str(cabec, "nCodCC", "id_conta_corrente", "codigo_conta_corrente"),
    dataEmissao: data(cabec, "dDtEmissao", "data_emissao"),
    dataVencimento,
    dataPrevisao: data(cabec, "dDtPrevisao", "data_previsao"),
    dataRegistro: data(cabec, "dDtRegistro", "data_registro"),
    dataEntrada: data(cabec, "dDtEntrada", "data_entrada"),
    valorDocumentoCents,
    saldoCents,
    valorPagoCents,
    jurosCents,
    multaCents,
    descontoCents,
    tarifaCents,
    dataUltimaBaixa: baixas.length
      ? baixas.reduce((mais, b) => (b.dataBaixa > mais ? b.dataBaixa : mais), baixas[0].dataBaixa)
      : data(cabec, "dDtPagamento", "data_pagamento"),
    status,
    liquidado: STATUS_LIQUIDADO.test(status),
    cancelado: STATUS_CANCELADO.test(status),
    observacao: str(cabec, "observacao", "cObs", "cObservacao"),
    origem: str(cabec, "cOperacao", "id_origem", "cOrigem"),
    alteradoEmOmie: data(bruto, "dAlt", "data_alteracao") ?? data(cabec, "dAlt"),
    baixas,
  };
}

export function normalizarMovimentoExtrato(
  bruto: Bruto,
  contaCorrenteCodigo: string
): MovimentoNormalizado | null {
  const dataMov = data(bruto, "dDataLancamento", "dDtLanc", "data_lancamento", "dDataMovimento");
  const valorBruto = num(bruto, "nValorLancamento", "nValor", "valor_lancamento", "nValorMovimento");
  if (!dataMov || valorBruto === null) return null;

  const natureza = str(bruto, "cNatureza", "natureza", "cTipoLancamento");
  const codigo =
    str(bruto, "nCodLanc", "nCodMovCC", "codigo_lancamento", "nCodExtrato") ??
    // Extrato sem identificador proprio: monta uma chave deterministica a
    // partir do conteudo, para a reimportacao da mesma janela nao duplicar.
    `${contaCorrenteCodigo}:${dataMov.toISOString().slice(0, 10)}:${Math.round(valorBruto * 100)}:${
      str(bruto, "cObservacoes", "observacao") ?? ""
    }`.slice(0, 180);

  // Sinal: a Omie ora devolve o valor ja com sinal, ora sempre positivo com
  // a natureza ("D"/"C") ao lado. Normaliza para valor com sinal aqui, uma
  // vez so — ver comentario em OmieMovimento (schema).
  const ehDebito = natureza !== null && /^d/i.test(natureza);
  const valorCents = Math.round(Math.abs(valorBruto) * 100) * (ehDebito ? -1 : 1);

  return {
    contaCorrenteCodigo,
    codigoLancamento: codigo,
    data: dataMov,
    valorCents: valorBruto < 0 && !ehDebito ? -Math.abs(valorCents) : valorCents,
    natureza,
    tipo: str(bruto, "cTipo", "cCodTipoLanc", "tipo"),
    categoriaCodigo: str(bruto, "cCodCateg", "codigo_categoria"),
    parceiroCodigo: str(bruto, "nCodCliente", "codigo_cliente"),
    parceiroNome: str(bruto, "cNomeCliente", "cRazaoSocial", "cNome"),
    documento: str(bruto, "cNumDoc", "cDocumento", "numero_documento"),
    observacao: str(bruto, "cObservacoes", "observacao", "cObs", "cHistorico"),
    conciliado: bool(bruto, "cConciliado", "conciliado", "lConciliado") ?? false,
    dataConciliacao: data(bruto, "dDtConciliacao", "data_conciliacao"),
    tituloCodigo: str(bruto, "nCodTitulo", "codigo_titulo"),
  };
}

export function normalizarNfe(bruto: Bruto): NotaNormalizada | null {
  const cabec = obj(bruto, "compl", "nfCabecalho", "cabecalho") ?? bruto;
  const total = obj(bruto, "total", "nfTotal") ?? bruto;
  const icmsTot = obj(total, "ICMSTot", "icmsTot") ?? total;

  const numero = str(cabec, "nNF", "numero_nfe", "nNumero");
  const dataEmissao = data(cabec, "dEmi", "dhEmi", "data_emissao", "dEmissao");
  const valorCents = cents(icmsTot, "vNF", "valor_nota", "vProd");
  if (!numero || !dataEmissao || valorCents === null) return null;

  const serie = str(cabec, "serie", "cSerie");
  return {
    tipo: "NFE",
    chave: `NFE:${numero}:${serie ?? "-"}`,
    numero,
    serie,
    chaveAcesso: str(bruto, "cChaveNFe", "chave_nfe") ?? str(cabec, "cChaveNFe"),
    dataEmissao,
    parceiroCodigo: str(bruto, "nCodCli", "codigo_cliente") ?? str(cabec, "nCodCli"),
    parceiroNome: str(bruto, "cRazaoSocial", "nome_cliente") ?? str(cabec, "cRazaoSocial"),
    valorCents,
    valorServicosCents: null,
    baseIssCents: cents(icmsTot, "vBCISS"),
    valorIssCents: cents(icmsTot, "vISS"),
    valorPisCents: cents(icmsTot, "vPIS"),
    valorCofinsCents: cents(icmsTot, "vCOFINS"),
    valorIcmsCents: cents(icmsTot, "vICMS"),
    valorIpiCents: cents(icmsTot, "vIPI"),
    valorIrCents: null,
    valorCsllCents: null,
    valorInssCents: null,
    cancelada: /cancelad/i.test(str(bruto, "cStatus", "situacao", "cSituacao") ?? ""),
    naturezaOperacao: str(cabec, "natOp", "natureza_operacao"),
    cfop: str(bruto, "cfop", "CFOP"),
  };
}

export function normalizarNfse(bruto: Bruto): NotaNormalizada | null {
  const cabec = obj(bruto, "Cabecalho", "cabecalho", "NFSeCabecalho") ?? bruto;
  const impostos = obj(bruto, "ListaImpostosRetidos", "impostos", "Impostos") ?? bruto;

  const numero = str(cabec, "nNumeroNFSe", "numero_nfse", "cNumero", "nNumero");
  const dataEmissao = data(cabec, "dDataEmissao", "data_emissao", "dEmissao");
  const valorCents = cents(cabec, "nValorTotalNFSe", "valor_total", "nValorTotal", "nValorServico");
  if (!numero || !dataEmissao || valorCents === null) return null;

  const serie = str(cabec, "cSerie", "serie");
  return {
    tipo: "NFSE",
    chave: `NFSE:${numero}:${serie ?? "-"}`,
    numero,
    serie,
    chaveAcesso: str(cabec, "cCodigoVerificacao", "codigo_verificacao"),
    dataEmissao,
    parceiroCodigo: str(cabec, "nCodCliente", "codigo_cliente"),
    parceiroNome: str(cabec, "cRazaoSocial", "cNomeCliente", "razao_social"),
    valorCents,
    valorServicosCents: cents(cabec, "nValorServico", "valor_servico"),
    baseIssCents: cents(impostos, "nBaseIss", "nValorBaseIss"),
    valorIssCents: cents(impostos, "nValorIss", "nIss"),
    valorPisCents: cents(impostos, "nValorPis", "nPis"),
    valorCofinsCents: cents(impostos, "nValorCofins", "nCofins"),
    valorIcmsCents: null,
    valorIpiCents: null,
    valorIrCents: cents(impostos, "nValorIr", "nIr"),
    valorCsllCents: cents(impostos, "nValorCsll", "nCsll"),
    valorInssCents: cents(impostos, "nValorInss", "nInss"),
    cancelada: /cancelad/i.test(str(cabec, "cStatus", "cSituacao", "situacao") ?? ""),
    naturezaOperacao: str(cabec, "cNaturezaOperacao", "natureza_operacao"),
    cfop: null,
  };
}
