import Link from "next/link";
import { ETAPAS, ROTULO_STATUS, chaveCompetencia, lerCompetencia, rotuloCompetencia, somarMeses, type LinhaDoChecklist, type Status } from "@/lib/controladoria/fechamentoFolha";
import { alertasDaFolha, checklistDaFolha } from "@/lib/controladoria/fechamentoFolhaNoBanco";
import { fmtBRL, fmtData } from "@/lib/controladoria/format";
import { badgeClass, larguraPainel } from "@/lib/ui";
import { exigirPermissao, podeAcao } from "../_dados";
import { Kpi, Secao } from "../_componentes";
import { marcarItemDaFolha } from "./actions";

// FECHAMENTO DA FOLHA — o fluxograma validado pelo RH e pela Contabilidade
// como checklist mensal, por empresa. Prazos e conferência pela Omie em
// src/lib/controladoria/fechamentoFolha.ts.

const COR: Record<Status, string> = {
  feito: "bg-emerald-100 text-emerald-800",
  "omie-ok": "bg-emerald-100 text-emerald-800",
  "omie-atraso": "bg-amber-100 text-amber-800",
  atrasado: "bg-red-100 text-red-800",
  "vence-logo": "bg-amber-100 text-amber-800",
  pendente: "bg-slate-100 text-slate-700",
  futuro: "bg-slate-50 text-slate-500",
  "sem-prazo": "bg-slate-50 text-slate-500",
};
const FONTE: Record<string, string> = { fluxograma: "fluxograma", "legislação": "prazo legal", sistema: "antes do pagamento" };
const resolvido = (s: Status) => s === "feito" || s === "omie-ok" || s === "omie-atraso";

