// Modelo de proposta técnica e comercial — Azul Mob.
// Campos a preencher aparecem como «campo», com marca-texto amarelo.
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, Header, Footer,
  AlignmentType, BorderStyle, WidthType, ShadingType, VerticalAlign, PageNumber, LevelFormat,
  TableLayoutType,
} = require("docx");

const IMG = path.join(__dirname, "img");
const img = (f) => fs.readFileSync(path.join(IMG, f));

const AZUL = "2B448F";
const AZUL_2 = "5068A0";
const NAVY = "0B1B45";
const CINZA = "94A2AA";
const TEXTO = "1F2937";
const TEXTO_2 = "4B5563";
const FUNDO = "F2F4FA";
const LINHA = "D6DBE8";
const FONTE = "Arial";

// A4, margens de 2 cm.
const PAG = { w: 11906, h: 16838 };
const MARG = 1134;
const LARG = PAG.w - 2 * MARG; // 9638 DXA
const PX = (dxa) => Math.round((dxa / 1440) * 96);

// ---------- texto ----------
// "texto «campo» **negrito**" → runs; «campo» vai com marca-texto amarelo.
function runs(texto, o = {}) {
  const partes = String(texto).split(/(«[^»]*»|\*\*[^*]+\*\*)/).filter((x) => x !== "");
  return partes.map((p) => {
    const base = { font: FONTE, size: o.size ?? 20, color: o.color ?? TEXTO, bold: o.bold, italics: o.italics, allCaps: o.allCaps, characterSpacing: o.spacing };
    if (p.startsWith("«")) return new TextRun({ ...base, text: p, highlight: o.semMarca ? undefined : "yellow" });
    if (p.startsWith("**")) return new TextRun({ ...base, text: p.slice(2, -2), bold: true });
    return new TextRun({ ...base, text: p });
  });
}
const P = (texto, o = {}) =>
  new Paragraph({
    children: runs(texto, o),
    alignment: o.align ?? AlignmentType.LEFT,
    spacing: { before: o.before ?? 0, after: o.after ?? 120, line: o.line ?? 288 },
    keepNext: o.keepNext,
    pageBreakBefore: o.quebra,
    indent: o.indent,
    border: o.border,
  });
const vazio = (after = 120) => new Paragraph({ children: [], spacing: { before: 0, after } });

let secao = 0;
function titulo(texto, o = {}) {
  secao++;
  return [
    new Paragraph({
      pageBreakBefore: o.quebra,
      keepNext: true,
      spacing: { before: o.quebra ? 0 : 360, after: 60 },
      children: [
        new TextRun({ text: String(secao).padStart(2, "0"), font: FONTE, size: 20, bold: true, color: AZUL_2, characterSpacing: 20 }),
      ],
    }),
    new Paragraph({
      keepNext: true,
      spacing: { before: 0, after: 200 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: AZUL, space: 6 } },
      children: [new TextRun({ text: texto, font: FONTE, size: 32, bold: true, color: NAVY })],
    }),
  ];
}
const subtitulo = (texto, o = {}) =>
  new Paragraph({
    keepNext: true,
    spacing: { before: o.before ?? 240, after: 100 },
    children: [new TextRun({ text: texto, font: FONTE, size: 22, bold: true, color: AZUL })],
  });
const item = (texto, o = {}) =>
  new Paragraph({
    numbering: { reference: "marcador", level: 0 },
    children: runs(texto, o),
    spacing: { before: 0, after: 80, line: 276 },
  });
const clausula = (num, rotulo, texto) =>
  new Paragraph({
    spacing: { before: 0, after: 110, line: 288 },
    indent: { left: 567, hanging: 567 },
    children: [
      new TextRun({ text: `${num}\t`, font: FONTE, size: 20, bold: true, color: AZUL }),
      new TextRun({ text: `${rotulo}. `, font: FONTE, size: 20, bold: true, color: TEXTO }),
      ...runs(texto.charAt(0).toUpperCase() + texto.slice(1)),
    ],
    tabStops: [{ type: "left", position: 567 }],
  });

// ---------- tabelas ----------
const SEM = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const SEM_BORDAS = { top: SEM, bottom: SEM, left: SEM, right: SEM, insideHorizontal: SEM, insideVertical: SEM };
const fina = (cor = LINHA) => ({ style: BorderStyle.SINGLE, size: 4, color: cor });

function celula(conteudo, largura, o = {}) {
  const filhos = Array.isArray(conteudo) ? conteudo : [P(conteudo, { after: 0, line: 264, size: o.size ?? 18, bold: o.bold, color: o.color, align: o.align })];
  return new TableCell({
    width: { size: largura, type: WidthType.DXA },
    shading: o.fundo ? { fill: o.fundo, type: ShadingType.CLEAR, color: "auto" } : undefined,
    margins: { top: o.mt ?? 70, bottom: o.mb ?? 70, left: o.ml ?? 110, right: o.mr ?? 110 },
    verticalAlign: o.valign ?? VerticalAlign.CENTER,
    columnSpan: o.span,
    borders: o.borders,
    children: filhos,
  });
}

