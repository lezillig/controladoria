"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { fmtBRL, fmtPercent } from "@/lib/controladoria/format";
import type { LinhaDreCalculada } from "@/lib/controladoria/dre";
import { Variacao } from "../_componentes";
import LinhaCategoria from "./LinhaCategoria";

// A DEMONSTRAÇÃO EM TRÊS NÍVEIS: linha → categoria → título.
//
// Fechada por padrão, mostrando só a estrutura. É a leitura que a maioria das
// vezes basta — "deu lucro?" se responde em dez linhas, e as quarenta
// categorias abertas por baixo delas escondiam justamente essas dez. Um DRE
// que exige rolar a tela para achar o resultado do período não está
// demonstrando nada.
//
// Cada clique desce um degrau, e nenhum sai da tela: quem abre uma categoria
// para ver de onde vem o número continua vendo o subtotal da linha logo acima.
// É essa permanência que faz a conferência acontecer aqui em vez de terminar
// numa planilha.

export default function TabelaDre({
  linhas,
  subgruposConhecidos,
  marcasPorCategoria,
  anoAnterior,
}: {
  linhas: LinhaDreCalculada[];
  subgruposConhecidos: string[];
  marcasPorCategoria: Record<string, string>;
  // Só o ano, para o cabeçalho da coluna. "Mesmo mês 2025" diz o que "ano
  // anterior" não diz: qual ano exatamente está do outro lado da comparação.
  anoAnterior?: number;
}) {
  const [abertas, setAbertas] = useState<Set<string>>(new Set());

  const alternar = (chave: string) =>
    setAbertas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(chave)) proximo.delete(chave);
      else proximo.add(chave);
      return proximo;
    });

  const gruposComItens = linhas.filter((l) => l.tipo === "GRUPO" && l.itens.length > 0);
  const todasAbertas = gruposComItens.length > 0 && gruposComItens.every((l) => abertas.has(l.chave));

  return (
    <>
      <div className="mb-2 flex justify-end">
        <button
          type="button"
          onClick={() => setAbertas(todasAbertas ? new Set() : new Set(gruposComItens.map((l) => l.chave)))}
          className="text-xs font-medium text-blue-700 hover:underline"
        >
          {todasAbertas ? "Recolher todas" : "Abrir todas as contas"}
        </button>
      </div>

      <div className="-mx-6 overflow-x-auto px-6">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">Conta</th>
              <th className="px-3 py-2 text-right">Mês atual</th>
              <th className="px-3 py-2 text-right">% RL</th>
              <th className="px-3 py-2 text-right">Mês anterior</th>
              <th className="px-3 py-2 text-right">Variação</th>
              <th className="px-3 py-2 text-right">Mesmo mês {anoAnterior ?? ""}</th>
              <th className="px-3 py-2 text-right">Var. a/a</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((linha) => {
              const subtotal = linha.tipo === "SUBTOTAL";
              const resultado = linha.chave === "RESULTADO_LIQUIDO";
              const abrivel = !subtotal && linha.itens.length > 0;
              const aberta = abertas.has(linha.chave);

              return (
                <Fragment key={linha.chave}>
                  <tr
                    className={
                      resultado
                        ? "border-t-2 border-slate-900 bg-slate-50 font-semibold text-slate-900"
                        : subtotal
                          ? "border-t border-slate-300 bg-slate-50/60 font-semibold text-slate-800"
                          : `border-b border-slate-100 text-slate-700 ${abrivel ? "cursor-pointer hover:bg-slate-50" : ""}`
                    }
                    onClick={abrivel ? () => alternar(linha.chave) : undefined}
                  >
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-1.5">
                        {abrivel ? (
                          aberta ? (
                            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                          )
                        ) : (
                          <span className="w-3.5" />
                        )}
                        {linha.rotulo}
                        {/* A contagem fica visível com a linha FECHADA: é o que
                            diz que há algo embaixo sem obrigar a abrir para
                            descobrir. */}
                        {abrivel && !aberta && (
                          <span className="text-xs font-normal text-slate-400">
                            ({linha.itens.length} categoria{linha.itens.length > 1 ? "s" : ""})
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtBRL(linha.valorCents)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">
                      {fmtPercent(linha.percentReceitaLiquida)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">
                      {fmtBRL(linha.valorAnteriorCents)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Variacao
                        valor={
                          linha.valorAnteriorCents !== 0
                            ? ((linha.valorCents - linha.valorAnteriorCents) / Math.abs(linha.valorAnteriorCents)) * 100
                            : null
                        }
                        bomSeSobe={linha.chave.startsWith("RECEITA") || subtotal}
                      />
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">
                      {linha.valorAnoAnteriorCents === null ? "—" : fmtBRL(linha.valorAnoAnteriorCents)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Variacao
                        valor={
                          linha.valorAnoAnteriorCents !== null && linha.valorAnoAnteriorCents !== 0
                            ? ((linha.valorCents - linha.valorAnoAnteriorCents) /
                                Math.abs(linha.valorAnoAnteriorCents)) *
                              100
                            : null
                        }
                        bomSeSobe={linha.chave.startsWith("RECEITA") || subtotal}
                      />
                    </td>
                    <td className="px-3 py-2.5"></td>
                  </tr>

                  {aberta &&
                    linha.subgrupos.map((s) => (
                      <tr key={`${linha.chave}:${s.nome}`} className="border-b border-slate-50 text-xs text-slate-600">
                        <td className="py-1.5 pl-8 pr-3 font-medium">{s.nome}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-medium">{fmtBRL(s.valorCents)}</td>
                        <td className="px-3 py-1.5"></td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{fmtBRL(s.valorAnteriorCents)}</td>
                        <td className="px-3 py-1.5"></td>
                        <td className="px-3 py-1.5"></td>
                        <td className="px-3 py-1.5"></td>
                        <td className="px-3 py-1.5"></td>
                      </tr>
                    ))}

                  {aberta &&
                    linha.itens.map((i) => (
                      <LinhaCategoria
                        key={i.categoriaCodigo}
                        item={i}
                        linhaChave={linha.chave}
                        subgruposConhecidos={subgruposConhecidos}
                        marcasOmie={marcasPorCategoria[i.categoriaCodigo] ?? null}
                      />
                    ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
