"use client";

import { codigoLivre, duplicarItem } from "@/lib/simulador/itens";
import { PERFIS_PADRAO } from "@/lib/simulador/premissas";
import { tarifaParaPerfil, type PracaPedagio } from "@/lib/simulador/pedagio";
import type { EntradaSimulacao, Item, Rota, UnidadePreco } from "@/lib/simulador/tipos";
import { Cartao, CampoNumero, botao, num, pct, selecao, td, tdN, th, thN } from "../comum";

export type Alterar = (mudar: (e: EntradaSimulacao) => void, premissasAjustadas?: string[]) => void;

const UNIDADES: [UnidadePreco, string, string][] = [
  ["KM", "Por km", "Por km: se a demanda cair, o faturamento cai junto e o custo fixo fica — a utilização é o maior risco."],
  ["VEICULO_MES", "Por veículo-mês", "Preço fixo por veículo: o faturamento não cai com a demanda, mas km acima do previsto vira prejuízo — prever franquia de km e km excedente."],
  ["BINOMIA", "Fixo + variável", "A parcela por veículo-mês cobre o custo fixo e a parcela por km, o variável. O risco de ociosidade fica dividido com o contratante."],
  ["DIARIA", "Por diária", "Preço por veículo-dia de operação. Mesmo risco do preço por veículo: km a mais no dia é custo sem receita."],
  ["HORA", "Por hora", "Preço por hora de operação — informe as horas por dia em cada rota."],
];

// O perfil de uma rota: o escolhido nas premissas (vindo da base ou já
// adicionado) ou um dos padrões por tipo, que é copiado para as premissas no
// primeiro uso — daí em diante é editável na aba Veículos.
function garantirPerfil(e: EntradaSimulacao, codigo: string | null) {
  if (!codigo) return null;
  const existente = e.premissas.perfis?.find((p) => p.codigo === codigo);
  if (existente) return existente;
  const padrao = PERFIS_PADRAO.find((p) => p.codigo === codigo);
  if (!padrao) return null;
  const copia = structuredClone(padrao);
  (e.premissas.perfis ??= []).push(copia);
  return copia;
}

const ROTULO_CAMPO_ROTA: Record<string, string> = {
  kmReferencia: "Km de referência",
  kmDia: "Km por dia",
  kmTerraDia: "Km de terra por dia",
  diasMes: "Dias por mês",
  veiculos: "Veículos",
  motoristas: "Motoristas",
  monitoras: "Monitores",
};

