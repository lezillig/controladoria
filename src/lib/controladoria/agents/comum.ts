import type { AuditSeveridade, OmieTitulo } from "@prisma/client";
import type { ContextoAuditoria } from "../types";
import { diasEntre, inicioDoAno } from "../periodos";

// Utilitarios compartilhados pelos agentes. Nada aqui decide severidade por
// valor fixo em reais chutado no codigo — ver materialidade().

export function titulosAtivos(ctx: ContextoAuditoria, natureza: "PAGAR" | "RECEBER"): OmieTitulo[] {
  return ctx.titulos.filter((t) => t.natureza === natureza && !t.cancelado);
}

export function emAberto(t: OmieTitulo): boolean {
  if (t.cancelado) return false;
  if (t.liquidado) return false;
  // Sem saldo informado pela Omie, cai para a diferenca entre documento e
  // pago — o que sobra e o que ainda deve.
  const saldo = t.saldoCents ?? t.valorDocumentoCents - t.valorPagoCents;
  return saldo > 0;
}

export function saldoAberto(t: OmieTitulo): number {
  return t.saldoCents ?? Math.max(0, t.valorDocumentoCents - t.valorPagoCents);
}

export function diasDeAtraso(t: OmieTitulo, referencia: Date): number {
  return diasEntre(t.dataVencimento, referencia);
}

export function agrupar<T>(itens: T[], chave: (item: T) => string): Map<string, T[]> {
  const mapa = new Map<string, T[]>();
  for (const item of itens) {
    const k = chave(item);
    const lista = mapa.get(k);
    if (lista) lista.push(item);
    else mapa.set(k, [item]);
  }
  return mapa;
}

export function somar<T>(itens: T[], valor: (item: T) => number): number {
  return itens.reduce((acc, item) => acc + valor(item), 0);
}

// MATERIALIDADE — conceito basico de auditoria trazido pro codigo: o que e
// "muito dinheiro" nao e um numero fixo, e uma fracao do volume da empresa.
// Sem isso, um limiar chumbado (ex.: "acima de R$ 10 mil e critico") ficaria
// grosseiro demais para uma empresa que cresce e sensivel demais para uma
// que encolhe — e, pior, encheria a tela de achado irrelevante no primeiro
// mes de uso, que e como um sistema de auditoria morre.
//
// 0,5% do total pago no ano corrente, com piso de R$ 500 (abaixo disso o
// custo de investigar supera o valor em risco).
export function materialidadeCents(ctx: ContextoAuditoria): number {
  const inicio = inicioDoAno(ctx.dataReferencia);
  const pagoNoAno = somar(
    ctx.baixas.filter((b) => b.dataBaixa >= inicio),
    (b) => Math.abs(b.valorCents)
  );
  return Math.max(50_000, Math.round(pagoNoAno * 0.005));
}

export function severidadePorValor(valorCents: number, materialidade: number): AuditSeveridade {
  const razao = Math.abs(valorCents) / Math.max(1, materialidade);
  if (razao >= 10) return "CRITICA";
  if (razao >= 3) return "ALTA";
  if (razao >= 1) return "MEDIA";
  return "BAIXA";
}

// Eleva a severidade em um nivel — usado quando um achado ja materialmente
// relevante ganha um agravante (ex.: valor alto E indicio de intencao).
export function agravar(s: AuditSeveridade): AuditSeveridade {
  const escala: AuditSeveridade[] = ["INFO", "BAIXA", "MEDIA", "ALTA", "CRITICA"];
  const i = escala.indexOf(s);
  return escala[Math.min(escala.length - 1, i + 1)];
}

export function nomeParceiro(ctx: ContextoAuditoria, t: OmieTitulo): string {
  if (t.parceiroNome) return t.parceiroNome;
  const p = ctx.parceiros.find((x) => x.codigoOmie === t.parceiroCodigo);
  return p?.nome ?? "(fornecedor não identificado)";
}

export function referenciaTitulo(t: OmieTitulo): string {
  const doc = t.numeroDocumento ? `doc ${t.numeroDocumento}` : `lanç. ${t.codigoLancamento}`;
  const base = t.numeroParcela ? `${doc} · parcela ${t.numeroParcela}` : doc;
  // A empresa de origem entra na referencia porque, com duas contas Omie no
  // ar, "doc 8842" sozinho e ambiguo: existe nas duas.
  return `${base} (${t.conexaoApelido})`;
}

// Identificador do titulo dentro do grupo, para chave de achado. Precisa da
// conexao: a numeracao de lancamento e independente em cada conta Omie, entao
// o titulo 12345 existe na Azul e na MCZ e sao documentos diferentes. Sem
// isso, um achado de uma empresa sobrescreveria o da outra na deduplicacao.
export function refTitulo(t: OmieTitulo): string {
  return `${t.conexaoApelido}:${t.codigoLancamento}`;
}

// Chave de agrupamento de parceiro. Prefere o CNPJ/CPF ao codigo da Omie de
// proposito: o mesmo fornecedor tem codigo DIFERENTE em cada conta Omie, e
// agrupar por codigo esconderia justamente o que mais interessa numa auditoria
// de grupo — a mesma nota paga pelas duas empresas, o volume real com um
// fornecedor, a concentracao verdadeira. Sem documento no cadastro, cai para
// codigo qualificado pela conexao (nunca cruza empresas por engano).
export function chaveParceiro(t: { parceiroDocumento?: string | null; parceiroCodigo: string | null; parceiroNome: string | null; conexaoApelido: string }): string {
  if (t.parceiroDocumento) return `doc:${t.parceiroDocumento}`;
  if (t.parceiroCodigo) return `${t.conexaoApelido}:${t.parceiroCodigo}`;
  return `nome:${(t.parceiroNome ?? "?").toUpperCase()}`;
}

// Chave de deduplicacao do achado. Deterministica e legivel: o mesmo fato,
// reavaliado amanha, produz exatamente a mesma chave e reencontra o achado
// (preservando a tratativa que uma pessoa ja escreveu nele) em vez de criar
// um novo. Ver AuditFinding.chave no schema.
export function chaveAchado(regra: string, ...partes: (string | number | null | undefined)[]): string {
  return [regra, ...partes.map((p) => (p === null || p === undefined ? "-" : String(p)))].join("|").slice(0, 400);
}

// Rotulo de periodo usado dentro de chaves de achado agregado (ex.: "custo
// da categoria X subiu no mes"): sem ele, o achado do mes passado e o deste
// mes colidiriam na mesma chave e um sobrescreveria o outro.
export function chaveMes(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