export default async function FolhaPage({ searchParams }: { searchParams: Promise<{ competencia?: string }> }) {
  const params = await searchParams;
  const session = await exigirPermissao("folha");
  const podeMarcar = await podeAcao(session, "marcar-folha");
  const hoje = new Date();
  const atual = { ano: hoje.getUTCFullYear(), mes: hoje.getUTCMonth() + 1 };
  const c = lerCompetencia(params.competencia) ?? atual;
  const [{ conexoes, linhas }, alertas] = await Promise.all([checklistDaFolha({ companyId: session.companyId, competencia: c, hoje }), alertasDaFolha(session.companyId, hoje)]);
  const deOutras = alertas.filter((a) => chaveCompetencia(a.competencia) !== chaveCompetencia(c));
  const opcoes = [-5, -4, -3, -2, -1, 0, 1].map((n) => somarMeses(atual, n));

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Fechamento da folha</h1>
        <p className="mt-1 max-w-4xl text-sm text-slate-500">
          O fluxograma validado pelo RH e pela Contabilidade, mês a mês e por empresa: cada prazo com quem marcou e quando. Os pagamentos (VT/VA/VR, plano de
          saúde, salários, INSS, FGTS, IRRF) se conferem sozinhos pelos títulos pagos na Omie. Os prazos de pagamento de salário e de encargos, que o
          fluxograma não traz, são os legais.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-slate-500">Folha de:</span>
        {opcoes.map((o) => (
          <Link
            key={chaveCompetencia(o)}
            href={`/folha?competencia=${chaveCompetencia(o)}`}
            className={`rounded-full px-3 py-1 text-xs font-medium ${chaveCompetencia(o) === chaveCompetencia(c) ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            {rotuloCompetencia(o)}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {conexoes.map((cx, i) => {
          const st = linhas.map((l) => l.porEmpresa[i].status);
          const atrasados = st.filter((s) => s === "atrasado").length;
          return (
            <Kpi
              key={cx.id}
              rotulo={`${cx.apelido} · ${rotuloCompetencia(c)}`}
              valor={`${st.filter(resolvido).length} de ${st.length}`}
              apoio={`${atrasados} atrasado(s) · ${st.filter((s) => s === "vence-logo").length} vencendo`}
              tom={atrasados ? "ruim" : "neutro"}
              href="#checklist"
            />
          );
        })}
      </div>

      {deOutras.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <p className="font-medium">Pendências de outras competências</p>
          <ul className="mt-1 space-y-0.5 text-xs">
            {deOutras.map((a, i) => (
              <li key={i}>
                <Link href={`/folha?competencia=${chaveCompetencia(a.competencia)}`} className="hover:underline">
                  {a.status === "atrasado" ? "Atrasado" : "Vence logo"}: {a.titulo} — {a.empresa}, folha de {rotuloCompetencia(a.competencia)}, prazo {fmtData(a.prazo)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* O checklist das seis etapas: o que cada cartão de empresa conta. */}
      <div id="checklist" className="scroll-mt-4 space-y-6">
      {([1, 2, 3, 4, 5, 6] as const).map((etapa) => (
        <Secao key={etapa} titulo={`${etapa} · ${ETAPAS[etapa].nome}`} descricao={ETAPAS[etapa].pratica}>
          <div className="divide-y divide-slate-100">
            {linhas
              .filter((l) => l.item.etapa === etapa)
              .map((l) => (
                <Linha key={l.item.chave} l={l} conexoes={conexoes} competencia={chaveCompetencia(c)} podeMarcar={podeMarcar} />
              ))}
          </div>
        </Secao>
      ))}
      </div>
    </div>
  );
}

function Linha({ l, conexoes, competencia, podeMarcar }: { l: LinhaDoChecklist; conexoes: { id: string; apelido: string }[]; competencia: string; podeMarcar: boolean }) {
  return (
    <div className="grid gap-3 py-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)]">
      <div>
        <p className="text-sm font-medium text-slate-900">{l.titulo}</p>
        <p className="mt-0.5 text-xs text-slate-500">{l.item.descricao}</p>
        <p className="mt-1 text-xs text-slate-600">
          <span className="font-medium">{l.prazo.ate ? `Prazo ${fmtData(l.prazo.ate)}` : "Sem prazo"}</span> · {l.prazo.texto} · {l.item.responsavel} ·{" "}
          <span className="text-slate-400">{FONTE[l.item.fonte]}</span>
          {l.item.link && (
            <>
              {" · "}
              <Link href={l.item.link.href} className="text-blue-700 hover:underline">
                {l.item.link.rotulo}
              </Link>
            </>
          )}
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {l.porEmpresa.map((e) => {
          const nome = conexoes.find((x) => x.id === e.conexaoId)?.apelido ?? "?";
          return (
            <div key={e.conexaoId} className="rounded-lg border border-slate-200 p-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-slate-700">{nome}</span>
                <span className={`${badgeClass} ${COR[e.status]}`}>{ROTULO_STATUS[e.status]}</span>
              </div>
              {e.marca && (
                <p className="mt-1 text-slate-500">
                  {e.marca.feitoPor ?? "—"} em {fmtData(e.marca.feitoEm)}
                  {e.marca.observacao ? ` · ${e.marca.observacao}` : ""}
                </p>
              )}
              {e.evidencia && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-slate-500">
                    Omie: {e.evidencia.titulos.length === 0 ? `nenhum ${l.item.omie?.oQue}` : `${e.evidencia.titulos.length} título(s), ${fmtBRL(e.evidencia.valorCents)}, ${e.evidencia.pagos} pago(s)${e.evidencia.ultimoPagamento ? `, último em ${fmtData(e.evidencia.ultimoPagamento)}` : ""}`}
                  </summary>
                  <ul className="mt-1 space-y-0.5 text-slate-600">
                    {e.evidencia.titulos.slice(0, 15).map((t, i) => (
                      <li key={i}>
                        {t.categoria ?? "—"} · {t.parceiro ?? "—"} · {fmtBRL(t.valorCents)} · venc. {fmtData(t.vencimento)} · {t.liquidado ? `pago ${fmtData(t.pagoEm)}` : "em aberto"}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {podeMarcar && (
                <form action={marcarItemDaFolha} className="mt-2 flex gap-1">
                  <input type="hidden" name="conexaoId" value={e.conexaoId} />
                  <input type="hidden" name="competencia" value={competencia} />
                  <input type="hidden" name="chave" value={l.item.chave} />
                  <input type="hidden" name="feito" value={e.marca ? "0" : "1"} />
                  {!e.marca && <input name="observacao" placeholder="observação (opcional)" className="min-w-0 flex-1 rounded border border-slate-200 px-1.5 py-0.5 text-xs" />}
                  <button type="submit" className={`rounded px-2 py-0.5 text-xs font-medium ${e.marca ? "text-slate-500 hover:bg-slate-100" : "bg-slate-900 text-white hover:bg-slate-700"}`}>
                    {e.marca ? "Desmarcar" : "Marcar feito"}
                  </button>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
