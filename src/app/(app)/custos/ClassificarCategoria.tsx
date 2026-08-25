"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LINHAS_DRE } from "@/lib/controladoria/dre";
import { classificarCategoria } from "./actions";

// Classificação inline, na própria linha do DRE.
//
// Sem tela separada de "configuração do plano de contas" de propósito: quem
// olha o DRE e vê "Combustível" em outras despesas quer corrigir ALI, olhando
// o efeito no lucro bruto. Mandá-lo para outra tela é onde a classificação
// para pela metade — e um DRE meio classificado é um DRE errado.

const GRUPOS = LINHAS_DRE.filter((l) => l.tipo === "GRUPO");

export default function ClassificarCategoria({
  categoriaCodigo,
  linhaAtual,
  subgrupoAtual,
  confirmada,
  subgruposConhecidos,
}: {
  categoriaCodigo: string;
  linhaAtual: string;
  subgrupoAtual: string | null;
  confirmada: boolean;
  subgruposConhecidos: string[];
}) {
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className={`text-xs font-medium hover:underline ${confirmada ? "text-slate-400" : "text-amber-700"}`}
      >
        {confirmada ? "alterar" : "classificar"}
      </button>
    );
  }

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      action={(dados) => {
        setErro(null);
        dados.set("categoriaCodigo", categoriaCodigo);
        iniciar(async () => {
          const r = await classificarCategoria(dados);
          if (r.erro) { setErro(r.erro); return; }
          setAberto(false);
          router.refresh();
        });
      }}
    >
      <select
        name="linha"
        defaultValue={linhaAtual}
        className="rounded-md border border-slate-300 px-2 py-1 text-xs"
        aria-label="Linha do DRE"
      >
        {GRUPOS.map((l) => (
          <option key={l.chave} value={l.chave}>
            {l.rotulo.replace(/^\([+-]\)\s*/, "")}
          </option>
        ))}
      </select>

      <input
        name="subgrupo"
        defaultValue={subgrupoAtual ?? ""}
        list={`subgrupos-${categoriaCodigo}`}
        placeholder="subgrupo (opcional)"
        maxLength={40}
        className="w-40 rounded-md border border-slate-300 px-2 py-1 text-xs"
        aria-label="Subgrupo"
      />
      {/* Os subgrupos JÁ USADOS viram sugestão. Sem isto, "Frota", "frota" e
          "Frotas" viram três subtotais diferentes na mesma tela, e o usuário
          descobre isso depois de classificar cinquenta categorias. */}
      <datalist id={`subgrupos-${categoriaCodigo}`}>
        {subgruposConhecidos.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      <button
        type="submit"
        disabled={pendente}
        className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white disabled:cursor-wait"
      >
        {pendente ? "..." : "Salvar"}
      </button>
      <button type="button" onClick={() => setAberto(false)} className="text-xs text-slate-500 hover:underline">
        cancelar
      </button>
      {erro && <span className="text-xs text-red-700">{erro}</span>}
    </form>
  );
}
