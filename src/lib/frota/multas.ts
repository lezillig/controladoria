import type ExcelJS from "exceljs";
import { normalizarPlaca } from "@/lib/cadastro/normalizacao";

// MULTAS — as regras do processo, puras (sem banco): a etapa de cada multa,
// o prazo de indicação, os pontos do motorista em 12 meses, quem dirigia
// pela escala e pelo uso do veículo, e a leitura da planilha CONTROLE MULTAS
// (migração única).
//
//   achada na consulta de placa
//   → quem dirigia: uso do veículo e escala da gestão naquela hora; sem
//     eles, o diário de bordo pedido à operação
//   → responsável: o motorista (assina o termo: reconhece a multa, autoriza
//     o desconto e a indicação) ou a empresa assume
//   → indicação do condutor ao órgão até o vencimento da notificação —
//     depois disso o órgão cobra a NIC (multa por não indicação), custo
//     evitável
//   → pagamento → desconto em folha (o RH aprova com o termo) → finalizada.

const DIA = 86_400_000;
const utc = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
export const diasAte = (d: Date, hoje: Date) => Math.round((utc(d) - utc(hoje)) / DIA);
const br = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join("/");

export const RESPONSAVEIS = ["a_definir", "motorista", "empresa"] as const;
export const ROTULO_RESPONSAVEL: Record<string, string> = { a_definir: "a definir", motorista: "motorista", empresa: "a empresa assume" };

export type Passo = "identificar_condutor" | "aguardando_diario" | "nao_localizado" | "definir_responsavel" | "colher_termo" | "indicar_condutor" | "pagar" | "ligar_titulo" | "descontar" | "conferir_desconto" | "concluir";
export const ROTULO_PASSO: Record<Passo, string> = {
  identificar_condutor: "identificar o condutor",
  aguardando_diario: "aguardando o diário de bordo",
  nao_localizado: "condutor não localizado",
  definir_responsavel: "definir quem paga",
  colher_termo: "colher o termo",
  indicar_condutor: "indicar o condutor ao órgão",
  pagar: "pagar",
  ligar_titulo: "ligar o pagamento à Omie",
  descontar: "descontar em folha",
  conferir_desconto: "conferir o desconto na folha",
  concluir: "pronta para finalizar",
};

export type MultaRegra = {
  situacao: string;
  ehNic: boolean;
  responsavel: string;
  condutorPessoaId: string | null;
  condutorNome?: string | null;
  condutorNaoLocalizado: boolean;
  diarioSolicitadoEm: Date | null;
  diarioRecebidoEm: Date | null;
  termoAssinadoEm: Date | null;
  termoRecusado: boolean;
  prazoIndicacao: Date | null;
  indicadoEm: Date | null;
  pagoEm: Date | null;
  descontoCompetencia: Date | null;
  responsabilidadeInfracao?: string;
  tituloOmieId?: string | null;
  descontoConferidoEm?: Date | null;
  semDesconto?: boolean;
};

// O que falta fazer, em ordem. A NIC não se indica (já é a multa da empresa);
// a infração do proprietário não tem condutor, indicação nem desconto.
export function passosAbertos(m: MultaRegra): Passo[] {
  if (m.situacao !== "aberta") return [];
  if (m.responsabilidadeInfracao === "proprietario") return !m.pagoEm ? ["pagar"] : !m.tituloOmieId ? ["ligar_titulo"] : ["concluir"];
  const r: Passo[] = [];
  const temCondutor = !!m.condutorPessoaId || !!m.condutorNome;
  if (!m.ehNic && m.responsavel !== "empresa" && !temCondutor) {
    if (m.condutorNaoLocalizado) r.push("nao_localizado");
    else if (m.diarioSolicitadoEm && !m.diarioRecebidoEm) r.push("aguardando_diario");
    else r.push("identificar_condutor");
  }
  if (!m.ehNic && m.responsavel === "a_definir" && temCondutor) r.push("definir_responsavel");
  if (m.responsavel === "motorista" && !m.termoAssinadoEm && !m.termoRecusado) r.push("colher_termo");
  if (!m.ehNic && m.responsavel !== "empresa" && !m.indicadoEm) r.push("indicar_condutor");
  if (!m.pagoEm) r.push("pagar");
  else if (m.tituloOmieId === null) r.push("ligar_titulo");
  if (m.responsavel === "motorista" && !m.ehNic && !m.semDesconto) {
    if (m.termoAssinadoEm && !m.descontoCompetencia) r.push("descontar");
    else if (m.descontoCompetencia && m.descontoConferidoEm === null) r.push("conferir_desconto");
  }
  return r.length ? r : ["concluir"];
}

