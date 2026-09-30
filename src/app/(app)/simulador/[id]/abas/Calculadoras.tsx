"use client";

import { useState } from "react";
import { calcularEncargos, ENCARGOS_PADRAO, fatorDeUtilizacao, FU_PADRAO, JORNADAS, PRESETS_ENCARGOS, type Jornada, type ParametrosEncargos, type ParametrosFU } from "@/lib/simulador/maoDeObra";
import type { MapaOrigem } from "@/lib/simulador/premissas";
import type { EntradaSimulacao } from "@/lib/simulador/tipos";
import { CampoNumero, botao, botaoPrimario, num, pct, selecao } from "../comum";
import type { AlterarComOrigem } from "./Premissas";

// AS CALCULADORAS DE MÃO DE OBRA — encargos por grupos e motoristas por
// veículo pela jornada. Mostram a conta e, se a pessoa quiser, gravam o
// resultado na premissa com a composição na origem ("de onde veio este 64%?").

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="grid grid-cols-[1fr_110px] items-center gap-2 text-[13px] text-slate-700">
      <span>{rotulo}</span>
      {children}
    </label>
  );
}

export function CalculadoraEncargos({ entrada, origem, alterar, podeEditar }: { entrada: EntradaSimulacao; origem: MapaOrigem; alterar: AlterarComOrigem; podeEditar: boolean }) {
  const [p, setP] = useState<ParametrosEncargos>(ENCARGOS_PADRAO);
  const calc = calcularEncargos(p);
  const atual = entrada.premissas.pessoal.encargosPct;
  const campo = (k: keyof ParametrosEncargos, rotulo: string, percentual = true) => (
    <Linha rotulo={rotulo}>
      <CampoNumero valor={p[k] as number} percentual={percentual} casas={percentual ? 2 : 2} aoMudar={(v) => v !== null && v >= 0 && setP({ ...p, [k]: v })} />
    </Linha>
  );
  return (
    <details className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
      <summary className="cursor-pointer text-sm font-medium text-slate-800">
        Calcular os encargos pelos grupos A a D <span className="font-normal text-slate-500">— hoje: {pct(atual)}</span>
      </summary>
      <div className="mt-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {Object.entries(PRESETS_ENCARGOS).map(([k, r]) => (
            <button key={k} type="button" className={botao} title={r.ajuda} onClick={() => setP({ ...p, ...r.valores })}>
              {r.rotulo}
            </button>
          ))}
          <select className={selecao} value={p.modo} onChange={(e) => setP({ ...p, modo: e.target.value as ParametrosEncargos["modo"] })} title="Férias entram no fator de utilização OU nos encargos, nunca nos dois.">
            <option value="FU_COM_RESERVA">Férias cobertas pelos motoristas por veículo</option>
            <option value="POSTO">Férias provisionadas nos encargos</option>
          </select>
        </div>
        <div className="grid gap-x-6 gap-y-1.5 md:grid-cols-2 xl:grid-cols-3">
          {campo("inssPct", "INSS patronal")}
          {campo("ratPct", "RAT/SAT")}
          {campo("fap", "FAP (×)", false)}
          {campo("terceirosPct", "Terceiros (SEST/SENAT etc.)")}
          {campo("fgtsPct", "FGTS")}
          {campo("licencasFaltasPct", "Licenças, faltas, doença")}
          {campo("rotatividadeMensal", "Rotatividade mensal")}
          {campo("fracaoAvisoIndenizado", "Aviso indenizado (dos desligados)")}
          {campo("diasAvisoPrevio", "Dias de aviso prévio", false)}
          {campo("multaFgtsPct", "Multa do FGTS")}
        </div>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-[13px]">
            <tbody>
              {calc.grupos.map((g) => (
                <tr key={g.grupo} className="border-b border-slate-100 align-top">
                  <td className="px-2 py-1.5 font-medium">
                    Grupo {g.grupo} <span className="font-normal text-slate-500">{g.rotulo}</span>
                    <span className="block text-xs text-slate-500">{g.itens.map((i) => `${i.rotulo} ${pct(i.pct, 2)}`).join(" · ")}</span>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">{pct(g.total, 2)}</td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-semibold">
                <td className="px-2 py-1.5">Total de encargos</td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">{pct(calc.total, 2)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {podeEditar && (
          <button
            type="button"
            className={botaoPrimario}
            onClick={() =>
              alterar(
                (e) => void (e.premissas.pessoal.encargosPct = Number(calc.total.toFixed(6))),
                [],
                { ...origem, "pessoal.encargosPct": { origem: "AJUSTE", fonte: "calculadora de encargos", detalhe: `${calc.resumo}; antes: ${pct(atual, 2)}` } }
              )
            }
          >
            Usar {pct(calc.total, 2)} nos encargos
          </button>
        )}
      </div>
    </details>
  );
}