// Tabela de dados: cabeçalho azul, zebra, linha de total opcional.
function tabela(colunas, linhas, o = {}) {
  const larguras = colunas.map((c) => c.w);
  const total = larguras.reduce((a, b) => a + b, 0);
  const cab = new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: colunas.map((c) => celula(c.t, c.w, { fundo: AZUL, color: "FFFFFF", bold: true, size: 17, align: c.align })),
  });
  const corpo = linhas.map((l, i) =>
    new TableRow({
      cantSplit: true,
      children: l.map((v, j) => celula(v, larguras[j], { fundo: i % 2 ? FUNDO : undefined, align: colunas[j].align, size: 18 })),
    }),
  );
  const extra = (o.total ?? []).map((l) =>
    new TableRow({
      cantSplit: true,
      children: l.cells.map((v, j) => celula(v.t, v.w, { fundo: "E3E8F4", bold: true, align: v.align, size: 18, span: v.span })),
    }),
  );
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: larguras,
    layout: TableLayoutType.FIXED,
    borders: { top: fina(), bottom: fina(), left: SEM, right: SEM, insideHorizontal: fina(), insideVertical: SEM },
    rows: [cab, ...corpo, ...extra],
  });
}

// Pares rótulo / valor (briefing, dados da empresa).
function ficha(pares, wRotulo = 3000) {
  const wValor = LARG - wRotulo;
  return new Table({
    width: { size: LARG, type: WidthType.DXA },
    columnWidths: [wRotulo, wValor],
    layout: TableLayoutType.FIXED,
    borders: { top: fina(), bottom: fina(), left: SEM, right: SEM, insideHorizontal: fina(), insideVertical: SEM },
    rows: pares.map(([r, v]) =>
      new TableRow({
        cantSplit: true,
        children: [celula(r, wRotulo, { fundo: FUNDO, bold: true, color: NAVY, size: 18 }), celula(v, wValor, { size: 18 })],
      }),
    ),
  });
}

// Destaques numéricos em blocos.
function destaques(blocos, o = {}) {
  const n = blocos.length;
  const gap = 120;
  const w = Math.floor((LARG - gap * (n - 1)) / n);
  const larguras = [];
  blocos.forEach((_, i) => { larguras.push(w); if (i < n - 1) larguras.push(gap); });
  const resto = LARG - larguras.reduce((a, b) => a + b, 0);
  larguras[larguras.length - 1] += resto;
  const cells = [];
  blocos.forEach((b, i) => {
    cells.push(
      celula(
        [
          P(b.valor, { size: o.tamanho ?? 30, bold: true, color: o.escuro ? "FFFFFF" : AZUL, after: 40, line: 240, semMarca: false }),
          P(b.rotulo, { size: 16, color: o.escuro ? "DCE3F3" : TEXTO_2, after: 0, line: 252 }),
        ],
        larguras[cells.length],
        { fundo: o.escuro ? AZUL : FUNDO, mt: 160, mb: 160, ml: 160, mr: 120, valign: VerticalAlign.TOP },
      ),
    );
    if (i < n - 1) cells.push(celula([vazio(0)], gap, {}));
  });
  return new Table({
    width: { size: LARG, type: WidthType.DXA },
    columnWidths: larguras,
    layout: TableLayoutType.FIXED,
    borders: SEM_BORDAS,
    rows: [new TableRow({ cantSplit: true, children: cells })],
  });
}

// Cartões em grade (diferenciais): título azul + texto, com filete à esquerda.
function cartoes(lista, colunas = 2) {
  const gap = 240;
  const w = Math.floor((LARG - gap * (colunas - 1)) / colunas);
  const larguras = [];
  for (let i = 0; i < colunas; i++) { larguras.push(w); if (i < colunas - 1) larguras.push(gap); }
  larguras[larguras.length - 1] += LARG - larguras.reduce((a, b) => a + b, 0);
  const linhas = [];
  for (let i = 0; i < lista.length; i += colunas) {
    const cells = [];
    for (let j = 0; j < colunas; j++) {
      const c = lista[i + j];
      const conteudo = c
        ? [P(c.titulo, { bold: true, color: NAVY, size: 21, after: 60 }), ...c.texto.map((t, k) => P(t, { size: 18, color: TEXTO_2, after: k === c.texto.length - 1 ? 0 : 60, line: 276 }))]
        : [vazio(0)];
      cells.push(
        celula(conteudo, larguras[cells.length], {
          fundo: c ? FUNDO : undefined, mt: 160, mb: 160, ml: 200, mr: 160, valign: VerticalAlign.TOP,
          borders: c ? { left: { style: BorderStyle.SINGLE, size: 24, color: AZUL }, top: SEM, bottom: SEM, right: SEM } : undefined,
        }),
      );
      if (j < colunas - 1) cells.push(celula([vazio(0)], gap, {}));
    }
    linhas.push(new TableRow({ cantSplit: true, children: cells }));
    if (i + colunas < lista.length) linhas.push(new TableRow({ children: larguras.map((lw) => celula([vazio(0)], lw, { mt: 60, mb: 60 })) }));
  }
  return new Table({ width: { size: LARG, type: WidthType.DXA }, columnWidths: larguras, layout: TableLayoutType.FIXED, borders: SEM_BORDAS, rows: linhas });
}

