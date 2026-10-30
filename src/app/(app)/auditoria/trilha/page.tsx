import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resumoDaMudanca } from "@/lib/auditoria/resumoTrilha";
import { larguraPainel } from "@/lib/ui";
import { exigirPermissao } from "../../_dados";
import { Secao, Tabela } from "../../_componentes";

// A TRILHA DE ALTERAÇÕES: quem mudou o quê, quando, por pessoa ou por agente
// — tudo o que passa por registrarAlteracao (cadastro, decisões de
// pendência, ligação com a Omie, agentes). Consulta por período, tabela e
// autor. Só leitura: a trilha não se edita.

export const dynamic = "force-dynamic";

const LIMITE = 300;
const dataInput = (d: Date) => d.toISOString().slice(0, 10);
const OPERACAO: Record<string, string> = { insert: "criou", update: "alterou", desativar: "desativou", excluir: "excluiu" };

export default async function TrilhaPage({ searchParams }: { searchParams: Promise<{ de?: string; ate?: string; tabela?: string; quem?: string; registro?: string }> }) {
  const session = await exigirPermissao("auditoria");
  const sp = await searchParams;
  const hoje = new Date();
  const de = /^\d{4}-\d{2}-\d{2}$/.test(sp.de ?? "") ? new Date(`${sp.de}T00:00:00.000Z`) : new Date(hoje.getTime() - 7 * 86_400_000);
  const ate = /^\d{4}-\d{2}-\d{2}$/.test(sp.ate ?? "") ? new Date(`${sp.ate}T23:59:59.999Z`) : hoje;
  const quem = (sp.quem ?? "").trim();
  const where: Prisma.AudLogWhereInput = {
    companyId: session.companyId,
    dataHora: { gte: de, lte: ate },
    // A marca diária dos agentes ("rodou hoje") não é alteração de ninguém.
    NOT: { tabela: "Agente" },
    ...(sp.tabela ? { tabela: sp.tabela } : {}),
    ...(sp.registro ? { registroId: sp.registro.trim() } : {}),
    ...(quem ? { OR: [{ usuario: { contains: quem, mode: "insensitive" } }, { agente: { contains: quem, mode: "insensitive" } }] } : {}),
  };
  const [linhas, total, tabelas] = await Promise.all([
    prisma.audLog.findMany({ where, orderBy: { dataHora: "desc" }, take: LIMITE }),
    prisma.audLog.count({ where }),
    prisma.audLog.findMany({ where: { companyId: session.companyId, NOT: { tabela: "Agente" } }, distinct: ["tabela"], select: { tabela: true }, orderBy: { tabela: "asc" } }),
  ]);

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div>
        <Link href="/auditoria" className="text-xs text-slate-500 hover:text-slate-800">
          ← Auditoria e achados
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Trilha de alterações</h1>
        <p className="mt-1 max-w-4xl text-sm text-slate-500">
          Quem mudou o quê e quando — pessoas e agentes —, com o antes e o depois de cada campo. Inclui o cadastro mestre, as decisões das pendências e a ligação com a Omie. Não se edita.
        </p>
      </div>
      <Secao
        titulo={`${total.toLocaleString("pt-BR")} alteração(ões)${total > LIMITE ? ` — mostrando as ${LIMITE} mais recentes` : ""}`}
        acao={
          <form action="/auditoria/trilha" className="flex flex-wrap items-end gap-2 text-xs">
            <input type="date" name="de" defaultValue={dataInput(de)} className="rounded-md border border-slate-300 px-2 py-1" />
            <input type="date" name="ate" defaultValue={dataInput(ate)} className="rounded-md border border-slate-300 px-2 py-1" />
            <select name="tabela" defaultValue={sp.tabela ?? ""} className="rounded-md border border-slate-300 px-2 py-1">
              <option value="">todas as tabelas</option>
              {tabelas.map((t) => (
                <option key={t.tabela} value={t.tabela}>
                  {t.tabela}
                </option>
              ))}
            </select>
            <input name="quem" defaultValue={quem} placeholder="Pessoa ou agente" className="rounded-md border border-slate-300 px-2 py-1" />
            <input name="registro" defaultValue={sp.registro ?? ""} placeholder="Id do registro" className="rounded-md border border-slate-300 px-2 py-1" />
            <button className="rounded-md bg-slate-900 px-2 py-1 font-semibold text-white">Filtrar</button>
          </form>
        }
      >
        <Tabela
          colunas={["Quando", "Quem", "O quê", "Registro", "Mudança"]}
          linhas={linhas.map((l) => [
            <span key="d" className="whitespace-nowrap text-xs">{l.dataHora.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</span>,
            <span key="q" className="text-xs">{l.usuario ?? <span className="text-slate-500">agente {l.agente ?? "—"}</span>}</span>,
            <span key="o" className="text-xs">
              {OPERACAO[l.operacao] ?? l.operacao} {l.tabela}
            </span>,
            <Link key="r" href={`/auditoria/trilha?registro=${encodeURIComponent(l.registroId)}&de=2020-01-01`} className="font-mono text-[11px] text-blue-800 hover:underline">
              {l.registroId.length > 18 ? `${l.registroId.slice(0, 18)}…` : l.registroId}
            </Link>,
            <ul key="m" className="text-[11px] text-slate-600">
              {resumoDaMudanca(l.antes, l.depois).map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>,
          ])}
          vazio="Nenhuma alteração com esses filtros."
        />
      </Secao>
    </div>
  );
}
