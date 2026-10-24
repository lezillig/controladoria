"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// O FILTRO DE CATEGORIAS do "custo de operação sem projeto": quais categorias
// entram na lista. A escolha vai na URL (`cat`, repetido) e fica lembrada no
// navegador para a próxima visita.

const CHAVE = "conferencia-os:categorias";

export default function FiltroCategorias({ categorias, selecionadas }: { categorias: { nome: string; cents: number; titulos: number }[]; selecionadas: string[] | null }) {
  const router = useRouter();
  const caminho = usePathname();
  const params = useSearchParams();
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set(selecionadas ?? categorias.map((c) => c.nome)));
  const [aberto, setAberto] = useState(false);

  // Sem filtro na URL, aplica o último lembrado (se ainda houver alguma dessas categorias).
  useEffect(() => {
    if (selecionadas !== null) return;
    try {
      const lembradas = JSON.parse(localStorage.getItem(CHAVE) ?? "null") as string[] | null;
      if (lembradas && lembradas.some((c) => categorias.some((x) => x.nome === c))) aplicar(new Set(lembradas), false);
    } catch {
      /* sem armazenamento: segue com todas */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function aplicar(conjunto: Set<string>, lembrar = true) {
    const q = new URLSearchParams(params.toString());
    q.delete("cat");
    const todas = categorias.every((c) => conjunto.has(c.nome));
    if (!todas) for (const c of conjunto) q.append("cat", c);
    if (todas) q.set("cat", "*");
    try {
      if (lembrar) localStorage.setItem(CHAVE, JSON.stringify(todas ? null : [...conjunto]));
    } catch {
      /* sem armazenamento */
    }
    // Reaplicado sozinho (lembrado), sem pular a tela para a seção.
    router.replace(`${caminho}?${q}${lembrar ? "#sem-projeto" : ""}`, { scroll: false });
    setAberto(false);
  }

  const alternar = (nome: string) =>
    setMarcadas((m) => {
      const n = new Set(m);
      if (n.has(nome)) n.delete(nome);
      else n.add(nome);
      return n;
    });
  const fmt = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  const total = selecionadas === null ? categorias.length : selecionadas.length;

  return (
    <div className="relative">
      <button type="button" onClick={() => setAberto((a) => !a)} className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
        Categorias: {total === categorias.length ? "todas" : `${total} de ${categorias.length}`} ▾
      </button>
      {aberto && (
        <div className="absolute right-0 z-20 mt-1 w-[min(92vw,420px)] rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
          <div className="mb-2 flex gap-2 text-xs">
            <button type="button" className="text-blue-700 hover:underline" onClick={() => setMarcadas(new Set(categorias.map((c) => c.nome)))}>
              Todas
            </button>
            <button type="button" className="text-blue-700 hover:underline" onClick={() => setMarcadas(new Set())}>
              Nenhuma
            </button>
          </div>
          <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
            {categorias.map((c) => (
              <li key={c.nome}>
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={marcadas.has(c.nome)} onChange={() => alternar(c.nome)} />
                  <span className="flex-1 text-slate-700">{c.nome}</span>
                  <span className="text-xs tabular-nums text-slate-400">
                    {c.titulos} · {fmt(c.cents)}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className="rounded-md px-3 py-1 text-xs text-slate-500 hover:bg-slate-50" onClick={() => setAberto(false)}>
              Cancelar
            </button>
            <button type="button" className="rounded-md bg-blue-700 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50" disabled={marcadas.size === 0} onClick={() => aplicar(marcadas)}>
              Aplicar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