// Foto com legenda, em grade.
function fotos(lista, ratio = 1) {
  const gap = 160;
  const n = lista.length;
  const w = Math.floor((LARG - gap * (n - 1)) / n);
  const larguras = [];
  lista.forEach((_, i) => { larguras.push(w); if (i < n - 1) larguras.push(gap); });
  larguras[larguras.length - 1] += LARG - larguras.reduce((a, b) => a + b, 0);
  const cells = [];
  lista.forEach((f, i) => {
    const px = PX(w);
    cells.push(
      celula(
        [
          new Paragraph({ spacing: { after: 80 }, children: [new ImageRun({ type: "jpg", data: img(f.arquivo), transformation: { width: px, height: Math.round(px / ratio) } })] }),
          P(f.titulo, { bold: true, size: 18, color: NAVY, after: 20 }),
          ...(f.texto ? [P(f.texto, { size: 16, color: TEXTO_2, after: 0, line: 252 })] : []),
        ],
        larguras[cells.length],
        { ml: 0, mr: 0, mt: 0, mb: 0, valign: VerticalAlign.TOP },
      ),
    );
    if (i < n - 1) cells.push(celula([vazio(0)], gap, {}));
  });
  return new Table({ width: { size: LARG, type: WidthType.DXA }, columnWidths: larguras, layout: TableLayoutType.FIXED, borders: SEM_BORDAS, rows: [new TableRow({ cantSplit: true, children: cells })] });
}

// Cartões da frota: foto + nome + capacidade.
function frota(lista) {
  const colunas = 3;
  const gap = 160;
  const w = Math.floor((LARG - gap * (colunas - 1)) / colunas);
  const larguras = [];
  for (let i = 0; i < colunas; i++) { larguras.push(w); if (i < colunas - 1) larguras.push(gap); }
  larguras[larguras.length - 1] += LARG - larguras.reduce((a, b) => a + b, 0);
  const linhas = [];
  for (let i = 0; i < lista.length; i += colunas) {
    const cells = [];
    for (let j = 0; j < colunas; j++) {
      const v = lista[i + j];
      const px = PX(w) - 8;
      cells.push(
        celula(
          v
            ? [
                new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new ImageRun({ type: "jpg", data: img(v.arquivo), transformation: { width: px, height: Math.round(px / 1.6) } })] }),
                P(v.nome, { bold: true, size: 19, color: NAVY, after: 20, align: AlignmentType.CENTER }),
                P(v.capacidade, { size: 17, color: AZUL, after: 20, align: AlignmentType.CENTER }),
                P(v.detalhe, { size: 16, color: TEXTO_2, after: 0, align: AlignmentType.CENTER, line: 252 }),
              ]
            : [vazio(0)],
          larguras[cells.length],
          { mt: 60, mb: 140, ml: 40, mr: 40, valign: VerticalAlign.TOP, borders: v ? { top: fina(), bottom: fina(), left: fina(), right: fina() } : undefined },
        ),
      );
      if (j < colunas - 1) cells.push(celula([vazio(0)], gap, {}));
    }
    linhas.push(new TableRow({ cantSplit: true, children: cells }));
    if (i + colunas < lista.length) linhas.push(new TableRow({ children: larguras.map((lw) => celula([vazio(0)], lw, { mt: 40, mb: 40 })) }));
  }
  return new Table({ width: { size: LARG, type: WidthType.DXA }, columnWidths: larguras, layout: TableLayoutType.FIXED, borders: SEM_BORDAS, rows: linhas });
}

// Quadro de destaque (nota).
function quadro(tituloQ, paragrafos, o = {}) {
  return new Table({
    width: { size: LARG, type: WidthType.DXA },
    columnWidths: [LARG],
    borders: SEM_BORDAS,
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          celula(
            [P(tituloQ, { bold: true, color: o.escuro ? "FFFFFF" : NAVY, size: 20, after: 80 }), ...paragrafos.map((t, i) => P(t, { size: 18, semMarca: o.escuro, color: o.escuro ? "E5EAF6" : TEXTO, after: i === paragrafos.length - 1 ? 0 : 80, line: 276 }))],
            LARG,
            { fundo: o.escuro ? NAVY : "EEF2FB", mt: 200, mb: 200, ml: 240, mr: 240, borders: o.escuro ? undefined : { left: { style: BorderStyle.SINGLE, size: 24, color: AZUL }, top: SEM, bottom: SEM, right: SEM } },
          ),
        ],
      }),
    ],
  });
}

// ---------- cabeçalho e rodapé (papel timbrado) ----------
const logoW = 128;
const logoH = Math.round(logoW * (331 / 698));
const cabecalho = new Header({
  children: [
    new Table({
      width: { size: LARG, type: WidthType.DXA },
      columnWidths: [2600, LARG - 2600],
      layout: TableLayoutType.FIXED,
      borders: SEM_BORDAS,
      rows: [
        new TableRow({
          children: [
            celula([new Paragraph({ children: [new ImageRun({ type: "png", data: img("atual-solida-azul.png"), transformation: { width: logoW, height: logoH } })] })], 2600, { ml: 0, mt: 0, mb: 0 }),
            celula(
              [
                P("AZUL TRANSPORTES E TURISMO LTDA", { bold: true, size: 17, color: NAVY, align: AlignmentType.RIGHT, after: 20, line: 240 }),
                P("CNPJ 10.764.533/0001-01  ·  I.E. 148.641.381.119  ·  I.M. 3.905.347-4", { size: 14, color: TEXTO_2, align: AlignmentType.RIGHT, after: 20, line: 240 }),
                P("Proposta «AZ-2026-000» · «Nome do cliente»", { size: 14, color: AZUL, align: AlignmentType.RIGHT, after: 0, line: 240 }),
              ],
              LARG - 2600,
              { mr: 0, mt: 0, mb: 0 },
            ),
          ],
        }),
      ],
    }),
    new Paragraph({ spacing: { before: 60, after: 0 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: AZUL, space: 1 } }, children: [] }),
  ],
});

