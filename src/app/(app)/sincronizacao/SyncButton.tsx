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

// Sinalizador de "a carga foi pedida e ainda não terminou". Fica no navegador
// de quem pediu — não é estado do sistema, é intenção de quem está na tela.
const MARCA_CARGA = "controladoria:carga-em-andamento";

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

  // A intenção de continuar sobrevive ao recarregamento da página.
  //
  // Isto é uma armadilha real, não uma hipótese: para ver o progresso a pessoa
  // recarrega a página, e recarregar levava a corrente junto. O sintoma era a
  // carga parar sozinha logo depois de alguém conferir se ela estava andando.
  //
  // A marca fica no navegador, é apenas um sinalizador, e some quando a carga
  // termina, dá erro ou a pessoa manda parar. Cada leitura e escrita vai
  // protegida: navegação anônima e políticas de site que bloqueiam
  // armazenamento fazem o acesso lançar, e uma tela de sincronização não pode
  // quebrar por causa disso.
  const marcar = (ligado: boolean) => {
    try {
      if (ligado) localStorage.setItem(MARCA_CARGA, "1");
      else localStorage.removeItem(MARCA_CARGA);
    } catch {
      // Sem armazenamento a corrente continua funcionando nesta aba; ela só
      // não sobrevive a um recarregamento.
    }
  };

  const rodar = useCallback(() => {
    iniciar(async () => {
      while (continuando.current) {
        // Sem encadear pelo servidor: esta aba já é o motor, e dois motores
        // sobre a mesma execução só gastam invocação.
        const resultado = await sincronizarAgora({ encadear: false });
        setErro(resultado.erro ?? null);
        setMensagens(resultado.mensagens ?? []);
        setConcluido(Boolean(resultado.concluido));
        setRodadas((n) => n + 1);
        router.refresh();

        // Erro encerra a corrente: insistir sobre uma falha real só empilharia
        // a mesma mensagem a cada quarenta segundos.
        if (resultado.erro || resultado.concluido) {
          try {
            localStorage.removeItem(MARCA_CARGA);
          } catch {}
          break;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      continuando.current = false;
    });
  }, [router]);

  // Retoma sozinha ao abrir a página, se a carga tinha sido pedida e ainda há
  // execução em andamento. Sem isto, o recarregamento que a pessoa faz para
  // conferir o progresso é o que interrompe o progresso.
  useEffect(() => {
    let pedida = false;
    try {
      pedida = localStorage.getItem(MARCA_CARGA) === "1";
    } catch {
      pedida = false;
    }
    if (!pedida || !emAndamento || continuando.current) return;
    continuando.current = true;
    rodar();
    // Só na montagem: depois disso quem comanda é o botão.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sem limpeza no desmonte, de propósito.
  //
  // A versão anterior zerava a corrente ao desmontar, e isso a matava sozinha:
  // cada rodada chama `router.refresh()` para a barra avançar, e qualquer
  // remontagem que o refresh provoque disparava a limpeza. A carga parava sem
  // erro, sem recusa de encadeamento e sem ninguém ter pedido — exatamente o
  // sintoma observado.
  //
  // Não há chamada órfã a evitar: quem sai da página leva o JavaScript junto,
  // e a Server Action que estiver no ar termina do lado do servidor, gravando
  // o que já processou. Toda escrita é upsert por chave natural, então nada
  // fica pela metade.

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
            marcar(true);
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
              marcar(false);
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
          Há execução em andamento — esta página se atualiza sozinha a cada 15 segundos. Se a barra não avançar, use
          Sincronizar agora: a aba passa a conduzir a carga e continua mesmo que você recarregue a página.
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
