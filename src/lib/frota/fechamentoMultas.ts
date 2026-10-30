import type ExcelJS from "exceljs";

// O FECHAMENTO DA MULTA — quando uma multa está 100% resolvida, conferida dos
// dois lados que mexem em dinheiro:
//
//   1. condutor: identificado no cadastro (ou a empresa assumiu; infração
//      do proprietário e NIC não têm condutor);
//   2. indicação: feita no prazo (ou não cabe: proprietário, NIC, multa
//      anulada; ou a NIC já foi lançada; ou a empresa assumiu sem indicar);
//   3. pagamento: título pago nas contas a pagar da Omie, ligado à multa
//      (pago "por fora", sem título, não fecha);
//   4. desconto: quando é o motorista que paga, o valor saiu na folha
//      processada daquela competência (ou o RH decidiu não descontar).
//
// Só com os quatro a multa fecha — o agente a finaliza sozinho. O que fica
// aberto vira pendência de quem resolve (Financeiro, RH, Multas).
//
// Desconto em folha (CLT, art. 462, §1º): só com o termo assinado pelo
// motorista (a autorização), pelo valor efetivamente pago.

export type ItemFechamento = { chave: "condutor" | "indicacao" | "pagamento" | "desconto"; rotulo: string; ok: boolean | null; detalhe: string };

export type MultaFechamento = {
  situacao: string;
  ehNic: boolean;
  responsavel: string;
  responsabilidadeInfracao: string;
  condutorPessoaId: string | null;
  condutorNome: string | null;
  indicadoEm: Date | null;
  pagoEm: Date | null;
  tituloOmieId: string | null;
  valorCents: number;
  valorPagoCents: number | null;
  termoAssinadoEm: Date | null;
  descontoCompetencia: Date | null;
  descontoValorCents: number | null;
  descontoConferidoEm: Date | null;
  descontoConferidoValorCents: number | null;
  semDesconto: boolean;
  temNic?: boolean;
};

