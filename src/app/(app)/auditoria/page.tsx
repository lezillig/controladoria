import Link from "next/link";
import type { AuditCategoria, AuditSeveridade, AuditStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fmtBRL, fmtData, fmtNumero, fmtPercent } from "@/lib/controladoria/format";
import { AGENTES } from "@/lib/controladoria/registry";
import { exigirPermissao, podeAcao } from "../_dados";
import { AvisoVazio, BadgeCategoria, BadgeSeveridade, Secao, Tabela } from "../_componentes";
import TratativaForm from "./TratativaForm";
import { larguraPainel } from "@/lib/ui";

// AUDITORIA — a lista de achados e a tratativa de cada um.
//
// Filtros por querystring (e não por estado no cliente) de propósito: o link
// da tela filtrada é compartilhável — "olha os 3 indícios de fraude em aberto"
// vira uma URL que o outro abre e vê exatamente a mesma coisa.

type Filtros = { status?: string; severidade?: string; categoria?: string; agente?: string; achado?: string; regra?: string };

const SEVERIDADES: AuditSeveridade[] = ["CRITICA", "ALTA", "MEDIA", "BAIXA", "INFO"];
const CATEGORIAS: AuditCategoria[] = [
  "FRAUDE",
  "ERRO_PROCESSO",
  "PERDA_FINANCEIRA",
  "RISCO_FINANCEIRO",
  "CONFORMIDADE",
  "OPORTUNIDADE",
];

const STATUS_ROTULO: Record<string, string> = {
  ABERTO: "Aberto",
  EM_ANALISE: "Em análise",
  RESOLVIDO: "Resolvido",
  IGNORADO: "Não se aplica",
  OBSOLETO: "Encerrado automaticamente",
};

