"use client";

import { Fragment, useMemo, useState } from "react";
import { clausulaDeReequilibrio, lerInicio, proximoMes, reformaAnoAAno, type AnoReforma } from "@/lib/simulador/reforma";
import type { EntradaSimulacao, ResultadoSimulacao } from "@/lib/simulador/tipos";
import { Cartao, brl0, pct, td, tdN, th, thN } from "../comum";
import type { Alterar } from "./Operacao";

// A REFORMA TRIBUTÁRIA NO ESTUDO — o mesmo custo em cada ano do contrato,
// com os tributos daquele ano (src/lib/simulador/reforma.ts). Duas leituras:
// B, o preço que mantém o lucro alvo (e o reequilíbrio a pedir); A, o cliente
// pagando a nota de hoje (e a margem que sobra).

// "+2,3%", "0,0%" (sem o "−0,0%" do arredondamento).
const variacao = (v: number | null) => (v === null ? "—" : Math.abs(v) < 0.0005 ? "0,0%" : `${v > 0 ? "+" : ""}${pct(v)}`);


function GraficoMargem({ anos, alvo }: { anos: AnoReforma[]; alvo: number }) {
  const W = 640, H = 200, M = { t: 16, r: 12, b: 30, l: 12 };
  const vals = anos.map((a) => a.semReequilibrio.margem ?? 0);
  const max = Math.max(alvo, ...vals, 0.01) * 1.15, min = Math.min(0, ...vals);
  const y = (v: number) => M.t + ((max - v) / (max - min || 1)) * (H - M.t - M.b);
  const bw = (W - M.l - M.r) / Math.max(1, anos.length);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Margem sem reequilíbrio por ano: ${anos.map((a) => `${a.ano} ${pct(a.semReequilibrio.margem)}`).join(", ")}`} className="max-w-3xl">
      <line x1={M.l} x2={W - M.r} y1={y(0)} y2={y(0)} stroke="#cbd5e1" />
      <line x1={M.l} x2={W - M.r} y1={y(alvo)} y2={y(alvo)} stroke="#0f172a" strokeDasharray="4 4" strokeWidth={1} />
      <text x={W - M.r} y={y(alvo) - 4} textAnchor="end" fontSize={11} fill="#475569">
        lucro alvo {pct(alvo)}
      </text>
      {anos.map((a, i) => {
        const v = a.semReequilibrio.margem ?? 0;
        const x = M.l + i * bw + bw * 0.22, w = bw * 0.56, topo = Math.min(y(0), y(v)), altura = Math.max(1, Math.abs(y(v) - y(0)));
        return (
          <g key={a.ano}>
            <title>{`${a.ano}${a.projecao ? " (renovação)" : ""}: margem ${pct(v)} sem reequilíbrio; ${a.reequilibrio !== null ? `reequilíbrio para manter o alvo ${pct(a.reequilibrio)}` : ""}`}</title>
            <rect x={x} y={topo} width={w} height={altura} rx={4} fill={v >= alvo - 0.0005 ? "#1d4ed8" : v >= 0 ? "#d97706" : "#c2410c"} fillOpacity={a.projecao ? 0.4 : 1} />
            <text
              x={x + w / 2}
              y={altura > 24 ? topo + 16 : topo - 5}
              textAnchor="middle"
              fontSize={11}
              fill={altura > 24 && !a.projecao ? "#ffffff" : "#0f172a"}
              fontFamily="var(--font-geist-mono), monospace"
            >
              {pct(v)}
            </text>
            <text x={x + w / 2} y={H - 10} textAnchor="middle" fontSize={11} fill="#64748b">
              {a.ano}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Detalhe({ a }: { a: AnoReforma }) {
  const tabela = (titulo: string, linhas: { rotulo: string; aliquota: number | null; valor: number; memo?: string }[], rodape: string, total: number) => (
    <div>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{titulo}</h4>
      <table className="w-full text-[12.5px]">
        <tbody>
          {linhas.map((l) => (
            <tr key={l.rotulo}>
              <td className="py-0.5 pr-2 text-slate-700">
                {l.rotulo}
                {l.memo && <span className="block text-[11px] text-slate-500">{l.memo}</span>}
              </td>
              <td className="py-0.5 pr-2 text-right font-mono tabular-nums text-slate-500">{l.aliquota === null ? "" : pct(l.aliquota, 2)}</td>
              <td className="py-0.5 text-right font-mono tabular-nums">{brl0(l.valor)}</td>
            </tr>
          ))}
          <tr className="font-semibold">
            <td className="border-t border-slate-200 py-0.5">{rodape}</td>
            <td className="border-t border-slate-200" />
            <td className="border-t border-slate-200 py-0.5 text-right font-mono tabular-nums">{brl0(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
  return (
    <div className="grid gap-4 bg-slate-50 px-3 py-3 lg:grid-cols-2">
      {tabela(
        `Tributos de ${a.ano} (preço que mantém o alvo)`,
        a.tributos,
        "Total de tributos",
        a.tributos.reduce((s, t) => s + t.valor, 0)
      )}
      {a.creditos.length > 0 ? (
        tabela(`Créditos de ${a.ano}`, a.creditos, "Total de créditos (abate o custo)", a.credito)
      ) : (
        <p className="text-sm text-slate-500">Sem crédito em {a.ano}: PIS/COFINS cumulativos, como hoje. A folha nunca dá crédito.</p>
      )}
    </div>
  );
}

export default function Reforma({ entrada, resultado, alterar, inicioPrevisto }: { entrada: EntradaSimulacao; resultado: ResultadoSimulacao; alterar: Alterar; inicioPrevisto: string | null }) {
  const inicioTexto = entrada.reforma?.inicio ?? inicioPrevisto ?? proximoMes();
  const creditoVeiculo = entrada.reforma?.creditoVeiculo === true;
  const ref = useMemo(
    () => reformaAnoAAno(entrada, resultado, { inicio: lerInicio(inicioTexto) ?? lerInicio(proximoMes())!, creditoVeiculo }),
    [entrada, resultado, inicioTexto, creditoVeiculo]
  );
  const inicio = ref.inicio;
  const [aberto, setAberto] = useState<number | null>(null);
  const alvo = entrada.premissas.preco.lucroAlvoPct;
  const cbsRef = ref.tabela.find((t) => t.ano === 2033)!.cbs;
  const ibsRef = ref.tabela.find((t) => t.ano === 2033)!.ibs;
  const mudar = (f: (r: NonNullable<EntradaSimulacao["reforma"]>) => void) =>
    alterar((e) => {
      e.reforma = { ...(e.reforma ?? {}) };
      f(e.reforma);
    });
  const [copiado, setCopiado] = useState(false);
  const clausula = clausulaDeReequilibrio(ref);
  const soma = (f: (a: AnoReforma) => number) => ref.anos.reduce((s, a) => s + f(a), 0);

  return (
    <div className="space-y-4">
      <Cartao
        titulo="Reforma tributária ano a ano"
        ajuda={`O mesmo custo do estudo em cada ano do contrato, com os tributos daquele ano: PIS/COFINS até 2026; CBS e IBS por fora do preço, com crédito sobre as compras (combustível, pneus, manutenção, pedágio…) a partir de 2027; ISS e ICMS caindo de 2029 a 2032 e extintos em 2033. Alíquotas de referência estimadas: CBS ${pct(cbsRef, 1)} e IBS ${pct(ibsRef, 1)} (aba Premissas). O preço dos insumos fica o de hoje, com a CBS/IBS dentro; a administração central não muda.`}
      >
        <div className="flex flex-wrap items-end gap-4">
          <label className="space-y-1 text-xs text-slate-500">
            <span className="block">Início do contrato</span>
            <input
              type="month"
              className="rounded-md border border-slate-300 px-2 py-1 text-[13px]"
              value={`${inicio.ano}-${String(inicio.mes).padStart(2, "0")}`}
              onChange={(ev) => lerInicio(ev.target.value) && mudar((r) => void (r.inicio = ev.target.value))}
            />
          </label>
          <span className="text-xs text-slate-500">vigência de {entrada.premissas.contrato.vigenciaMeses} meses</span>
          <label className="flex items-center gap-2 text-sm text-slate-700" title="Veículo comprado a partir de 2027 gera crédito de CBS/IBS na compra: o valor líquido cai, e com ele a depreciação e o capital. A frota atual, comprada antes, não gera.">
            <input type="checkbox" checked={creditoVeiculo} onChange={(ev) => mudar((r) => void (r.creditoVeiculo = ev.target.checked))} />
            Veículo comprado com crédito de CBS/IBS
          </label>
        </div>

        {!ref.atravessa && <p className="text-sm text-slate-600">O contrato termina antes de 2027: os tributos são os de hoje em toda a vigência.</p>}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Margem hoje", pct(ref.hoje.margem), `nota de ${brl0(ref.hoje.notaMes)} por mês`],
            [
              "Pior margem sem reequilíbrio",
              pct(ref.piorSemReequilibrio?.margem),
              ref.piorSemReequilibrio ? `em ${ref.piorSemReequilibrio.ano}, com o cliente pagando a nota de hoje` : "—",
            ],
            ["Reequilíbrio no último ano", variacao(ref.reequilibrioFinal), `sobre a nota de hoje, para manter ${pct(alvo)} de lucro`],
            ["Carga média no contrato", pct(soma((a) => a.nota) > 0 ? soma((a) => (a.carga ?? 0) * a.nota) / soma((a) => a.nota) : null), "tributos − créditos, sobre a nota"],
          ].map(([t, v, s]) => (
            <div key={t} className="rounded-lg border border-slate-200 px-3 py-2">
              <div className="text-xs font-medium text-slate-500">{t}</div>
              <div className="font-mono text-lg font-semibold tabular-nums text-slate-900">{v}</div>
              <div className="text-[11px] text-slate-500">{s}</div>
            </div>
          ))}
        </div>

        <div>
          <h3 className="text-sm font-semibold text-slate-900">Margem por ano, se o cliente continuar pagando a nota de hoje</h3>
          <GraficoMargem anos={[...ref.anos, ...ref.alemDoContrato]} alvo={alvo} />
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#1d4ed8]" /> no lucro alvo
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#d97706]" /> abaixo do alvo
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#c2410c]" /> prejuízo · tracejado: lucro alvo
            {ref.alemDoContrato.length > 0 && <span>· mais claro: depois do contrato, se renovado</span>}
          </div>
        </div>
      </Cartao>

      <Cartao titulo="Ano a ano" ajuda="Valores de cada ano civil do contrato (meses do contrato no ano) e, depois dele, os anos que faltam até o fim da transição (2033), como renovação nas mesmas condições, 12 meses por ano. B: o preço que mantém o lucro alvo — a nota a cobrar e o reequilíbrio sobre a de hoje. A: a nota de hoje, com a CBS/IBS saindo de dentro dela. Clique no ano para abrir tributos e créditos.">
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-[13px]">
            <thead>
              <tr>
                {["Ano", "Meses", "Custo", "Crédito", "Tributos por dentro", "B: preço sem CBS/IBS", "B: CBS + IBS", "B: nota", "B: reequilíbrio", "A: margem", "Carga"].map((t, k) => (
                  <th key={t} className={k === 0 ? th : thN}>
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...ref.anos, ...ref.alemDoContrato].map((a) => (
                <Fragment key={a.ano}>
                  {a === ref.alemDoContrato[0] && (
                    <tr>
                      <td colSpan={11} className="border-y border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
                        Depois do contrato, até o fim da transição — se renovado nas mesmas condições, 12 meses por ano
                      </td>
                    </tr>
                  )}
                  <tr
                    className={`cursor-pointer hover:bg-slate-50 ${a.projecao ? "text-slate-500" : ""}`}
                    onClick={() => setAberto(aberto === a.ano ? null : a.ano)}
                    aria-expanded={aberto === a.ano}
                  >
                    <td className={`${td} font-medium`}>
                      <span className="mr-1 text-slate-400">{aberto === a.ano ? "▾" : "▸"}</span>
                      {a.ano}
                      {a.transicao.teste && <span className="ml-1 text-[11px] font-normal text-slate-500">teste</span>}
                      {a.projecao && <span className="ml-1 text-[11px] font-normal text-slate-500">renovação</span>}
                    </td>
                    <td className={tdN}>{a.meses}</td>
                    <td className={tdN}>{brl0(a.custo)}</td>
                    <td className={tdN}>{a.credito ? `−${brl0(a.credito)}` : "—"}</td>
                    <td className={tdN}>{pct(a.tributosDentroPct, 2)}</td>
                    <td className={tdN}>{brl0(a.receita)}</td>
                    <td className={tdN}>{a.cbs + a.ibs ? brl0(a.cbs + a.ibs) : "—"}</td>
                    <td className={`${tdN} font-semibold`}>{brl0(a.nota)}</td>
                    <td className={tdN}>{variacao(a.reequilibrio)}</td>
                    <td className={tdN}>{pct(a.semReequilibrio.margem)}</td>
                    <td className={tdN}>{pct(a.carga)}</td>
                  </tr>
                  {aberto === a.ano && (
                    <tr>
                      <td colSpan={11} className="border-b border-slate-100 p-0">
                        <Detalhe a={a} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500">
          Estimativa: as alíquotas de referência da CBS e do IBS ainda serão fixadas pelo Senado, e o fretamento vai à alíquota cheia (a redução de 40% é do
          transporte coletivo regular). Confira com a contabilidade antes de levar à proposta.
        </p>
      </Cartao>

      <Cartao
        titulo="Cláusula de reequilíbrio"
        acao={
          <button
            type="button"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            onClick={() => {
              navigator.clipboard?.writeText(clausula).then(
                () => setCopiado(true),
                () => setCopiado(false)
              );
            }}
          >
            {copiado ? "Copiado" : "Copiar"}
          </button>
        }
      >
        <p className="text-sm leading-relaxed text-slate-700">{clausula}</p>
      </Cartao>
    </div>
  );
}
