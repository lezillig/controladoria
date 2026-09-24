import Link from "next/link";
import { AlertTriangle, Banknote, Landmark, Lightbulb, TrendingDown, TrendingUp } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { montarPanorama } from "@/lib/controladoria/analytics";
import { saldoPorContaCents } from "@/lib/controladoria/agents/conciliacao";
import { agruparComposicao, composicaoDoPeriodo } from "@/lib/controladoria/composicao";
import { medirBsc, PERSPECTIVAS } from "@/lib/controladoria/bsc";
import { fmtBRL, fmtData, fmtDataHora, fmtNumero, fmtPercent, fmtVariacao } from "@/lib/controladoria/format";
import { inicioDoDia, somarDias } from "@/lib/controladoria/periodos";
import { avaliarQualidadeDaBase } from "@/lib/controladoria/supervisor";
import { montarPanoramaConformidade } from "@/lib/conformidade/panorama";
import { rotuloCompetencia } from "@/lib/conformidade/tipos";
import { competenciasDisponiveis, contextoDaPagina } from "./_dados";
import {
  AvisoVazio,
  BadgeSeveridade,
  Barra,
  Farol,
  Fatias,
  KpiExpansivel,
  LinhasDeValor,
  rotuloCategoria,
  rotuloSeveridade,
  Secao,
  Tabela,
  Variacao,
} from "./_componentes";
import Filtros from "./Filtros";
import { larguraPainel } from "@/lib/ui";

// DASHBOARD FINANCEIRO — a tela de abertura do módulo.
//
// Organizada na ordem em que a pergunta aparece na cabeça de quem decide:
// 1) o que aconteceu (resultado e caixa), 2) o que exige ação (achados),
// 3) o que vem pela frente (projeção), 4) como estamos indo (BSC).
// Sem gráfico decorativo: cada elemento aqui responde a uma pergunta.