// O prazo de indicação: perdido (risco de NIC), em até 7 dias, em dia — só
// enquanto a indicação ainda é devida.
export type SituacaoPrazo = "perdido" | "urgente" | "em_dia" | "sem_prazo" | "nao_se_aplica";
export function prazoDeIndicacao(m: MultaRegra, hoje: Date): { situacao: SituacaoPrazo; dias: number | null } {
  if (m.situacao !== "aberta" || m.ehNic || m.responsavel === "empresa" || m.responsabilidadeInfracao === "proprietario" || m.indicadoEm) return { situacao: "nao_se_aplica", dias: null };
  if (!m.prazoIndicacao) return { situacao: "sem_prazo", dias: null };
  const dias = diasAte(m.prazoIndicacao, hoje);
  return { situacao: dias < 0 ? "perdido" : dias <= 7 ? "urgente" : "em_dia", dias };
}

// PONTOS NA CNH em 12 meses: as multas do motorista que não foram assumidas
// pela empresa nem anuladas. Condutor com EAR suspende com 40 pontos
// (Lei 14.071/2020); o aviso começa em 30.
export const LIMITE_PONTOS_EAR = 40;
export const AVISO_PONTOS = 30;
export function pontosEm12Meses(multas: { condutorPessoaId: string | null; dataInfracao: Date; pontos: number | null; situacao: string; responsavel: string; ehNic: boolean }[], pessoaId: string, hoje: Date) {
  const desde = utc(hoje) - 365 * DIA;
  const minhas = multas.filter((m) => m.condutorPessoaId === pessoaId && !m.ehNic && m.situacao !== "cancelada" && m.responsavel !== "empresa" && utc(m.dataInfracao) > desde);
  return { pontos: minhas.reduce((s, m) => s + (m.pontos ?? 0), 0), multas: minhas.length, semPontos: minhas.filter((m) => m.pontos === null).length };
}

// QUEM DIRIGIA na hora da infração: o uso do veículo registrado na gestão
// (retirada e devolução) e, sem ele, a escala do dia. Mais de um na escala:
// candidatos para a pessoa escolher.
const dataSP = (t: Date) => new Date(t.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
export function condutorPelosRegistros(
  t: Date,
  usos: { driverId: string; checkInAt: Date; checkOutAt: Date | null }[],
  escalas: { driverId: string; date: Date }[]
): { driverId: string; fonte: "uso" | "escala" } | { candidatos: string[] } | null {
  const noUso = [...new Set(usos.filter((u) => u.checkInAt <= t && (u.checkOutAt ?? new Date(u.checkInAt.getTime() + 16 * 3_600_000)) >= t).map((u) => u.driverId))];
  if (noUso.length === 1) return { driverId: noUso[0], fonte: "uso" };
  const dia = dataSP(t);
  const naEscala = [...new Set(escalas.filter((e) => e.date.toISOString().slice(0, 10) === dia).map((e) => e.driverId))];
  if (naEscala.length === 1) return { driverId: naEscala[0], fonte: "escala" };
  const candidatos = [...new Set([...noUso, ...naEscala])];
  return candidatos.length ? { candidatos } : null;
}

// A COMPETÊNCIA DO DESCONTO proposta ao RH: o mês corrente até o dia 20 (a
// folha ainda não fechou), senão o seguinte.
export function competenciaDoDesconto(hoje: Date): Date {
  const proximo = hoje.getUTCDate() > 20 ? 1 : 0;
  return new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + proximo, 1));
}

