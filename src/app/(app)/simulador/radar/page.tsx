import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { fmtData } from "@/lib/controladoria/format";
import { larguraPainel } from "@/lib/ui";
import { ufsDoRadar, MODALIDADES } from "@/lib/radar/pncp";
import { exigirPermissao } from "../../_dados";
import { AvisoVazio } from "../../_componentes";
import { AcoesDaLicitacao, VarrerAgora } from "./Acoes";

// RADAR DE LICITAÇÕES — o que o PNCP publicou e parece serviço da Azul.
// A varredura diária (api/cron/radar-pncp) traz; aqui o comercial decide.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FILTROS = {
  abertas: "Com proposta aberta",
  participando: "Participando",
  descartadas: "Descartadas",
  todas: "Todas",
} as const;
type Filtro = keyof typeof FILTROS;

const ROTULO_STATUS: Record<string, string> = { NOVA: "Nova", ANALISANDO: "Em análise", PARTICIPANDO: "Participando", DESCARTADA: "Descartada" };
const reais = (c: bigint | null) => (c == null ? "—" : (Number(c) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }));
const horaBrasilia = (d: Date) => new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(11, 16);

export default async function RadarPage({ searchParams }: { searchParams: Promise<{ filtro?: string }> }) {
  const session = await exigirPermissao("simulador");
  const { filtro: f } = await searchParams;
  const filtro: Filtro = f && f in FILTROS ? (f as Filtro) : "abertas";
  const agora = new Date();
  const where =
    filtro === "abertas"
      ? { status: { in: ["NOVA", "ANALISANDO", "PARTICIPANDO"] }, OR: [{ encerramentoPropostaEm: null }, { encerramentoPropostaEm: { gte: agora } }] }
      : filtro === "participando"
        ? { status: "PARTICIPANDO" }
        : filtro === "descartadas"
          ? { status: "DESCARTADA" }
          : {};
  const [lista, varredura] = await Promise.all([
    prisma.radarLicitacao.findMany({
      where: { companyId: session.companyId, ...where },
      orderBy: [{ aderencia: "asc" }, { encerramentoPropostaEm: "asc" }],
      take: 300,
    }),
    prisma.radarVarredura.findUnique({ where: { companyId: session.companyId } }),
  ]);

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div>
        <Link href="/simulador" className="text-xs font-medium text-blue-700 hover:underline">
          ← Simulador
        </Link>
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-xl font-semibold text-slate-900">Radar de licitações</h1>
          <VarrerAgora />
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Publicações do PNCP em {ufsDoRadar().join(", ")} ({Object.values(MODALIDADES).join(", ")}) cujo objeto é transporte de pessoas.
          Compra de veículo, peças, combustível e seguro ficam de fora. Varrido até{" "}
          {varredura ? fmtData(varredura.ultimoDia) : "— (ainda não varreu)"}; a varredura automática roda às 07:50.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        {(Object.keys(FILTROS) as Filtro[]).map((k) => (
          <Link
            key={k}
            href={`/simulador/radar?filtro=${k}`}
            className={`rounded-full px-3 py-1 ${k === filtro ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            {FILTROS[k]}
          </Link>
        ))}
      </div>

      {lista.length === 0 ? (
        <AvisoVazio
          titulo="Nada aqui ainda"
          descricao="A primeira varredura busca os últimos 30 dias de publicações. Use “Varrer agora” para não esperar a automática."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2">Aderência</th>
                <th className="px-3 py-2">Órgão</th>
                <th className="px-3 py-2">Objeto</th>
                <th className="px-3 py-2">Proposta até</th>
                <th className="px-3 py-2">Estimado</th>
                <th className="px-3 py-2">Situação</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {lista.map((l) => {
                const dias = l.encerramentoPropostaEm ? Math.ceil((l.encerramentoPropostaEm.getTime() - agora.getTime()) / 86_400_000) : null;
                return (
                  <tr key={l.id} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${l.aderencia === "ALTA" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                        {l.aderencia === "ALTA" ? "Alta" : "Média"}
                      </span>
                      <span className="mt-1 block text-[11px] text-slate-400">{l.termos.join(", ")}</span>
                    </td>
                    <td className="px-3 py-2">
                      {l.municipio ?? "—"}/{l.uf ?? "—"}
                      <span className="block text-xs text-slate-500">{l.orgaoNome}</span>
                    </td>
                    <td className="max-w-xl px-3 py-2">
                      <a href={l.urlPncp} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
                        {l.objeto.length > 220 ? `${l.objeto.slice(0, 220)}…` : l.objeto}
                      </a>
                      <span className="block text-xs text-slate-500">
                        {l.modalidade} {l.numeroCompra ?? ""}
                        {l.srp ? " · registro de preços" : ""}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {l.encerramentoPropostaEm ? `${fmtData(l.encerramentoPropostaEm)} ${horaBrasilia(l.encerramentoPropostaEm)}` : "—"}
                      {dias != null && (
                        <span className={`block text-xs ${dias <= 3 ? "font-semibold text-red-700" : "text-slate-500"}`}>
                          {dias < 0 ? "encerrada" : dias === 0 ? "hoje" : `em ${dias} dia(s)`}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{reais(l.valorEstimadoCents)}</td>
                    <td className="px-3 py-2">
                      {ROTULO_STATUS[l.status] ?? l.status}
                      {l.decididoPor && <span className="block text-xs text-slate-500">{l.decididoPor}</span>}
                      {l.motivoDescarte && <span className="block text-xs text-slate-500">{l.motivoDescarte}</span>}
                    </td>
                    <td className="px-3 py-2">
                      <AcoesDaLicitacao id={l.id} status={l.status} estudoId={l.estudoId} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
