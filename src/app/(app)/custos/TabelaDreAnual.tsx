import { fmtBRL, fmtPercent } from "@/lib/controladoria/format";
import type { ResultadoDreAnual } from "@/lib/controladoria/dre";

// O ANO INTEIRO, MÊS A MÊS.
//
// Componente de servidor, sem estado: aqui não há o que abrir. A visão anual
// responde "o que mudou ao longo do ano", e a resposta está na horizontal —
// ler uma linha da esquerda para a direita mostra a tendência, que é
// exatamente o que a visão mensal não consegue dizer. Quem quiser o detalhe de
// um mês troca a visão e abre lá, com o drill-down inteiro.
//
// Valores em MILHARES nas colunas de mês, e cheio só no total. Doze colunas com
// centavos numa tela de 1400px espremem os números até ninguém conseguir
// comparar dois meses de relance — e comparar de relance é a única coisa que
// esta tabela existe para permitir.

const milhares = (cents: number) => {
  if (cents === 0) return "—";
  const mil = cents / 100_000;
  return mil.toLocaleString("pt-BR", { maximumFractionDigits: mil >= 100 ? 0 : 1 });
};

export default function TabelaDreAnual({ dre }: { dre: ResultadoDreAnual }) {
  return (
    <div className="-mx-6 overflow-x-auto px-6">
      <table className="w-full min-w-[900px] text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <th className="px-3 py-2">Conta</th>
            {dre.meses.map((m) => (
              <th key={m.indice} className="px-2 py-2 text-right">
                {m.rotulo}
              </th>
            ))}
            <th className="px-3 py-2 text-right">Total {dre.ano}</th>
            <th className="px-3 py-2 text-right">% RL</th>
          </tr>
        </thead>
        <tbody>
          {dre.linhas.map((linha) => {
            const subtotal = linha.tipo === "SUBTOTAL";
            const resultado = linha.chave === "RESULTADO_LIQUIDO";
            // Linha zerada o ano inteiro não aparece, pelo mesmo motivo da
            // visão mensal: doze colunas de traço não informam nada e empurram
            // para baixo as linhas que informam.
            if (!subtotal && linha.totalCents === 0) return null;

            return (
              <tr
                key={linha.chave}
                className={
                  resultado
                    ? "border-t-2 border-slate-900 bg-slate-50 font-semibold text-slate-900"
                    : subtotal
                      ? "border-t border-slate-300 bg-slate-50/60 font-semibold text-slate-800"
                      : "border-b border-slate-100 text-slate-700"
                }
              >
                <td className="whitespace-nowrap px-3 py-2">{linha.rotulo}</td>
                {linha.porMes.map((v, i) => (
                  <td
                    key={i}
                    className={`px-2 py-2 text-right tabular-nums ${v === 0 ? "text-slate-300" : "text-slate-600"}`}
                    title={fmtBRL(v)}
                  >
                    {milhares(v)}
                  </td>
                ))}
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums font-medium">
                  {fmtBRL(linha.totalCents)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                  {fmtPercent(linha.percentReceitaLiquida)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
