"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { primaryButtonClass, secondaryButtonClass } from "@/lib/ui";
import { importarHistorico } from "./actions";

// Traz as duas simulações feitas em planilha (Holambra e São José dos Pinhais)
// como estudos. Idempotente: o que já existe fica como está.
export default function ImportarHistoricoBotao({ discreto = false }: { discreto?: boolean }) {
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [processando, iniciar] = useTransition();
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={processando}
        className={discreto ? secondaryButtonClass : primaryButtonClass}
        onClick={() =>
          iniciar(async () => {
            const r = await importarHistorico();
            setMensagem(r.erro ?? r.mensagem ?? null);
            router.refresh();
          })
        }
      >
        {processando ? "Importando…" : "Importar simulações de Holambra e São José dos Pinhais"}
      </button>
      {mensagem && <span className="text-xs text-slate-600">{mensagem}</span>}
    </div>
  );
}
