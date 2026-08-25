// Formas NORMALIZADAS dos dados da Omie — o que o sync grava no espelho
// local. As formas cruas da API nao sao tipadas de proposito: a resposta da
// Omie varia de nome de campo entre endpoints (e entre versoes do mesmo
// endpoint), entao a leitura passa toda pelos coletores tolerantes de
// src/lib/omie/mapping.ts, que aceitam a lista de aliases conhecidos de cada
// campo. Tipar a resposta crua daria uma falsa sensacao de garantia e
// quebraria o sync inteiro no dia em que um campo mudasse de nome.

export type OmieNatureza = "PAGAR" | "RECEBER";

export type ParceiroNormalizado = {
  codigoOmie: string;
  codigoIntegracao: string | null;
  nome: string;
  nomeFantasia: string | null;
  documento: string | null;
  ehCliente: boolean;
  ehFornecedor: boolean;
  email: string | null;
  cidade: string | null;
  estado: string | null;
  inativo: boolean;
  bloqueado: boolean;
  contaBancariaHash: string | null;
};

export type CategoriaNormalizada = {
  codigo: string;
  descricao: string;
  natureza: string | null;
  categoriaSuperior: string | null;
  totalizadora: boolean;
  inativa: boolean;
};

export type DepartamentoNormalizado = {
  codigo: string;
  descricao: string;
  estrutura: string | null;
  inativo: boolean;
};

export type ProjetoNormalizado = {
  codigo: string;
  nome: string;
  inativo: boolean;
};

export type ContaCorrenteNormalizada = {
  codigo: string;
  descricao: string;
  tipo: string | null;
  banco: string | null;
  agencia: string | null;
  numeroConta: string | null;
  saldoInicialCents: number;
  inativa: boolean;
};

export type BaixaNormalizada = {
  chave: string;
  dataBaixa: Date;
  valorCents: number;
  jurosCents: number;
  multaCents: number;
  descontoCents: number;
  tarifaCents: number;
  contaCorrenteCodigo: string | null;
  observacao: string | null;
  liquidaTitulo: boolean;
};

export type TituloNormalizado = {
  natureza: OmieNatureza;
  codigoLancamento: string;
  codigoIntegracao: string | null;
  parceiroCodigo: string | null;
  parceiroNome: string | null;
  parceiroDocumento: string | null;
  numeroDocumento: string | null;
  numeroParcela: string | null;
  tipoDocumento: string | null;
  categoriaCodigo: string | null;
  categoriaDescricao: string | null;
  departamentoCodigo: string | null;
  projetoCodigo: string | null;
  contaCorrenteCodigo: string | null;
  dataEmissao: Date | null;
  dataVencimento: Date;
  dataPrevisao: Date | null;
  dataRegistro: Date | null;
  dataEntrada: Date | null;
  valorDocumentoCents: number;
  saldoCents: number | null;
  valorPagoCents: number;
  jurosCents: number;
  multaCents: number;
  descontoCents: number;
  tarifaCents: number;
  // Retencoes na fonte, por tributo. Ver o comentario em OmieTitulo (schema):
  // ficam separadas porque cada uma tem guia e prazo proprios, e ausencia do
  // campo na resposta significa zero, nao desconhecido.
  retencaoIrCents: number;
  retencaoIssCents: number;
  retencaoPisCents: number;
  retencaoCofinsCents: number;
  retencaoCsllCents: number;
  retencaoInssCents: number;
  dataUltimaBaixa: Date | null;
  status: string;
  liquidado: boolean;
  cancelado: boolean;
  observacao: string | null;
  origem: string | null;
  alteradoEmOmie: Date | null;
  baixas: BaixaNormalizada[];
};

export type MovimentoNormalizado = {
  contaCorrenteCodigo: string;
  codigoLancamento: string;
  data: Date;
  // Com sinal: negativo = saida. Ver comentario em OmieMovimento (schema).
  valorCents: number;
  natureza: string | null;
  tipo: string | null;
  categoriaCodigo: string | null;
  parceiroCodigo: string | null;
  parceiroNome: string | null;
  documento: string | null;
  observacao: string | null;
  // NULO QUANDO A FONTE NÃO DIZ, e não `false`.
  //
  // `false` aqui seria uma afirmação — "este movimento não está conciliado" —
  // onde só existe ausência de informação. E o diagnóstico conta `false` como
  // campo preenchido (corretamente: zero e falso são respostas legítimas), de
  // modo que a diferença sumiria justo na tela feita para revelá-la. A
  // movimentação financeira não devolve estado de conciliação; o extrato sim.
  conciliado: boolean | null;
  dataConciliacao: Date | null;
  tituloCodigo: string | null;
  // AS DUAS COLUNAS QUE SO A MOVIMENTACAO TRAZ.
  //
  // A tela "Movimentacao da Conta Corrente" mostra, na mesma linha, o tipo do
  // documento ("CT-e", "Nota Fiscal de Servico") e o numero fiscal — que e
  // justamente o que falta em 43% dos titulos de CT-e espelhados e o que obriga
  // a conferencia a casar por valor e data. Opcionais porque o extrato bancario
  // nao tem nenhuma das duas: ali a linha e do banco, nao do documento.
  tipoDocumento?: string | null;
  documentoFiscal?: string | null;
};

export type NotaNormalizada = {
  tipo: "NFE" | "NFSE";
  chave: string;
  numero: string | null;
  serie: string | null;
  chaveAcesso: string | null;
  dataEmissao: Date;
  parceiroCodigo: string | null;
  parceiroNome: string | null;
  valorCents: number;
  valorServicosCents: number | null;
  baseIssCents: number | null;
  valorIssCents: number | null;
  valorPisCents: number | null;
  valorCofinsCents: number | null;
  valorIcmsCents: number | null;
  valorIpiCents: number | null;
  valorIrCents: number | null;
  valorCsllCents: number | null;
  valorInssCents: number | null;
  cancelada: boolean;
  naturezaOperacao: string | null;
  cfop: string | null;
};

export type PaginaOmie<T> = {
  itens: T[];
  pagina: number;
  totalPaginas: number;
  totalRegistros: number;
};
