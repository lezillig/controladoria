import ExcelJS from "exceljs";
import type { EntradaSimulacao, ResultadoSimulacao } from "./tipos";

// A PLANILHA EXCEL DE UMA SIMULAÇÃO — abas Regras do Edital, Premissas, Rotas,
// Composição de Custo, Cenários e Proposta, no padrão das planilhas de
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
// Um só leiaute para os dois modos (MENSAL, como SJP; PERIODO, como Holambra)
// e para qualquer número de itens: a Composição tem os componentes nas linhas,
// uma coluna por item e uma coluna de total/lote. O que depende da rota —
// fator noturno e a divisão asfalto/terra — é calculado em colunas auxiliares
// da aba Rotas e somado por item com SOMASE pelo código do item.
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
  licitante: { razaoSocial: string; cnpj: string; endereco?: string | null; representante?: string | null };
  regras: { tema: string; texto: string; impacto: string; campo: string | null }[];
  entrada: EntradaSimulacao;
  resultado: ResultadoSimulacao;
  versao: number;
  geradoEm: Date;
};

// Nomes das abas, na ordem da pasta. O teste confere a ordem.
export const ABAS = ["Regras do Edital", "Premissas", "Rotas", "Composição de Custo", "Cenários", "Proposta"] as const;

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

export async function gerarPlanilhaSimulacao(d: DadosExportacao): Promise<Buffer> {
  const { edital, licitante, entrada, resultado } = d;
  const p = entrada.premissas;
  const itens = entrada.itens;
  const rotas = entrada.rotas;
  const mensal = p.contrato.modo === "MENSAL";
  const lote = entrada.criterio === "LOTE";
  const apuracao = mensal ? "mês" : "período";

  const wb = new ExcelJS.Workbook();
  wb.creator = "Controladoria — Simulador de custos";
  wb.created = d.geradoEm;
  wb.modified = d.geradoEm;
  // Sem valores guardados nas fórmulas: o Excel recalcula tudo ao abrir.
  wb.calcProperties = { fullCalcOnLoad: true };

  const wsRegras = wb.addWorksheet(ABAS[0]);
  const ws = wb.addWorksheet(ABAS[1]);
  const wr = wb.addWorksheet(ABAS[2]);
  const wc = wb.addWorksheet(ABAS[3]);
  const wz = wb.addWorksheet(ABAS[4]);
  const wp = wb.addWorksheet(ABAS[5]);

  // ============================================================ REGRAS DO EDITAL
  titulo(wsRegras, 1, `REGRAS DO EDITAL / TR COM IMPACTO NO CUSTO E NA PARTICIPAÇÃO — ${edital.numero}`, 4);
  cabecalho(wsRegras, 3, ["Tema", "Regra (fonte)", "Impacto no custo / risco", "Onde está na planilha"], [22, 70, 55, 26], 20);
  if (d.regras.length === 0) {
    escrever(wsRegras, 4, 1, "Nenhuma regra do edital registrada nesta simulação.", { borda: false, tamanho: 9 });
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
  const sn = (b: boolean) => (b ? "S" : "N");

  novaSecao("1. DADOS DO LICITANTE");
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
  premissa("localData", "Local e data da proposta", "", "", "PREENCHER (ex.: São Paulo, 28 de setembro de 2026).", undefined, true);

  novaSecao("2. PARÂMETROS DO CONTRATO");
  lista(ws, premissa("modo", "Modo de apuração (MENSAL ou PERIODO)", p.contrato.modo, "", "MENSAL: contrato por demanda (SRP, fretamento contínuo) — km de referência = km/mês máximo do edital, apuração mensal. PERIODO: escolar — km de referência = km do período letivo (km/dia × dias) e o custo fixo conta por 'meses de custo fixo'."), 2, ["MENSAL", "PERIODO"]);
  lista(ws, premissa("criterio", "Critério de julgamento (ITEM ou LOTE)", entrada.criterio, "", "LOTE: a proposta usa em todos os itens o preço médio do lote ponderado pelo km, arredondado para cima em 2 casas. ITEM: cada item com o seu preço."), 2, ["ITEM", "LOTE"]);
  premissa("meses", "Meses de custo fixo por apuração", p.contrato.mesesCustoFixo, "meses", "1 no MENSAL; 12 no escolar anual — a equipe e o veículo custam também nas férias.", INT);
  premissa("vigencia", "Vigência considerada", p.contrato.vigenciaMeses, "meses", "Anualiza o resultado mensal (Composição, Cenários e Proposta no modo MENSAL).", INT);
  premissa("util", "Utilização esperada do km de referência", p.contrato.utilizacao, "%", "Fração do km de referência efetivamente paga (SRP/demanda). 100% no escolar. Teste outras utilizações na aba Cenários.", PCT);
  premissa("kmMorto", "Km improdutivo (garagem ↔ ponto inicial, retornos vazios)", p.contrato.kmMortoPct, "% do km útil", "Km rodado = km útil × (1 + km improdutivo). Não é pago, mas consome diesel, pneus e manutenção.", PCT);
  premissa("reserva", "Reserva técnica de frota", p.contrato.reservaTecnicaPct, "% da frota", "Incide sobre capital, seguro, IPVA/laudo e telemetria (e sobre a garagem, se marcado na seção 4).", PCT);

  novaSecao("3. MÃO DE OBRA");
  premissa("salMot", "Salário base — motorista", p.pessoal.salarioMotorista, "R$/mês", "Conferir a CCT vigente da região.", BRL);
  premissa("salMon", "Salário base — monitora", p.pessoal.salarioMonitora, "R$/mês", "Só nas rotas com monitora (aba Rotas).", BRL);
  premissa("he", "Horas extras / adicional (média sobre o salário do motorista)", p.pessoal.horaExtraPct, "%", "Sábados, feriados, atrasos.", PCT);
  premissa("encargos", "Encargos e provisões (INSS, RAT, FGTS, férias + 1/3, 13º, rescisão)", p.pessoal.encargosPct, "% s/ salários", "Regime CLT, fora do Simples.", PCT);
  premissa("fatorNoturno", "Fator de jornada noturna / estendida", p.pessoal.fatorJornadaNoturna, "x", "Multiplica o salário do motorista nas rotas marcadas com noturno = S na aba Rotas.", NUM);
  premissa("beneficios", "Benefícios (VA/VR, cesta, seguro de vida, VT)", p.pessoal.beneficiosPorFuncionario, "R$/mês por func.", "Motoristas e monitoras.", BRL);
  premissa("epi", "Uniforme, EPI, exames e cursos", p.pessoal.uniformeEpiPorFuncionario, "R$/mês por func.", "Motoristas e monitoras.", BRL);
  premissa("supervisao", "Preposto / supervisão local (total)", p.pessoal.supervisaoMes, "R$/mês (total)", "Rateado entre os itens pelo km útil.", BRL);

  novaSecao("4. VEÍCULO (custo fixo mensal por veículo)");
  premissa("valorVeiculo", "Valor do veículo", p.veiculo.valor, "R$", "Valor de mercado (FIPE) ou contábil do veículo alocado.", BRL);
  premissa("depreciacao", "Depreciação anual", p.veiculo.depreciacaoAa, "% a.a.", "", PCT);
  premissa("capital", "Custo de capital / financiamento", p.veiculo.custoCapitalAa, "% a.a.", "Taxa média dos financiamentos da frota.", PCT);
  premissa("seguro", "Seguro (casco + RCF-V)", p.veiculo.seguroMes, "R$/mês por veíc.", "", BRL);
  premissa("ipva", "IPVA + licenciamento", p.veiculo.ipvaLicenciamentoAno, "R$/ano por veíc.", "", BRL);
  premissa("laudo", "Laudo, vistoria e inspeção", p.veiculo.laudoVistoriaAno, "R$/ano por veíc.", "", BRL);
  premissa("rastreador", "Rastreamento", p.veiculo.rastreadorMes, "R$/mês por veíc.", "", BRL);
  premissa("telemetria", "Telemetria adicional exigida pelo edital", p.veiculo.telemetriaExtraMes, "R$/mês por veíc.", "", BRL);
  premissa("embarque", "Sistema de controle de embarque", p.veiculo.controleEmbarqueMes, "R$/mês por veíc.", "", BRL);
  premissa("higienizacao", "Higienização", p.veiculo.higienizacaoMes, "R$/mês por veíc.", "Só sobre a frota operacional (sem reserva).", BRL);
  premissa("acessibilidade", "Acessibilidade / identificação visual", p.veiculo.acessibilidadeMes, "R$/mês por veíc.", "Só sobre a frota operacional (sem reserva).", BRL);
  premissa("garagem", "Garagem / base operacional", p.veiculo.garagemMes, "R$/mês por veíc.", "", BRL);
  lista(ws, premissa("garagemReserva", "Garagem cobrada também sobre a reserva técnica? (S/N)", sn(p.veiculo.garagemComReserva), "S/N", "S: a van reserva ocupa vaga e paga garagem. N: só a frota operacional."), 2, ["S", "N"]);

  novaSecao("5. INSUMOS VARIÁVEIS (por km rodado)");
  premissa("diesel", "Diesel — preço por litro", p.variaveis.dieselLitro, "R$/litro", "", BRL);
  premissa("consAsfalto", "Consumo em asfalto", p.variaveis.consumoAsfaltoKmL, "km/litro", "", NUM);
  premissa("consTerra", "Consumo em terra", p.variaveis.consumoTerraKmL, "km/litro", "Só usado nas rotas com km em terra.", NUM);
  premissa("arla", "ARLA 32", p.variaveis.arlaKm, "R$/km", "", BRL4);
  premissa("oleo", "Lubrificantes, lavagem e consumíveis", p.variaveis.oleoLavagemKm, "R$/km", "", BRL4);
  premissa("pneusAsfalto", "Pneus — asfalto", p.variaveis.pneusAsfaltoKm, "R$/km", "", BRL4);
  premissa("pneusTerra", "Pneus — terra", p.variaveis.pneusTerraKm, "R$/km", "", BRL4);
  premissa("manutAsfalto", "Manutenção — asfalto", p.variaveis.manutencaoAsfaltoKm, "R$/km", "", BRL4);
  premissa("manutTerra", "Manutenção — terra", p.variaveis.manutencaoTerraKm, "R$/km", "", BRL4);

  novaSecao("6. INDIRETOS, TRIBUTOS E LUCRO");
  premissa("adm", "Administração central", p.indiretos.administracaoPct, "% s/ custo direto", "", PCT);
  premissa("contingencia", "Contingência / risco", p.indiretos.contingenciaPct, "% s/ custo direto", "", PCT);
  premissa("lucro", "Lucro líquido desejado", p.preco.lucroAlvoPct, "% s/ preço", "Ajuste conforme a estratégia de lance (ver Cenários).", PCT);
  premissa("pis", "PIS", p.preco.pis, "% s/ fat.", "", PCT2);
  premissa("cofins", "COFINS", p.preco.cofins, "% s/ fat.", "", PCT2);
  premissa("irpj", "IRPJ", p.preco.irpj, "% s/ fat.", "", PCT2);
  premissa("csll", "CSLL", p.preco.csll, "% s/ fat.", "", PCT2);
  premissa("iss", "ISS (transporte municipal)", p.preco.iss, "% s/ fat. municipal", "", PCT2);
  premissa("icms", "ICMS (transporte intermunicipal)", p.preco.icms, "% s/ fat. intermunicipal", "", PCT2);
  const federais = `${P.pis}+${P.cofins}+${P.irpj}+${P.csll}`;
  derivada("tribMun", "Tributos totais — faturamento municipal", `${federais}+${P.iss}`, "%", "PIS + COFINS + IRPJ + CSLL + ISS", PCT2);
  derivada("tribInter", "Tributos totais — faturamento intermunicipal", `${federais}+${P.icms}`, "%", "PIS + COFINS + IRPJ + CSLL + ICMS", PCT2);
  premissa("prazo", "Prazo de recebimento", p.preco.prazoRecebimentoDias, "dias", "", INT);
  premissa("giro", "Custo do capital de giro", p.preco.custoCapitalGiroAm, "% a.m.", "", PCT2);
  derivada("fin", "Custo financeiro sobre faturamento", `${P.giro}*${P.prazo}/30`, "% s/ fat.", "Capital de giro × prazo de recebimento ÷ 30", PCT2);

  novaSecao("7. ITENS — parcela intermunicipal e tributos médios");
  itens.forEach((it) => {
    premissa(`share:${it.codigo}`, `Parcela intermunicipal do faturamento — Item ${it.codigo}`, it.shareIntermunicipal, "%", "Parte do faturamento do item sujeita a ICMS; o resto paga ISS.", PCT);
    derivada(
      `trib:${it.codigo}`,
      `Tributos médios — Item ${it.codigo}`,
      `${P.tribMun}*(1-${P[`share:${it.codigo}`]})+${P.tribInter}*${P[`share:${it.codigo}`]}`,
      "%",
      "Ponderado pela parcela intermunicipal",
      PCT2
    );
  });
  congelar(ws, 0, 4);

  // ============================================================ ROTAS
  // Uma linha por rota. Entradas em azul; as colunas P a U são as contas de
  // cada rota que não são lineares no item (fator noturno, asfalto × terra),
  // somadas por item na Composição.
  const colunasRotas = [
    ["Item", 7],
    ["Rota", 34],
    [mensal ? "Km/mês de referência (edital)" : "Km do período (edital)", 14],
    ["Dias/mês", 9],
    ["Km/dia", 10],
    ["Km terra/dia", 10],
    ["% terra", 9],
    ["Veículos operacionais", 11],
    ["Motoristas", 11],
    ["Monitoras", 11],
    ["Noturno? (S/N)", 10],
    ["Viagens/dia", 10],
    ["Passagens pedágio/mês", 12],
    ["Tarifa pedágio (R$)", 11],
    ["Pedágio R$/mês", 13],
    ["Km útil", 12],
    ["Km rodado (c/ km improdutivo)", 13],
    ["Salários (R$/mês, c/ HE e noturno)", 15],
    ["Diesel (R$)", 14],
    ["Pneus (R$)", 13],
    ["Manutenção (R$)", 14],
  ] as const;
  titulo(wr, 1, `ROTAS E QUANTITATIVOS — ${edital.numero}`, colunasRotas.length);
  nota(
    wr,
    2,
    (mensal
      ? "Km de referência = km/mês máximo do edital; km útil = referência × utilização (Premissas). "
      : "Km de referência = km do período letivo (km/dia × dias); km útil = referência × utilização (Premissas). ") +
      "Colunas A–N (azul) são dados do edital e do dimensionamento; O–U são fórmulas por rota: salários com o fator noturno, diesel, pneus e manutenção ponderados entre asfalto e terra. A Composição soma estas colunas por item.",
    colunasRotas.length
  );
  cabecalho(
    wr,
    4,
    colunasRotas.map((c) => c[0]),
    colunasRotas.map((c) => c[1]),
    44
  );
  const R0 = 5;
  const nRotas = Math.max(rotas.length, 1);
  const REND = R0 + nRotas - 1;
  const RTOT = REND + 1;
  rotas.forEach((r, i) => {
    const l = R0 + i;
    const e = (col: number, v: Valor, fmt?: string, quebra = false) => escrever(wr, l, col, v, { tipo: "entrada", fmt, quebra });
    const f = (col: number, formula: string, fmt: string) => escrever(wr, l, col, fx(formula), { fmt });
    e(1, r.item, undefined);
    e(2, r.nome, undefined, true);
    e(3, r.kmReferencia, INT);
    e(4, r.diasMes ?? null, INT);
    e(5, r.kmDia, NUM);
    e(6, r.kmTerraDia, NUM);
    f(7, `IF(E${l}>0,F${l}/E${l},0)`, PCT);
    e(8, r.veiculos, NUM);
    e(9, r.motoristas, NUM);
    e(10, r.monitoras, NUM);
    e(11, sn(r.noturno));
    lista(wr, l, 11, ["S", "N"]);
    e(12, r.viagensDia ?? null, NUM);
    e(13, r.passagensPedagioMes, NUM);
    e(14, r.tarifaPedagio, BRL);
    f(15, `M${l}*N${l}`, BRL);
    f(16, `C${l}*${P.util}`, INT);
    f(17, `P${l}*(1+${P.kmMorto})`, INT);
    f(18, `I${l}*${P.salMot}*(1+${P.he})*IF(K${l}="S",${P.fatorNoturno},1)+J${l}*${P.salMon}`, BRL);
    f(19, `${P.diesel}*((1-G${l})/${P.consAsfalto}+IF(G${l}>0,G${l}/${P.consTerra},0))*Q${l}`, BRL);
    f(20, `((1-G${l})*${P.pneusAsfalto}+G${l}*${P.pneusTerra})*Q${l}`, BRL);
    f(21, `((1-G${l})*${P.manutAsfalto}+G${l}*${P.manutTerra})*Q${l}`, BRL);
    wr.getRow(l).height = 30;
  });
  escrever(wr, RTOT, 2, "TOTAL", { negrito: true, fundo: FUNDO_TOTAL });
  for (const col of [1, 4, 5, 6, 7, 11, 12, 14]) escrever(wr, RTOT, col, null, { fundo: FUNDO_TOTAL });
  for (const [col, fmt] of [[3, INT], [8, NUM], [9, NUM], [10, NUM], [13, NUM], [15, BRL], [16, INT], [17, INT], [18, BRL], [19, BRL], [20, BRL], [21, BRL]] as const) {
    const L = letraColuna(col);
    escrever(wr, RTOT, col, fx(`SUM(${L}${R0}:${L}${REND})`), { negrito: true, fmt, fundo: FUNDO_TOTAL });
  }
  congelar(wr, 2, 4);

  // ============================================================ COMPOSIÇÃO DE CUSTO
  const nI = itens.length;
  const COL_TOTAL = nI + 2;
  const COL_MEMO = nI + 3;
  const T = letraColuna(COL_TOTAL);
  const colunaItem = (i: number) => letraColuna(i + 2);
  const primeira = colunaItem(0);
  const ultima = colunaItem(Math.max(nI - 1, 0));
  const unidade = mensal ? "R$/mês" : "R$/período";

  titulo(wc, 1, `COMPOSIÇÃO DE CUSTO POR ITEM (${mensal ? "mensal, na utilização esperada" : "no período, com o custo fixo de todos os meses"}) → CUSTO/KM → PREÇO/KM`, COL_MEMO);
  nota(
    wc,
    2,
    "Custos fixos independem do km faturado; por isso o custo/km sobe quando a utilização cai (ver Cenários). " +
      "Preço = custo/km ÷ (1 − lucro − tributos − custo financeiro), arredondado para cima em 2 casas." +
      (lote ? " Julgamento por LOTE: a coluna Lote dá o preço médio ponderado pelo km e o preço único da proposta." : ""),
    COL_MEMO
  );
  larguras(wc, [58, ...itens.map(() => 18), 20, 60]);
  cabecalho(wc, 4, ["Componente", ...itens.map((it) => `Item ${it.codigo} (${unidade})`), lote ? `Lote (${unidade})` : `Total (${unidade})`, "Memória de cálculo"], undefined, 30);

  // Linhas da composição. `item` dá a fórmula (ou o valor) de cada coluna de
  // item; `total`, a da coluna de total/lote. As chaves viram números de
  // linha depois, quando todas as linhas estão enfileiradas.
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
  const rot = (L: string) => `Rotas!$${L}$${R0}:$${L}$${REND}`;
  const somaSe = (L: string) => (c: string, _i: number, R: R) => `SUMIF(${rot("A")},${c}$${R.codigo},${rot(L)})`;
  const linhas: Linha[] = [
    { chave: "codigo", rotulo: "Código do item (chave na aba Rotas)", item: (_c, i) => itens[i].codigo, total: "vazio", tipo: "entrada", memo: "Soma as rotas cujo Item (Rotas, coluna A) é igual a este código." },
    { rotulo: "A. KM", secao: true },
    { chave: "kmref", rotulo: mensal ? "Km/mês de referência (máximo do edital)" : "Km do período (edital)", item: somaSe("C"), total: "soma", fmt: INT, memo: "Rotas col. C" },
    { chave: "kmfat", rotulo: `Km útil faturável no ${apuracao} (referência × utilização)`, item: somaSe("P"), total: "soma", fmt: INT, memo: "Rotas col. P" },
    { chave: "kmrod", rotulo: "Km rodado total (útil + km improdutivo)", item: somaSe("Q"), total: "soma", fmt: INT, memo: "Rotas col. Q = km útil × (1 + km improdutivo)" },
    { chave: "veic", rotulo: "Veículos operacionais", item: somaSe("H"), total: "soma", fmt: NUM, memo: "Rotas col. H" },
    { chave: "veicres", rotulo: "Veículos com reserva técnica", item: (c, _i, R) => `${c}${R.veic}*(1+${P.reserva})`, total: "soma", fmt: NUM, memo: "× (1 + reserva técnica)" },
    { chave: "mot", rotulo: "Motoristas", item: somaSe("I"), total: "soma", fmt: NUM, memo: "Rotas col. I" },
    { chave: "mon", rotulo: "Monitoras", item: somaSe("J"), total: "soma", fmt: NUM, memo: "Rotas col. J" },
    { rotulo: "B. MÃO DE OBRA (fixo mensal)", secao: true },
    { chave: "sal", rotulo: "Salários (motoristas c/ HE e fator noturno + monitoras)", item: somaSe("R"), total: "soma", memo: "Rotas col. R: motoristas × salário × (1+HE) × fator noturno + monitoras × salário" },
    { chave: "enc", rotulo: "Encargos e provisões", item: (c, _i, R) => `${c}${R.sal}*${P.encargos}`, total: "soma", memo: "salários × encargos" },
    { chave: "ben", rotulo: "Benefícios + uniforme/EPI/cursos", item: (c, _i, R) => `(${c}${R.mot}+${c}${R.mon})*(${P.beneficios}+${P.epi})`, total: "soma", memo: "(motoristas + monitoras) × (benefícios + EPI)" },
    { chave: "sup", rotulo: "Preposto / supervisão local (rateio por km útil)", item: (c, _i, R) => `IF(Rotas!$P$${RTOT}=0,0,${P.supervisao}*${c}${R.kmfat}/Rotas!$P$${RTOT})`, total: "soma", memo: "supervisão × km útil do item ÷ km útil de todas as rotas" },
    { chave: "mo", rotulo: "Subtotal mão de obra (mensal)", item: (c, _i, R) => `SUM(${c}${R.sal}:${c}${R.sup})`, total: "soma", negrito: true },
    { rotulo: "C. VEÍCULOS (fixo mensal, com reserva técnica)", secao: true },
    { chave: "dep", rotulo: "Depreciação + custo de capital", item: (c, _i, R) => `${c}${R.veicres}*${P.valorVeiculo}*(${P.depreciacao}+${P.capital})/12`, total: "soma", memo: "veíc. c/ reserva × valor × (depreciação + capital) ÷ 12" },
    { chave: "seg", rotulo: "Seguro", item: (c, _i, R) => `${c}${R.veicres}*${P.seguro}`, total: "soma", memo: "veíc. c/ reserva × seguro" },
    { chave: "ipva", rotulo: "IPVA / licenciamento + laudo/vistoria", item: (c, _i, R) => `${c}${R.veicres}*(${P.ipva}+${P.laudo})/12`, total: "soma", memo: "veíc. c/ reserva × (IPVA + laudo) ÷ 12" },
    { chave: "tel", rotulo: "Rastreamento + telemetria + controle de embarque", item: (c, _i, R) => `${c}${R.veicres}*(${P.rastreador}+${P.telemetria}+${P.embarque})`, total: "soma", memo: "veíc. c/ reserva × (rastreador + telemetria + embarque)" },
    { chave: "hig", rotulo: "Higienização + acessibilidade/identificação", item: (c, _i, R) => `${c}${R.veic}*(${P.higienizacao}+${P.acessibilidade})`, total: "soma", memo: "veíc. operacionais × (higienização + acessibilidade)" },
    { chave: "gar", rotulo: "Garagem / base operacional", item: (c, _i, R) => `IF(${P.garagemReserva}="S",${c}${R.veicres},${c}${R.veic})*${P.garagem}`, total: "soma", memo: "garagem com reserva (S) ou só frota operacional (N) — Premissas" },
    { chave: "veicm", rotulo: "Subtotal veículos (mensal)", item: (c, _i, R) => `SUM(${c}${R.dep}:${c}${R.gar})`, total: "soma", negrito: true },
    { rotulo: `D. CUSTO FIXO NO ${apuracao.toUpperCase()}`, secao: true },
    { chave: "fixo", rotulo: `Custo fixo no ${apuracao} (mão de obra + veículos) × meses de custo fixo`, item: (c, _i, R) => `(${c}${R.mo}+${c}${R.veicm})*${P.meses}`, total: "soma", negrito: true, memo: "(B + C) × meses de custo fixo (Premissas)" },
    { rotulo: `E. INSUMOS VARIÁVEIS (no ${apuracao})`, secao: true },
    { chave: "die", rotulo: "Diesel", item: somaSe("S"), total: "soma", memo: "Rotas col. S: km rodado × R$/l × (asfalto ÷ consumo asfalto + terra ÷ consumo terra)" },
    { chave: "arla", rotulo: "ARLA 32", item: (c, _i, R) => `${c}${R.kmrod}*${P.arla}`, total: "soma", memo: "km rodado × R$/km" },
    { chave: "oleo", rotulo: "Lubrificantes / lavagem", item: (c, _i, R) => `${c}${R.kmrod}*${P.oleo}`, total: "soma", memo: "km rodado × R$/km" },
    { chave: "pneus", rotulo: "Pneus", item: somaSe("T"), total: "soma", memo: "Rotas col. T: ponderado asfalto × terra" },
    { chave: "manut", rotulo: "Manutenção", item: somaSe("U"), total: "soma", memo: "Rotas col. U: ponderado asfalto × terra" },
    { chave: "ped", rotulo: "Pedágio", item: somaSe("O"), total: "soma", memo: "Rotas col. O: passagens × tarifa" },
    { chave: "var", rotulo: "Subtotal variáveis", item: (c, _i, R) => `SUM(${c}${R.die}:${c}${R.ped})`, total: "soma", negrito: true },
    { rotulo: "F. TOTAIS", secao: true },
    { chave: "dir", rotulo: "Custo direto", item: (c, _i, R) => `${c}${R.fixo}+${c}${R.var}`, total: "soma", memo: "D + E" },
    { chave: "ind", rotulo: "Administração central + contingência", item: (c, _i, R) => `${c}${R.dir}*(${P.adm}+${P.contingencia})`, total: "soma", memo: "custo direto × (adm + contingência)" },
    { chave: "tot", rotulo: `CUSTO TOTAL NO ${apuracao.toUpperCase()}`, item: (c, _i, R) => `${c}${R.dir}+${c}${R.ind}`, total: "soma", negrito: true },
    { chave: "ckm", rotulo: "Custo por km útil (R$/km)", item: (c, _i, R) => `IF(${c}${R.kmfat}=0,0,${c}${R.tot}/${c}${R.kmfat})`, total: (R) => `IF(${T}${R.kmfat}=0,0,${T}${R.tot}/${T}${R.kmfat})`, fmt: BRL4, negrito: true, memo: "custo total ÷ km útil" },
    { chave: "cfix", rotulo: "  do qual: custo fixo por km", item: (c, _i, R) => `IF(${c}${R.kmfat}=0,0,${c}${R.fixo}/${c}${R.kmfat})`, total: (R) => `IF(${T}${R.kmfat}=0,0,${T}${R.fixo}/${T}${R.kmfat})`, fmt: BRL4 },
    { chave: "cvar", rotulo: "  do qual: custo variável + indiretos por km", item: (c, _i, R) => `IF(${c}${R.kmfat}=0,0,(${c}${R.var}+${c}${R.ind})/${c}${R.kmfat})`, total: (R) => `IF(${T}${R.kmfat}=0,0,(${T}${R.var}+${T}${R.ind})/${T}${R.kmfat})`, fmt: BRL4 },
    { rotulo: "G. PREÇO", secao: true },
    { chave: "trb", rotulo: "Tributos sobre faturamento (média do item)", item: (_c, i) => P[`trib:${itens[i].codigo}`], tipo: "link", total: "ponderado", fmt: PCT2, memo: "Premissas seção 7; no total, ponderado pelo faturamento" },
    { chave: "fin", rotulo: "Custo financeiro (prazo de recebimento)", item: () => P.fin, tipo: "link", total: "ponderado", fmt: PCT2, memo: "Premissas" },
    { chave: "luc", rotulo: "Lucro líquido alvo", item: () => P.lucro, tipo: "link", total: "ponderado", fmt: PCT, memo: "Premissas" },
    { chave: "pkm", rotulo: "PREÇO/KM CALCULADO (R$/km)", item: (c, _i, R) => `IF(${c}${R.kmfat}=0,0,ROUNDUP(${c}${R.ckm}/(1-${c}${R.luc}-${c}${R.trb}-${c}${R.fin}),2))`, total: (R) => `IF(${T}${R.kmfat}=0,0,${T}${R.fat}/${T}${R.kmfat})`, fmt: BRL, negrito: true, destaque: true, memo: `custo/km ÷ (1 − lucro − tributos − financeiro), 2 casas para cima; na coluna ${lote ? "Lote" : "Total"}: média ponderada pelo km (faturamento ÷ km útil)` },
    { chave: "pmax", rotulo: "Preço máximo do edital (R$/km)", item: (_c, i) => itens[i].precoMaximoKm ?? null, tipo: "entrada", total: "vazio", fmt: BRL, memo: "edital (vazio = sem teto)" },
    { chave: "folga", rotulo: "Folga vs. preço máximo", item: (c, _i, R) => `IF(N(${c}${R.pmax})=0,"",${c}${R.pkm}/${c}${R.pmax}-1)`, total: "vazio", fmt: DPCT, memo: "negativo = abaixo do teto" },
    { chave: "teto", rotulo: "Situação frente ao preço máximo", item: (c, _i, R) => `IF(N(${c}${R.pmax})=0,"sem teto",IF(${c}${R.pkm}>${c}${R.pmax},"ACIMA DO TETO","dentro do teto"))`, total: "vazio", memo: lote ? "no lote vale o preço único; item isolado acima do teto só fecha subsidiado pelos outros" : "" },
    { chave: "pref", rotulo: "Preço de referência (R$/km)", item: (_c, i) => itens[i].precoReferenciaKm ?? null, tipo: "entrada", total: "vazio", fmt: BRL, memo: "estimativa do órgão / lances de referência (vazio = não há)" },
    { chave: "dref", rotulo: "Δ vs. preço de referência", item: (c, _i, R) => `IF(N(${c}${R.pref})=0,"",${c}${R.pkm}/${c}${R.pref}-1)`, total: "vazio", fmt: DPCT, memo: "positivo = acima da referência" },
    { chave: "pmin", rotulo: "Preço mínimo para lucro zero (R$/km)", item: (c, _i, R) => `${c}${R.ckm}/(1-${c}${R.trb}-${c}${R.fin})`, total: (R) => `${T}${R.ckm}/(1-${T}${R.trb}-${T}${R.fin})`, fmt: BRL4, memo: "piso de exequibilidade: custo/km ÷ (1 − tributos − financeiro)" },
    { chave: "fat", rotulo: `Faturamento no ${apuracao} ao preço calculado`, item: (c, _i, R) => `${c}${R.pkm}*${c}${R.kmfat}`, total: "soma", memo: "preço/km × km útil" },
    { chave: "lucm", rotulo: `Lucro líquido no ${apuracao}`, item: (c, _i, R) => `${c}${R.fat}*(1-${c}${R.trb}-${c}${R.fin})-${c}${R.tot}`, total: "soma", negrito: true, memo: "faturamento × (1 − tributos − financeiro) − custo total" },
    { chave: "marg", rotulo: "Margem líquida", item: (c, _i, R) => `IF(${c}${R.fat}=0,0,${c}${R.lucm}/${c}${R.fat})`, total: (R) => `IF(${T}${R.fat}=0,0,${T}${R.lucm}/${T}${R.fat})`, fmt: PCT, memo: "lucro ÷ faturamento" },
    { chave: "fata", rotulo: "Faturamento anual", item: (c, _i, R) => `${c}${R.fat}*IF(${P.modo}="MENSAL",${P.vigencia},1)`, total: "soma", memo: "MENSAL: × vigência; PERIODO: o período já é o ano letivo" },
    { chave: "luca", rotulo: "Lucro líquido anual", item: (c, _i, R) => `${c}${R.lucm}*IF(${P.modo}="MENSAL",${P.vigencia},1)`, total: "soma", negrito: true, memo: "idem" },
    { rotulo: lote ? "H. LOTE — PREÇO ÚNICO DA PROPOSTA" : "H. PREÇO DA PROPOSTA", secao: true },
    {
      chave: "pprop",
      rotulo: "Preço proposto (R$/km)",
      item: (c, _i, R) => `IF(${P.criterio}="LOTE",$${T}$${R.pprop},${c}${R.pkm})`,
      total: (R) => `ROUNDUP(${T}${R.pkm},2)`,
      fmt: BRL,
      negrito: true,
      destaque: true,
      memo: `LOTE: preço médio do lote arredondado para cima em 2 casas, igual em todos os itens; ITEM: o preço de cada item. Na coluna ${lote ? "Lote" : "Total"}: a média ponderada arredondada para cima`,
    },
    { chave: "fatp", rotulo: `Faturamento no ${apuracao} ao preço proposto`, item: (c, _i, R) => `${c}${R.pprop}*${c}${R.kmfat}`, total: "soma", memo: "preço proposto × km útil" },
    { chave: "lucp", rotulo: `Lucro líquido no ${apuracao} ao preço proposto`, item: (c, _i, R) => `${c}${R.fatp}*(1-${c}${R.trb}-${c}${R.fin})-${c}${R.tot}`, total: (R) => `${T}${R.fatp}*(1-${T}${R.trb}-${T}${R.fin})-${T}${R.tot}`, negrito: true, memo: "no total, com os tributos ponderados pelo faturamento ao preço calculado (linha de tributos)" },
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
      const v = ln.item!(c, i, RC);
      const tipo = ln.tipo ?? "formula";
      const valor: Valor = tipo === "entrada" ? v : typeof v === "string" ? fx(v) : v;
      escrever(wc, l, i + 2, valor, {
        tipo,
        negrito: ln.negrito,
        fmt: ln.fmt ?? BRL,
        fundo: ln.destaque ? FUNDO_PREENCHER : undefined,
        alinhar: ln.chave === "codigo" ? { horizontal: "center" } : undefined,
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

  // ============================================================ CENÁRIOS
  const utilizacoes = entrada.utilizacoesCenario ?? [0.6, 0.7, 0.8, 0.85, 0.9, 1];
  const nU = utilizacoes.length;
  const COLS_Z = nU + 1;
  titulo(wz, 1, "CENÁRIOS — sensibilidade do preço/km à utilização do km de referência e lucro obtido ao preço de teste", Math.max(COLS_Z, 9));
  nota(
    wz,
    2,
    "O custo fixo não muda com o km pago; o variável acompanha o km rodado e o pedágio acompanha a utilização. A tabela mostra o preço/km necessário para o lucro alvo, o piso de lucro zero e o lucro real ao preço de teste (B4), por utilização. Fórmulas usam os totais da aba Composição de Custo.",
    Math.max(COLS_Z, 9)
  );
  larguras(wz, [34, ...utilizacoes.map(() => 15)]);
  escrever(wz, 4, 1, "Preço/km a lançar (teste)", { negrito: true });
  escrever(wz, 4, 2, resultado.cenarios.precoTesteKm, { tipo: "entrada", fmt: BRL, fundo: FUNDO_PREENCHER });
  escrever(wz, 4, 3, lote ? "← edite para simular o lance (lote: mesmo preço em todos os itens)" : "← edite para simular o lance (preço médio sobre todos os itens)", {
    tamanho: 9,
    borda: false,
  });
  cabecalho(wz, 6, [`Utilização do km de referência`, ...utilizacoes.map(() => "")], undefined, 20);
  utilizacoes.forEach((u, j) => {
    const c = wz.getCell(6, j + 2);
    c.value = u;
    c.numFmt = "0%";
    c.font = { name: FONTE, size: 10, bold: true, color: { argb: BRANCO } };
  });
  const liq = `(1-${CC("trb")}-${P.fin})`;
  const ind = `(${P.adm}+${P.contingencia})`;
  const varKm = `IF(${CC("kmrod")}=0,0,(${CC("var")}-${CC("ped")})/${CC("kmrod")})`;
  const anual = `IF(${P.modo}="MENSAL",${P.vigencia},1)`;
  const mesesApuracao = `IF(${P.modo}="MENSAL",1,${P.meses})`;
  const cenarios: [string, ((c: string) => string) | null, string][] = [
    [`Km útil faturável no ${apuracao}`, (c) => `${CC("kmref")}*${c}$6`, INT],
    [`Custo total no ${apuracao} (R$)`, (c) => `(${CC("fixo")}+${varKm}*${c}7*(1+${P.kmMorto})+${CC("ped")}*${c}$6)*(1+${ind})`, BRL],
    ["Custo por km útil (R$/km)", (c) => `IF(${c}7=0,0,${c}8/${c}7)`, BRL4],
    ["Preço/km p/ lucro alvo (R$/km)", (c) => `IF(${c}7=0,0,ROUNDUP(${c}9/(1-${P.lucro}-${CC("trb")}-${P.fin}),2))`, BRL],
    ["Preço/km lucro zero (R$/km)", (c) => `${c}9/${liq}`, BRL4],
    ["— Ao preço de teste (B4) —", null, ""],
    [`Faturamento no ${apuracao} (R$)`, (c) => `$B$4*${c}7`, BRL],
    [`Lucro líquido no ${apuracao} (R$)`, (c) => `${c}13*${liq}-${c}8`, BRL],
    ["Margem líquida", (c) => `IF(${c}13=0,0,${c}14/${c}13)`, DPCT],
    ["Lucro líquido / ano (R$)", (c) => `${c}14*${anual}`, BRL],
    ["Lucro / veículo / mês (R$)", (c) => `IF(${CC("veic")}*${mesesApuracao}=0,0,${c}14/(${CC("veic")}*${mesesApuracao}))`, BRL],
  ];
  cenarios.forEach(([rotulo, formula, fmt], k) => {
    const l = 7 + k;
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
  // Lucro(u) é linear em u: o equilíbrio é o u que o zera.
  const inclinacao = `($B$4*${CC("kmref")}*${liq}-(${varKm}*${CC("kmref")}*(1+${P.kmMorto})+${CC("ped")})*(1+${ind}))`;
  escrever(wz, 19, 1, "Ponto de equilíbrio (utilização com lucro zero ao preço de teste)", { negrito: true });
  escrever(wz, 19, 2, fx(`IF(${inclinacao}>0,${CC("fixo")}*(1+${ind})/${inclinacao},"não empata")`), { negrito: true, fmt: PCT });
  nota(
    wz,
    21,
    mensal
      ? "Leitura: a coluna 100% é o km máximo do edital. Se o lucro ficar negativo nas utilizações baixas, o lance está exposto ao risco de ociosidade (SRP paga só o km útil)."
      : "Leitura: no escolar a utilização é normalmente 100% (km do período letivo). As colunas menores mostram o efeito de dias letivos a menos ou linhas suspensas.",
    Math.max(COLS_Z, 9)
  );
  congelar(wz, 1, 6);

  // ============================================================ PROPOSTA
  larguras(wp, [15, 62, 14, 14, 16, 18]);
  titulo(wp, 1, `PROPOSTA DE PREÇOS — ${edital.numero} — ${edital.orgao} — ${edital.municipio}/${edital.uf}`, 6);
  nota(wp, 2, `Objeto: ${edital.objeto}`, 6, 40);
  secao(wp, 4, "DADOS DO LICITANTE", 6);
  const dadosLicitante: [string, string][] = [
    ["Licitante:", `${P.razao}&"  —  CNPJ "&${P.cnpj}`],
    // `&""`: premissa vazia aparece vazia, e não como 0.
    ["Endereço:", `${P.endereco}&""`],
    ["Representante:", `${P.representante}&""`],
  ];
  dadosLicitante.forEach(([rotulo, formula], k) => {
    escrever(wp, 5 + k, 1, rotulo, { negrito: true, borda: false });
    wp.mergeCells(5 + k, 2, 5 + k, 6);
    escrever(wp, 5 + k, 2, fx(formula), { tipo: "link", borda: false });
  });
  const QUANT = mensal ? "Quant. km (vigência)" : "Quant. km (período)";
  cabecalho(wp, 9, ["Item", "Descrição do serviço", QUANT, "Preço máx. (R$/km)", "Preço proposto (R$/km)", "Valor total (R$)"], undefined, 30);
  const P0 = 10;
  const TOPO: Partial<ExcelJS.Alignment> = { vertical: "top" };
  itens.forEach((it, i) => {
    const l = P0 + i;
    const c = colunaItem(i);
    escrever(wp, l, 1, it.codigo, { tipo: "texto", alinhar: { horizontal: "center", vertical: "top" } });
    escrever(wp, l, 2, it.descricao, { quebra: true });
    escrever(wp, l, 3, fx(`'Composição de Custo'!${c}${RC.kmfat}*IF(${P.modo}="MENSAL",${P.vigencia},1)`), { tipo: "link", fmt: INT, alinhar: TOPO });
    escrever(wp, l, 4, fx(`IF(N('Composição de Custo'!${c}${RC.pmax})=0,"",'Composição de Custo'!${c}${RC.pmax})`), { tipo: "link", fmt: BRL, alinhar: TOPO });
    escrever(wp, l, 5, fx(`'Composição de Custo'!${c}${RC.pprop}`), { tipo: "link", fmt: BRL, fundo: FUNDO_PREENCHER, alinhar: TOPO });
    escrever(wp, l, 6, fx(`C${l}*E${l}`), { fmt: BRL, alinhar: TOPO });
    wp.getRow(l).height = it.descricao.length > 70 ? 42 : 30;
  });
  const PEND = P0 + Math.max(nI, 1) - 1;
  let lp2 = PEND + 1;
  const linhaTotal = (rotulo: string, formula: string, fmt: string, negrito: boolean) => {
    for (let col = 1; col <= 6; col++) escrever(wp, lp2, col, null, { fundo: FUNDO_TOTAL });
    escrever(wp, lp2, 2, rotulo, { negrito, fundo: FUNDO_TOTAL, alinhar: { horizontal: "right" } });
    escrever(wp, lp2, 6, fx(formula), { negrito, fmt, fundo: FUNDO_TOTAL });
    return lp2++;
  };
  const lTotal = linhaTotal(
    `VALOR TOTAL DA PROPOSTA${lote ? " (LOTE)" : ""}${mensal ? ` — ${p.contrato.vigenciaMeses} meses` : ""}`,
    `SUM(F${P0}:F${PEND})`,
    BRL,
    true
  );
  if (itens.some((it) => it.precoMaximoKm)) {
    const lMax = linhaTotal("Valor máximo do edital (na mesma quantidade)", `SUMPRODUCT(C${P0}:C${PEND},D${P0}:D${PEND})`, BRL, false);
    linhaTotal("Desconto sobre o valor máximo", `IF(F${lMax}=0,0,1-F${lTotal}/F${lMax})`, PCT, false);
  }
  lp2++;
  const orgaoCaixa = edital.orgao.toUpperCase();
  const declaracoes = [
    `CONDIÇÃO DE PAGAMENTO: ${p.preco.prazoRecebimentoDias} dias, após a liquidação e aceite pelos gestores do contrato, conforme o edital.`,
    "VALIDADE DA PROPOSTA: 60 (SESSENTA) DIAS.",
    "Os valores que ultrapassarem 02 (duas) casas decimais após a vírgula serão desconsiderados para fins de apuração do preço final.",
    ...(lote
      ? [
          "JULGAMENTO POR LOTE: o preço proposto é o preço médio do lote ponderado pelo km, arredondado para cima em 2 casas, igual em todos os itens. Confira o lucro a cada utilização na aba Cenários.",
        ]
      : []),
    `DECLARAMOS QUE estamos de acordo com os termos do Edital, e acatamos suas determinações, bem como informamos que nos preços propostos estão inclusos todos os custos diretos e indiretos, tributos, pedágios, seguros, lucros e demais contribuições pertinentes de nossa responsabilidade, sem qualquer exceção, constituindo-se os referidos preços unitários nas únicas contraprestações do(a) ${orgaoCaixa} pelas efetivas prestações dos serviços, sob nossa conta e risco.`,
    "DECLARAMOS QUE os serviços ofertados atendem a todas as condições fixadas nas normas técnicas especificadas no edital.",
    `DECLARAMOS QUE nenhum direito a indenização ou a reembolso de quaisquer despesas nos será devido, caso nossa proposta não seja aceita pelo(a) ${orgaoCaixa}.`,
    "DECLARAMOS QUE CONCORDAMOS integralmente com as condições estipuladas na presente licitação e, que caso vencedores, nos submeteremos ao cumprimento de seus termos.",
  ];
  for (const t of declaracoes) {
    nota(wp, lp2, t, 6, t.length < 120 ? 15 : 42);
    lp2++;
  }
  lp2++;
  const centro = (formula: Valor, tipo: Tipo) => {
    wp.mergeCells(lp2, 1, lp2, 6);
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

  const bytes = await wb.xlsx.writeBuffer();
  return Buffer.from(bytes as ArrayBuffer);
}
