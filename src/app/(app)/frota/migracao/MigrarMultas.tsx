"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import type { ResultadoMultas } from "@/lib/frota/multasNoBanco";
import { gravarMultasDaPlanilha, previaMultas, type PreviaMultas } from "./actions";

// A PLANILHA DE MULTAS: escolher → conferir a prévia → gravar. Melhor depois
// da frota (para as placas casarem com os veículos).

const reais = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function MigrarMultas() {
  const form = useRef<HTMLFormElement>(null);
  const [previa, setPrevia] = useState<PreviaMultas | null>(null);
  const [resultado, setResultado] = useState<ResultadoMultas | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  async function rodar(etapa: "previa" | "gravar") {
    if (!form.current) return;
    setErro(null);
    setOcupado(etapa === "previa" ? "Lendo a planilha…" : "Gravando as multas…");
    if (etapa === "previa") {
      setPrevia(null);
      setResultado(null);
      const r = await previaMultas(new FormData(form.current)).catch((e) => ({ erro: e instanceof Error ? e.message : "falha", previa: undefined }));
      if (r.erro) setErro(r.erro);
      else setPrevia(r.previa ?? null);
    } else {
      const r = await gravarMultasDaPlanilha(new FormData(form.current)).catch((e) => ({ erro: e instanceof Error ? e.message : "falha", resultado: undefined }));
      if (r.erro) setErro(r.erro);
      else setResultado(r.resultado ?? null);
    }
    setOcupado(null);
  }

  return (
    <div className="space-y-4">
      <form ref={form} onSubmit={(e) => e.preventDefault()}>
        <label className="block rounded-lg border border-dashed border-slate-300 p-4 text-sm">
          <span className="font-semibold text-slate-800">3. CONTROLE MULTAS</span>
          <span className="block text-xs text-slate-500">.xlsx — a aba das multas, a de pontos e a de NIC</span>
          <input type="file" name="multas" accept=".xlsx,.xlsm" className="mt-2 block w-full text-xs" onChange={() => setPrevia(null)} />
        </label>
      </form>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => rodar("previa")} disabled={ocupado !== null} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60">Ler e conferir</button>
        {previa && !resultado && (
          <button type="button" onClick={() => rodar("gravar")} disabled={ocupado !== null} className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-60">Confirmar e gravar as multas</button>
        )}
        {ocupado && <span className="text-sm text-slate-500">{ocupado}</span>}
      </div>
      {erro && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
      {previa && (
        <div className="rounded-md border border-slate-200 p-3 text-sm text-slate-700">
          <p>
            <strong>{previa.total}</strong> multas ({previa.abertas} abertas, {previa.finalizadas} finalizadas, {previa.nic} NIC) · {reais(previa.valorCents)} · já descontado em folha {reais(previa.descontadoCents)} · a empresa assumiu {previa.empresaAssume}.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Abas lidas: {previa.abasLidas.join(", ")}. {previa.jaLancadas ? `${previa.jaLancadas} já estão no sistema (só completa o vazio). ` : ""}
            {previa.semVeiculo ? `${previa.semVeiculo} com placa fora do cadastro da frota (entram assim mesmo; migre a frota antes para casar).` : ""}
          </p>
          {previa.problemas.length > 0 && (
            <ul className="mt-2 max-h-40 list-disc overflow-auto pl-5 text-xs text-amber-800">
              {previa.problemas.map((p) => <li key={`${p.aba}${p.linha}`}>{p.aba}, linha {p.linha}: {p.problema}</li>)}
            </ul>
          )}
        </div>
      )}
      {resultado && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Gravado: {resultado.novas} novas, {resultado.completadas} completadas, {resultado.iguais} iguais. {resultado.condutorSemCadastro ? `${resultado.condutorSemCadastro} com condutor sem cadastro (o nome fica na multa até escolher a pessoa). ` : ""}
          Veja em <Link href="/frota/multas" className="font-semibold underline">Multas</Link>.
        </p>
      )}
    </div>
  );
}
