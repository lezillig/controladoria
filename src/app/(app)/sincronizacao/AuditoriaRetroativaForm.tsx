"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { History } from "lucide-react";
import { inputClass, labelClass, secondaryButtonClass } from "@/lib/ui";
import { auditarAnoPassado } from "./actions";

// AUDITAR O PASSADO — um ano por vez.
//
// O ciclo diário cuida do presente. Este formulário responde à pergunta que
// todo achado levanta: "isso já vinha acontecendo?". Escolhe-se um ano da base
// e os mesmos agentes rodam sobre ele. A ação leva de dezenas de segundos a
// alguns minutos (um ano inteiro de títulos e baixas); a página espera.
export default function AuditoriaRetroativaForm({
  anos,
  abertosPorAno,
}: {
  anos: number[];
  abertosPorAno: Record<number, number>;
}) {
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [mensagens, setMensagens] = useState<string[] | null>(null);
  const router = useRouter();
  // O ano anterior é o padrão: o corrente já é auditado todo dia.
  const padrao = anos.length > 1 ? anos[anos.length - 2] : anos[0];

  return (
    <form
      className="space-y-3"
      action={(dados) => {
        setErro(null);
        setMensagens(null);
        iniciar(async () => {
          const r = await auditarAnoPassado(dados);
          if (r.erro) setErro(r.erro);
          else {
            setMensagens(r.mensagens ?? ["Concluído."]);
            router.refresh();
          }
        });
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className={labelClass} htmlFor="retro-ano">
            Ano
          </label>
          <select id="retro-ano" name="ano" defaultValue={padrao} className={inputClass}>
            {anos.map((a) => (
              <option key={a} value={a}>
                {a}
                {abertosPorAno[a] ? ` — ${abertosPorAno[a]} achado(s) em aberto` : ""}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={pendente} className={`${secondaryButtonClass} inline-flex items-center gap-2`}>
          <History className="h-4 w-4" />
          {pendente ? "Auditando o ano… (pode levar alguns minutos)" : "Auditar este ano"}
        </button>
      </div>
      <p className="text-xs text-slate-500">
        Roda todos os agentes sobre o ano escolhido e grava só os fatos datados naquele ano. Não mexe nos achados do
        ano corrente nem em tratativa já feita. Pode ser repetida: o que já existe é reconhecido pela chave.
      </p>
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