export function CalculadoraFU({ entrada, alterar, podeEditar }: { entrada: EntradaSimulacao; alterar: AlterarComOrigem; podeEditar: boolean }) {
  const perfis = entrada.premissas.perfis ?? [];
  const [p, setP] = useState<ParametrosFU>(FU_PADRAO);
  const [perfil, setPerfil] = useState(perfis[0]?.codigo ?? "");
  const calc = fatorDeUtilizacao(p);
  const alvo = perfis.find((x) => x.codigo === perfil);
  return (
    <details className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
      <summary className="cursor-pointer text-sm font-medium text-slate-800">Calcular motoristas por veículo pela jornada</summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-slate-500">
          Horas em que o veículo precisa de motorista, contando garagem até o primeiro ponto e o tempo de espera (que é jornada desde a ADI 5322).
          Some folgas, férias e reserva só se os encargos NÃO provisionam as férias.
        </p>
        <div className="grid gap-x-6 gap-y-1.5 md:grid-cols-2 xl:grid-cols-3">
          <Linha rotulo="Horas por dia">
            <CampoNumero valor={p.horasPorDia} casas={1} aoMudar={(v) => v !== null && v >= 0 && v <= 24 && setP({ ...p, horasPorDia: v })} />
          </Linha>
          <Linha rotulo="Dias por mês">
            <CampoNumero valor={p.diasPorMes} casas={1} aoMudar={(v) => v !== null && v >= 0 && v <= 31 && setP({ ...p, diasPorMes: v })} />
          </Linha>
          <Linha rotulo="Jornada">
            <select className={selecao} value={p.jornada} onChange={(e) => setP({ ...p, jornada: e.target.value as Jornada })}>
              {Object.entries(JORNADAS).map(([k, j]) => (
                <option key={k} value={k} title={j.ajuda}>
                  {j.rotulo}
                </option>
              ))}
            </select>
          </Linha>
          <label className="flex items-center gap-2 text-[13px] text-slate-700">
            <input type="checkbox" checked={p.somarAcrescimos} onChange={(e) => setP({ ...p, somarAcrescimos: e.target.checked })} />
            Somar folgas, férias (1/11) e reserva
          </label>
          {p.somarAcrescimos && (
            <>
              <Linha rotulo="Folgas e feriados">
                <CampoNumero valor={p.folgasPct} percentual aoMudar={(v) => v !== null && v >= 0 && setP({ ...p, folgasPct: v })} />
              </Linha>
              <Linha rotulo="Reserva (doença, faltas)">
                <CampoNumero valor={p.reservaPct} percentual aoMudar={(v) => v !== null && v >= 0 && setP({ ...p, reservaPct: v })} />
              </Linha>
            </>
          )}
        </div>
        <div className="grid gap-2 text-sm sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
            <p className="text-xs text-slate-500">Horas do posto no mês</p>
            <p className="font-mono">
              {num(calc.horasPostoMes, 1)} h <span className="text-xs text-slate-500">÷ {num(calc.horasContrato, 1)} h da jornada</span>
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
            <p className="text-xs text-slate-500">Alternativa com motoristas inteiros</p>
            <p className="font-mono">
              {calc.motoristasInteiros} + {num(calc.horasExtrasPorMotorista, 1)} h extras cada
            </p>
          </div>
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
            <p className="text-xs text-blue-800">Motoristas por veículo</p>
            <p className="font-mono text-base font-semibold text-blue-900">
              {num(calc.fuFinal, 2)}
              {calc.acrescimoPct > 0 && <span className="ml-1 text-xs font-normal">(+{pct(calc.acrescimoPct)})</span>}
            </p>
          </div>
        </div>
        {podeEditar && perfis.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <select className={selecao} value={perfil} onChange={(e) => setPerfil(e.target.value)}>
              {perfis.map((x) => (
                <option key={x.codigo} value={x.codigo}>
                  {x.descricao}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={botaoPrimario}
              disabled={!alvo}
              onClick={() =>
                alterar((e) => {
                  const x = e.premissas.perfis?.find((y) => y.codigo === perfil);
                  if (x) x.motorista.motoristasPorVeiculo = Number(calc.fuFinal.toFixed(2));
                })
              }
            >
              Usar {num(calc.fuFinal, 2)} em {alvo?.descricao ?? "…"}
            </button>
            <span className="text-xs text-slate-500">As rotas desse tipo sugerem motoristas = veículos × este fator; ajuste rota a rota se precisar.</span>
          </div>
        )}
        {perfis.length === 0 && <p className="text-xs text-slate-500">Adicione um tipo de veículo para aplicar o fator; nas rotas sem tipo, informe os motoristas direto na aba Operação.</p>}
      </div>
    </details>
  );
}
