"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fmtBRL } from "@/lib/controladoria/format";
import { rotuloDeClassificacao } from "@/lib/controladoria/dre";
import { NATUREZAS, naturezaDoSubgrupo } from "@/lib/controladoria/subgrupos";
import type { Sugestao } from "@/lib/controladoria/reclassificacoes";
import type { ComposicaoCategoria } from "@/lib/controladoria/composicaoCategoria";
import DetalheCategoria from "./DetalheCategoria";
import { primaryButtonClass } from "@/lib/ui";
import { aplicarReclassificacoes } from "../actions";

const rotulo = (linha: string) =>
  rotuloDeClassificacao(linha)
    .replace(/^\([+-]\)\s*/, "")
    .replace(/ \(operação ou corporativo, pela empresa\)$/, "");

function Destino({ linha, subgrupo, apagado }: { linha: string; subgrupo: string | null; apagado?: boolean }) {
  const natureza = naturezaDoSubgrupo(linha, subgrupo);
  return (
    <span className={apagado ? "text-slate-500" : "text-slate-900"}>
      {rotulo(linha)}
      {subgrupo && (
        <span className="text-slate-500">
          {" · "}
          {subgrupo}
          {natureza && (
            <span title={NATUREZAS[natureza].rotulo} className="ml-1 rounded bg-slate-100 px-1 text-[10px] font-semibold text-slate-500">
              {NATUREZAS[natureza].sigla}
            </span>
          )}
        </span>
      )}
    </span>
  );
}

export default function ListaSugestoes({
  sugestoes,
  podeClassificar,
  composicoes,
}: {
  sugestoes: Sugestao[];
  podeClassificar: boolean;
  composicoes: Record<string, ComposicaoCategoria>;
}) {
  const [abertas, setAbertas] = useState<Set<string>>(() => new Set());
  const abrir = (codigo: string) =>
    setAbertas((m) => {
      const n = new Set(m);
      if (n.has(codigo)) n.delete(codigo);
      else n.add(codigo);
      return n;
    });
  // Todas marcadas de início: a lista já é a revisão; quem discorda desmarca.
  const [marcadas, setMarcadas] = useState<Set<string>>(() => new Set(sugestoes.map((s) => s.codigo)));
  const [erro, setErro] = useState<string | null>(null);
  const [aplicadas, setAplicadas] = useState<number | null>(null);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  const total = useMemo(() => sugestoes.filter((s) => marcadas.has(s.codigo)).length, [sugestoes, marcadas]);
  const alternar = (codigo: string) =>
    setMarcadas((m) => {
      const n = new Set(m);
      if (n.has(codigo)) n.delete(codigo);
      else n.add(codigo);
      return n;
    });

  if (sugestoes.length === 0) return <p className="py-6 text-center text-sm text-slate-500">Nenhuma sugestão: as classificações já seguem a revisão.</p>;

  const gravar = () => {
    setErro(null);
    setAplicadas(null);
    const itens = sugestoes.filter((s) => marcadas.has(s.codigo)).map((s) => ({ codigo: s.codigo, linha: s.para.linha, subgrupo: s.para.subgrupo }));
    iniciar(async () => {
      const r = await aplicarReclassificacoes(JSON.stringify(itens));
      if (r.erro) setErro(r.erro);
      else {
        setAplicadas(r.aplicadas ?? 0);
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-4">
      {podeClassificar && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={gravar} disabled={pendente || total === 0} className={primaryButtonClass}>
            {pendente ? "Gravando…" : `Gravar ${total} reclassificaç${total === 1 ? "ão" : "ões"}`}
          </button>
          <button type="button" onClick={() => setMarcadas(new Set(sugestoes.map((s) => s.codigo)))} className="text-xs font-medium text-blue-700 hover:underline">
            Marcar todas
          </button>
          <button type="button" onClick={() => setMarcadas(new Set())} className="text-xs font-medium text-blue-700 hover:underline">
            Desmarcar todas
          </button>
          {erro && <span className="text-sm text-red-700">{erro}</span>}
          {aplicadas !== null && !erro && <span className="text-sm text-emerald-700">{aplicadas} gravada(s).</span>}
        </div>
      )}

      <div className="-mx-6 overflow-x-auto px-6">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              {podeClassificar && <th className="w-8 px-2 py-2"></th>}
              <th className="px-3 py-2">Categoria</th>
              <th className="px-3 py-2 text-right">12 meses</th>
              <th className="px-3 py-2">Sai de</th>
              <th className="px-3 py-2">Vai para</th>
              <th className="px-3 py-2">Por quê</th>
            </tr>
          </thead>
          <tbody>
            {sugestoes.map((s, i) => {
              const primeiraDeSubgrupo = s.tipo === "SUBGRUPO" && (i === 0 || sugestoes[i - 1].tipo === "LINHA");
              const aberta = abertas.has(s.codigo);
              return (
                <Fragment key={s.codigo}>
                <tr
                  className={`border-b border-slate-100 align-top ${primeiraDeSubgrupo ? "border-t-2 border-t-slate-300" : ""} ${marcadas.has(s.codigo) ? "" : "opacity-50"}`}
                >
                  {podeClassificar && (
                    <td className="px-2 py-2.5">
                      <input
                        type="checkbox"
                        checked={marcadas.has(s.codigo)}
                        onChange={() => alternar(s.codigo)}
                        aria-label={`Aplicar a sugestão de ${s.descricao}`}
                      />
                    </td>
                  )}
                  <td className="px-3 py-2.5">
                    <span className="font-medium text-slate-900">{s.descricao}</span>
                    <span className="ml-1 text-xs text-slate-400">{s.codigo}</span>
                    {!s.de.confirmada && <span className="ml-1 text-xs text-amber-700">(proposta automática)</span>}
                    <button
                      type="button"
                      onClick={() => abrir(s.codigo)}
                      aria-expanded={aberta}
                      className="mt-0.5 block text-xs font-medium text-blue-700 hover:underline"
                    >
                      {aberta ? "fechar detalhe" : "ver o que é"}
                    </button>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtBRL(s.valorCents)}</td>
                  <td className="px-3 py-2.5 text-xs">
                    <Destino linha={s.de.linha} subgrupo={s.de.subgrupo} apagado />
                  </td>
                  <td className="px-3 py-2.5 text-xs font-medium">
                    <Destino linha={s.para.linha} subgrupo={s.para.subgrupo} />
                  </td>
                  <td className="max-w-md px-3 py-2.5 text-xs text-slate-600">{s.motivo}</td>
                </tr>
                {aberta && (
                  <tr className="border-b border-slate-200 bg-slate-50/70">
                    <td colSpan={podeClassificar ? 6 : 5} className="px-3 py-3">
                      <DetalheCategoria composicao={composicoes[s.codigo]} />
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
