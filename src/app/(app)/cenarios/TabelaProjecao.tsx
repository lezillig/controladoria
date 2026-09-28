import { fmtBRL } from "@/lib/controladoria/format";
import type { Projecao } from "@/lib/controladoria/projecao";

// A PROJEÇÃO, MÊS A MÊS, na estrutura do DRE — a mesma tabela do DRE anual,
// só que para frente. Valores em milhares nas colunas de mês, cheio no total,
// pelo mesmo motivo da tabela anual: doze colunas com centavos não se comparam
// de relance. A linha de receita bruta diz de onde cada mês veio (série ou
// contrato), e as linhas com premissa mostram a base entre parênteses.

const milhares = (cents: number) => {
  if (cents === 0) return "—";
  const mil = cents / 100_000;
  return mil.toLocaleString("pt-BR", { maximumFractionDigits: Math.abs(mil) >= 100 ? 0 : 1 });
};

const ROTULO_METODO: Record<string, string> = {
  SAZONAL_COM_TENDENCIA: "mesmo mês do ano anterior × tendência",
  SAZONAL: "mesmo mês do ano anterior",
  MEDIANA: "mediana dos meses fechados",
  SEM_BASE: "sem base",
  CONTRATADA: "contratos ativos",
};

export default function TabelaProjecao({ projecao }: { projecao: Projecao }) {
  const linhas = projecao.linhas.filter((l) => l.tipo === "SUBTOTAL" || l.totalCents !== 0 || l.basePorMes.some((v) => v !== 0));
  return (
    <div className="-mx-6 overflow-x-auto px-6">
      <table className="w-full min-w-[980px] text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <th className="px-3 py-2">Conta</th>
            {projecao.meses.map((m) => (
              <th key={m.competencia} className="px-2 py-2 text-right">
                {m.rotulo}
              </th>
            ))}
            <th className="px-3 py-2 text-right">12 meses</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => {
            const subtotal = l.tipo === "SUBTOTAL";
            const alterada = l.porMes.some((v, i) => v !== l.basePorMes[i]);
            const metodoPredominante = l.metodos.length > 0 ? l.metodos.reduce<Record<string, number>>((acc, m) => ({ ...acc, [m]: (acc[m] ?? 0) + 1 }), {}) : null;
            const metodo = metodoPredominante ? Object.entries(metodoPredominante).sort((a, b) => b[1] - a[1])[0][0] : null;
            return (
              <tr key={l.chave} className={subtotal ? "border-t border-slate-300 bg-slate-50 font-semibold text-slate-900" : "border-t border-slate-100 text-slate-700"}>
                <td className="px-3 py-1.5">
                  {l.rotulo}
                  {!subtotal && metodo && (
                    <span className="block text-[11px] font-normal text-slate-400">
                      {ROTULO_METODO[metodo] ?? metodo}
                      {alterada ? " · com premissa" : ""}
                    </span>
                  )}
                </td>
                {l.porMes.map((v, i) => (
                  <td key={i} className={`px-2 py-1.5 text-right tabular-nums ${subtotal && v < 0 ? "text-red-700" : ""}`} title={fmtBRL(v)}>
                    {milhares(v)}
                    {!subtotal && v !== l.basePorMes[i] && <span className="block text-[10px] text-slate-400">({milhares(l.basePorMes[i])})</span>}
                  </td>
                ))}
                <td className={`px-3 py-1.5 text-right tabular-nums ${subtotal && l.totalCents < 0 ? "text-red-700" : ""}`}>{fmtBRL(l.totalCents)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-slate-500">Meses em R$ mil; total em reais. Entre parênteses, o valor antes da premissa.</p>
    </div>
  );
}
