import { montarComparativo, ranking } from "@/lib/controladoria/analytics";
import { montarDre } from "@/lib/controladoria/dre";
import { prisma } from "@/lib/prisma";
import LinhaCategoria from "./LinhaCategoria";
import { analisarEstrategiaDeCusto, ROTULO_CLASSIFICACAO } from "@/lib/controladoria/estrategiaCusto";
import { fmtBRL, fmtData, fmtNumero, fmtPercent } from "@/lib/controladoria/format";
import { secondaryButtonClass } from "@/lib/ui";
import { competenciasDisponiveis, contextoDaPagina } from "../_dados";
import { Kpi, Secao, Tabela, Variacao } from "../_componentes";
import { Fragment } from "react";
import Filtros from "../Filtros";

// CUSTOS E DRE.
//
// A demonstração segue a estrutura do art. 187 da Lei 6.404/76 — receita
// bruta, deduções, receita líquida, custo, lucro bruto, despesas, EBIT,
// resultado financeiro, tributos, resultado líquido. Nessa ordem, porque a
// ordem É a demonstração.
//
// O que liga essa estrutura ao plano de categorias REAL da empresa é dado
// editável, não regra no código (ver DreClassificacao): a Omie diz se a
// categoria é receita ou despesa, mas não diz se uma despesa é custo do
// serviço ou despesa operacional — e é essa distinção que separa lucro bruto
// de resultado operacional.
//
// Categoria em branco fica FORA da demonstração, num aviso à parte. Diluí-la
// faria o DRE fechar escondendo justamente o que falta classificar.

