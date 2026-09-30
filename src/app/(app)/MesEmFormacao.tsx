import Link from "next/link";
import { fmtBRL, fmtData, fmtPercent } from "@/lib/controladoria/format";
import { ROTULO_FAIXA, rotuloDoMes, type MesEmFormacao } from "@/lib/controladoria/mesEmFormacao";
import { cardClass } from "@/lib/ui";
import { Barra, Secao } from "./_componentes";

// O MÊS SE FORMANDO no painel: previsão de fechamento, prontidão do
// fechamento, o alerta de "vendeu mais e ganhou menos" e a cobrança do dia.
// Ver o resultado enquanto ainda dá para agir, e não só no dia 30.

const pct = (v: number | null) => (v === null ? "—" : fmtPercent(v * 100, 0));
const tomDaProntidao = (v: number | null) => (v === null ? "azul" : v >= 0.95 ? "verde" : v >= 0.8 ? "ambar" : "vermelho");

export default function MesEmFormacaoPainel({ dados }: { dados: MesEmFormacao }) {
  const { previsao, fechamento, margem, cobranca } = dados;
  const hojeEOntem = cobranca.filter((c) => c.faixa === "VENCE_HOJE" || c.faixa === "VENCEU_ONTEM");
  return (
    <Secao titulo="O mês se formando" descricao="O resultado enquanto ainda dá para agir: para onde o mês caminha, o que falta para fechar e quem cobrar hoje.">
      <div className="space-y-4">
        {margem && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">
              Vendeu mais e ganhou menos em {rotuloDoMes(margem.mes)}: receita líquida de {fmtBRL(margem.receitaCents)} (média dos três meses anteriores{" "}
              {fmtBRL(Math.round(margem.receitaMediaCents))}), margem líquida de {pct(margem.margem)} contra {pct(margem.margemMedia)}.
            </p>
            {margem.culpados.length > 0 && (
              <p className="mt-1">
                O que mais pesou sobre a receita:{" "}
                {margem.culpados.map((c, i) => (
                  <span key={c.chave}>
                    {i > 0 ? "; " : ""}
                    {c.rotulo} de {pct(c.pctAntes)} para {pct(c.pctAgora)}
                  </span>
                ))}
                .{" "}
                <Link href="/custos" className="font-medium underline">
                  Abrir o DRE
                </Link>
              </p>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {previsao && (
            <div className={cardClass}>
              <p className="text-xs font-medium text-slate-500">
                Previsão de fechamento de {previsao.mes} · dia {previsao.diaDoMes} de {previsao.diasNoMes}
              </p>
              <p className={`mt-2 text-2xl font-semibold tabular-nums ${previsao.resultadoCents >= 0 ? "text-emerald-700" : "text-red-700"}`}>{fmtBRL(previsao.resultadoCents)}</p>
              <p className="mt-1 text-xs text-slate-500">
                Resultado líquido provável · margem {pct(previsao.margem)} sobre {fmtBRL(previsao.receitaLiquidaCents)} de receita líquida
                {previsao.resultadoMedioCents !== null && <> · média dos três últimos meses {fmtBRL(previsao.resultadoMedioCents)}</>}
              </p>
              {previsao.aindaPorVir.length > 0 && (
                <div className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-600">
                  <p className="mb-1 font-medium text-slate-700">Ainda deve entrar ou sair (pela média dos meses fechados)</p>
                  <ul className="space-y-0.5">
                    {previsao.aindaPorVir.map((l) => (
                      <li key={l.chave} className="flex justify-between gap-3">
                        <span>{l.rotulo}</span>
                        <span className="tabular-nums">
                          {fmtBRL(l.lancadoCents)} lançado → {fmtBRL(l.previstoCents)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="mt-2 text-[11px] text-slate-400">
                Cada linha do DRE fecha no maior entre o já lançado no mês e a média dos três últimos meses fechados.
              </p>
            </div>
          )}

          <div className={cardClass}>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-xs font-medium text-slate-500">
                {fechamento.momento === "FECHANDO" ? "Fechamento" : "Pronto para fechar"} · {fechamento.periodo.rotulo}
              </p>
              <p className="text-2xl font-semibold tabular-nums text-slate-900">{pct(fechamento.pronto)}</p>
            </div>
            <div className="mt-2">
              <Barra percentual={(fechamento.pronto ?? 0) * 100} tom={tomDaProntidao(fechamento.pronto)} />
            </div>
            <ul className="mt-3 space-y-2 text-xs">
              {fechamento.itens.map((i) => (
                <li key={i.chave}>
                  <div className="flex items-baseline justify-between gap-3">
                    <Link href={i.onde} className="font-medium text-slate-700 hover:underline">
                      {i.rotulo}
                    </Link>
                    <span className="tabular-nums text-slate-900">{pct(i.pronto)}</span>
                  </div>
                  <p className="text-slate-500">
                    {i.falta}
                    {i.faltaCents > 0 ? ` · ${fmtBRL(i.faltaCents)}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className={cardClass}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-slate-900">Cobrança do dia</p>
            <p className="text-xs text-slate-500">
              {hojeEOntem.length} {hojeEOntem.length === 1 ? "cliente" : "clientes"} vencendo hoje ou ontem ·{" "}
              {fmtBRL(cobranca.filter((c) => c.faixa !== "VENCE_EM_BREVE").reduce((a, c) => a + c.totalCents, 0))} vencido até 30 dias
            </p>
          </div>
          {cobranca.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">Nada vencendo nos próximos 3 dias nem vencido há até 30 dias.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                    <th className="px-2 py-1.5">Situação</th>
                    <th className="px-2 py-1.5">Cliente</th>
                    <th className="px-2 py-1.5">Títulos</th>
                    <th className="px-2 py-1.5 text-right">Em aberto</th>
                    <th className="px-2 py-1.5">Contato</th>
                  </tr>
                </thead>
                <tbody>
                  {cobranca.slice(0, 20).map((c) => (
                    <tr key={`${c.empresa}:${c.cliente}`} className="border-b border-slate-100 align-top">
                      <td className="whitespace-nowrap px-2 py-1.5 text-xs">
                        <span
                          className={`rounded px-1.5 py-0.5 font-medium ${
                            c.faixa === "VENCE_EM_BREVE" ? "bg-slate-100 text-slate-700" : c.faixa === "VENCE_HOJE" || c.faixa === "VENCEU_ONTEM" ? "bg-amber-50 text-amber-800" : "bg-red-50 text-red-800"
                          }`}
                        >
                          {ROTULO_FAIXA[c.faixa]}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        {c.cliente}
                        <span className="block text-xs text-slate-400">{c.empresa}</span>
                      </td>
                      <td className="px-2 py-1.5 text-xs text-slate-600">
                        {c.titulos
                          .slice(0, 3)
                          .map((t) => `${t.numero ?? "s/nº"} (venc. ${fmtData(t.vencimento)})`)
                          .join(", ")}
                        {c.titulos.length > 3 ? ` e mais ${c.titulos.length - 3}` : ""}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{fmtBRL(c.totalCents)}</td>
                      <td className="px-2 py-1.5 text-xs">
                        {c.email ? (
                          <a href={`mailto:${c.email}`} className="text-blue-700 hover:underline">
                            {c.email}
                          </a>
                        ) : (
                          <span className="text-slate-400">sem e-mail na Omie</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {cobranca.length > 20 && <p className="mt-2 text-xs text-slate-500">E mais {cobranca.length - 20} clientes — ver em Contas a pagar e receber.</p>}
            </div>
          )}
        </div>
      </div>
    </Secao>
  );
}
