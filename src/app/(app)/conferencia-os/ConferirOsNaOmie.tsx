"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { conferirLevaNaOmie } from "./actions";
import type { TituloConferido } from "@/lib/controladoria/conferenciaOsOmie";

// O BOTÃO "Conferir esta OS na Omie": cada título do detalhe consultado na
// Omie, leva por leva, com o que mudou e foi corrigido no espelho.

const LEVA = 10;
const CAMPO = { existencia: "existência", projeto: "projeto", valor: "valor", vencimento: "vencimento", cancelado: "cancelamento" } as const;

export default function ConferirOsNaOmie({ titulos }: { titulos: { id: string; rotulo: string }[] }) {
  const router = useRouter();
  const [feitos, setFeitos] = useState<TituloConferido[]>([]);
  const [rodando, setRodando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function rodar() {
    setRodando(true);
    setErro(null);
    setFeitos([]);
    const pendentes = titulos.map((t) => t.id);
    let houveMudanca = false;
    while (pendentes.length > 0) {
      const leva = pendentes.slice(0, LEVA);
      const r = await conferirLevaNaOmie(leva).catch((e) => ({ titulos: [] as TituloConferido[], erro: e instanceof Error ? e.message : "falha na chamada" }));
      if (r.erro) setErro(r.erro);
      if (r.titulos.length === 0) break;
      const vistos = new Set(r.titulos.map((t) => t.id));
      for (let i = pendentes.length - 1; i >= 0; i--) if (vistos.has(pendentes[i])) pendentes.splice(i, 1);
      houveMudanca ||= r.titulos.some((t) => t.situacao === "corrigido" || t.situacao === "excluido");
      setFeitos((x) => [...x, ...r.titulos]);
    }
    setRodando(false);
    if (houveMudanca) router.refresh();
  }

  const rotulo = new Map(titulos.map((t) => [t.id, t.rotulo]));
  const divergentes = feitos.filter((t) => t.situacao !== "igual");
  return (
    <div className="mt-3 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={rodar} disabled={rodando || titulos.length === 0} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-60">
          {rodando ? "Conferindo na Omie…" : feitos.length ? "Conferir de novo" : "Conferir esta OS na Omie"}
        </button>
        <span className="text-xs text-slate-600">
          {rodando || feitos.length
            ? `${feitos.length} de ${titulos.length} título(s) conferido(s) · ${feitos.filter((t) => t.situacao === "igual").length} igual(is) · ${divergentes.length} com diferença`
            : "Consulta cada título na Omie agora (projeto, valor, vencimento, se ainda existe) e corrige o espelho com o que a Omie responder."}
        </span>
      </div>
      {erro && <p className="text-xs text-red-700">{erro}</p>}
      {divergentes.length > 0 && (
        <ul className="space-y-1 text-xs">
          {divergentes.map((t) => (
            <li key={t.id}>
              <span className="font-medium text-slate-800">{rotulo.get(t.id)}</span>
              {" — "}
              {t.situacao === "indeterminado" ? (
                <span className="text-amber-700">sem resposta clara da Omie{t.erro ? ` (${t.erro})` : ""}; mantido</span>
              ) : (
                <span className="text-red-700">
                  {t.mudancas.map((m) => `${CAMPO[m.campo]}: sistema ${m.sistema} → Omie ${m.omie}`).join(" · ")}
                  {t.situacao === "excluido" ? " — marcado como excluído" : " — corrigido"}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {!rodando && feitos.length > 0 && divergentes.length === 0 && <p className="text-xs text-emerald-700">Todos os títulos desta OS estão iguais à Omie.</p>}
    </div>
  );
}
