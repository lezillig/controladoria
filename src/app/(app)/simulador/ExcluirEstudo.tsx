"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { excluirEstudo } from "./actions";

// Excluir apaga o estudo com todas as versões, lances e acompanhamento — não
// há lixeira. Por isso pede a confirmação com o nome e o número de versões.
export default function ExcluirEstudo({ id, nome, versoes }: { id: string; nome: string; versoes: number }) {
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();
  return (
    <span className="inline-flex flex-col items-start">
      <button
        type="button"
        disabled={pendente}
        className="whitespace-nowrap text-xs font-medium text-red-700 hover:underline disabled:opacity-50"
        onClick={() => {
          const aviso = `Excluir o estudo "${nome}"${versoes ? ` e as ${versoes} versão(ões) salvas` : ""}? Não dá para desfazer.`;
          if (!window.confirm(aviso)) return;
          setErro(null);
          iniciar(async () => {
            const r = await excluirEstudo(id);
            if (r.erro) setErro(r.erro);
            else router.refresh();
          });
        }}
      >
        {pendente ? "Excluindo…" : "Excluir"}
      </button>
      {erro && <span className="text-xs text-red-700">{erro}</span>}
    </span>
  );
}
