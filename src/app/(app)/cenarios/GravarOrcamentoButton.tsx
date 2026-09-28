"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { gravarOrcamento } from "./actions";

// O BOTÃO QUE GRAVA O ORÇAMENTO. Cliente porque a ação devolve erro legível
// ("nenhum mês de 2028 no horizonte") e a pessoa precisa vê-lo no lugar em
// que clicou — um form de servidor engoliria a resposta.

export default function GravarOrcamentoButton({ cenarioId, ano, empresa, apoio }: { cenarioId: string; ano: number; empresa: string | null; apoio: string }) {
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState(false);
  const [processando, iniciar] = useTransition();
  const router = useRouter();

  return (
    <form
      className="flex items-center gap-2"
      action={(formData) => {
        setErro(null);
        formData.set("id", cenarioId);
        formData.set("ano", String(ano));
        formData.set("empresa", empresa ?? "");
        iniciar(async () => {
          const r = await gravarOrcamento(formData);
          if (r.erro) {
            setErro(r.erro);
            return;
          }
          setFeito(true);
          router.refresh();
        });
      }}
    >
      <button type="submit" disabled={processando} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60">
        {processando ? "Gravando…" : `Gravar como orçamento de ${ano}`}
      </button>
      <span className={`text-xs ${erro ? "text-red-700" : feito ? "text-emerald-700" : "text-slate-500"}`}>{erro ?? (feito ? "gravado" : apoio)}</span>
    </form>
  );
}
