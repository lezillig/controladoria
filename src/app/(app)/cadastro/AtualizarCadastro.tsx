"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { carregarFonte, type Fonte, type RespostaCarga } from "./actions";
import type { ResultadoCarga } from "@/lib/cadastro/carga";

// O BOTÃO DA CARGA: fonte por fonte, com o resultado de cada uma na tela.

const FONTES: { fonte: Fonte; rotulo: string }[] = [
  { fonte: "parceiros", rotulo: "Clientes e fornecedores (Omie)" },
  { fonte: "pessoas", rotulo: "Pessoas (gestão de motoristas)" },
  { fonte: "veiculos", rotulo: "Veículos (gestão de motoristas)" },
  { fonte: "centros", rotulo: "Centros de custo na Omie" },
];
const ENTIDADE: Record<string, string> = { fornecedor: "Fornecedores", cliente: "Clientes", pessoa: "Pessoas", veiculo: "Veículos" };

export default function AtualizarCadastro() {
  const router = useRouter();
  const [atual, setAtual] = useState<number | null>(null);
  const [feitos, setFeitos] = useState<{ rotulo: string; r: RespostaCarga }[]>([]);

  async function rodar() {
    setFeitos([]);
    for (let i = 0; i < FONTES.length; i++) {
      setAtual(i);
      const r = await carregarFonte(FONTES[i].fonte).catch((e): RespostaCarga => ({ resultados: [], erro: e instanceof Error ? e.message : "falha na chamada" }));
      setFeitos((x) => [...x, { rotulo: FONTES[i].rotulo, r }]);
    }
    setAtual(null);
    router.refresh();
  }

  const linha = (x: ResultadoCarga) => {
    const ign = Object.entries(x.ignorados).map(([m, n]) => `${n} ${m}`).join(", ");
    return `${ENTIDADE[x.entidade] ?? x.entidade}: ${x.lidos} lido(s) · ${x.novos} novo(s) · ${x.completados} completado(s) · ${x.iguais} sem mudança${ign ? ` · fora: ${ign}` : ""}${x.divergencias.length ? ` · ${x.divergencias.length} divergência(s)` : ""}`;
  };
  const divergencias = feitos.flatMap((f) => f.r.resultados.flatMap((x) => x.divergencias));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={rodar} disabled={atual !== null} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-60">
          {atual !== null ? "Atualizando…" : "Atualizar o cadastro a partir das fontes"}
        </button>
        <span className="text-xs text-slate-500">{atual !== null ? `Lendo: ${FONTES[atual].rotulo} (${atual + 1} de ${FONTES.length})` : "Cria o que falta e completa o que está vazio; nunca sobrescreve o que o cadastro já tem."}</span>
      </div>
      {feitos.length > 0 && (
        <ul className="space-y-1 text-xs text-slate-700">
          {feitos.map((f) => (
            <li key={f.rotulo}>
              <span className="font-medium">{f.rotulo}</span>
              {f.r.erro ? <span className="text-red-700"> — {f.r.erro}</span> : null}
              {f.r.aviso ? <span> — {f.r.aviso}</span> : null}
              {f.r.resultados.map((x) => (
                <div key={x.entidade} className="ml-3 text-slate-600">{linha(x)}</div>
              ))}
            </li>
          ))}
        </ul>
      )}
      {divergencias.length > 0 && (
        <details className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs">
          <summary className="cursor-pointer font-medium text-amber-900">{divergencias.length} divergência(s) entre o cadastro e a fonte — o cadastro foi mantido</summary>
          <table className="mt-2 w-full">
            <thead>
              <tr className="text-left text-amber-900"><th className="pr-2">Registro</th><th className="pr-2">Campo</th><th className="pr-2">No cadastro</th><th>Na fonte</th></tr>
            </thead>
            <tbody>
              {divergencias.slice(0, 200).map((d, i) => (
                <tr key={i} className="text-slate-700"><td className="pr-2">{d.chave}</td><td className="pr-2">{d.campo}</td><td className="pr-2">{d.cadastro}</td><td>{d.fonte}</td></tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
