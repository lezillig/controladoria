import ExcelJS from "exceljs";
import { clausulaDeReequilibrio, lerInicio, proximoMes, reformaAnoAAno } from "./reforma";
import { ADICIONAL_NOTURNO_PADRAO, CSLL_LOCACAO_PADRAO, DIAS_VR_MAXIMO, IRPJ_LOCACAO_PADRAO } from "./motor";
import { ROTULO_ENERGIA, ROTULO_TIPO_VEICULO, type EntradaSimulacao, type PerfilVeiculo, type Premissas, type ResultadoSimulacao } from "./tipos";

// A PLANILHA EXCEL DE UMA SIMULAÇÃO — abas Regras do Edital, Premissas, Perfis
// de Veículo, Rotas, Composição de Custo, Cenários e Proposta, no padrão das planilhas de
// referência (docs/simulador_custos_handoff/scripts/gerar_planilha_sjp.py e
// gerar_planilha_holambra.py).
//
// A planilha não é um relatório de números: é a CONTA, em fórmulas. Os únicos
// valores digitados são as premissas, as rotas, os preços máximos/de
// referência e o preço de teste dos cenários; todo o resto é fórmula e se
// recalcula quando alguém muda uma premissa no Excel. As fórmulas são as do
// motor (motor.ts), célula a célula — scripts/teste-exportar-xlsx.ts recalcula
// a planilha com um motor de planilha independente e compara com `simular()`.
//
// Um só leiaute para os dois modos (MENSAL, como SJP; PERIODO, como Holambra),
// para qualquer número de itens e para as cinco unidades de preço (km,
// veículo-mês, diária, hora, binômia): a Composição tem os componentes nas
// linhas, uma coluna por item e uma coluna de total/lote. O que depende da
// rota — perfil do veículo (com o salário do motorista), fator noturno, horas
// extras, divisão asfalto/terra, diárias e horas — é calculado em colunas
// auxiliares da aba Rotas e somado por item com SOMASE pelo código do item. O
// custo mensal de cada perfil de veículo (depreciação percentual, linear ou
// soma dos dígitos, ano a ano do contrato; capital simples ou composto, sobre
// o valor cheio ou o médio; adaptações; manutenção fixa) fica na aba Perfis de
// Veículo, e a rota o busca pelo código com ÍNDICE/CORRESP.
//
// Convenção de cores das referências: azul = entrada, preto = fórmula,
// verde = link de outra aba, fundo amarelo = preencher. Fonte Arial.
//
// Função pura: a mesma entrada dá a mesma planilha (a data de geração vem em
// `geradoEm`, não do relógio).

export type DadosExportacao = {
  edital: {
    numero: string;
    orgao: string;
    municipio: string;
    uf: string;
    objeto: string;
    dataSessao: string | null;
    plataforma: string | null;
  };
  // localData: "cidade, dia de mês de ano" do dia da geração; localInformado
  // diz se a cidade veio do cadastro (sem ela, só a data).
  licitante: { razaoSocial: string; cnpj: string; endereco?: string | null; representante?: string | null; localData?: string | null; localInformado?: boolean };
  // Público (padrão): proposta de licitação, com as declarações do edital.
  // Privado: proposta comercial, com as condições do estudo.
  esfera?: "PUBLICO" | "PRIVADO";
  comercial?: {
    cliente?: string | null;
    validadeProposta?: string | null;
    inicioPrevisto?: string | null;
    indiceReajuste?: string | null;
    formaFaturamento?: string | null;
    avisoRescisaoDias?: number | null;
  };
  regras: { tema: string; texto: string; impacto: string; campo: string | null }[];
  entrada: EntradaSimulacao;
  resultado: ResultadoSimulacao;
  versao: number;
  geradoEm: Date;
};

// Nomes das abas, na ordem da pasta. O teste confere a ordem.
export const ABAS = ["Regras do Edital", "Premissas", "Perfis de Veículo", "Rotas", "Composição de Custo", "Cenários", "Reforma", "Proposta"] as const;

// ---------------------------------------------------------------- estilo

const FONTE = "Arial";
const AZUL = "FF0000FF";
const VERDE = "FF008000";
const BRANCO = "FFFFFFFF";
const AZUL_ESCURO = "FF1F3864";

const BRL = "R$ #,##0.00;[Red](R$ #,##0.00);-";
const BRL4 = "R$ #,##0.0000;[Red](R$ #,##0.0000);-";
const PCT = "0.0%";
const PCT2 = "0.00%";
const NUM = "#,##0.00";
const INT = "#,##0";
const DPCT = "+0.0%;-0.0%;0.0%";

const preenchimento = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const FUNDO_TITULO = preenchimento(AZUL_ESCURO);
const FUNDO_CABECALHO = preenchimento("FF2F5496");
const FUNDO_PREENCHER = preenchimento("FFFFFF00");
const FUNDO_SECAO = preenchimento("FFE2EFDA");
const FUNDO_TOTAL = preenchimento("FFF2F2F2");
const fino: Partial<ExcelJS.Border> = { style: "thin", color: { argb: "FFBFBFBF" } };
const BORDA: Partial<ExcelJS.Borders> = { top: fino, left: fino, bottom: fino, right: fino };
const QUEBRA: Partial<ExcelJS.Alignment> = { wrapText: true, vertical: "top" };

type Tipo = "entrada" | "formula" | "link" | "texto";
type Valor = string | number | null | { formula: string };
type Opcoes = {
  tipo?: Tipo;
  negrito?: boolean;
  tamanho?: number;
  fmt?: string;
  fundo?: ExcelJS.Fill;
  borda?: boolean;
  quebra?: boolean;
  alinhar?: Partial<ExcelJS.Alignment>;
};

// Fórmula sem o "=" inicial, como o exceljs grava.
const fx = (formula: string): { formula: string } => ({ formula: formula.replace(/^=/, "") });

function escrever(ws: ExcelJS.Worksheet, linha: number, coluna: number, valor: Valor, o: Opcoes = {}): ExcelJS.Cell {
  const c = ws.getCell(linha, coluna);
  c.value = valor;
  const cor = o.tipo === "entrada" ? AZUL : o.tipo === "link" ? VERDE : undefined;
  c.font = { name: FONTE, size: o.tamanho ?? 10, bold: o.negrito ?? false, ...(cor ? { color: { argb: cor } } : {}) };
  if (o.fmt) c.numFmt = o.fmt;
  if (o.fundo) c.fill = o.fundo;
  if (o.borda ?? true) c.border = BORDA;
  if (o.quebra) c.alignment = QUEBRA;
  if (o.alinhar) c.alignment = { ...(c.alignment ?? {}), ...o.alinhar };
  return c;
}

function titulo(ws: ExcelJS.Worksheet, linha: number, texto: string, colunas: number) {
  ws.mergeCells(linha, 1, linha, Math.max(colunas, 1));
  const c = ws.getCell(linha, 1);
  c.value = texto;
  c.font = { name: FONTE, size: 13, bold: true, color: { argb: BRANCO } };
  c.fill = FUNDO_TITULO;
  c.alignment = { vertical: "middle" };
  ws.getRow(linha).height = 22;
}

function nota(ws: ExcelJS.Worksheet, linha: number, texto: string, colunas: number, altura = 30) {
  ws.mergeCells(linha, 1, linha, Math.max(colunas, 1));
  const c = ws.getCell(linha, 1);
  c.value = texto;
  c.font = { name: FONTE, size: 9 };
  c.alignment = QUEBRA;
  ws.getRow(linha).height = altura;
}

function secao(ws: ExcelJS.Worksheet, linha: number, texto: string, colunas: number) {
  for (let col = 1; col <= colunas; col++) ws.getCell(linha, col).fill = FUNDO_SECAO;
  const c = ws.getCell(linha, 1);
  c.value = texto;
  c.font = { name: FONTE, size: 11, bold: true, color: { argb: AZUL_ESCURO } };
}

function cabecalho(ws: ExcelJS.Worksheet, linha: number, textos: string[], larguras?: number[], altura = 32) {
  textos.forEach((t, i) => {
    const c = ws.getCell(linha, i + 1);
    c.value = t;
    c.font = { name: FONTE, size: 10, bold: true, color: { argb: BRANCO } };
    c.fill = FUNDO_CABECALHO;
    c.border = BORDA;
    c.alignment = { wrapText: true, horizontal: "center", vertical: "middle" };
    if (larguras) ws.getColumn(i + 1).width = larguras[i];
  });
  ws.getRow(linha).height = altura;
}

function larguras(ws: ExcelJS.Worksheet, ls: number[]) {
  ls.forEach((l, i) => (ws.getColumn(i + 1).width = l));
}

function congelar(ws: ExcelJS.Worksheet, colunas: number, linhas: number) {
  ws.views = [{ state: "frozen", xSplit: colunas, ySplit: linhas }];
}

function lista(ws: ExcelJS.Worksheet, linha: number, coluna: number, opcoes: string[]) {
  ws.getCell(linha, coluna).dataValidation = { type: "list", allowBlank: false, formulae: [`"${opcoes.join(",")}"`] };
}

// A, B, ..., Z, AA, AB...
export function letraColuna(n: number): string {
  let s = "";
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
}

const dataBr = (iso: string | null) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10).split("-").reverse().join("/") : iso);
const quando = (d: Date) =>
  d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

// ---------------------------------------------------------------- planilha

const UNIDADES = ["KM", "VEICULO_MES", "DIARIA", "HORA", "BINOMIA"] as const;
const METODOS = ["PERCENTUAL", "LINEAR", "SOMA_DIGITOS"] as const;
// Código da coluna do veículo padrão na aba Perfis de Veículo. Rota sem perfil
// (ou com um código que não existe) usa esta coluna, como o motor.
export const PERFIL_PADRAO = "PADRÃO";

