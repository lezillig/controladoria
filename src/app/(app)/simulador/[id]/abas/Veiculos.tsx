"use client";

import { CAMPOS_PREMISSAS, PERFIS_PADRAO } from "@/lib/simulador/premissas";
import { FONTES_ENERGIA, ROTULO_CATEGORIA_PEDAGIO, ROTULO_ENERGIA, ROTULO_TIPO_VEICULO, UNIDADE_ENERGIA, type CategoriaPedagio, type EntradaSimulacao, type FonteEnergia, type PerfilVeiculo, type TipoVeiculo } from "@/lib/simulador/tipos";
import { energiaDoPerfil, trocarEnergia } from "@/lib/simulador/energia";
import { categoriaPedagioDe, tarifaParaPerfil, type PracaPedagio } from "@/lib/simulador/pedagio";
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
const CAMPOS_VEICULO_FIXO = CAMPOS_VEICULO.filter((c) => c.grupo === "veiculo");
const CAMPOS_VEICULO_VARIAVEL = CAMPOS_VEICULO.filter((c) => c.grupo === "variaveis");

// Mão de obra e veículo em blocos separados na mesma tabela.
function Secao({ titulo, colunas }: { titulo: string; colunas: number }) {
  return (
    <tr>
      <td colSpan={colunas} className="border-b border-slate-200 bg-slate-100 px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
        {titulo}
      </td>
    </tr>
  );
}

