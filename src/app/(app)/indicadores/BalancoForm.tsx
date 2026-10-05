"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inputClass, primaryButtonClass } from "@/lib/ui";
import { salvarBalanco } from "./actions";

// O balanço da contabilidade, digitado. Os valores vêm em texto (reais, no
// formato brasileiro) e são conferidos no servidor; o formulário só mostra o
// erro e recarrega a tela quando grava.

export type ValoresBalanco = Partial<Record<CampoBalanco, string>>;

type CampoBalanco =
  | "dataBase"
  | "caixa"
  | "contasReceber"
  | "ativoCirculante"
  | "imobilizadoLiquido"
  | "ativoTotal"
  | "fornecedores"
  | "passivoCirculante"
  | "dividaCurtoPrazo"
  | "dividaLongoPrazo"
  | "patrimonioLiquido"
  | "depreciacaoAno"
  | "lucroLiquidoAno"
  | "custoCapital"
  | "frotaVeiculos"
  | "kmAno"
  | "observacao";

const BLOCOS: { titulo: string; campos: { campo: CampoBalanco; rotulo: string; ajuda?: string; opcional?: boolean }[] }[] = [
  {
    titulo: "Ativo",
    campos: [
      { campo: "caixa", rotulo: "Caixa e equivalentes", ajuda: "Bancos e aplicações de resgate imediato." },
      { campo: "contasReceber", rotulo: "Contas a receber (clientes)" },
      { campo: "ativoCirculante", rotulo: "Ativo circulante total" },
      { campo: "imobilizadoLiquido", rotulo: "Imobilizado líquido", ajuda: "Frota e demais bens, já descontada a depreciação acumulada." },
      { campo: "ativoTotal", rotulo: "Ativo total" },
    ],
  },
  {
    titulo: "Passivo e patrimônio",
    campos: [
      { campo: "fornecedores", rotulo: "Fornecedores" },
      { campo: "passivoCirculante", rotulo: "Passivo circulante total" },
      {
        campo: "dividaCurtoPrazo",
        rotulo: "Dívida de curto prazo",
        ajuda: "Empréstimos, financiamentos, CDC, leasing e consórcios contemplados que vencem em até 12 meses.",
      },
      { campo: "dividaLongoPrazo", rotulo: "Dívida de longo prazo", ajuda: "A mesma dívida, com vencimento após 12 meses." },
      { campo: "patrimonioLiquido", rotulo: "Patrimônio líquido", ajuda: "Pode ser negativo: use o sinal de menos." },
    ],
  },
  {
    titulo: "DRE contábil e operação (12 meses até a data-base)",
    campos: [
      { campo: "depreciacaoAno", rotulo: "Depreciação", opcional: true, ajuda: "Sem ela, o painel estima 12% do imobilizado ao ano." },
      { campo: "lucroLiquidoAno", rotulo: "Lucro líquido contábil", opcional: true, ajuda: "Para ROE e ROA." },
      { campo: "custoCapital", rotulo: "Custo do capital (% a.a.)", ajuda: "WACC para o ROIC e o EVA. Padrão: 18%." },
      { campo: "frotaVeiculos", rotulo: "Veículos em operação", opcional: true },
      { campo: "kmAno", rotulo: "Km rodados", opcional: true },
    ],
  },
];

export default function BalancoForm({ escopo, valores, rotuloEscopo }: { escopo: string; valores: ValoresBalanco; rotuloEscopo: string }) {
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [processando, iniciar] = useTransition();
  const router = useRouter();

  return (
    <form
      // Recria o formulário ao trocar o balanço em edição: os campos são não
      // controlados e guardariam os valores do anterior.
      key={valores.dataBase ?? "novo"}
      className="space-y-5"
      action={(formData) => {
        setErro(null);
        setSalvo(false);
        iniciar(async () => {
          const r = await salvarBalanco(formData);
          if (r.erro) setErro(r.erro);
          else {
            setSalvo(true);
            router.refresh();
          }
        });
      }}
    >
      <input type="hidden" name="escopo" value={escopo} />
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600">Data-base</label>
          <input name="dataBase" type="date" required defaultValue={valores.dataBase} className={`${inputClass} w-44`} />
        </div>
        <p className="text-xs text-slate-500">
          Balanço de <strong>{rotuloEscopo}</strong>. Valores em reais, como no balanço (1.234.567,89). A mesma data-base gravada de novo
          substitui a anterior.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {BLOCOS.map((b) => (
          <fieldset key={b.titulo} className="space-y-3 rounded-lg border border-slate-200 p-4">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{b.titulo}</legend>
            {b.campos.map((c) => (
              <div key={c.campo}>
                <label className="block text-xs font-medium text-slate-600">
                  {c.rotulo}
                  {c.opcional && <span className="font-normal text-slate-400"> (opcional)</span>}
                </label>
                <input
                  name={c.campo}
                  type="text"
                  inputMode="decimal"
                  required={!c.opcional && c.campo !== "custoCapital"}
                  defaultValue={valores[c.campo] ?? (c.campo === "custoCapital" ? "18" : "")}
                  className={`${inputClass} tabular-nums`}
                />
                {c.ajuda && <p className="mt-0.5 text-xs text-slate-400">{c.ajuda}</p>}
              </div>
            ))}
          </fieldset>
        ))}
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600">Observação</label>
        <input name="observacao" type="text" defaultValue={valores.observacao} placeholder="Ex.: balanço auditado, balancete de setembro" className={inputClass} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={processando} className={primaryButtonClass}>
          {processando ? "Salvando…" : "Salvar balanço"}
        </button>
        {erro && <p className="text-sm text-red-700">{erro}</p>}
        {salvo && !erro && <p className="text-sm text-emerald-700">Balanço salvo.</p>}
      </div>
    </form>
  );
}
