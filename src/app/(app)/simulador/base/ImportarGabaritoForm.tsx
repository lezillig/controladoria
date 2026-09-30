"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { primaryButtonClass } from "@/lib/ui";
import { importarGabarito } from "../actions";

// Enviar o Gabarito preenchido. A gravação nunca sobrescreve: valor que mudou
// fecha a vigência do anterior e abre uma nova, e estudos já salvos continuam
// com a base do dia em que foram feitos.

const ROTULO: Record<string, string> = { parametros: "Parâmetros", veiculos: "Veículos", funcoes: "Funções", pedagios: "Pedágios", referencias: "Referências" };

export default function ImportarGabaritoForm() {
  const [processando, iniciar] = useTransition();
  const [retorno, setRetorno] = useState<Awaited<ReturnType<typeof importarGabarito>> | null>(null);
  const router = useRouter();
  return (
    <form
      className="space-y-3"
      onSubmit={(ev) => {
        ev.preventDefault();
        const dados = new FormData(ev.currentTarget);
        iniciar(async () => {
          const r = await importarGabarito(dados);
          setRetorno(r);
          if (r.ok) router.refresh();
        });
      }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <input name="arquivo" type="file" accept=".xlsx" required className="text-sm file:mr-3 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm" />
        <button className={primaryButtonClass} disabled={processando}>
          {processando ? "Importando…" : "Importar Gabarito"}
        </button>
      </div>
      {retorno?.erro && <p className="text-sm text-red-700">{retorno.erro}</p>}
      {retorno?.resumo && (
        <ul className="grid gap-1 text-sm text-slate-700 sm:grid-cols-2 lg:grid-cols-5">
          {Object.entries(retorno.resumo).map(([k, v]) => (
            <li key={k} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <span className="font-medium">{ROTULO[k] ?? k}</span>
              <span className="block text-xs text-slate-500">
                {v.novos} {v.novos === 1 ? "novo" : "novos"} · {v.alterados} {v.alterados === 1 ? "alterado" : "alterados"} · {v.inalterados} {v.inalterados === 1 ? "igual" : "iguais"}
              </span>
            </li>
          ))}
        </ul>
      )}
      {retorno?.avisos && retorno.avisos.length > 0 && (
        <details className="text-sm text-amber-800">
          <summary className="cursor-pointer">{retorno.avisos.length === 1 ? "1 aviso" : `${retorno.avisos.length} avisos`} da leitura</summary>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {retorno.avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </details>
      )}
    </form>
  );
}