// ---------------------------------------------------------------------------
// A PLANILHA "CONTROLE MULTAS" (migração única). Colunas achadas pelo nome.
// Nas colunas de termo, notificação e desconto, a data é o fato; "AZUL MOB"
// quer dizer que a empresa assumiu; "NÃO ASSINOU", termo recusado;
// "URGENTE", ainda a fazer. Aba de pontos (AIT + PONTOS) completa os pontos;
// aba de NIC (AIT NIC) traz as multas por não indicação.
// ---------------------------------------------------------------------------

export type MultaLida = {
  linha: number;
  aba: string;
  ait: string;
  placa: string;
  orgao: string;
  dataInfracao: Date;
  especificacao: string;
  valorCents: number;
  pontos: number | null;
  incluidaEm: Date | null;
  condutorNome: string | null;
  condutorNaoLocalizado: boolean;
  diarioSolicitadoEm: Date | null;
  diarioRecebidoEm: Date | null;
  responsavel: "a_definir" | "motorista" | "empresa";
  termoAssinadoEm: Date | null;
  termoRecusado: boolean;
  indicadoEm: Date | null;
  prazoIndicacao: Date | null;
  vencimentoBoleto: Date | null;
  descontoCompetencia: Date | null;
  descontoValorCents: number | null;
  situacao: "aberta" | "finalizada";
  ehNic: boolean;
  nicDeAit: string | null;
  observacao: string | null;
};
export type LeituraMultas = { multas: MultaLida[]; problemas: { aba: string; linha: number; problema: string }[]; abasLidas: string[] };

const norm = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
function valor(c: ExcelJS.CellValue): unknown {
  if (c && typeof c === "object" && !(c instanceof Date)) {
    const o = c as { result?: unknown; richText?: { text: string }[]; text?: string };
    if (o.result !== undefined) return o.result;
    if (o.richText) return o.richText.map((r) => r.text).join("");
    if (o.text !== undefined) return o.text;
  }
  return c;
}
const comoData = (v: unknown): Date | null => (v instanceof Date && !Number.isNaN(v.getTime()) && v.getUTCFullYear() > 1900 ? new Date(utc(v)) : null);
const comoTexto = (v: unknown) => (v === null || v === undefined ? "" : v instanceof Date ? "" : String(v).trim());
function comoCents(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v * 100);
  const t = comoTexto(v).replace(/R\$|\s/g, "");
  if (!t) return null;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
// Data + hora local (São Paulo, UTC−3) → instante.
function instante(data: Date, hora: unknown): Date {
  let h = 12;
  let m = 0;
  if (hora instanceof Date) {
    h = hora.getUTCHours();
    m = hora.getUTCMinutes();
  } else if (typeof hora === "number" && hora >= 0 && hora < 1) {
    const min = Math.round(hora * 24 * 60);
    h = Math.floor(min / 60);
    m = min % 60;
  } else {
    const x = /(\d{1,2})[:h](\d{2})/.exec(comoTexto(hora));
    if (x) {
      h = Number(x[1]);
      m = Number(x[2]);
    }
  }
  return new Date(Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), data.getUTCDate(), h + 3, m));
}