export async function gerarPlanilhaSimulacao(d: DadosExportacao): Promise<Buffer> {
  const { edital, licitante, entrada, resultado } = d;
  const p = entrada.premissas;
  const itens = entrada.itens;
  const rotas = entrada.rotas;
  const perfis = p.perfis ?? [];
  const mensal = p.contrato.modo === "MENSAL";
  const lote = entrada.criterio === "LOTE";
  const unidadePreco = entrada.unidadePreco ?? "KM";
  const apuracao = mensal ? "mês" : "período";
  const sn = (b: boolean) => (b ? "S" : "N");

  const wb = new ExcelJS.Workbook();
  wb.creator = "Controladoria — Simulador de custos";
  wb.created = d.geradoEm;
  wb.modified = d.geradoEm;
  // Sem valores guardados nas fórmulas: o Excel recalcula tudo ao abrir.
  wb.calcProperties = { fullCalcOnLoad: true };

  const [wsRegras, ws, wf, wr, wc, wz, wReforma, wp] = ABAS.map((nome) => wb.addWorksheet(nome));

  // ============================================================ REGRAS DO EDITAL
  const privado = d.esfera === "PRIVADO";
  titulo(wsRegras, 1, privado ? `CONDIÇÕES DO CLIENTE COM IMPACTO NO CUSTO — ${edital.numero}` : `REGRAS DO EDITAL / TR COM IMPACTO NO CUSTO E NA PARTICIPAÇÃO — ${edital.numero}`, 4);
  cabecalho(wsRegras, 3, ["Tema", "Regra (fonte)", "Impacto no custo / risco", "Onde está na planilha"], [22, 70, 55, 26], 20);
  if (d.regras.length === 0) {
    escrever(wsRegras, 4, 1, privado ? "Nenhuma condição do cliente registrada nesta simulação." : "Nenhuma regra do edital registrada nesta simulação.", { borda: false, tamanho: 9 });
  }
  d.regras.forEach((rg, i) => {
    const l = 4 + i;
    [rg.tema, rg.texto, rg.impacto, rg.campo ?? "—"].forEach((v, j) =>
      escrever(wsRegras, l, j + 1, v, { negrito: j === 0, tamanho: j === 0 ? 10 : 9, quebra: true })
    );
    wsRegras.getRow(l).height = 62;
  });
  congelar(wsRegras, 0, 3);

  // ============================================================ PREMISSAS
  larguras(ws, [54, 18, 16, 74]);
  titulo(ws, 1, `PLANILHA DE CUSTOS — ${edital.numero} — ${edital.orgao} — ${edital.municipio}/${edital.uf}`, 4);
  const sessao = [dataBr(edital.dataSessao), edital.plataforma].filter(Boolean).join(", ");
  nota(
    ws,
    2,
    "Legenda: azul = entrada editável · amarelo = preencher · preto = fórmula · verde = link de outra aba. " +
      `Objeto: ${edital.objeto}` +
      (sessao ? ` Sessão: ${sessao}.` : "") +
      ` Simulação versão ${d.versao}, gerada em ${quando(d.geradoEm)}. Mudar um número azul recalcula todas as abas.`,
    4,
    54
  );
  cabecalho(ws, 4, ["Item", "Valor", "Unid.", "Observação / fonte / regra do edital"], undefined, 20);

  // Endereço absoluto de cada premissa, pela chave.
  const P: Record<string, string> = {};
  let lp = 5;
  const premissa = (chave: string, rotulo: string, valor: string | number, unidade: string, obs: string, fmt?: string, preencher = false) => {
    escrever(ws, lp, 1, rotulo);
    escrever(ws, lp, 2, valor, { tipo: "entrada", fmt, fundo: preencher ? FUNDO_PREENCHER : undefined });
    escrever(ws, lp, 3, unidade);
    escrever(ws, lp, 4, obs, { tamanho: 9, quebra: true });
    P[chave] = `Premissas!$B$${lp}`;
    return lp++;
  };
  const escolha = (chave: string, rotulo: string, valor: string, opcoes: readonly string[], obs: string) =>
    lista(ws, premissa(chave, rotulo, valor, "", obs), 2, [...opcoes]);
  const derivada = (chave: string, rotulo: string, formula: string, unidade: string, obs: string, fmt: string) => {
    escrever(ws, lp, 1, rotulo, { negrito: true });
    escrever(ws, lp, 2, fx(formula), { negrito: true, fmt });
    escrever(ws, lp, 3, unidade);
    escrever(ws, lp, 4, obs, { tamanho: 9, quebra: true });
    P[chave] = `Premissas!$B$${lp}`;
    return lp++;
  };
  const novaSecao = (texto: string) => {
    if (lp > 5) lp++;
    secao(ws, lp++, texto, 4);
  };

  novaSecao(privado ? "1. DADOS DA PROPONENTE" : "1. DADOS DO LICITANTE");
  premissa("razao", "Razão social", licitante.razaoSocial, "", "Conforme o CNPJ.");
  premissa("cnpj", "CNPJ", licitante.cnpj, "", "");
  premissa("endereco", "Endereço da sede", licitante.endereco ?? "", "", licitante.endereco ? "" : "PREENCHER — endereço completo da sede.", undefined, !licitante.endereco);
  premissa(
    "representante",
    "Representante legal (nome / RG / CPF / cargo)",
    licitante.representante ?? "",
    "",
    licitante.representante ? "Assina a proposta e as declarações." : "PREENCHER — assina a proposta e as declarações.",
    undefined,
    !licitante.representante
  );
  premissa(
    "localData",
    "Local e data da proposta",
    licitante.localData ?? "",
    "",
    licitante.localInformado ? "Data do dia em que a planilha foi gerada." : "PREENCHER a cidade — informe-a em Conexões → Dados para propostas.",
    undefined,
    !licitante.localInformado
  );

  novaSecao("2. PARÂMETROS DO CONTRATO");
  escolha("modo", "Modo de apuração (MENSAL ou PERIODO)", p.contrato.modo, ["MENSAL", "PERIODO"], "MENSAL: contrato por demanda (SRP, fretamento contínuo) — km de referência = km/mês máximo do edital, apuração mensal. PERIODO: escolar — km de referência = km do período letivo (km/dia × dias) e o custo fixo conta por 'meses de custo fixo'.");
  escolha("criterio", "Critério de julgamento (ITEM ou LOTE)", entrada.criterio, ["ITEM", "LOTE"], "LOTE: a proposta usa em todos os itens o preço médio do lote (ponderado pela quantidade), arredondado para cima em 2 casas. ITEM: cada item com o seu preço.");
  escolha("unidade", "Unidade de preço (KM, VEICULO_MES, DIARIA, HORA ou BINOMIA)", unidadePreco, UNIDADES, "Unidade em que o contrato paga. KM: o faturamento cai com o km. VEICULO_MES, DIARIA, HORA: o faturamento fica e só o custo variável muda com a utilização. BINOMIA: parcela fixa por veículo-mês + parcela por km.");
  premissa("meses", "Meses de custo fixo por apuração", p.contrato.mesesCustoFixo, "meses", "1 no MENSAL; 12 no escolar anual — a equipe e o veículo custam também nas férias.", INT);
  premissa("vigencia", "Vigência considerada", p.contrato.vigenciaMeses, "meses", "Anualiza o resultado mensal (Composição, Cenários e Proposta no modo MENSAL), amortiza a implantação e define os anos do contrato na depreciação (aba Perfis de Veículo).", INT);
  premissa("util", "Utilização esperada do km de referência", p.contrato.utilizacao, "%", "Fração do km de referência efetivamente paga (SRP/demanda). 100% no escolar. Teste outras utilizações na aba Cenários.", PCT);
  premissa("kmMorto", "Km improdutivo (garagem ↔ ponto inicial, retornos vazios)", p.contrato.kmMortoPct, "% do km útil", "Km rodado = km útil × (1 + km improdutivo). Não é pago, mas consome diesel, pneus e manutenção.", PCT);
  premissa("reserva", "Reserva técnica de frota", p.contrato.reservaTecnicaPct, "% da frota", "Incide sobre capital, seguro, IPVA/laudo, telemetria, adaptação e manutenção fixa (e sobre a garagem, se marcado no perfil).", PCT);
  premissa("implantacao", "Implantação / montagem de base (custo único)", p.contrato.implantacaoTotal, "R$", "Amortizada na vigência e rateada entre os itens pelo km útil.", BRL);

  novaSecao("3. MÃO DE OBRA");
  premissa("salMot", "Salário base — motorista", p.pessoal.salarioMotorista, "R$/mês", "Do veículo padrão. Rotas com perfil de veículo usam o salário do perfil (aba Perfis de Veículo).", BRL);
  premissa("salMon", "Salário base — monitora", p.pessoal.salarioMonitora, "R$/mês", "Só nas rotas com monitora (aba Rotas).", BRL);
  premissa("he", "Horas extras / adicional (média sobre o salário do motorista)", p.pessoal.horaExtraPct, "%", "Sábados, feriados, atrasos.", PCT);
  premissa("encargos", "Encargos e provisões (INSS, RAT, FGTS, férias + 1/3, 13º, rescisão)", p.pessoal.encargosPct, "% s/ salários", "Regime CLT, fora do Simples.", PCT);
  premissa("fatorNoturno", "Fator de jornada noturna / estendida", p.pessoal.fatorJornadaNoturna, "x", "Multiplica o salário do motorista nas rotas marcadas com noturno = S na aba Rotas.", NUM);
  premissa("divisor", "Divisor de horas do mês", p.pessoal.divisorHorasMes, "h", "Valor da hora = salário do motorista ÷ divisor (220 na jornada de 44 h).", NUM);
  premissa("he50", "Horas extras a 50%", p.pessoal.horasExtras50Mes, "h/mês por motorista", "Pagas a valor da hora × 1,5. Somam-se ao percentual de horas extras.", NUM);
  premissa("he100", "Horas extras a 100%", p.pessoal.horasExtras100Mes, "h/mês por motorista", "Pagas a valor da hora × 2.", NUM);
  premissa("hNoturnas", "Horas noturnas na jornada (22h–5h)", p.pessoal.horasNoturnasMes, "h/mês por motorista", "Horas de relógio da jornada normal, já pagas no salário: entra só o custo a mais da linha abaixo. Hora noturna além da jornada é hora extra.", NUM);
  premissa("adNoturno", "Adicional noturno", p.pessoal.adicionalNoturnoPct ?? ADICIONAL_NOTURNO_PADRAO, "% da hora", "CLT, art. 73: ao menos 20%; há CCT com 25%.", PCT);
  derivada("fatorHoraNoturna", "Custo a mais por hora noturna", `(1+${P.adNoturno})*60/52.5-1`, "× valor da hora", "(1 + adicional) × 60 ÷ 52,5 − 1: a hora reduzida de 52′30″ com o adicional, sem a hora-base que o salário já paga (37,1% com 20%).", PCT2);
  premissa("vrDia", "Vale-refeição por dia trabalhado", p.pessoal.valeRefeicaoDia ?? 0, "R$/dia por func.", "Dias de operação da rota no mês, até 26.", BRL);
  premissa("beneficios", "Outros benefícios (cesta, plano, PLR, VA, VT, seguro)", p.pessoal.beneficiosPorFuncionario, "R$/mês por func.", "Motoristas e monitoras.", BRL);
  premissa("epi", "Uniforme, EPI, exames e cursos", p.pessoal.uniformeEpiPorFuncionario, "R$/mês por func.", "Motoristas e monitoras.", BRL);
  premissa("supervisao", "Preposto / supervisão local (total)", p.pessoal.supervisaoMes, "R$/mês (total)", "Rateado pelo km útil entre os itens com motorista.", BRL);

  novaSecao("4. VEÍCULO PADRÃO (custo fixo mensal por veículo) — perfis por tipo na aba Perfis de Veículo");
  const v = p.veiculo;
  premissa("valorVeiculo", "Valor do veículo", v.valor, "R$", "Valor de mercado (FIPE) ou contábil. No LINEAR e na SOMA_DIGITOS, o valor do veículo novo.", BRL);
  escolha("metodo", "Método de depreciação (PERCENTUAL, LINEAR ou SOMA_DIGITOS)", v.metodoDepreciacao, METODOS, "PERCENTUAL: % a.a. sobre o valor. LINEAR: (valor − residual) ÷ vida útil. SOMA_DIGITOS: Cole/GEIPOT, deprecia mais nos primeiros anos. Nos dois últimos, média dos anos de vida que o contrato ocupa a partir da idade.");
  premissa("depreciacao", "Depreciação anual (método PERCENTUAL)", v.depreciacaoAa, "% a.a.", "", PCT);
  premissa("vidaUtil", "Vida útil (LINEAR e SOMA_DIGITOS)", v.vidaUtilAnos, "anos", "", NUM);
  premissa("residual", "Valor residual ao fim da vida útil", v.valorResidualPct, "% do valor", "", PCT);
  premissa("idade", "Idade do veículo no início do contrato", v.idadeInicialAnos, "anos", "", NUM);
  premissa("capital", "Custo de capital / financiamento", v.custoCapitalAa, "% a.a.", "Taxa usada quando o capital não é composto.", PCT);
  escolha("composto", "Capital composto (financiado + próprio)? (S/N)", sn(v.capitalComposto), ["S", "N"], "S: taxa = fração financiada × taxa do financiamento + resto × custo do capital próprio.");
  premissa("fracaoFin", "Fração financiada", v.fracaoFinanciada, "% do valor", "", PCT);
  premissa("taxaFin", "Taxa do financiamento", v.taxaFinanciamentoAa, "% a.a.", "", PCT);
  premissa("capProprio", "Custo de oportunidade do capital próprio", v.custoCapitalProprioAa, "% a.a.", "", PCT);
  escolha("valorMedio", "Remunerar só o valor não depreciado? (S/N)", sn(v.remuneracaoSobreValorMedio), ["S", "N"], "S: o capital rende sobre o valor médio do veículo nos anos do contrato (GEIPOT), e não sobre o valor cheio.");
  premissa("seguro", "Seguro (casco + RCF-V)", v.seguroMes, "R$/mês por veíc.", "", BRL);
  premissa("ipva", "IPVA + licenciamento", v.ipvaLicenciamentoAno, "R$/ano por veíc.", "", BRL);
  premissa("laudo", "Laudo, vistoria e inspeção", v.laudoVistoriaAno, "R$/ano por veíc.", "", BRL);
  premissa("rastreador", "Rastreamento", v.rastreadorMes, "R$/mês por veíc.", "", BRL);
  premissa("telemetria", "Telemetria adicional exigida pelo edital", v.telemetriaExtraMes, "R$/mês por veíc.", "", BRL);
  premissa("embarque", "Sistema de controle de embarque", v.controleEmbarqueMes, "R$/mês por veíc.", "", BRL);
  premissa("higienizacao", "Higienização", v.higienizacaoMes, "R$/mês por veíc.", "Só sobre a frota operacional (sem reserva).", BRL);
  premissa("acessibilidade", "Acessibilidade / identificação visual", v.acessibilidadeMes, "R$/mês por veíc.", "Só sobre a frota operacional (sem reserva).", BRL);
  premissa("garagem", "Garagem / base operacional", v.garagemMes, "R$/mês por veíc.", "", BRL);
  escolha("garagemReserva", "Garagem cobrada também sobre a reserva técnica? (S/N)", sn(v.garagemComReserva), ["S", "N"], "S: a van reserva ocupa vaga e paga garagem. N: só a frota operacional.");
  premissa("adaptValor", "Adaptações (elevador, ar, divisória, adesivagem)", v.adaptacaoValor, "R$ por veíc.", "Depreciadas no prazo abaixo e remuneradas à taxa de capital.", BRL);
  premissa("adaptMeses", "Prazo de depreciação das adaptações", v.adaptacaoMesesDepreciacao, "meses", "", INT);
  premissa("manutFixa", "Manutenção fixa", v.manutencaoFixaPctMes, "% do valor ao mês", "Método de locação; soma-se à manutenção por km.", PCT2);

  novaSecao("5. INSUMOS VARIÁVEIS DO VEÍCULO PADRÃO (por km rodado)");
  const x = p.variaveis;
  premissa("diesel", "Diesel — preço por litro", x.dieselLitro, "R$/litro", "", BRL);
  premissa("consAsfalto", "Consumo em asfalto", x.consumoAsfaltoKmL, "km/litro", "", NUM);
  premissa("consTerra", "Consumo em terra", x.consumoTerraKmL, "km/litro", "Só usado nas rotas com km em terra.", NUM);
  premissa("arla", "ARLA 32", x.arlaKm, "R$/km", "", BRL4);
  premissa("oleo", "Lubrificantes, lavagem e consumíveis", x.oleoLavagemKm, "R$/km", "", BRL4);
  premissa("pneusAsfalto", "Pneus — asfalto", x.pneusAsfaltoKm, "R$/km", "", BRL4);
  premissa("pneusTerra", "Pneus — terra", x.pneusTerraKm, "R$/km", "", BRL4);
  premissa("manutAsfalto", "Manutenção — asfalto", x.manutencaoAsfaltoKm, "R$/km", "", BRL4);
  premissa("manutTerra", "Manutenção — terra", x.manutencaoTerraKm, "R$/km", "", BRL4);

  novaSecao("6. INDIRETOS, TRIBUTOS E LUCRO");
  premissa("adm", "Administração central", p.indiretos.administracaoPct, "% s/ custo direto", "", PCT);
  premissa("contingencia", "Contingência / risco", p.indiretos.contingenciaPct, "% s/ custo direto", "", PCT);
  premissa("lucro", "Lucro líquido desejado", p.preco.lucroAlvoPct, "% s/ preço", "Depois do IRPJ/CSLL sobre o lucro, no Lucro Real. Ajuste conforme a estratégia de lance (ver Cenários).", PCT);
  premissa("pis", "PIS", p.preco.pis, "% s/ fat.", "", PCT2);
  premissa("cofins", "COFINS", p.preco.cofins, "% s/ fat.", "", PCT2);
  premissa("irpj", "IRPJ (Presumido, sobre a receita)", p.preco.irpj, "% s/ fat.", "No Lucro Real, zero aqui e a alíquota vai para 'IRPJ + CSLL sobre o lucro'.", PCT2);
  premissa("csll", "CSLL (Presumido, sobre a receita)", p.preco.csll, "% s/ fat.", "", PCT2);
  premissa("irpjLoc", "IRPJ — locação sem motorista (Presumido)", p.preco.irpjLocacao ?? IRPJ_LOCACAO_PADRAO, "% s/ fat.", "Locação de bens móveis presume 32%: 15% × 32% = 4,8%. Só nos itens sem motorista e só no Presumido.", PCT2);
  premissa("csllLoc", "CSLL — locação sem motorista (Presumido)", p.preco.csllLocacao ?? CSLL_LOCACAO_PADRAO, "% s/ fat.", "9% × 32% = 2,88%. Só nos itens sem motorista e só no Presumido.", PCT2);
  premissa("iss", "ISS (transporte municipal)", p.preco.iss, "% s/ fat. municipal", "Não incide na locação sem motorista (Súmula Vinculante 31).", PCT2);
  premissa("icms", "ICMS (transporte intermunicipal)", p.preco.icms, "% s/ fat. intermunicipal", "Não incide na locação sem motorista.", PCT2);
  const federais = `${P.pis}+${P.cofins}+${P.irpj}+${P.csll}`;
  derivada("tribMun", "Tributos totais — faturamento municipal", `${federais}+${P.iss}`, "%", "PIS + COFINS + IRPJ + CSLL + ISS", PCT2);
  derivada("tribInter", "Tributos totais — faturamento intermunicipal", `${federais}+${P.icms}`, "%", "PIS + COFINS + IRPJ + CSLL + ICMS", PCT2);
  premissa("prazo", "Prazo de recebimento", p.preco.prazoRecebimentoDias, "dias", "", INT);
  premissa("giro", "Custo do capital de giro", p.preco.custoCapitalGiroAm, "% a.m.", "", PCT2);
  derivada("fin", "Custo financeiro sobre faturamento", `${P.giro}*${P.prazo}/30`, "% s/ fat.", "Capital de giro × prazo de recebimento ÷ 30", PCT2);
  premissa("sobrePreco", "Despesas sobre o preço (adm. do contrato, comissão)", p.preco.despesasSobrePrecoPct, "% s/ preço", "Entram no divisor do preço, como os tributos.", PCT2);
  premissa("irLucro", "IRPJ + CSLL sobre o lucro (Lucro Real)", p.preco.irpjCsllSobreLucroPct, "% do lucro", "Sobre o lucro fiscal — lucro antes do IR + remuneração do capital próprio + contingência, que o fisco não deduz —, só quando positivo. Zero no Presumido.", PCT2);
  premissa("credito", "Crédito de PIS/COFINS não cumulativo (Lucro Real)", p.preco.creditoPisCofinsPct, "% dos custos com crédito", "Sobre depreciação (veículo e adaptação), manutenção fixa, garagem, combustível, ARLA, óleo, pneus e manutenção por km. Zero no Presumido.", PCT2);
  derivada(
    "tribLoc",
    "Tributos totais — locação sem motorista",
    `${P.pis}+${P.cofins}+IF(${P.irLucro}=0,${P.irpjLoc}+${P.csllLoc},${P.irpj}+${P.csll})`,
    "%",
    "PIS + COFINS + IRPJ e CSLL da locação no Presumido (os do regime no Real); sem ISS nem ICMS",
    PCT2
  );

  novaSecao("7. ITENS — tributos, equipe e combustível");
  itens.forEach((it) => {
    escolha(`comMot:${it.codigo}`, `Com motorista? (S/N) — Item ${it.codigo}`, sn(it.comMotorista !== false), ["S", "N"], "N: locação sem motorista — o item não carrega motorista, monitora nem supervisão, e paga os tributos da locação.");
    premissa(`share:${it.codigo}`, `Parcela intermunicipal do faturamento — Item ${it.codigo}`, it.shareIntermunicipal, "%", "Parte do faturamento do item sujeita a ICMS; o resto paga ISS. Ignorada sem motorista.", PCT);
    derivada(
      `trib:${it.codigo}`,
      `Tributos médios — Item ${it.codigo}`,
      `IF(${P[`comMot:${it.codigo}`]}="S",${P.tribMun}*(1-${P[`share:${it.codigo}`]})+${P.tribInter}*${P[`share:${it.codigo}`]},${P.tribLoc})`,
      "%",
      "Com motorista: ponderado pela parcela intermunicipal. Sem motorista: os da locação",
      PCT2
    );
    escolha(`combCli:${it.codigo}`, `Combustível por conta do cliente? (S/N) — Item ${it.codigo}`, sn(it.combustivelPorContaDoCliente === true), ["S", "N"], "S: diesel e ARLA saem do custo do item.");
  });
  congelar(ws, 0, 4);

  // ============================================================ PERFIS DE VEÍCULO
  // Uma coluna por perfil; a primeira é o veículo padrão (links da aba
  // Premissas). Entradas, depois a depreciação ano a ano do contrato e, no
  // fim, o custo mensal por veículo que a aba Rotas busca pelo código.
  type ColunaPerfil = { codigo: string; descricao: string; tipo: string; perfil: PerfilVeiculo | null };
  const colunasPerfil: ColunaPerfil[] = [
    { codigo: PERFIL_PADRAO, descricao: "Veículo padrão (aba Premissas)", tipo: "—", perfil: null },
    ...perfis.map((pf) => ({ codigo: pf.codigo, descricao: pf.descricao, tipo: pf.tipo, perfil: pf })),
  ];
  const nP = colunasPerfil.length;
  const colPerfil = (j: number) => letraColuna(j + 3);
  const ultimaPerfil = colPerfil(nP - 1);
  const anosContrato = Math.max(1, Math.ceil(p.contrato.vigenciaMeses / 12));
  const ANOS = Math.max(anosContrato, 10);

  titulo(wf, 1, "PERFIS DE VEÍCULO — custo fixo mensal por veículo, depreciação ano a ano e insumos por km", nP + 2);
  nota(
    wf,
    2,
    `A linha 4 tem o código que a aba Rotas (coluna Perfil) procura; rota sem perfil, ou com código que não existe aqui, usa ${PERFIL_PADRAO}. ` +
      `A coluna ${PERFIL_PADRAO} vem da aba Premissas (verde); os perfis são entradas (azul). A depreciação é a média dos anos de vida que o contrato ocupa (${ANOS} anos calculados; a vigência ocupa ${anosContrato}).`,
    nP + 2,
    42
  );
  larguras(wf, [52, 16, ...colunasPerfil.map(() => 17)]);
  cabecalho(wf, 4, ["Campo", "Unid.", ...colunasPerfil.map((c) => c.codigo)], undefined, 22);

  type LinhaPerfil = {
    chave?: string;
    rotulo: string;
    unidade?: string;
    fmt?: string;
    secao?: boolean;
    padrao?: string | number; // fórmula (link) ou texto
    valor?: (pf: PerfilVeiculo) => string | number;
    formula?: (c: string, PF: Record<string, number>) => string;
    opcoes?: readonly string[];
  };
  const vv = (k: keyof Premissas["veiculo"]) => (pf: PerfilVeiculo) => {
    const val = pf.veiculo[k];
    return typeof val === "boolean" ? sn(val) : (val as string | number);
  };
  const xv = (k: keyof Premissas["variaveis"]) => (pf: PerfilVeiculo) => pf.variaveis[k];
  const linhasPerfil: LinhaPerfil[] = [
    { rotulo: "Descrição", padrao: "Veículo padrão", valor: (pf) => pf.descricao },
    { rotulo: "Tipo · energia", padrao: "Diesel", valor: (pf) => `${ROTULO_TIPO_VEICULO[pf.tipo] ?? pf.tipo} · ${ROTULO_ENERGIA[pf.energia ?? "DIESEL"]}` },
    { rotulo: "MOTORISTA", secao: true },
    { chave: "sal", rotulo: "Salário base do motorista deste veículo", unidade: "R$/mês", fmt: BRL, padrao: P.salMot, valor: (pf) => pf.motorista.salario },
    { chave: "mpv", rotulo: "Motoristas por veículo (referência para as rotas)", unidade: "motoristas", fmt: NUM, padrao: "", valor: (pf) => pf.motorista.motoristasPorVeiculo },
    { rotulo: "VEÍCULO", secao: true },
    { chave: "valor", rotulo: "Valor do veículo", unidade: "R$", fmt: BRL, padrao: P.valorVeiculo, valor: vv("valor") },
    { chave: "metodo", rotulo: "Método de depreciação", padrao: P.metodo, valor: vv("metodoDepreciacao"), opcoes: METODOS },
    { chave: "depAa", rotulo: "Depreciação anual (PERCENTUAL)", unidade: "% a.a.", fmt: PCT, padrao: P.depreciacao, valor: vv("depreciacaoAa") },
    { chave: "vida", rotulo: "Vida útil", unidade: "anos", fmt: NUM, padrao: P.vidaUtil, valor: vv("vidaUtilAnos") },
    { chave: "residual", rotulo: "Valor residual", unidade: "% do valor", fmt: PCT, padrao: P.residual, valor: vv("valorResidualPct") },
    { chave: "idade", rotulo: "Idade no início do contrato", unidade: "anos", fmt: NUM, padrao: P.idade, valor: vv("idadeInicialAnos") },
    { chave: "capAa", rotulo: "Custo de capital (taxa única)", unidade: "% a.a.", fmt: PCT, padrao: P.capital, valor: vv("custoCapitalAa") },
    { chave: "composto", rotulo: "Capital composto? (S/N)", padrao: P.composto, valor: vv("capitalComposto"), opcoes: ["S", "N"] },
    { chave: "fracao", rotulo: "Fração financiada", unidade: "% do valor", fmt: PCT, padrao: P.fracaoFin, valor: vv("fracaoFinanciada") },
    { chave: "taxaFin", rotulo: "Taxa do financiamento", unidade: "% a.a.", fmt: PCT, padrao: P.taxaFin, valor: vv("taxaFinanciamentoAa") },
    { chave: "proprio", rotulo: "Custo do capital próprio", unidade: "% a.a.", fmt: PCT, padrao: P.capProprio, valor: vv("custoCapitalProprioAa") },
    { chave: "remMedio", rotulo: "Remunerar só o valor não depreciado? (S/N)", padrao: P.valorMedio, valor: vv("remuneracaoSobreValorMedio"), opcoes: ["S", "N"] },
    { chave: "seguro", rotulo: "Seguro", unidade: "R$/mês", fmt: BRL, padrao: P.seguro, valor: vv("seguroMes") },
    { chave: "ipva", rotulo: "IPVA + licenciamento", unidade: "R$/ano", fmt: BRL, padrao: P.ipva, valor: vv("ipvaLicenciamentoAno") },
    { chave: "laudo", rotulo: "Laudo, vistoria e inspeção", unidade: "R$/ano", fmt: BRL, padrao: P.laudo, valor: vv("laudoVistoriaAno") },
    { chave: "rastreador", rotulo: "Rastreamento", unidade: "R$/mês", fmt: BRL, padrao: P.rastreador, valor: vv("rastreadorMes") },
    { chave: "telemetria", rotulo: "Telemetria adicional", unidade: "R$/mês", fmt: BRL, padrao: P.telemetria, valor: vv("telemetriaExtraMes") },
    { chave: "embarque", rotulo: "Controle de embarque", unidade: "R$/mês", fmt: BRL, padrao: P.embarque, valor: vv("controleEmbarqueMes") },
    { chave: "higien", rotulo: "Higienização", unidade: "R$/mês", fmt: BRL, padrao: P.higienizacao, valor: vv("higienizacaoMes") },
    { chave: "acess", rotulo: "Acessibilidade / identificação", unidade: "R$/mês", fmt: BRL, padrao: P.acessibilidade, valor: vv("acessibilidadeMes") },
    { chave: "garagem", rotulo: "Garagem / base", unidade: "R$/mês", fmt: BRL, padrao: P.garagem, valor: vv("garagemMes") },
    { chave: "garReserva", rotulo: "Garagem também sobre a reserva? (S/N)", padrao: P.garagemReserva, valor: vv("garagemComReserva"), opcoes: ["S", "N"] },
    { chave: "adaptValor", rotulo: "Adaptações", unidade: "R$", fmt: BRL, padrao: P.adaptValor, valor: vv("adaptacaoValor") },
    { chave: "adaptMeses", rotulo: "Prazo de depreciação das adaptações", unidade: "meses", fmt: INT, padrao: P.adaptMeses, valor: vv("adaptacaoMesesDepreciacao") },
    { chave: "manFixa", rotulo: "Manutenção fixa", unidade: "% do valor ao mês", fmt: PCT2, padrao: P.manutFixa, valor: vv("manutencaoFixaPctMes") },
    { rotulo: "INSUMOS POR KM RODADO", secao: true },
    { chave: "diesel", rotulo: "Combustível / energia", unidade: "R$ por litro (kWh no elétrico)", fmt: BRL, padrao: P.diesel, valor: xv("dieselLitro") },
    { chave: "consAsf", rotulo: "Consumo em asfalto", unidade: "km por litro (kWh no elétrico)", fmt: NUM, padrao: P.consAsfalto, valor: xv("consumoAsfaltoKmL") },
    { chave: "consTerra", rotulo: "Consumo em terra", unidade: "km/litro", fmt: NUM, padrao: P.consTerra, valor: xv("consumoTerraKmL") },
    { chave: "arla", rotulo: "ARLA 32", unidade: "R$/km", fmt: BRL4, padrao: P.arla, valor: xv("arlaKm") },
    { chave: "oleo", rotulo: "Lubrificantes, lavagem", unidade: "R$/km", fmt: BRL4, padrao: P.oleo, valor: xv("oleoLavagemKm") },
    { chave: "pneusAsf", rotulo: "Pneus — asfalto", unidade: "R$/km", fmt: BRL4, padrao: P.pneusAsfalto, valor: xv("pneusAsfaltoKm") },
    { chave: "pneusTerra", rotulo: "Pneus — terra", unidade: "R$/km", fmt: BRL4, padrao: P.pneusTerra, valor: xv("pneusTerraKm") },
    { chave: "manAsf", rotulo: "Manutenção — asfalto", unidade: "R$/km", fmt: BRL4, padrao: P.manutAsfalto, valor: xv("manutencaoAsfaltoKm") },
    { chave: "manTerra", rotulo: "Manutenção — terra", unidade: "R$/km", fmt: BRL4, padrao: P.manutTerra, valor: xv("manutencaoTerraKm") },
    { rotulo: "CAPITAL E DEPRECIAÇÃO (anos de vida que o contrato ocupa)", secao: true },
    { chave: "taxa", rotulo: "Taxa de capital aplicada", unidade: "% a.a.", fmt: PCT2, formula: (c, F) => `IF(${c}${F.composto}="S",${c}${F.fracao}*${c}${F.taxaFin}+(1-${c}${F.fracao})*${c}${F.proprio},${c}${F.capAa})` },
    {
      chave: "taxaProp",
      rotulo: "Taxa do capital próprio (não dedutível no Lucro Real)",
      unidade: "% a.a.",
      fmt: PCT2,
      formula: (c, F) => `IF(${c}${F.composto}="S",(1-${c}${F.fracao})*${c}${F.proprio},${c}${F.capAa})`,
    },
    { chave: "anos", rotulo: "Anos do contrato", unidade: "anos", fmt: INT, formula: () => `MAX(1,ROUNDUP(${P.vigencia}/12,0))` },
    { chave: "n", rotulo: "Vida útil considerada (inteira)", unidade: "anos", fmt: INT, formula: (c, F) => `MAX(1,ROUND(${c}${F.vida},0))` },
    { chave: "depreciavel", rotulo: "Valor depreciável (valor − residual)", unidade: "R$", fmt: BRL, formula: (c, F) => `${c}${F.valor}*(1-${c}${F.residual})` },
    { chave: "somaDig", rotulo: "Soma dos dígitos da vida útil", unidade: "", fmt: INT, formula: (c, F) => `${c}${F.n}*(${c}${F.n}+1)/2` },
  ];
  // Depreciação e valor não depreciado no meio de cada ano do contrato.
  // Ano de vida do veículo no ano k do contrato: INT(idade) + k.
  for (let k = 1; k <= ANOS; k++) {
    const ano = (c: string, F: Record<string, number>) => `(INT(${c}${F.idade})+${k})`;
    const fracao = (c: string, F: Record<string, number>) =>
      `IF(${ano(c, F)}>${c}${F.n},0,IF(${c}${F.metodo}="LINEAR",1/${c}${F.n},(${c}${F.n}-${ano(c, F)}+1)/${c}${F.somaDig}))`;
    linhasPerfil.push({
      chave: `dep${k}`,
      rotulo: `Depreciação no ano ${k} do contrato`,
      unidade: "R$/ano",
      fmt: BRL,
      formula: (c, F) => `IF(${k}>${c}${F.anos},0,IF(${c}${F.metodo}="PERCENTUAL",${c}${F.valor}*${c}${F.depAa},${c}${F.depreciavel}*${fracao(c, F)}))`,
    });
  }
  for (let k = 1; k <= ANOS; k++) {
    const ano = (c: string, F: Record<string, number>) => `(INT(${c}${F.idade})+${k})`;
    // Depreciação acumulada antes do ano: m = anos já vividos (até a vida útil).
    const m = (c: string, F: Record<string, number>) => `MIN(${ano(c, F)}-1,${c}${F.n})`;
    const acumulada = (c: string, F: Record<string, number>) =>
      `IF(${c}${F.metodo}="PERCENTUAL",${c}${F.valor}*${c}${F.depAa}*(${ano(c, F)}-1),IF(${c}${F.metodo}="LINEAR",${c}${F.depreciavel}/${c}${F.n}*${m(c, F)},${c}${F.depreciavel}*(${m(c, F)}*(${c}${F.n}+1)-${m(c, F)}*(${m(c, F)}+1)/2)/${c}${F.somaDig}))`;
    linhasPerfil.push({
      chave: `meio${k}`,
      rotulo: `Valor não depreciado no meio do ano ${k}`,
      unidade: "R$",
      fmt: BRL,
      formula: (c, F) =>
        `IF(${k}>${c}${F.anos},0,MAX(${c}${F.valor}*IF(${c}${F.metodo}="PERCENTUAL",0,${c}${F.residual}),${c}${F.valor}-${acumulada(c, F)}-${c}${F[`dep${k}`]}/2))`,
    });
  }
  linhasPerfil.push(
    { chave: "depAnual", rotulo: "Depreciação anual média no contrato", unidade: "R$/ano", fmt: BRL, formula: (c, F) => `SUM(${c}${F.dep1}:${c}${F[`dep${ANOS}`]})/${c}${F.anos}` },
    { chave: "vMedio", rotulo: "Valor remunerado (médio não depreciado ou cheio)", unidade: "R$", fmt: BRL, formula: (c, F) => `IF(${c}${F.remMedio}="S",SUM(${c}${F.meio1}:${c}${F[`meio${ANOS}`]})/${c}${F.anos},${c}${F.valor})` },
    { chave: "remAnual", rotulo: "Remuneração do capital anual", unidade: "R$/ano", fmt: BRL, formula: (c, F) => `${c}${F.vMedio}*${c}${F.taxa}` },
    { rotulo: "CUSTO FIXO MENSAL POR VEÍCULO (a aba Rotas busca estas linhas)", secao: true },
    { chave: "mDep", rotulo: "Depreciação (por veíc. c/ reserva)", unidade: "R$/mês", fmt: BRL, formula: (c, F) => `${c}${F.depAnual}/12` },
    { chave: "mRem", rotulo: "Remuneração do capital (por veíc. c/ reserva)", unidade: "R$/mês", fmt: BRL, formula: (c, F) => `${c}${F.remAnual}/12` },
    { chave: "mSeg", rotulo: "Seguro (por veíc. c/ reserva)", unidade: "R$/mês", fmt: BRL, formula: (c, F) => `${c}${F.seguro}` },
    { chave: "mIpva", rotulo: "IPVA + laudo (por veíc. c/ reserva)", unidade: "R$/mês", fmt: BRL, formula: (c, F) => `(${c}${F.ipva}+${c}${F.laudo})/12` },
    { chave: "mTel", rotulo: "Rastreamento + telemetria + embarque (por veíc. c/ reserva)", unidade: "R$/mês", fmt: BRL, formula: (c, F) => `${c}${F.rastreador}+${c}${F.telemetria}+${c}${F.embarque}` },
    { chave: "mHig", rotulo: "Higienização + acessibilidade (por veíc. operacional)", unidade: "R$/mês", fmt: BRL, formula: (c, F) => `${c}${F.higien}+${c}${F.acess}` },
    { chave: "mAdDep", rotulo: "Adaptação — depreciação (por veíc. c/ reserva)", unidade: "R$/mês", fmt: BRL, formula: (c, F) => `IF(${c}${F.adaptMeses}=0,0,${c}${F.adaptValor}/${c}${F.adaptMeses})` },
    { chave: "mAdCap", rotulo: "Adaptação — capital (por veíc. c/ reserva)", unidade: "R$/mês", fmt: BRL, formula: (c, F) => `${c}${F.adaptValor}*${c}${F.taxa}/12` },
    { chave: "mManF", rotulo: "Manutenção fixa (por veíc. c/ reserva)", unidade: "R$/mês", fmt: BRL, formula: (c, F) => `${c}${F.valor}*${c}${F.manFixa}` },
    {
      chave: "mRemP",
      rotulo: "  da remuneração e das adaptações: capital próprio (por veíc. c/ reserva)",
      unidade: "R$/mês",
      fmt: BRL,
      formula: (c, F) => `(${c}${F.vMedio}+${c}${F.adaptValor})*${c}${F.taxaProp}/12`,
    }
  );
  const PF: Record<string, number> = {};
  linhasPerfil.forEach((ln, k) => {
    if (ln.chave) PF[ln.chave] = 5 + k;
  });
  linhasPerfil.forEach((ln, k) => {
    const l = 5 + k;
    if (ln.secao) {
      secao(wf, l, ln.rotulo, nP + 2);
      return;
    }
    escrever(wf, l, 1, ln.rotulo, { negrito: /^m[A-Z]/.test(ln.chave ?? "") });
    escrever(wf, l, 2, ln.unidade ?? "");
    colunasPerfil.forEach((cp, j) => {
      const c = colPerfil(j);
      const col = j + 3;
      if (ln.formula) {
        escrever(wf, l, col, fx(ln.formula(c, PF)), { fmt: ln.fmt });
      } else if (cp.perfil === null) {
        const pad = ln.padrao ?? "";
        const link = typeof pad === "string" && pad.startsWith("Premissas!");
        escrever(wf, l, col, link ? fx(pad) : pad, { tipo: link ? "link" : "texto", fmt: ln.fmt });
      } else {
        escrever(wf, l, col, ln.valor!(cp.perfil), { tipo: "entrada", fmt: ln.fmt, quebra: ln.rotulo === "Descrição" });
        if (ln.opcoes) lista(wf, l, col, [...ln.opcoes]);
      }
    });
  });
  wf.getRow(5).height = 30;
  congelar(wf, 2, 4);
  const FAIXA_CODIGOS = `'Perfis de Veículo'!$C$4:$${ultimaPerfil}$4`;
  const perfilDe = (chave: string, colIndice: string) => `INDEX('Perfis de Veículo'!$C$${PF[chave]}:$${ultimaPerfil}$${PF[chave]},${colIndice})`;

  // ============================================================ ROTAS
  // Uma linha por rota. Entradas em azul; da coluna P em diante, as contas de
  // cada rota com o perfil de veículo da rota (INDEX/CORRESP na aba Perfis):
  // salário com fator noturno e horas extras, insumos ponderados entre asfalto
  // e terra, custo fixo do veículo, diárias e horas. A Composição soma por item.
  const COLS_ROTA = [
    ["item", "Item", 7],
    ["nome", "Rota", 32],
    ["perfil", "Perfil do veículo", 11],
    ["kmRef", mensal ? "Km/mês de referência (edital)" : "Km do período (edital)", 13],
    ["diasMes", "Dias/mês", 8],
    ["kmDia", "Km/dia", 9],
    ["kmTerra", "Km terra/dia", 9],
    ["horasDia", "Horas/dia (preço por hora)", 10],
    ["veic", "Veículos operacionais", 10],
    ["mot", "Motoristas", 10],
    ["mon", "Monitoras", 10],
    ["noturno", "Noturno? (S/N)", 9],
    ["viagens", "Viagens/dia", 9],
    ["passagens", "Passagens pedágio/mês", 11],
    ["tarifa", "Tarifa pedágio (R$)", 10],
    ["pctTerra", "% terra", 8],
    ["pedagio", "Pedágio R$/mês", 12],
    ["kmUtil", "Km útil", 11],
    ["kmRod", "Km rodado (c/ km improdutivo)", 12],
    ["colPerfil", "Coluna do perfil (aba Perfis)", 9],
    ["salarios", "Salários (R$/mês, c/ HE, noturno e horas)", 14],
    ["diesel", "Diesel (R$)", 13],
    ["arla", "ARLA (R$)", 11],
    ["oleo", "Lubrif./lavagem (R$)", 11],
    ["pneus", "Pneus (R$)", 12],
    ["manut", "Manutenção (R$)", 12],
    ["veicRes", "Veículos c/ reserva", 10],
    ["dep", "Depreciação (R$/mês)", 12],
    ["rem", "Remuneração capital (R$/mês)", 12],
    ["seg", "Seguro (R$/mês)", 11],
    ["ipva", "IPVA + laudo (R$/mês)", 11],
    ["tel", "Telemetria (R$/mês)", 11],
    ["hig", "Higiene + acessib. (R$/mês)", 11],
    ["gar", "Garagem (R$/mês)", 11],
    ["adDep", "Adaptação — depreciação (R$/mês)", 12],
    ["adCap", "Adaptação — capital (R$/mês)", 12],
    ["manF", "Manutenção fixa (R$/mês)", 12],
    ["remP", "Capital próprio — não dedutível (R$/mês)", 12],
    ["dias", `Dias de operação no ${apuracao}`, 10],
    ["diarias", "Diárias (veículo × dia)", 10],
    ["vr", "Vale-refeição (R$/mês)", 11],
    ["horas", "Horas (veículo × dia × h)", 10],
    ["semHoras", "Sem horas/dia? (1 = sim)", 9],
  ] as const;
  type ChaveRota = (typeof COLS_ROTA)[number][0];
  const CR = {} as Record<ChaveRota, string>;
  COLS_ROTA.forEach(([k], i) => (CR[k] = letraColuna(i + 1)));
  const nColsRota = COLS_ROTA.length;
  titulo(wr, 1, `ROTAS E QUANTITATIVOS — ${edital.numero}`, nColsRota);
  nota(
    wr,
    2,
    (mensal
      ? "Km de referência = km/mês máximo do edital; km útil = referência × utilização (Premissas). "
      : "Km de referência = km do período letivo (km/dia × dias); km útil = referência × utilização (Premissas). ") +
      `Colunas A–${CR.tarifa} (azul) são dados do edital e do dimensionamento; ${CR.pctTerra}–${CR.semHoras} são fórmulas por rota com o perfil do veículo (aba Perfis de Veículo, pelo código da coluna C). A Composição soma estas colunas por item.`,
    nColsRota
  );
  cabecalho(
    wr,
    4,
    COLS_ROTA.map((c) => c[1]),
    COLS_ROTA.map((c) => c[2]),
    52
  );
  const R0 = 5;
  const nRotas = Math.max(rotas.length, 1);
  const REND = R0 + nRotas - 1;
  const RTOT = REND + 1;
  const colRota = (k: ChaveRota) => COLS_ROTA.findIndex((c) => c[0] === k) + 1;
  rotas.forEach((r, i) => {
    const l = R0 + i;
    const $ = (k: ChaveRota) => `${CR[k]}${l}`;
    const e = (k: ChaveRota, val: Valor, fmt?: string, quebra = false) => escrever(wr, l, colRota(k), val, { tipo: "entrada", fmt, quebra });
    const f = (k: ChaveRota, formula: string, fmt: string) => escrever(wr, l, colRota(k), fx(formula), { fmt });
    const pf = (chave: string) => perfilDe(chave, $("colPerfil"));
    e("item", r.item);
    e("nome", r.nome, undefined, true);
    e("perfil", r.perfilVeiculo || PERFIL_PADRAO);
    e("kmRef", r.kmReferencia, INT);
    e("diasMes", r.diasMes ?? null, INT);
    e("kmDia", r.kmDia, NUM);
    e("kmTerra", r.kmTerraDia, NUM);
    e("horasDia", r.horasDia ?? null, NUM);
    e("veic", r.veiculos, NUM);
    e("mot", r.motoristas, NUM);
    e("mon", r.monitoras, NUM);
    e("noturno", sn(r.noturno));
    lista(wr, l, colRota("noturno"), ["S", "N"]);
    e("viagens", r.viagensDia ?? null, NUM);
    e("passagens", r.passagensPedagioMes, NUM);
    e("tarifa", r.tarifaPedagio, BRL);
    f("pctTerra", `IF(${$("kmDia")}>0,${$("kmTerra")}/${$("kmDia")},0)`, PCT);
    f("pedagio", `${$("passagens")}*${$("tarifa")}`, BRL);
    f("kmUtil", `${$("kmRef")}*${P.util}`, INT);
    f("kmRod", `${$("kmUtil")}*(1+${P.kmMorto})`, INT);
    f("colPerfil", `IFERROR(MATCH(${$("perfil")},${FAIXA_CODIGOS},0),1)`, INT);
    const sal = pf("sal");
    f(
      "salarios",
      `${$("mot")}*(${sal}*(1+${P.he})*IF(${$("noturno")}="S",${P.fatorNoturno},1)+IF(${P.divisor}>0,${sal}/${P.divisor},0)*(${P.he50}*1.5+${P.he100}*2+${P.hNoturnas}*${P.fatorHoraNoturna}))+${$("mon")}*${P.salMon}`,
      BRL
    );
    const t = $("pctTerra");
    f(
      "diesel",
      `${pf("diesel")}*(IF(${pf("consAsf")}=0,0,(1-${t})/${pf("consAsf")})+IF(${t}>0,IF(${pf("consTerra")}=0,0,${t}/${pf("consTerra")}),0))*${$("kmRod")}`,
      BRL
    );
    f("arla", `${pf("arla")}*${$("kmRod")}`, BRL);
    f("oleo", `${pf("oleo")}*${$("kmRod")}`, BRL);
    f("pneus", `((1-${t})*${pf("pneusAsf")}+${t}*${pf("pneusTerra")})*${$("kmRod")}`, BRL);
    f("manut", `((1-${t})*${pf("manAsf")}+${t}*${pf("manTerra")})*${$("kmRod")}`, BRL);
    f("veicRes", `${$("veic")}*(1+${P.reserva})`, NUM);
    const vr = $("veicRes");
    f("dep", `${vr}*${pf("mDep")}`, BRL);
    f("rem", `${vr}*${pf("mRem")}`, BRL);
    f("seg", `${vr}*${pf("mSeg")}`, BRL);
    f("ipva", `${vr}*${pf("mIpva")}`, BRL);
    f("tel", `${vr}*${pf("mTel")}`, BRL);
    f("hig", `${$("veic")}*${pf("mHig")}`, BRL);
    f("gar", `IF(${pf("garReserva")}="S",${vr},${$("veic")})*${pf("garagem")}`, BRL);
    f("adDep", `${vr}*${pf("mAdDep")}`, BRL);
    f("adCap", `${vr}*${pf("mAdCap")}`, BRL);
    f("manF", `${vr}*${pf("mManF")}`, BRL);
    f("remP", `${vr}*${pf("mRemP")}`, BRL);
    const pelaDistancia = `IF(${$("kmDia")}>0,${$("kmRef")}/${$("kmDia")},0)`;
    f("dias", `IF(${P.modo}="MENSAL",IF(${$("diasMes")}="",${pelaDistancia},${$("diasMes")}),IF(${pelaDistancia}<>0,${pelaDistancia},N(${$("diasMes")})*${P.meses}))`, NUM);
    f("diarias", `${$("veic")}*${$("dias")}`, NUM);
    f("vr", `(${$("mot")}+${$("mon")})*${P.vrDia}*MIN(${DIAS_VR_MAXIMO},IF(${P.modo}="MENSAL",${$("dias")},IF(${P.meses}>0,${$("dias")}/${P.meses},0)))`, BRL);
    f("horas", `${$("veic")}*${$("dias")}*N(${$("horasDia")})`, NUM);
    f("semHoras", `IF(N(${$("horasDia")})=0,1,0)`, INT);
    wr.getRow(l).height = 30;
  });
  escrever(wr, RTOT, 2, "TOTAL", { negrito: true, fundo: FUNDO_TOTAL });
  const somaRotas: ChaveRota[] = ["kmRef", "veic", "mot", "mon", "passagens", "pedagio", "kmUtil", "kmRod", "salarios", "diesel", "arla", "oleo", "pneus", "manut", "veicRes", "dep", "rem", "seg", "ipva", "tel", "hig", "gar", "adDep", "adCap", "manF", "remP", "diarias", "vr", "horas"];
  COLS_ROTA.forEach(([k], i) => {
    if (i === 1) return;
    if ((somaRotas as string[]).includes(k)) {
      const L = CR[k];
      const fmt = ["kmRef", "kmUtil", "kmRod"].includes(k) ? INT : ["veic", "mot", "mon", "passagens", "veicRes", "diarias", "horas"].includes(k) ? NUM : BRL;
      escrever(wr, RTOT, i + 1, fx(`SUM(${L}${R0}:${L}${REND})`), { negrito: true, fmt, fundo: FUNDO_TOTAL });
    } else escrever(wr, RTOT, i + 1, null, { fundo: FUNDO_TOTAL });
  });
  congelar(wr, 2, 4);

  // ============================================================ COMPOSIÇÃO DE CUSTO
  const nI = itens.length;
  const COL_TOTAL = nI + 2;
  const COL_MEMO = nI + 3;
  const T = letraColuna(COL_TOTAL);
  const colunaItem = (i: number) => letraColuna(i + 2);
  const primeira = colunaItem(0);
  const ultima = colunaItem(Math.max(nI - 1, 0));
  const unidadeValor = mensal ? "R$/mês" : "R$/período";
  const U = `${P.unidade}`;

  titulo(wc, 1, `COMPOSIÇÃO DE CUSTO POR ITEM (${mensal ? "mensal, na utilização esperada" : "no período, com o custo fixo de todos os meses"}) → CUSTO → PREÇO POR UNIDADE`, COL_MEMO);
  nota(
    wc,
    2,
    "Custos fixos independem do km faturado; por isso o custo/km sobe quando a utilização cai (ver Cenários). " +
      "Preço = (custo líquido do crédito + não dedutíveis × IR ÷ (1 − IR)) ÷ quantidade ÷ (1 − tributos − financeiro − despesas sobre o preço − lucro ÷ (1 − IR sobre o lucro)), arredondado para cima em 2 casas. " +
      `A unidade do contrato (Premissas) decide o faturamento.${lote ? " Julgamento por LOTE: a coluna Lote dá o preço médio e o preço único da proposta." : ""}`,
    COL_MEMO,
    42
  );
  larguras(wc, [58, ...itens.map(() => 18), 20, 60]);
  cabecalho(wc, 4, ["Componente", ...itens.map((it) => `Item ${it.codigo} (${unidadeValor})`), lote ? `Lote (${unidadeValor})` : `Total (${unidadeValor})`, "Memória de cálculo"], undefined, 30);

  type R = Record<string, number>;
  type Linha = {
    chave?: string;
    rotulo: string;
    secao?: boolean;
    item?: (c: string, i: number, R: R) => Valor;
    total?: "soma" | "ponderado" | "vazio" | ((R: R) => string);
    fmt?: string;
    negrito?: boolean;
    memo?: string;
    tipo?: Tipo;
    destaque?: boolean;
  };
  const rot = (k: ChaveRota) => `Rotas!$${CR[k]}$${R0}:$${CR[k]}$${REND}`;
  const somaSe = (k: ChaveRota) => (c: string, _i: number, R: R) => `SUMIF(${rot("item")},${c}$${R.codigo},${rot(k)})`;
  const comEquipe = (k: ChaveRota) => (c: string, i: number, R: R) => `IF(${c}${R.comMot}="S",${somaSe(k)(c, i, R)},0)`;
  const daContratada = (k: ChaveRota) => (c: string, i: number, R: R) => `IF(${c}${R.combCli}="S",0,${somaSe(k)(c, i, R)})`;
  const kmTotalRotas = `Rotas!$${CR.kmUtil}$${RTOT}`;
  // Preço para cobrir o custo líquido por unidade: 0 sem quantidade.
  const precoPor = (qtd: string, c: string, R: R) => `IF(N(${c}${qtd})>0,ROUNDUP(${c}${R.cpp}/${c}${qtd}/${c}${R.div},2),0)`;
  const linhas: Linha[] = [
    { chave: "codigo", rotulo: "Código do item (chave na aba Rotas)", item: (_c, i) => itens[i].codigo, total: "vazio", tipo: "entrada", memo: "Soma as rotas cujo Item (Rotas, coluna A) é igual a este código." },
    { chave: "comMot", rotulo: "Com motorista? (S/N)", item: (_c, i) => P[`comMot:${itens[i].codigo}`], tipo: "link", total: "vazio", memo: "Premissas seção 7" },
    { chave: "combCli", rotulo: "Combustível por conta do cliente? (S/N)", item: (_c, i) => P[`combCli:${itens[i].codigo}`], tipo: "link", total: "vazio", memo: "Premissas seção 7" },
    { rotulo: "A. QUANTIDADES", secao: true },
    { chave: "kmref", rotulo: mensal ? "Km/mês de referência (máximo do edital)" : "Km do período (edital)", item: somaSe("kmRef"), total: "soma", fmt: INT, memo: "Rotas" },
    { chave: "kmfat", rotulo: `Km útil faturável no ${apuracao} (referência × utilização)`, item: somaSe("kmUtil"), total: "soma", fmt: INT, memo: "Rotas" },
    { chave: "kmrod", rotulo: "Km rodado total (útil + km improdutivo)", item: somaSe("kmRod"), total: "soma", fmt: INT, memo: "km útil × (1 + km improdutivo)" },
    { chave: "veic", rotulo: "Veículos operacionais", item: somaSe("veic"), total: "soma", fmt: NUM, memo: "Rotas" },
    { chave: "veicres", rotulo: "Veículos com reserva técnica", item: (c, _i, R) => `${c}${R.veic}*(1+${P.reserva})`, total: "soma", fmt: NUM, memo: "× (1 + reserva técnica)" },
    { chave: "mot", rotulo: "Motoristas", item: comEquipe("mot"), total: "soma", fmt: NUM, memo: "Rotas; zero no item sem motorista" },
    { chave: "mon", rotulo: "Monitoras", item: comEquipe("mon"), total: "soma", fmt: NUM, memo: "Rotas; zero no item sem motorista" },
    { chave: "qvm", rotulo: `Veículos-mês no ${apuracao}`, item: (c, _i, R) => `${c}${R.veic}*${P.meses}`, total: "soma", fmt: NUM, memo: "veículos × meses de custo fixo" },
    { chave: "qd", rotulo: `Diárias no ${apuracao}`, item: somaSe("diarias"), total: "soma", fmt: NUM, memo: "Rotas: veículos × dias de operação" },
    {
      chave: "qh",
      rotulo: `Horas no ${apuracao}`,
      item: (c, i, R) => `IF(OR(COUNTIF(${rot("item")},${c}$${R.codigo})=0,${somaSe("semHoras")(c, i, R)}>0),"",${somaSe("horas")(c, i, R)})`,
      total: "soma",
      fmt: NUM,
      memo: "veículos × dias × horas/dia; vazio se alguma rota do item não tem horas/dia",
    },
    { rotulo: "B. MÃO DE OBRA (fixo mensal)", secao: true },
    { chave: "sal", rotulo: "Salários (motoristas c/ HE, noturno e horas + monitoras)", item: comEquipe("salarios"), total: "soma", memo: "Rotas: salário do perfil × (1+HE) × fator noturno + horas extras/noturnas em horas; zero sem motorista" },
    { chave: "enc", rotulo: "Encargos e provisões", item: (c, _i, R) => `${c}${R.sal}*${P.encargos}`, total: "soma", memo: "salários × encargos" },
    {
      chave: "ben",
      rotulo: "Benefícios + vale-refeição + uniforme/EPI/cursos",
      item: (c, i, R) => `(${c}${R.mot}+${c}${R.mon})*(${P.beneficios}+${P.epi})+${comEquipe("vr")(c, i, R)}`,
      total: "soma",
      memo: "(motoristas + monitoras) × (benefícios + EPI) + VR das rotas (R$/dia × dias trabalhados)",
    },
    {
      chave: "sup",
      rotulo: "Preposto / supervisão local (rateio por km útil)",
      item: (c, _i, R) =>
        `IF(${c}${R.comMot}="S",IF(SUMIF($${primeira}$${R.comMot}:$${ultima}$${R.comMot},"S",$${primeira}$${R.kmfat}:$${ultima}$${R.kmfat})=0,0,${P.supervisao}*${c}${R.kmfat}/SUMIF($${primeira}$${R.comMot}:$${ultima}$${R.comMot},"S",$${primeira}$${R.kmfat}:$${ultima}$${R.kmfat})),0)`,
      total: "soma",
      memo: "supervisão × km útil do item ÷ km útil dos itens com motorista",
    },
    { chave: "mo", rotulo: "Subtotal mão de obra (mensal)", item: (c, _i, R) => `SUM(${c}${R.sal}:${c}${R.sup})`, total: "soma", negrito: true },
    { rotulo: "C. VEÍCULOS (fixo mensal, perfil de cada rota)", secao: true },
    { chave: "dep", rotulo: "Depreciação", item: somaSe("dep"), total: "soma", memo: "Rotas: veíc. c/ reserva × depreciação mensal do perfil (aba Perfis)" },
    { chave: "rem", rotulo: "Remuneração do capital", item: somaSe("rem"), total: "soma", memo: "Rotas: veíc. c/ reserva × valor remunerado × taxa ÷ 12" },
    { chave: "seg", rotulo: "Seguro", item: somaSe("seg"), total: "soma", memo: "veíc. c/ reserva × seguro" },
    { chave: "ipva", rotulo: "IPVA / licenciamento + laudo/vistoria", item: somaSe("ipva"), total: "soma", memo: "veíc. c/ reserva × (IPVA + laudo) ÷ 12" },
    { chave: "tel", rotulo: "Rastreamento + telemetria + controle de embarque", item: somaSe("tel"), total: "soma", memo: "veíc. c/ reserva × (rastreador + telemetria + embarque)" },
    { chave: "hig", rotulo: "Higienização + acessibilidade/identificação", item: somaSe("hig"), total: "soma", memo: "veíc. operacionais × (higienização + acessibilidade)" },
    { chave: "gar", rotulo: "Garagem / base operacional", item: somaSe("gar"), total: "soma", memo: "garagem com reserva (S) ou só frota operacional (N) — perfil" },
    { chave: "adapt", rotulo: "Adaptações (depreciação + capital)", item: (c, i, R) => `${somaSe("adDep")(c, i, R)}+${somaSe("adCap")(c, i, R)}`, total: "soma", memo: "veíc. c/ reserva × adaptação × (1 ÷ prazo + taxa ÷ 12)" },
    { chave: "manF", rotulo: "Manutenção fixa (% do valor)", item: somaSe("manF"), total: "soma", memo: "veíc. c/ reserva × valor × % ao mês" },
    { chave: "veicm", rotulo: "Subtotal veículos (mensal)", item: (c, _i, R) => `SUM(${c}${R.dep}:${c}${R.manF})`, total: "soma", negrito: true },
    { chave: "adDep", rotulo: "  da qual: depreciação das adaptações (dá crédito)", item: somaSe("adDep"), total: "soma", memo: "parte das adaptações que entra no crédito de PIS/COFINS" },
    {
      chave: "remP",
      rotulo: "  da qual: remuneração do capital próprio (não dedutível)",
      item: somaSe("remP"),
      total: "soma",
      memo: "veículo e adaptações à taxa do capital próprio: custo de oportunidade, não despesa — o Lucro Real não o deduz",
    },
    { rotulo: `D. CUSTO FIXO NO ${apuracao.toUpperCase()}`, secao: true },
    {
      chave: "impl",
      rotulo: "Implantação amortizada (mensal, rateio por km útil)",
      item: (c, _i, R) => `IF(${P.vigencia}=0,0,${P.implantacao}/${P.vigencia})*IF(${kmTotalRotas}=0,0,${c}${R.kmfat}/${kmTotalRotas})`,
      total: "soma",
      memo: "implantação ÷ vigência × km útil do item ÷ km útil de todas as rotas",
    },
    { chave: "fixo", rotulo: `Custo fixo no ${apuracao} (mão de obra + veículos + implantação) × meses`, item: (c, _i, R) => `(${c}${R.mo}+${c}${R.veicm}+${c}${R.impl})*${P.meses}`, total: "soma", negrito: true, memo: "(B + C + implantação) × meses de custo fixo" },
    { rotulo: `E. INSUMOS VARIÁVEIS (no ${apuracao})`, secao: true },
    { chave: "die", rotulo: "Diesel", item: daContratada("diesel"), total: "soma", memo: "Rotas: km rodado × R$/l × (asfalto ÷ consumo + terra ÷ consumo); zero com combustível do cliente" },
    { chave: "arla", rotulo: "ARLA 32", item: daContratada("arla"), total: "soma", memo: "km rodado × R$/km; zero com combustível do cliente" },
    { chave: "oleo", rotulo: "Lubrificantes / lavagem", item: somaSe("oleo"), total: "soma", memo: "km rodado × R$/km" },
    { chave: "pneus", rotulo: "Pneus", item: somaSe("pneus"), total: "soma", memo: "ponderado asfalto × terra" },
    { chave: "manut", rotulo: "Manutenção", item: somaSe("manut"), total: "soma", memo: "ponderado asfalto × terra" },
    { chave: "ped", rotulo: "Pedágio", item: somaSe("pedagio"), total: "soma", memo: "passagens × tarifa" },
    { chave: "var", rotulo: "Subtotal variáveis", item: (c, _i, R) => `SUM(${c}${R.die}:${c}${R.ped})`, total: "soma", negrito: true },
    { rotulo: "F. TOTAIS", secao: true },
    { chave: "dir", rotulo: "Custo direto", item: (c, _i, R) => `${c}${R.fixo}+${c}${R.var}`, total: "soma", memo: "D + E" },
    { chave: "ind", rotulo: "Administração central + contingência", item: (c, _i, R) => `${c}${R.dir}*(${P.adm}+${P.contingencia})`, total: "soma", memo: "custo direto × (adm + contingência)" },
    { chave: "tot", rotulo: `CUSTO TOTAL NO ${apuracao.toUpperCase()}`, item: (c, _i, R) => `${c}${R.dir}+${c}${R.ind}`, total: "soma", negrito: true },
    { chave: "fcc", rotulo: "Custos fixos com crédito de PIS/COFINS", item: (c, _i, R) => `(${c}${R.dep}+${c}${R.adDep}+${c}${R.manF}+${c}${R.gar})*${P.meses}`, total: "soma", memo: "(depreciação + depreciação das adaptações + manutenção fixa + garagem) × meses" },
    { chave: "vcc", rotulo: "Custos variáveis com crédito de PIS/COFINS", item: (c, _i, R) => `${c}${R.die}+${c}${R.arla}+${c}${R.oleo}+${c}${R.pneus}+${c}${R.manut}`, total: "soma", memo: "diesel + ARLA + óleo + pneus + manutenção" },
    { chave: "cred", rotulo: "Crédito de PIS/COFINS (Lucro Real)", item: (c, _i, R) => `(${c}${R.fcc}+${c}${R.vcc})*${P.credito}`, total: "soma", memo: "custos com crédito × % do crédito" },
    { chave: "cliq", rotulo: "Custo líquido do crédito", item: (c, _i, R) => `${c}${R.tot}-${c}${R.cred}`, total: "soma", negrito: true, memo: "custo total − crédito de PIS/COFINS" },
    {
      chave: "nded",
      rotulo: "Não dedutíveis do IRPJ/CSLL (capital próprio + contingência)",
      item: (c, _i, R) => `${c}${R.remP}*${P.meses}+${c}${R.dir}*${P.contingencia}`,
      total: "soma",
      memo: "capital próprio × meses + custo direto × contingência (provisão): no Lucro Real, somam-se ao lucro na base do IR",
    },
    {
      chave: "cpp",
      rotulo: "Custo a cobrir no preço",
      item: (c, _i, R) => `${c}${R.cliq}+${c}${R.nded}*${c}${R.kir}`,
      total: "soma",
      negrito: true,
      memo: "custo líquido + IR sobre os não dedutíveis (não dedutíveis × IR ÷ (1 − IR)); igual ao custo líquido no Presumido",
    },
    { chave: "ckm", rotulo: "Custo por km útil (R$/km)", item: (c, _i, R) => `IF(${c}${R.kmfat}=0,0,${c}${R.tot}/${c}${R.kmfat})`, total: (R) => `IF(${T}${R.kmfat}=0,0,${T}${R.tot}/${T}${R.kmfat})`, fmt: BRL4, negrito: true, memo: "custo total ÷ km útil" },
    { chave: "cfix", rotulo: "  do qual: custo fixo por km", item: (c, _i, R) => `IF(${c}${R.kmfat}=0,0,${c}${R.fixo}/${c}${R.kmfat})`, total: (R) => `IF(${T}${R.kmfat}=0,0,${T}${R.fixo}/${T}${R.kmfat})`, fmt: BRL4 },
    { chave: "cvar", rotulo: "  do qual: custo variável + indiretos por km", item: (c, _i, R) => `IF(${c}${R.kmfat}=0,0,(${c}${R.var}+${c}${R.ind})/${c}${R.kmfat})`, total: (R) => `IF(${T}${R.kmfat}=0,0,(${T}${R.var}+${T}${R.ind})/${T}${R.kmfat})`, fmt: BRL4 },
    { chave: "cvm", rotulo: "Custo por veículo-mês", item: (c, _i, R) => `IF(${c}${R.qvm}=0,0,${c}${R.tot}/${c}${R.qvm})`, total: (R) => `IF(${T}${R.qvm}=0,0,${T}${R.tot}/${T}${R.qvm})`, fmt: BRL },
    { chave: "cd", rotulo: "Custo por diária", item: (c, _i, R) => `IF(${c}${R.qd}=0,0,${c}${R.tot}/${c}${R.qd})`, total: (R) => `IF(${T}${R.qd}=0,0,${T}${R.tot}/${T}${R.qd})`, fmt: BRL },
    { chave: "ch", rotulo: "Custo por hora", item: (c, _i, R) => `IF(${c}${R.qh}="","",IF(${c}${R.qh}=0,0,${c}${R.tot}/${c}${R.qh}))`, total: "vazio", fmt: BRL },
    { rotulo: "G. PREÇO", secao: true },
    { chave: "trb", rotulo: "Tributos sobre faturamento (média do item)", item: (_c, i) => P[`trib:${itens[i].codigo}`], tipo: "link", total: "ponderado", fmt: PCT2, memo: "Premissas seção 7; no total, ponderado pelo faturamento" },
    { chave: "fin", rotulo: "Custo financeiro (prazo de recebimento)", item: () => P.fin, tipo: "link", total: "ponderado", fmt: PCT2, memo: "Premissas" },
    { chave: "sobre", rotulo: "Despesas sobre o preço", item: () => P.sobrePreco, tipo: "link", total: "ponderado", fmt: PCT2, memo: "Premissas" },
    { chave: "luc", rotulo: "Lucro líquido alvo", item: () => P.lucro, tipo: "link", total: "ponderado", fmt: PCT, memo: "Premissas" },
    { chave: "ir", rotulo: "IRPJ + CSLL sobre o lucro (Lucro Real)", item: () => P.irLucro, tipo: "link", total: "ponderado", fmt: PCT2, memo: "Premissas" },
    {
      chave: "kir",
      rotulo: "IR sobre cada real não dedutível (IR ÷ (1 − IR))",
      item: (c, _i, R) => `IF(1-${c}${R.ir}=0,0,${c}${R.ir}/(1-${c}${R.ir}))`,
      total: (R) => `IF(1-${T}${R.ir}=0,0,${T}${R.ir}/(1-${T}${R.ir}))`,
      fmt: PCT2,
      memo: "o lucro depois do IR só fica no alvo se o preço cobrir também o IR sobre o que o fisco não deduz",
    },
    { chave: "liq", rotulo: "Receita líquida (1 − tributos − financeiro − despesas)", item: (c, _i, R) => `1-${c}${R.trb}-${c}${R.fin}-${c}${R.sobre}`, total: (R) => `1-${T}${R.trb}-${T}${R.fin}-${T}${R.sobre}`, fmt: PCT2 },
    { chave: "div", rotulo: "Divisor do preço (líquida − lucro ÷ (1 − IR))", item: (c, _i, R) => `${c}${R.liq}-IF(1-${c}${R.ir}=0,0,${c}${R.luc}/(1-${c}${R.ir}))`, total: (R) => `${T}${R.liq}-IF(1-${T}${R.ir}=0,0,${T}${R.luc}/(1-${T}${R.ir}))`, fmt: PCT2 },
    { chave: "pkm", rotulo: "PREÇO/KM CALCULADO (R$/km)", item: (c, _i, R) => precoPor(String(R.kmfat), c, R), total: (R) => `IF(${T}${R.kmfat}=0,0,${T}${R.fat}/${T}${R.kmfat})`, fmt: BRL, negrito: true, destaque: true, memo: `custo líquido/km ÷ divisor, 2 casas para cima; na coluna ${lote ? "Lote" : "Total"}: faturamento ÷ km útil` },
    { chave: "pvm", rotulo: "Preço por veículo-mês", item: (c, _i, R) => precoPor(String(R.qvm), c, R), total: "vazio", fmt: BRL, memo: "custo líquido ÷ veículos-mês ÷ divisor" },
    { chave: "pd", rotulo: "Preço por diária", item: (c, _i, R) => precoPor(String(R.qd), c, R), total: "vazio", fmt: BRL, memo: "custo líquido ÷ diárias ÷ divisor" },
    { chave: "ph", rotulo: "Preço por hora", item: (c, _i, R) => `IF(${c}${R.qh}="","",${precoPor(String(R.qh), c, R)})`, total: "vazio", fmt: BRL, memo: "custo líquido ÷ horas ÷ divisor (vazio sem horas/dia)" },
    {
      chave: "bfix",
      rotulo: "Binômia — parcela fixa por veículo-mês",
      item: (c, _i, R) =>
        `IF(${c}${R.qvm}>0,ROUNDUP((${c}${R.fixo}*(1+${P.adm}+${P.contingencia})-${c}${R.fcc}*${P.credito}+(${c}${R.remP}*${P.meses}+${c}${R.fixo}*${P.contingencia})*${c}${R.kir})/${c}${R.div}/${c}${R.qvm},2),0)`,
      total: "vazio",
      fmt: BRL,
      memo: "(fixo × (1 + indiretos) − crédito do fixo + não dedutíveis do fixo × IR ÷ (1 − IR)) ÷ divisor ÷ veículos-mês",
    },
    {
      chave: "bvar",
      rotulo: "Binômia — parcela por km",
      item: (c, _i, R) =>
        `IF(${c}${R.kmfat}>0,ROUNDUP((${c}${R.var}*(1+${P.adm}+${P.contingencia})-${c}${R.vcc}*${P.credito}+${c}${R.var}*${P.contingencia}*${c}${R.kir})/${c}${R.div}/${c}${R.kmfat},2),0)`,
      total: "vazio",
      fmt: BRL,
      memo: "(variável × (1 + indiretos) − crédito do variável + contingência do variável × IR ÷ (1 − IR)) ÷ divisor ÷ km útil",
    },
    {
      chave: "qtdU",
      rotulo: "Quantidade na unidade do contrato",
      item: (c, _i, R) => `IF(${U}="VEICULO_MES",${c}${R.qvm},IF(${U}="DIARIA",${c}${R.qd},IF(${U}="HORA",N(${c}${R.qh}),${c}${R.kmfat})))`,
      total: "soma",
      fmt: NUM,
      memo: "KM e BINOMIA: km útil; VEICULO_MES: veículos-mês; DIARIA: diárias; HORA: horas",
    },
    {
      chave: "fat",
      rotulo: `Faturamento no ${apuracao} ao preço calculado`,
      item: (c, _i, R) =>
        `IF(${U}="BINOMIA",${c}${R.bfix}*${c}${R.qvm}+${c}${R.bvar}*${c}${R.kmfat},IF(${U}="KM",${c}${R.pkm}*${c}${R.kmfat},IF(${U}="VEICULO_MES",${c}${R.pvm},IF(${U}="DIARIA",${c}${R.pd},N(${c}${R.ph})))*${c}${R.qtdU}))`,
      total: "soma",
      memo: "preço da unidade × quantidade (binômia: fixo × veículos-mês + km × km útil)",
    },
    {
      chave: "pUn",
      rotulo: "PREÇO NA UNIDADE DO CONTRATO",
      item: (c, _i, R) => `IF(${U}="BINOMIA",${c}${R.bvar},IF(${U}="KM",${c}${R.pkm},IF(${c}${R.qtdU}=0,0,${c}${R.fat}/${c}${R.qtdU})))`,
      total: (R) =>
        `IF(${U}="BINOMIA",IF(${T}${R.kmfat}=0,0,SUMPRODUCT(${primeira}${R.bvar}:${ultima}${R.bvar},${primeira}${R.kmfat}:${ultima}${R.kmfat})/${T}${R.kmfat}),IF(${T}${R.qtdU}=0,0,${T}${R.fat}/${T}${R.qtdU}))`,
      fmt: BRL,
      negrito: true,
      destaque: true,
      memo: "na binômia, a parcela por km; no total, média ponderada pela quantidade",
    },
    { chave: "peq", rotulo: "Preço por km equivalente", item: (c, _i, R) => `IF(${U}="KM",${c}${R.pkm},IF(${c}${R.kmfat}=0,0,${c}${R.fat}/${c}${R.kmfat}))`, total: (R) => `IF(${T}${R.kmfat}=0,0,${T}${R.fat}/${T}${R.kmfat})`, fmt: BRL, memo: "faturamento ÷ km útil (compara com o teto por km)" },
    { chave: "pmax", rotulo: "Preço máximo do edital (R$/km)", item: (_c, i) => itens[i].precoMaximoKm ?? null, tipo: "entrada", total: "vazio", fmt: BRL, memo: "edital (vazio = sem teto)" },
    { chave: "folga", rotulo: "Folga vs. preço máximo", item: (c, _i, R) => `IF(N(${c}${R.pmax})=0,"",${c}${R.peq}/${c}${R.pmax}-1)`, total: "vazio", fmt: DPCT, memo: "negativo = abaixo do teto" },
    { chave: "teto", rotulo: "Situação frente ao preço máximo", item: (c, _i, R) => `IF(N(${c}${R.pmax})=0,"sem teto",IF(${c}${R.peq}>${c}${R.pmax},"ACIMA DO TETO","dentro do teto"))`, total: "vazio", memo: lote ? "no lote vale o preço único; item isolado acima do teto só fecha subsidiado pelos outros" : "" },
    { chave: "pref", rotulo: "Preço de referência (R$/km)", item: (_c, i) => itens[i].precoReferenciaKm ?? null, tipo: "entrada", total: "vazio", fmt: BRL, memo: "estimativa do órgão / lances de referência (vazio = não há)" },
    { chave: "dref", rotulo: "Δ vs. preço de referência", item: (c, _i, R) => `IF(N(${c}${R.pref})=0,"",${c}${R.peq}/${c}${R.pref}-1)`, total: "vazio", fmt: DPCT, memo: "positivo = acima da referência" },
    { chave: "pmin", rotulo: "Preço mínimo para lucro zero (R$/km)", item: (c, _i, R) => `IF(OR(${c}${R.kmfat}=0,${c}${R.liq}=0),0,${c}${R.cpp}/${c}${R.kmfat}/${c}${R.liq})`, total: (R) => `IF(OR(${T}${R.kmfat}=0,${T}${R.liq}=0),0,${T}${R.cpp}/${T}${R.kmfat}/${T}${R.liq})`, fmt: BRL4, memo: "piso de exequibilidade: custo a cobrir/km ÷ receita líquida (lucro zero depois do IR)" },
    { chave: "lair", rotulo: "Lucro antes do IRPJ/CSLL sobre o lucro", item: (c, _i, R) => `${c}${R.fat}*${c}${R.liq}-${c}${R.cliq}`, total: "soma", memo: "faturamento × receita líquida − custo líquido" },
    { chave: "bir", rotulo: "Base do IRPJ/CSLL sobre o lucro (Lucro Real)", item: (c, _i, R) => `${c}${R.lair}+${c}${R.nded}`, total: "soma", memo: "lucro antes do IR + não dedutíveis" },
    { chave: "irv", rotulo: "IRPJ/CSLL sobre o lucro", item: (c, _i, R) => `IF(${c}${R.bir}>0,${c}${R.bir}*${c}${R.ir},0)`, total: "soma", memo: "só sobre base positiva" },
    { chave: "lucm", rotulo: `Lucro líquido no ${apuracao}`, item: (c, _i, R) => `${c}${R.lair}-${c}${R.irv}`, total: "soma", negrito: true, memo: "lucro antes do IR − IR sobre o lucro" },
    { chave: "marg", rotulo: "Margem líquida", item: (c, _i, R) => `IF(${c}${R.fat}=0,0,${c}${R.lucm}/${c}${R.fat})`, total: (R) => `IF(${T}${R.fat}=0,0,${T}${R.lucm}/${T}${R.fat})`, fmt: PCT, memo: "lucro ÷ faturamento" },
    { chave: "fata", rotulo: "Faturamento anual", item: (c, _i, R) => `${c}${R.fat}*IF(${P.modo}="MENSAL",${P.vigencia},1)`, total: "soma", memo: "MENSAL: × vigência; PERIODO: o período já é o ano letivo" },
    { chave: "luca", rotulo: "Lucro líquido anual", item: (c, _i, R) => `${c}${R.lucm}*IF(${P.modo}="MENSAL",${P.vigencia},1)`, total: "soma", negrito: true, memo: "idem" },
    { rotulo: lote ? "H. LOTE — PREÇO ÚNICO DA PROPOSTA" : "H. PREÇO DA PROPOSTA", secao: true },
    { chave: "ppkm", rotulo: "Preço único por km (média ponderada, 2 casas para cima)", item: () => null, tipo: "entrada", total: (R) => `ROUNDUP(${T}${R.pkm},2)`, fmt: BRL, negrito: true, memo: "média do lote pelo km útil, arredondada para cima" },
    {
      chave: "ppropU",
      rotulo: "Preço proposto na unidade do contrato",
      item: (c, _i, R) => `IF(${P.criterio}="LOTE",$${T}$${R.ppropU},${c}${R.pUn})`,
      total: (R) => `IF(${U}="KM",${T}${R.ppkm},ROUNDUP(${T}${R.pUn},2))`,
      fmt: BRL,
      negrito: true,
      destaque: true,
      memo: `LOTE: o preço médio do lote na unidade, arredondado para cima em 2 casas, igual em todos os itens (binômia: a parcela por km); ITEM: o preço de cada item. Na coluna ${lote ? "Lote" : "Total"}: a média arredondada para cima`,
    },
    {
      chave: "fatp",
      rotulo: `Faturamento no ${apuracao} ao preço proposto`,
      item: (c, _i, R) => `IF(${U}="KM",${c}${R.ppropU}*${c}${R.kmfat},IF(${U}="BINOMIA",${c}${R.fat},${c}${R.ppropU}*${c}${R.qtdU}))`,
      total: "soma",
      memo: "preço proposto × quantidade (binômia: o faturamento calculado)",
    },
    { chave: "lairp", rotulo: "Lucro antes do IR ao preço proposto", item: (c, _i, R) => `${c}${R.fatp}*${c}${R.liq}-${c}${R.cliq}`, total: (R) => `${T}${R.fatp}*${T}${R.liq}-${T}${R.cliq}`, memo: "no total, com os tributos ponderados pelo faturamento ao preço calculado" },
    {
      chave: "lucp",
      rotulo: `Lucro líquido no ${apuracao} ao preço proposto`,
      item: (c, _i, R) => `${c}${R.lairp}-IF(${c}${R.lairp}+${c}${R.nded}>0,(${c}${R.lairp}+${c}${R.nded})*${c}${R.ir},0)`,
      total: (R) => `${T}${R.lairp}-IF(${T}${R.lairp}+${T}${R.nded}>0,(${T}${R.lairp}+${T}${R.nded})*${T}${R.ir},0)`,
      negrito: true,
      memo: "lucro antes do IR − IR sobre (lucro antes do IR + não dedutíveis), se positiva",
    },
    { chave: "margp", rotulo: "Margem líquida ao preço proposto", item: (c, _i, R) => `IF(${c}${R.fatp}=0,0,${c}${R.lucp}/${c}${R.fatp})`, total: (R) => `IF(${T}${R.fatp}=0,0,${T}${R.lucp}/${T}${R.fatp})`, fmt: PCT },
  ];

  const C0 = 5;
  const RC: R = {};
  linhas.forEach((ln, k) => {
    if (ln.chave) RC[ln.chave] = C0 + k;
  });
  const ponderado = (l: number) =>
    `IF(SUM(${primeira}${RC.fat}:${ultima}${RC.fat})=0,0,SUMPRODUCT(${primeira}${l}:${ultima}${l},${primeira}${RC.fat}:${ultima}${RC.fat})/SUM(${primeira}${RC.fat}:${ultima}${RC.fat}))`;
  linhas.forEach((ln, k) => {
    const l = C0 + k;
    if (ln.secao) {
      secao(wc, l, ln.rotulo, COL_MEMO);
      return;
    }
    escrever(wc, l, 1, ln.rotulo, { negrito: ln.negrito });
    itens.forEach((_it, i) => {
      const c = colunaItem(i);
      const val = ln.item!(c, i, RC);
      const tipo = ln.tipo ?? "formula";
      const valor: Valor = tipo === "entrada" ? val : typeof val === "string" ? fx(val) : val;
      escrever(wc, l, i + 2, valor, {
        tipo,
        negrito: ln.negrito,
        fmt: ln.fmt ?? BRL,
        fundo: ln.destaque ? FUNDO_PREENCHER : undefined,
        alinhar: ["codigo", "comMot", "combCli"].includes(ln.chave ?? "") ? { horizontal: "center" } : undefined,
      });
    });
    const tot = ln.total ?? "soma";
    const valorTotal: Valor =
      tot === "vazio" ? null : tot === "soma" ? fx(`SUM(${primeira}${l}:${ultima}${l})`) : tot === "ponderado" ? fx(ponderado(l)) : fx(tot(RC));
    escrever(wc, l, COL_TOTAL, nI === 0 && tot === "soma" ? 0 : valorTotal, {
      negrito: ln.negrito,
      fmt: ln.fmt ?? BRL,
      fundo: ln.destaque && lote ? FUNDO_PREENCHER : FUNDO_TOTAL,
    });
    escrever(wc, l, COL_MEMO, ln.memo ?? "", { tamanho: 9, quebra: true });
  });
  congelar(wc, 1, 5);
  const CC = (chave: string) => `'Composição de Custo'!$${T}$${RC[chave]}`;
  const CCfaixa = (chave: string) => `'Composição de Custo'!$${primeira}$${RC[chave]}:$${ultima}$${RC[chave]}`;

  // ============================================================ CENÁRIOS
  const utilizacoes = entrada.utilizacoesCenario ?? [0.6, 0.7, 0.8, 0.85, 0.9, 1];
  const nU = utilizacoes.length;
  const COLS_Z = nU + 1;
  const largZ = Math.max(COLS_Z, 9);
  // Leiaute: tabela da linha 7 à 20, equilíbrio em 22–23, nota em 25 e o
  // bloco de parâmetros da linha Z0 em diante.
  const Z0 = 27;
  titulo(wz, 1, "CENÁRIOS — sensibilidade do custo e do lucro à utilização do km de referência, ao preço de teste", largZ);
  nota(
    wz,
    2,
    "O custo fixo não muda com o km pago; o variável acompanha o km rodado e o pedágio acompanha a utilização. O faturamento depende da unidade: por km cai com o km; por veículo-mês, diária ou hora fica; na binômia, a parcela fixa fica e a por km cai. " +
      `Os parâmetros (linhas ${Z0} em diante) vêm da aba Composição de Custo.`,
    largZ,
    42
  );
  larguras(wz, [44, ...utilizacoes.map(() => 15)]);
  escrever(wz, 4, 1, "Preço de teste na unidade do contrato", { negrito: true });
  escrever(wz, 4, 2, resultado.cenarios.precoTesteKm, { tipo: "entrada", fmt: BRL, fundo: FUNDO_PREENCHER });
  escrever(wz, 4, 3, fx(`"← edite para simular o lance ("&${U}&IF(${U}="BINOMIA","; a parcela por km — a fixa é a da Composição","")&")"`), { tamanho: 9, borda: false });
  cabecalho(wz, 6, [`Utilização do km de referência`, ...utilizacoes.map(() => "")], undefined, 20);
  utilizacoes.forEach((u, j) => {
    const c = wz.getCell(6, j + 2);
    c.value = u;
    c.numFmt = "0%";
    c.font = { name: FONTE, size: 10, bold: true, color: { argb: BRANCO } };
  });

  // Bloco de parâmetros, abaixo da tabela: cada linha é uma fórmula sobre a
  // Composição de Custo; a tabela acima usa estas células.
  const ordemZ = [
    "kmRef", "fixo", "ped", "varKm", "ind", "morto", "trib", "liq", "ir", "divAlvo", "credVar", "credFixo", "credKm", "qFixa", "fatFixo", "fatU",
    "capProp", "cont", "kir", "a", "b", "n0", "n1", "aL", "bL",
  ];
  const ZP: Record<string, number> = {};
  ordemZ.forEach((k, i) => (ZP[k] = Z0 + 1 + i));
  const Z = (k: string) => `$B$${ZP[k]}`;
  const parametros: Record<string, [string, string, string]> = {
    kmRef: ["Km de referência (utilização 100%)", CC("kmref"), INT],
    fixo: [`Custo fixo no ${apuracao}`, CC("fixo"), BRL],
    ped: ["Pedágio (100%)", CC("ped"), BRL],
    varKm: ["Variável sem pedágio por km rodado", `IF(${CC("kmrod")}=0,0,(${CC("var")}-${CC("ped")})/${CC("kmrod")})`, BRL4],
    ind: ["Indiretos (adm + contingência)", `${P.adm}+${P.contingencia}`, PCT2],
    morto: ["Km improdutivo", P.kmMorto, PCT2],
    trib: ["Tributos (ponderados pelo faturamento)", CC("trb"), PCT2],
    liq: ["Receita líquida (1 − tributos − financeiro − despesas)", `1-${Z("trib")}-${P.fin}-${P.sobrePreco}`, PCT2],
    ir: ["IRPJ + CSLL sobre o lucro", P.irLucro, PCT2],
    divAlvo: ["Divisor do preço p/ lucro alvo", `${Z("liq")}-IF(1-${Z("ir")}=0,0,${P.lucro}/(1-${Z("ir")}))`, PCT2],
    credVar: ["Custos variáveis com crédito", CC("vcc"), BRL],
    credFixo: ["Crédito de PIS/COFINS — parte fixa", `${CC("fcc")}*${P.credito}`, BRL],
    credKm: ["Crédito de PIS/COFINS por km rodado", `IF(${CC("kmrod")}=0,0,${Z("credVar")}/${CC("kmrod")})*${P.credito}`, BRL4],
    qFixa: ["Quantidade na unidade do contrato", CC("qtdU"), NUM],
    fatFixo: ["Faturamento fixo (não varia com a utilização)", `IF(${U}="KM",0,IF(${U}="BINOMIA",SUMPRODUCT(${CCfaixa("bfix")},${CCfaixa("qvm")}),$B$4*${Z("qFixa")}))`, BRL],
    fatU: ["Faturamento por utilização (× u)", `IF(OR(${U}="KM",${U}="BINOMIA"),$B$4*${Z("kmRef")},0)`, BRL],
    capProp: [`Remuneração do capital próprio no ${apuracao} (não dedutível)`, `${CC("remP")}*${P.meses}`, BRL],
    cont: ["Contingência (não dedutível)", P.contingencia, PCT2],
    kir: ["IR sobre cada real não dedutível (IR ÷ (1 − IR))", `IF(1-${Z("ir")}=0,0,${Z("ir")}/(1-${Z("ir")}))`, PCT2],
    a: ["Lucro antes do IR com utilização zero (a)", `${Z("fatFixo")}*${Z("liq")}-${Z("fixo")}*(1+${Z("ind")})+${Z("credFixo")}`, BRL],
    b: [
      "Lucro antes do IR por unidade de utilização (b)",
      `${Z("fatU")}*${Z("liq")}-(${Z("varKm")}*${Z("kmRef")}*(1+${Z("morto")})+${Z("ped")})*(1+${Z("ind")})+${Z("credKm")}*${Z("kmRef")}*(1+${Z("morto")})`,
      BRL,
    ],
    n0: ["Não dedutíveis com utilização zero (n0)", `${Z("capProp")}+${Z("fixo")}*${Z("cont")}`, BRL],
    n1: ["Não dedutíveis por unidade de utilização (n1)", `(${Z("varKm")}*${Z("kmRef")}*(1+${Z("morto")})+${Z("ped")})*${Z("cont")}`, BRL],
    // Onde a base do IR é positiva — e o lucro zero sempre cai aí —, o lucro
    // depois do IR é (a + b·u)·(1 − ir) − ir·(n0 + n1·u).
    aL: ["Lucro depois do IR com utilização zero (a' = a·(1 − ir) − ir·n0)", `${Z("a")}*(1-${Z("ir")})-${Z("ir")}*${Z("n0")}`, BRL],
    bL: ["Lucro depois do IR por unidade de utilização (b' = b·(1 − ir) − ir·n1)", `${Z("b")}*(1-${Z("ir")})-${Z("ir")}*${Z("n1")}`, BRL],
  };
  secao(wz, Z0, "PARÂMETROS DOS CENÁRIOS (fórmulas sobre a Composição de Custo)", largZ);
  for (const k of ordemZ) {
    const [rotulo, formula, fmt] = parametros[k];
    escrever(wz, ZP[k], 1, rotulo);
    escrever(wz, ZP[k], 2, fx(formula), { fmt });
  }
  const anual = `IF(${P.modo}="MENSAL",${P.vigencia},1)`;
  const mesesApuracao = `IF(${P.modo}="MENSAL",1,${P.meses})`;
  // Linhas da tabela, pela chave: as fórmulas se referem umas às outras.
  type LinhaZ = [chave: string, rotulo: string, formula: ((c: string) => string) | null, fmt: string];
  const L: Record<string, number> = {};
  const cel = (k: string, c: string) => `${c}${L[k]}`;
  const cenarios: LinhaZ[] = [
    ["km", `Km útil faturável no ${apuracao}`, (c) => `${Z("kmRef")}*${c}$6`, INT],
    ["custo", `Custo total no ${apuracao} (R$)`, (c) => `(${Z("fixo")}+${Z("varKm")}*${cel("km", c)}*(1+${Z("morto")})+${Z("ped")}*${c}$6)*(1+${Z("ind")})`, BRL],
    ["cred", "Crédito de PIS/COFINS (R$)", (c) => `${Z("credFixo")}+${Z("credKm")}*${cel("km", c)}*(1+${Z("morto")})`, BRL],
    ["nded", "Não dedutíveis do IRPJ/CSLL (R$)", (c) => `${Z("capProp")}+${cel("custo", c)}/(1+${Z("ind")})*${Z("cont")}`, BRL],
    ["ckm", "Custo por km útil (R$/km)", (c) => `IF(${cel("km", c)}=0,0,${cel("custo", c)}/${cel("km", c)})`, BRL4],
    ["alvo", "Preço/km p/ lucro alvo (R$/km)", (c) => `IF(${cel("km", c)}=0,0,ROUNDUP((${cel("custo", c)}-${cel("cred", c)}+${cel("nded", c)}*${Z("kir")})/${cel("km", c)}/${Z("divAlvo")},2))`, BRL],
    ["zero", "Preço/km lucro zero (R$/km)", (c) => `IF(OR(${cel("km", c)}=0,${Z("liq")}=0),0,(${cel("custo", c)}-${cel("cred", c)}+${cel("nded", c)}*${Z("kir")})/${cel("km", c)}/${Z("liq")})`, BRL4],
    ["sep", "— Ao preço de teste (B4) —", null, ""],
    ["fat", `Faturamento no ${apuracao} (R$)`, (c) => `${Z("fatFixo")}+${Z("fatU")}*${c}$6`, BRL],
    ["lair", `Lucro antes do IR sobre o lucro (R$)`, (c) => `${cel("fat", c)}*${Z("liq")}-(${cel("custo", c)}-${cel("cred", c)})`, BRL],
    ["lucro", `Lucro líquido no ${apuracao} (R$)`, (c) => `${cel("lair", c)}-IF(${cel("lair", c)}+${cel("nded", c)}>0,(${cel("lair", c)}+${cel("nded", c)})*${Z("ir")},0)`, BRL],
    ["marg", "Margem líquida", (c) => `IF(${cel("fat", c)}=0,0,${cel("lucro", c)}/${cel("fat", c)})`, DPCT],
    ["ano", "Lucro líquido / ano (R$)", (c) => `${cel("lucro", c)}*${anual}`, BRL],
    ["veic", "Lucro / veículo / mês (R$)", (c) => `IF(${CC("veic")}*${mesesApuracao}=0,0,${cel("lucro", c)}/(${CC("veic")}*${mesesApuracao}))`, BRL],
  ];
  cenarios.forEach(([chave], k) => (L[chave] = 7 + k));
  cenarios.forEach(([chave, rotulo, formula, fmt]) => {
    const l = L[chave];
    const destaque = formula === null || rotulo.startsWith("Lucro") || rotulo.startsWith("Preço");
    escrever(wz, l, 1, rotulo, { negrito: destaque });
    if (formula === null) {
      for (let col = 1; col <= COLS_Z; col++) wz.getCell(l, col).fill = FUNDO_SECAO;
      return;
    }
    utilizacoes.forEach((_u, j) => {
      const c = letraColuna(j + 2);
      escrever(wz, l, j + 2, fx(formula(c)), { fmt, negrito: rotulo.startsWith("Lucro líquido no") });
    });
  });
  // Lucro depois do IR (u) = a' + b'·u: o equilíbrio é u = −a'/b', se positivo.
  const LPE = 7 + cenarios.length + 1;
  escrever(wz, LPE, 1, "Ponto de equilíbrio (utilização com lucro zero ao preço de teste)", { negrito: true });
  escrever(wz, LPE, 2, fx(`IF(${Z("bL")}=0,"não empata",IF(-${Z("aL")}/${Z("bL")}>0,-${Z("aL")}/${Z("bL")},"não empata"))`), { negrito: true, fmt: PCT });
  escrever(wz, LPE + 1, 1, "Tipo do equilíbrio", { negrito: true });
  escrever(wz, LPE + 1, 2, fx(`IF(${Z("bL")}>0,"MÍNIMA","MÁXIMA")`), { negrito: true });
  escrever(wz, LPE + 1, 3, fx(`IF(${Z("bL")}>0,"abaixo desta utilização há prejuízo","acima desta utilização há prejuízo (faturamento fixo, custo variável cresce)")`), { tamanho: 9, borda: false });
  nota(
    wz,
    LPE + 3,
    mensal
      ? "Leitura: a coluna 100% é o km máximo do edital. Com preço por km, lucro negativo nas utilizações baixas expõe o lance ao risco de ociosidade (SRP paga só o km útil)."
      : "Leitura: no escolar a utilização é normalmente 100% (km do período letivo). As colunas menores mostram o efeito de dias letivos a menos ou linhas suspensas.",
    largZ
  );
  congelar(wz, 1, 6);

  // ============================================================ PROPOSTA
  larguras(wp, [15, 58, 14, 14, 14, 16, 16, 18]);
  const NCP = 8;
  const local = [edital.municipio, edital.uf].filter(Boolean).join("/");
  titulo(wp, 1, `${privado ? "PROPOSTA COMERCIAL" : "PROPOSTA DE PREÇOS"} — ${[edital.numero, edital.orgao, local].filter(Boolean).join(" — ")}`, NCP);
  nota(wp, 2, `Objeto: ${edital.objeto}`, NCP, 40);
  secao(wp, 4, privado ? "DADOS DA PROPONENTE" : "DADOS DO LICITANTE", NCP);
  const dadosLicitante: [string, string][] = [
    [privado ? "Proponente:" : "Licitante:", `${P.razao}&"  —  CNPJ "&${P.cnpj}`],
    // `&""`: premissa vazia aparece vazia, e não como 0.
    ["Endereço:", `${P.endereco}&""`],
    ["Representante:", `${P.representante}&""`],
  ];
  dadosLicitante.forEach(([rotulo, formula], k) => {
    escrever(wp, 5 + k, 1, rotulo, { negrito: true, borda: false });
    wp.mergeCells(5 + k, 2, 5 + k, NCP);
    escrever(wp, 5 + k, 2, fx(formula), { tipo: "link", borda: false });
  });
  cabecalho(
    wp,
    9,
    ["Item", "Descrição do serviço", "Unidade", mensal ? "Quantidade (vigência)" : "Quantidade (período)", privado ? "Referência do cliente (R$/km)" : "Preço máx. (R$/km)", "Preço proposto (unidade)", "Parcela fixa binômia (R$/veíc.-mês)", "Valor total (R$)"],
    undefined,
    40
  );
  const P0 = 10;
  const TOPO: Partial<ExcelJS.Alignment> = { vertical: "top" };
  const CP = (chave: string, c: string) => `'Composição de Custo'!${c}${RC[chave]}`;
  itens.forEach((it, i) => {
    const l = P0 + i;
    const c = colunaItem(i);
    escrever(wp, l, 1, it.codigo, { tipo: "texto", alinhar: { horizontal: "center", vertical: "top" } });
    escrever(wp, l, 2, it.descricao, { quebra: true });
    // A unidade por extenso; as fórmulas continuam lendo o código em ${U}.
    escrever(wp, l, 3, fx(`IF(${U}="KM","R$/km",IF(${U}="VEICULO_MES","R$/veículo-mês",IF(${U}="DIARIA","R$/diária",IF(${U}="HORA","R$/hora",IF(${U}="BINOMIA","R$/veíc.-mês + R$/km",${U})))))`), { tipo: "link", alinhar: TOPO });
    escrever(wp, l, 4, fx(`${CP("qtdU", c)}*${anual}`), { tipo: "link", fmt: NUM, alinhar: TOPO });
    escrever(wp, l, 5, fx(`IF(N(${CP("pmax", c)})=0,"",${CP("pmax", c)})`), { tipo: "link", fmt: BRL, alinhar: TOPO });
    escrever(wp, l, 6, fx(CP("ppropU", c)), { tipo: "link", fmt: BRL, fundo: FUNDO_PREENCHER, alinhar: TOPO });
    escrever(wp, l, 7, fx(`IF(${U}="BINOMIA",${CP("bfix", c)},"")`), { tipo: "link", fmt: BRL, alinhar: TOPO });
    escrever(wp, l, 8, fx(`${CP("fatp", c)}*${anual}`), { tipo: "link", fmt: BRL, alinhar: TOPO });
    wp.getRow(l).height = it.descricao.length > 70 ? 42 : 30;
  });
  const PEND = P0 + Math.max(nI, 1) - 1;
  let lp2 = PEND + 1;
  const linhaTotal = (rotulo: string, formula: string, fmt: string, negrito: boolean) => {
    for (let col = 1; col <= NCP; col++) escrever(wp, lp2, col, null, { fundo: FUNDO_TOTAL });
    escrever(wp, lp2, 2, rotulo, { negrito, fundo: FUNDO_TOTAL, alinhar: { horizontal: "right" } });
    escrever(wp, lp2, NCP, fx(formula), { negrito, fmt, fundo: FUNDO_TOTAL });
    return lp2++;
  };
  const lTotal = linhaTotal(
    `VALOR TOTAL DA PROPOSTA${lote ? " (LOTE)" : ""}${mensal ? ` — ${p.contrato.vigenciaMeses} meses` : ""}`,
    `SUM(H${P0}:H${PEND})`,
    BRL,
    true
  );
  if (itens.some((it) => it.precoMaximoKm)) {
    const lMax = linhaTotal("Valor máximo do edital (preço máx. × km útil)", `SUMPRODUCT(${CCfaixa("kmfat")},${CCfaixa("pmax")})*${anual}`, BRL, false);
    linhaTotal("Desconto sobre o valor máximo", `IF(H${lMax}=0,0,1-H${lTotal}/H${lMax})`, PCT, false);
  }
  lp2++;
  const orgaoCaixa = edital.orgao.toUpperCase();
  const c = d.comercial ?? {};
  const dataBrasil = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : null);
  const declaracoesPrivado = [
    `CONDIÇÃO DE PAGAMENTO: ${p.preco.prazoRecebimentoDias} dias após a emissão da nota fiscal${c.formaFaturamento ? `, com faturamento ${c.formaFaturamento.toLowerCase()}` : ""}.`,
    `VALIDADE DA PROPOSTA: ${dataBrasil(c.validadeProposta) ? `até ${dataBrasil(c.validadeProposta)}` : "30 (trinta) dias"}.`,
    ...(dataBrasil(c.inicioPrevisto) ? [`INÍCIO PREVISTO DA OPERAÇÃO: ${dataBrasil(c.inicioPrevisto)}.`] : []),
    `VIGÊNCIA: ${p.contrato.vigenciaMeses} meses${c.indiceReajuste ? `, com reajuste anual pelo ${c.indiceReajuste}` : ""}.`,
    ...(c.avisoRescisaoDias ? [`RESCISÃO: aviso prévio de ${c.avisoRescisaoDias} dias, por qualquer das partes.`] : []),
    ...(lote ? ["PREÇO ÚNICO: o preço proposto é o preço médio dos itens ponderado pela quantidade, arredondado para cima em 2 casas."] : []),
    "Estão incluídos nos preços todos os custos da operação descrita — motoristas e encargos, veículos, combustível, manutenção, seguros, tributos e administração.",
    "Serviços fora do escopo descrito (km ou horas além do previsto, viagens adicionais) serão orçados à parte.",
  ];
  const declaracoesPublico = [
    `CONDIÇÃO DE PAGAMENTO: ${p.preco.prazoRecebimentoDias} dias, após a liquidação e aceite pelos gestores do contrato, conforme o edital.`,
    "VALIDADE DA PROPOSTA: 60 (SESSENTA) DIAS.",
    "Os valores que ultrapassarem 02 (duas) casas decimais após a vírgula serão desconsiderados para fins de apuração do preço final.",
    ...(lote
      ? [
          "JULGAMENTO POR LOTE: o preço proposto é o preço médio do lote ponderado pela quantidade, arredondado para cima em 2 casas, igual em todos os itens. Confira o lucro a cada utilização na aba Cenários.",
        ]
      : []),
    `DECLARAMOS QUE estamos de acordo com os termos do Edital, e acatamos suas determinações, bem como informamos que nos preços propostos estão inclusos todos os custos diretos e indiretos, tributos, pedágios, seguros, lucros e demais contribuições pertinentes de nossa responsabilidade, sem qualquer exceção, constituindo-se os referidos preços unitários nas únicas contraprestações do(a) ${orgaoCaixa} pelas efetivas prestações dos serviços, sob nossa conta e risco.`,
    "DECLARAMOS QUE os serviços ofertados atendem a todas as condições fixadas nas normas técnicas especificadas no edital.",
    `DECLARAMOS QUE nenhum direito a indenização ou a reembolso de quaisquer despesas nos será devido, caso nossa proposta não seja aceita pelo(a) ${orgaoCaixa}.`,
    "DECLARAMOS QUE CONCORDAMOS integralmente com as condições estipuladas na presente licitação e, que caso vencedores, nos submeteremos ao cumprimento de seus termos.",
  ];
  const declaracoes = privado ? declaracoesPrivado : declaracoesPublico;
  for (const t of declaracoes) {
    nota(wp, lp2, t, NCP, t.length < 120 ? 15 : 42);
    lp2++;
  }
  lp2++;
  const centro = (formula: Valor, tipo: Tipo) => {
    wp.mergeCells(lp2, 1, lp2, NCP);
    escrever(wp, lp2, 1, formula, { tipo, borda: false, alinhar: { horizontal: "center" } });
    lp2++;
  };
  centro(fx(`${P.localData}&""`), "link");
  lp2++;
  centro("_____________________________________", "texto");
  centro(fx(`${P.representante}&""`), "link");
  centro(fx(`${P.razao}&" — CNPJ "&${P.cnpj}`), "link");
  wp.pageSetup = { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  congelar(wp, 0, 9);

  abaReforma(wReforma, d);
  const bytes = await wb.xlsx.writeBuffer();
  return Buffer.from(bytes as ArrayBuffer);
}

