"use client";

import { useState } from "react";
import type { PainelDecisao } from "@/lib/simulador/decisao";
import { separarMaoDeObraEVeiculo, type ChaveParte, type Componente, type Parte } from "@/lib/simulador/separacao";
import { ROTULO_UNIDADE, type EntradaSimulacao, type ResultadoSimulacao } from "@/lib/simulador/tipos";
import type { ComposicaoItem } from "@/lib/simulador/tipos";
import { Cartao, CampoNumero, brl, brl0, num, pct, td, tdN, th, thN } from "../comum";
import type { Alterar } from "./Operacao";

// AS TRÊS LEITURAS DO RESULTADO — composição, cenários e decisão. Tudo aqui é
// derivado de simular() e montarPainel(), recalculados a cada edição.

type Linha = { rotulo: string; f: (i: ComposicaoItem) => number; fmt?: (v: number) => string; soma?: boolean; destaque?: boolean };

export function Custos({ resultado, entrada }: { resultado: ResultadoSimulacao; entrada: EntradaSimulacao }) {
  const it = resultado.itens;
  const mensal = entrada.premissas.contrato.modo === "MENSAL";
  const meses = entrada.premissas.contrato.mesesCustoFixo;
  const secoes: [string, Linha[]][] = [
    ["Operação", [
      { rotulo: "Km útil", f: (i) => i.kmUtil, fmt: (v) => num(v) },
      { rotulo: "Km rodado (com improdutivo)", f: (i) => i.kmRodado, fmt: (v) => num(v) },
      { rotulo: "Veículos (sem reserva)", f: (i) => i.veiculos, fmt: (v) => num(v) },
      { rotulo: "Motoristas", f: (i) => i.motoristas, fmt: (v) => num(v, 1) },
    ]],
    ["Mão de obra (mensal)", [
      { rotulo: "Salários", f: (i) => i.salarios },
      { rotulo: "Encargos", f: (i) => i.encargos },
      { rotulo: "Benefícios, uniforme e exames", f: (i) => i.beneficios },
      { rotulo: "Supervisão local", f: (i) => i.supervisao },
      { rotulo: "= Mão de obra no mês", f: (i) => i.maoDeObraMes, destaque: true },
    ]],
    ["Veículo — custo fixo (mensal, com reserva técnica)", [
      { rotulo: "Depreciação", f: (i) => i.depreciacao },
      { rotulo: "Remuneração do capital", f: (i) => i.remuneracaoCapital },
      { rotulo: "Seguro", f: (i) => i.seguro },
      { rotulo: "IPVA, licenciamento e laudos", f: (i) => i.ipvaLicenciamento },
      { rotulo: "Telemetria e controle de embarque", f: (i) => i.telemetria },
      { rotulo: "Higienização e acessibilidade", f: (i) => i.higieneAcessibilidade },
      { rotulo: "Garagem / base local", f: (i) => i.garagem },
      { rotulo: "Adaptações", f: (i) => i.adaptacao },
      { rotulo: "Manutenção fixa", f: (i) => i.manutencaoFixa },
      { rotulo: "= Veículo, custo fixo no mês", f: (i) => i.veiculoMes, destaque: true },
    ]],
    [mensal ? "Veículo — custo variável (mês)" : "Veículo — custo variável (período)", [
      { rotulo: "Combustível", f: (i) => i.diesel },
      { rotulo: "ARLA", f: (i) => i.arla },
      { rotulo: "Óleo e lavagem", f: (i) => i.oleoLavagem },
      { rotulo: "Pneus", f: (i) => i.pneus },
      { rotulo: "Manutenção", f: (i) => i.manutencao },
      { rotulo: "Pedágio", f: (i) => i.pedagio },
      { rotulo: "= Veículo, custo variável", f: (i) => i.variaveis, destaque: true },
    ]],
    ["Contrato", [
      { rotulo: "Implantação (amortizada, mensal)", f: (i) => i.implantacaoMes },
    ]],
    ["Totais", [
      { rotulo: `Mão de obra no ${mensal ? "mês" : "período"}`, f: (i) => i.maoDeObraMes * meses },
      { rotulo: `Veículo no ${mensal ? "mês" : "período"} (fixo + variável)`, f: (i) => i.veiculoMes * meses + i.variaveis },
      { rotulo: `Implantação no ${mensal ? "mês" : "período"}`, f: (i) => i.implantacaoMes * meses },
      { rotulo: "Custo direto", f: (i) => i.custoDireto },
      { rotulo: "Administração e contingência", f: (i) => i.indiretos },
      { rotulo: "Custo total", f: (i) => i.custoTotal, destaque: true },
      { rotulo: "Crédito de PIS/COFINS (Lucro Real)", f: (i) => -i.creditoPisCofins },
      { rotulo: "Custo por km útil", f: (i) => i.custoKm, fmt: (v) => brl(v, 4), soma: false },
      { rotulo: "Tributos sobre o faturamento", f: (i) => i.tributosPct, fmt: (v) => pct(v, 2), soma: false },
    ]],
    ["Preço e resultado", [
      { rotulo: `Preço (${ROTULO_UNIDADE[resultado.unidade]})`, f: (i) => i.precoUnidade, fmt: (v) => brl(v), soma: false, destaque: true },
      { rotulo: "Preço por km (equivalente)", f: (i) => i.precoKm, fmt: (v) => brl(v), soma: false },
      { rotulo: "Preço mínimo por km (lucro zero)", f: (i) => i.precoMinimoKm, fmt: (v) => brl(v, 4), soma: false },
      { rotulo: "Preço máximo do edital", f: (i) => i.precoMaximoKm ?? NaN, fmt: (v) => brl(v), soma: false },
      { rotulo: "Faturamento", f: (i) => i.faturamento, destaque: true },
      // Só no Lucro Real: somam-se ao lucro antes do IR na base do IRPJ/CSLL.
      ...(entrada.premissas.preco.irpjCsllSobreLucroPct > 0
        ? [{ rotulo: "Não dedutíveis do IR (capital próprio + contingência)", f: (i: ComposicaoItem) => i.naoDedutiveis }]
        : []),
      { rotulo: "IRPJ/CSLL sobre o lucro", f: (i) => i.irpjCsllSobreLucro },
      { rotulo: "Lucro líquido", f: (i) => i.lucro, destaque: true },
      { rotulo: "Margem", f: (i) => i.margem ?? NaN, fmt: (v) => pct(v), soma: false },
    ]],
  ];
  return (
    <div className="space-y-4">
      <MaoDeObraEVeiculo resultado={resultado} entrada={entrada} />
      <Cartao
        titulo="Composição de custo e preço"
        ajuda={`${mensal ? "Valores mensais na utilização prevista." : `Valores do período: custo fixo por ${entrada.premissas.contrato.mesesCustoFixo} meses e km do ano letivo.`} Mão de obra e veículo são mensais em qualquer caso.`}
      >
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-[13px]">
            <thead>
              <tr>
                <th className={th}>Componente</th>
                {it.map((i) => (
                  <th key={i.item} className={thN} title={i.descricao}>
                    Item {i.item}
                  </th>
                ))}
                <th className={thN}>Total</th>
              </tr>
            </thead>
            <tbody>
              {secoes.map(([titulo, linhas]) => (
                <FragmentoSecao key={titulo} titulo={titulo} linhas={linhas} itens={it} />
              ))}
            </tbody>
          </table>
        </div>
        {resultado.lote && (
          <p className="text-sm text-slate-700">
            <b>Lote:</b> preço médio ponderado {brl(resultado.lote.precoUnidade, 4)} → proposta <b>{brl(resultado.lote.precoPropostaUnidade)}</b> ({ROTULO_UNIDADE[resultado.unidade]}) em todos os itens. Ao preço único, o lote rende{" "}
            <b>{brl0(resultado.lote.lucroAoPrecoProposta)}</b> ({pct(resultado.lote.margemAoPrecoProposta)}).
            {resultado.lote.itensAcimaDoTeto.length > 0 && ` Item ${resultado.lote.itensAcimaDoTeto.join(", ")} isolado fica acima do teto.`}
          </p>
        )}
      </Cartao>
      <Cartao titulo="O mesmo custo em cada unidade de preço" ajuda="Para comparar formatos de contrato: o preço que cobre o custo e dá a margem alvo em cada unidade.">
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-[13px]">
            <thead>
              <tr>
                {["Item", "R$/km", "R$/veículo-mês", "R$/diária", "R$/hora", "Fixo por veículo-mês", "+ variável por km"].map((t, k) => (
                  <th key={t} className={k === 0 ? th : thN}>
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {it.map((i) => (
                <tr key={i.item}>
                  <td className={td}>Item {i.item}</td>
                  <td className={tdN}>{brl(i.indicadores.km.preco)}</td>
                  <td className={tdN}>{brl(i.indicadores.veiculoMes.preco)}</td>
                  <td className={tdN}>{brl(i.indicadores.diaria.preco)}</td>
                  <td className={tdN}>{i.indicadores.hora ? brl(i.indicadores.hora.preco) : <span className="font-sans text-xs text-slate-500">informe horas/dia</span>}</td>
                  <td className={tdN}>{brl(i.indicadores.binomia.fixoVeiculoMes)}</td>
                  <td className={tdN}>{brl(i.indicadores.binomia.variavelKm)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Cartao>
    </div>
  );
}

function FragmentoSecao({ titulo, linhas, itens }: { titulo: string; linhas: Linha[]; itens: ComposicaoItem[] }) {
  return (
    <>
      <tr>
        <td colSpan={itens.length + 2} className="border-b border-slate-100 bg-slate-50 px-2 py-1.5 text-xs font-semibold text-slate-600">
          {titulo}
        </td>
      </tr>
      {linhas.map((l) => {
        const fmt = l.fmt ?? ((v: number) => brl0(v));
        const total = itens.reduce((a, i) => a + l.f(i), 0);
        return (
          <tr key={l.rotulo} className={l.destaque ? "font-semibold" : ""}>
            <td className={td}>{l.rotulo}</td>
            {itens.map((i) => (
              <td key={i.item} className={tdN}>
                {fmt(l.f(i))}
              </td>
            ))}
            <td className={tdN}>{l.soma === false ? "—" : fmt(total)}</td>
          </tr>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------- mão de obra × veículo

const COR_PARTE: Record<ChaveParte, string> = {
  maoDeObra: "#1d4ed8",
  veiculoFixo: "#0d9488",
  veiculoVariavel: "#d97706",
  implantacao: "#9333ea",
};

// Quanto do custo e do preço é gente e quanto é carro — do conjunto ou de um
// item. Ver src/lib/simulador/separacao.ts.
function MaoDeObraEVeiculo({ resultado, entrada }: { resultado: ResultadoSimulacao; entrada: EntradaSimulacao }) {
  const [item, setItem] = useState<string | null>(null);
  const itens = item === null ? resultado.itens : resultado.itens.filter((i) => i.item === item);
  const s = separarMaoDeObraEVeiculo(itens, entrada.premissas, entrada);
  const apuracao = entrada.premissas.contrato.modo === "MENSAL" ? "mês" : "período";
  const meses = entrada.premissas.contrato.mesesCustoFixo;
  const visiveis = s.partes.filter((p) => p.comIndiretos > 0);
  const linhas = [
    { ...s.maoDeObra, cor: COR_PARTE.maoDeObra, destaque: true, recuo: false },
    { ...s.veiculo, cor: null, destaque: true, recuo: false },
    ...s.partes.filter((p) => p.chave === "veiculoFixo" || p.chave === "veiculoVariavel").map((p) => ({ ...p, cor: COR_PARTE[p.chave], destaque: false, recuo: true })),
    ...s.partes.filter((p) => p.chave === "implantacao" && p.comIndiretos > 0).map((p) => ({ ...p, cor: COR_PARTE[p.chave], destaque: false, recuo: false })),
  ];
  return (
    <Cartao
      titulo="Mão de obra × veículo"
      ajuda={`Custos no ${apuracao}, cada parte com a sua fração de administração e contingência. O preço de cada parte é o faturamento rateado pelo custo líquido (o crédito de PIS/COFINS é todo do veículo): quanto do preço calculado paga a equipe e quanto paga o veículo.`}
      acao={
        resultado.itens.length > 1 ? (
          <div className="flex flex-wrap gap-1" role="group" aria-label="Item">
            {[null, ...resultado.itens.map((i) => i.item)].map((c) => (
              <button
                key={c ?? "todos"}
                type="button"
                onClick={() => setItem(c)}
                aria-pressed={item === c}
                className={`rounded-md px-2 py-0.5 text-xs font-medium ${item === c ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
              >
                {c === null ? "Todos" : `Item ${c}`}
              </button>
            ))}
          </div>
        ) : undefined
      }
    >
      <div className="grid gap-3 lg:grid-cols-2">
        <Resumo
          rotulo="Mão de obra"
          cor={COR_PARTE.maoDeObra}
          parte={s.maoDeObra}
          grupos={[{ titulo: null, itens: s.componentes.maoDeObra }]}
          administracaoPct={s.administracaoPct}
          contingenciaPct={s.contingenciaPct}
          divisor={{ quantidade: s.pessoas * meses, rotulo: "por pessoa-mês" }}
          extra={s.pessoas > 0 ? `${num(s.pessoas, 1)} pessoas na equipe (motoristas e monitoras)` : undefined}
        />
        <Resumo
          rotulo="Veículo"
          cor={COR_PARTE.veiculoFixo}
          parte={s.veiculo}
          grupos={[
            { titulo: "Custo fixo", itens: s.componentes.veiculoFixo },
            { titulo: `Custo variável (${num(s.kmUtil)} km úteis)`, itens: s.componentes.veiculoVariavel },
          ]}
          administracaoPct={s.administracaoPct}
          contingenciaPct={s.contingenciaPct}
          divisor={{ quantidade: s.veiculoMes, rotulo: "por veículo-mês" }}
          extra={s.veiculoMes > 0 ? `${num(s.veiculoMes / meses)} veículos em operação; fixo com a reserva técnica` : undefined}
        />
      </div>
      {s.custoTotal > 0 && (
        <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded" role="img" aria-label={visiveis.map((p) => `${p.rotulo} ${pct(p.participacao)}`).join(", ")}>
          {visiveis.map((p) => (
            <span key={p.chave} title={`${p.rotulo}: ${brl0(p.comIndiretos)} (${pct(p.participacao)})`} style={{ width: `${p.participacao * 100}%`, background: COR_PARTE[p.chave] }} className="first:rounded-l last:rounded-r" />
          ))}
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-[13px]">
          <thead>
            <tr>
              <th className={th}>Parte</th>
              <th className={thN}>Custo no {apuracao}</th>
              <th className={thN}>% do custo</th>
              <th className={thN}>Custo por km</th>
              <th className={thN}>Custo por veículo-mês</th>
              <th className={thN}>Preço por veículo-mês</th>
              <th className={thN}>Preço por km</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.rotulo} className={l.destaque ? "font-semibold" : ""}>
                <td className={td}>
                  <span className={`inline-flex items-center gap-2 ${l.recuo ? "pl-4 text-slate-600" : ""}`}>
                    {l.cor ? <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: l.cor }} /> : <span className="inline-block w-2.5" />}
                    {l.recuo ? l.rotulo.replace("Veículo — ", "") : l.rotulo}
                  </span>
                </td>
                <td className={tdN}>{brl0(l.comIndiretos)}</td>
                <td className={tdN}>{pct(l.participacao)}</td>
                <td className={tdN}>{brl(l.porKm, 4)}</td>
                <td className={tdN}>{brl(l.porVeiculoMes)}</td>
                <td className={tdN}>{brl(l.precoPorVeiculoMes)}</td>
                <td className={tdN}>{brl(l.precoPorKm, 4)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className={td}>Total</td>
              <td className={tdN}>{brl0(s.custoTotal)}</td>
              <td className={tdN}>{pct(s.custoTotal > 0 ? 1 : null)}</td>
              <td className={tdN}>{brl(s.kmUtil > 0 ? s.custoTotal / s.kmUtil : null, 4)}</td>
              <td className={tdN}>{brl(s.veiculoMes > 0 ? s.custoTotal / s.veiculoMes : null)}</td>
              <td className={tdN}>{brl(s.veiculoMes > 0 ? s.faturamento / s.veiculoMes : null)}</td>
              <td className={tdN}>{brl(s.kmUtil > 0 ? s.faturamento / s.kmUtil : null, 4)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Cartao>
  );
}

function Resumo({
  rotulo,
  cor,
  parte,
  grupos,
  administracaoPct,
  contingenciaPct,
  divisor,
  extra,
}: {
  rotulo: string;
  cor: string;
  parte: Parte;
  grupos: { titulo: string | null; itens: Componente[] }[];
  administracaoPct: number;
  contingenciaPct: number;
  divisor: { quantidade: number; rotulo: string };
  extra?: string;
}) {
  const porUnidade = (v: number) => (divisor.quantidade > 0 ? brl(v / divisor.quantidade) : "—");
  const participacao = (v: number) => pct(parte.comIndiretos > 0 ? v / parte.comIndiretos : null);
  const indiretos = parte.comIndiretos - parte.direto;
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 px-3 py-2">
      <div>
        <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: cor }} />
          {rotulo} · {pct(parte.participacao)} do custo
        </div>
        <div className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-slate-900">{brl(parte.comIndiretos)}</div>
        <div className="text-xs text-slate-600">
          preço rateado <b className="font-mono tabular-nums">{brl(parte.precoPorVeiculoMes)}</b> por veículo-mês
        </div>
        {extra && <div className="mt-0.5 text-[11px] text-slate-500">{extra}</div>}
      </div>
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-[10.5px] uppercase tracking-wide text-slate-500">
            <th className="py-1 text-left font-medium">Componente</th>
            <th className="py-1 pl-3 text-right font-medium">Valor</th>
            <th className="py-1 pl-3 text-right font-medium">%</th>
            <th className="py-1 pl-3 text-right font-medium">{divisor.rotulo}</th>
          </tr>
        </thead>
        <tbody>
          {grupos.map((g) => {
            const visiveis = g.itens.filter((c) => Math.abs(c.valor) >= 0.005);
            const total = g.itens.reduce((a, c) => a + c.valor, 0);
            return [
              g.titulo && (
                <tr key={`t-${g.titulo}`} className="font-semibold text-slate-700">
                  <td className="border-t border-slate-100 pt-1.5">{g.titulo}</td>
                  <td className="border-t border-slate-100 pt-1.5 pl-3 text-right font-mono tabular-nums">{brl(total)}</td>
                  <td className="border-t border-slate-100 pt-1.5 pl-3 text-right font-mono tabular-nums">{participacao(total)}</td>
                  <td className="border-t border-slate-100 pt-1.5 pl-3 text-right font-mono tabular-nums">{porUnidade(total)}</td>
                </tr>
              ),
              ...visiveis.flatMap((c) => [
                <tr key={`${g.titulo}-${c.rotulo}`} className="text-slate-700">
                  <td className={`border-t border-slate-100 py-1 ${g.titulo ? "pl-3" : ""}`}>
                    {c.rotulo}
                    {c.memo && <span className="block text-[11px] leading-tight text-slate-500">{c.memo}</span>}
                  </td>
                  <td className="border-t border-slate-100 py-1 pl-3 text-right align-top font-mono tabular-nums">{brl(c.valor)}</td>
                  <td className="border-t border-slate-100 py-1 pl-3 text-right align-top font-mono tabular-nums text-slate-500">{participacao(c.valor)}</td>
                  <td className="border-t border-slate-100 py-1 pl-3 text-right align-top font-mono tabular-nums text-slate-500">{porUnidade(c.valor)}</td>
                </tr>,
                ...(c.sub ?? []).map((x) => (
                  <tr key={`${g.titulo}-${c.rotulo}-${x.rotulo}`} className="text-[11.5px] text-slate-500">
                    <td className={`py-0.5 ${g.titulo ? "pl-7" : "pl-4"}`}>
                      ↳ {x.rotulo}
                      {x.memo && <span className="block text-[10.5px] leading-tight text-slate-400">{x.memo}</span>}
                    </td>
                    <td className="py-0.5 pl-3 text-right align-top font-mono tabular-nums">{brl(x.valor)}</td>
                    <td className="py-0.5 pl-3 text-right align-top font-mono tabular-nums">{participacao(x.valor)}</td>
                    <td className="py-0.5 pl-3 text-right align-top font-mono tabular-nums">{porUnidade(x.valor)}</td>
                  </tr>
                )),
              ]),
            ];
          })}
          {indiretos > 0.005 &&
            ([
              ["Administração central", administracaoPct, "rateio da estrutura da empresa — ver a premissa na aba Premissas"],
              ["Contingência / risco", contingenciaPct, "reserva para imprevistos"],
            ] as const).map(([t, taxa, memo]) =>
              taxa ? (
                <tr key={t} className="text-slate-700">
                  <td className="border-t border-slate-100 py-1">
                    {t} ({pct(taxa, 2)} do custo direto)
                    <span className="block text-[11px] leading-tight text-slate-500">
                      {brl(parte.direto)} × {pct(taxa, 2)} · {memo}
                    </span>
                  </td>
                  <td className="border-t border-slate-100 py-1 pl-3 text-right align-top font-mono tabular-nums">{brl(parte.direto * taxa)}</td>
                  <td className="border-t border-slate-100 py-1 pl-3 text-right align-top font-mono tabular-nums text-slate-500">{participacao(parte.direto * taxa)}</td>
                  <td className="border-t border-slate-100 py-1 pl-3 text-right align-top font-mono tabular-nums text-slate-500">{porUnidade(parte.direto * taxa)}</td>
                </tr>
              ) : null
            )}
          <tr className="font-semibold text-slate-900">
            <td className="border-t border-slate-300 py-1">Total</td>
            <td className="border-t border-slate-300 py-1 pl-3 text-right font-mono tabular-nums">{brl(parte.comIndiretos)}</td>
            <td className="border-t border-slate-300 py-1 pl-3 text-right font-mono tabular-nums">{participacao(parte.comIndiretos)}</td>
            <td className="border-t border-slate-300 py-1 pl-3 text-right font-mono tabular-nums">{porUnidade(parte.comIndiretos)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- cenários

function GraficoLucro({ linhas }: { linhas: ResultadoSimulacao["cenarios"]["linhas"] }) {
  const W = 640, H = 220, M = { t: 18, r: 12, b: 34, l: 12 };
  const vals = linhas.map((l) => l.lucro);
  const max = Math.max(0, ...vals), min = Math.min(0, ...vals), span = max - min || 1;
  const y = (v: number) => M.t + ((max - v) / span) * (H - M.t - M.b);
  const bw = (W - M.l - M.r) / Math.max(1, linhas.length);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Lucro por utilização do km" className="max-w-3xl">
      <line x1={M.l} x2={W - M.r} y1={y(0)} y2={y(0)} stroke="#cbd5e1" />
      {linhas.map((l, i) => {
        const x = M.l + i * bw + bw * 0.22, w = bw * 0.56, y0 = y(0), y1 = y(l.lucro);
        const topo = Math.min(y0, y1), altura = Math.max(1, Math.abs(y1 - y0));
        return (
          <g key={l.utilizacao}>
            <title>{`${pct(l.utilizacao, 0)} do km: lucro ${brl0(l.lucro)} (${pct(l.margem)})`}</title>
            <rect x={x} y={topo} width={w} height={altura} rx={4} fill={l.lucro >= 0 ? "#1d4ed8" : "#c2410c"} />
            <text x={x + w / 2} y={l.lucro >= 0 ? topo - 5 : topo + altura + 13} textAnchor="middle" fontSize={11} fill="#0f172a" fontFamily="var(--font-geist-mono), monospace">
              {num(l.lucro / 1000)} mil
            </text>
            <text x={x + w / 2} y={H - 12} textAnchor="middle" fontSize={11} fill="#64748b">
              {pct(l.utilizacao, 0)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function Cenarios({ resultado, entrada, alterar }: { resultado: ResultadoSimulacao; entrada: EntradaSimulacao; alterar: Alterar }) {
  const c = resultado.cenarios;
  const eq = c.pontoEquilibrio;
  const linhas: [string, (l: (typeof c.linhas)[number]) => string][] = [
    ["Km útil", (l) => num(l.kmUtil)],
    ["Custo total", (l) => brl0(l.custoTotal)],
    ["Custo por km", (l) => brl(l.custoKm, 4)],
    ["Preço p/ lucro alvo (R$/km)", (l) => brl(l.precoLucroAlvoKm)],
    ["Preço lucro zero (R$/km)", (l) => brl(l.precoLucroZeroKm, 4)],
    ["Faturamento ao preço de teste", (l) => brl0(l.faturamento)],
    ["Lucro", (l) => brl0(l.lucro)],
    ["Margem", (l) => pct(l.margem)],
    ["Lucro no ano", (l) => brl0(l.lucroAno)],
    ["Lucro por veículo-mês", (l) => brl0(l.lucroVeiculoMes)],
  ];
  return (
    <Cartao titulo="Cenários de utilização" ajuda="O custo fixo não cai com o km; o variável acompanha o km rodado; o pedágio acompanha a utilização. A tabela mostra o que acontece ao preço de teste quando a demanda real fica abaixo ou acima da prevista.">
      <div className="flex flex-wrap items-end gap-4">
        <label className="w-44 space-y-1 text-xs text-slate-500">
          <span className="block">Preço de teste ({ROTULO_UNIDADE[c.unidade]}{c.unidade === "BINOMIA" ? ", parcela por km" : ""})</span>
          <CampoNumero valor={c.precoTesteKm} aoMudar={(v) => v !== null && v > 0 && alterar((e) => void (e.precoTesteKm = v))} />
        </label>
        <p className="text-sm text-slate-700">
          {eq === null
            ? "Não há utilização em que o lucro zere a este preço."
            : c.tipoEquilibrio === "MINIMA"
              ? <>Abaixo de <b>{pct(eq, 0)}</b> do km de referência este preço dá prejuízo.</>
              : <>Acima de <b>{pct(eq, 0)}</b> do km de referência este preço dá prejuízo — prever franquia de km e km excedente.</>}
        </p>
      </div>
      <GraficoLucro linhas={c.linhas} />
      <div className="flex items-center gap-3 text-xs text-slate-500">
        <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#1d4ed8]" /> lucro <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#c2410c]" /> prejuízo · {entrada.premissas.contrato.modo === "MENSAL" ? "por mês" : "no período"}, em R$ mil
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-[13px]">
          <thead>
            <tr>
              <th className={th}>Utilização do km</th>
              {c.linhas.map((l) => (
                <th key={l.utilizacao} className={thN}>
                  {pct(l.utilizacao, 0)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map(([t, f]) => (
              <tr key={t}>
                <td className={td}>{t}</td>
                {c.linhas.map((l) => (
                  <td key={l.utilizacao} className={tdN}>
                    {f(l)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Cartao>
  );
}

// ---------------------------------------------------------------- decisão

const ROT_VEREDICTO = { LANCAR: "Lançar", LANCAR_COM_RESSALVA: "Lançar com ressalva", NAO_LANCAR: "Não lançar" } as const;
export const COR_VEREDICTO = {
  LANCAR: "bg-emerald-50 text-emerald-800",
  LANCAR_COM_RESSALVA: "bg-amber-50 text-amber-800",
  NAO_LANCAR: "bg-red-50 text-red-800",
} as const;
export const ICONE_VEREDICTO = { LANCAR: "✓", LANCAR_COM_RESSALVA: "!", NAO_LANCAR: "✕" } as const;

export function SeloVeredicto({ veredicto }: { veredicto: PainelDecisao["veredicto"] }) {
  return (
    <span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-semibold ${COR_VEREDICTO[veredicto]}`}>
      {ICONE_VEREDICTO[veredicto]} {ROT_VEREDICTO[veredicto]}
    </span>
  );
}

function ReguaLance({ faixa }: { faixa: PainelDecisao["faixa"] }) {
  const pts = ([["Piso (lucro zero)", faixa.piso], ["Margem mínima", faixa.margemMinima], ["Alvo (proposta)", faixa.alvo], ["Teto do edital", faixa.teto]] as [string, number | null][]).filter(
    (p): p is [string, number] => p[1] !== null && Number.isFinite(p[1])
  );
  const lo = Math.min(...pts.map((p) => p[1])), hi = Math.max(...pts.map((p) => p[1]));
  const W = 640, M = 70, x = (v: number) => M + ((v - lo) / (hi - lo || 1)) * (W - 2 * M);
  // No celular o SVG encolhe e os rótulos ficam ilegíveis: lá, a mesma faixa
  // vai como lista, e o desenho fica só para telas maiores.
  return (
    <>
    <ul className="space-y-1 text-sm sm:hidden">
      {pts.map(([t, v]) => (
        <li key={t} className="flex justify-between gap-3">
          <span className="text-slate-600">{t}</span>
          <span className="font-mono tabular-nums">{brl(v)}</span>
        </li>
      ))}
    </ul>
    <svg viewBox={`0 0 ${W} 110`} width="100%" role="img" aria-label={`Faixa de lance: ${pts.map(([t, v]) => `${t} ${brl(v)}`).join(", ")}`} className="hidden max-w-3xl sm:block">
      <line x1={M} x2={W - M} y1={52} y2={52} stroke="#cbd5e1" strokeWidth={2} />
      <rect x={x(faixa.margemMinima)} y={46} width={Math.max(2, x(faixa.alvo) - x(faixa.margemMinima))} height={12} rx={4} fill="#1d4ed8" opacity={0.3} />
      {pts.map(([t, v], i) => (
        <g key={t}>
          <circle cx={x(v)} cy={52} r={5} fill={t.startsWith("Teto") ? "#c2410c" : "#1d4ed8"} />
          <text x={x(v)} y={i % 2 ? 88 : 30} textAnchor="middle" fontSize={11} fill="#0f172a" fontFamily="var(--font-geist-mono), monospace">
            {brl(v)}
          </text>
          <text x={x(v)} y={i % 2 ? 102 : 16} textAnchor="middle" fontSize={11} fill="#64748b">
            {t}
          </text>
        </g>
      ))}
    </svg>
    </>
  );
}

export function Decisao({ painel }: { painel: PainelDecisao }) {
  const max = Math.max(1, ...painel.sensibilidade.map((s) => Math.abs(s.efeitoLucro)));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Cartao>
          <SeloVeredicto veredicto={painel.veredicto} />
          <p className="text-sm text-slate-800">{painel.resumo}</p>
          <h3 className="pt-2 text-sm font-semibold text-slate-900">Faixa de lance</h3>
          <ReguaLance faixa={painel.faixa} />
          <p className="text-xs text-slate-500">
            Espaço de negociação entre o alvo e a margem mínima: <b>{brl(painel.faixa.espacoNegociacao)}</b> ({ROTULO_UNIDADE[painel.faixa.unidade]}). Margem mínima {pct(painel.margemMinima)}
            {painel.regrasDaBase ? " (regras da Azul Mob na base de custos)" : " (padrão: metade do alvo)"}.
          </p>
        </Cartao>
        <Cartao titulo="O que mais derruba o lucro" ajuda="Cada premissa 10% pior, uma de cada vez, ao preço da proposta.">
          <div className="grid gap-2">
            {painel.sensibilidade.map((s) => (
              <div key={s.caminho} className="grid grid-cols-[minmax(120px,180px)_1fr_auto] items-center gap-3 text-[13px]" title={`${s.rotulo}: ${brl0(s.efeitoLucro)} (${pct(s.efeitoMargem)} de margem)`}>
                <span>{s.rotulo}</span>
                <span className="h-2.5 rounded bg-[#c2410c]" style={{ width: `${(Math.abs(s.efeitoLucro) / max) * 100}%` }} />
                <span className="font-mono tabular-nums">{brl0(s.efeitoLucro)}</span>
              </div>
            ))}
          </div>
        </Cartao>
      </div>
      <Cartao titulo="Alertas">
        {painel.alertas.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhum alerta.</p>
        ) : (
          <div className="space-y-2">
            {painel.alertas.map((a) => (
              <div key={a.titulo} className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-lg border border-slate-200 px-3 py-2">
                <span className={`h-fit rounded-full px-2 py-0.5 text-[11px] font-semibold ${a.nivel === "CRITICO" ? "bg-red-50 text-red-800" : a.nivel === "ATENCAO" ? "bg-amber-50 text-amber-800" : "bg-blue-50 text-blue-800"}`}>
                  {a.nivel === "CRITICO" ? "Crítico" : a.nivel === "ATENCAO" ? "Atenção" : "Info"}
                </span>
                <b className="text-[13px]">{a.titulo}</b>
                <p className="col-start-2 text-[12.5px] text-slate-600">{a.detalhe}</p>
              </div>
            ))}
          </div>
        )}
        {painel.premissasEstimadas.total > 0 && (
          <p className="text-xs text-slate-500">
            {painel.premissasEstimadas.estimadas} de {painel.premissasEstimadas.total} premissas ainda são estimativa.
          </p>
        )}
      </Cartao>
    </div>
  );
}
