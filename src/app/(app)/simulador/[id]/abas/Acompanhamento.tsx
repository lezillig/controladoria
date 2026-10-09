"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ROTULO_NATUREZA, type Calibracao } from "@/lib/simulador/calibracao";
import { ROTULO_UNIDADE, type UnidadePreco } from "@/lib/simulador/tipos";
import { lancarRealizado, registrarLance, registrarResultado, type Resultado } from "../../actions";
import { Cartao, botao, botaoPrimario, brl, num, pct, selecao, td, tdN, th, thN } from "../comum";

// DEPOIS DA CONTA: as versões salvas, os lances, o resultado da disputa e o
// realizado do contrato contra o previsto. É o que fecha o ciclo — a
// calibração mostra onde a simulação errou, e a próxima parte dali.

export type VersaoTela = {
  id: string;
  versao: number;
  status: string;
  criadoEm: string;
  autorNome: string | null;
  precoKm: number | null;
  margem: number | null;
  lucro: number;
  faturamento: number;
  unidade: string | null;
  observacoes: string | null;
};
export type LanceTela = { id: string; fase: string; dataHora: string; preco: number | null; valorTotal: number | null; observacao: string | null; autor: string | null };
export type RealizadoTela = { competencia: string; kmRealizado: number | null; faturamento: number | null; fonte: string | null };
export type ResultadoTela = {
  status: string;
  posicao: number | null;
  vencedor: string | null;
  precoVencedor: number | null;
  valorTotal: number | null;
  data: string | null;
  observacao: string | null;
};

const ROTULO_STATUS_VERSAO: Record<string, string> = { RASCUNHO: "Rascunho", APROVADA: "Aprovada", LANCADA: "Lançada" };
const campo = "w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-600 focus:outline-none";
const rotuloCampo = "text-[12px] font-medium text-slate-600";

function useAcao() {
  const [pendente, iniciar] = useTransition();
  const [msg, setMsg] = useState<{ erro?: string; ok?: string } | null>(null);
  const rodar = (f: () => Promise<Resultado>, sucesso: string, form?: HTMLFormElement) =>
    iniciar(async () => {
      const r = await f();
      if (r.erro) setMsg({ erro: r.erro });
      else {
        setMsg({ ok: r.mensagem ?? sucesso });
        form?.reset();
      }
    });
  const aviso = msg && <p className={`text-sm ${msg.erro ? "text-red-700" : "text-emerald-700"}`}>{msg.erro ?? msg.ok}</p>;
  return { pendente, rodar, aviso };
}

