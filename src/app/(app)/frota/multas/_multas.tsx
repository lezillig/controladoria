import { ROTULO_PASSO, type Passo, type SituacaoPrazo } from "@/lib/frota/multas";

// Os selos das telas de multas: cor e texto (nunca só cor).

const COR_PASSO: Record<Passo, string> = {
  identificar_condutor: "bg-amber-100 text-amber-800",
  aguardando_diario: "bg-slate-100 text-slate-700",
  nao_localizado: "bg-orange-100 text-orange-800",
  definir_responsavel: "bg-amber-100 text-amber-800",
  colher_termo: "bg-blue-50 text-blue-800",
  indicar_condutor: "bg-red-50 text-red-800",
  pagar: "bg-slate-100 text-slate-700",
  descontar: "bg-violet-50 text-violet-800",
  concluir: "bg-emerald-50 text-emerald-700",
};
export function SeloPasso({ passo }: { passo: Passo }) {
  return <span className={`inline-flex whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ${COR_PASSO[passo]}`}>{ROTULO_PASSO[passo]}</span>;
}

export function SeloPrazo({ situacao, dias }: { situacao: SituacaoPrazo; dias: number | null }) {
  if (situacao === "perdido") return <span className="inline-flex whitespace-nowrap rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-800">prazo perdido · risco de NIC</span>;
  if (situacao === "urgente") return <span className="inline-flex whitespace-nowrap rounded bg-orange-100 px-1.5 py-0.5 text-[11px] font-semibold text-orange-800">{dias === 0 ? "vence hoje" : `vence em ${dias} dia(s)`}</span>;
  if (situacao === "sem_prazo") return <span className="text-[11px] text-slate-400">sem prazo lançado</span>;
  return null;
}
