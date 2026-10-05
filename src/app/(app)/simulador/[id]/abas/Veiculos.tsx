"use client";

import { CAMPOS_PREMISSAS, PERFIS_PADRAO } from "@/lib/simulador/premissas";
import { CATEGORIA_DO_TIPO, FONTES_ENERGIA, type ConfigEletrico, type ConfigHibrido, type RotaHibrido, type TipoHibrido, ROTULO_CATEGORIA_PEDAGIO, ROTULO_ENERGIA, ROTULO_TIPO_VEICULO, UNIDADE_ENERGIA, type CategoriaPedagio, type EntradaSimulacao, type FonteEnergia, type PerfilVeiculo, type TipoVeiculo } from "@/lib/simulador/tipos";
import { energiaDoPerfil, reconfigurarEletrico, reconfigurarHibrido, tarifaDoMix, trocarEnergia } from "@/lib/simulador/energia";
import { ipvaSP } from "@/lib/simulador/ipva";
import { categoriaPedagioDe, tarifaParaPerfil, type PracaPedagio } from "@/lib/simulador/pedagio";
import { Cartao, CampoNumero, botao, selecao } from "../comum";
import type { AlterarComOrigem } from "./Premissas";
import { CalculadoraFU } from "./Calculadoras";
import { anoDaIdade, fatorManutencaoPorIdade, idadeDoAno } from "@/lib/simulador/idadeManutencao";

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
  anoInicio,
}: {
  entrada: EntradaSimulacao;
  alterar: AlterarComOrigem;
  podeEditar: boolean;
  // Ano do início do contrato: ano do veículo = ano do início − idade.
  anoInicio: number;
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
    return (alvo as Record<string, unknown>)[campo] as number | null | undefined;
  };
  const numeroOuTraco = (v: number | null | undefined, pct: boolean) =>
    typeof v !== "number" ? "—" : pct ? `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%` : v.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
  const fatorDo = (p: PerfilVeiculo | null) => fatorManutencaoPorIdade(p?.veiculo ?? entrada.premissas.veiculo, entrada.premissas.contrato.vigenciaMeses);

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
                  {energiaDoPerfil(p) === "HIBRIDO" && (
                    <ConfiguracaoHibrido
                      p={p}
                      podeEditar={podeEditar}
                      mudar={(m) => alterar((e) => void (e.premissas.perfis![k] = reconfigurarHibrido(e.premissas.perfis![k], m, precosEnergia, e.premissas.variaveis.arlaKm)))}
                    />
                  )}
                  {energiaDoPerfil(p) === "ELETRICO" && (
                    <ConfiguracaoEletrico p={p} podeEditar={podeEditar} mudar={(m) => alterar((e) => void (e.premissas.perfis![k] = reconfigurarEletrico(e.premissas.perfis![k], m, precosEnergia)))} />
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
                    title="Pelos eixos e pela rodagem do eixo traseiro, não pela lotação: van Master é rodagem simples; Sprinter 516 é rodagem dupla. No micro e no ônibus, trocar 2 ↔ 3 eixos ajusta os pneus por km (6 ↔ 8 pneus)."
                    onChange={(ev) =>
                      alterar((e) => {
                        const x = e.premissas.perfis![k];
                        // Micro e ônibus: 2 eixos têm 6 pneus, 3 eixos têm 8 — o
                        // custo de pneus por km acompanha.
                        const pneusDe = (c: CategoriaPedagio) => (c === "TRES_EIXOS" ? 8 : 6);
                        const pesado = CATEGORIA_DO_TIPO[x.tipo] === "MICRO" || CATEGORIA_DO_TIPO[x.tipo] === "ONIBUS";
                        const antes = categoriaPedagioDe(x);
                        const depois = ev.target.value as CategoriaPedagio;
                        if (pesado && antes !== "RODAGEM_SIMPLES" && depois !== "RODAGEM_SIMPLES" && antes !== depois) {
                          const f = pneusDe(depois) / pneusDe(antes);
                          x.variaveis.pneusAsfaltoKm = Number((x.variaveis.pneusAsfaltoKm * f).toFixed(4));
                          x.variaveis.pneusTerraKm = Number((x.variaveis.pneusTerraKm * f).toFixed(4));
                        }
                        x.categoriaPedagio = depois;
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
            <tr className="bg-slate-50/60">
              <td className="sticky left-0 border-b border-slate-100 bg-white px-2 py-1.5 font-medium" title={`Ano de fabricação/modelo do veículo que vai rodar. Idade no início do contrato = ${anoInicio} − ano.`}>
                Ano do veículo <span className="text-[11px] font-normal text-slate-500">(início do contrato em {anoInicio})</span>
              </td>
              <td className="border-b border-slate-100 px-2 py-1.5 text-right font-mono tabular-nums text-slate-600">{anoDaIdade(entrada.premissas.veiculo.idadeInicialAnos, anoInicio)}</td>
              {perfis.map((p, k) => (
                <td key={p.codigo} className="border-b border-slate-100 px-2 py-1.5">
                  <CampoNumero
                    valor={anoDaIdade(p.veiculo.idadeInicialAnos, anoInicio)}
                    casas={0}
                    desativado={!podeEditar}
                    rotulo={`Ano do veículo — ${p.descricao}`}
                    aoMudar={(v) => v !== null && v > 1950 && v <= anoInicio + 1 && mudarPerfil(k, (x) => void (x.veiculo.idadeInicialAnos = idadeDoAno(v, anoInicio)))}
                  />
                </td>
              ))}
            </tr>
            <tr className="bg-slate-50/60">
              <td
                className="sticky left-0 border-b border-slate-100 bg-white px-2 py-1.5 font-medium"
                title="Curva ANTP/NTU: peças e reparos crescem com a idade — 6% do preço novo/ano até 2 anos, 7%, 8%, 9%, 10% (8–10 anos) e 12% acima de 10. Média dos anos do contrato (o veículo envelhece), sobre a idade para a qual a manutenção foi informada. Multiplica a manutenção por km e a fixa."
              >
                Fator de manutenção pela idade <span className="text-[11px] font-normal text-slate-500">(média do contrato)</span>
              </td>
              <td className="border-b border-slate-100 px-2 py-1.5 text-right font-mono tabular-nums text-slate-600">{fatorDo(null).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×</td>
              {perfis.map((p) => (
                <td key={p.codigo} className={`border-b border-slate-100 px-2 py-1.5 text-right font-mono tabular-nums ${fatorDo(p) > 1.001 ? "text-amber-800" : "text-slate-600"}`}>
                  {fatorDo(p).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×
                </td>
              ))}
            </tr>
            <tr className="bg-slate-50/60">
              <td
                className="sticky left-0 border-b border-slate-100 bg-white px-2 py-1.5 font-medium"
                title="IPVA de SP ano a ano do contrato, sobre o valor venal que cai com a depreciação: 4% (ônibus e micro 2%); locadora 1%; híbrido flex até R$ 261 mil isento em 2026 e 1–2–3% de 2027 a 2029; elétrico registrado na capital recebe de volta metade, até R$ 3.642/ano, até 2030. Grava a média no campo 'IPVA + licenciamento' — some a taxa de licenciamento."
              >
                IPVA SP <span className="text-[11px] font-normal text-slate-500">(calcular a média do contrato)</span>
              </td>
              <td className="border-b border-slate-100 px-2 py-1.5 text-right text-slate-500">—</td>
              {perfis.map((p, k) => {
                const calc = (locadora: boolean) =>
                  ipvaSP({
                    valor: p.veiculo.valor,
                    energia: energiaDoPerfil(p),
                    tipoHibrido: p.hibrido?.tipo ?? null,
                    hibridoFlex: p.hibrido ? p.hibrido.combustivel !== "DIESEL" : false,
                    onibusOuMicro: CATEGORIA_DO_TIPO[p.tipo] === "ONIBUS" || CATEGORIA_DO_TIPO[p.tipo] === "MICRO",
                    anoInicio,
                    vigenciaMeses: entrada.premissas.contrato.vigenciaMeses,
                    depreciacaoAa: p.veiculo.depreciacaoAa,
                    locadora,
                    capital: true,
                  }).mediaAnual;
                const usar = (locadora: boolean) => mudarPerfil(k, (x) => void (x.veiculo.ipvaLicenciamentoAno = Math.round(calc(locadora))));
                return (
                  <td key={p.codigo} className="border-b border-slate-100 px-2 py-1.5 text-right text-xs">
                    {podeEditar ? (
                      <span className="flex flex-col items-end gap-1">
                        <button type="button" className="text-blue-700 hover:underline" onClick={() => usar(false)}>
                          usar {Math.round(calc(false)).toLocaleString("pt-BR")}/ano
                        </button>
                        <button type="button" className="text-blue-700 hover:underline" title="Frota de locadora registrada: 1%" onClick={() => usar(true)}>
                          como locadora: {Math.round(calc(true)).toLocaleString("pt-BR")}/ano
                        </button>
                      </span>
                    ) : (
                      <span className="text-slate-600">{Math.round(calc(false)).toLocaleString("pt-BR")}/ano</span>
                    )}
                  </td>
                );
              })}
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
                  <td className="border-b border-slate-100 px-2 py-1.5 text-right font-mono tabular-nums text-slate-600">{numeroOuTraco(valorDo(null, c.caminho), c.tipo === "pct")}</td>
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

const ROTULO_TIPO_HIBRIDO: Record<TipoHibrido, string> = { HEV: "Híbrido pleno (Toyota)", PHEV: "Plug-in (BYD DM-i)", MHEV: "Leve (12–48 V)" };
const ROTULO_ROTA: Record<RotaHibrido, string> = { URBANO: "Rota urbana", MISTO: "Rota mista", RODOVIARIO: "Rota rodoviária" };
const pct = (v: number) => Math.round(v * 100);

// O híbrido: tipo, rota (o ganho é da frenagem e some na estrada),
// combustível (o flex pode rodar a etanol) e, no plug-in, quanto do km roda
// no elétrico com recarga na tomada.
function ConfiguracaoHibrido({ p, podeEditar, mudar }: { p: PerfilVeiculo; podeEditar: boolean; mudar: (m: Partial<ConfigHibrido>) => void }) {
  const h = p.hibrido;
  const leve = CATEGORIA_DO_TIPO[p.tipo] === "CARRO";
  return (
    <span className="mt-1 flex flex-col items-end gap-1 text-[11px] text-slate-600">
      <select aria-label={`Tipo de híbrido — ${p.descricao}`} className={selecao} disabled={!podeEditar} value={h?.tipo ?? "HEV"} onChange={(ev) => mudar({ tipo: ev.target.value as TipoHibrido })}>
        {(Object.keys(ROTULO_TIPO_HIBRIDO) as TipoHibrido[]).map((t) => (
          <option key={t} value={t}>
            {ROTULO_TIPO_HIBRIDO[t]}
          </option>
        ))}
      </select>
      <select aria-label={`Rota — ${p.descricao}`} className={selecao} disabled={!podeEditar} value={h?.rota ?? "URBANO"} onChange={(ev) => mudar({ rota: ev.target.value as RotaHibrido })}>
        {(Object.keys(ROTULO_ROTA) as RotaHibrido[]).map((r) => (
          <option key={r} value={r}>
            {ROTULO_ROTA[r]}
          </option>
        ))}
      </select>
      {leve && (
        <select aria-label={`Combustível do híbrido — ${p.descricao}`} className={selecao} disabled={!podeEditar} value={h?.combustivel ?? "GASOLINA"} onChange={(ev) => mudar({ combustivel: ev.target.value as ConfigHibrido["combustivel"] })}>
          <option value="GASOLINA">Gasolina</option>
          <option value="ETANOL">Etanol (flex)</option>
        </select>
      )}
      {h?.tipo === "PHEV" && (
        <label className="flex items-center gap-1" title="Fração do km rodada no elétrico, com recarga na tomada todo dia. 0% = nunca recarrega (locação sem motorista: o cliente decide).">
          km no elétrico
          <span className="w-16">
            <CampoNumero valor={pct(h.pctEletrico)} casas={0} desativado={!podeEditar} aoMudar={(v) => v !== null && v >= 0 && v <= 100 && mudar({ pctEletrico: v / 100 })} />
          </span>
          %
        </label>
      )}
      {h && <span className="text-slate-500">consumo ×{h.fatorConsumo.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} · manutenção ×{h.fatorManutencao.toLocaleString("pt-BR")} · depreciação ×{h.fatorDepreciacao.toLocaleString("pt-BR")}</span>}
    </span>
  );
}

// O elétrico: onde ele recarrega (o preço do kWh é a mistura) e o carregador
// por veículo, que vai para as adaptações e se deprecia no prazo delas.
function ConfiguracaoEletrico({ p, podeEditar, mudar }: { p: PerfilVeiculo; podeEditar: boolean; mudar: (m: Partial<ConfigEletrico>) => void }) {
  const c = p.eletrico;
  if (!c) return <span className="mt-1 block text-[11px] leading-tight text-slate-500">Troque a energia e volte ao elétrico para montar o mix de recarga.</span>;
  const dc = Math.max(0, 1 - c.garagemPct - c.acPct);
  return (
    <span className="mt-1 flex flex-col items-end gap-1 text-[11px] text-slate-600">
      <label className="flex items-center gap-1" title={`Garagem R$ ${c.tarifaGaragem.toLocaleString("pt-BR")}/kWh (recarga noturna; no horário de ponta, 17h30–20h30, passa de R$ 2/kWh)`}>
        recarga na garagem
        <span className="w-14">
          <CampoNumero valor={pct(c.garagemPct)} casas={0} desativado={!podeEditar} aoMudar={(v) => v !== null && v >= 0 && v <= 100 && mudar({ garagemPct: v / 100, acPct: Math.min(c.acPct, 1 - v / 100) })} />
        </span>
        %
      </label>
      <label className="flex items-center gap-1" title={`AC pública R$ ${c.tarifaAc.toLocaleString("pt-BR")}/kWh; o resto é DC pública (rápida) a R$ ${c.tarifaDc.toLocaleString("pt-BR")}/kWh`}>
        AC pública
        <span className="w-14">
          <CampoNumero valor={pct(c.acPct)} casas={0} desativado={!podeEditar} aoMudar={(v) => v !== null && v >= 0 && v <= 100 - pct(c.garagemPct) && mudar({ acPct: v / 100 })} />
        </span>
        % · DC {pct(dc)}%
      </label>
      <label className="flex items-center gap-1" title="Wallbox AC 7–22 kW instalado (R$ 5–13 mil); DC 30–60 kW R$ 87–250 mil, dividido pelos veículos que usam.">
        carregador/veículo R$
        <span className="w-20">
          <CampoNumero valor={c.carregadorPorVeiculo} casas={0} desativado={!podeEditar} aoMudar={(v) => v !== null && v >= 0 && mudar({ carregadorPorVeiculo: v })} />
        </span>
      </label>
      <span className="text-slate-500">
        R$ {tarifaDoMix(c).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}/kWh · depreciação ×{c.fatorDepreciacao.toLocaleString("pt-BR")}
      </span>
    </span>
  );
}
