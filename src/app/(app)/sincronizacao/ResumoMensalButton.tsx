"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Layers, ShieldCheck } from "lucide-react";
import { secondaryButtonClass } from "@/lib/ui";
import { reabrirAuditoria, recalcularResumoMensal } from "./actions";

// O CLIENTE CONDUZ O RECÁLCULO, rodada a rodada — mesmo desenho do botão de
// sincronizar, e pelo mesmo motivo: o trabalho não cabe nos sessenta segundos
// de uma função, então cada chamada faz um lote e diz quantas competências
// faltam. A aba chama de novo até zerar.
//
// Sem laço automático não seria melhor: cento e trinta e quatro competências
// exigiriam uns quatro cliques, e a pessoa não tem como saber quantos. Com o
// laço, um clique basta e o contador mostra o avanço.

export default function ResumoMensalButton() {
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [rodadas, setRodadas] = useState(0);
  const [processando, iniciar] = useTransition();
  // Interrompe o laço sem esperar a rodada em curso terminar de ser pedida.
  const continuar = useRef(true);
  const router = useRouter();

  const rodar = () => {
    continuar.current = true;
    setMensagem(null);
    setRodadas(0);

    const passo = () =>
      iniciar(async () => {
        try {
          const r = await recalcularResumoMensal();
          setRodadas((n) => n + 1);
          setMensagem(r.mensagem);
          if (r.restantes > 0 && continuar.current) {
            passo();
            return;
          }
          router.refresh();
        } catch (e) {
          // Erro vira texto na tela. A alternativa — deixar a promessa rejeitar
          // dentro da transição — é o botão voltar ao normal como se nada
          // tivesse acontecido, que foi o defeito já corrigido na conferência
          // de CT-e e não vai se repetir aqui.
          setMensagem(
            "O recálculo parou: " + (e instanceof Error ? e.message.slice(0, 200) : String(e))
          );
        }
      });

    passo();
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={processando}
          onClick={rodar}
          className={`${secondaryButtonClass} inline-flex items-center gap-2`}
        >
          <Layers className="h-4 w-4" />
          {processando ? `Recalculando... (rodada ${rodadas + 1})` : "Recalcular resumo mensal"}
        </button>
        {processando && (
          <button
            type="button"
            onClick={() => {
              continuar.current = false;
            }}
            className="text-xs font-medium text-slate-500 hover:underline"
          >
            parar depois desta rodada
          </button>
        )}
      </div>
      {mensagem && <p className="mt-2 text-xs text-slate-600">{mensagem}</p>}
    </div>
  );
}

// Botão irmão, e no mesmo arquivo de propósito: os dois existem pelo mesmo
// motivo — a base mudou sem que o espelho ficasse "desatualizado", e o ciclo
// diário não tem como saber disso sozinho.
export function ReabrirAuditoriaButton() {
  const [mensagens, setMensagens] = useState<string[]>([]);
  const [processando, iniciar] = useTransition();
  const router = useRouter();

  return (
    <div>
      <button
        type="button"
        disabled={processando}
        onClick={() =>
          iniciar(async () => {
            try {
              const r = await reabrirAuditoria();
              setMensagens(r.mensagens);
              router.refresh();
            } catch (e) {
              setMensagens([
                "Não consegui reabrir: " + (e instanceof Error ? e.message.slice(0, 200) : String(e)),
              ]);
            }
          })
        }
        className={`${secondaryButtonClass} inline-flex items-center gap-2`}
      >
        <ShieldCheck className="h-4 w-4" />
        {processando ? "Reabrindo..." : "Rodar a auditoria de novo"}
      </button>
      {mensagens.map((m, i) => (
        <p key={i} className="mt-2 text-xs text-slate-600">
          {m}
        </p>
      ))}
    </div>
  );
}
