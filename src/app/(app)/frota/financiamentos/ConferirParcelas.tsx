"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { conferirParcelas } from "./actions";

// O BOTÃO "Conferir parcelas com a Omie": refaz a ligação dos títulos das
// contas a pagar com os contratos (também roda sozinho no ciclo diário).

export default function ConferirParcelas() {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={ocupado}
        onClick={() =>
          iniciar(async () => {
            const r = await conferirParcelas().catch((e) => ({ erro: e instanceof Error ? e.message : "falha", resumo: undefined }));
            setMsg(r.erro ?? r.resumo ?? null);
            router.refresh();
          })
        }
        className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
      >
        {ocupado ? "Conferindo…" : "Conferir parcelas com a Omie"}
      </button>
      {msg && <span className="max-w-md text-right text-xs text-slate-600">{msg}</span>}
    </div>
  );
}