const rodape = new Footer({
  children: [
    new Paragraph({ spacing: { before: 0, after: 60 }, border: { top: { style: BorderStyle.SINGLE, size: 8, color: AZUL, space: 6 } }, children: [] }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 20 },
      children: [new TextRun({ text: "Tel. (11) 3439-7700  ·  E-mail: leandro.zillig@azulmob.com.br  ·  Site: www.azulmob.com.br", font: FONTE, size: 15, color: NAVY, bold: true })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 20 },
      children: [new TextRun({ text: "Rua Benedito Fernandes, 545 – Sala 211 – Santo Amaro – São Paulo/SP – CEP 04746-110", font: FONTE, size: 15, color: NAVY })],
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { after: 0 },
      children: [new TextRun({ font: FONTE, size: 14, color: CINZA, children: ["Página ", PageNumber.CURRENT, " de ", PageNumber.TOTAL_PAGES] })],
    }),
  ],
});

// ---------- capa ----------
const capaW = PX(LARG);
const capa = [
  new Paragraph({ spacing: { after: 600 }, children: [new ImageRun({ type: "png", data: img("atual-solida-azul.png"), transformation: { width: 190, height: Math.round(190 * (331 / 698)) } })] }),
  P("PROPOSTA TÉCNICA E COMERCIAL", { size: 20, bold: true, color: AZUL, spacing: 40, after: 200 }),
  P("«Transporte fretado de colaboradores»", { size: 48, bold: true, color: NAVY, after: 160, line: 300 }),
  P("Preparada para «Nome do cliente»", { size: 28, color: TEXTO_2, after: 480 }),
  new Paragraph({ spacing: { after: 0 }, children: [new ImageRun({ type: "jpg", data: img("capa.jpg"), transformation: { width: capaW, height: Math.round(capaW / 2) } })] }),
  (() => {
    const w = Math.floor(LARG / 4);
    const ws = [w, w, w, LARG - 3 * w];
    const dado = (r, v, i) => celula([P(r, { size: 14, color: "C9D3EE", after: 20, allCaps: true, spacing: 10 }), P(v, { size: 20, bold: true, color: "FFFFFF", after: 0, semMarca: true })], ws[i], { fundo: AZUL, mt: 180, mb: 180, ml: 200 });
    return new Table({
      width: { size: LARG, type: WidthType.DXA },
      columnWidths: ws,
      layout: TableLayoutType.FIXED,
      borders: SEM_BORDAS,
      rows: [new TableRow({ children: [dado("Proposta nº", "«AZ-2026-000»", 0), dado("Versão", "«1»", 1), dado("Data", "«01/10/2026»", 2), dado("Validade", "«30 dias»", 3)] })],
    });
  })(),
  vazio(2600),
  P("AZUL TRANSPORTES E TURISMO LTDA", { bold: true, size: 17, color: NAVY, after: 20 }),
  P("CNPJ 10.764.533/0001-01  ·  (11) 3439-7700  ·  www.azulmob.com.br", { size: 16, color: TEXTO_2, after: 20 }),
  P("Rua Benedito Fernandes, 545 – Sala 211 – Santo Amaro – São Paulo/SP", { size: 16, color: TEXTO_2, after: 0 }),
];

// ---------- carta de apresentação ----------
const carta = [
  P("São Paulo, «1º de outubro de 2026».", { after: 360, align: AlignmentType.RIGHT }),
  P("**A/C** «Nome do contato»", { after: 20 }),
  P("«Cargo» — «Nome do cliente»", { after: 20, color: TEXTO_2 }),
  P("«e-mail do contato»", { after: 360, color: TEXTO_2 }),
  P("**Assunto:** proposta técnica e comercial para «transporte fretado de colaboradores — unidade X».", { after: 280 }),
  P("Prezada(o) «Nome»,", { after: 200 }),
  P("Agradecemos a oportunidade de apresentar a nossa proposta. Ela foi construída a partir do levantamento feito com a sua equipe em «data da reunião/visita» e traz, de forma direta, o que vamos entregar, com qual frota, em quanto tempo começamos a operar e quanto custa, mês a mês e ao longo do contrato.", { align: AlignmentType.JUSTIFIED, after: 160 }),
  P("Desde 2009 a Azul Mob opera mobilidade de pessoas com frota própria, motoristas próprios e atendimento dedicado. Nesta proposta, você encontra também os indicadores que nos comprometemos a cumprir, o plano de implantação e, como diferencial, a projeção do preço com a reforma tributária, para que o seu orçamento dos próximos anos não tenha surpresas.", { align: AlignmentType.JUSTIFIED, after: 300 }),
  subtitulo("Resumo da proposta", { before: 120 }),
  destaques(
    [
      { valor: "«4»", rotulo: "veículos dedicados" },
      { valor: "«4»", rotulo: "linhas, segunda a sexta" },
      { valor: "«30 dias»", rotulo: "para iniciar a operação após o aceite" },
      { valor: "R$ «00.000,00»", rotulo: "investimento mensal, tributos inclusos" },
    ],
    { tamanho: 26 },
  ),
  vazio(360),
  P("Ficamos à disposição para ajustar qualquer ponto e, se for útil, apresentar a proposta à sua equipe.", { after: 300 }),
  P("Atenciosamente,", { after: 480 }),
  P("**«Nome do consultor comercial»**", { after: 20 }),
  P("«Cargo» · Azul Mob", { after: 20, color: TEXTO_2 }),
  P("«e-mail» · «(11) 0000-0000»", { after: 0, color: TEXTO_2 }),
];

