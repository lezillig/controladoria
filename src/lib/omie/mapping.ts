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

// BUSCA TOLERANTE A CAIXA E A ESPACO NO NOME DO CAMPO.
//
// O diagnostico das duas contas reais mostrou duas armadilhas na resposta da
// Omie, e as duas produzem o mesmo estrago silencioso: campo lido como nulo,
// registro gravado vazio, e o problema so aparece semanas depois como "por que
// a coluna de imposto esta zerada".
//
//   CAIXA. A sigla do imposto vem em maiuscula — `nValorIR`, `nValorINSS`,
//   `nValorCOFINS` — enquanto o codigo procurava `nValorIr`. Uma letra.
//
//   ESPACO NO FIM DO NOME. A NF-e devolve, literalmente, `vRetPrev ` e
//   `vBCIbs ` com espaco no fim da CHAVE. Nao e erro de transcricao do
//   diagnostico: a lista de campos crus veio assim da conta. E
//   `obj["vRetPrev"]` nunca encontra `obj["vRetPrev "]`.
//
// Consertar campo a campo trataria os casos de hoje e deixaria os de amanha. A
// busca abaixo tenta primeiro o nome EXATO — quem escreveu o alias continua
// mandando — e so entao cai para a comparacao normalizada (sem espaco nas
// pontas, sem diferenca de caixa) sobre as chaves que o registro realmente tem.
//
// O indice normalizado e montado uma vez por objeto e guardado num WeakMap:
// cada registro tem dezenas de campos lidos em sequencia, e refazer o indice a
// cada leitura seria varrer o objeto inteiro dezenas de vezes por linha
// espelhada.
const indiceNormalizado = new WeakMap<Bruto, Map<string, unknown>>();

function normalizarChave(chave: string): string {
  return chave.trim().toLowerCase();
}

function buscar(obj: Bruto, key: string): unknown {
  const direto = obj[key];
  if (direto !== undefined) return direto;

  let indice = indiceNormalizado.get(obj);
  if (!indice) {
    indice = new Map<string, unknown>();
    for (const [k, v] of Object.entries(obj)) {
      const normal = normalizarChave(k);
      // A PRIMEIRA ocorrencia vence. Se um registro trouxesse `nValorIR` e
      // `nValorIr` ao mesmo tempo, a ordem de declaracao decide — e a busca
      // exata acima ja teria resolvido o caso de quem pediu o nome certo.
      if (!indice.has(normal)) indice.set(normal, v);
    }
    indiceNormalizado.set(obj, indice);
  }
  return indice.get(normalizarChave(key));
}