export default function Operacao({ entrada, alterar, podeEditar, pracas = [] }: { entrada: EntradaSimulacao; alterar: Alterar; podeEditar: boolean; pracas?: PracaPedagio[] }) {
  const c = entrada.premissas.contrato;
  const unidade = entrada.unidadePreco ?? "KM";
  const perfisDisponiveis = [
    ...(entrada.premissas.perfis ?? []),
    ...PERFIS_PADRAO.filter((p) => !(entrada.premissas.perfis ?? []).some((x) => x.codigo === p.codigo)),
  ];
  const adicionarRota = () =>
    alterar((e) => {
      const ultima = e.rotas.at(-1);
      e.rotas.push(
        ultima
          ? { ...structuredClone(ultima), nome: "Nova rota" }
          : {
              item: e.itens[0].codigo,
              nome: "Nova rota",
              kmReferencia: e.premissas.contrato.modo === "MENSAL" ? 2000 : 20000,
              kmDia: 100,
              kmTerraDia: 0,
              diasMes: 22,
              veiculos: 1,
              // A primeira rota nasce com o tipo principal do estudo (o
              // primeiro escolhido ao criar) e os motoristas dele.
              motoristas: e.premissas.perfis?.[0]?.motorista.motoristasPorVeiculo ?? 1.2,
              monitoras: 0,
              noturno: false,
              passagensPedagioMes: 0,
              tarifaPedagio: 0,
              perfilVeiculo: e.premissas.perfis?.[0]?.codigo ?? null,
            }
      );
    });
  const rotasDoItem = (codigo: string) => entrada.rotas.filter((r) => r.item === codigo).length;
  const totais = entrada.rotas.reduce((a, r) => ({ km: a.km + r.kmReferencia, v: a.v + r.veiculos, m: a.m + r.motoristas }), { km: 0, v: 0, m: 0 });
  const mudarItem = (k: number, campo: keyof Item, valor: unknown) => alterar((e) => void ((e.itens[k] as unknown as Record<string, unknown>)[campo as string] = valor));
  const mudarRota = (k: number, campo: keyof Rota, valor: unknown) =>
    alterar((e) => {
      const r = e.rotas[k];
      (r as unknown as Record<string, unknown>)[campo as string] = valor;
      // Motoristas sugeridos pelo tipo de veículo — ajustáveis depois.
      if (campo === "perfilVeiculo" || campo === "veiculos") {
        const perfil = garantirPerfil(e, r.perfilVeiculo ?? null);
        if (perfil) r.motoristas = r.veiculos * perfil.motorista.motoristasPorVeiculo;
      }
      // Tarifa da praça: muda com a categoria do novo tipo de veículo.
      if (campo === "perfilVeiculo" || campo === "pracaPedagio") {
        const praca = pracas.find((p) => p.chave === r.pracaPedagio);
        const perfil = (e.premissas.perfis ?? []).find((p) => p.codigo === r.perfilVeiculo) ?? null;
        const tarifa = praca ? tarifaParaPerfil(praca, perfil) : null;
        if (tarifa !== null) r.tarifaPedagio = tarifa;
      }
      // Tarifa digitada à mão desliga a praça: vale o número digitado.
      if (campo === "tarifaPedagio") r.pracaPedagio = null;
    });

  return (
    <div className="space-y-4">
      <Cartao titulo="Como o contrato paga e como a operação roda" ajuda={UNIDADES.find((u) => u[0] === unidade)?.[2]}>
        <div className="flex flex-wrap items-end gap-5">
          <div className="space-y-1">
            <span className="block text-xs text-slate-500">Unidade de preço</span>
            <div className="inline-flex flex-wrap overflow-hidden rounded-lg border border-slate-300">
              {UNIDADES.map(([k, t]) => (
                <button
                  key={k}
                  type="button"
                  disabled={!podeEditar}
                  aria-pressed={unidade === k}
                  onClick={() =>
                    alterar((e) => {
                      e.unidadePreco = k;
                      e.precoTesteKm = null;
                      if (k === "HORA") e.rotas.forEach((r) => (r.horasDia ??= 10));
                    })
                  }
                  className={`px-3 py-1.5 text-sm ${unidade === k ? "bg-blue-50 font-semibold text-blue-800" : "bg-white text-slate-600 hover:bg-slate-50"}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <label className="space-y-1 text-xs text-slate-500">
            <span className="block">Julgamento / preço</span>
            <select
              className={selecao}
              disabled={!podeEditar}
              value={entrada.criterio}
              onChange={(ev) =>
                alterar((e) => {
                  e.criterio = ev.target.value === "LOTE" ? "LOTE" : "ITEM";
                  e.precoTesteKm = null;
                })
              }
            >
              <option value="ITEM">Preço por item</option>
              <option value="LOTE">Preço único do lote</option>
            </select>
          </label>
          <label className="space-y-1 text-xs text-slate-500">
            <span className="block">Apuração</span>
            <select
              className={selecao}
              disabled={!podeEditar}
              value={c.modo}
              onChange={(ev) =>
                alterar(
                  (e) => {
                    e.premissas.contrato.modo = ev.target.value === "PERIODO" ? "PERIODO" : "MENSAL";
                    if (e.premissas.contrato.modo === "MENSAL") e.premissas.contrato.mesesCustoFixo = 1;
                  },
                  ["contrato.modo", "contrato.mesesCustoFixo"]
                )
              }
            >
              <option value="MENSAL">Mensal (km/mês × utilização)</option>
              <option value="PERIODO">Período (escolar: km do ano letivo)</option>
            </select>
          </label>
          <label className="w-56 space-y-1 text-xs text-slate-500">
            <span className="block">Utilização do km: {pct(c.utilizacao, 0)}</span>
            <input
              type="range"
              min={0.3}
              max={1}
              step={0.01}
              disabled={!podeEditar}
              value={c.utilizacao}
              onChange={(ev) => alterar((e) => void (e.premissas.contrato.utilizacao = Number(ev.target.value)), ["contrato.utilizacao"])}
              className="w-full accent-blue-700"
            />
          </label>
          <label className="w-28 space-y-1 text-xs text-slate-500">
            <span className="block">Km improdutivo (%)</span>
            <CampoNumero valor={c.kmMortoPct} percentual casas={1} desativado={!podeEditar} aoMudar={(v) => alterar((e) => void (e.premissas.contrato.kmMortoPct = v ?? 0), ["contrato.kmMortoPct"])} />
          </label>
          <label className="w-24 space-y-1 text-xs text-slate-500">
            <span className="block">Vigência (meses)</span>
            <CampoNumero valor={c.vigenciaMeses} casas={0} desativado={!podeEditar} aoMudar={(v) => v && v > 0 && alterar((e) => void (e.premissas.contrato.vigenciaMeses = v), ["contrato.vigenciaMeses"])} />
          </label>
          {c.modo === "PERIODO" && (
            <label className="w-28 space-y-1 text-xs text-slate-500">
              <span className="block">Meses de custo fixo</span>
              <CampoNumero valor={c.mesesCustoFixo} casas={0} desativado={!podeEditar} aoMudar={(v) => v && v > 0 && alterar((e) => void (e.premissas.contrato.mesesCustoFixo = v), ["contrato.mesesCustoFixo"])} />
            </label>
          )}
        </div>
      </Cartao>

      <Cartao
        titulo="Itens"
        ajuda="Cada item tem o seu preço. Um item só pode ser excluído quando nenhuma rota aponta para ele — mova ou remova as rotas antes."
        acao={
          podeEditar && (
            <button
              type="button"
              className={botao}
              onClick={() =>
                alterar((e) => {
                  // O item novo herda do último o que costuma se repetir
                  // (% intermunicipal, com motorista, combustível); preço
                  // máximo e de referência são de cada item e vêm vazios.
                  const ultimo = e.itens.at(-1);
                  const codigo = codigoLivre(e.itens);
                  e.itens.push({
                    codigo,
                    descricao: `Item ${codigo}`,
                    shareIntermunicipal: ultimo?.shareIntermunicipal ?? 0,
                    precoMaximoKm: null,
                    precoReferenciaKm: null,
                    comMotorista: ultimo?.comMotorista ?? true,
                    combustivelPorContaDoCliente: ultimo?.combustivelPorContaDoCliente ?? false,
                  });
                })
              }
            >
              Adicionar item
            </button>
          )
        }
      >
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-[13px]">
            <thead>
              <tr>
                <th className={th}>Item</th>
                <th className={th}>Descrição</th>
                <th className={thN}>% intermunicipal (ICMS)</th>
                <th className={thN}>Preço máx. R$/km</th>
                <th className={thN}>Preço ref. R$/km</th>
                <th className={th}>Com motorista</th>
                <th className={th}>Combustível do cliente</th>
                <th className={thN}>Rotas</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {entrada.itens.map((i, k) => {
                const n = rotasDoItem(i.codigo);
                const bloqueio = entrada.itens.length === 1 ? "O estudo precisa de ao menos um item" : n > 0 ? n === 1 ? "Mova ou remova a rota deste item antes" : `Mova ou remova as ${n} rotas deste item antes` : "";
                return (
                  <tr key={`${i.codigo}-${k}`}>
                    <td className={td}>{i.codigo}</td>
                    <td className={td}>
                      <input className="w-full min-w-[220px] rounded-md border border-slate-300 px-2 py-1 text-[13px]" disabled={!podeEditar} value={i.descricao} onChange={(ev) => mudarItem(k, "descricao", ev.target.value)} />
                    </td>
                    <td className={`${tdN} w-28`}>
                      <CampoNumero valor={i.shareIntermunicipal} percentual casas={0} desativado={!podeEditar} aoMudar={(v) => mudarItem(k, "shareIntermunicipal", Math.min(1, Math.max(0, v ?? 0)))} />
                    </td>
                    <td className={`${tdN} w-28`}>
                      <CampoNumero valor={i.precoMaximoKm} vazioPermitido desativado={!podeEditar} aoMudar={(v) => mudarItem(k, "precoMaximoKm", v)} />
                    </td>
                    <td className={`${tdN} w-28`}>
                      <CampoNumero valor={i.precoReferenciaKm} vazioPermitido desativado={!podeEditar} aoMudar={(v) => mudarItem(k, "precoReferenciaKm", v)} />
                    </td>
                    <td className={td}>
                      <input type="checkbox" disabled={!podeEditar} checked={i.comMotorista !== false} onChange={(ev) => mudarItem(k, "comMotorista", ev.target.checked)} />
                    </td>
                    <td className={td}>
                      <input type="checkbox" disabled={!podeEditar} checked={i.combustivelPorContaDoCliente === true} onChange={(ev) => mudarItem(k, "combustivelPorContaDoCliente", ev.target.checked)} />
                    </td>
                    <td className={tdN}>{n}</td>
                    <td className={td}>
                      {podeEditar && (
                        <span className="flex gap-1">
                          <button type="button" aria-label="Duplicar item" title="Duplicar item com as rotas dele" className={`${botao} px-2`} onClick={() => alterar((e) => duplicarItem(e, k))}>
                            ⧉
                          </button>
                          <button type="button" aria-label="Excluir item" title={bloqueio || "Excluir item"} disabled={Boolean(bloqueio)} className={`${botao} px-2`} onClick={() => alterar((e) => void e.itens.splice(k, 1))}>
                            ✕
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Cartao>

      <Cartao
        titulo="Rotas"
        ajuda="O tipo de veículo muda o custo do veículo, o consumo e o salário do motorista (CNH e faixa da convenção). Ao trocar o tipo ou os veículos, os motoristas são sugeridos pelo padrão do tipo — e podem ser ajustados."
        acao={
          podeEditar && (
            <button type="button" className={botao} onClick={adicionarRota}>
              Adicionar rota
            </button>
          )
        }
      >
        {entrada.rotas.length === 0 ? (
          <div className="rounded-lg border border-dashed border-blue-300 bg-blue-50/40 px-4 py-6 text-center text-sm text-slate-600">
            <p>Nenhuma rota ainda. O km, os veículos e os motoristas de cada rota são o que o simulador custeia — sem rota, não há conta.</p>
            {podeEditar && (
              <button type="button" className="mt-3 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800" onClick={adicionarRota}>
                Adicionar a primeira rota
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-[13px]">
              <thead>
                <tr>
                  <th className={`${th} sticky left-0 z-10`}>Rota</th>
                  <th className={th}>Item</th>
                  <th className={th}>Tipo de veículo</th>
                  <th className={thN}>{c.modo === "MENSAL" ? "km/mês máx." : "km do período"}</th>
                  <th className={thN}>km/dia</th>
                  <th className={thN}>terra/dia</th>
                  <th className={thN}>Dias/mês</th>
                  <th className={thN}>Veículos</th>
                  <th className={thN}>Motoristas</th>
                  <th className={thN}>Monitores</th>
                  <th className={th}>Noturno</th>
                  <th className={thN}>Horas/dia</th>
                  <th className={th}>Praça de pedágio</th>
                  <th className={thN}>Pedágios/mês</th>
                  <th className={thN}>Tarifa</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {entrada.rotas.map((r, k) => (
                  <tr key={k} className={r.veiculos <= 0 ? "bg-amber-50" : undefined}>
                    <td className={`${td} sticky left-0 z-10 ${r.veiculos <= 0 ? "bg-amber-50" : "bg-white"}`}>
                      <input
                        aria-label={`Nome da rota ${k + 1}`}
                        className="w-full min-w-[180px] rounded-md border border-slate-300 px-2 py-1 text-[13px]"
                        disabled={!podeEditar}
                        value={r.nome}
                        onChange={(ev) => mudarRota(k, "nome", ev.target.value)}
                      />
                      {r.veiculos <= 0 && <span className="mt-0.5 block text-[11px] font-medium text-amber-800">Informe os veículos desta rota</span>}
                    </td>
                    <td className={td}>
                      <select aria-label={`Item da rota ${r.nome}`} className={selecao} disabled={!podeEditar} value={r.item} onChange={(ev) => mudarRota(k, "item", ev.target.value)}>
                        {entrada.itens.map((i) => (
                          <option key={i.codigo} value={i.codigo}>
                            {i.codigo}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={td}>
                      <select aria-label={`Tipo de veículo da rota ${r.nome}`} className={selecao} disabled={!podeEditar} value={r.perfilVeiculo ?? ""} onChange={(ev) => mudarRota(k, "perfilVeiculo", ev.target.value || null)}>
                        <option value="">Padrão do estudo</option>
                        {perfisDisponiveis.map((p) => (
                          <option key={p.codigo} value={p.codigo}>
                            {p.descricao}
                          </option>
                        ))}
                      </select>
                    </td>
                    {(
                      [
                        ["kmReferencia", 0],
                        ["kmDia", 1],
                        ["kmTerraDia", 1],
                        ["diasMes", 0],
                        ["veiculos", 0],
                        ["motoristas", 1],
                        ["monitoras", 0],
                      ] as [keyof Rota, number][]
                    ).map(([campo, casas]) => (
                      <td key={campo} className={`${tdN} w-24`}>
                        <CampoNumero
                          valor={r[campo] as number | null}
                          casas={casas}
                          vazioPermitido={campo === "diasMes"}
                          rotulo={`${ROTULO_CAMPO_ROTA[campo as string] ?? campo} — ${r.nome}`}
                          desativado={!podeEditar}
                          // Dias por mês é inteiro (coluna Int, e o campo mostra 0 casas):
                          // "21,5" aparecia como 22 e a conta usava 21,5.
                          aoMudar={(v) => (v === null && campo !== "diasMes") || (v !== null && v < 0) ? undefined : mudarRota(k, campo, campo === "diasMes" && v !== null ? Math.round(v) : v)}
                        />
                      </td>
                    ))}
                    <td className={td}>
                      <input type="checkbox" aria-label={`Rota noturna — ${r.nome}`} disabled={!podeEditar} checked={r.noturno} onChange={(ev) => mudarRota(k, "noturno", ev.target.checked)} />
                    </td>
                    <td className={`${tdN} w-20`}>
                      <CampoNumero rotulo={`Horas por dia — ${r.nome}`} valor={r.horasDia ?? null} casas={1} vazioPermitido desativado={!podeEditar} aoMudar={(v) => mudarRota(k, "horasDia", v && v > 0 ? v : null)} />
                    </td>
                    <td className={td}>
                      <select
                        aria-label={`Praça de pedágio — ${r.nome}`}
                        className={`${selecao} max-w-[180px]`}
                        disabled={!podeEditar || pracas.length === 0}
                        title={pracas.length === 0 ? "Cadastre praças em Custos base para escolher aqui" : "A tarifa sai da praça e da categoria do tipo de veículo"}
                        value={r.pracaPedagio ?? ""}
                        onChange={(ev) => mudarRota(k, "pracaPedagio", ev.target.value || null)}
                      >
                        <option value="">{pracas.length === 0 ? "sem praças na base" : "tarifa digitada"}</option>
                        {pracas.map((p) => (
                          <option key={p.chave} value={p.chave}>
                            {p.praca}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={`${tdN} w-24`}>
                      <CampoNumero rotulo={`Pedágios por mês — ${r.nome}`} valor={r.passagensPedagioMes} casas={1} desativado={!podeEditar} aoMudar={(v) => v !== null && v >= 0 && mudarRota(k, "passagensPedagioMes", v)} />
                    </td>
                    <td className={`${tdN} w-24`}>
                      <CampoNumero rotulo={`Tarifa de pedágio — ${r.nome}`} valor={r.tarifaPedagio} desativado={!podeEditar} aoMudar={(v) => v !== null && v >= 0 && mudarRota(k, "tarifaPedagio", v)} />
                    </td>
                    <td className={`${td} whitespace-nowrap`}>
                      {podeEditar && (
                        <>
                          <button type="button" aria-label="Duplicar rota" title="Duplicar rota" className={`${botao} mr-1 px-2`} onClick={() => alterar((e) => void e.rotas.splice(k + 1, 0, { ...structuredClone(e.rotas[k]), nome: `${e.rotas[k].nome} (cópia)` }))}>
                            ⧉
                          </button>
                          <button type="button" aria-label="Remover rota" title="Remover rota" className={`${botao} px-2`} onClick={() => alterar((e) => void e.rotas.splice(k, 1))}>
                            ✕
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className={td} />
                  <td className={td}>Total</td>
                  <td className={td} />
                  <td className={tdN}>{num(totais.km)}</td>
                  <td className={td} colSpan={3} />
                  <td className={tdN}>{num(totais.v)}</td>
                  <td className={tdN}>{num(totais.m, 1)}</td>
                  <td className={td} colSpan={6} />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Cartao>
    </div>
  );
}