export default async function AuditoriaPage({ searchParams }: { searchParams: Promise<Filtros> }) {
  const session = await exigirPermissao("auditoria");
  const filtros = await searchParams;
  const podeTratar = await podeAcao(session, "tratar-achado");

  const statusFiltro = filtros.status ?? "ABERTOS";
  const where: Prisma.AuditFindingWhereInput = {
    companyId: session.companyId,
    ...(statusFiltro === "ABERTOS"
      ? { status: { in: ["ABERTO", "EM_ANALISE"] } }
      : statusFiltro === "TODOS"
        ? {}
        : { status: statusFiltro as AuditStatus }),
    // Filtros vindos da URL são validados contra o enum antes de virar
    // consulta: um valor inventado na querystring não pode derrubar a página
    // com erro do Prisma — simplesmente não filtra.
    ...(SEVERIDADES.includes(filtros.severidade as AuditSeveridade)
      ? { severidade: filtros.severidade as AuditSeveridade }
      : {}),
    ...(CATEGORIAS.includes(filtros.categoria as AuditCategoria)
      ? { categoria: filtros.categoria as AuditCategoria }
      : {}),
    ...(filtros.agente ? { agente: filtros.agente } : {}),
    // Código de regra é texto livre no modelo, então o filtro é por igualdade
    // exata: valor inventado na URL não acha nada, que é o comportamento certo
    // — melhor lista vazia que lista errada numa tela de auditoria.
    ...(filtros.regra ? { regra: filtros.regra } : {}),
  };

  const [achados, contagens, porRegra] = await Promise.all([
    prisma.auditFinding.findMany({
      where,
      orderBy: [{ severidade: "asc" }, { impactoCents: "desc" }, { detectadoEm: "desc" }],
      take: 300,
    }),
    prisma.auditFinding.groupBy({
      by: ["categoria"],
      where: { companyId: session.companyId, status: { in: ["ABERTO", "EM_ANALISE"] } },
      _count: true,
      _sum: { impactoCents: true },
    }),
    // POR REGRA, e não só por categoria.
    //
    // Categoria responde "que tipo de problema", que é a pergunta de quem vai
    // TRATAR. Regra responde "de onde vêm estes milhares", que é a pergunta de
    // quem precisa decidir se a lista é confiável — e sem ela, uma regra mal
    // calibrada afoga todas as outras sem deixar rastro de qual é.
    //
    // Foi o que aconteceu ao carregar cinco anos de base: 4.145 achados em
    // aberto, e nenhuma forma de ver na tela que a maior parte vinha de uma ou
    // duas regras. Uma lista que ninguém consegue triar é, na prática, uma
    // lista vazia.
    prisma.auditFinding.groupBy({
      by: ["regra"],
      where: { companyId: session.companyId, status: { in: ["ABERTO", "EM_ANALISE"] } },
      _count: true,
      _sum: { impactoCents: true },
      orderBy: { _count: { regra: "desc" } },
      take: 20,
    }),
  ]);

  const totalEmAberto = contagens.reduce((acc, c) => acc + c._count, 0);

  const totalImpacto = achados.reduce((acc, a) => acc + (a.impactoCents ?? 0), 0);
  const agentesComAchado = new Set(achados.map((a) => a.agente));

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Auditoria e achados</h1>
        <p className="mt-1 text-sm text-slate-500">
          Cada achado traz a evidência que o originou, o valor em jogo e o que fazer. São indícios que exigem verificação —
          não conclusões.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {contagens.map((c) => (
          <Link
            key={c.categoria}
            href={`/auditoria?categoria=${c.categoria}`}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 hover:border-blue-300"
          >
            <span className="block text-xs text-slate-500">{c.categoria.replace(/_/g, " ").toLowerCase()}</span>
            <span className="text-sm font-semibold text-slate-900">{c._count}</span>
            {c._sum.impactoCents ? (
              <span className="ml-2 text-xs text-emerald-700">{fmtBRL(c._sum.impactoCents)}</span>
            ) : null}
          </Link>
        ))}
      </div>

      <Secao
        titulo={`${achados.length} achado(s)`}
        descricao={totalImpacto > 0 ? `Impacto estimado somado: ${fmtBRL(totalImpacto)}` : undefined}
        acao={
          <div className="flex flex-wrap gap-1 text-xs">
            <FiltroLink rotulo="Em aberto" href="/auditoria" ativo={statusFiltro === "ABERTOS" && !filtros.categoria && !filtros.agente} />
            <FiltroLink rotulo="Resolvidos" href="/auditoria?status=RESOLVIDO" ativo={statusFiltro === "RESOLVIDO"} />
            <FiltroLink rotulo="Não se aplica" href="/auditoria?status=IGNORADO" ativo={statusFiltro === "IGNORADO"} />
            <FiltroLink rotulo="Todos" href="/auditoria?status=TODOS" ativo={statusFiltro === "TODOS"} />
          </div>
        }
      >
        {achados.length === 0 ? (
          <AvisoVazio
            titulo="Nenhum achado com esses filtros"
            descricao="Ou a auditoria ainda não rodou, ou não há nada apontado nesta categoria. A auditoria roda todo dia junto com a sincronização."
            acaoHref="/sincronizacao"
            acaoLabel="Ver a sincronização"
          />
        ) : (
          <ul className="space-y-4">
            {achados.map((a) => {
              const agente = AGENTES.find((x) => x.id === a.agente);
              return (
                <li
                  key={a.id}
                  id={a.id}
                  className={`rounded-xl border p-4 ${
                    filtros.achado === a.id ? "border-blue-400 bg-blue-50/40" : "border-slate-200"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <BadgeSeveridade severidade={a.severidade} />
                    <BadgeCategoria categoria={a.categoria} />
                    {a.status !== "ABERTO" && (
                      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                        {STATUS_ROTULO[a.status] ?? a.status}
                      </span>
                    )}
                    {a.confianca < 100 && (
                      <span className="text-xs text-slate-500">confiança {a.confianca}%</span>
                    )}
                  </div>

                  <h3 className="mt-2 text-sm font-semibold text-slate-900">{a.titulo}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-slate-600">{a.descricao}</p>

                  {(a.valorCents !== null || a.impactoCents !== null) && (
                    <p className="mt-2 text-sm font-medium text-slate-800">
                      {a.valorCents !== null && `Valor envolvido: ${fmtBRL(a.valorCents)}`}
                      {a.valorCents !== null && a.impactoCents !== null && " · "}
                      {a.impactoCents !== null && (
                        <span className="text-emerald-700">Impacto estimado: {fmtBRL(a.impactoCents)}</span>
                      )}
                    </p>
                  )}

                  {a.recomendacao && (
                    <div className="mt-3 rounded-lg bg-slate-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">O que fazer</p>
                      <p className="mt-1 text-sm leading-relaxed text-slate-700">{a.recomendacao}</p>
                    </div>
                  )}

                  {a.notaSupervisor && (
                    <p className="mt-2 text-xs italic text-slate-500">Revisão do supervisor: {a.notaSupervisor}</p>
                  )}

                  {a.observacaoTratativa && (
                    <p className="mt-2 rounded-lg bg-emerald-50 p-2 text-xs text-emerald-900">
                      Tratativa registrada: {a.observacaoTratativa}
                    </p>
                  )}

                  <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
                    <span>{agente?.nome ?? a.agente}</span>
                    <span>regra {a.regra}</span>
                    <span>detectado em {fmtData(a.detectadoEm)}</span>
                    {a.ocorrencias > 1 && <span>{fmtNumero(a.ocorrencias)} execuções seguidas</span>}
                    {a.entidadeRef && <span>{a.entidadeRef}</span>}
                    {agente && <span>responsável: {agente.area}</span>}
                  </p>

                  {podeTratar && (
                    <TratativaForm achadoId={a.id} statusAtual={a.status} observacaoAtual={a.observacaoTratativa} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Secao>

      {porRegra.length > 0 && (
        <Secao
          titulo="Concentração por regra"
          descricao={
            `${fmtNumero(totalEmAberto)} achado(s) em aberto. Quando poucas regras respondem pela maior parte da lista, ` +
            "o problema costuma ser de calibragem — e uma lista que ninguém consegue triar informa tanto quanto uma lista vazia."
          }
        >
          <Tabela
            colunas={["Regra", "Achados", "% do total", "Valor em jogo", ""]}
            alinharDireita={[1, 2, 3]}
            linhas={porRegra.map((r) => [
              <span key="r" className="font-mono text-xs text-slate-700">
                {r.regra}
              </span>,
              fmtNumero(r._count),
              fmtPercent(totalEmAberto > 0 ? (r._count / totalEmAberto) * 100 : 0),
              r._sum.impactoCents ? fmtBRL(r._sum.impactoCents) : "—",
              <Link
                key="v"
                href={`/auditoria?regra=${encodeURIComponent(r.regra)}`}
                className="text-xs font-medium text-blue-700 hover:underline"
              >
                ver
              </Link>,
            ])}
          />
        </Secao>
      )}

      <Secao titulo="Agentes" descricao="Quem audita o quê. Cada achado aponta para o agente e a regra que o gerou.">
        <ul className="space-y-2">
          {AGENTES.map((a) => (
            <li key={a.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-slate-900">{a.nome}</span>
                <span className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5">{a.area}</span>
                  {agentesComAchado.has(a.id) && (
                    <Link href={`/auditoria?agente=${a.id}`} className="font-medium text-blue-700 hover:underline">
                      ver achados
                    </Link>
                  )}
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">{a.descricao}</p>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-slate-500">
          Antes de qualquer achado chegar aqui, um supervisor revisa o conjunto: suprime o que depende de dado ausente,
          consolida o que dois agentes apontaram pelo mesmo motivo, respeita tratativa anterior e calibra a severidade.
          Quando ele intervém, a nota aparece junto do achado.
        </p>
      </Secao>
    </div>
  );
}

function FiltroLink({ rotulo, href, ativo }: { rotulo: string; href: string; ativo: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1 font-medium ${
        ativo ? "bg-blue-700 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
      }`}
    >
      {rotulo}
    </Link>
  );
}
