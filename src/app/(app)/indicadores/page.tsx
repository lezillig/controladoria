import Link from "next/link";
import { larguraPainel, secondaryButtonClass } from "@/lib/ui";
import { fmtBRL, fmtBRLCompacto, fmtData, fmtNumero, fmtPercent } from "@/lib/controladoria/format";
import { GRUPOS_INDICADORES, dreDaJanela, resultadoPorMes, type Indicador } from "@/lib/controladoria/indicadores";
import { painelDeIndicadores } from "@/lib/controladoria/indicadoresNoBanco";
import { escopoDaPagina, podeAcao } from "../_dados";
import { Farol, Kpi, Secao, SeletorEmpresa, Tabela } from "../_componentes";
import BalancoForm, { type ValoresBalanco } from "./BalancoForm";
import { excluirBalanco } from "./actions";

// INDICADORES DE RETORNO E DE OPERAÇÃO.
//
// A pergunta que o DRE não responde: quanto o negócio RENDE sobre o dinheiro
// posto nele. Uma margem de 25% numa empresa de frota própria pode ser um
// retorno ruim — o capital preso nos veículos é grande — e é o ROIC contra o
// custo do capital que diz se renovar a frota cria ou destrói valor.
//
// O DRE é o gerencial do sistema (12 meses fechados); o balanço é o da
// contabilidade, lançado aqui. Cada indicador mostra a conta com os números
// que entraram, para ser conferido e não aceito em bloco.

const TOM: Record<string, "bom" | "atencao" | "ruim" | "neutro"> = { VERDE: "bom", AMARELO: "atencao", VERMELHO: "ruim" };

function formatar(i: Indicador): string {
  if (i.valor === null) return "—";
  switch (i.formato) {
    case "PCT":
      return fmtPercent(i.valor);
    case "PP":
      return `${i.valor > 0 ? "+" : ""}${fmtNumero(i.valor, 1)} p.p.`;
    case "VEZES":
      return `${fmtNumero(i.valor, 2)}×`;
    case "DIAS":
      return `${fmtNumero(i.valor)} dias`;
    case "MOEDA":
      return fmtBRLCompacto(Math.round(i.valor));
    case "MOEDA_KM":
      return `${fmtBRL(Math.round(i.valor))}/km`;
    default:
      return fmtNumero(i.valor, i.valor < 10 && !Number.isInteger(i.valor) ? 1 : 0);
  }
}