// ---------------------------------------------------------------- reforma
//
// A aba Reforma do estudo, em valores (a conta está em reforma.ts e os
// testes a conferem): a tabela de transição e cada ano do contrato — o preço
// que mantém o lucro alvo e a margem com a nota de hoje —, seguidos dos anos
// da transição depois do contrato, como renovação.
function abaReforma(w: ExcelJS.Worksheet, d: DadosExportacao) {
  const inicioTexto = d.entrada.reforma?.inicio ?? d.comercial?.inicioPrevisto?.slice(0, 7) ?? null;
  const inicio = lerInicio(inicioTexto) ?? lerInicio(proximoMes(d.geradoEm))!;
  const ref = reformaAnoAAno(d.entrada, d.resultado, { inicio, creditoVeiculo: d.entrada.reforma?.creditoVeiculo === true });
  const col = 11;
  titulo(w, 1, `REFORMA TRIBUTÁRIA ANO A ANO — início ${String(inicio.mes).padStart(2, "0")}/${inicio.ano}, ${ref.vigenciaMeses} meses`, col);
  nota(
    w,
    2,
    "Estimativa com as alíquotas de referência da CBS e do IBS (a fixar pelo Senado). Fretamento sem redução. CBS e IBS por fora do preço, com crédito sobre as compras a partir de 2027; ISS e ICMS a 90%, 80%, 70% e 60% de 2029 a 2032. " +
      "B = o preço que mantém o lucro alvo; A = o cliente pagando a nota de hoje. Preço dos insumos o de hoje, com CBS/IBS dentro; administração central igual.",
    col,
    42
  );
  let l = 4;
  secao(w, l++, "TABELA DE TRANSIÇÃO", col);
  cabecalho(w, l++, ["Ano", "PIS/COFINS", "CBS", "IBS", "ISS/ICMS (fração do de hoje)", "Observação"], [10, 14, 12, 12, 16, 18]);
  for (const t of ref.tabela) {
    escrever(w, l, 1, t.ano);
    escrever(w, l, 2, t.pisCofins ? "sim" : "não");
    escrever(w, l, 3, t.cbs, { fmt: PCT2 });
    escrever(w, l, 4, t.ibs, { fmt: PCT2 });
    escrever(w, l, 5, t.fatorIssIcms, { fmt: PCT });
    escrever(w, l, 6, t.teste ? "teste, compensado" : "");
    l++;
  }
  l++;
  secao(w, l++, "O CONTRATO ANO A ANO (R$ no ano)", col);
  cabecalho(w, l++, ["Ano", "Meses", "Custo", "Crédito", "Tributos por dentro", "B: preço sem CBS/IBS", "B: CBS + IBS", "B: nota", "B: reequilíbrio", "A: margem", "Carga"], [10, 14, 16, 16, 16, 18, 16, 16, 14, 12, 12]);
  for (const a of [...ref.anos, ...ref.alemDoContrato]) {
    if (a === ref.alemDoContrato[0]) {
      nota(w, l++, "Depois do contrato, até o fim da transição: projeção como renovação nas mesmas condições, 12 meses por ano.", col);
    }
    escrever(w, l, 1, a.projecao ? `${a.ano} (renovação)` : a.ano);
    escrever(w, l, 2, a.meses, { fmt: "0" });
    escrever(w, l, 3, a.custo, { fmt: BRL });
    escrever(w, l, 4, -a.credito, { fmt: BRL });
    escrever(w, l, 5, a.tributosDentroPct, { fmt: PCT2 });
    escrever(w, l, 6, a.receita, { fmt: BRL });
    escrever(w, l, 7, a.cbs + a.ibs, { fmt: BRL });
    escrever(w, l, 8, a.nota, { fmt: BRL, negrito: true });
    escrever(w, l, 9, a.reequilibrio, { fmt: PCT });
    escrever(w, l, 10, a.semReequilibrio.margem, { fmt: PCT });
    escrever(w, l, 11, a.carga, { fmt: PCT });
    l++;
  }
  l++;
  secao(w, l++, "CLÁUSULA DE REEQUILÍBRIO (sugestão)", col);
  nota(w, l, clausulaDeReequilibrio(ref), col, 90);
}
