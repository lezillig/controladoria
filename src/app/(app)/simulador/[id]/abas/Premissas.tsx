"use client";

import { useState } from "react";
import { CAMPOS_PREMISSAS, ROTULO_GRUPO, lerCaminho, escreverCaminho, type CampoPremissa, type MapaOrigem } from "@/lib/simulador/premissas";
import { aplicarIndicadores, ROTULO_CONFIANCA, type IndicadorReal } from "@/lib/simulador/aplicarReais";
import type { EntradaSimulacao } from "@/lib/simulador/tipos";
import { Cartao, CampoNumero, SeloOrigem, botao, botaoPrimario, selecao } from "../comum";
import { CalculadoraEncargos } from "./Calculadoras";

export type AlterarComOrigem = (mudar: (e: EntradaSimulacao) => void, premissasAjustadas?: string[], novaOrigem?: MapaOrigem) => void;

// Os regimes: alíquotas de partida para o preço, a confirmar com a
// contabilidade. Presumido com IRPJ e CSLL como fração do faturamento; Real
// com IR/CSLL sobre o lucro e crédito de PIS/COFINS não cumulativo.
// Os regimes para o preço, pela pesquisa em docs/simulador_custos/PESQUISA.md
// (seção 5). Pontos de partida — o enquadramento é da contabilidade.
const REGIMES: Record<string, { rotulo: string; valores: Record<string, number>; ajuda: string }> = {
  PRESUMIDO: {
    rotulo: "Presumido",
    valores: { pis: 0.0065, cofins: 0.03, irpj: 0.04, csll: 0.0108, irpjCsllSobreLucroPct: 0, creditoPisCofinsPct: 0 },
    ajuda: "Transporte de passageiros: PIS 0,65% e COFINS 3% cumulativos; IRPJ 15% × 16% = 2,4% e CSLL 9% × 12% = 1,08% da receita.",
  },
  REAL: {
    rotulo: "Real — transporte de passageiros",
    valores: { pis: 0.0065, cofins: 0.03, irpj: 0, csll: 0, irpjCsllSobreLucroPct: 0.34, creditoPisCofinsPct: 0 },
    ajuda: "Fretamento e transporte de passageiros continuam no PIS/COFINS cumulativo (3,65%, sem crédito) mesmo no Lucro Real; IRPJ e CSLL de 34% sobre o lucro.",
  },
  REAL_LOCACAO: {
    rotulo: "Real — locação sem motorista",
    valores: { pis: 0.0165, cofins: 0.076, irpj: 0, csll: 0, irpjCsllSobreLucroPct: 0.34, creditoPisCofinsPct: 0.0925 },
    ajuda: "Locação sem motorista no Lucro Real: PIS 1,65% e COFINS 7,6% não cumulativos, com crédito de 9,25% sobre combustível, peças, pneus, depreciação e garagem; sem ISS.",
  },
};

function Campo({ campo, entrada, origem, alterar, podeEditar }: { campo: CampoPremissa; entrada: EntradaSimulacao; origem: MapaOrigem; alterar: AlterarComOrigem; podeEditar: boolean }) {
  const valor = lerCaminho(entrada.premissas, campo.caminho);
  const o = origem[campo.caminho];
  const definir = (v: unknown) => alterar((e) => escreverCaminho(e.premissas, campo.caminho, v), [campo.caminho]);
  let controle;
  if (campo.tipo === "bool")
    controle = (
      <select className={`${selecao} w-full`} disabled={!podeEditar} value={valor ? "1" : "0"} onChange={(ev) => definir(ev.target.value === "1")}>
        <option value="1">Sim</option>
        <option value="0">Não</option>
      </select>
    );
  else if (campo.tipo === "modo")
    controle = (
      <select className={`${selecao} w-full`} disabled={!podeEditar} value={String(valor)} onChange={(ev) => definir(ev.target.value)}>
        <option value="MENSAL">Mensal</option>
        <option value="PERIODO">Período</option>
      </select>
    );
  else if (campo.tipo === "metodoDepreciacao")
    controle = (
      <select className={`${selecao} w-full`} disabled={!podeEditar} value={String(valor)} onChange={(ev) => definir(ev.target.value)}>
        <option value="PERCENTUAL">% ao ano</option>
        <option value="LINEAR">Linear</option>
        <option value="SOMA_DIGITOS">Soma dos dígitos</option>
      </select>
    );
  else controle = <CampoNumero valor={valor as number} percentual={campo.tipo === "pct"} casas={campo.tipo === "pct" ? 3 : 4} desativado={!podeEditar} aoMudar={(v) => v !== null && definir(v)} />;
  return (
    <div className="grid grid-cols-[1fr_120px] items-center gap-x-3 gap-y-1 rounded-lg border border-slate-200 bg-white px-3 py-2" title={campo.ajuda}>
      <label className="text-[13px] text-slate-700">{campo.rotulo}</label>
      {controle}
      <div className="col-span-2 flex items-center justify-between gap-2 text-[11px] text-slate-500">
        <span>{campo.unidade}</span>
        <SeloOrigem origem={o?.origem} titulo={[o?.fonte, o?.detalhe].filter(Boolean).join(" — ")} />
      </div>
    </div>
  );
}

