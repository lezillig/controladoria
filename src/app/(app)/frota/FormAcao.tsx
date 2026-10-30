"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

// Formulário que chama uma ação do servidor e mostra o erro dela ali mesmo
// (sem perder o que foi digitado), ou recarrega a tela quando grava.

type Resposta = { erro?: string; id?: string; ok?: boolean };

export default function FormAcao({
  acao,
  children,
  rotulo,
  classe = "",
  botaoClasse = "rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-60",
  irPara,
  limparAoGravar = false,
  confirmar,
}: {
  acao: (fd: FormData) => Promise<Resposta>;
  children: ReactNode;
  rotulo: string;
  classe?: string;
  botaoClasse?: string;
  // Depois de gravar: para onde ir ("{id}" vira o id devolvido).
  irPara?: string;
  limparAoGravar?: boolean;
  confirmar?: string;
}) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [ocupado, iniciar] = useTransition();
  return (
    <form
      ref={ref}
      className={classe}
      action={(fd) => {
        if (confirmar && !window.confirm(confirmar)) return;
        setErro(null);
        setSalvo(false);
        iniciar(async () => {
          const r = await acao(fd).catch((e) => ({ erro: e instanceof Error ? e.message : "falha na chamada" }) as Resposta);
          if (r.erro) {
            setErro(r.erro);
            return;
          }
          setSalvo(true);
          if (limparAoGravar) ref.current?.reset();
          if (irPara) router.push(irPara.replace("{id}", r.id ?? ""));
          else router.refresh();
        });
      }}
    >
      {children}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="submit" disabled={ocupado} className={botaoClasse}>
          {ocupado ? "Gravando…" : rotulo}
        </button>
        {erro && <span className="text-xs text-red-700">{erro}</span>}
        {salvo && !erro && !ocupado && <span className="text-xs text-emerald-700">Gravado.</span>}
      </div>
    </form>
  );
}
