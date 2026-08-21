"use client";

import Link from "next/link";
import { useEffect } from "react";
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
// O `digest` é a peça que faltava. O Next registra o erro completo no log da
// hospedagem e entrega ao navegador só esse identificador — o texto do erro
// fica no servidor de propósito, porque mensagem de exceção costuma carregar
// caminho de arquivo, nome de coluna e, no pior caso, trecho de dado. Mostrar
// o digest na tela permite que quem viu o erro diga QUAL erro foi, e que ele
// seja localizado no log em segundos, sem expor nada.
export default function ErroDaPagina({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Também no console do navegador: quem está com a tela aberta e o
    // inspetor ligado enxerga na hora, sem depender do painel da hospedagem.
    console.error("[controladoria] falha ao montar a página", error.digest ?? "", error);
  }, [error]);

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
            <p className="mt-2 text-xs text-slate-500">
              Se acontecer de novo, informe esse identificador junto com o nome da tela — é com ele que o erro é
              encontrado no log em segundos.
            </p>

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