type Colunas = Record<string, number>;
const CAMPOS: [string, (n: string) => boolean][] = [
  ["motorista", (n) => n === "MOTORISTA" || n === "CONDUTOR"],
  ["solicitacaoDiario", (n) => n.startsWith("SOLICITACAO DIARIO")],
  ["entregaDiario", (n) => n.startsWith("ENTREGA DIARIO")],
  ["status", (n) => n.startsWith("STATUS")],
  ["inclusao", (n) => n.startsWith("DATA INCLUSAO")],
  ["placa", (n) => n === "PLACA"],
  ["data", (n) => n === "DATA INFRACAO" || n === "DATA ORIGINARIA"],
  ["hora", (n) => n === "HORA" || n === "HORA ORIGINARIA"],
  ["especificacao", (n) => n.startsWith("ESPECIFICA")],
  ["orgao", (n) => n === "ORGAO"],
  ["ait", (n) => n === "AIT" || n === "AIT ORIGINARIA"],
  ["aitNic", (n) => n === "AIT NIC"],
  ["valor", (n) => n === "VALOR"],
  ["valorNic", (n) => n === "VALOR NIC"],
  ["motivoNic", (n) => n === "MOTIVO NIC"],
  ["termo", (n) => n.startsWith("TERMO")],
  ["notificacao", (n) => n.startsWith("NOT ENCAMINHADA")],
  ["vencNot", (n) => n.startsWith("VENCT NOT")],
  ["desconto", (n) => n.startsWith("DESC")],
  ["vencBol", (n) => n.startsWith("VENCT BOL")],
  ["pontos", (n) => n === "PONTOS"],
];
function acharCabecalho(ws: ExcelJS.Worksheet): { linha: number; col: Colunas } | null {
  for (let r = 1; r <= Math.min(20, ws.rowCount); r++) {
    const col: Colunas = {};
    ws.getRow(r).eachCell({ includeEmpty: false }, (c, i) => {
      const n = norm(valor(c.value));
      for (const [campo, casa] of CAMPOS) if (col[campo] === undefined && casa(n)) col[campo] = i;
    });
    if ((col.ait !== undefined || col.aitNic !== undefined) && col.placa !== undefined) return { linha: r, col };
  }
  return null;
}