export default function Veiculos({
  entrada,
  alterar,
  podeEditar,
  precosEnergia,
  pracas = [],
}: {
  entrada: EntradaSimulacao;
  alterar: AlterarComOrigem;
  podeEditar: boolean;
  // Preço por unidade de cada fonte (base de custos ou padrão do simulador),
  // para quando a pessoa troca a energia de um tipo de veículo.
  precosEnergia: Record<FonteEnergia, number>;
  pracas?: PracaPedagio[];
}) {
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
            <Secao titulo="Mão de obra — motorista" colunas={perfis.length + 2} />
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
            <Secao titulo="Veículo" colunas={perfis.length + 2} />
            <tr className="bg-slate-50/60">
              <td className="sticky left-0 border-b border-slate-100 bg-white px-2 py-1.5 font-medium">Energia</td>
              <td className="border-b border-slate-100 px-2 py-1.5 text-right text-slate-500">Diesel</td>
              {perfis.map((p, k) => (
                <td key={p.codigo} className="border-b border-slate-100 px-2 py-1.5 text-right">
                  <select
                    aria-label={`Energia — ${p.descricao}`}
                    className={selecao}
                    disabled={!podeEditar}
                    value={energiaDoPerfil(p)}
                    onChange={(ev) =>
                      alterar((e) => {
                        const x = e.premissas.perfis![k];
                        e.premissas.perfis![k] = trocarEnergia(x, ev.target.value as FonteEnergia, precosEnergia, e.premissas.variaveis.arlaKm, e.premissas.variaveis.oleoLavagemKm);
                      })
                    }
                  >
                    {FONTES_ENERGIA.map((f) => (
                      <option key={f} value={f}>
                        {ROTULO_ENERGIA[f]}
                      </option>
                    ))}
                  </select>
                  {energiaDoPerfil(p) === "ELETRICO" && (
                    <span className="mt-1 block text-[11px] leading-tight text-slate-500">Confira valor do veículo, manutenção e IPVA (isento em alguns estados).</span>
                  )}
                </td>
              ))}
            </tr>
            <tr className="bg-slate-50/60">
              <td className="sticky left-0 border-b border-slate-100 bg-white px-2 py-1.5 font-medium">Categoria de pedágio</td>
              <td className="border-b border-slate-100 px-2 py-1.5 text-right text-slate-500">2 eixos</td>
              {perfis.map((p, k) => (
                <td key={p.codigo} className="border-b border-slate-100 px-2 py-1.5 text-right">
                  <select
                    aria-label={`Categoria de pedágio — ${p.descricao}`}
                    className={selecao}
                    disabled={!podeEditar}
                    value={categoriaPedagioDe(p)}
                    title="Pelos eixos e pela rodagem do eixo traseiro, não pela lotação: van Master é rodagem simples; Sprinter 516 é rodagem dupla."
                    onChange={(ev) =>
                      alterar((e) => {
                        const x = e.premissas.perfis![k];
                        x.categoriaPedagio = ev.target.value as CategoriaPedagio;
                        // As rotas desse tipo com praça escolhida passam à tarifa da nova categoria.
                        for (const r of e.rotas) {
                          if (r.perfilVeiculo !== x.codigo || !r.pracaPedagio) continue;
                          const praca = pracas.find((q) => q.chave === r.pracaPedagio);
                          const t = praca ? tarifaParaPerfil(praca, x) : null;
                          if (t !== null) r.tarifaPedagio = t;
                        }
                      })
                    }
                  >
                    {(Object.keys(ROTULO_CATEGORIA_PEDAGIO) as CategoriaPedagio[]).map((c) => (
                      <option key={c} value={c}>
                        {ROTULO_CATEGORIA_PEDAGIO[c]}
                      </option>
                    ))}
                  </select>
                </td>
              ))}
            </tr>
            <tr className="bg-slate-50/60">
              <td className="sticky left-0 border-b border-slate-100 bg-white px-2 py-1.5 font-medium">Lotação / CNH</td>
              <td className="border-b border-slate-100 px-2 py-1.5 text-right text-slate-500">—</td>
              {perfis.map((p) => (
                <td key={p.codigo} className="border-b border-slate-100 px-2 py-1.5 text-right text-xs text-slate-600">
                  {p.lotacao ? `${p.lotacao} lugares` : "sem passageiros"} · CNH {p.categoriaCnh ?? "—"}
                </td>
              ))}
            </tr>
            {([
              ["Veículo — custo fixo mensal (capital, seguro, IPVA, garagem…)", CAMPOS_VEICULO_FIXO],
              ["Veículo — custo por km (energia, pneus, manutenção)", CAMPOS_VEICULO_VARIAVEL],
            ] as const).map(([titulo, campos]) => [
              <Secao key={titulo} titulo={titulo} colunas={perfis.length + 2} />,
              campos.map((c) => (
                <tr key={c.caminho}>
                  <td className="sticky left-0 border-b border-slate-100 bg-white px-2 py-1.5">
                    {c.rotulo} <span className="text-[11px] text-slate-500">({c.unidade})</span>
                  </td>
                  <td className="border-b border-slate-100 px-2 py-1.5 text-right font-mono tabular-nums text-slate-600">
                    {c.tipo === "pct" ? `${(valorDo(null, c.caminho) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%` : valorDo(null, c.caminho).toLocaleString("pt-BR", { maximumFractionDigits: 4 })}
                  </td>
                  {perfis.map((p, k) => (
                    <td key={p.codigo} className="border-b border-slate-100 px-2 py-1.5">
                      {(c.caminho === "variaveis.dieselLitro" || c.caminho.startsWith("variaveis.consumo")) && (
                        <span className="mb-0.5 block text-right text-[10px] text-slate-500">
                          {c.caminho === "variaveis.dieselLitro" ? `R$/${UNIDADE_ENERGIA[energiaDoPerfil(p)]}` : `km/${UNIDADE_ENERGIA[energiaDoPerfil(p)]}`}
                        </span>
                      )}
                      <CampoNumero
                        valor={valorDo(p, c.caminho)}
                        percentual={c.tipo === "pct"}
                        casas={4}
                        desativado={!podeEditar}
                        rotulo={`${c.rotulo} — ${p.descricao}`}
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
              )),
            ])}
          </tbody>
        </table>
      </div>
      {perfis.length === 0 && <p className="text-sm text-slate-500">Nenhum tipo de veículo além do padrão. Adicione carro, van, micro ou ônibus para usar nas rotas.</p>}
      <CalculadoraFU entrada={entrada} alterar={alterar} podeEditar={podeEditar} />
    </Cartao>
  );
}