const reaisDoBanco = (v: { toNumber(): number } | null) =>
  v === null ? "" : v.toNumber().toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function IndicadoresPage({
  searchParams,
}: {
  searchParams: Promise<{ empresa?: string; balanco?: string }>;
}) {
  const params = await searchParams;
  const { session, escopo, periodo, conexoes } = await escopoDaPagina("indicadores", params.empresa);
  const podeEditar = await podeAcao(session, "gerir-indicadores");
  const painel = await painelDeIndicadores({ companyId: session.companyId, conexaoId: escopo.conexaoId }, periodo.dataReferencia);

  const porChave = new Map(painel.indicadores.map((i) => [i.chave, i]));
  const destaque = ["ROIC", "MARGEM_EBITDA", "COBERTURA", "LIQUIDEZ"].map((c) => porChave.get(c)).filter((i): i is Indicador => !!i);
  const meses = resultadoPorMes(painel.dre, painel.competencias);
  const total = dreDaJanela(painel.dre, painel.competencias);
  const rotuloEscopo = escopo.apelido ?? "Grupo (todas as empresas)";
  const rota = `/indicadores${escopo.conexaoId ? `?empresa=${escopo.conexaoId}` : ""}`;
  const comEmpresa = (extra: string) => `${rota}${rota.includes("?") ? "&" : "?"}${extra}`;

  const emEdicao = painel.balancos.find((b) => b.dataBase.toISOString().slice(0, 10) === params.balanco) ?? null;
  const valores: ValoresBalanco = emEdicao
    ? {
        dataBase: emEdicao.dataBase.toISOString().slice(0, 10),
        caixa: reaisDoBanco(emEdicao.caixa),
        contasReceber: reaisDoBanco(emEdicao.contasReceber),
        ativoCirculante: reaisDoBanco(emEdicao.ativoCirculante),
        imobilizadoLiquido: reaisDoBanco(emEdicao.imobilizadoLiquido),
        ativoTotal: reaisDoBanco(emEdicao.ativoTotal),
        fornecedores: reaisDoBanco(emEdicao.fornecedores),
        passivoCirculante: reaisDoBanco(emEdicao.passivoCirculante),
        dividaCurtoPrazo: reaisDoBanco(emEdicao.dividaCurtoPrazo),
        dividaLongoPrazo: reaisDoBanco(emEdicao.dividaLongoPrazo),
        patrimonioLiquido: reaisDoBanco(emEdicao.patrimonioLiquido),
        dividendosAPagar: reaisDoBanco(emEdicao.dividendosAPagar),
        depreciacaoAno: reaisDoBanco(emEdicao.depreciacaoAno),
        lucroLiquidoAno: reaisDoBanco(emEdicao.lucroLiquidoAno),
        receitaLiquidaAno: reaisDoBanco(emEdicao.receitaLiquidaAno),
        ebitAno: reaisDoBanco(emEdicao.ebitAno),
        irCsllAno: reaisDoBanco(emEdicao.irCsllAno),
        custoCapital: String(emEdicao.custoCapitalAa.toNumber() * 100).replace(".", ","),
        frotaVeiculos: emEdicao.frotaVeiculos === null ? "" : String(emEdicao.frotaVeiculos),
        kmAno: emEdicao.kmAno === null ? "" : String(Math.round(emEdicao.kmAno.toNumber())),
        observacao: emEdicao.observacao ?? "",
      }
    : {};

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div className="space-y-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Indicadores</h1>
          <p className="mt-1 max-w-4xl text-sm text-slate-500">
            Retorno sobre o capital, dívida e operação. O DRE é o gerencial do sistema, dos 12 meses fechados (
            {painel.competencias[0] ?? "—"} a {painel.competencias.at(-1) ?? "—"}); o balanço é o da contabilidade
            {painel.balanco ? `, data-base ${fmtData(painel.balanco.dataBase)}` : ", ainda não lançado"}. As faixas de cor são referências de mercado,
            não metas — as metas ficam no Balanced Scorecard.
          </p>
        </div>
        <SeletorEmpresa conexoes={conexoes} ativa={escopo.conexaoId} rota="/indicadores" />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {destaque.map((i) => (
          <Kpi key={i.chave} rotulo={i.rotulo} valor={formatar(i)} tom={TOM[i.farol] ?? "neutro"} apoio={i.valor === null ? i.formula : undefined} />
        ))}
      </div>

      {!painel.balanco && (
        <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          Sem balanço lançado para {rotuloEscopo}: ROIC, ROE, ROA, EVA, alavancagem e liquidez ficam em branco.
          {podeEditar ? " Lance abaixo o balanço do último exercício (e o do anterior, para as médias)." : " Peça a quem cuida da controladoria para lançá-lo."}
        </div>
      )}

      {GRUPOS_INDICADORES.map((g) => {
        const itens = painel.indicadores.filter((i) => i.grupo === g.chave);
        if (itens.length === 0) return null;
        return (
          <Secao key={g.chave} titulo={g.titulo} descricao={g.descricao}>
            <ul className="divide-y divide-slate-100">
              {itens.map((i) => (
                <li key={i.chave} className="py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm font-medium text-slate-900">
                        {i.farol !== "INFO" && <Farol farol={i.farol} titulo={i.farol === "SEM_DADO" ? "sem dado" : undefined} />}
                        {i.rotulo}
                      </p>
                      {i.referencia && <p className="mt-1 text-xs leading-relaxed text-slate-500">{i.referencia}</p>}
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-blue-700">como foi calculado</summary>
                        <p className="mt-1 text-xs leading-relaxed text-slate-600">{i.formula}</p>
                      </details>
                    </div>
                    <p className="whitespace-nowrap text-xl font-semibold tabular-nums text-slate-900">{formatar(i)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Secao>
        );
      })}

      <Secao titulo="Mês a mês" descricao="DRE gerencial de cada mês fechado. O EBITDA é o resultado antes do financeiro e das parcelas da frota.">
        <Tabela
          colunas={["Mês", "Receita líquida", "EBITDA", "Margem EBITDA", "Resultado", "Margem líquida"]}
          alinharDireita={[1, 2, 3, 4, 5]}
          linhas={[
            ...meses.map((m) => [
              m.competencia,
              fmtBRL(m.receitaLiquida),
              fmtBRL(m.ebitda),
              fmtPercent(m.receitaLiquida > 0 ? (m.ebitda / m.receitaLiquida) * 100 : null),
              <span key="r" className={m.resultado < 0 ? "text-red-700" : undefined}>
                {fmtBRL(m.resultado)}
              </span>,
              fmtPercent(m.receitaLiquida > 0 ? (m.resultado / m.receitaLiquida) * 100 : null),
            ]),
            [
              <strong key="t">Total</strong>,
              <strong key="rl">{fmtBRL(total.receitaLiquida)}</strong>,
              <strong key="e">{fmtBRL(total.ebitda)}</strong>,
              <strong key="me">{fmtPercent(total.receitaLiquida > 0 ? (total.ebitda / total.receitaLiquida) * 100 : null)}</strong>,
              <strong key="r">{fmtBRL(total.resultado)}</strong>,
              <strong key="ml">{fmtPercent(total.receitaLiquida > 0 ? (total.resultado / total.receitaLiquida) * 100 : null)}</strong>,
            ],
          ]}
          vazio="Sem meses fechados na base."
        />
      </Secao>

      <Secao
        titulo="Balanços lançados"
        descricao={`${rotuloEscopo}. O painel usa o mais recente; o anterior (até 15 meses antes) entra na média do capital, do PL e do ativo.`}
      >
        <Tabela
          colunas={["Data-base", "Ativo total", "Dívida", "Caixa", "PL", "Custo do capital", "Lançado por", ""]}
          alinharDireita={[1, 2, 3, 4, 5]}
          linhas={painel.balancos.map((b) => [
            fmtData(b.dataBase),
            fmtBRLCompacto(Math.round(b.ativoTotal.toNumber() * 100)),
            fmtBRLCompacto(Math.round(b.dividaCurtoPrazo.plus(b.dividaLongoPrazo).toNumber() * 100)),
            fmtBRLCompacto(Math.round(b.caixa.toNumber() * 100)),
            fmtBRLCompacto(Math.round(b.patrimonioLiquido.toNumber() * 100)),
            fmtPercent(b.custoCapitalAa.toNumber() * 100),
            b.autorNome ?? "—",
            podeEditar ? (
              <div key="a" className="flex items-center justify-end gap-2">
                <Link href={comEmpresa(`balanco=${b.dataBase.toISOString().slice(0, 10)}#lancar`)} className="text-xs font-medium text-blue-700 hover:underline">
                  Editar
                </Link>
                <form action={excluirBalanco}>
                  <input type="hidden" name="id" value={b.id} />
                  <button type="submit" className="text-xs font-medium text-red-700 hover:underline">
                    Excluir
                  </button>
                </form>
              </div>
            ) : (
              ""
            ),
          ])}
          vazio="Nenhum balanço lançado."
        />
      </Secao>

      {podeEditar && (
        <section id="lancar">
          <Secao
            titulo={emEdicao ? `Editar o balanço de ${fmtData(emEdicao.dataBase)}` : "Lançar balanço"}
            descricao="Do balanço patrimonial e do DRE contábil que a contabilidade fecha. Comece pelo último exercício; o do ano anterior melhora as médias."
            acao={
              emEdicao ? (
                <Link href={rota} className={secondaryButtonClass}>
                  Novo balanço
                </Link>
              ) : undefined
            }
          >
            <BalancoForm escopo={escopo.conexaoId ?? "GRUPO"} valores={valores} rotuloEscopo={rotuloEscopo} />
          </Secao>
        </section>
      )}
    </div>
  );
}
