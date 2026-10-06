import { fmtBRL, fmtDocumento } from "@/lib/controladoria/format";
import type { ComposicaoCategoria } from "@/lib/controladoria/composicaoCategoria";

// O DETALHE DE UMA CATEGORIA: os favorecidos que mais receberam nela em 12
// meses e os maiores lançamentos, com número do documento e observação do
// Omie. É o que diz o que um nome genérico ("Cartão de Crédito", "Compra de
// Serviços") de fato paga — e para onde cada parte deveria ir.

const dataBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export default function DetalheCategoria({ composicao }: { composicao: ComposicaoCategoria | undefined }) {
  if (!composicao || (composicao.fornecedores.length === 0 && composicao.titulos.length === 0)) {
    return <p className="text-xs text-slate-500">Sem lançamentos da categoria no período.</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <div className="min-w-0">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Quem recebeu (12 meses)</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[360px] text-xs">
            <tbody>
              {composicao.fornecedores.map((f) => (
                <tr key={`${f.nome}:${f.documento ?? ""}`} className="border-b border-slate-100">
                  <td className="py-1 pr-2 text-slate-800">
                    {f.nome}
                    {f.documento && <span className="ml-1 text-slate-400">{fmtDocumento(f.documento)}</span>}
                  </td>
                  <td className="whitespace-nowrap py-1 pr-2 text-right text-slate-500">
                    {f.titulos} título{f.titulos === 1 ? "" : "s"}
                  </td>
                  <td className="whitespace-nowrap py-1 text-right tabular-nums text-slate-800">{fmtBRL(f.cents)}</td>
                </tr>
              ))}
              {composicao.demais && (
                <tr>
                  <td className="py-1 pr-2 text-slate-500">
                    mais {composicao.demais.fornecedores} favorecido{composicao.demais.fornecedores === 1 ? "" : "s"}
                  </td>
                  <td></td>
                  <td className="whitespace-nowrap py-1 text-right tabular-nums text-slate-500">{fmtBRL(composicao.demais.cents)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="min-w-0">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Maiores lançamentos ({composicao.titulos.length} de {composicao.totalTitulos})
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-xs">
            <tbody>
              {composicao.titulos.map((t, i) => (
                <tr key={i} className="border-b border-slate-100 align-top">
                  <td className="whitespace-nowrap py-1 pr-2 text-slate-500">{dataBR(t.data)}</td>
                  <td className="py-1 pr-2 text-slate-800">
                    {t.fornecedor}
                    <span className="ml-1 text-slate-400">
                      {t.empresa}
                      {t.numero ? ` · doc. ${t.numero}` : ""}
                    </span>
                    {t.observacao && <span className="block break-all text-slate-500">{t.observacao}</span>}
                  </td>
                  <td className="whitespace-nowrap py-1 text-right tabular-nums text-slate-800">{fmtBRL(t.cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
