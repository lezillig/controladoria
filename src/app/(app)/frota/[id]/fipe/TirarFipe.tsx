"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { tirarFipe } from "../../fipe/actions";

export default function TirarFipe({ veiculoId }: { veiculoId: string }) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  return (
    <div className="text-right">
      <button
        type="button"
        disabled={ocupado}
        onClick={() => {
          if (!window.confirm("Tirar o modelo da FIPE deste veículo? O valor de mercado fica só com o preço ajustado, se houver.")) return;
          iniciar(async () => {
            const r = await tirarFipe(veiculoId);
            if (r.erro) setErro(r.erro);
            else router.refresh();
          });
        }}
        className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
      >
        {ocupado ? "Tirando…" : "Tirar da FIPE"}
      </button>
      {erro && <p className="mt-1 text-xs text-red-700">{erro}</p>}
    </div>
  );
}