export default function Premissas({
  entrada,
  origem,
  alterar,
  podeEditar,
  indicadores,
  lacunas,
}: {
  entrada: EntradaSimulacao;
  origem: MapaOrigem;
  alterar: AlterarComOrigem;
  podeEditar: boolean;
  indicadores: IndicadorReal[];
  lacunas: string[];
}) {
  const [escolhidos, setEscolhidos] = useState<Set<string>>(new Set());
  const [mensagem, setMensagem] = useState<string | null>(null);
  const grupos = new Map<string, CampoPremissa[]>();
  for (const c of CAMPOS_PREMISSAS) {
    if (c.caminho === "contrato.modo") continue;
    grupos.set(c.grupo, [...(grupos.get(c.grupo) ?? []), c]);
  }
  const aplicaveis = indicadores.filter((i) => !i.caminho.startsWith("referencia:"));
  const referencias = indicadores.filter((i) => i.caminho.startsWith("referencia:"));
  const valorAtual = (i: IndicadorReal) => {
    if (i.caminho.startsWith("perfil:")) {
      const [, tipo, caminho] = i.caminho.split(":");
      const perfil = entrada.premissas.perfis?.find((p) => p.tipo === tipo);
      if (!perfil) return null;
      const [grupo, campo] = caminho.split(".");
      return grupo === "veiculo" ? (perfil.veiculo as Record<string, unknown>)[campo] : grupo === "variaveis" ? (perfil.variaveis as Record<string, unknown>)[campo] : null;
    }
    return lerCaminho(entrada.premissas, i.caminho);
  };
  const formatar = (v: unknown, unidade: string) =>
    typeof v !== "number" ? "—" : unidade.includes("%") ? `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%` : v.toLocaleString("pt-BR", { maximumFractionDigits: 4 });

  return (
    <div className="space-y-4">
      <Cartao
        titulo="Custos reais da Azul Mob"
        ajuda="Medidos na controladoria nos últimos 12 meses fechados: DRE por categoria da Omie, extrato do cartão de combustível e frota do sistema de gestão. Escolha os que servem a este estudo — a manutenção de uma frota velha não é a de uma frota nova — e aplique; a premissa passa a mostrar a origem 'custo real' com a conta."
        acao={
          podeEditar &&
          aplicaveis.length > 0 && (
            <button
              type="button"
              className={botaoPrimario}
              disabled={escolhidos.size === 0}
              onClick={() => {
                const r = aplicarIndicadores(entrada.premissas, entrada.premissas.perfis ?? [], indicadores, [...escolhidos], origem);
                alterar((e) => void (e.premissas = { ...r.premissas, perfis: r.perfis }), [], r.origem);
                setMensagem(
                  `${r.aplicados.length === 1 ? "1 premissa" : `${r.aplicados.length} premissas`} com custo real${r.ignorados.length ? `; ${r.ignorados.length} sem perfil correspondente no estudo — adicione o tipo de veículo na aba Veículos` : ""}.`
                );
                setEscolhidos(new Set());
              }}
            >
              Usar os escolhidos ({escolhidos.size})
            </button>
          )
        }
      >
        {mensagem && <p className="text-xs text-emerald-700">{mensagem}</p>}
        {indicadores.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 px-4 py-4 text-sm text-slate-500">
            Nenhum custo real pôde ser medido. {lacunas[0] ?? "A base da controladoria ainda não cobre os meses necessários."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-[13px]">
              <thead>
                <tr>
                  <th className="border-b border-slate-200 bg-slate-50 px-2 py-2" />
                  {["Indicador", "Medido", "No estudo", "Confiança", "Como foi medido"].map((t) => (
                    <th key={t} className="whitespace-nowrap border-b border-slate-200 bg-slate-50 px-2 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...aplicaveis, ...referencias].map((i) => {
                  const referencia = i.caminho.startsWith("referencia:");
                  return (
                    <tr key={i.caminho} className={referencia ? "text-slate-500" : ""}>
                      <td className="border-b border-slate-100 px-2 py-1.5">
                        {!referencia && podeEditar && (
                          <input
                            type="checkbox"
                            aria-label={`Usar ${i.rotulo}`}
                            checked={escolhidos.has(i.caminho)}
                            onChange={(ev) => {
                              const s = new Set(escolhidos);
                              if (ev.target.checked) s.add(i.caminho);
                              else s.delete(i.caminho);
                              setEscolhidos(s);
                            }}
                          />
                        )}
                      </td>
                      <td className="border-b border-slate-100 px-2 py-1.5">
                        {i.rotulo}
                        {referencia && <span className="ml-1 text-[11px]">(referência)</span>}
                      </td>
                      <td className="whitespace-nowrap border-b border-slate-100 px-2 py-1.5 text-right font-mono tabular-nums">
                        {formatar(i.valor, i.unidade)} <span className="font-sans text-[11px] text-slate-500">{i.unidade}</span>
                      </td>
                      <td className="border-b border-slate-100 px-2 py-1.5 text-right font-mono tabular-nums">{referencia ? "—" : formatar(valorAtual(i), i.unidade)}</td>
                      <td className="border-b border-slate-100 px-2 py-1.5 text-xs">{ROTULO_CONFIANCA[i.confianca]}</td>
                      <td className="border-b border-slate-100 px-2 py-1.5 text-xs text-slate-600">
                        {i.base}
                        {i.avisos.length > 0 && <span className="block text-amber-700">{i.avisos.join(" · ")}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {lacunas.length > 0 && (
          <details className="text-xs text-slate-600">
            <summary className="cursor-pointer text-slate-500">O que não pôde ser medido ({lacunas.length})</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {lacunas.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </details>
        )}
      </Cartao>

      <Cartao
        titulo="Regime tributário"
        ajuda="No Presumido, IRPJ e CSLL entram como fração do faturamento: transporte de passageiros presume 16% (não os 8% de cargas), e o IRPJ leva o adicional de 10% — 4% da receita na margem. No Real, incidem sobre o lucro; o PIS/COFINS de transporte de passageiros continua cumulativo e sem crédito, e só a locação sem motorista tem crédito. Os presets são pontos de partida; confirme o enquadramento com a contabilidade."
        acao={
          podeEditar && (
            <div className="flex gap-2">
              {Object.entries(REGIMES).map(([k, r]) => (
                <button key={k} type="button" className={botao} title={r.ajuda} onClick={() => alterar((e) => Object.assign(e.premissas.preco, r.valores), Object.keys(r.valores).map((c) => `preco.${c}`))}>
                  {r.rotulo}
                </button>
              ))}
            </div>
          )
        }
      >
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          Origem de cada número: <SeloOrigem origem="REAL" /> <SeloOrigem origem="BASE" /> <SeloOrigem origem="PADRAO" /> <SeloOrigem origem="AJUSTE" />
        </div>
      </Cartao>

      {[...grupos.entries()].map(([grupo, campos]) => (
        <Cartao key={grupo} titulo={ROTULO_GRUPO[grupo as keyof typeof ROTULO_GRUPO]}>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {campos.map((c) => (
              <Campo key={c.caminho} campo={c} entrada={entrada} origem={origem} alterar={alterar} podeEditar={podeEditar} />
            ))}
          </div>
          {grupo === "pessoal" && <CalculadoraEncargos entrada={entrada} origem={origem} alterar={alterar} podeEditar={podeEditar} />}
        </Cartao>
      ))}
    </div>
  );
}