// ---------- 1. quem somos ----------
const sobreW = PX(LARG);
const quemSomos = [
  ...titulo("Quem somos", { quebra: true }),
  new Paragraph({ spacing: { after: 200 }, children: [new ImageRun({ type: "jpg", data: img("sobre.jpg"), transformation: { width: sobreW, height: Math.round(sobreW / (16 / 7)) } })] }),
  P("A Azul Mob nasceu em 2009, em São Paulo, como Azul Locadora, e hoje é uma empresa de mobilidade de pessoas: transporte corporativo, fretamento, transporte escolar, esportivo, acessível e elétrico, além de unidades móveis para serviços públicos. Operamos com frota e equipe próprias em mais de 10 cidades e atendemos todo o Brasil com parceiros homologados.", { align: AlignmentType.JUSTIFIED, after: 240 }),
  destaques([
    { valor: "2009", rotulo: "fundação, em São Paulo" },
    { valor: "+10", rotulo: "cidades com operação própria" },
    { valor: "Brasil", rotulo: "atendimento nacional com parceiros homologados" },
    { valor: "10", rotulo: "categorias de veículo, de sedan a ônibus, com opções acessíveis e elétricas" },
  ]),
  vazio(240),
  ficha(
    [
      ["Missão", "Proporcionar soluções abrangentes e inovadoras de mobilidade de pessoas, eliminando as barreiras de deslocamento e tornando as viagens seguras, inclusivas e alinhadas aos compromissos globais de sustentabilidade."],
      ["Valores", "Compromisso com a segurança · Inovação e sustentabilidade · Atendimento ao cliente · Respeito e inclusão · Ética e responsabilidade."],
      ["Clientes atendidos", "«Cite 3 a 5 clientes de referência, com autorização, ou o segmento: empresas, prefeituras, escolas, clubes.»"],
    ],
    2400,
  ),
];

// ---------- 2. diferenciais ----------
const diferenciais = [
  ...titulo("Por que a Azul Mob"),
  cartoes([
    { titulo: "Segurança em primeiro lugar", texto: ["Motoristas próprios, contratados pela convenção coletiva da categoria, com treinamento em direção defensiva e atendimento.", "Manutenção preventiva em oficina própria e seguro de responsabilidade civil e de acidentes pessoais de passageiros (APP)."] },
    { titulo: "Frota própria e diversificada", texto: ["De sedan executivo a ônibus de 50 lugares, com climatização e multimídia em toda a frota.", "Idade máxima de «5» anos para os veículos desta proposta."] },
    { titulo: "Acessibilidade e inclusão", texto: ["Vans, micro-ônibus e ônibus adaptados para cadeira de rodas, com equipe preparada para o embarque assistido.", "Atendemos o colaborador com deficiência sem custo de adaptação para a sua empresa."] },
    { titulo: "Sustentabilidade", texto: ["Vans e minivans 100% elétricas disponíveis para linhas urbanas, com redução de emissões que pode compor o relatório ESG do cliente.", "«Informe aqui a estimativa de CO₂ evitado, se a proposta incluir veículo elétrico.»"] },
    { titulo: "Gestão em tempo real", texto: ["Monitoramento da frota em tempo real e central de operação acompanhando cada linha.", "«Confirme os recursos ofertados: aplicativo do passageiro, contagem de embarque, reconhecimento facial, painel do RH.»"] },
    { titulo: "Atendimento dedicado", texto: ["Um gestor de conta responsável pela sua operação, com canal direto e relatório mensal de indicadores.", "Plantão de atendimento para ocorrências durante todo o horário das linhas."] },
  ]),
  vazio(280),
  fotos([
    { arquivo: "motorista.jpg", titulo: "Motoristas próprios", texto: "Treinados e uniformizados." },
    { arquivo: "acessivel.jpg", titulo: "Embarque acessível", texto: "Frota adaptada e equipe preparada." },
    { arquivo: "eletrico.jpg", titulo: "Frota elétrica", texto: "Zero emissão no escapamento." },
  ]),
];

