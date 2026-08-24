"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { cardClass, primaryButtonClass, secondaryButtonClass } from "@/lib/ui";

// TELA DE ERRO DAS PÁGINAS DO SISTEMA.
//
// Sem isto, uma falha de servidor mostra a página branca padrão do Next —
// "A server error occurred. Reload to try again." — que não diz em que tela o
// erro aconteceu, não diz o que fazer e, principalmente, não deixa rastro
// nenhum para quem vai consertar. Foi exatamente o que aconteceu na tela de
// resultado mês a mês: erro visível, causa invisível.
//
// O `digest` é a peça que liga os dois lados. O Next entrega ao navegador só
// esse identificador — o texto do erro fica no servidor de propósito, porque
// mensagem de exceção costuma carregar caminho de arquivo, nome de coluna e,
// no pior caso, trecho de dado.
//
// Mostrar só o número, porém, não bastou: "informe esse identificador" virou,
// na prática, uma ida ao painel da hospedagem a cada falha. Agora o servidor
// guarda a mensagem já redigida (ver falhas.ts) e ESTA TELA A BUSCA, pelo
// mesmo digest que acabou de receber. Quem viu o erro passa a ver também o que
// ele foi, sem sair da página.
//
// A busca é do lado do cliente, e não passada por props, porque o registro é
// gravado pelo gancho `onRequestError` — que roda em paralelo com a renderização
// desta tela. No instante em que ela monta, a linha pode ainda não existir; por
// isso a consulta tem uma segunda tentativa curta e, se não achar, a tela
// simplesmente volta a ser o que era. Nunca insiste além disso: erro que fica
// recarregando sozinho vira o segundo problema.
export default function ErroDaPagina({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [causa, setCausa] = useState<string | null>(null);

  useEffect(() => {
    // Também no console do navegador: quem está com a tela aberta e o
    // inspetor ligado enxerga na hora, sem depender do painel da hospedagem.
    console.error("[controladoria] falha ao montar a página", error.digest ?? "", error);
  }, [error]);

  useEffect(() => {
    const digest = error.digest;
    if (!digest) return;

    let cancelado = false;
    const buscar = async () => {
      // Duas tentativas, espaçadas: a primeira quase sempre chega antes da
      // gravação terminar.
      for (const espera of [400, 1600]) {
        await new Promise((r) => setTimeout(r, espera));
        if (cancelado) return;
        try {
          const res = await fetch(`/api/falha/${encodeURIComponent(digest)}`, { cache: "no-store" });
          if (!res.ok) continue;
          const dados: { mensagem?: string } = await res.json();
          if (!cancelado && dados.mensagem) {
            setCausa(dados.mensagem);
            return;
          }
        } catch {
          // Rede indisponível ou sessão expirada: a tela continua útil sem
          // isto, e insistir só atrasaria quem quer clicar em "tentar de novo".
          return;
        }
      }
    };
    void buscar();

    return () => {
      cancelado = true;
    };
  }, [error.digest]);

  return (
    <div className="max-w-2xl">
      <div className={cardClass}>
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <h1 className="text-base font-semibold text-slate-900">Esta tela não conseguiu carregar</h1>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">
              O erro aconteceu no servidor, ao montar a página. Os dados não foram alterados — nenhuma tela deste
              sistema grava alguma coisa só por ser aberta.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              Tente de novo: boa parte das falhas assim é momentânea — uma publicação em andamento ou o banco
              respondendo devagar.
            </p>

            {error.digest && (
              <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 font-mono text-xs text-slate-700">
                Identificador do erro: {error.digest}
              </p>
            )}
            {causa ? (
              <p className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs leading-relaxed text-slate-700">
                <span className="font-medium text-slate-900">O que aconteceu: </span>
                {causa}
              </p>
            ) : (
              <p className="mt-2 text-xs text-slate-500">
                Se acontecer de novo, informe esse identificador junto com o nome da tela. A lista completa de falhas,
                com a causa de cada uma, fica em <strong>Sincronização</strong>.
              </p>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={reset} className={primaryButtonClass}>
                Tentar de novo
              </button>
              <Link href="/" className={secondaryButtonClass}>
                Voltar ao painel
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