export default async function CustosPage({
  searchParams,
}: {
  searchParams: Promise<{ empresa?: string; competencia?: string }>;
}) {
  const params = await searchParams;
  const { ctx, escopo, periodo } = await contextoDaPagina(params.empresa, params.competencia);

  const comparativo = await montarComparativo(ctx);

  const guardadas = await prisma.dreClassificacao.findMany({
    where: { companyId: ctx.companyId },
    select: { categoriaCodigo: true, linha: true, subgrupo: true, origem: true },
  });
  const classificacoes = new Map(
    guardadas.map((c) => [
      c.categoriaCodigo,
      { linha: c.linha, subgrupo: c.subgrupo, confirmada: c.origem === "CONFIRMADA" },
    ])
  );
  const categoriasPorCodigo = new Map(ctx.categorias.map((c) => [c.codigo, c]));
  const subgruposConhecidos = [...new Set(guardadas.map((c) => c.subgrupo).filter((s): s is string => !!s))].sort();

  const dre = montarDre(ctx, comparativo.janelas.mesAtual, comparativo.janelas.mesAnterior, classificacoes);
  const totalDespesa = dre.linhas
    .filter((l) => l.tipo === "GRUPO" && l.chave !== "RECEITA_BRUTA" && l.chave !== "RECEITA_FINANCEIRA")
    .reduce((a, l) => a + l.valorCents, 0);

  const fornecedores = ranking(ctx, comparativo.janelas.mesAtual, "PAGAR", 15);
  const estrategia = analisarEstrategiaDeCusto(ctx);

  const filtros = new URLSearchParams();
  if (escopo.conexaoId) filtros.set("empresa", escopo.conexaoId);
  if (periodo.competencia) filtros.set("competencia", periodo.competencia);
  const urlDaPlanilha = `/api/exportar/composicao${filtros.toString() ? `?${filtros}` : ""}`;
  const urlDaConferencia = `/api/exportar/dre${filtros.toString() ? `?${filtros}` : ""}`;

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Custos e DRE gerencial</h1>
          <p className="mt-1 text-sm text-slate-500">
            {comparativo.janelas.mesAtual.rotulo} até {fmtData(ctx.dataReferencia)}, comparado ao mês anterior inteiro.
            Regime de competência, pela data de emissão do documento.
          </p>
        </div>
        {/* Corrigir categorização é trabalho de lista, não de tela: exige
            ordenar, filtrar e riscar conforme se resolve. A planilha traz
            receita e despesa juntas, com o mesmo recorte de empresa e
            competência que está visível aqui. */}
        <div className="flex flex-wrap gap-2">
          {/* Duas planilhas, e não uma com tudo: elas servem a trabalhos
              diferentes. A de composição é para corrigir a CATEGORIA na Omie;
              a de conferência do DRE é para julgar em que LINHA a categoria
              caiu, e traz os campos do cadastro Omie lado a lado justamente
              para isso. Juntá-las daria uma planilha que ninguém percorre
              inteira. */}
          <a href={urlDaConferencia} className={secondaryButtonClass}>
            Planilha de conferência do DRE
          </a>
          <a href={urlDaPlanilha} className={secondaryButtonClass}>
            Composição por categoria
          </a>
        </div>
      </div>

      <Filtros
        conexoes={ctx.conexoes}
        empresaAtiva={escopo.conexaoId}
        competencias={competenciasDisponiveis(ctx.config.dataInicioBase)}
        competenciaAtiva={periodo.competencia}
        rota="/custos"
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          rotulo="Receita líquida"
          valor={fmtBRL(dre.receitaLiquidaCents)}
          apoio="Receita bruta menos as deduções"
        />
        <Kpi
          rotulo="Lucro bruto"
          valor={fmtBRL(dre.linhas.find((l) => l.chave === "LUCRO_BRUTO")?.valorCents ?? 0)}
          apoio={`${fmtPercent(dre.linhas.find((l) => l.chave === "LUCRO_BRUTO")?.percentReceitaLiquida ?? null)} da receita líquida`}
        />
        <Kpi
          rotulo="Resultado líquido"
          valor={fmtBRL(dre.resultadoLiquidoCents)}
          apoio={`Margem ${fmtPercent(dre.margemLiquidaPercent)}`}
          tom={dre.resultadoLiquidoCents >= 0 ? "bom" : "ruim"}
        />
        <Kpi
          rotulo="Por classificar"
          valor={fmtBRL(dre.naoConfirmadoCents + dre.semCategoriaCents)}
          apoio="Movimento em categoria que ninguém confirmou ainda"
          tom={dre.naoConfirmadoCents + dre.semCategoriaCents > 0 ? "atencao" : "bom"}
        />
      </div>

      {(dre.naoConfirmadoCents > 0 || dre.semCategoriaCents > 0) && (
        <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Este DRE ainda não foi conferido por inteiro.</strong>{" "}
          {dre.naoConfirmadoCents > 0 && (
            <>
              {fmtBRL(dre.naoConfirmadoCents)} estão em categorias classificadas por dedução automática — e a dedução é
              conservadora de propósito: toda despesa que o sistema não reconhece com segurança cai em{" "}
              <em>outras despesas operacionais</em>, que é a única linha que não desloca o lucro bruto por engano.
              Enquanto houver valor aqui, a margem bruta está subestimada.{" "}
            </>
          )}
          {dre.semCategoriaCents > 0 && (
            <>
              {fmtBRL(dre.semCategoriaCents)} estão em títulos <strong>sem categoria nenhuma</strong> na Omie e ficaram
              fora da demonstração — o conserto desses é lá, não aqui.
            </>
          )}
        </div>
      )}

      <Secao
        titulo="Demonstração do resultado"
        descricao={`${comparativo.janelas.mesAtual.rotulo}, na estrutura do art. 187 da Lei 6.404/76. Percentuais sobre a receita líquida.`}
      >
        <div className="-mx-6 overflow-x-auto px-6">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">Conta</th>
                <th className="px-3 py-2 text-right">Mês atual</th>
                <th className="px-3 py-2 text-right">% RL</th>
                <th className="px-3 py-2 text-right">Mês anterior</th>
                <th className="px-3 py-2 text-right">Variação</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {dre.linhas.map((linha) => {
                const subtotal = linha.tipo === "SUBTOTAL";
                const resultado = linha.chave === "RESULTADO_LIQUIDO";
                return (
                  <Fragment key={linha.chave}>
                    <tr
                      className={
                        resultado
                          ? "border-t-2 border-slate-900 bg-slate-50 font-semibold text-slate-900"
                          : subtotal
                            ? "border-t border-slate-300 bg-slate-50/60 font-semibold text-slate-800"
                            : "border-b border-slate-100 text-slate-700"
                      }
                    >
                      <td className="px-3 py-2.5">{linha.rotulo}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmtBRL(linha.valorCents)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">
                        {fmtPercent(linha.percentReceitaLiquida)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">
                        {fmtBRL(linha.valorAnteriorCents)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Variacao
                          valor={
                            linha.valorAnteriorCents !== 0
                              ? ((linha.valorCents - linha.valorAnteriorCents) / Math.abs(linha.valorAnteriorCents)) * 100
                              : null
                          }
                          bomSeSobe={linha.chave.startsWith("RECEITA") || subtotal}
                        />
                      </td>
                      <td className="px-3 py-2.5"></td>
                    </tr>

                    {/* Subtotais por subgrupo, quando a empresa montou algum. */}
                    {linha.subgrupos.map((s) => (
                      <tr key={`${linha.chave}:${s.nome}`} className="border-b border-slate-50 text-xs text-slate-600">
                        <td className="py-1.5 pl-8 pr-3 font-medium">{s.nome}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-medium">{fmtBRL(s.valorCents)}</td>
                        <td className="px-3 py-1.5"></td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{fmtBRL(s.valorAnteriorCents)}</td>
                        <td className="px-3 py-1.5"></td>
                        <td className="px-3 py-1.5"></td>
                      </tr>
                    ))}

                    {linha.itens.map((i) => {
                      const cat = categoriasPorCodigo.get(i.categoriaCodigo);
                      const marcas = cat
                        ? [
                            cat.codigoDre ? `DRE ${cat.codigoDre}` : null,
                            cat.tipoCategoria,
                            cat.contaReceita ? "receita" : null,
                            cat.contaDespesa ? "despesa" : null,
                          ].filter(Boolean)
                        : [];
                      return (
                        <LinhaCategoria
                          key={i.categoriaCodigo}
                          item={i}
                          linhaChave={linha.chave}
                          subgruposConhecidos={subgruposConhecidos}
                          marcasOmie={marcas.length > 0 ? marcas.join(" · ") : null}
                        />
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-xs text-slate-500">
          <strong>IRPJ e CSLL entram como dedução da receita bruta</strong>, e não abaixo do resultado antes dos
          tributos. É uma escolha da empresa, com razão de negócio: no Lucro Presumido a base dos dois é uma presunção
          sobre a receita — 16% para transporte de passageiros, 12% de CSLL —, então eles se comportam como percentual
          do faturamento, igual a PIS, COFINS e ISS. O resultado líquido final é o mesmo pelos dois caminhos; o que muda
          é a receita líquida e, com ela, todo percentual desta tela. Ao comparar com o DRE da contabilidade, é aqui que
          a diferença aparece.
          <br />
          <br />
          <strong>Como esta demonstração difere do DRE contábil oficial.</strong> Aqui o regime é o de competência dos
          títulos, pela data de emissão do documento. Não há provisão, apropriação de despesa antecipada nem
          depreciação — depreciação não passa por título, e este sistema espelha títulos. É uma leitura gerencial na
          estrutura legal: serve para decidir no dia 5, não para assinar balanço. O DRE oficial é o da contabilidade.
        </p>
      </Secao>

      {/* DEPOIS do DRE, e não antes: recomendar corte antes de mostrar o
          resultado é dar resposta a quem ainda não viu a pergunta. Quem abre
          esta tela quer saber primeiro se deu lucro; onde cortar é a conversa
          seguinte. */}
      <Secao
        titulo="Onde reduzir"
        descricao="Reduzir custo é meta; saber onde reduzir é estratégia. As categorias são cruzadas em dois eixos: peso no custo total e acoplamento à receita."
      >
        {!estrategia.baseSuficiente ? (
          <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-600">
            São necessários pelo menos 4 meses de histórico para julgar se um custo acompanha a receita ou cresceu sozinho.
            A base tem {estrategia.mesesAnalisados} mês(es) — a análise aparece automaticamente quando houver histórico
            suficiente. Recomendar onde cortar com menos que isso custa mais caro que não recomendar.
          </p>
        ) : (
          <>
            <p className="mb-3 text-sm text-slate-600">
              Economia anual estimada nos alvos prioritários:{" "}
              <strong className="text-emerald-700">{fmtBRL(estrategia.economiaAnualTotalCents)}</strong>. Custo médio
              mensal analisado: {fmtBRL(estrategia.custoTotalMensalCents)} ao longo de {estrategia.mesesAnalisados} meses.
            </p>
            <ul className="space-y-3">
              {estrategia.linhas
                .filter((l) => l.dentroDosPrimeiros80)
                .slice(0, 8)
                .map((l) => (
                  <li key={l.codigo} className="rounded-lg border border-slate-200 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">{l.descricao}</p>
                        <span
                          className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            l.classificacao === "DESACOPLADO_CRESCENTE"
                              ? "bg-red-100 text-red-700"
                              : l.classificacao === "FIXO_ESTRUTURAL"
                                ? "bg-amber-100 text-amber-700"
                                : l.classificacao === "VARIAVEL_ACOPLADO"
                                  ? "bg-sky-100 text-sky-700"
                                  : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {ROTULO_CLASSIFICACAO[l.classificacao]}
                        </span>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold tabular-nums text-slate-900">
                          {fmtBRL(l.custoMedioMensalCents)}/mês
                        </p>
                        <p className="text-xs text-slate-500">{fmtPercent(l.participacaoPercent)} do custo</p>
                        {l.economiaAnualEstimadaCents > 0 && (
                          <p className="text-xs font-medium text-emerald-700">
                            até {fmtBRL(l.economiaAnualEstimadaCents)}/ano
                          </p>
                        )}
                      </div>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-slate-600">{l.racional}</p>
                    <div className="mt-2 rounded-lg bg-slate-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">O que fazer</p>
                      <p className="mt-1 text-sm leading-relaxed text-slate-700">{l.acao}</p>
                    </div>
                  </li>
                ))}
            </ul>
            <p className="mt-3 text-xs text-slate-500">
              Corte linear (&quot;todos reduzem 10%&quot;) trata igual o que é desigual: corta o combustível que leva o
              passageiro na mesma proporção do contrato que ninguém usa. As categorias marcadas como &quot;acompanha a
              entrega&quot; devem ser atacadas por eficiência (custo por km, por hora), nunca por corte de valor absoluto.
            </p>
          </>
        )}
      </Secao>

      <Secao titulo="Maiores fornecedores do mês" descricao="Volume concentrado é poder de negociação — e risco de dependência.">
        <Tabela
          colunas={["Fornecedor", "Títulos", "Valor", "Participação"]}
          alinharDireita={[1, 2, 3]}
          linhas={fornecedores.map((f) => [
            f.nome,
            fmtNumero(f.quantidade),
            fmtBRL(f.valorCents),
            fmtPercent(totalDespesa > 0 ? (f.valorCents / totalDespesa) * 100 : null),
          ])}
        />
      </Secao>
    </div>
  );
}
