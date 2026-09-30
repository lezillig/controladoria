"use client";

import { ROTULO_UNIDADE, type EntradaSimulacao, type ResultadoSimulacao } from "@/lib/simulador/tipos";
import { Cartao, brl, num, pct, td, tdN, th, thN, botao, botaoPrimario } from "../comum";

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
    v === null ? "" : typeof v === "number" ? (Number.isFinite(v) ? String(Math.round(v * 1e4) / 1e4).replace(".", ",") : "") : /[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  return "﻿" + linhas.map((l) => l.map(cel).join(";")).join("\r\n");
}

// Margem no CSV já em percentual ("9,06%"), como a pessoa lê na tela.
const pctCsv = (v: number | null) => (v === null || !Number.isFinite(v) ? null : `${(v * 100).toFixed(2).replace(".", ",")}%`);

export default function Proposta({
  entrada,
  resultado,
  nomeArquivo,
  aoExportarExcel,
  exportando,
}: {
  entrada: EntradaSimulacao;
  resultado: ResultadoSimulacao;
  nomeArquivo: string;
  aoExportarExcel: () => void;
  exportando: boolean;
}) {
  const mensal = entrada.premissas.contrato.modo === "MENSAL";
  const unidade = resultado.unidade;
  const periodo = mensal ? "mês" : "período";
  // No lote vale o preço único: o total (valor, lucro, margem) é o desse
  // preço, como no topo do editor, na versão salva e na aba Proposta do
  // Excel. A soma dos itens ao preço de cada um aparecia ao lado do preço
  // único, com outro valor e outra margem.
  const lote = resultado.lote;
  const total = lote
    ? { faturamento: lote.faturamentoAoPrecoProposta, lucro: lote.lucroAoPrecoProposta, margem: lote.margemAoPrecoProposta }
    : { faturamento: resultado.totais.faturamento, lucro: resultado.totais.lucro, margem: resultado.totais.margem };

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
      pctCsv(i.margem),
      i.indicadores.km.preco,
      i.indicadores.veiculoMes.preco,
      i.indicadores.diaria.preco,
      i.indicadores.hora?.preco ?? null,
      i.indicadores.binomia.fixoVeiculoMes,
      i.indicadores.binomia.variavelKm,
      i.veiculos,
      i.motoristas,
    ]);
    const linhaTotal = [lote ? "TOTAL (preço único do lote)" : "TOTAL", "", "", null, lote ? lote.precoPropostaUnidade : null, total.faturamento, resultado.totais.custoTotal, total.lucro, pctCsv(total.margem), null, null, null, null, null, null, resultado.totais.veiculos, resultado.totais.motoristas];
    baixar(`${nomeArquivo}.csv`, csv([cab, ...linhas, linhaTotal]), "text/csv;charset=utf-8");
  };

  return (
    <Cartao
      titulo="Orçamento"
      ajuda={`Preço de cada item na unidade do contrato (${ROTULO_UNIDADE[unidade]}) e o equivalente nas outras unidades. Valores do ${periodo} na utilização prevista.`}
      acao={
        <div className="flex flex-wrap gap-2">
          <button type="button" className={botaoPrimario} disabled={exportando} onClick={aoExportarExcel} title="A conta inteira em fórmulas: premissas, tipos de veículo, rotas, composição, cenários e proposta">
            {exportando ? "Gerando Excel…" : "Exportar para Excel"}
          </button>
          <button type="button" className={botao} onClick={exportarCsv} title="Só esta tabela, para colar em outro lugar">
            Baixar CSV
          </button>
        </div>
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
              <td className={tdN}>{lote ? brl(lote.precoPropostaUnidade) : ""}</td>
              <td className={tdN}>{brl(total.faturamento)}</td>
              <td className={tdN}>{brl(resultado.totais.custoTotal)}</td>
              <td className={`${tdN} ${total.lucro < 0 ? "text-red-700" : ""}`}>{brl(total.lucro)}</td>
              <td className={tdN}>{pct(total.margem)}</td>
              <td className={tdN} colSpan={5} />
            </tr>
          </tfoot>
        </table>
      </div>
      {unidade !== "KM" && unidade !== "BINOMIA" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm text-amber-900">
          <p className="font-medium">Franquia de km e km excedente</p>
          <p className="mt-0.5 text-xs">
            Com preço fixo por {unidade === "HORA" ? "hora" : unidade === "DIARIA" ? "diária" : "veículo-mês"}, o km acima do previsto é custo sem receita. Prever no
            contrato a franquia abaixo e o km excedente pelo custo variável com tributos e margem.
          </p>
          <ul className="mt-1 space-y-0.5 text-[13px]">
            {resultado.itens.map((i) => {
              const franquia = i.indicadores.veiculoMes.quantidade > 0 ? i.indicadores.km.quantidade / i.indicadores.veiculoMes.quantidade : null;
              return (
                <li key={i.item}>
                  Item {i.item}: franquia de <strong>{num(franquia)} km</strong> por veículo-mês; km excedente a <strong>{brl(i.indicadores.binomia.variavelKm, 2)}</strong>.
                </li>
              );
            })}
          </ul>
        </div>
      )}
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
