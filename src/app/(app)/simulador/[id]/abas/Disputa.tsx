"use client";

import { useState, useTransition } from "react";
import { ROTULO_SITUACAO_PARTICIPANTE, SITUACOES_PARTICIPANTE, diferenca } from "@/lib/simulador/disputa";
import { lerNumero } from "@/lib/simulador/numeros";
import { salvarParticipantes } from "../../actions";
import { Cartao, botao, botaoPrimario, pct, selecao, td, th, thN } from "../comum";

// A DISPUTA — a ata da sessão, empresa a empresa: posição, preço, valor total
// e situação. A Azul é uma das linhas. Com o tempo vira o mapa do mercado no
// histórico de editais: quem disputa o quê, a que preço, quanto abaixo do teto.

export type ParticipanteTela = {
  empresa: string;
  cnpj: string;
  posicao: string;
  preco: string;
  valorTotal: string;
  situacao: string;
  ehNossa: boolean;
  observacao: string;
};

const VAZIO: ParticipanteTela = { empresa: "", cnpj: "", posicao: "", preco: "", valorTotal: "", situacao: "CLASSIFICADA", ehNossa: false, observacao: "" };
const campo = "w-full rounded-md border border-slate-300 px-2 py-1 text-[13px]";

export default function Disputa({
  estudoId,
  participantes: iniciais,
  unidade,
  nossoPreco,
  teto,
  podeEditar,
}: {
  estudoId: string;
  participantes: ParticipanteTela[];
  // "R$/km", "R$/veículo-mês"…
  unidade: string;
  // O preço da última versão (para conferir contra o da linha da Azul).
  nossoPreco: number | null;
  // O menor preço máximo dos itens, se o edital publicou.
  teto: number | null;
  podeEditar: boolean;
}) {
  const [linhas, setLinhas] = useState<ParticipanteTela[]>(iniciais.length > 0 ? iniciais : []);
  const [msg, setMsg] = useState<{ erro?: string; ok?: string } | null>(null);
  const [salvando, iniciar] = useTransition();

  const mudar = (k: number, m: Partial<ParticipanteTela>) => {
    setMsg(null);
    setLinhas((l) => l.map((x, j) => (j === k ? { ...x, ...m } : m.situacao === "VENCEDORA" && x.situacao === "VENCEDORA" ? { ...x, situacao: "CLASSIFICADA" } : m.ehNossa && x.ehNossa ? { ...x, ehNossa: false } : x)));
  };
  const salvar = () =>
    iniciar(async () => {
      const r = await salvarParticipantes(estudoId, linhas);
      setMsg(r.erro ? { erro: r.erro } : { ok: "Disputa salva." });
    });

  const vencedora = linhas.find((l) => l.situacao === "VENCEDORA");
  const nossa = linhas.find((l) => l.ehNossa);
  const precoVencedor = vencedora ? lerNumero(vencedora.preco) : null;
  const precoNosso = nossa ? lerNumero(nossa.preco) : nossoPreco;

  return (
    <Cartao
      titulo="Resultado da disputa — participantes"
      ajuda={`Copie da ata da sessão: cada empresa com a posição, o preço (${unidade}) e a situação. Marque a linha da Azul. A vencedora e a nossa posição vão ao resultado do estudo e ao histórico de editais.`}
    >
      {(precoVencedor || teto) && (
        <dl className="mb-3 flex flex-wrap gap-x-8 gap-y-1 text-sm">
          {precoVencedor !== null && (
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">Vencedor</dt>
              <dd className="font-mono tabular-nums">
                {precoVencedor.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 4 })} {unidade.replace("R$", "")}
              </dd>
            </div>
          )}
          {precoVencedor !== null && precoNosso !== null && (
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">Nosso preço × vencedor</dt>
              <dd className={`font-mono tabular-nums ${(diferenca(precoNosso, precoVencedor) ?? 0) > 0 ? "text-red-700" : "text-emerald-700"}`}>{pct(diferenca(precoNosso, precoVencedor))}</dd>
            </div>
          )}
          {precoVencedor !== null && teto !== null && (
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">Desconto do vencedor sobre o teto</dt>
              <dd className="font-mono tabular-nums">{pct(-(diferenca(precoVencedor, teto) ?? 0))}</dd>
            </div>
          )}
        </dl>
      )}
      {linhas.length === 0 ? (
        <p className="text-sm text-slate-500">Nenhum participante registrado.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={`${th} w-14`}>Pos.</th>
                <th className={th}>Empresa</th>
                <th className={th}>CNPJ</th>
                <th className={thN}>Preço ({unidade})</th>
                <th className={thN}>Valor total</th>
                <th className={th}>Situação</th>
                <th className={th}>Azul</th>
                <th className={th}>Observação</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {linhas.map((x, k) => (
                <tr key={k} className={x.ehNossa ? "bg-blue-50/60" : x.situacao === "VENCEDORA" ? "bg-emerald-50/60" : undefined}>
                  <td className={td}>
                    <input className={`${campo} text-right`} inputMode="numeric" aria-label="Posição" disabled={!podeEditar} value={x.posicao} onChange={(e) => mudar(k, { posicao: e.target.value })} />
                  </td>
                  <td className={td}>
                    <input className={`${campo} min-w-48`} aria-label="Empresa" disabled={!podeEditar} value={x.empresa} maxLength={160} onChange={(e) => mudar(k, { empresa: e.target.value })} />
                  </td>
                  <td className={td}>
                    <input className={`${campo} w-40`} aria-label="CNPJ" disabled={!podeEditar} value={x.cnpj} maxLength={20} onChange={(e) => mudar(k, { cnpj: e.target.value })} />
                  </td>
                  <td className={td}>
                    <input className={`${campo} w-28 text-right`} inputMode="decimal" aria-label="Preço" disabled={!podeEditar} value={x.preco} onChange={(e) => mudar(k, { preco: e.target.value })} />
                  </td>
                  <td className={td}>
                    <input className={`${campo} w-32 text-right`} inputMode="decimal" aria-label="Valor total" disabled={!podeEditar} value={x.valorTotal} onChange={(e) => mudar(k, { valorTotal: e.target.value })} />
                  </td>
                  <td className={td}>
                    <select className={selecao} aria-label="Situação" disabled={!podeEditar} value={x.situacao} onChange={(e) => mudar(k, { situacao: e.target.value })}>
                      {SITUACOES_PARTICIPANTE.map((s) => (
                        <option key={s} value={s}>
                          {ROTULO_SITUACAO_PARTICIPANTE[s]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={`${td} text-center`}>
                    <input type="checkbox" aria-label="É a Azul" disabled={!podeEditar} checked={x.ehNossa} onChange={(e) => mudar(k, { ehNossa: e.target.checked })} />
                  </td>
                  <td className={td}>
                    <input className={`${campo} min-w-40`} aria-label="Observação" disabled={!podeEditar} value={x.observacao} maxLength={500} onChange={(e) => mudar(k, { observacao: e.target.value })} />
                  </td>
                  <td className={td}>
                    {podeEditar && (
                      <button type="button" className="text-xs text-slate-400 hover:text-red-700" aria-label={`Tirar ${x.empresa || "linha"}`} onClick={() => setLinhas((l) => l.filter((_, j) => j !== k))}>
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {podeEditar && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className={botao} onClick={() => setLinhas((l) => [...l, { ...VAZIO, posicao: String(l.length + 1) }])}>
            Acrescentar participante
          </button>
          {linhas.length > 0 && !linhas.some((l) => l.ehNossa) && (
            <button type="button" className={botao} onClick={() => setLinhas((l) => [...l, { ...VAZIO, empresa: "Azul Mob", ehNossa: true, preco: nossoPreco ? String(nossoPreco).replace(".", ",") : "" }])}>
              Acrescentar a Azul
            </button>
          )}
          <button type="button" className={botaoPrimario} disabled={salvando} onClick={salvar}>
            {salvando ? "Salvando…" : "Salvar disputa"}
          </button>
          {msg && <span className={`text-sm ${msg.erro ? "text-red-700" : "text-emerald-700"}`}>{msg.erro ?? msg.ok}</span>}
        </div>
      )}
    </Cartao>
  );
}
