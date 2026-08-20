"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inputClass, labelClass, primaryButtonClass } from "@/lib/ui";
import { salvarVinculo } from "./actions";

export type OpcaoDestino = { valor: string; rotulo: string; grupo: string };
export type OpcaoOrigem = { tipo: string; codigo: string; rotulo: string };

// Formulário do de-para. Uma linha só: origem (dimensão da Omie) → destino
// (contrato, veículo ou funcionário) → percentual.

export default function VinculoForm({
  origens,
  destinos,
}: {
  origens: OpcaoOrigem[];
  destinos: OpcaoDestino[];
}) {
  const [origem, setOrigem] = useState(origens[0] ? `${origens[0].tipo}|${origens[0].codigo}` : "");
  const [textoLivre, setTextoLivre] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [processando, iniciar] = useTransition();
  const router = useRouter();

  const usandoTexto = origem === "TEXTO|";
  const origemSelecionada = origens.find((o) => `${o.tipo}|${o.codigo}` === origem);

  const grupos = [...new Set(destinos.map((d) => d.grupo))];

  return (
    <form
      className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-4"
      action={(formData) => {
        setErro(null);
        const [tipo, codigo] = origem.split("|");
        formData.set("tipoOrigem", tipo);
        formData.set("valorOrigem", usandoTexto ? textoLivre : codigo);
        formData.set("rotuloOrigem", usandoTexto ? textoLivre : (origemSelecionada?.rotulo ?? ""));
        iniciar(async () => {
          const resultado = await salvarVinculo(formData);
          if (resultado.erro) {
            setErro(resultado.erro);
            return;
          }
          setTextoLivre("");
          router.refresh();
        });
      }}
    >
      <div className="sm:col-span-2">
        <label className={labelClass}>Origem (lado da Omie)</label>
        <select value={origem} onChange={(e) => setOrigem(e.target.value)} className={inputClass}>
          {origens.map((o) => (
            <option key={`${o.tipo}|${o.codigo}`} value={`${o.tipo}|${o.codigo}`}>
              {o.rotulo}
            </option>
          ))}
          <option value="TEXTO|">Texto no documento/observação do título…</option>
        </select>
        {usandoTexto && (
          <input
            value={textoLivre}
            onChange={(e) => setTextoLivre(e.target.value)}
            placeholder='Ex.: "FEMSA" — casa com qualquer título cujo documento ou observação contenha esse texto'
            className={`${inputClass} mt-2`}
          />
        )}
      </div>

      <div>
        <label className={labelClass}>Destino</label>
        <select name="destino" className={inputClass} defaultValue="">
          <option value="" disabled>
            Escolha…
          </option>
          {grupos.map((g) => (
            <optgroup key={g} label={g}>
              {destinos
                .filter((d) => d.grupo === g)
                .map((d) => (
                  <option key={d.valor} value={d.valor}>
                    {d.rotulo}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div>
        <label className={labelClass}>Percentual</label>
        <input name="percentual" type="number" min={1} max={100} step={1} defaultValue={100} className={inputClass} />
        <p className="mt-1 text-xs text-slate-500">Menos de 100% rateia; o resto fica como não alocado.</p>
      </div>

      {erro && <p className="text-sm font-medium text-red-700 sm:col-span-2 lg:col-span-4">{erro}</p>}

      <div className="lg:col-span-4">
        <button type="submit" disabled={processando} className={primaryButtonClass}>
          {processando ? "Salvando..." : "Vincular"}
        </button>
      </div>
    </form>
  );
}