// ---------- 3. escopo ----------
const W_LINHAS = [700, 2700, 1640, 1100, 1500, 900, 1098];
const escopo = [
  ...titulo("Escopo do atendimento", { quebra: true }),
  P("O escopo abaixo reflete o levantamento feito com a sua equipe. Qualquer ajuste em rotas, horários ou número de passageiros pode ser feito antes do aceite, e o preço é atualizado na mesma hora.", { align: AlignmentType.JUSTIFIED, after: 200 }),
  subtitulo("Briefing", { before: 0 }),
  ficha([
    ["Cliente", "«Razão social» — CNPJ «00.000.000/0000-00»"],
    ["Local de atendimento", "«Endereço da unidade»"],
    ["Público", "«Colaboradores dos turnos administrativo e operacional»"],
    ["Dias de operação", "«Segunda a sexta, exceto feriados»"],
    ["Horários", "«07:05 às 10:30 e 16:05 às 21:00»"],
    ["Passageiros estimados", "«120 por dia»"],
    ["Início previsto", "«dd/mm/aaaa»"],
    ["Prazo do contrato", "«12 meses»"],
  ]),
  subtitulo("Linhas"),
  tabela(
    [
      { t: "Linha", w: W_LINHAS[0], align: AlignmentType.CENTER },
      { t: "Trajeto", w: W_LINHAS[1] },
      { t: "Horários", w: W_LINHAS[2] },
      { t: "Dias", w: W_LINHAS[3] },
      { t: "Veículo", w: W_LINHAS[4] },
      { t: "Viagens/dia", w: W_LINHAS[5], align: AlignmentType.CENTER },
      { t: "Km/mês", w: W_LINHAS[6], align: AlignmentType.RIGHT },
    ],
    [
      ["01", "«Estação Campo Belo» → «Unidade»", "«07:05 – 21:00»", "«Seg a sex»", "«Van executiva»", "«10»", "«810»"],
      ["02", "«Estação Butantã» → «Unidade»", "«07:05 – 21:00»", "«Seg a sex»", "«Van executiva»", "«10»", "«1.000»"],
      ["03", "«Vila Leopoldina» → «Unidade»", "«07:05 – 21:00»", "«Seg a sex»", "«Micro-ônibus»", "«9»", "«2.000»"],
      ["04", "«Vila Madalena» → «Unidade»", "«07:05 – 21:00»", "«Seg a sex»", "«Ônibus»", "«6»", "«2.000»"],
    ],
    { total: [{ cells: [{ t: "Total", w: W_LINHAS.slice(0, 5).reduce((a, b) => a + b, 0), span: 5 }, { t: "«35»", w: W_LINHAS[5], align: AlignmentType.CENTER }, { t: "«5.810»", w: W_LINHAS[6], align: AlignmentType.RIGHT }] }] },
  ),
  P("Km/mês considera «21» dias úteis. O trajeto detalhado de cada linha, com pontos de embarque, segue em anexo.", { size: 16, color: TEXTO_2, before: 80, after: 0 }),
];

// ---------- 4. frota ----------
const frotaSec = [
  ...titulo("Frota proposta", { quebra: true }),
  P("Mantenha apenas as categorias desta proposta e ajuste a quantidade.", { size: 16, color: TEXTO_2, italics: true, after: 160 }),
  frota([
    { arquivo: "van.jpg", nome: "Van Executiva", capacidade: "15 passageiros", detalhe: "«2» veículos · Linhas «01 e 02»" },
    { arquivo: "micro.jpg", nome: "Micro-Ônibus Executivo", capacidade: "26 a 30 passageiros", detalhe: "«1» veículo · Linha «03»" },
    { arquivo: "onibus.jpg", nome: "Ônibus Executivo", capacidade: "46 a 50 passageiros", detalhe: "«1» veículo · Linha «04»" },
    { arquivo: "van_acessivel.jpg", nome: "Van Acessível", capacidade: "7 + 2 cadeirantes", detalhe: "Opcional · sob demanda" },
    { arquivo: "van_eletrica.jpg", nome: "Van Elétrica", capacidade: "15 passageiros", detalhe: "Opcional · 100% elétrica" },
    { arquivo: "sedan.jpg", nome: "Sedan Executivo", capacidade: "3 passageiros", detalhe: "Opcional · carro de apoio" },
  ]),
  subtitulo("Em todos os veículos"),
  item("Climatização e multimídia."),
  item("Monitoramento em tempo real e central de operação."),
  item("Manutenção preventiva programada, higienização diária e dedetização periódica."),
  item("Seguro de responsabilidade civil e de acidentes pessoais de passageiros (APP)."),
  item("Identificação visual Azul Mob e motorista uniformizado."),
  item("Idade máxima de «5» anos; troca de categoria em até «45» dias após pedido formal, conforme disponibilidade."),
];

