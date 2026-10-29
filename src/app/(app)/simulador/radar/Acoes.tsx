"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { abrirEstudo, decidir, varrerAgora } from "./actions";

const botao = "rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";

export function AcoesDaLicitacao({ id, status, estudoId }: { id: string; status: string; estudoId: string | null }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const rodar = (f: () => Promise<{ erro?: string; estudoId?: string }>) =>
    iniciar(async () => {
      const r = await f();
      setErro(r.erro ?? null);
      if (r.estudoId) router.push(`/simulador/${r.estudoId}`);
    });
  return (
    <div className="flex flex-wrap gap-1">
      <button className={botao} disabled={pendente} onClick={() => rodar(() => abrirEstudo(id))}>
        {estudoId ? "Ver estudo" : "Abrir estudo"}
      </button>
      {status !== "PARTICIPANDO" && (
        <button className={botao} disabled={pendente} onClick={() => rodar(() => decidir(id, "PARTICIPANDO", null))}>
          Participar
        </button>
      )}
      {status !== "DESCARTADA" ? (
        <button
          className={botao}
          disabled={pendente}
          onClick={() => {
            const motivo = window.prompt("Por que descartar? (ex.: fora da região, objeto não é transporte, valor baixo)");
            if (motivo) rodar(() => decidir(id, "DESCARTADA", motivo));
          }}
        >
          Descartar
        </button>
      ) : (
        <button className={botao} disabled={pendente} onClick={() => rodar(() => decidir(id, "NOVA", null))}>
          Voltar ao radar
        </button>
      )}
      {erro && <p className="w-full text-xs text-red-700">{erro}</p>}
    </div>
  );
}

export function VarrerAgora() {
  const [pendente, iniciar] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      <button
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        disabled={pendente}
        onClick={() =>
          iniciar(async () => {
            const r = await varrerAgora();
            const v = r.varredura;
            setMsg(
              r.erro ??
                (v
                  ? `${v.diasVarridos.length} dia(s) varrido(s), ${v.novas} licitação(ões) nova(s)` +
                    (v.diasPendentes ? `; faltam ${v.diasPendentes} dia(s) — clique de novo.` : ".") +
                    (v.erros.length ? ` PNCP: ${v.erros[0]}` : "")
                  : null)
            );
          })
        }
      >
        {pendente ? "Varrendo o PNCP (até 45 s)..." : "Varrer agora"}
      </button>
      {msg && <span className="text-xs text-slate-600">{msg}</span>}
    </div>
  );
}