export default async function ControladoriaPage({
  searchParams,
}: {
  searchParams: Promise<{ empresa?: string; competencia?: string }>;
}) {
  const params = await searchParams;
  const { ctx, escopo, periodo } = await contextoDaPagina("painel", params.empresa, params.competencia);
  const competencias = competenciasDisponiveis(ctx.config.dataInicioBase);

  const panorama = await montarPanorama(ctx);
  const c = panorama.comparativo;
  const qualidade = avaliarQualidadeDaBase(ctx);
  const conformidade = montarPanoramaConformidade(ctx.conformidade, ctx.dataReferencia);

  // A composição dos dois primeiros números do painel: de onde vem cada
  // real. Somada no banco, no mesmo recorte de empresa e mês do comparativo.
  const escopoComposicao = { companyId: ctx.companyId, conexaoId: escopo.conexaoId, periodo: c.janelas.mesAtual };
  const abertos: Prisma.AuditFindingWhereInput = {
    companyId: ctx.companyId,
    status: { in: ["ABERTO", "EM_ANALISE"] },
  };
  const [
    achados,
    bsc,
    ultimoRelatorio,
    receitaComp,
    despesaComp,
    contagemAchados,
    somaOportunidades,
    somaPerdas,
    maioresOportunidades,
    maioresPerdas,
  ] = await Promise.all([
    prisma.auditFinding.findMany({
      where: { companyId: ctx.companyId, status: { in: ["ABERTO", "EM_ANALISE"] } },
      // O painel mostra seis linhas e soma valores: a evidência não é lida.
      omit: { evidencia: true },
      orderBy: [{ severidade: "asc" }, { impactoCents: "desc" }],
      take: 200,
    }),
    medirBsc(ctx),
    prisma.relatorioDiario.findFirst({
      where: { companyId: ctx.companyId },
      orderBy: { dataReferencia: "desc" },
      select: { dataReferencia: true, status: true, enviadoEm: true },
    }),
    composicaoDoPeriodo({ ...escopoComposicao, natureza: "RECEBER" }),
    composicaoDoPeriodo({ ...escopoComposicao, natureza: "PAGAR" }),
    // Contagens sobre a BASE, não sobre a página. A lista acima traz 200
    // linhas para as seções de achados; o cartão "em aberto" dizia 200 quando
    // havia 2.954 — o número certo é o que a base tem, contado no banco.
    prisma.auditFinding.groupBy({
      by: ["severidade", "categoria"],
      where: { companyId: ctx.companyId, status: { in: ["ABERTO", "EM_ANALISE"] } },
      _count: true,
    }),
    // Os dois cartões de dinheiro dos achados, somados NO BANCO — pelo mesmo
    // motivo que a contagem acima: a lista de `achados` para de propósito em
    // 200 linhas, e somar só elas dava um total que encolhia conforme a fila
    // crescia. É o mesmo defeito que o cartão "em aberto" já teve.
    prisma.auditFinding.aggregate({ where: { ...abertos, categoria: "OPORTUNIDADE" }, _sum: { impactoCents: true } }),
    prisma.auditFinding.aggregate({ where: { ...abertos, categoria: "PERDA_FINANCEIRA" }, _sum: { valorCents: true } }),
    // As maiores de cada um, para a abertura do cartão. Consulta própria
    // porque a ordenação é outra: aqui manda o valor, não a severidade.
    prisma.auditFinding.findMany({
      where: { ...abertos, categoria: "OPORTUNIDADE" },
      select: { id: true, titulo: true, impactoCents: true, conexaoApelido: true },
      orderBy: { impactoCents: "desc" },
      take: 6,
    }),
    prisma.auditFinding.findMany({
      where: { ...abertos, categoria: "PERDA_FINANCEIRA" },
      select: { id: true, titulo: true, valorCents: true, conexaoApelido: true },
      orderBy: { valorCents: "desc" },
      take: 6,
    }),
  ]);
  const totalEmAberto = contagemAchados.reduce((acc, g) => acc + g._count, 0);
  const totalCriticosAltos = contagemAchados
    .filter((g) => g.severidade === "CRITICA" || g.severidade === "ALTA")
    .reduce((acc, g) => acc + g._count, 0);
  const totalFraude = contagemAchados.filter((g) => g.categoria === "FRAUDE").reduce((acc, g) => acc + g._count, 0);
  // `finalizadoEm` quando existe: é o fim do ciclo, não o começo. Um ciclo que
  // começou e morreu no meio não torna a base atual, e usar `iniciadoEm` aqui
  // faria o cabeçalho dar por atualizado justamente o caso que ele existe para
  // mostrar.
  const ultimoSyncEm = ctx.ultimoSyncConcluido?.finalizadoEm ?? null;

  if (!qualidade.temTitulos) {
    return (
      <div className={larguraPainel}>
        <Cabecalho dataReferencia={ctx.dataReferencia} competencia={periodo.competencia} ultimoSync={ultimoSyncEm} />
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
  const economia = somaOportunidades._sum.impactoCents ?? 0;
  const perdas = somaPerdas._sum.valorCents ?? 0;

  // Abertura do cartão de achados: a mesma contagem do banco, quebrada nos
  // dois eixos que decidem por onde começar — quão grave, e de que tipo.
  const porSeveridade = new Map<string, number>();
  const porCategoria = new Map<string, number>();
  for (const g of contagemAchados) {
    porSeveridade.set(g.severidade, (porSeveridade.get(g.severidade) ?? 0) + g._count);
    porCategoria.set(g.categoria, (porCategoria.get(g.categoria) ?? 0) + g._count);
  }
  const ORDEM_SEVERIDADE = ["CRITICA", "ALTA", "MEDIA", "BAIXA", "INFO"];
  const saldos = saldoPorContaCents(ctx);

  // LINK PARA O DETALHAMENTO, preservando o recorte da tela.
  //
  // Empresa e competência viajam junto porque o detalhe TEM que ler o mesmo
  // recorte do cartão: abrir a fatia de setembro da Azul e cair no grupo
  // inteiro do mês corrente daria um total diferente do que estava na tela, e
  // é assim que se perde a confiança no painel. `volta` devolve a pessoa para
  // o painel no mesmo filtro em que ela estava.
  const recorte = new URLSearchParams();
  if (escopo.conexaoId) recorte.set("empresa", escopo.conexaoId);
  if (periodo.competencia) recorte.set("competencia", periodo.competencia);
  const voltaParaOPainel = recorte.size > 0 ? `/?${recorte}` : "/";

  const detalhe = (campos: Record<string, string>) => {
    const busca = new URLSearchParams({ ...Object.fromEntries(recorte), ...campos, volta: voltaParaOPainel });
    return `/detalhamento?${busca}`;
  };
  // "Outros (12)" é um resto, não um filtro: não há lista que corresponda
  // exatamente a ele, e um link que leva a outra coisa mente.
  const comLink = (fatias: ReturnType<typeof agruparComposicao>, natureza: "PAGAR" | "RECEBER", dimensao: "tipo" | "categoria") =>
    fatias.map((f) => ({
      ...f,
      href: /^Outros \(\d+\)$/.test(f.rotulo) ? undefined : detalhe({ fonte: "titulos", natureza, dimensao, valor: f.rotulo }),
    }));

  const ruptura = panorama.projecao.find((p) => p.saldoProjetadoCents < 0);

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <Cabecalho dataReferencia={ctx.dataReferencia} competencia={periodo.competencia} ultimoSync={ultimoSyncEm} />

      <Filtros
        conexoes={ctx.conexoes}
        empresaAtiva={escopo.conexaoId}
        competencias={competencias}
        competenciaAtiva={periodo.competencia}
        rota="/"
      />

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
        {/* Clicar abre a composição: por tipo de documento (CT-e, NFS-e,
            fatura...) e por categoria. "Receita" aqui é todo título a receber
            do mês, e a categoria é o que separa serviço prestado de aporte,
            empréstimo ou estorno — a pergunta "e outras receitas?" se responde
            ali. A composição completa, com conta e maiores títulos, está em
            Resultado mês a mês. */}
        <KpiExpansivel
          rotulo="Títulos a receber do mês"
          valor={fmtBRL(c.mesAtual.receitaCents)}
          apoio={`${c.mesAtual.titulosReceber} título(s) · ${fmtVariacao(c.variacoes.receitaMesVsAnterior)} vs. mês anterior · clique para abrir`}
          icone={<TrendingUp className="h-4 w-4" />}
        >
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Por tipo de documento</p>
          <Fatias fatias={comLink(agruparComposicao(receitaComp, "tipo", 6), "RECEBER", "tipo")} />
          <p className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Por categoria</p>
          <Fatias fatias={comLink(agruparComposicao(receitaComp, "categoria", 6), "RECEBER", "categoria")} />
          <Link href="/resultados" className="mt-3 block text-xs font-medium text-blue-700 hover:underline">
            Composição completa e maiores títulos →
          </Link>
        </KpiExpansivel>
        <KpiExpansivel
          rotulo="Títulos a pagar do mês"
          valor={fmtBRL(c.mesAtual.despesaCents)}
          apoio={`${c.mesAtual.titulosPagar} título(s) · ${fmtVariacao(c.variacoes.despesaMesVsAnterior)} vs. mês anterior · clique para abrir`}
          icone={<TrendingDown className="h-4 w-4" />}
        >
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Por categoria</p>
          <Fatias fatias={comLink(agruparComposicao(despesaComp, "categoria", 8), "PAGAR", "categoria")} />
          <p className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Por tipo de documento</p>
          <Fatias fatias={comLink(agruparComposicao(despesaComp, "tipo", 6), "PAGAR", "tipo")} />
          <Link href="/resultados" className="mt-3 block text-xs font-medium text-blue-700 hover:underline">
            Composição completa e maiores títulos →
          </Link>
        </KpiExpansivel>
        {/* A conta do mês, na ordem em que se lê: receita, menos despesa,
            igual a resultado — e o mesmo do mês anterior embaixo, porque
            "R$ 1,7 milhão" só quer dizer alguma coisa ao lado do mês que
            passou. */}
        <KpiExpansivel
          rotulo="Resultado do mês"
          valor={fmtBRL(c.mesAtual.resultadoCents)}
          apoio={`Margem ${fmtPercent(c.mesAtual.margemPercent)} · clique para abrir`}
          tom={c.mesAtual.resultadoCents >= 0 ? "bom" : "ruim"}
        >
          <LinhasDeValor
            linhas={[
              {
                rotulo: "Receita do mês",
                valor: fmtBRL(c.mesAtual.receitaCents),
                href: detalhe({ fonte: "titulos", natureza: "RECEBER" }),
              },
              {
                rotulo: "(−) Despesa do mês",
                valor: fmtBRL(c.mesAtual.despesaCents),
                href: detalhe({ fonte: "titulos", natureza: "PAGAR" }),
              },
              {
                rotulo: "= Resultado",
                valor: fmtBRL(c.mesAtual.resultadoCents),
                destaque: true,
                tom: c.mesAtual.resultadoCents >= 0 ? "bom" : "ruim",
              },
              {
                rotulo: "Mês anterior",
                valor: fmtBRL(c.mesAnterior.resultadoCents),
                detalhe: `Margem ${fmtPercent(c.mesAnterior.margemPercent)} · ${fmtVariacao(c.variacoes.receitaMesVsAnterior)} de receita`,
                tom: c.mesAnterior.resultadoCents >= 0 ? "bom" : "ruim",
              },
              {
                rotulo: "Mesmo mês do ano passado",
                valor: fmtBRL(c.mesmoMesAnoAnterior.resultadoCents),
                detalhe: `Margem ${fmtPercent(c.mesmoMesAnoAnterior.margemPercent)}`,
                tom: c.mesmoMesAnoAnterior.resultadoCents >= 0 ? "bom" : "ruim",
              },
            ]}
          />
          <Link href="/resultados" className="mt-3 block text-xs font-medium text-blue-700 hover:underline">
            DRE completo, mês a mês →
          </Link>
        </KpiExpansivel>
        {/* Saldo conta a conta. O total do cartão é a soma exata destas linhas
            (ver saldoPorContaCents), inclusive quando uma delas é negativa —
            é justamente a conta no vermelho que precisa aparecer. */}
        <KpiExpansivel
          rotulo="Saldo em caixa"
          valor={fmtBRL(panorama.saldoAtualCents)}
          apoio={`A pagar em aberto ${fmtBRL(panorama.aPagarEmAbertoCents)} · clique para abrir`}
          tom={panorama.saldoAtualCents >= 0 ? "neutro" : "ruim"}
          icone={<Banknote className="h-4 w-4" />}
        >
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Por conta</p>
          <LinhasDeValor
            vazio="Nenhuma conta com saldo. Sem extrato bancário espelhado, o saldo vem só do saldo inicial cadastrado."
            linhas={saldos.map((l) => ({
              rotulo: l.conta,
              valor: fmtBRL(l.saldoCents),
              detalhe: `${l.empresa}${l.inativa ? " · conta inativa" : ""}`,
              tom: l.saldoCents < 0 ? ("ruim" as const) : ("neutro" as const),
              href: l.chave ? detalhe({ fonte: "caixa", conta: l.chave }) : undefined,
            }))}
          />
          <Link href="/fluxo-caixa" className="mt-3 block text-xs font-medium text-blue-700 hover:underline">
            Projeção de caixa e conciliação →
          </Link>
        </KpiExpansivel>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* As quatro perdas são partes de um todo, então aqui a barra de
            participação diz alguma coisa: ela aponta qual delas atacar. */}
        <KpiExpansivel
          rotulo="Perdas do mês"
          valor={fmtBRL(c.mesAtual.perdaTotalCents)}
          apoio="Juros, multa, tarifa e desconto concedido · clique para abrir"
          tom={c.mesAtual.perdaTotalCents > 0 ? "ruim" : "bom"}
        >
          <Fatias
            vazio="Nenhuma perda no mês."
            fatias={[
              { rotulo: "Juros por atraso", valorCents: c.mesAtual.jurosCents, parte: "juros" },
              { rotulo: "Multa por atraso", valorCents: c.mesAtual.multaCents, parte: "multa" },
              { rotulo: "Tarifa bancária", valorCents: c.mesAtual.tarifaCents, parte: "tarifa" },
              { rotulo: "Desconto concedido a cliente", valorCents: c.mesAtual.descontoCents, parte: "desconto" },
            ]
              .filter((l) => l.valorCents > 0)
              .map(({ parte, ...l }) => ({
                ...l,
                quantidade: 0,
                participacaoPercent:
                  c.mesAtual.perdaTotalCents > 0 ? (l.valorCents / c.mesAtual.perdaTotalCents) * 100 : 0,
                href: detalhe({ fonte: "perda", parte }),
              }))}
          />
          <p className="mt-3 text-[11px] text-slate-500">
            Dinheiro que saiu sem comprar nada. Juros e multa são prazo perdido; tarifa é preço de conta; desconto
            concedido é margem entregue na baixa.
          </p>
        </KpiExpansivel>
        <KpiExpansivel
          rotulo="Economia identificada"
          valor={fmtBRL(economia)}
          apoio="Impacto anual estimado das oportunidades · clique para abrir"
          tom={economia > 0 ? "bom" : "neutro"}
          icone={<Lightbulb className="h-4 w-4" />}
        >
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Maiores oportunidades</p>
          <LinhasDeValor
            vazio="Nenhuma oportunidade em aberto."
            linhas={maioresOportunidades.map((a) => ({
              rotulo: a.titulo,
              valor: fmtBRL(a.impactoCents ?? 0),
              detalhe: a.conexaoApelido ?? "grupo",
              tom: "bom" as const,
              href: `/auditoria?achado=${a.id}`,
            }))}
          />
          <Link
            href="/auditoria?categoria=OPORTUNIDADE"
            className="mt-3 block text-xs font-medium text-blue-700 hover:underline"
          >
            Todas as oportunidades →
          </Link>
        </KpiExpansivel>
        {/* Contagem, não dinheiro: por isso linhas e não fatias com barra. Os
            dois eixos respondem a perguntas diferentes — "quão grave" decide a
            ordem de ataque, "de que tipo" decide quem trata. */}
        <KpiExpansivel
          rotulo="Achados em aberto"
          valor={fmtNumero(totalEmAberto)}
          apoio={`${fmtNumero(totalCriticosAltos)} crítico(s)/alto(s) · ${fmtNumero(totalFraude)} indício(s) de fraude · clique para abrir`}
          tom={totalCriticosAltos > 0 ? "atencao" : "bom"}
          icone={<AlertTriangle className="h-4 w-4" />}
        >
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Por severidade</p>
          <LinhasDeValor
            linhas={ORDEM_SEVERIDADE.filter((sev) => (porSeveridade.get(sev) ?? 0) > 0).map((sev) => ({
              rotulo: rotuloSeveridade(sev),
              valor: fmtNumero(porSeveridade.get(sev) ?? 0),
              href: `/auditoria?severidade=${sev}`,
            }))}
          />
          <p className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Por tipo</p>
          <LinhasDeValor
            linhas={[...porCategoria.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([cat, n]) => ({
                rotulo: rotuloCategoria(cat),
                valor: fmtNumero(n),
                href: `/auditoria?categoria=${cat}`,
              }))}
          />
          <Link href="/auditoria" className="mt-3 block text-xs font-medium text-blue-700 hover:underline">
            Abrir a triagem →
          </Link>
        </KpiExpansivel>
        <KpiExpansivel
          rotulo="Perdas apontadas"
          valor={fmtBRL(perdas)}
          apoio="Soma dos achados de perda em aberto · clique para abrir"
          tom={perdas > 0 ? "atencao" : "bom"}
        >
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Maiores perdas</p>
          <LinhasDeValor
            vazio="Nenhuma perda apontada em aberto."
            linhas={maioresPerdas.map((a) => ({
              rotulo: a.titulo,
              valor: fmtBRL(a.valorCents ?? 0),
              detalhe: a.conexaoApelido ?? "grupo",
              tom: "ruim" as const,
              href: `/auditoria?achado=${a.id}`,
            }))}
          />
          <Link
            href="/auditoria?categoria=PERDA_FINANCEIRA"
            className="mt-3 block text-xs font-medium text-blue-700 hover:underline"
          >
            Todas as perdas apontadas →
          </Link>
        </KpiExpansivel>
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

// O subtítulo muda conforme a leitura, e isso não é cosmético.
//
// Um painel de competência passada exibindo "(D-1)" convidaria alguém a ler os
// números de março como se fossem de hoje. A data de referência precisa dizer
// em voz alta que recorte está na tela.
// A DATA DO CABEÇALHO ERA UMA PROMESSA, NÃO UM FATO.
//
// "dados de 22/09 (D-1)" é conta de relógio: D-1 de agora, sempre, tenha o
// ciclo rodado ou não. Quando o ciclo falha, a frase continua idêntica e o
// painel segue afirmando uma atualidade que ninguém conferiu — e o aviso de
// base desatualizada só aparecia depois de TRÊS dias parado.
//
// Agora o cabeçalho diz as duas coisas: a referência pedida e quando o ciclo
// de fato terminou. Quando a segunda não cobre a primeira, isso fica escrito
// aqui, com o caminho para resolver ao lado — é a primeira linha da tela, que
// é onde a pergunta "isto está atualizado?" nasce.
function Cabecalho({
  dataReferencia,
  competencia,
  ultimoSync,
}: {
  dataReferencia: Date;
  competencia: string | null;
  ultimoSync: Date | null;
}) {
  // O ciclo da referência D roda em D+1. A base cobre D quando a última
  // execução concluída terminou depois da virada de D+1.
  const cobre = ultimoSync !== null && ultimoSync >= somarDias(inicioDoDia(dataReferencia), 1);

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Controladoria</h1>
      <p className="mt-1 text-sm text-slate-500">
        Painel financeiro consolidado a partir da Omie e da operação —{" "}
        {competencia
          ? `competência ${rotuloCompetencia(dataReferencia)}, fechada em ${fmtData(dataReferencia)}.`
          : `dados de ${fmtData(dataReferencia)} (D-1).`}
      </p>
      {cobre ? (
        <p className="mt-1 text-xs text-slate-400">
          Última sincronização concluída em {fmtDataHora(ultimoSync)}.
        </p>
      ) : (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <strong>A base ainda não tem {fmtData(dataReferencia)}.</strong>{" "}
          {ultimoSync
            ? `O último ciclo concluído terminou em ${fmtDataHora(ultimoSync)}, antes desta referência — os números abaixo são os da leitura anterior.`
            : "Nenhum ciclo concluído foi registrado — os números abaixo podem não refletir a Omie."}{" "}
          <Link href="/sincronizacao" className="font-medium underline">
            Sincronizar agora
          </Link>
          .
        </p>
      )}
    </div>
  );
}