const mes = (d: Date) => `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;

// O motorista paga (desconto em folha) quando ele é o responsável, a infração
// é de condutor e a multa não é NIC nem foi anulada.
export const descontoDevido = (m: Pick<MultaFechamento, "situacao" | "ehNic" | "responsavel" | "responsabilidadeInfracao">) =>
  m.situacao !== "cancelada" && !m.ehNic && m.responsavel === "motorista" && m.responsabilidadeInfracao !== "proprietario";

// O valor a descontar: o aprovado; sem aprovação, o que se pagou (com o
// desconto do SNE, se houve); sem pagamento, o valor da multa.
export const valorDoDesconto = (m: Pick<MultaFechamento, "descontoValorCents" | "valorPagoCents" | "valorCents">) => m.descontoValorCents ?? m.valorPagoCents ?? m.valorCents;

export function checklistDeFechamento(m: MultaFechamento): ItemFechamento[] {
  const anulada = m.situacao === "cancelada";
  const proprietario = m.responsabilidadeInfracao === "proprietario";
  const itens: ItemFechamento[] = [];

  if (m.ehNic || proprietario || anulada) itens.push({ chave: "condutor", rotulo: "Condutor", ok: null, detalhe: m.ehNic ? "NIC (da empresa)" : proprietario ? "infração do proprietário" : "multa anulada" });
  else if (m.condutorPessoaId) itens.push({ chave: "condutor", rotulo: "Condutor", ok: true, detalhe: "identificado" });
  else if (m.responsavel === "empresa") itens.push({ chave: "condutor", rotulo: "Condutor", ok: true, detalhe: "a empresa assumiu" });
  else itens.push({ chave: "condutor", rotulo: "Condutor", ok: false, detalhe: m.condutorNome ? "nome sem cadastro: escolher a pessoa" : "não identificado" });

  if (m.ehNic || proprietario || anulada) itens.push({ chave: "indicacao", rotulo: "Indicação", ok: null, detalhe: "não cabe" });
  else if (m.indicadoEm) itens.push({ chave: "indicacao", rotulo: "Indicação", ok: true, detalhe: "feita" });
  else if (m.temNic) itens.push({ chave: "indicacao", rotulo: "Indicação", ok: true, detalhe: "não feita — NIC lançada" });
  // A empresa assumir sem indicar é decisão (o risco de NIC é dela); se a NIC
  // vier, entra como outra multa, com o próprio ciclo.
  else if (m.responsavel === "empresa") itens.push({ chave: "indicacao", rotulo: "Indicação", ok: true, detalhe: "a empresa assumiu sem indicar (NIC, se vier, é multa nova)" });
  else itens.push({ chave: "indicacao", rotulo: "Indicação", ok: false, detalhe: "indicar o condutor (ou lançar a NIC)" });

  if (anulada) itens.push({ chave: "pagamento", rotulo: "Pagamento", ok: null, detalhe: "anulada no recurso" });
  else if (m.pagoEm && m.tituloOmieId) itens.push({ chave: "pagamento", rotulo: "Pagamento", ok: true, detalhe: "pago, conferido na Omie" });
  else if (m.pagoEm) itens.push({ chave: "pagamento", rotulo: "Pagamento", ok: false, detalhe: "pago sem título na Omie: ligar o título" });
  else if (m.tituloOmieId) itens.push({ chave: "pagamento", rotulo: "Pagamento", ok: false, detalhe: "título na Omie ainda não pago" });
  else itens.push({ chave: "pagamento", rotulo: "Pagamento", ok: false, detalhe: "a pagar" });

  if (!descontoDevido(m)) itens.push({ chave: "desconto", rotulo: "Desconto em folha", ok: null, detalhe: m.responsavel === "empresa" ? "a empresa assumiu" : "não cabe" });
  else if (m.semDesconto) itens.push({ chave: "desconto", rotulo: "Desconto em folha", ok: true, detalhe: "o RH decidiu não descontar" });
  else if (m.descontoConferidoEm) {
    const bate = m.descontoConferidoValorCents === valorDoDesconto(m);
    itens.push({ chave: "desconto", rotulo: "Desconto em folha", ok: bate, detalhe: bate ? `conferido na folha de ${mes(m.descontoCompetencia ?? m.descontoConferidoEm)}` : "a folha descontou outro valor" });
  } else if (m.descontoCompetencia) itens.push({ chave: "desconto", rotulo: "Desconto em folha", ok: false, detalhe: `aprovado para ${mes(m.descontoCompetencia)}: conferir na folha` });
  else if (m.termoAssinadoEm) itens.push({ chave: "desconto", rotulo: "Desconto em folha", ok: false, detalhe: "aguardando a aprovação do RH" });
  else itens.push({ chave: "desconto", rotulo: "Desconto em folha", ok: false, detalhe: "sem termo assinado: não pode descontar" });
  return itens;
}

export const fechada100 = (m: MultaFechamento) => checklistDeFechamento(m).every((i) => i.ok !== false);

// INFRAÇÃO DO PROPRIETÁRIO (CTB, art. 257, §2º: documentação, formalidades e
// condições do veículo; peso é do transportador): a sugestão pela
// descrição — a pessoa confirma na multa.
const DO_PROPRIETARIO = /DOCUMENTA|LICENCIA|CRLV|REGISTRO|COR INCORRETA|CARACTERISTICA|PESO|PESAGEM|BALANCA|PLACA ILEGIVEL|LACRE/;
export function responsabilidadePelaDescricao(especificacao: string): "condutor" | "proprietario" {
  const t = especificacao.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  return DO_PROPRIETARIO.test(t) ? "proprietario" : "condutor";
}

// ---------------------------------------------------------------------------
// A CONFERÊNCIA COM A FOLHA. Do relatório de eventos da folha processada
// lêem-se as linhas de desconto de multa (o evento com "MULTA" no nome); a
// conferência é por pessoa e competência: o que o RH aprovou × o que saiu.
// ---------------------------------------------------------------------------

export type LinhaEventoFolha = { linha: number; matricula: string | null; nome: string; evento: string; valorCents: number };

const norm = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
function valorCelula(c: ExcelJS.CellValue): unknown {
  if (c && typeof c === "object" && !(c instanceof Date)) {
    const o = c as { result?: unknown; richText?: { text: string }[]; text?: string };
    if (o.result !== undefined) return o.result;
    if (o.richText) return o.richText.map((r) => r.text).join("");
    if (o.text !== undefined) return o.text;
  }
  return c;
}
function cents(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(Math.abs(v) * 100);
  const t = String(v ?? "").replace(/R\$|\s/g, "");
  if (!t) return null;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? Math.round(Math.abs(n) * 100) : null;
}
const COLUNAS: [keyof Omit<LinhaEventoFolha, "linha" | "valorCents"> | "valor", (n: string) => boolean][] = [
  ["matricula", (n) => /^(MATRICULA|COD EPR|COD EMPREGADO|CODIGO EMPREGADO|CHAPA|REGISTRO|COD FUNC)/.test(n)],
  ["nome", (n) => /^(NOME|FUNCIONARIO|EMPREGADO|COLABORADOR)/.test(n) && !/EVENTO|EMPRESA/.test(n)],
  ["evento", (n) => /^(EVENTO|DESCRICAO EVENTO|DESC EVENTO|RUBRICA|VERBA|DESCRICAO DA VERBA|DESCRICAO)$/.test(n) || n.startsWith("DESCRICAO EVENTO")],
  ["valor", (n) => /^(VALOR|DESCONTO|VALOR DESCONTO|VALOR EVENTO|TOTAL)$/.test(n)],
];

export function lerEventosDeMulta(livro: ExcelJS.Workbook): { linhas: LinhaEventoFolha[]; lidas: number; erro: string | null } {
  for (const ws of livro.worksheets) {
    for (let r = 1; r <= Math.min(30, ws.rowCount); r++) {
      const col: Record<string, number> = {};
      ws.getRow(r).eachCell({ includeEmpty: false }, (c, i) => {
        const n = norm(valorCelula(c.value));
        for (const [campo, casa] of COLUNAS) if (col[campo] === undefined && casa(n)) col[campo] = i;
      });
      if (col.nome === undefined || col.evento === undefined || col.valor === undefined) continue;
      const linhas: LinhaEventoFolha[] = [];
      let lidas = 0;
      for (let k = r + 1; k <= ws.rowCount; k++) {
        const row = ws.getRow(k);
        const get = (c: string) => (col[c] === undefined ? null : valorCelula(row.getCell(col[c]).value));
        const nome = String(get("nome") ?? "").trim();
        const evento = String(get("evento") ?? "").trim();
        if (!nome || !evento) continue;
        lidas++;
        if (!/MULTA/.test(norm(evento))) continue;
        const valorCents = cents(get("valor"));
        if (!valorCents) continue;
        linhas.push({ linha: k, matricula: String(get("matricula") ?? "").trim() || null, nome: nome.slice(0, 120), evento: evento.slice(0, 80), valorCents });
      }
      return { linhas, lidas, erro: lidas ? null : "Achei o cabeçalho, mas nenhuma linha de evento." };
    }
  }
  return { linhas: [], lidas: 0, erro: "Não achei as colunas de nome, evento e valor. Envie o relatório de eventos da folha em planilha (uma linha por evento de cada funcionário)." };
}

export type SituacaoConferencia = "ok" | "divergente" | "nao_descontado" | "sem_multa";
export const ROTULO_CONFERENCIA: Record<SituacaoConferencia, string> = { ok: "bate", divergente: "valor diferente", nao_descontado: "aprovado e não descontado", sem_multa: "descontado sem multa aprovada" };

export function conferirDescontos(
  esperados: { multaId: string; chave: string; nome: string; valorCents: number }[],
  descontados: { chave: string; nome: string; valorCents: number }[]
): { chave: string; nome: string; esperadoCents: number; descontadoCents: number; situacao: SituacaoConferencia; multaIds: string[] }[] {
  const porChave = new Map<string, { chave: string; nome: string; esperadoCents: number; descontadoCents: number; multaIds: string[] }>();
  for (const e of esperados) {
    const g = porChave.get(e.chave) ?? { chave: e.chave, nome: e.nome, esperadoCents: 0, descontadoCents: 0, multaIds: [] };
    g.esperadoCents += e.valorCents;
    g.multaIds.push(e.multaId);
    porChave.set(e.chave, g);
  }
  for (const d of descontados) {
    const g = porChave.get(d.chave) ?? { chave: d.chave, nome: d.nome, esperadoCents: 0, descontadoCents: 0, multaIds: [] };
    g.descontadoCents += d.valorCents;
    porChave.set(d.chave, g);
  }
  return [...porChave.values()]
    .map((g) => ({ ...g, situacao: (g.esperadoCents === 0 ? "sem_multa" : g.descontadoCents === 0 ? "nao_descontado" : Math.abs(g.esperadoCents - g.descontadoCents) <= 1 ? "ok" : "divergente") as SituacaoConferencia }))
    .sort((a, b) => Number(a.situacao === "ok") - Number(b.situacao === "ok") || a.nome.localeCompare(b.nome, "pt-BR"));
}

// A chave de uma pessoa na conferência: o cadastro quando casa; senão o nome
// sem acento (a folha e o cadastro escrevem o nome do mesmo jeito na maioria).
export const chavePorNome = (nome: string) => `nome:${norm(nome)}`;
