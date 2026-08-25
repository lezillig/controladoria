"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { fmtBRL, fmtData } from "@/lib/controladoria/format";
import type { ItemDre } from "@/lib/controladoria/dre";
import ClassificarCategoria from "./ClassificarCategoria";

// A CATEGORIA, E O QUE ELA ESCONDE.
//
// Um DRE responde "quanto"; a pergunta seguinte é sempre "de onde vem esse
// número?". Sem o clique, essa pergunta obriga a sair da tela, abrir a lista de
// títulos, filtrar por categoria e por mês — e é aí que a conferência para.
//
// Só os MAIORES títulos vêm, e a linha final diz quantos ficaram de fora. Um
// drill-down que mostra vinte de trezentos e não avisa é pior que nenhum: quem
// soma o que vê conclui que o resto não existe.

export default function LinhaCategoria({
  item,
  linhaChave,
  subgruposConhecidos,
  marcasOmie,
}: {
  item: ItemDre;
  linhaChave: string;
  subgruposConhecidos: string[];
  marcasOmie: string | null;
}) {
  const [aberto, setAberto] = useState(false);
  const temDetalhe = item.titulos.length > 0;

  return (
    <Fragment>
      <tr className="border-b border-slate-50 text-xs hover:bg-slate-50">
        <td className="py-1.5 pl-12 pr-3 text-slate-600">
          <button
            type="button"
            onClick={() => setAberto((v) => !v)}
            disabled={!temDetalhe}
            className="inline-flex items-center gap-1 text-left hover:text-slate-900 disabled:cursor-default"
            aria-expanded={aberto}
          >
            {temDetalhe ? (
              aberto ? (
                <ChevronDown className="h-3 w-3 shrink-0 text-slate-400" />
              ) : (
                <ChevronRight className="h-3 w-3 shrink-0 text-slate-400" />
              )
            ) : (
              <span className="w-3" />
            )}
            <span className={temDetalhe ? "hover:underline" : ""}>{item.descricao}</span>
          </button>
          {!item.confirmada && (
            <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
              por confirmar
            </span>
          )}
          {item.subgrupo && <span className="ml-2 text-slate-400">· {item.subgrupo}</span>}
          {marcasOmie && <span className="ml-2 text-[10px] text-slate-400">Omie: {marcasOmie}</span>}
        </td>
        <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{fmtBRL(item.valorCents)}</td>
        <td className="px-3 py-1.5"></td>
        <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">{fmtBRL(item.valorAnteriorCents)}</td>
        <td className="px-3 py-1.5"></td>
        <td className="px-3 py-1.5 text-right">
          <ClassificarCategoria
            categoriaCodigo={item.categoriaCodigo}
            linhaAtual={linhaChave}
            subgrupoAtual={item.subgrupo}
            confirmada={item.confirmada}
            subgruposConhecidos={subgruposConhecidos}
          />
        </td>
      </tr>

      {aberto &&
        item.titulos.map((t) => (
          <tr key={t.id} className="border-b border-slate-50 bg-slate-50/40 text-[11px] text-slate-500">
            <td className="py-1 pl-[4.5rem] pr-3">
              <span className="text-slate-700">{t.parceiro}</span>
              {t.documento && <span className="ml-2 text-slate-400">doc {t.documento}</span>}
              <span className="ml-2 text-slate-400">{fmtData(t.data)}</span>
              <span className="ml-2 text-slate-400">{t.empresa}</span>
            </td>
            <td className="px-3 py-1 text-right tabular-nums">{fmtBRL(t.valorCents)}</td>
            <td colSpan={4}></td>
          </tr>
        ))}

      {aberto && item.totalDeTitulos > item.titulos.length && (
        <tr className="border-b border-slate-50 bg-slate-50/40 text-[11px] text-slate-500">
          <td className="py-1 pl-[4.5rem] pr-3 italic">
            e mais {item.totalDeTitulos - item.titulos.length} título(s) menores — a lista completa está na planilha de
            conferência.
          </td>
          <td colSpan={5}></td>
        </tr>
      )}
    </Fragment>
  );
}
