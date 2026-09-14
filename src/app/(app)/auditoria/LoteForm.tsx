"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inputClass, primaryButtonClass, secondaryButtonClass } from "@/lib/ui";
import { tratarEmLote } from "./actions";

// Tratativa em lote — aparece só quando a lista está filtrada por REGRA, que
// é o recorte mínimo. Mostra quantos achados o lote alcança antes de gravar,
// para ninguém encerrar 104 achando que eram 4.

const OPCOES = [
  { valor: "IGNORADO", rotulo: "Não se aplica", ajuda: "Todos os achados do recorte não procedem. A justificativa fica gravada em cada um." },
  { valor: "RESOLVIDO", rotulo: "Resolvido", ajuda: "Todos foram corrigidos. Descreva o que foi feito." },
  { valor: "EM_ANALISE", rotulo: "Em análise", ajuda: "Atribuir a alguém com prazo, sem encerrar." },
];

export default function LoteForm({
  regra,
  categoria,
  severidade,
  total,
  informativos,
}: {
  regra: string;
  categoria: string | null;
  severidade: string | null;
  total: number;
  informativos: number;
}) {
  const [aberto, setAberto] = useState(false);
  const [status, setStatus] = useState("IGNORADO");
  const [apenasInformativos, setApenasInformativos] = useState(informativos > 0 && informativos < total);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<number | null>(null);
  const [processando, iniciar] = useTransition();
  const router = useRouter();

  const alcance = apenasInformativos ? informativos : total;

  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)} className={`${secondaryButtonClass} text-xs`}>
        Tratar os {total} em lote
      </button>
    );
  }

  const opcao = OPCOES.find((o) => o.valor === status);

  return (
    <form
      className="w-full rounded-lg border border-amber-200 bg-amber-50 p-3"
      action={(formData) => {
        setErro(null);
        iniciar(async () => {
          const r = await tratarEmLote(formData);
          if (r.erro) {
            setErro(r.erro);
            return;
          }
          setFeito(r.quantidade ?? 0);
          setAberto(false);
          router.refresh();
        });
      }}
    >
      <input type="hidden" name="regra" value={regra} />
      {categoria && <input type="hidden" name="categoria" value={categoria} />}
      {severidade && <input type="hidden" name="severidade" value={severidade} />}

      <p className="text-sm font-medium text-amber-900">
        Tratativa em lote da regra <span className="font-mono">{regra}</span>: alcança <strong>{alcance}</strong> achado(s) em aberto.
      </p>

      {informativos > 0 && informativos < total && (
        <label className="mt-2 flex items-center gap-2 text-xs text-amber-900">
          <input
            type="checkbox"
            name="apenasInformativos"
            checked={apenasInformativos}
            onChange={(e) => setApenasInformativos(e.target.checked)}
          />
          Só os {informativos} informativos (deixa os {total - informativos} a triar como estão)
        </label>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-slate-700">Situação</label>
          <select name="status" value={status} onChange={(e) => setStatus(e.target.value)} className={`${inputClass} mt-1`}>
            {OPCOES.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.rotulo}
              </option>
            ))}
          </select>
          {opcao && <p className="mt-1 text-xs text-slate-500">{opcao.ajuda}</p>}
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700">Responsável (opcional)</label>
          <input name="responsavel" className={`${inputClass} mt-1`} placeholder="Ex.: Financeiro, RH, Ana" maxLength={120} />
          <label className="mt-2 block text-xs font-medium text-slate-700">Prazo (opcional)</label>
          <input type="date" name="prazo" className={`${inputClass} mt-1`} />
        </div>
      </div>

      <label className="mt-3 block text-xs font-medium text-slate-700">
        O que foi verificado {(status === "IGNORADO" || status === "RESOLVIDO") && <span className="text-red-600">*</span>}
      </label>
      <textarea
        name="observacao"
        rows={2}
        className={`${inputClass} mt-1`}
        placeholder="Ex.: conferido por amostra de 10: parcelas de contratos distintos de financiamento de frota."
      />

      {erro && <p className="mt-2 text-xs font-medium text-red-700">{erro}</p>}
      {feito !== null && <p className="mt-2 text-xs font-medium text-emerald-700">{feito} achado(s) tratados.</p>}

      <div className="mt-3 flex items-center gap-2">
        <button type="submit" disabled={processando} className={`${primaryButtonClass} text-xs`}>
          {processando ? "Gravando..." : `Aplicar a ${alcance} achado(s)`}
        </button>
        <button type="button" onClick={() => setAberto(false)} className={`${secondaryButtonClass} text-xs`}>
          Cancelar
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Fica um evento na trilha com quem, quando, o recorte e a quantidade. Cada achado guarda a mesma justificativa.
      </p>
    </form>
  );
}
