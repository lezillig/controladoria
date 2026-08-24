"use client";

import { useState, useTransition } from "react";
import { RotateCcw } from "lucide-react";
import { relerJanela } from "./actions";

// RELER UMA JANELA — com confirmação, porque a ação consome API da Omie.
//
// Não é destrutiva: apaga o registro da execução, não os dados espelhados. Mas
// dispara uma releitura completa daquele mês na próxima sincronização, e isso
// custa chamadas nas duas contas. Um clique sem querer numa lista de vinte
// linhas não pode virar meia hora de carga.
export default function RelerJanelaButton({
  conexaoId,
  janelaInicio,
  rotulo,
}: {
  conexaoId: string;
  janelaInicio: string;
  rotulo: string;
}) {
  const [pendente, iniciar] = useTransition();
  const [confirmando, setConfirmando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);

  if (mensagem) return <span className="text-xs text-emerald-700">{mensagem}</span>;

  const executar = () => {
    const dados = new FormData();
    dados.set("conexaoId", conexaoId);
    dados.set("janelaInicio", janelaInicio);
    iniciar(async () => {
      const r = await relerJanela(dados);
      setMensagem(r.mensagens?.[0] ?? "Marcada para releitura.");
    });
  };

  if (confirmando) {
    return (
      <span className="inline-flex items-center gap-2">
        <button
          type="button"
          onClick={executar}
          disabled={pendente}
          className="rounded-lg bg-amber-600 px-2 py-1 text-xs font-medium text-white disabled:cursor-wait"
        >
          {pendente ? "Marcando…" : `Reler ${rotulo}`}
        </button>
        <button
          type="button"
          onClick={() => setConfirmando(false)}
          disabled={pendente}
          className="text-xs text-slate-500 hover:underline"
        >
          cancelar
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirmando(true)}
      className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
    >
      <RotateCcw className="h-3 w-3" />
      Reler
    </button>
  );
}
