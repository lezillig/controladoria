"use client";

import { useFormStatus } from "react-dom";

// O botão de reler um documento leva de um a três minutos para responder: o
// modelo lê o PDF inteiro. Sem estado de "lendo", a pessoa clica, não vê
// nada acontecer, clica de novo — e cada clique é outra leitura completa.
export default function ReprocessarButton({ rotulo }: { rotulo: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-xs font-medium text-blue-700 hover:underline disabled:cursor-wait disabled:text-slate-400 disabled:no-underline"
    >
      {pending ? "lendo o documento… (1 a 3 min)" : rotulo}
    </button>
  );
}
