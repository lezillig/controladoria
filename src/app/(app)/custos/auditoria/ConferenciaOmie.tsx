"use client";

import { useState } from "react";
import { conferirLeitura, type LeituraOmie } from "./actions";

// A CONFERÊNCIA COM A OMIE, leitura por leitura, com progresso na tela.

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const TIPO = { falta: "falta no sistema", sobra: "sobra no sistema", valor: "valor diferente", data: "data diferente", cancelado: "cancelamento diferente" } as const;
const rotuloCriterio = (l: Pick<LeituraOmie, "natureza" | "criterio">) =>
  l.criterio === "caixa" ? "Caixa (baixas)" : l.natureza === "PAGAR" ? "Competência (vencimento)" : "Competência (emissão)";

export default function ConferenciaOmie({ empresas, ano, mes }: { empresas: { id: string; apelido: string }[]; ano: number; mes: number }) {
  const leituras = empresas.flatMap((e) =>
    (["PAGAR", "RECEBER"] as const).flatMap((natureza) => (["competencia", "caixa"] as const).map((criterio) => ({ conexaoId: e.id, empresa: e.apelido, natureza, criterio })))
  );
  const [resultados, setResultados] = useState<LeituraOmie[]>([]);
  const [atual, setAtual] = useState<number | null>(null);

  async function rodar() {
    setResultados([]);
    for (let i = 0; i < leituras.length; i++) {
      setAtual(i);
      const l = leituras[i];
      const r = await conferirLeitura({ conexaoId: l.conexaoId, natureza: l.natureza, criterio: l.criterio, ano, mes }).catch(
        (e): LeituraOmie => ({ empresa: l.empresa, natureza: l.natureza, criterio: l.criterio, totalOmieCents: 0, totalSistemaCents: 0, titulosOmie: 0, titulosSistema: 0, incompleto: true, divergencias: 0, diferencas: [], erro: e instanceof Error ? e.message : "falha na chamada" })
      );
      setResultados((x) => [...x, { ...r, empresa: l.empresa }]);
    }
    setAtual(null);
  }

  const rodando = atual !== null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={rodar} disabled={rodando} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-60">
          {rodando ? "Conferindo…" : resultados.length ? "Conferir de novo" : "Conferir com a Omie agora"}
        </button>
        {rodando && (
          <span className="flex items-center gap-2 text-sm text-slate-600">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
            {atual! + 1} de {leituras.length}: {leituras[atual!].empresa} · {leituras[atual!].natureza === "PAGAR" ? "a pagar" : "a receber"} · {rotuloCriterio(leituras[atual!])} — lendo a Omie…
          </span>
        )}
        {!rodando && resultados.length === 0 && <span className="text-sm text-slate-500">São {leituras.length} leituras, uma por vez; cada uma leva de alguns segundos a um minuto.</span>}
      </div>
      {rodando && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full bg-slate-700 transition-all" style={{ width: `${(resultados.length / leituras.length) * 100}%` }} />
        </div>
      )}

      {resultados.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-500">
                {["Empresa", "Natureza", "Critério", "Na Omie", "No sistema", "Diferença", "Títulos (Omie / sistema)", "Divergências"].map((c, i) => (
                  <th key={c} className={`px-2 py-2 font-medium ${i >= 3 ? "text-right" : "text-left"}`}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {resultados.map((r, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="px-2 py-1.5">{r.empresa}</td>
                  <td className="px-2 py-1.5">{r.natureza === "PAGAR" ? "A pagar" : "A receber"}</td>
                  <td className="px-2 py-1.5">{rotuloCriterio(r)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.erro ? <span className="text-xs text-red-700">{r.erro}</span> : brl(r.totalOmieCents)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.erro ? "—" : brl(r.totalSistemaCents)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {r.erro ? "—" : r.totalOmieCents === r.totalSistemaCents ? <span className="text-emerald-700">bate</span> : <span className="font-semibold text-red-700">{brl(r.totalOmieCents - r.totalSistemaCents)}</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {r.titulosOmie} / {r.titulosSistema}
                    {r.incompleto ? " (incompleto)" : ""}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.divergencias}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {resultados
        .filter((r) => r.diferencas.length > 0)
        .map((r, i) => (
          <details key={i} open={r.diferencas.length <= 30}>
            <summary className="cursor-pointer text-sm font-medium text-slate-800">
              {r.empresa} · {r.natureza === "PAGAR" ? "a pagar" : "a receber"} · {r.criterio === "caixa" ? "caixa" : "competência"} — {r.divergencias} divergência(s)
              {r.divergencias > r.diferencas.length ? ` (as ${r.diferencas.length} maiores)` : ""}
            </summary>
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    {["Tipo", "Parceiro", "Documento", "Categoria", "Na Omie", "No sistema", "Impacto", "Código Omie"].map((c) => (
                      <th key={c} className="px-2 py-1 text-left font-medium">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {r.diferencas.map((d, j) => (
                    <tr key={j} className="border-b border-slate-100 align-top">
                      <td className="px-2 py-1">{TIPO[d.tipo]}</td>
                      <td className="px-2 py-1">{d.parceiro ?? "—"}</td>
                      <td className="px-2 py-1">
                        {d.documento ?? "—"}
                        {d.parcela ? ` · ${d.parcela}` : ""}
                      </td>
                      <td className="px-2 py-1">{d.categoria ?? "—"}</td>
                      <td className="px-2 py-1">{d.omie}</td>
                      <td className="px-2 py-1">{d.sistema}</td>
                      <td className={`px-2 py-1 text-right tabular-nums ${d.impactoCents < 0 ? "text-red-700" : "text-slate-800"}`}>{brl(d.impactoCents)}</td>
                      <td className="px-2 py-1 text-slate-400">{d.codigo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ))}
    </div>
  );
}
