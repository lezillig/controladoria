import { prisma } from "@/lib/prisma";
import { inputClass, larguraPainel } from "@/lib/ui";
import { fmtBRL, fmtData, fmtNumero, fmtPercent } from "@/lib/controladoria/format";
import { medirBsc, PERSPECTIVAS, type IndicadorMedido } from "@/lib/controladoria/bsc";
import { contextoDaPagina, podeAcao } from "../_dados";
import { Farol, Kpi, Secao } from "../_componentes";
import { salvarMeta } from "./actions";

// BALANCED SCORECARD.
//
// Mostrado por perspectiva, com a cadeia de causa e efeito explícita: os
// indicadores de processo e aprendizado explicam, com um mês de antecedência,
// o que vai aparecer nos financeiros. Um BSC apresentado como quatro listas
// desconexas vira relatório de números; a leitura útil é a ligação entre eles.

export default async function BscPage() {
  const { session, ctx } = await contextoDaPagina("bsc");
  const podeEditar = await podeAcao(session, "gerir-bsc");

  const medidos = await medirBsc(ctx);

  // Histórico dos últimos 30 dias para a tendência. Buscado por indicador, e
  // não recalculado: o valor de ontem é o que foi medido ontem, com a base
  // daquele dia — recalcular hoje daria outro número e a tendência mentiria.
  const historico = await prisma.bscSnapshot.findMany({
    where: {
      companyId: session.companyId,
      dataReferencia: { gte: new Date(ctx.dataReferencia.getFullYear(), ctx.dataReferencia.getMonth(), ctx.dataReferencia.getDate() - 30) },
    },
    orderBy: { dataReferencia: "asc" },
    select: { codigo: true, valor: true, farol: true, dataReferencia: true },
  });

  const contagem = (farol: string) => medidos.filter((m) => m.farol === farol).length;

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Balanced Scorecard</h1>
        <p className="mt-1 text-sm text-slate-500">
          Medição de {fmtData(ctx.dataReferencia)}. Todo indicador aqui é calculado sozinho, todo dia, a partir da Omie e da
          operação — nenhum depende de alguém preencher planilha, que é como um scorecard morre no segundo mês.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Kpi rotulo="Dentro da meta" valor={fmtNumero(contagem("VERDE"))} tom="bom" />
        <Kpi rotulo="Na tolerância" valor={fmtNumero(contagem("AMARELO"))} tom="atencao" />
        <Kpi rotulo="Fora da meta" valor={fmtNumero(contagem("VERMELHO"))} tom={contagem("VERMELHO") > 0 ? "ruim" : "neutro"} />
        <Kpi rotulo="Sem meta ou sem dado" valor={fmtNumero(contagem("SEM_META") + contagem("SEM_DADO"))} />
      </div>

      {PERSPECTIVAS.map((p) => {
        const indicadores = medidos.filter((i) => i.indicador.perspectiva === p.chave);
        if (indicadores.length === 0) return null;

        return (
          <Secao key={p.chave} titulo={p.nome} descricao={p.explicacao}>
            <ul className="space-y-4">
              {indicadores.map((i) => (
                <li key={i.indicador.codigo} className="rounded-lg border border-slate-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-medium text-slate-900">
                        <Farol farol={i.farol} />
                        {i.indicador.nome}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-slate-500">{i.indicador.descricao}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xl font-semibold tabular-nums text-slate-900">{formatarValor(i)}</p>
                      <p className="text-xs text-slate-500">
                        {i.meta === null
                          ? "sem meta definida"
                          : `meta ${formatarNumero(i.meta, i.indicador.unidade)}${i.metaEhSugerida ? " (sugerida)" : ""}`}
                      </p>
                      <p className="text-xs text-slate-400">
                        {i.indicador.direcao === "MAIOR_MELHOR" ? "maior é melhor" : "menor é melhor"}
                      </p>
                    </div>
                  </div>

                  <Tendencia
                    pontos={historico
                      .filter((h) => h.codigo === i.indicador.codigo && h.valor !== null)
                      .map((h) => ({ valor: h.valor as number, data: h.dataReferencia }))}
                  />

                  {podeEditar && (
                    <form action={salvarMeta} className="mt-3 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="codigo" value={i.indicador.codigo} />
                      <div>
                        <label className="block text-xs font-medium text-slate-600">Meta</label>
                        <input
                          name="meta"
                          type="text"
                          inputMode="decimal"
                          defaultValue={i.metaEhSugerida ? "" : (i.meta ?? "")}
                          placeholder={i.indicador.metaSugerida !== null ? String(i.indicador.metaSugerida) : "—"}
                          className={`${inputClass} w-28`}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600">Tolerância (%)</label>
                        <input name="tolerancia" type="text" inputMode="decimal" defaultValue={10} className={`${inputClass} w-24`} />
                      </div>
                      <button
                        type="submit"
                        className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Salvar meta
                      </button>
                      <span className="text-xs text-slate-400">Campo vazio remove a meta (o indicador continua sendo medido).</span>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </Secao>
        );
      })}
    </div>
  );
}

function formatarNumero(valor: number, unidade: string): string {
  if (unidade === "PERCENTUAL") return fmtPercent(valor);
  if (unidade === "REAIS") return fmtBRL(Math.round(valor * 100));
  if (unidade === "DIAS") return `${fmtNumero(valor)} dias`;
  return fmtNumero(valor);
}

function formatarValor(i: IndicadorMedido): string {
  if (i.valor === null) return "—";
  return formatarNumero(i.valor, i.indicador.unidade);
}

// Minigráfico de tendência em barras. Feito com divs por decisão consciente:
// uma biblioteca de gráficos para 30 pontos por indicador acrescentaria
// centenas de kB ao pacote de uma tela que é lida em 20 segundos.
function Tendencia({ pontos }: { pontos: { valor: number; data: Date }[] }) {
  if (pontos.length < 2) {
    return <p className="mt-3 text-xs text-slate-400">Tendência aparece após alguns dias de medição.</p>;
  }

  const valores = pontos.map((p) => p.valor);
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const amplitude = max - min || 1;
  const primeiro = valores[0];
  const ultimo = valores[valores.length - 1];

  return (
    <div className="mt-3">
      <div className="flex h-10 items-end gap-0.5">
        {pontos.map((p, i) => (
          <div
            key={i}
            title={`${fmtData(p.data)}: ${fmtNumero(p.valor, 1)}`}
            className="flex-1 rounded-sm bg-blue-200"
            style={{ height: `${Math.max(6, ((p.valor - min) / amplitude) * 100)}%` }}
          />
        ))}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Últimos {pontos.length} dias medidos: de {fmtNumero(primeiro, 1)} para {fmtNumero(ultimo, 1)}.
      </p>
    </div>
  );
}
