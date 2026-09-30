"use client";

import { CAMPOS_PREMISSAS, PERFIS_PADRAO } from "@/lib/simulador/premissas";
import { ROTULO_TIPO_VEICULO, type EntradaSimulacao, type PerfilVeiculo, type TipoVeiculo } from "@/lib/simulador/tipos";
import { Cartao, CampoNumero, botao, selecao } from "../comum";
import type { AlterarComOrigem } from "./Premissas";
import { CalculadoraFU } from "./Calculadoras";

// OS TIPOS DE VEÍCULO DO ESTUDO — um por coluna, lado a lado.
//
// Comparar carro, van, micro e ônibus na mesma tabela é o que responde "por
// que o ônibus custa isto": salário do motorista, valor do veículo, consumo,
// manutenção, tudo na mesma linha. A coluna "Padrão do estudo" é o veículo das
// rotas que não escolheram tipo.

const CAMPOS_VEICULO = CAMPOS_PREMISSAS.filter((c) => (c.grupo === "veiculo" || c.grupo === "variaveis") && c.tipo !== "bool" && c.tipo !== "metodoDepreciacao");

export default function Veiculos({ entrada, alterar, podeEditar }: { entrada: EntradaSimulacao; alterar: AlterarComOrigem; podeEditar: boolean }) {
  const perfis = entrada.premissas.perfis ?? [];
  const emUso = (codigo: string) => entrada.rotas.filter((r) => r.perfilVeiculo === codigo).length;
  const faltando = PERFIS_PADRAO.filter((p) => !perfis.some((x) => x.codigo === p.codigo));
  const mudarPerfil = (k: number, mudar: (p: PerfilVeiculo) => void) => alterar((e) => mudar(e.premissas.perfis![k]));
  const valorDo = (p: PerfilVeiculo | null, caminho: string) => {
    const [grupo, campo] = caminho.split(".");
    const alvo = grupo === "veiculo" ? (p?.veiculo ?? entrada.premissas.veiculo) : (p?.variaveis ?? entrada.premissas.variaveis);
    return (alvo as Record<string, unknown>)[campo] as number;
  };

  return (
    <Cartao
      titulo="Tipos de veículo"
      ajuda="Cada tipo tem o seu veículo, os seus custos por km e o seu motorista: o salário muda com a categoria da CNH e a faixa da convenção, e os motoristas por veículo seguem a jornada que o tipo costuma cumprir. As rotas escolhem o tipo na aba Operação."
      acao={
        podeEditar &&
        faltando.length > 0 && (
          <select
            className={selecao}
            value=""
            onChange={(ev) => {
              const p = PERFIS_PADRAO.find((x) => x.codigo === ev.target.value);
              if (p) alterar((e) => void (e.premissas.perfis ??= []).push(structuredClone(p)));
            }}
          >
            <option value="">Adicionar tipo de veículo…</option>
            {faltando.map((p) => (
              <option key={p.codigo} value={p.codigo}>
                {p.descricao}
              </option>
            ))}
          </select>
        )
      }
    >
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-[13px]">
          <thead>
            <tr>
              <th className="sticky left-0 border-b border-slate-200 bg-slate-50 px-2 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-slate-500">Premissa</th>
              <th className="border-b border-slate-200 bg-slate-50 px-2 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-slate-500">Padrão do estudo</th>
              {perfis.map((p, k) => (
                <th key={p.codigo} className="min-w-[150px] border-b border-slate-200 bg-slate-50 px-2 py-2 text-right text-[11px] font-medium text-slate-600">
                  <input
                    className="w-full rounded-md border border-slate-300 px-2 py-1 text-right text-[12px] font-semibold normal-case"
                    disabled={!podeEditar}
                    value={p.descricao}
                    onChange={(ev) => mudarPerfil(k, (x) => void (x.descricao = ev.target.value))}
                  />
                  <span className="mt-1 flex items-center justify-end gap-2 font-normal normal-case">
                    <select className={`${selecao} text-[11px]`} disabled={!podeEditar} value={p.tipo} onChange={(ev) => mudarPerfil(k, (x) => void (x.tipo = ev.target.value as TipoVeiculo))}>
                      {Object.entries(ROTULO_TIPO_VEICULO).map(([t, r]) => (
                        <option key={t} value={t}>
                          {r}
                        </option>
                      ))}
                    </select>
                    {podeEditar && (
                      <button
                        type="button"
                        className={`${botao} px-2 py-0.5 text-[11px]`}
                        disabled={emUso(p.codigo) > 0}
                        title={emUso(p.codigo) > 0 ? `Usado em ${emUso(p.codigo) === 1 ? "1 rota" : `${emUso(p.codigo)} rotas`}` : "Remover tipo"}
                        aria-label={`Remover o tipo ${p.descricao}`}
                        onClick={() => alterar((e) => void e.premissas.perfis!.splice(k, 1))}
                      >
                        ✕
                      </button>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="bg-slate-50/60">
              <td className="sticky left-0 border-b border-slate-100 bg-white px-2 py-1.5 font-medium">Salário do motorista (R$/mês)</td>
              <td className="border-b border-slate-100 px-2 py-1.5 text-right font-mono tabular-nums">{entrada.premissas.pessoal.salarioMotorista.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
              {perfis.map((p, k) => (
                <td key={p.codigo} className="border-b border-slate-100 px-2 py-1.5">
                  <CampoNumero valor={p.motorista.salario} desativado={!podeEditar} aoMudar={(v) => v !== null && v >= 0 && mudarPerfil(k, (x) => void (x.motorista.salario = v))} />
                </td>
              ))}
            </tr>
            <tr className="bg-slate-50/60">
              <td className="sticky left-0 border-b border-slate-100 bg-white px-2 py-1.5 font-medium">Motoristas por veículo</td>
              <td className="border-b border-slate-100 px-2 py-1.5 text-right text-slate-500">—</td>
              {perfis.map((p, k) => (
                <td key={p.codigo} className="border-b border-slate-100 px-2 py-1.5">
                  <CampoNumero valor={p.motorista.motoristasPorVeiculo} desativado={!podeEditar} aoMudar={(v) => v !== null && v >= 0 && mudarPerfil(k, (x) => void (x.motorista.motoristasPorVeiculo = v))} />
                </td>
              ))}
            </tr>
            <tr className="bg-slate-50/60">
              <td className="sticky left-0 border-b border-slate-100 bg-white px-2 py-1.5 font-medium">Lotação / CNH</td>
              <td className="border-b border-slate-100 px-2 py-1.5 text-right text-slate-500">—</td>
              {perfis.map((p) => (
                <td key={p.codigo} className="border-b border-slate-100 px-2 py-1.5 text-right text-xs text-slate-600">
                  {p.lotacao ?? "—"} lugares · CNH {p.categoriaCnh ?? "—"}
                </td>
              ))}
            </tr>
            {CAMPOS_VEICULO.map((c) => (
              <tr key={c.caminho}>
                <td className="sticky left-0 border-b border-slate-100 bg-white px-2 py-1.5">
                  {c.rotulo} <span className="text-[11px] text-slate-500">({c.unidade})</span>
                </td>
                <td className="border-b border-slate-100 px-2 py-1.5 text-right font-mono tabular-nums text-slate-600">
                  {c.tipo === "pct" ? `${(valorDo(null, c.caminho) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%` : valorDo(null, c.caminho).toLocaleString("pt-BR", { maximumFractionDigits: 4 })}
                </td>
                {perfis.map((p, k) => (
                  <td key={p.codigo} className="border-b border-slate-100 px-2 py-1.5">
                    <CampoNumero
                      valor={valorDo(p, c.caminho)}
                      percentual={c.tipo === "pct"}
                      casas={4}
                      desativado={!podeEditar}
                      aoMudar={(v) =>
                        v !== null &&
                        mudarPerfil(k, (x) => {
                          const [grupo, campo] = c.caminho.split(".");
                          ((grupo === "veiculo" ? x.veiculo : x.variaveis) as Record<string, unknown>)[campo] = v;
                        })
                      }
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {perfis.length === 0 && <p className="text-sm text-slate-500">Nenhum tipo de veículo além do padrão. Adicione carro, van, micro ou ônibus para usar nas rotas.</p>}
      <CalculadoraFU entrada={entrada} alterar={alterar} podeEditar={podeEditar} />
    </Cartao>
  );
}
