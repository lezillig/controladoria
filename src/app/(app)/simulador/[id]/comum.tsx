"use client";

import { useState, type ReactNode } from "react";
import type { OrigemPremissa } from "@/lib/simulador/premissas";
import { lerNumero } from "@/lib/simulador/numeros";

// PEÇAS DO EDITOR DO ESTUDO — formatação, campo numérico e selos.
//
// O campo numérico guarda o TEXTO enquanto a pessoa digita e só entrega o
// número ao sair do campo (ou no Enter). Entregar a cada tecla recalcularia a
// simulação com "0," e "0,8" no caminho de "0,85", e o resumo do topo
// piscaria preços absurdos enquanto se digita.

export const brl = (v: number | null | undefined, casas = 2) =>
  v === null || v === undefined || !Number.isFinite(v)
    ? "—"
    : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: casas, maximumFractionDigits: casas });
export const brl0 = (v: number | null | undefined) => brl(v, 0);
export const pct = (v: number | null | undefined, casas = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;
export const num = (v: number | null | undefined, casas = 0) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

export { lerNumero };

export function CampoNumero({
  valor,
  aoMudar,
  casas = 2,
  percentual = false,
  vazioPermitido = false,
  className = "",
  rotulo,
  desativado = false,
}: {
  valor: number | null | undefined;
  aoMudar: (n: number | null) => void;
  casas?: number;
  percentual?: boolean;
  vazioPermitido?: boolean;
  className?: string;
  rotulo?: string;
  desativado?: boolean;
}) {
  const exibir = (v: number | null | undefined, agrupar = true) =>
    v === null || v === undefined || !Number.isFinite(v)
      ? ""
      : (percentual ? v * 100 : v).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: casas, useGrouping: agrupar });
  // Fora de edição o campo mostra o valor; em edição, o rascunho digitado —
  // sem separador de milhar, para o que se vê ser o que se relê.
  const [rascunho, setRascunho] = useState<string | null>(null);
  const [invalido, setInvalido] = useState(false);
  // O texto vem do próprio campo, não do estado: preenchimento automático
  // (colar, autocompletar) pode chegar ao blur antes da nova renderização.
  const confirmar = (atual: string) => {
    const texto = rascunho === null ? null : atual;
    setRascunho(null);
    // Passar pelo campo sem digitar não grava nada.
    if (texto === null || texto === exibir(valor, false)) return;
    const n = lerNumero(texto);
    if (n === null) {
      if (texto.trim() === "" && vazioPermitido) {
        if (valor !== null) aoMudar(null);
      } else setInvalido(true);
      return;
    }
    const v = percentual ? n / 100 : n;
    if (v !== valor) aoMudar(v);
  };
  return (
    <input
      inputMode="decimal"
      aria-label={rotulo}
      aria-invalid={invalido || undefined}
      title={invalido ? "Valor não reconhecido — o anterior foi mantido." : undefined}
      disabled={desativado}
      value={rascunho ?? exibir(valor)}
      onFocus={(e) => {
        setInvalido(false);
        setRascunho(exibir(valor, false));
        // Trocar "2.000" por "2000" ao entrar desfaz a seleção; sem selecionar
        // de novo, quem entra com Tab e digita emenda no valor antigo.
        const el = e.currentTarget;
        requestAnimationFrame(() => el.select());
      }}
      onChange={(e) => setRascunho(e.target.value)}
      onBlur={(e) => confirmar(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        // Esc desiste da edição: volta ao valor e sai do campo sem gravar.
        if (e.key === "Escape") {
          setRascunho(exibir(valor, false));
          const alvo = e.target as HTMLInputElement;
          requestAnimationFrame(() => alvo.blur());
        }
      }}
      className={`w-full rounded-md border border-slate-300 px-2 py-1 text-right font-mono text-[13px] tabular-nums focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 aria-[invalid=true]:border-red-400 aria-[invalid=true]:bg-red-50 ${className}`}
    />
  );
}

const ESTILO_ORIGEM: Record<OrigemPremissa["origem"], { rotulo: string; classe: string }> = {
  BASE: { rotulo: "base Azul", classe: "bg-emerald-50 text-emerald-800" },
  REAL: { rotulo: "custo real", classe: "bg-blue-50 text-blue-800" },
  PADRAO: { rotulo: "estimativa", classe: "bg-amber-50 text-amber-800" },
  HISTORICO: { rotulo: "estimativa de mercado", classe: "bg-amber-50 text-amber-800" },
  AJUSTE: { rotulo: "ajustado aqui", classe: "bg-violet-50 text-violet-800" },
};

export function SeloOrigem({ origem, titulo }: { origem: OrigemPremissa["origem"] | undefined; titulo?: string }) {
  const e = ESTILO_ORIGEM[origem ?? "PADRAO"];
  return (
    <span title={titulo} className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-medium ${e.classe}`}>
      {e.rotulo}
    </span>
  );
}

export function Cartao({ titulo, acao, children, ajuda }: { titulo?: string; acao?: ReactNode; ajuda?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      {(titulo || acao) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {titulo && <h2 className="text-[15px] font-semibold text-slate-900">{titulo}</h2>}
          {acao}
        </div>
      )}
      {ajuda && <p className="max-w-[95ch] text-xs leading-relaxed text-slate-500">{ajuda}</p>}
      {children}
    </section>
  );
}

export const th = "whitespace-nowrap border-b border-slate-200 bg-slate-50 px-2 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-slate-500";
export const thN = `${th} text-right`;
export const td = "border-b border-slate-100 px-2 py-1.5 align-middle";
export const tdN = `${td} text-right font-mono tabular-nums`;
export const botao = "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45";
export const botaoPrimario = "rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60";
export const selecao = "rounded-md border border-slate-300 bg-white px-2 py-1 text-[13px] focus:border-blue-600 focus:outline-none";
