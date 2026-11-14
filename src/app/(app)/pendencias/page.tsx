import { prisma } from "@/lib/prisma";
import { podeDecidir } from "@/lib/auditoria/pendencias";
import { fmtData, fmtNumero } from "@/lib/controladoria/format";
import { larguraPainel } from "@/lib/ui";
import { acessoDaSessao, exigirPermissao } from "../_dados";
import { Kpi, Secao } from "../_componentes";
import { decidir } from "./actions";
import Link from "next/link";
import { saudeDoAgenteDeFinanciamentos } from "@/lib/frota/saudeDoAgente";

// PENDÊNCIAS — a fila única de decisões da plataforma (ADR-005): o que agentes
// e cargas propõem e uma pessoa do perfil aprovador aprova ou rejeita. É a
// tela mais importante do sistema: nada financeiro ou trabalhista executa
// sem passar por aqui.

const COR: Record<string, string> = { critica: "bg-red-100 text-red-800", alta: "bg-orange-100 text-orange-800", media: "bg-amber-100 text-amber-800", baixa: "bg-slate-100 text-slate-700" };
// "aprovada" sem "executada": nenhum tipo de pendência desta base tem executor
// (src/lib/auditoria/executores.ts) — aprovar registra a decisão e quem a
// tomou, e não lança nada na Omie. Dito na linha, para a aprovação não
// parecer que algo foi feito.
const STATUS: Record<string, string> = { aguardando_aprovacao: "aguardando", aprovada: "aprovada (decisão registrada; nada foi lançado na Omie)", rejeitada: "rejeitada", executada: "executada", erro: "erro" };

// O recorte que os cartões abrem na lista: uma severidade ou "as que você decide".
const RECORTES: Record<string, string> = { critica: "severidade crítica", alta: "severidade alta", minhas: "que você pode decidir" };

