"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { primaryButtonClass, secondaryButtonClass } from "@/lib/ui";
import { encerrarExecucaoTravada, sincronizarAgora } from "./actions";

// Botão de sincronização manual. Mostra o retorno passo a passo em vez de um
// "pronto!" genérico: quem aperta este botão normalmente está diagnosticando
// alguma coisa, e a lista de fases com contagens é a resposta que ele procura.

export default function SyncButton({ temExecucaoTravada }: { temExecucaoTravada: boolean }) {
  const [mensagens, setMensagens] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [concluido, setConcluido] = useState(false);
  const [processando, iniciar] = useTransition();
  const router = useRouter();

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={processando}
          className={`${primaryButtonClass} inline-flex items-center gap-2`}
          onClick={() => {
            setErro(null);
            setMensagens([]);
            setConcluido(false);
            iniciar(async () => {
              const resultado = await sincronizarAgora();
              if (resultado.erro) setErro(resultado.erro);
              setMensagens(resultado.mensagens ?? []);
              setConcluido(Boolean(resultado.concluido));
              router.refresh();
            });
          }}
        >
          <RefreshCw className={`h-4 w-4 ${processando ? "animate-spin" : ""}`} />
          {processando ? "Sincronizando..." : "Sincronizar agora"}
        </button>

        {temExecucaoTravada && (
          <button
            type="button"
            disabled={processando}
            className={secondaryButtonClass}
            onClick={() => {
              iniciar(async () => {
                const resultado = await encerrarExecucaoTravada();
                setMensagens(resultado.mensagens ?? []);
                router.refresh();
              });
            }}
          >
            Encerrar execução travada
          </button>
        )}
      </div>

      {processando && (
        <p className="mt-3 text-xs text-slate-500">
          A primeira carga histórica é longa (uma janela por mês desde o início da base). Esta execução processa o que
          couber no tempo; o restante continua automaticamente na próxima rodada.
        </p>
      )}

      {erro && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p>}

      {mensagens.length > 0 && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          {concluido && <p className="mb-2 text-sm font-medium text-emerald-700">Ciclo concluído.</p>}
          <ul className="space-y-1 text-xs text-slate-600">
            {mensagens.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
