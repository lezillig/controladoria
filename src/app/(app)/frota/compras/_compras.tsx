import { ROTULO_SITUACAO_COMPRA, type SituacaoCompra } from "@/lib/frota/compras";

// O selo da situação do pedido de compra (cor e texto).

const COR: Record<SituacaoCompra, string> = {
  solicitada: "bg-amber-100 text-amber-800",
  aprovada: "bg-blue-50 text-blue-800",
  rejeitada: "bg-red-100 text-red-800",
  concluida: "bg-emerald-50 text-emerald-700",
  cancelada: "bg-slate-100 text-slate-500",
};
export function SeloCompra({ s }: { s: SituacaoCompra }) {
  return <span className={`inline-flex whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ${COR[s]}`}>{ROTULO_SITUACAO_COMPRA[s]}</span>;
}