export default async function PendenciasPage({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const { ver: verParam } = await searchParams;
  const ver = verParam && Object.hasOwn(RECORTES, verParam) ? verParam : null;
  const session = await exigirPermissao("pendencias");
  const acesso = await acessoDaSessao(session);
  const temPermissao = acesso.permissoes.has("decidir-pendencia");
  const perfis = acesso.perfilNome ? [acesso.perfilNome] : [];
  const [abertas, decididas, agente] = await Promise.all([
    prisma.audPendencia.findMany({ where: { companyId: session.companyId, status: "aguardando_aprovacao" }, orderBy: [{ criadaEm: "asc" }], take: 200 }),
    prisma.audPendencia.findMany({ where: { companyId: session.companyId, status: { not: "aguardando_aprovacao" } }, orderBy: { decididaEm: "desc" }, take: 30 }),
    // Quem alimenta esta fila todo dia. Parado, a fila vazia não quer dizer
    // "tudo em dia" (ver saudeDoAgente.ts).
    saudeDoAgenteDeFinanciamentos(session.companyId),
  ]);
  const ordem = ["critica", "alta", "media", "baixa"];
  abertas.sort((a, b) => ordem.indexOf(a.severidade) - ordem.indexOf(b.severidade));
  const decidePor = (p: (typeof abertas)[number]) => podeDecidir({ papel: session.role, temPermissao, perfis, perfilAprovador: p.perfilAprovador });
  const lista = ver === "minhas" ? abertas.filter(decidePor) : ver ? abertas.filter((p) => p.severidade === ver) : abertas;

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Pendências</h1>
        <p className="mt-1 max-w-4xl text-sm text-slate-500">
          O que os agentes e as cargas propõem e precisa de uma pessoa: cada pendência tem o perfil que decide, as evidências e a ação proposta. Aprovar ou rejeitar fica na trilha de
          auditoria, com quem decidiu e o comentário.
        </p>
      </div>
      {agente.parado && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">
            O agente dos financiamentos {agente.ultimaConclusao ? `não conclui desde ${fmtData(agente.ultimaConclusao)}` : "ainda não concluiu nenhuma vez"}: a fila abaixo pode estar vazia por isso, e não
            por estar tudo em dia.
          </p>
          <p className="mt-1">
            É ele que traz para cá, todo dia, a parcela em atraso e a parcela que deveria estar lançada na Omie. Para isso lê os contratos na gestão
            {agente.motivo ? " — e hoje essa leitura falha:" : "; a gestão responde agora, então ele volta a rodar no próximo ciclo diário (Sincronização)."}
          </p>
          {agente.motivo && (
            <>
              <p className="mt-2 font-medium">{agente.motivo.titulo}</p>
              <p className="mt-0.5">{agente.motivo.texto}</p>
              {agente.motivo.sql && <pre className="mt-2 overflow-x-auto rounded-md bg-slate-900 px-3 py-2 text-xs text-slate-100">{agente.motivo.sql}</pre>}
            </>
          )}
          <p className="mt-2">
            <Link href="/frota/financiamentos" className="font-medium text-blue-800 underline">
              Abrir Financiamentos e consórcios
            </Link>
          </p>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-4">
        <Kpi rotulo="Aguardando decisão" valor={fmtNumero(abertas.length)} tom={abertas.length || agente.parado ? "atencao" : "bom"} href="/pendencias#aguardando" />
        {["critica", "alta"].map((s) => (
          <Kpi
            key={s}
            rotulo={`Severidade ${s}`}
            valor={fmtNumero(abertas.filter((p) => p.severidade === s).length)}
            tom={abertas.some((p) => p.severidade === s) ? "ruim" : "bom"}
            href={`/pendencias?ver=${s}#aguardando`}
          />
        ))}
        <Kpi rotulo="Que você pode decidir" valor={fmtNumero(abertas.filter(decidePor).length)} href="/pendencias?ver=minhas#aguardando" />
      </div>

      <Secao
        id="aguardando"
        titulo={ver ? `Aguardando decisão — ${RECORTES[ver]}` : "Aguardando decisão"}
        acao={
          ver ? (
            <a href="/pendencias#aguardando" className="text-xs text-blue-700 hover:underline">
              Ver todas
            </a>
          ) : undefined
        }
      >
        {lista.length === 0 ? (
          <p className="text-sm text-slate-500">
            {ver ? "Nenhuma pendência aberta neste recorte." : "Nenhuma pendência aberta."}
            {!ver && " Chegam aqui as parcelas de financiamento em atraso ou não lançadas (todo dia) e os centros de custo a criar na Omie (na carga do cadastro). Veículos, motoristas e multas são decididos no sistema de gestão; os achados da auditoria ficam em Auditoria."}
          </p>
        ) : (
          <ul className="space-y-3">
            {lista.map((p) => {
              const pode = decidePor(p);
              const ev = p.evidencias as { codigos?: string[]; total?: number } | null;
              return (
                <li key={p.id} className="rounded-md border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${COR[p.severidade] ?? COR.baixa}`}>{p.severidade}</span>
                    <span className="text-sm font-semibold text-slate-900">{p.titulo}</span>
                    <span className="text-xs text-slate-500">· decide: {p.perfilAprovador} · {p.agente ?? "manual"} · desde {fmtData(p.criadaEm)}</span>
                  </div>
                  {p.descricao && <p className="mt-1 text-xs text-slate-600">{p.descricao}</p>}
                  {ev && (
                    <details className="mt-1 text-xs text-slate-600">
                      <summary className="cursor-pointer">Evidências{ev.total ? ` (${fmtNumero(ev.total)})` : ""}</summary>
                      <p className="mt-1 font-mono">{Array.isArray(ev.codigos) ? ev.codigos.join(", ") : JSON.stringify(ev).slice(0, 2000)}</p>
                    </details>
                  )}
                  {pode ? (
                    <form action={decidir} className="mt-2 flex flex-wrap items-center gap-2">
                      <input type="hidden" name="id" value={p.id} />
                      <input name="comentario" placeholder="Comentário (obrigatório para rejeitar)" className="min-w-64 flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs" />
                      <button name="decisao" value="aprovada" className="rounded-md bg-emerald-700 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-600">Aprovar</button>
                      <button name="decisao" value="rejeitada" className="rounded-md bg-red-700 px-3 py-1 text-xs font-semibold text-white hover:bg-red-600">Rejeitar</button>
                    </form>
                  ) : (
                    <p className="mt-2 text-xs text-slate-400">Só o perfil {p.perfilAprovador} (ou um administrador) decide esta.</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Secao>

      {decididas.length > 0 && (
        <Secao titulo="Decididas recentemente">
          <ul className="space-y-1 text-xs text-slate-700">
            {decididas.map((p) => (
              <li key={p.id}>
                <span className="font-medium">{STATUS[p.status] ?? p.status}</span> · {p.titulo} · {p.decididaPor ?? "—"} em {p.decididaEm ? fmtData(p.decididaEm) : "—"}
                {p.comentario ? ` — “${p.comentario}”` : ""}
              </li>
            ))}
          </ul>
        </Secao>
      )}
    </div>
  );
}
