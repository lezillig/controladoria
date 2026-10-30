import { ROTULO_APTIDAO, type SituacaoAptidao } from "@/lib/pessoas/documentos";
import { ROTULO_SITUACAO_PERIODO, type SituacaoPeriodo } from "@/lib/pessoas/ferias";

// Os selos das telas de motoristas: cor e texto (nunca só cor).

const COR_APTIDAO: Record<SituacaoAptidao, string> = {
  apto: "bg-emerald-50 text-emerald-700",
  nao_apto: "bg-red-100 text-red-800",
  incompleto: "bg-amber-100 text-amber-800",
  nao_se_aplica: "bg-slate-50 text-slate-400",
};
export function SeloAptidao({ situacao }: { situacao: SituacaoAptidao }) {
  return <span className={`inline-flex whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ${COR_APTIDAO[situacao]}`}>{ROTULO_APTIDAO[situacao]}</span>;
}

const COR_PERIODO: Record<SituacaoPeriodo, string> = {
  vencido: "bg-red-100 text-red-800",
  a_gozar: "bg-amber-100 text-amber-800",
  a_conferir: "bg-orange-100 text-orange-800",
  em_aquisicao: "bg-slate-100 text-slate-600",
  quitado: "bg-emerald-50 text-emerald-700",
  anterior: "bg-slate-50 text-slate-400",
};
export function SeloPeriodo({ situacao }: { situacao: SituacaoPeriodo }) {
  return <span className={`inline-flex whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ${COR_PERIODO[situacao]}`}>{ROTULO_SITUACAO_PERIODO[situacao]}</span>;
}
