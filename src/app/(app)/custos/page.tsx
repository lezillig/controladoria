import { dreGerencial, montarComparativo, ranking } from "@/lib/controladoria/analytics";
import { analisarEstrategiaDeCusto, ROTULO_CLASSIFICACAO } from "@/lib/controladoria/estrategiaCusto";
import { fmtBRL, fmtData, fmtNumero, fmtPercent } from "@/lib/controladoria/format";
import { contextoDaPagina } from "../_dados";
import { Barra, Kpi, Secao, SeletorEmpresa, Tabela, Variacao } from "../_componentes";

// CUSTOS E DRE GERENCIAL.
//
// O DRE aqui é por CATEGORIA da Omie — o plano de contas real da empresa, e
// não um plano paralelo inventado pelo sistema. Categoria em branco vira uma
// linha própria e visível ("Sem categoria") em vez de ser diluída nas outras:
// dinheiro não classificado precisa incomodar, é o que faz alguém classificar.

export default async function CustosPage({ searchParams }: { searchParams: Promise<{ empresa?: string }> }) {
  const { ctx, escopo } = await contextoDaPagina((await searchParams).empresa);

  const comparativo = montarComparativo(ctx);
  const dre = dreGerencial(ctx, comparativo.janelas.mesAtual, comparativo.janelas.mesAnterior);
  const despesas = dre.filter((l) => l.natureza === "DESPESA");
  const receitas = dre.filter((l) => l.natureza === "RECEITA");

  const totalDespesa = despesas.reduce((acc, l) => acc + l.valorCents, 0);
  const totalReceita = receitas.reduce((acc, l) => acc + l.valorCents, 0);
  const semCategoria = despesas.find((l) => l.codigo === "SEM_CATEGORIA");

  const fornecedores = ranking(ctx, comparativo.janelas.mesAtual, "PAGAR", 15);
  const estrategia = analisarEstrategiaDeCusto(ctx);

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Custos e DRE gerencial</h1>
        <p className="mt-1 text-sm text-slate-500">
          {comparativo.janelas.mesAtual.rotulo} até {fmtData(ctx.dataReferencia)}, comparado ao mês anterior inteiro. Regime
          de competência (data de vencimento), não de caixa.
        </p>
      </div>

      <SeletorEmpresa conexoes={ctx.conexoes} ativa={escopo.conexaoId} rota="/custos" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi rotulo="Receita do mês" valor={fmtBRL(totalReceita)} apoio={`${fmtNumero(receitas.length)} categoria(s)`} />
        <Kpi rotulo="Despesa do mês" valor={fmtBRL(totalDespesa)} apoio={`${fmtNumero(despesas.length)} categoria(s)`} />
        <Kpi
          rotulo="Resultado"
          valor={fmtBRL(totalReceita - totalDespesa)}
          apoio={`Margem ${fmtPercent(totalReceita > 0 ? ((totalReceita - totalDespesa) / totalReceita) * 100 : null)}`}
          tom={totalReceita - totalDespesa >= 0 ? "bom" : "ruim"}
        />
        <Kpi
          rotulo="Sem categoria"
          valor={fmtBRL(semCategoria?.valorCents ?? 0)}
          apoio="Despesa que não aparece em nenhuma análise por natureza"
          tom={(semCategoria?.valorCents ?? 0) > 0 ? "atencao" : "bom"}
        />
      </div>

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

      <Secao titulo="Despesas por categoria" descricao="Ordenadas por valor. A variação compara com o mês anterior fechado.">
        <Tabela
          colunas={["Categoria", "Mês atual", "Participação", "Mês anterior", "Variação"]}
          alinharDireita={[1, 3]}
          vazio="Nenhuma despesa espelhada no período."
          linhas={despesas.map((l) => [
            <span key="c" className={l.codigo === "SEM_CATEGORIA" ? "font-medium text-amber-700" : "text-slate-800"}>
              {l.descricao}
            </span>,
            fmtBRL(l.valorCents),
            <div key="p" className="w-24">
              <Barra percentual={l.participacaoPercent} tom={l.codigo === "SEM_CATEGORIA" ? "ambar" : "azul"} />
              <span className="mt-1 block text-xs text-slate-500">{fmtPercent(l.participacaoPercent)}</span>
            </div>,
            fmtBRL(l.valorAnteriorCents),
            <Variacao key="v" valor={l.variacaoPercent} bomSeSobe={false} />,
          ])}
        />
      </Secao>

      <Secao titulo="Receitas por categoria">
        <Tabela
          colunas={["Categoria", "Mês atual", "Participação", "Mês anterior", "Variação"]}
          alinharDireita={[1, 3]}
          vazio="Nenhuma receita espelhada no período."
          linhas={receitas.map((l) => [
            l.descricao,
            fmtBRL(l.valorCents),
            <div key="p" className="w-24">
              <Barra percentual={l.participacaoPercent} tom="verde" />
              <span className="mt-1 block text-xs text-slate-500">{fmtPercent(l.participacaoPercent)}</span>
            </div>,
            fmtBRL(l.valorAnteriorCents),
            <Variacao key="v" valor={l.variacaoPercent} />,
          ])}
        />
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
