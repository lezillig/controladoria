"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { primaryButtonClass, secondaryButtonClass } from "@/lib/ui";
import { encerrarExecucaoTravada, sincronizarAgora } from "./actions";

// Botão de sincronização manual. Mostra o retorno passo a passo em vez de um
// "pronto!" genérico: quem aperta este botão normalmente está diagnosticando
// alguma coisa, e a lista de fases com contagens é a resposta que ele procura.

const INTERVALO_ATUALIZACAO_MS = 15_000;

export default function SyncButton({
  temExecucaoTravada,
  emAndamento,
}: {
  temExecucaoTravada: boolean;
  emAndamento: boolean;
}) {
  const [mensagens, setMensagens] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [concluido, setConcluido] = useState(false);
  const [processando, iniciar] = useTransition();
  const [rodadas, setRodadas] = useState(0);
  const router = useRouter();

  // Continuação conduzida pelo NAVEGADOR, e não pelo servidor chamando a si
  // mesmo. As duas convivem de propósito: o auto-encadeamento do servidor é o
  // que faz a carga terminar com a aba fechada, mas ele depende de uma
  // requisição HTTP da função para o próprio domínio — que a proteção de
  // deploy da Vercel bloqueia em silêncio, e foi assim que a primeira carga
  // morreu por horas sem deixar rastro.
  //
  // Enquanto esta aba está aberta, a página é uma segunda fonte de avanço, sem
  // nenhuma dependência de rede entre funções: cada rodada faz 40 segundos de
  // trabalho, e a seguinte começa quando a anterior responde. Se o servidor
  // também estiver encadeando, o pior caso é as duas retomarem a mesma
  // execução — toda escrita do sync é upsert por chave natural, então repetir
  // não duplica nada.
  const continuando = useRef(false);

  const rodar = useCallback(() => {
    iniciar(async () => {
      while (continuando.current) {
        const resultado = await sincronizarAgora();
        setErro(resultado.erro ?? null);
        setMensagens(resultado.mensagens ?? []);
        setConcluido(Boolean(resultado.concluido));
        setRodadas((n) => n + 1);
        router.refresh();

        // Erro encerra a corrente: insistir sobre uma falha real só empilharia
        // a mesma mensagem a cada quarenta segundos.
        if (resultado.erro || resultado.concluido) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      continuando.current = false;
    });
  }, [router]);

  // Interrompe a corrente se a pessoa sair da página, em vez de deixar uma
  // chamada órfã em andamento.
  useEffect(() => () => { continuando.current = false; }, []);

  // Enquanto a carga anda em segundo plano, a página se atualiza sozinha.
  //
  // O trabalho continua no servidor depois que esta Server Action responde
  // (ela encadeia a rota agendada), então sem isto a barra congelaria no valor
  // do último carregamento e quem está olhando concluiria que travou —
  // exatamente a dúvida que a barra existe para responder.
  //
  // Só roda quando há execução em andamento: fora disso seria uma consulta a
  // cada quinze segundos sem nada novo para mostrar.
  useEffect(() => {
    if (!emAndamento || processando) return;
    const id = setInterval(() => router.refresh(), INTERVALO_ATUALIZACAO_MS);
    return () => clearInterval(id);
  }, [emAndamento, processando, router]);

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
            setRodadas(0);
            continuando.current = true;
            rodar();
          }}
        >
          <RefreshCw className={`h-4 w-4 ${processando ? "animate-spin" : ""}`} />
          {processando ? `Sincronizando... (rodada ${rodadas + 1})` : "Sincronizar agora"}
        </button>

        {processando && (
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={() => {
              continuando.current = false;
            }}
          >
            Parar depois desta rodada
          </button>
        )}

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
          A primeira carga histórica é longa — uma janela por mês, por empresa, desde o início da base. Enquanto esta
          aba ficar aberta a página continua puxando a carga, rodada após rodada, e a barra acima avança junto. Se você
          fechar, o ciclo em segundo plano assume; nada se perde nem se duplica.
        </p>
      )}

      {!processando && emAndamento && (
        <p className="mt-3 text-xs text-slate-500">
          Carga em andamento em segundo plano — esta página se atualiza sozinha a cada 15 segundos. Pode fechar a aba.
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
