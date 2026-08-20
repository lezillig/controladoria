import Link from "next/link";
import { AlertTriangle, Banknote, Landmark, Lightbulb, TrendingDown, TrendingUp } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { montarPanorama } from "@/lib/controladoria/analytics";
import { medirBsc, PERSPECTIVAS } from "@/lib/controladoria/bsc";
import { fmtBRL, fmtData, fmtNumero, fmtPercent } from "@/lib/controladoria/format";
import { avaliarQualidadeDaBase } from "@/lib/controladoria/supervisor";
import { montarPanoramaConformidade } from "@/lib/conformidade/panorama";
import { rotuloCompetencia } from "@/lib/conformidade/tipos";
import { contextoDaPagina } from "./_dados";
import { AvisoVazio, BadgeSeveridade, Barra, Farol, Kpi, Secao, SeletorEmpresa, Tabela, Variacao } from "./_componentes";

// DASHBOARD FINANCEIRO — a tela de abertura do módulo.
//
// Organizada na ordem em que a pergunta aparece na cabeça de quem decide:
// 1) o que aconteceu (resultado e caixa), 2) o que exige ação (achados),
// 3) o que vem pela frente (projeção), 4) como estamos indo (BSC).
// Sem gráfico decorativo: cada elemento aqui responde a uma pergunta.

