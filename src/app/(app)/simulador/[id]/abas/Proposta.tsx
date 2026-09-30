"use client";

import { ROTULO_UNIDADE, type EntradaSimulacao, type ResultadoSimulacao } from "@/lib/simulador/tipos";
import { Cartao, brl, num, pct, td, tdN, th, thN, botao } from "../comum";

// O ORÇAMENTO — a tabela que vai para o cliente e para a diretoria.
//
// Uma linha por item, com o preço na unidade do contrato e, ao lado, o mesmo
// preço nas outras unidades. É o que responde à pergunta de quem negocia
// ("e se ele quiser por diária?") sem refazer a conta: todas as unidades saem
// da mesma composição, então a margem é a mesma em qualquer uma delas.

function baixar(nome: string, conteudo: string, tipo: string) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// CSV no padrão brasileiro: ponto e vírgula, vírgula decimal, BOM para o Excel
// abrir com acentos.
function csv(linhas: (string | number | null)[][]) {
  const cel = (v: string | number | null) =>
    v === null ? "" : typeof v === "number" ? (Number.isFinite(v) ? String(Math.round(v * 1e6) / 1e6).replace(".", ",") : "") : /[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  return "﻿" + linhas.map((l) => l.map(cel).join(";")).join("\r\n");
}

export default function Proposta({ entrada, resultado, nomeArquivo }: { entrada: EntradaSimulacao; resultado: ResultadoSimulacao; nomeArquivo: string }) {
  const mensal = entrada.premissas.contrato.modo === "MENSAL";
  const unidade = resultado.unidade;
  const periodo = mensal ? "mês" : "período";

  const exportarCsv = () => {
    const cab = [
      "Item",
      "Descrição",
      "Unidade",
      `Quantidade (${periodo})`,
      "Preço unitário",
      `Valor (${periodo})`,
      `Custo (${periodo})`,
      `Lucro (${periodo})`,
      "Margem",
      "R$/km",
      "R$/veículo-mês",
      "R$/diária",
      "R$/hora",
      "Binômia: fixo R$/veículo-mês",
      "Binômia: variável R$/km",
      "Veículos",
      "Motoristas",
    ];
    const linhas = resultado.itens.map((i) => [
      i.item,
      i.descricao,
      ROTULO_UNIDADE[i.unidade],
      i.quantidadeUnidade,
      i.precoUnidade,
      i.faturamento,
      i.custoTotal,
      i.lucro,
      i.margem,
      i.indicadores.km.preco,
      i.indicadores.veiculoMes.preco,
      i.indicadores.diaria.preco,
      i.indicadores.hora?.preco ?? null,
      i.indicadores.binomia.fixoVeiculoMes,
      i.indicadores.binomia.variavelKm,
      i.veiculos,
      i.motoristas,
    ]);
    const total = ["TOTAL", "", "", null, null, resultado.totais.faturamento, resultado.totais.custoTotal, resultado.totais.lucro, resultado.totais.margem, null, null, null, null, null, null, resultado.totais.veiculos, resultado.totais.motoristas];
    baixar(`${nomeArquivo}.csv`, csv([cab, ...linhas, total]), "text/csv;charset=utf-8");
  };

  return (
    <Cartao
      titulo="Orçamento"
      ajuda={`Preço de cada item na unidade do contrato (${ROTULO_UNIDADE[unidade]}) e o equivalente nas outras unidades. Valores do ${periodo} na utilização prevista.`}
      acao={
        <button type="button" className={botao} onClick={exportarCsv}>
          Baixar CSV
        </button>
      }
    >
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-[13px] [&_td]:whitespace-nowrap [&_td:first-child]:whitespace-normal">
          <thead>
            <tr>
              <th className={th}>Item</th>
              <th className={thN}>Quantidade</th>
              <th className={`${thN} bg-blue-50 text-blue-800`}>Preço ({ROTULO_UNIDADE[unidade]})</th>
              <th className={thN}>Valor ({periodo})</th>
              <th className={thN}>Custo</th>
              <th className={thN}>Lucro</th>
              <th className={thN}>Margem</th>
              <th className={thN}>R$/km</th>
              <th className={thN}>R$/veíc.-mês</th>
              <th className={thN}>R$/diária</th>
              <th className={thN}>R$/hora</th>
              <th className={thN}>Binômia</th>
            </tr>
          </thead>
          <tbody>
            {resultado.itens.map((i) => (
              <tr key={i.item} className={i.acimaDoTeto ? "bg-red-50/60" : undefined}>
                <td className={`${td} min-w-[260px] max-w-[380px]`} title={i.descricao}>
                  <span className="font-medium">{i.item}</span> <span className="line-clamp-2 inline text-slate-500">{i.descricao}</span>
                  {i.acimaDoTeto && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-800">acima do teto</span>}
                </td>
                <td className={tdN}>{num(i.quantidadeUnidade, i.unidade === "KM" ? 0 : 1)}</td>
                <td className={`${tdN} bg-blue-50/60 font-semibold`}>{unidade === "BINOMIA" ? `${brl(i.indicadores.binomia.fixoVeiculoMes)} + ${brl(i.indicadores.binomia.variavelKm, 4)}` : brl(i.precoUnidade)}</td>
                <td className={tdN}>{brl(i.faturamento)}</td>
                <td className={tdN}>{brl(i.custoTotal)}</td>
                <td className={`${tdN} ${i.lucro < 0 ? "text-red-700" : ""}`}>{brl(i.lucro)}</td>
                <td className={tdN}>{pct(i.margem)}</td>
                <td className={tdN}>{brl(i.indicadores.km.preco, 4)}</td>
                <td className={tdN}>{brl(i.indicadores.veiculoMes.preco)}</td>
                <td className={tdN}>{brl(i.indicadores.diaria.preco)}</td>
                <td className={tdN}>{i.indicadores.hora ? brl(i.indicadores.hora.preco) : <span title="Alguma rota do item não informa horas por dia">—</span>}</td>
                <td className={`${tdN} whitespace-nowrap text-xs`}>
                  {brl(i.indicadores.binomia.fixoVeiculoMes, 0)} + {brl(i.indicadores.binomia.variavelKm, 2)}/km
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 font-semibold">
              <td className={td}>Total</td>
              <td className={tdN} />
              <td className={tdN}>{resultado.lote ? brl(resultado.lote.precoPropostaUnidade) : ""}</td>
              <td className={tdN}>{brl(resultado.totais.faturamento)}</td>
              <td className={tdN}>{brl(resultado.totais.custoTotal)}</td>
              <td className={tdN}>{brl(resultado.totais.lucro)}</td>
              <td className={tdN}>{pct(resultado.totais.margem)}</td>
              <td className={tdN} colSpan={5} />
            </tr>
          </tfoot>
        </table>
      </div>
      {resultado.lote && (
        <p className="text-sm text-slate-600">
          Julgamento por lote: preço único de <strong>{brl(resultado.lote.precoPropostaUnidade)}</strong> ({ROTULO_UNIDADE[unidade]}), com margem de{" "}
          <strong>{pct(resultado.lote.margemAoPrecoProposta)}</strong> ao preço da proposta.
          {resultado.lote.itensAcimaDoTeto.length > 0 && <span className="text-red-700"> Itens acima do teto: {resultado.lote.itensAcimaDoTeto.join(", ")}.</span>}
        </p>
      )}
    </Cartao>
  );
}