// ---------- 5. investimento ----------
const W_PRECO = [700, 2700, 900, 1100, 2100, 2138];
const W_ADIC = [5638, 4000];
const W_REF = [1600, 2700, 2700, 2638];
const investimento = [
  ...titulo("Investimento", { quebra: true }),
  P("Valores mensais por linha, com mão de obra, veículo, combustível, manutenção, seguros, gestão e tributos incluídos.", { after: 200 }),
  tabela(
    [
      { t: "Linha", w: W_PRECO[0], align: AlignmentType.CENTER },
      { t: "Veículo", w: W_PRECO[1] },
      { t: "Qtd.", w: W_PRECO[2], align: AlignmentType.CENTER },
      { t: "Km/mês", w: W_PRECO[3], align: AlignmentType.RIGHT },
      { t: "Valor mensal por veículo", w: W_PRECO[4], align: AlignmentType.RIGHT },
      { t: "Total mensal", w: W_PRECO[5], align: AlignmentType.RIGHT },
    ],
    [
      ["01", "«Van Executiva»", "«1»", "«810»", "R$ «0,00»", "R$ «0,00»"],
      ["02", "«Van Executiva»", "«1»", "«1.000»", "R$ «0,00»", "R$ «0,00»"],
      ["03", "«Micro-Ônibus Executivo»", "«1»", "«2.000»", "R$ «0,00»", "R$ «0,00»"],
      ["04", "«Ônibus Executivo»", "«1»", "«2.000»", "R$ «0,00»", "R$ «0,00»"],
    ],
    {
      total: [
        { cells: [{ t: "Total mensal", w: W_PRECO.slice(0, 5).reduce((a, b) => a + b, 0), span: 5 }, { t: "R$ «0,00»", w: W_PRECO[5], align: AlignmentType.RIGHT }] },
        { cells: [{ t: "Valor global do contrato («12» meses)", w: W_PRECO.slice(0, 5).reduce((a, b) => a + b, 0), span: 5 }, { t: "R$ «0,00»", w: W_PRECO[5], align: AlignmentType.RIGHT }] },
      ],
    },
  ),
  subtitulo("Serviços adicionais"),
  tabela(
    [
      { t: "Serviço", w: W_ADIC[0] },
      { t: "Valor", w: W_ADIC[1], align: AlignmentType.RIGHT },
    ],
    [
      ["Quilômetro excedente, pré-aprovado pelo gestor do contrato", "R$ «0,00» por km"],
      ["Hora adicional (antecipação ou atraso de horário)", "«20%» do valor diário da linha, por hora"],
      ["Viagem extra ou operação em feriado", "«50%» de acréscimo sobre o valor diário da linha"],
      ["Viagens eventuais e carro de apoio", "Sob consulta, conforme disponibilidade"],
    ],
  ),
  new Paragraph({ pageBreakBefore: true, spacing: { after: 0 }, children: [] }),
  quadro("Preço com a reforma tributária, ano a ano", [
    "Os preços acima incluem ISS de «5%» e PIS/COFINS. A partir de 2027, CBS e IBS (EC 132/2023 e LC 214/2025) substituem PIS/COFINS e, até 2033, o ISS. O novo imposto é cobrado por fora e gera crédito para a sua empresa; abaixo, o valor projetado de cada ano, com a mesma margem de hoje:",
  ]),
  vazio(120),
  tabela(
    [
      { t: "Ano", w: W_REF[0], align: AlignmentType.CENTER },
      { t: "Tributos sobre o serviço", w: W_REF[1] },
      { t: "Total mensal projetado", w: W_REF[2], align: AlignmentType.RIGHT },
      { t: "Crédito estimado para o cliente*", w: W_REF[3], align: AlignmentType.RIGHT },
    ],
    [
      ["2026", "ISS + PIS/COFINS", "R$ «0,00»", "—"],
      ["2027", "ISS + CBS + IBS 0,1%", "R$ «0,00»", "R$ «0,00»"],
      ["2028", "ISS + CBS + IBS 0,1%", "R$ «0,00»", "R$ «0,00»"],
      ["2029", "ISS 90% + CBS + IBS 10%", "R$ «0,00»", "R$ «0,00»"],
      ["2030", "ISS 80% + CBS + IBS 20%", "R$ «0,00»", "R$ «0,00»"],
      ["2031", "ISS 70% + CBS + IBS 30%", "R$ «0,00»", "R$ «0,00»"],
      ["2032", "ISS 60% + CBS + IBS 40%", "R$ «0,00»", "R$ «0,00»"],
      ["2033", "CBS + IBS integral (sem ISS)", "R$ «0,00»", "R$ «0,00»"],
    ],
  ),
  P("* Crédito de CBS/IBS aproveitável por empresas no regime regular. Projeção com as alíquotas de referência vigentes na data da proposta; os valores efetivos seguem a cláusula 6.5.", { size: 15, color: TEXTO_2, before: 80, after: 0 }),
];

// ---------- 6. condições comerciais ----------
const condicoes = [
  ...titulo("Condições comerciais"),
  clausula("6.1", "Pagamento", "«30» dias após a emissão da nota fiscal, por boleto ou transferência."),
  clausula("6.2", "Faturamento", "mensal. Enviamos o espelho de faturamento até o «3º» dia útil; a aprovação ocorre em até 2 dias úteis e eventuais ajustes entram no faturamento do mês seguinte."),
  clausula("6.3", "Validade", "esta proposta é válida por «30» dias a partir da data de emissão."),
  clausula("6.4", "Reajuste", "anual, na data-base do contrato, pela composição: mão de obra pelo índice da convenção coletiva da categoria («55%» do preço); combustível pela variação do diesel S-10 na ANP («20%»); demais itens pelo IPCA («25%»). Se a convenção coletiva for homologada antes da data-base, o reajuste da parcela de mão de obra é aplicado a partir da sua vigência."),
  clausula("6.5", "Reequilíbrio tributário", "a cada mudança de alíquota ou de tributo prevista na reforma tributária (2027 a 2033), ou em qualquer outra alteração de carga tributária, o preço é ajustado para refletir a carga efetiva do ano, preservando a margem original do contrato. A planilha de cálculo é apresentada ao cliente a cada ajuste."),
  clausula("6.6", "Alterações de escopo", "mudanças de rota, horário, turno, endereço, número de passageiros ou categoria de veículo identificadas no plantão de levantamento ou durante a operação são reprecificadas e submetidas a nova aprovação antes de entrar em vigor."),
  clausula("6.7", "Pedágios e estacionamento", "«incluídos no preço» / «repassados ao custo, mediante comprovante»."),
  clausula("6.8", "Obrigações trabalhistas", "os motoristas e monitores são empregados da Azul Mob, contratados conforme a convenção coletiva da categoria, com todas as obrigações trabalhistas, previdenciárias e de saúde e segurança do trabalho sob nossa responsabilidade."),
  clausula("6.9", "Seguros", "todos os veículos contam com seguro de responsabilidade civil e de acidentes pessoais de passageiros (APP)."),
];