export function str(obj: Bruto | null | undefined, ...keys: string[]): string | null {
  if (!obj) return null;
  for (const key of keys) {
    const v = buscar(obj, key);
    if (typeof v === "string" && v.trim() !== "") return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

export function num(obj: Bruto | null | undefined, ...keys: string[]): number | null {
  if (!obj) return null;
  for (const key of keys) {
    const v = buscar(obj, key);
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
    const v = buscar(obj, key);
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
    const v = buscar(bruto, key);
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Bruto;
  }
  return null;
}

export function arr(bruto: Bruto | null | undefined, ...keys: string[]): Bruto[] {
  if (!bruto) return [];
  for (const key of keys) {
    const v = buscar(bruto, key);
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
    // `numero_conta_corrente` e o nome que a conta real devolve; os outros
    // ficam como alternativa. Sem ele a conciliacao bancaria nao consegue
    // casar o extrato com a conta de origem.
    numeroConta: str(bruto, "numero_conta_corrente", "conta_corrente", "cConta", "numero_conta"),
    saldoInicialCents: centsOuZero(bruto, "saldo_inicial", "nSaldoInicial"),
    inativa: (bool(bruto, "inativo") ?? false) || str(bruto, "inativo") === "S",
    // `nao_resumo` e `nao_fluxo` chegam como "S"/"N" nas duas contas reais.
    // `bool` ja entende S/N; o `=== "S"` cobre a variante em que a Omie manda
    // a letra dentro de um campo que `bool` nao reconheceu como booleano.
    naoEntraNoResumo: (bool(bruto, "nao_resumo") ?? false) || str(bruto, "nao_resumo") === "S",
    naoEntraNoFluxo: (bool(bruto, "nao_fluxo") ?? false) || str(bruto, "nao_fluxo") === "S",
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
    // A receber devolve `cCodProjeto`; a pagar nao devolve projeto nenhum.
    projetoCodigo: str(cabec, "cCodProjeto", "nCodProjeto", "codigo_projeto"),
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
    // Retencoes: lidas do cabecalho do titulo, onde a Omie as devolve com a
    // sigla em MAIUSCULA. Os aliases em outra caixa ficam de propósito — a
    // busca ja e tolerante, mas o nome escrito aqui documenta o que a conta
    // real devolve, que e o que o diagnostico mostrou.
    //
    // `centsOuZero` e nao `cents`: a Omie omite o campo quando nao ha
    // retencao, e gravar nulo faria "sem retencao" e "nao sei" virarem a mesma
    // coisa na hora de somar.
    retencaoIrCents: centsOuZero(cabec, "nValorIR", "nValorIr", "nValorIRRF"),
    retencaoIssCents: centsOuZero(cabec, "nValorISS", "nValorIss"),
    retencaoPisCents: centsOuZero(cabec, "nValorPIS", "nValorPis"),
    retencaoCofinsCents: centsOuZero(cabec, "nValorCOFINS", "nValorCofins"),
    retencaoCsllCents: centsOuZero(cabec, "nValorCSLL", "nValorCsll"),
    retencaoInssCents: centsOuZero(cabec, "nValorINSS", "nValorInss"),
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
    conciliado: bool(bruto, "cConciliado", "conciliado", "lConciliado"),
    dataConciliacao: data(bruto, "dDtConciliacao", "data_conciliacao"),
    tituloCodigo: str(bruto, "nCodTitulo", "codigo_titulo"),
  };
}

// MOVIMENTO FINANCEIRO — `financas/mf/ListarMovimentos`.
//
// Estrutura ANINHADA, ao contrario do extrato: cada item vem como
// { detalhes: {...}, resumo: {...}, categorias: [...], departamentos: [...] }.
// O `?? bruto` em cada bloco e o que faz esta funcao sobreviver a resposta
// achatada — se a conta devolver os campos na raiz, ela le igual, em vez de
// descartar tudo em silencio, que e o modo de falhar caro deste ERP.
//
// AINDA NAO E GRAVADA. Existe para o diagnostico dizer, contra a conta real,
// quais destes campos chegam preenchidos. So depois disso vale ligar no sync.
export function normalizarMovimentoFinanceiro(bruto: Bruto): MovimentoNormalizado | null {
  const det = obj(bruto, "detalhes", "cabecTitulo", "cabecalho") ?? bruto;
  const res = obj(bruto, "resumo") ?? bruto;

  const conta = str(det, "nCodCC", "codigo_conta_corrente", "nCodContaCorrente");
  // A data do movimento e a do PAGAMENTO/baixa — e a que a tela mostra na
  // linha conciliada e a que faz sentido conciliar contra o banco. Vencimento
  // e emissao entram so como ultimo recurso, para o registro nao ser
  // descartado por falta de data.
  const dataMov =
    data(det, "dDtPagamento", "data_pagamento", "dDtBaixa") ??
    data(det, "dDtPrevisao", "data_previsao") ??
    data(det, "dDtVenc", "data_vencimento");
  if (!conta || !dataMov) return null;

  // Valor: o PAGO, quando ha; o do titulo, quando o movimento ainda nao foi
  // baixado. Somar os dois seria contar o mesmo dinheiro duas vezes.
  const valorBruto =
    num(res, "nValPago", "valor_pago") ??
    num(det, "nValorTitulo", "valor_documento", "nValorMovimento");
  if (valorBruto === null) return null;

  const natureza = str(det, "cNatureza", "natureza", "cTipoOperacao");
  // Natureza "P" (a pagar) e saida. O extrato usa "D"/"C"; aqui o vocabulario
  // e outro, e tratar os dois no mesmo lugar e o que evita um sinal invertido
  // aparecer meses depois como saldo que nao fecha.
  const ehSaida = natureza !== null && /^(p|d)/i.test(natureza);
  const valorCents = Math.round(Math.abs(valorBruto) * 100) * (ehSaida ? -1 : 1);

  const codigo = str(det, "nCodTitulo", "codigo_lancamento", "nCodMovCC", "cCodIntTitulo");
  if (!codigo) return null;

  return {
    contaCorrenteCodigo: conta,
    codigoLancamento: codigo,
    data: dataMov,
    valorCents,
    natureza,
    tipo: str(det, "cTipo", "cCodTipoDoc", "tipo"),
    categoriaCodigo: str(det, "cCodCateg", "cCategoria", "codigo_categoria"),
    parceiroCodigo: str(det, "nCodCliente", "codigo_cliente", "nCodFornecedor"),
    parceiroNome: str(det, "cRazaoSocial", "cNomeCliente", "cNomeFornecedor"),
    documento: str(det, "cNumTitulo", "cNumDoc", "numero_documento"),
    observacao: str(det, "cObservacoes", "observacao", "cHistorico"),
    // "Conciliado" e "Conciliado (bloqueado)" na tela; o vocabulario da API
    // ainda nao foi visto. `bool` cobre S/N e true/false; o `?? ` deixa a
    // ausencia como nao-conciliado, que e a leitura conservadora.
    conciliado: bool(det, "cConciliado", "lConciliado", "conciliado"),
    dataConciliacao: data(det, "dDtConciliacao", "data_conciliacao"),
    tituloCodigo: str(det, "nCodTitulo", "codigo_titulo"),
    tipoDocumento: str(det, "cTipo", "cCodTipoDoc", "cTipoDocumento"),
    documentoFiscal: str(det, "cNumDocFiscal", "numero_documento_fiscal", "cNumNFSe"),
  };
}

// NF-e — estrutura real de `ListarNF`, conferida pelo diagnostico.
//
// A versao anterior procurava numero, serie e data dentro de `compl` e
// descartava toda nota. `compl` guarda os identificadores internos da Omie
// (cChaveNFe, nIdNF, cCodCateg); a identificacao FISCAL da nota mora em `ide`,
// que e o bloco homonimo do layout da NF-e. O destinatario tem bloco proprio,
// `nfDestInt`.
export function normalizarNfe(bruto: Bruto): NotaNormalizada | null {
  const compl = obj(bruto, "compl", "nfCabecalho", "cabecalho") ?? bruto;
  const ide = obj(bruto, "ide") ?? compl;
  const dest = obj(bruto, "nfDestInt", "nfDest", "destinatario") ?? bruto;
  const total = obj(bruto, "total", "nfTotal") ?? bruto;
  const icmsTot = obj(total, "ICMSTot", "icmsTot") ?? total;
  // ISS de NF-e vive em bloco separado do de ICMS — em transporte a nota de
  // produto raramente tem ISS, mas quando tem e o imposto que importa.
  const issqnTot = obj(total, "ISSQNtot", "issqnTot") ?? icmsTot;
  // Retencoes na fonte — bloco `retTrib` do layout da NF-e. E onde ficam IRRF,
  // CSLL e INSS (previdenciaria), que nao aparecem em ICMSTot. Importa para a
  // conferencia da DCTFWeb: retencao lancada na nota e nao recolhida e uma das
  // divergencias que a consultoria aponta todo mes.
  const retTrib = obj(total, "retTrib", "retTribTot") ?? {};

  const numero = str(ide, "nNF", "numero_nfe", "nNumero");
  const dataEmissao = data(ide, "dEmi", "dhEmi", "data_emissao", "dEmissao");
  const valorCents = cents(icmsTot, "vNF", "valor_nota", "vProd");
  if (!numero || !dataEmissao || valorCents === null) return null;

  const serie = str(ide, "serie", "cSerie");
  return {
    tipo: "NFE",
    chave: `NFE:${numero}:${serie ?? "-"}`,
    numero,
    serie,
    chaveAcesso: str(compl, "cChaveNFe", "chave_nfe") ?? str(bruto, "cChaveNFe"),
    dataEmissao,
    parceiroCodigo: str(dest, "nCodCli", "codigo_cliente"),
    parceiroNome: str(dest, "cRazao", "cRazaoSocial", "nome_cliente"),
    valorCents,
    valorServicosCents: cents(issqnTot, "vServ"),
    baseIssCents: cents(issqnTot, "vBC", "vBCISS"),
    valorIssCents: cents(issqnTot, "vISS"),
    valorPisCents: cents(icmsTot, "vPIS") ?? cents(issqnTot, "vPIS") ?? cents(retTrib, "vRetPIS"),
    valorCofinsCents: cents(icmsTot, "vCOFINS") ?? cents(issqnTot, "vCOFINS") ?? cents(retTrib, "vRetCOFINS"),
    valorIcmsCents: cents(icmsTot, "vICMS"),
    valorIpiCents: cents(icmsTot, "vIPI"),
    valorIrCents: cents(retTrib, "vIRRF", "vRetIRRF"),
    valorCsllCents: cents(retTrib, "vRetCSLL", "vCSLL"),
    valorInssCents: cents(retTrib, "vRetPrev", "vRetINSS", "vINSS"),
    // A Omie nao devolve texto de status aqui: a nota cancelada e a que tem
    // data de cancelamento (`dCan`), e a denegada tem `cDeneg`. Ler status por
    // texto, como antes, nunca marcaria nenhuma — e nota cancelada com titulo
    // vivo e justamente um dos achados do agente fiscal.
    cancelada: data(ide, "dCan") !== null || (str(ide, "cDeneg") ?? "") !== "",
    naturezaOperacao: str(ide, "natOp", "natureza_operacao") ?? str(compl, "natOp"),
    cfop: str(bruto, "cfop", "CFOP"),
  };
}

// NFS-e — a estrutura real de `ListarNFSEs` na conta do grupo, conferida pelo
// diagnostico contra as duas empresas.
//
// A versao anterior descartava TODA nota: procurava data e valor dentro de
// `Cabecalho`, e nenhum dos dois mora la. A data fica em `Emissao`, num bloco
// separado; o valor e `nValorNFSe`, nao `nValorTotalNFSe`. Como o normalizador
// exige numero + data + valor para aceitar o registro, faltar qualquer um
// derruba a nota inteira — e no fretamento a NFS-e e a receita principal, entao
// o efeito seria a base nascer sem faturamento.
// A NOTA DE SERVICO ESTA CANCELADA?
//
// Era `/cancelad/i` sobre o status. Parece bastar, e nao basta: a prefeitura
// nao devolve so "Cancelada". O ciclo de cancelamento tem etapas, e o texto do
// status acompanha — "Cancelamento Solicitado", "Cancelamento Homologado". E
// `/cancelad/i` NAO casa com "cancelamento": a palavra tem `cancelam`, nao
// `cancelad`. Uma letra, e treze notas de julho entraram na receita do mes com
// o cancelamento ja homologado na prefeitura.
//
// Pior que o numero errado: a regra FI-NOTA-CANCELADA do agente fiscal —
// "nota cancelada, mas o titulo continua vivo" — depende deste campo. Com a
// deteccao falhando, ela nunca disparava. O sistema tinha a regra certa e nunca
// chegava a aplica-la, que e a forma mais cara de errar num modulo de auditoria.
//
// A NEGATIVA IMPORTA TANTO QUANTO. "Cancelamento Rejeitado" e "Cancelamento
// Negado" contem a palavra e significam o oposto: a nota vale, o pedido de
// cancelamento e que caiu. Marcar essas como canceladas tiraria da receita nota
// legitima — trocaria um erro de mais por um erro de menos, que num relatorio
// fiscal e o pior dos dois.
const CANCELAMENTO_NEGADO = /rejeitad|negad|recusad|indeferid/i;

export function notaCancelada(status: string | null | undefined): boolean {
  const texto = (status ?? "").trim();
  if (texto === "") return false;
  if (CANCELAMENTO_NEGADO.test(texto)) return false;
  return /cancel/i.test(texto);
}

export function normalizarNfse(bruto: Bruto): NotaNormalizada | null {
  const cabec = obj(bruto, "Cabecalho", "cabecalho", "NFSeCabecalho") ?? bruto;
  const emissao = obj(bruto, "Emissao", "emissao") ?? bruto;
  const valores = obj(bruto, "Valores", "valores") ?? bruto;
  const rps = obj(bruto, "RPS", "rps") ?? {};
  // ListaImpostosRetidos nao vem nesta conta; o que existe e o marcador
  // `cIssRetido` em Valores. Os nomes antigos ficam como alternativa para
  // contas que devolvam o bloco detalhado.
  const impostos = obj(bruto, "ListaImpostosRetidos", "impostos", "Impostos") ?? valores;

  const numero = str(cabec, "nNumeroNFSe", "numero_nfse", "cNumero", "nNumero");
  const dataEmissao =
    data(emissao, "cDataEmissao", "dDataEmissao", "data_emissao") ??
    data(cabec, "dDataEmissao", "data_emissao", "dEmissao");
  const valorCents =
    cents(cabec, "nValorNFSe", "nValorTotalNFSe", "valor_total", "nValorTotal") ??
    cents(valores, "nValorTotalServicos", "nValorLiquido");
  if (!numero || !dataEmissao || valorCents === null) return null;

  const serie = str(rps, "cSerieRPS") ?? str(cabec, "cSerie", "serie");
  return {
    tipo: "NFSE",
    chave: `NFSE:${numero}:${serie ?? "-"}`,
    numero,
    serie,
    chaveAcesso: str(cabec, "cCodigoVerifNFSe", "cCodigoVerificacao", "codigo_verificacao"),
    dataEmissao,
    parceiroCodigo: str(cabec, "nCodigoCliente", "nCodCliente", "codigo_cliente"),
    // O tomador do servico e o DESTINATARIO. `cRazaoEmissor` tambem vem no
    // bloco e e a propria empresa — usar o nome errado aqui faria todo o
    // faturamento aparecer como se fosse para si mesma.
    parceiroNome: str(cabec, "cRazaoDestinatario", "cRazaoSocial", "cNomeCliente", "razao_social"),
    valorCents,
    valorServicosCents: cents(valores, "nValorTotalServicos", "nValorServico", "valor_servico"),
    baseIssCents: cents(impostos, "nBaseIss", "nValorBaseIss"),
    valorIssCents: cents(impostos, "nValorIss", "nIss"),
    valorPisCents: cents(impostos, "nValorPis", "nPis"),
    valorCofinsCents: cents(impostos, "nValorCofins", "nCofins"),
    valorIcmsCents: null,
    valorIpiCents: null,
    valorIrCents: cents(impostos, "nValorIr", "nIr"),
    valorCsllCents: cents(impostos, "nValorCsll", "nCsll"),
    valorInssCents: cents(impostos, "nValorInss", "nInss"),
    cancelada: notaCancelada(str(cabec, "cStatusNFSe", "cStatus", "cSituacao", "situacao")),
    naturezaOperacao: str(cabec, "cNaturezaOperacao", "natureza_operacao"),
    cfop: null,
  };
}
