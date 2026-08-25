"use client";

import { useState, useTransition } from "react";
import { RotateCcw } from "lucide-react";
import { inputClass, labelClass } from "@/lib/ui";
import { relerPeriodo } from "./actions";

// RELER UM PERÍODO — para depois de corrigir dado na Omie.
//
// Fica separado do botão "Reler" da lista de janelas com erro, e não junto
// dela, porque responde outra pergunta. Lá: "esta janela falhou, refaça". Aqui:
// "a janela carregou bem, mas o dado mudou na Omie depois". A segunda é a que
// acontece toda vez que alguém conserta um lançamento — e não tinha caminho
// nenhum na tela.
//
// Confirmação antes de executar, como no botão da lista: cada mês é uma carga
// completa nas contas Omie.
export default function RelerPeriodoForm({
  conexoes,
  mesPadrao,
}: {
  conexoes: { id: string; apelido: string; nome: string }[];
  mesPadrao: string;
}) {
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [mensagens, setMensagens] = useState<string[] | null>(null);

  return (
    <form
      className="space-y-4"
      action={(dados) => {
        setErro(null);
        setMensagens(null);
        iniciar(async () => {
          const r = await relerPeriodo(dados);
          if (r.erro) setErro(r.erro);
          else setMensagens(r.mensagens ?? ["Marcado para releitura."]);
        });
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className={labelClass} htmlFor="reler-de">
            De
          </label>
          <input id="reler-de" name="de" type="month" required defaultValue={mesPadrao} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="reler-ate">
            Até
          </label>
          <input id="reler-ate" name="ate" type="month" required defaultValue={mesPadrao} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="reler-empresa">
            Empresa
          </label>
          <select id="reler-empresa" name="conexaoId" defaultValue="" className={inputClass}>
            <option value="">Todas</option>
            {conexoes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.apelido} — {c.nome}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pendente}
          className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white disabled:cursor-wait"
        >
          <RotateCcw className="h-4 w-4" />
          {pendente ? "Marcando…" : "Marcar para releitura"}
        </button>
        <span className="text-xs text-slate-500">
          Não apaga dado nenhum: marca as janelas para serem lidas de novo, gravando por cima. Até 12 meses por vez.
        </span>
      </div>

      {erro && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p>}
      {mensagens && (
        <div className="space-y-1 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {mensagens.map((m, i) => (
            <p key={i}>{m}</p>
          ))}
        </div>
      )}
    </form>
  );
}