// ---------- 7. implantação e 8. SLA ----------
const W_IMP = [2300, 1500, 5838];
const W_SLA = [3400, 2100, 4138];
const implantacao = [
  ...titulo("Implantação", { quebra: true }),
  P("Do aceite ao primeiro dia de operação em «30» dias, com um responsável Azul Mob acompanhando cada etapa:", { after: 200 }),
  tabela(
    [
      { t: "Etapa", w: W_IMP[0] },
      { t: "Prazo", w: W_IMP[1], align: AlignmentType.CENTER },
      { t: "O que acontece", w: W_IMP[2] },
    ],
    [
      ["1. Kick-off", "«Semana 1»", "Reunião com RH e facilities, validação da lista de passageiros, endereços e turnos."],
      ["2. Roteirização", "«Semana 2»", "Desenho das linhas e pontos de embarque, validação dos horários com o cliente."],
      ["3. Mobilização", "«Semana 3»", "Preparação e identificação da frota, seleção e treinamento dos motoristas na rotina do cliente."],
      ["4. Operação assistida", "«Semana 4»", "Primeiros dias com plantão presencial, ajustes finos de horário e comunicação aos colaboradores."],
    ],
  ),
  ...titulo("Níveis de serviço"),
  P("Indicadores que acompanhamos e apresentamos todo mês no relatório de operação:", { after: 200 }),
  tabela(
    [
      { t: "Indicador", w: W_SLA[0] },
      { t: "Meta", w: W_SLA[1], align: AlignmentType.CENTER },
      { t: "Como medimos", w: W_SLA[2] },
    ],
    [
      ["Pontualidade na chegada à unidade", "«≥ 98%»", "Horário de chegada registrado pelo rastreamento, por viagem."],
      ["Substituição de veículo em pane", "«até 60 min»", "Do chamado à chegada do veículo reserva."],
      ["Resposta a ocorrências", "«até 15 min»", "Do registro pelo cliente ao primeiro retorno da central."],
      ["Viagens realizadas", "«100%»", "Viagens realizadas sobre viagens programadas."],
      ["Relatório mensal", "«até o 5º dia útil»", "Indicadores, ocorrências e plano de ação."],
    ],
  ),
];

// ---------- 9. aceite ----------
function assinatura(rotulo, linhas) {
  return [
    P(rotulo, { bold: true, color: AZUL, size: 17, allCaps: true, spacing: 10, after: 600 }),
    new Paragraph({ spacing: { after: 60 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: TEXTO_2, space: 1 } }, children: [] }),
    ...linhas.map((l, i) => P(l, { size: 18, after: i === linhas.length - 1 ? 0 : 20, bold: i === 0, color: i === 0 ? TEXTO : TEXTO_2 })),
  ];
}
const W_ASS = [4619, 400, 4619];
const aceite = [
  ...titulo("Aceite", { quebra: true }),
  P("Ao assinar, as partes concordam com o escopo, os preços e as condições desta proposta, que servirá de base para o contrato de prestação de serviços.", { align: AlignmentType.JUSTIFIED, after: 200 }),
  P("São Paulo, «1º de outubro de 2026».", { after: 300 }),
  new Table({
    width: { size: LARG, type: WidthType.DXA },
    columnWidths: W_ASS,
    layout: TableLayoutType.FIXED,
    borders: SEM_BORDAS,
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          celula(assinatura("Pela Azul Mob", ["«Nome do representante legal»", "«Cargo» · CPF «000.000.000-00»", "Azul Transportes e Turismo Ltda", "CNPJ 10.764.533/0001-01"]), W_ASS[0], { ml: 0, valign: VerticalAlign.TOP }),
          celula([vazio(0)], W_ASS[1]),
          celula(assinatura("Pelo cliente", ["«Nome»", "«Cargo» · CPF «000.000.000-00»", "«Razão social»", "CNPJ «00.000.000/0000-00»"]), W_ASS[2], { mr: 0, valign: VerticalAlign.TOP }),
        ],
      }),
    ],
  }),
  vazio(480),
  quadro(
    "Fale com a gente",
    ["«Nome do consultor» · «Cargo»", "«e-mail» · «(11) 00000-0000»", "Central: (11) 3439-7700 · atendimento@azulmob.com.br · www.azulmob.com.br"],
    { escuro: true },
  ),
];

const pagina = {
  size: { width: PAG.w, height: PAG.h },
  margin: { top: 1640, right: MARG, bottom: 1500, left: MARG, header: 500, footer: 360 },
};

const doc = new Document({
  creator: "Azul Mob",
  title: "Proposta técnica e comercial — Azul Mob",
  description: "Modelo de proposta da Azul Mob",
  styles: { default: { document: { run: { font: FONTE, size: 20, color: TEXTO } } } },
  numbering: {
    config: [
      {
        reference: "marcador",
        levels: [{ level: 0, format: LevelFormat.BULLET, text: "■", alignment: AlignmentType.LEFT, style: { run: { color: AZUL, size: 14 }, paragraph: { indent: { left: 420, hanging: 280 } } } }],
      },
    ],
  },
  sections: [
    { properties: { page: { size: pagina.size, margin: { top: 1000, right: MARG, bottom: 900, left: MARG, header: 400, footer: 400 } } }, children: capa },
    {
      properties: { page: pagina },
      headers: { default: cabecalho },
      footers: { default: rodape },
      children: [...carta, ...quemSomos, ...diferenciais, ...escopo, ...frotaSec, ...investimento, ...condicoes, ...implantacao, ...aceite],
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  const saida = process.argv[2] || path.join(__dirname, "Modelo_Proposta_Azul_Mob.docx");
  fs.writeFileSync(saida, buf);
  console.log("gerado", saida, buf.length);
});