export default async function ControladoriaPage({ searchParams }: { searchParams: Promise<{ empresa?: string }> }) {
  const { ctx, escopo } = await contextoDaPagina((await searchParams).empresa);

  const panorama = montarPanorama(ctx);
  const c = panorama.comparativo;
  const qualidade = avaliarQualidadeDaBase(ctx);
  const conformidade = montarPanoramaConformidade(ctx.conformidade, ctx.dataReferencia);

  const [achados, bsc, ultimoRelatorio] = await Promise.all([
    prisma.auditFinding.findMany({
      where: { companyId: ctx.companyId, status: { in: ["ABERTO", "EM_ANALISE"] } },
      orderBy: [{ severidade: "asc" }, { impactoCents: "desc" }],
      take: 200,
    }),
    medirBsc(ctx),
    prisma.relatorioDiario.findFirst({
      where: { companyId: ctx.companyId },
      orderBy: { dataReferencia: "desc" },
      select: { dataReferencia: true, status: true, enviadoEm: true },
    }),
  ]);

  if (!qualidade.temTitulos) {
    return (
      <div className="max-w-6xl">
        <Cabecalho dataReferencia={ctx.dataReferencia} />
        <AvisoVazio
          titulo="Nenhum dado da Omie ainda"
          descricao="O sistema espelha o ERP para poder auditar. Cadastre as conexões das empresas do grupo e rode a primeira sincronização — a carga histórica roda em segundo plano, mês a mês, e o relatório diário passa a sair sozinho a partir do dia seguinte."
          acaoHref="/conexoes"
          acaoLabel="Cadastrar conexões"
        />
      </div>
    );
  }

  const criticos = achados.filter((a) => a.severidade === "CRITICA" || a.severidade === "ALTA");
  const economia = achados
    .filter((a) => a.categoria === "OPORTUNIDADE")
    .reduce((acc, a) => acc + (a.impactoCents ?? 0), 0);
  const perdas = achados
    .filter((a) => a.categoria === "PERDA_FINANCEIRA")
    .reduce((acc, a) => acc + (a.valorCents ?? 0), 0);
  const indiciosFraude = achados.filter((a) => a.categoria === "FRAUDE").length;

  const ruptura = panorama.projecao.find((p) => p.saldoProjetadoCents < 0);

  return (
    <div className="max-w-6xl space-y-6">
      <Cabecalho dataReferencia={ctx.dataReferencia} />

      <SeletorEmpresa conexoes={ctx.conexoes} ativa={escopo.conexaoId} rota="/" />

      {qualidade.limitacoes.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-amber-900">
            Qualidade da base nesta leitura: {qualidade.score}%
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-amber-800">
            {qualidade.limitacoes.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          rotulo="Receita do mês"
          valor={fmtBRL(c.mesAtual.receitaCents)}
          apoio={`${c.mesAtual.titulosReceber} título(s) · vs. mês anterior`}
          icone={<TrendingUp className="h-4 w-4" />}
        />
        <Kpi
          rotulo="Despesa do mês"
          valor={fmtBRL(c.mesAtual.despesaCents)}
          apoio={`${c.mesAtual.titulosPagar} título(s) · vs. mês anterior`}
          icone={<TrendingDown className="h-4 w-4" />}
        />
        <Kpi
          rotulo="Resultado do mês"
          valor={fmtBRL(c.mesAtual.resultadoCents)}
          apoio={`Margem ${fmtPercent(c.mesAtual.margemPercent)}`}
          tom={c.mesAtual.resultadoCents >= 0 ? "bom" : "ruim"}
        />
        <Kpi
          rotulo="Saldo em caixa"
          valor={fmtBRL(panorama.saldoAtualCents)}
          apoio={`A pagar em aberto ${fmtBRL(panorama.aPagarEmAbertoCents)}`}
          tom={panorama.saldoAtualCents >= 0 ? "neutro" : "ruim"}
          icone={<Banknote className="h-4 w-4" />}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          rotulo="Perdas do mês"
          valor={fmtBRL(c.mesAtual.perdaTotalCents)}
          apoio="Juros, multa, tarifa e desconto concedido"
          tom={c.mesAtual.perdaTotalCents > 0 ? "ruim" : "bom"}
        />
        <Kpi
          rotulo="Economia identificada"
          valor={fmtBRL(economia)}
          apoio="Impacto anual estimado das oportunidades"
          tom={economia > 0 ? "bom" : "neutro"}
          icone={<Lightbulb className="h-4 w-4" />}
        />
        <Kpi
          rotulo="Achados em aberto"
          valor={fmtNumero(achados.length)}
          apoio={`${criticos.length} crítico(s)/alto(s) · ${indiciosFraude} indício(s) de fraude`}
          tom={criticos.length > 0 ? "atencao" : "bom"}
          icone={<AlertTriangle className="h-4 w-4" />}
        />
        <Kpi
          rotulo="Perdas apontadas"
          valor={fmtBRL(perdas)}
          apoio="Soma dos achados de perda em aberto"
          tom={perdas > 0 ? "atencao" : "bom"}
        />
      </div>

      {ruptura && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm font-semibold text-red-900">
            Caixa projetado fica negativo em {ruptura.dias} dias ({fmtBRL(ruptura.saldoProjetadoCents)})
          </p>
          <p className="mt-1 text-xs text-red-800">
            Considerando os recebíveis a vencer e os pagamentos programados até {fmtData(ruptura.data)}.{" "}
            <Link href="/fluxo-caixa" className="font-medium underline">
              Ver a projeção completa
            </Link>
          </p>
        </div>
      )}

      <Secao
        titulo="Precisa de decisão"
        descricao="Achados de maior severidade validados pelo supervisor."
        acao={
          <Link href="/auditoria" className="text-xs font-medium text-blue-700 hover:underline">
            Ver todos os achados
          </Link>
        }
      >
        {criticos.length === 0 ? (
          <p className="rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
            Nenhum achado crítico ou de alta severidade em aberto.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {criticos.slice(0, 6).map((a) => (
              <li key={a.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <BadgeSeveridade severidade={a.severidade} />
                  <Link href={`/auditoria?achado=${a.id}`} className="text-sm font-medium text-slate-900 hover:underline">
                    {a.titulo}
                  </Link>
                  {a.confianca < 100 && (
                    <span className="text-xs text-slate-500">confiança {a.confianca}%</span>
                  )}
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-slate-600">{a.descricao}</p>
                {(a.valorCents !== null || a.impactoCents !== null) && (
                  <p className="mt-1 text-xs font-medium text-slate-700">
                    {a.valorCents !== null && `Valor: ${fmtBRL(a.valorCents)}`}
                    {a.valorCents !== null && a.impactoCents !== null && " · "}
                    {a.impactoCents !== null && `Impacto estimado: ${fmtBRL(a.impactoCents)}`}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Secao>

      {conformidade.temModulo && (
        <Secao
          titulo="Conformidade e riscos externos"
          descricao="O que consultoria, contabilidade e auditoria apontaram sobre a empresa."
          acao={
            <Link href="/conformidade" className="text-xs font-medium text-blue-700 hover:underline">
              Abrir conformidade
            </Link>
          }
        >
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <NumeroConformidade rotulo="Em aberto" valor={conformidade.abertos} />
            <NumeroConformidade rotulo="Graves" valor={conformidade.criticos} alertaSePositivo />
            <NumeroConformidade rotulo="Prazo vencido" valor={conformidade.vencidos} alertaSePositivo />
            <NumeroConformidade rotulo="Reincidentes" valor={conformidade.reincidentes} alertaSePositivo />
          </div>
          <p className="mt-3 text-xs text-slate-500">
            {fmtNumero(conformidade.confirmadosPeloSistema)} com confirmação nos próprios dados desta auditoria ·{" "}
            {fmtNumero(conformidade.semCobertura)} que só a revisão externa enxerga.
            {!conformidade.documentoEsperadoRecebido && conformidade.competenciaEsperada && (
              <span className="font-medium text-amber-700">
                {" "}
                O documento de {rotuloCompetencia(conformidade.competenciaEsperada)} ainda não chegou.
              </span>
            )}
          </p>
        </Secao>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Secao titulo="Comparativos" descricao="Regime de competência, pela data de vencimento.">
          <Tabela
            colunas={["Período", "Receita", "Despesa", "Resultado"]}
            alinharDireita={[1, 2, 3]}
            linhas={[
              ["Dia (D-1)", fmtBRL(c.dia.receitaCents), fmtBRL(c.dia.despesaCents), fmtBRL(c.dia.resultadoCents)],
              [
                <span key="m" className="font-medium">
                  {c.mesAtual.rotulo}
                </span>,
                <span key="mr">
                  {fmtBRL(c.mesAtual.receitaCents)}
                  <br />
                  <Variacao valor={c.variacoes.receitaMesVsAnterior} />
                </span>,
                <span key="md">
                  {fmtBRL(c.mesAtual.despesaCents)}
                  <br />
                  <Variacao valor={c.variacoes.despesaMesVsAnterior} bomSeSobe={false} />
                </span>,
                fmtBRL(c.mesAtual.resultadoCents),
              ],
              [c.mesAnterior.rotulo, fmtBRL(c.mesAnterior.receitaCents), fmtBRL(c.mesAnterior.despesaCents), fmtBRL(c.mesAnterior.resultadoCents)],
              [
                <span key="a" className="font-medium">
                  {c.ano.rotulo}
                </span>,
                <span key="ar">
                  {fmtBRL(c.ano.receitaCents)}
                  <br />
                  <Variacao valor={c.variacoes.receitaAnoVsAnterior} />
                </span>,
                <span key="ad">
                  {fmtBRL(c.ano.despesaCents)}
                  <br />
                  <Variacao valor={c.variacoes.despesaAnoVsAnterior} bomSeSobe={false} />
                </span>,
                fmtBRL(c.ano.resultadoCents),
              ],
              c.semBaseAnoAnterior
                ? [c.anoAnterior.rotulo, "sem base", "sem base", "sem base"]
                : [
                    c.anoAnterior.rotulo,
                    fmtBRL(c.anoAnterior.receitaCents),
                    fmtBRL(c.anoAnterior.despesaCents),
                    fmtBRL(c.anoAnterior.resultadoCents),
                  ],
            ]}
          />
        </Secao>

        <Secao titulo="Recebíveis por faixa de atraso" descricao={`Total em aberto: ${panorama.agingReceber.fmt.total}`}>
          <ul className="space-y-3">
            {panorama.agingReceber.faixas.map((f) => (
              <li key={f.rotulo}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700">
                    {f.rotulo} <span className="text-slate-400">({f.quantidade})</span>
                  </span>
                  <span className="tabular-nums text-slate-600">{fmtBRL(f.valorCents)}</span>
                </div>
                <Barra
                  percentual={panorama.agingReceber.totalCents > 0 ? (f.valorCents / panorama.agingReceber.totalCents) * 100 : 0}
                  tom={f.rotulo === "A vencer" ? "verde" : "vermelho"}
                />
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-slate-500">
            Ciclo financeiro: {fmtNumero(panorama.ciclo.cicloFinanceiroDias)} dias (PMR {fmtNumero(panorama.ciclo.pmrDias)} ·
            PMP {fmtNumero(panorama.ciclo.pmpDias)}).
          </p>
        </Secao>
      </div>

      <Secao
        titulo="Balanced Scorecard"
        descricao="Verde dentro da meta · amarelo na tolerância · vermelho fora."
        acao={
          <Link href="/bsc" className="text-xs font-medium text-blue-700 hover:underline">
            Abrir o BSC
          </Link>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {PERSPECTIVAS.map((p) => {
            const indicadores = bsc.filter((i) => i.indicador.perspectiva === p.chave);
            return (
              <div key={p.chave} className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs font-semibold text-slate-800">{p.nome}</p>
                <ul className="mt-2 space-y-1.5">
                  {indicadores.map((i) => (
                    <li key={i.indicador.codigo} className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex items-center gap-2 text-slate-600">
                        <Farol farol={i.farol} titulo={i.indicador.descricao} />
                        {i.indicador.nome}
                      </span>
                      <span className="shrink-0 font-medium tabular-nums text-slate-800">
                        {i.valor === null
                          ? "—"
                          : i.indicador.unidade === "PERCENTUAL"
                            ? fmtPercent(i.valor)
                            : i.indicador.unidade === "REAIS"
                              ? fmtBRL(Math.round(i.valor * 100))
                              : fmtNumero(i.valor)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </Secao>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Secao titulo="Maiores despesas do mês">
          <Tabela
            colunas={["Fornecedor", "Títulos", "Valor"]}
            alinharDireita={[1, 2]}
            linhas={panorama.topFornecedores.slice(0, 8).map((f) => [f.nome, fmtNumero(f.quantidade), fmtBRL(f.valorCents)])}
          />
        </Secao>
        <Secao titulo="Maiores receitas do mês">
          <Tabela
            colunas={["Cliente", "Títulos", "Valor"]}
            alinharDireita={[1, 2]}
            linhas={panorama.topClientes.slice(0, 8).map((f) => [f.nome, fmtNumero(f.quantidade), fmtBRL(f.valorCents)])}
          />
        </Secao>
      </div>

      <p className="text-xs text-slate-500">
        <Landmark className="mr-1 inline h-3 w-3" />
        Último relatório diário:{" "}
        {ultimoRelatorio
          ? `${fmtData(ultimoRelatorio.dataReferencia)} · ${ultimoRelatorio.status === "ENVIADO" ? "enviado" : "gerado, não enviado"}`
          : "nenhum ainda"}
        .{" "}
        <Link href="/relatorios" className="font-medium text-blue-700 hover:underline">
          Ver histórico
        </Link>
      </p>
    </div>
  );
}

// Número seco, sem cartão: aqui a pergunta não é "quanto", é "tem ou não tem".
// Zero fica cinza de propósito — só o que exige ação ganha cor.
function NumeroConformidade({
  rotulo,
  valor,
  alertaSePositivo = false,
}: {
  rotulo: string;
  valor: number;
  alertaSePositivo?: boolean;
}) {
  const cor = alertaSePositivo && valor > 0 ? "text-red-700" : "text-slate-900";
  return (
    <div>
      <p className={`text-2xl font-semibold ${cor}`}>{fmtNumero(valor)}</p>
      <p className="mt-0.5 text-xs text-slate-500">{rotulo}</p>
    </div>
  );
}

function Cabecalho({ dataReferencia }: { dataReferencia: Date }) {
  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Controladoria</h1>
      <p className="mt-1 text-sm text-slate-500">
        Painel financeiro consolidado a partir da Omie e da operação — dados de {fmtData(dataReferencia)} (D-1).
      </p>
    </div>
  );
}
