import Link from "next/link";
import type { Alerta } from "@/lib/frota/documentos";
import { ROTULO_COBERTURA, type CoberturaApolice } from "@/lib/frota/controles";

// Peças das telas de frota: os selos de situação, com cor e texto (nunca só
// cor), e o nome do veículo.

const COR_ALERTA: Record<Alerta, string> = {
  vencido: "bg-red-100 text-red-800",
  "7": "bg-orange-100 text-orange-800",
  "30": "bg-amber-100 text-amber-800",
  "60": "bg-yellow-50 text-yellow-800",
  ok: "bg-emerald-50 text-emerald-700",
  sem_data: "bg-slate-100 text-slate-600",
  nao_se_aplica: "bg-slate-50 text-slate-400",
};
export const ROTULO_ALERTA: Record<Alerta, string> = {
  vencido: "vencido",
  "7": "vence em 7 dias",
  "30": "vence em 30 dias",
  "60": "vence em 60 dias",
  ok: "em dia",
  sem_data: "sem data",
  nao_se_aplica: "não se aplica",
};

export function SeloAlerta({ alerta, texto }: { alerta: Alerta | null; texto?: string }) {
  if (!alerta) return <span className="text-xs text-slate-400">—</span>;
  return <span className={`inline-flex whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ${COR_ALERTA[alerta]}`}>{texto ?? ROTULO_ALERTA[alerta]}</span>;
}

const COR_COBERTURA: Record<CoberturaApolice, string> = {
  coberto: "bg-emerald-50 text-emerald-700",
  vence_em_breve: "bg-amber-100 text-amber-800",
  vencida: "bg-red-100 text-red-800",
  sem_apolice: "bg-red-100 text-red-800",
  sem_vencimento: "bg-amber-100 text-amber-800",
  segmento_incompativel: "bg-orange-100 text-orange-800",
  nao_se_aplica: "bg-slate-50 text-slate-400",
};
export function SeloCobertura({ cobertura }: { cobertura: CoberturaApolice }) {
  return <span className={`inline-flex whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ${COR_COBERTURA[cobertura]}`}>{ROTULO_COBERTURA[cobertura]}</span>;
}

const COR_STATUS: Record<string, string> = { ativo: "text-emerald-700", manutencao: "text-amber-700", reserva: "text-slate-600", vendido: "text-slate-400", baixado: "text-slate-400" };
export function SeloStatus({ status, rotulo }: { status: string; rotulo: string }) {
  return <span className={`text-xs font-semibold ${COR_STATUS[status] ?? "text-slate-600"}`}>{rotulo}</span>;
}

export function NomeVeiculo({ v, link = true }: { v: { id: string; placa: string | null; chassi: string | null }; link?: boolean }) {
  const nome = v.placa ?? `sem placa · …${(v.chassi ?? "").slice(-6)}`;
  return link ? (
    <Link href={`/frota/${v.id}`} className="font-mono font-semibold text-blue-800 hover:underline">
      {nome}
    </Link>
  ) : (
    <span className="font-mono font-semibold">{nome}</span>
  );
}