export function lerPlanilhaMultas(livro: ExcelJS.Workbook): LeituraMultas {
  const multas: MultaLida[] = [];
  const problemas: LeituraMultas["problemas"] = [];
  const abasLidas: string[] = [];
  const pontosPorAit = new Map<string, number>();
  const nics: { aba: string; linha: number; get: (k: string) => unknown }[] = [];
  for (const ws of livro.worksheets) {
    const cab = acharCabecalho(ws);
    if (!cab) continue;
    abasLidas.push(ws.name);
    for (let r = cab.linha + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const get = (k: string) => (cab.col[k] === undefined ? null : valor(row.getCell(cab.col[k]).value));
      if (cab.col.aitNic !== undefined) {
        if (comoTexto(get("aitNic"))) nics.push({ aba: ws.name, linha: r, get });
        continue;
      }
      const ait = norm(get("ait")).replace(/\s/g, "");
      if (!ait) continue;
      // Aba só de pontos (AIT + PONTOS, sem as colunas do processo).
      if (cab.col.pontos !== undefined && cab.col.termo === undefined) {
        const p = Number(get("pontos"));
        if (Number.isInteger(p) && p >= 0 && p <= 21) pontosPorAit.set(ait, p);
        continue;
      }
      const placa = normalizarPlaca(comoTexto(get("placa")));
      const data = comoData(get("data"));
      const valorCents = comoCents(get("valor"));
      if (!placa || !data || valorCents === null) {
        problemas.push({ aba: ws.name, linha: r, problema: `AIT ${ait}: ${!placa ? "placa inválida" : !data ? "sem data da infração" : "sem valor"} — linha ignorada` });
        continue;
      }
      const termo = get("termo");
      const notificacao = get("notificacao");
      const desconto = get("desconto");
      const status = norm(get("status"));
      const assumiu = [termo, notificacao, desconto].some((x) => norm(x).startsWith("AZUL"));
      const termoData = comoData(termo);
      const descontoData = comoData(desconto);
      const motorista = comoTexto(get("motorista")) || null;
      multas.push({
        linha: r,
        aba: ws.name,
        ait,
        placa,
        orgao: comoTexto(get("orgao")).slice(0, 80) || "não informado",
        dataInfracao: instante(data, get("hora")),
        especificacao: comoTexto(get("especificacao")).slice(0, 120) || "não informada",
        valorCents,
        pontos: null,
        incluidaEm: comoData(get("inclusao")),
        // "NÃO IDENTIFICADO", "NÃO LOCALIZADO", "-": marcador, não nome.
        condutorNome: motorista && !/^(N[AÃ]O |SEM |A IDENTIFICAR|DESCONHECID|-|\?)/i.test(motorista) ? motorista.slice(0, 120) : null,
        condutorNaoLocalizado: status.startsWith("NAO LOCALIZADO"),
        diarioSolicitadoEm: comoData(get("solicitacaoDiario")),
        diarioRecebidoEm: comoData(get("entregaDiario")),
        responsavel: norm(desconto).startsWith("AZUL") ? "empresa" : termoData || descontoData ? "motorista" : assumiu ? "empresa" : "a_definir",
        termoAssinadoEm: termoData,
        termoRecusado: norm(termo).startsWith("NAO ASSIN"),
        indicadoEm: comoData(notificacao),
        prazoIndicacao: comoData(get("vencNot")),
        vencimentoBoleto: comoData(get("vencBol")),
        descontoCompetencia: descontoData ? new Date(Date.UTC(descontoData.getUTCFullYear(), descontoData.getUTCMonth(), 1)) : null,
        descontoValorCents: descontoData ? valorCents : null,
        situacao: status.startsWith("FINALIZAD") ? "finalizada" : "aberta",
        ehNic: false,
        nicDeAit: null,
        observacao: null,
      });
    }
  }
  for (const m of multas) m.pontos = pontosPorAit.get(m.ait) ?? null;
  for (const n of nics) {
    const ait = norm(n.get("aitNic")).replace(/\s/g, "");
    const original = norm(n.get("ait")).replace(/\s/g, "") || null;
    const placa = normalizarPlaca(comoTexto(n.get("placa")));
    // Linha com as colunas deslocadas (o modelo na coluna da data): a data
    // vem na coluna seguinte.
    const data = comoData(n.get("data")) ?? comoData(n.get("hora"));
    const valorCents = comoCents(n.get("valorNic"));
    if (!placa || !data || valorCents === null) {
      problemas.push({ aba: n.aba, linha: n.linha, problema: `NIC ${ait}: ${!placa ? "placa inválida" : !data ? "sem data" : "sem valor"} — linha ignorada` });
      continue;
    }
    const orig = original ? multas.find((m) => m.ait === original) : undefined;
    multas.push({
      linha: n.linha,
      aba: n.aba,
      ait,
      placa,
      orgao: orig?.orgao ?? "não informado",
      dataInfracao: instante(data, n.get("hora")),
      especificacao: "NIC — não indicação do condutor",
      valorCents,
      pontos: null,
      incluidaEm: null,
      condutorNome: null,
      condutorNaoLocalizado: false,
      diarioSolicitadoEm: null,
      diarioRecebidoEm: null,
      responsavel: "empresa",
      termoAssinadoEm: null,
      termoRecusado: false,
      indicadoEm: null,
      prazoIndicacao: null,
      vencimentoBoleto: null,
      descontoCompetencia: null,
      descontoValorCents: null,
      situacao: "aberta",
      ehNic: true,
      nicDeAit: original,
      observacao: comoTexto(n.get("motivoNic")).slice(0, 300) || null,
    });
  }
  const vistos = new Map<string, MultaLida>();
  for (const m of multas) {
    const antes = vistos.get(m.ait);
    if (antes) problemas.push({ aba: m.aba, linha: m.linha, problema: `AIT ${m.ait} repetido (também na linha ${antes.linha} de ${antes.aba}) — fica a primeira` });
    else vistos.set(m.ait, m);
  }
  return { multas: [...vistos.values()], problemas, abasLidas };
}

export const descricaoDaMulta = (m: { especificacao: string; orgao: string; dataInfracao: Date }) => `${m.especificacao} · ${m.orgao} · ${br(m.dataInfracao)}`;