export default function Acompanhamento({
  estudoId,
  versoes,
  versaoAberta,
  lances,
  resultado,
  statusOpcoes,
  realizados,
  calibracao,
  versaoCalibrada,
  podeEditar,
}: {
  estudoId: string;
  versoes: VersaoTela[];
  versaoAberta: number | null;
  lances: LanceTela[];
  resultado: ResultadoTela;
  statusOpcoes: { valor: string; rotulo: string }[];
  realizados: RealizadoTela[];
  calibracao: Calibracao | null;
  versaoCalibrada: number | null;
  podeEditar: boolean;
}) {
  const lance = useAcao();
  const disputa = useAcao();
  const realizado = useAcao();

  return (
    <div className="space-y-4">
      <Cartao titulo="Versões salvas" ajuda="Cada versão guarda a conta inteira. Abrir uma versão antiga mostra a simulação exatamente como foi salva; a planilha sai em fórmulas.">
        {versoes.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhuma versão salva ainda. Use “Salvar versão” no topo.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-[13px]">
              <thead>
                <tr>
                  <th className={th}>Versão</th>
                  <th className={th}>Situação</th>
                  <th className={th}>Quando / quem</th>
                  <th className={thN}>Preço</th>
                  <th className={thN}>Faturamento</th>
                  <th className={thN}>Lucro</th>
                  <th className={thN}>Margem</th>
                  <th className={th}>Observações</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {versoes.map((v) => (
                  <tr key={v.id} className={v.versao === versaoAberta ? "bg-blue-50/60" : undefined}>
                    <td className={`${td} font-semibold`}>v{v.versao}</td>
                    <td className={td}>{ROTULO_STATUS_VERSAO[v.status] ?? v.status}</td>
                    <td className={`${td} text-xs text-slate-600`}>
                      {new Date(v.criadoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                      {v.autorNome ? ` · ${v.autorNome}` : ""}
                    </td>
                    <td className={tdN}>
                      {brl(v.precoKm, 4)} <span className="text-[11px] text-slate-500">{ROTULO_UNIDADE[(v.unidade ?? "KM") as UnidadePreco] ?? ""}</span>
                    </td>
                    <td className={tdN}>{brl(v.faturamento)}</td>
                    <td className={tdN}>{brl(v.lucro)}</td>
                    <td className={tdN}>{pct(v.margem)}</td>
                    <td className={`${td} max-w-[260px] truncate text-xs text-slate-600`} title={v.observacoes ?? ""}>
                      {v.observacoes ?? ""}
                    </td>
                    <td className={`${td} whitespace-nowrap text-right`}>
                      <Link className="text-blue-700 hover:underline" href={`/simulador/${estudoId}?versao=${v.id}`}>
                        Abrir
                      </Link>
                      <span className="mx-1 text-slate-300">|</span>
                      <a className="text-blue-700 hover:underline" href={`/api/simulador/${estudoId}/xlsx?versao=${v.id}`}>
                        Excel
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>

      <div className="grid gap-4 lg:grid-cols-2">
        <Cartao titulo="Lances e propostas" ajuda="Registre cada preço enviado: proposta inicial, lances, negociação. O histórico mostra quanto se cedeu e de qual versão saiu cada preço.">
          {podeEditar && (
            <form
              className="grid grid-cols-2 gap-2"
              onSubmit={(ev) => {
                ev.preventDefault();
                const f = ev.currentTarget;
                lance.rodar(() => registrarLance(estudoId, new FormData(f)), "Lance registrado.", f);
              }}
            >
              <label className="space-y-1">
                <span className={rotuloCampo}>Fase</span>
                <select name="fase" className={`${selecao} w-full py-1.5`}>
                  <option value="PROPOSTA">Proposta inicial</option>
                  <option value="LANCE">Lance</option>
                  <option value="NEGOCIACAO">Negociação</option>
                  <option value="FINAL">Preço final</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className={rotuloCampo}>Preço unitário (R$)</span>
                <input name="preco" inputMode="decimal" required className={campo} placeholder="0,00" />
              </label>
              <label className="space-y-1">
                <span className={rotuloCampo}>Valor total (R$)</span>
                <input name="valorTotal" inputMode="decimal" className={campo} />
              </label>
              <label className="space-y-1">
                <span className={rotuloCampo}>Quando</span>
                <input name="dataHora" type="datetime-local" className={campo} />
              </label>
              <label className="space-y-1">
                <span className={rotuloCampo}>Versão da simulação</span>
                <select name="simulacaoId" className={`${selecao} w-full py-1.5`} defaultValue={versoes[0]?.id ?? ""}>
                  <option value="">—</option>
                  {versoes.map((v) => (
                    <option key={v.id} value={v.id}>
                      v{v.versao}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className={rotuloCampo}>Itens (vazio = lote)</span>
                <input name="itens" className={campo} placeholder="ex.: 1,2" />
              </label>
              <label className="col-span-2 space-y-1">
                <span className={rotuloCampo}>Observação</span>
                <input name="observacao" className={campo} />
              </label>
              <div className="col-span-2 flex items-center gap-3">
                <button className={botaoPrimario} disabled={lance.pendente}>
                  {lance.pendente ? "Registrando…" : "Registrar lance"}
                </button>
                {lance.aviso}
              </div>
            </form>
          )}
          {lances.length > 0 ? (
            <ul className="divide-y divide-slate-100 text-sm">
              {lances.map((l) => (
                <li key={l.id} className="flex items-baseline justify-between gap-3 py-1.5">
                  <span>
                    <span className="font-medium">{l.fase.toLowerCase()}</span>{" "}
                    <span className="text-xs text-slate-500">{new Date(l.dataHora).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span>
                    {l.observacao && <span className="block text-xs text-slate-500">{l.observacao}</span>}
                  </span>
                  <span className="font-mono tabular-nums">
                    {brl(l.preco, 4)}
                    {l.valorTotal !== null && <span className="block text-right text-xs text-slate-500">{brl(l.valorTotal)}</span>}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">Nenhum lance registrado.</p>
          )}
        </Cartao>

        <Cartao titulo="Resultado da disputa" ajuda="Ganhou ou perdeu, para quem e a que preço. É o dado que ensina onde o preço da Azul Mob está em relação ao mercado.">
          {podeEditar ? (
            <form
              className="grid grid-cols-2 gap-2"
              onSubmit={(ev) => {
                ev.preventDefault();
                const f = ev.currentTarget;
                disputa.rodar(() => registrarResultado(estudoId, new FormData(f)), "Resultado registrado.");
              }}
            >
              <label className="space-y-1">
                <span className={rotuloCampo}>Situação</span>
                <select name="status" defaultValue={resultado.status} className={`${selecao} w-full py-1.5`}>
                  {statusOpcoes.map((s) => (
                    <option key={s.valor} value={s.valor}>
                      {s.rotulo}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className={rotuloCampo}>Nossa posição</span>
                <input name="posicao" inputMode="numeric" defaultValue={resultado.posicao ?? ""} className={campo} />
              </label>
              <label className="col-span-2 space-y-1">
                <span className={rotuloCampo}>Vencedor</span>
                <input name="vencedor" defaultValue={resultado.vencedor ?? ""} className={campo} />
              </label>
              <label className="space-y-1">
                <span className={rotuloCampo}>Preço vencedor (R$)</span>
                <input name="precoVencedor" inputMode="decimal" defaultValue={resultado.precoVencedor?.toLocaleString("pt-BR") ?? ""} className={campo} />
              </label>
              <label className="space-y-1">
                <span className={rotuloCampo}>Valor total vencedor (R$)</span>
                <input name="valorTotal" inputMode="decimal" defaultValue={resultado.valorTotal?.toLocaleString("pt-BR") ?? ""} className={campo} />
              </label>
              <label className="space-y-1">
                <span className={rotuloCampo}>Data</span>
                <input name="data" type="date" defaultValue={resultado.data ?? ""} className={campo} />
              </label>
              <label className="col-span-2 space-y-1">
                <span className={rotuloCampo}>Observação</span>
                <textarea name="observacao" rows={2} defaultValue={resultado.observacao ?? ""} className={campo} />
              </label>
              <div className="col-span-2 flex items-center gap-3">
                <button className={botaoPrimario} disabled={disputa.pendente}>
                  {disputa.pendente ? "Gravando…" : "Gravar resultado"}
                </button>
                {disputa.aviso}
              </div>
            </form>
          ) : (
            <p className="text-sm text-slate-600">
              {statusOpcoes.find((s) => s.valor === resultado.status)?.rotulo}
              {resultado.vencedor && ` · vencedor: ${resultado.vencedor}`}
              {resultado.precoVencedor !== null && ` · ${brl(resultado.precoVencedor, 4)}`}
            </p>
          )}
        </Cartao>
      </div>

      <Cartao
        titulo="Realizado × previsto"
        ajuda={`Com o contrato rodando, lance o realizado do mês (ou deixe a controladoria preencher). A calibração compara com a última versão lançada${versaoCalibrada ? ` (v${versaoCalibrada})` : ""} e diz que premissa corrigir no próximo estudo.`}
      >
        {podeEditar && (
          <form
            className="grid grid-cols-2 gap-2 md:grid-cols-5"
            onSubmit={(ev) => {
              ev.preventDefault();
              const f = ev.currentTarget;
              realizado.rodar(() => lancarRealizado(estudoId, new FormData(f)), "Realizado gravado.", f);
            }}
          >
            <label className="space-y-1">
              <span className={rotuloCampo}>Competência</span>
              <input name="competencia" type="month" required className={campo} />
            </label>
            {[
              ["kmRealizado", "Km faturado"],
              ["faturamento", "Faturamento"],
              ["custoFolha", "Folha"],
              ["custoCombustivel", "Combustível"],
              ["custoManutencao", "Manutenção"],
              ["custoVeiculo", "Veículo"],
              ["custoPedagio", "Pedágio"],
              ["custoIndiretos", "Indiretos"],
              ["custoOutros", "Outros diretos"],
            ].map(([nome, rotulo]) => (
              <label key={nome} className="space-y-1">
                <span className={rotuloCampo}>{rotulo}</span>
                <input name={nome} inputMode="decimal" className={campo} />
              </label>
            ))}
            <div className="col-span-2 flex items-center gap-3 md:col-span-5">
              <button className={botao} disabled={realizado.pendente}>
                {realizado.pendente ? "Gravando…" : "Gravar mês"}
              </button>
              <span className="text-xs text-slate-500">Campo vazio não apaga o que já estava gravado no mês.</span>
              {realizado.aviso}
            </div>
          </form>
        )}
        {realizados.length > 0 && (
          <p className="text-xs text-slate-500">
            Meses lançados: {realizados.map((r) => `${r.competencia}${r.fonte ? ` (${r.fonte})` : ""}`).join(", ")}.
          </p>
        )}
        {calibracao && calibracao.meses.length > 0 ? (
          <>
            <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
              <div>
                <p className="text-xs text-slate-500">Km previsto / mês</p>
                <p className="font-mono">{num(calibracao.kmPrevistoMes)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Km faturado (média)</p>
                <p className="font-mono">{num(calibracao.kmRealizadoMedio)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Utilização real</p>
                <p className="font-mono">{pct(calibracao.utilizacaoReal)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Faturamento realizado × previsto</p>
                <p className="font-mono">
                  {brl(calibracao.faturamentoRealizadoMedio, 0)} / {brl(calibracao.faturamentoPrevistoMes, 0)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Margem realizada × prevista</p>
                <p className="font-mono">
                  {pct(calibracao.margemRealizada)} / {pct(calibracao.margemPrevista)}
                </p>
              </div>
            </div>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-[13px]">
                <thead>
                  <tr>
                    <th className={th}>Natureza</th>
                    <th className={thN}>Previsto / mês</th>
                    <th className={thN}>Previsto no km real</th>
                    <th className={thN}>Realizado médio</th>
                    <th className={thN}>Desvio</th>
                    <th className={thN}>Meses</th>
                  </tr>
                </thead>
                <tbody>
                  {calibracao.linhas.map((l) => (
                    <tr key={l.natureza}>
                      <td className={td}>{ROTULO_NATUREZA[l.natureza]}</td>
                      <td className={tdN}>{brl(l.previstoMes, 0)}</td>
                      <td className={tdN}>{brl(l.previstoAjustado, 0)}</td>
                      <td className={tdN}>{brl(l.realizadoMedio, 0)}</td>
                      <td className={`${tdN} ${l.desvioPct !== null && Math.abs(l.desvioPct) > 0.1 ? "font-semibold text-red-700" : ""}`}>{pct(l.desvioPct)}</td>
                      <td className={tdN}>{l.meses}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {calibracao.sugestoes.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                {calibracao.sugestoes.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-sm text-slate-500">{versaoCalibrada ? "Sem meses realizados ainda." : "A calibração começa quando houver uma versão lançada e meses realizados."}</p>
        )}
      </Cartao>
    </div>
  );
}
