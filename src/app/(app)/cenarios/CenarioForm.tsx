"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inputClass, labelClass, primaryButtonClass } from "@/lib/ui";
import { salvarCenario } from "./actions";

// O FORMULÁRIO DE PREMISSAS.
//
// Cada premissa é uma frase completa: "despesas com veículos sobem 15% de
// novembro até março". A linha, o percentual, o início e o fim ficam visíveis
// um ao lado do outro, porque é assim que a pessoa vai defender o cenário
// numa reunião — e é assim que ele fica gravado.

export type LinhaOpcao = { chave: string; rotulo: string };
export type PremissaForm = { linha: string; percentual: number; desde: string; ate: string | null; descricao: string | null };

export default function CenarioForm({
  linhas,
  meses,
  empresa,
  inicial,
}: {
  linhas: LinhaOpcao[];
  meses: { competencia: string; rotulo: string }[];
  empresa: string | null;
  inicial: { id: string | null; nome: string; baseReceita: "HISTORICA" | "CONTRATADA"; observacao: string | null; premissas: PremissaForm[] };
}) {
  const [nome, setNome] = useState(inicial.nome);
  const [baseReceita, setBaseReceita] = useState<"HISTORICA" | "CONTRATADA">(inicial.baseReceita);
  const [observacao, setObservacao] = useState(inicial.observacao ?? "");
  const [premissas, setPremissas] = useState<PremissaForm[]>(inicial.premissas);
  const [nova, setNova] = useState<PremissaForm>({ linha: linhas[0]?.chave ?? "", percentual: 10, desde: meses[0]?.competencia ?? "", ate: null, descricao: "" });
  const [erro, setErro] = useState<string | null>(null);
  const [processando, iniciar] = useTransition();
  const router = useRouter();

  const rotuloDe = (chave: string) => linhas.find((l) => l.chave === chave)?.rotulo ?? chave;
  const rotuloMes = (c: string | null) => (c ? (meses.find((m) => m.competencia === c)?.rotulo ?? c) : "—");

  const adicionar = () => {
    if (!nova.linha || !nova.desde || !Number.isFinite(nova.percentual) || nova.percentual === 0) return;
    if (nova.ate && nova.ate < nova.desde) {
      setErro("O fim da premissa vem antes do início.");
      return;
    }
    setErro(null);
    setPremissas([...premissas, { ...nova, descricao: nova.descricao?.trim() || null }]);
    setNova({ ...nova, descricao: "" });
  };

  return (
    <form
      className="space-y-4"
      action={(formData) => {
        setErro(null);
        formData.set("id", inicial.id ?? "");
        formData.set("empresa", empresa ?? "");
        formData.set("nome", nome);
        formData.set("baseReceita", baseReceita);
        formData.set("observacao", observacao);
        formData.set("premissas", JSON.stringify(premissas));
        iniciar(async () => {
          const r = await salvarCenario(formData);
          if (r.erro) {
            setErro(r.erro);
            return;
          }
          const params = new URLSearchParams();
          if (empresa) params.set("empresa", empresa);
          if (r.id) params.set("cenario", r.id);
          router.push(`/cenarios?${params.toString()}`);
          router.refresh();
        });
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className={labelClass}>Nome do cenário</label>
          <input value={nome} onChange={(e) => setNome(e.target.value)} className={inputClass} placeholder="Ex.: Diesel +15% a partir de novembro" maxLength={80} />
        </div>
        <div>
          <label className={labelClass}>Receita bruta projetada</label>
          <select value={baseReceita} onChange={(e) => setBaseReceita(e.target.value as "HISTORICA" | "CONTRATADA")} className={inputClass}>
            <option value="HISTORICA">Pela série (sazonal + tendência)</option>
            <option value="CONTRATADA">Pelos contratos ativos da Omie</option>
          </select>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Premissas</p>
        {premissas.length === 0 ? (
          <p className="mb-3 text-xs text-slate-500">Sem premissas, este é o cenário base: a série fechada, sazonal, corrigida pela tendência.</p>
        ) : (
          <ul className="mb-3 space-y-1">
            {premissas.map((p, i) => (
              <li key={i} className="flex items-center justify-between gap-3 rounded border border-slate-200 bg-white px-3 py-1.5 text-sm">
                <span>
                  <span className="font-medium text-slate-800">{rotuloDe(p.linha)}</span>{" "}
                  <span className={p.percentual >= 0 ? "text-red-700" : "text-emerald-700"}>
                    {p.percentual > 0 ? "+" : ""}
                    {p.percentual}%
                  </span>{" "}
                  <span className="text-slate-500">
                    de {rotuloMes(p.desde)} {p.ate ? `até ${rotuloMes(p.ate)}` : "em diante"}
                  </span>
                  {p.descricao ? <span className="block text-xs text-slate-500">{p.descricao}</span> : null}
                </span>
                <button type="button" onClick={() => setPremissas(premissas.filter((_, j) => j !== i))} className="text-xs font-medium text-red-700 hover:underline">
                  remover
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-6">
          <div className="sm:col-span-2">
            <label className={labelClass}>Linha do DRE</label>
            <select value={nova.linha} onChange={(e) => setNova({ ...nova, linha: e.target.value })} className={inputClass}>
              {linhas.map((l) => (
                <option key={l.chave} value={l.chave}>
                  {l.rotulo}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Variação %</label>
            <input
              type="number"
              step="0.5"
              value={nova.percentual}
              onChange={(e) => setNova({ ...nova, percentual: Number(e.target.value) })}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>De</label>
            <select value={nova.desde} onChange={(e) => setNova({ ...nova, desde: e.target.value })} className={inputClass}>
              {meses.map((m) => (
                <option key={m.competencia} value={m.competencia}>
                  {m.rotulo}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Até</label>
            <select value={nova.ate ?? ""} onChange={(e) => setNova({ ...nova, ate: e.target.value || null })} className={inputClass}>
              <option value="">em diante</option>
              {meses.map((m) => (
                <option key={m.competencia} value={m.competencia}>
                  {m.rotulo}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button type="button" onClick={adicionar} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
              Adicionar
            </button>
          </div>
          <div className="sm:col-span-6">
            <input
              value={nova.descricao ?? ""}
              onChange={(e) => setNova({ ...nova, descricao: e.target.value })}
              className={inputClass}
              placeholder="De onde veio o número (opcional): 'reajuste da CCT em maio, 6,2%', 'ANP: diesel +12% em 90 dias'"
              maxLength={160}
            />
          </div>
        </div>
      </div>

      <div>
        <label className={labelClass}>Observação</label>
        <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} className={`${inputClass} min-h-[60px]`} maxLength={500} placeholder="Para quem ler este cenário daqui a seis meses." />
      </div>

      {erro && <p className="text-sm text-red-700">{erro}</p>}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={processando} className={primaryButtonClass}>
          {processando ? "Salvando…" : inicial.id ? "Salvar alterações" : "Salvar cenário"}
        </button>
        <span className="text-xs text-slate-500">Salvar recalcula a projeção com estas premissas.</span>
      </div>
    </form>
  );
}
