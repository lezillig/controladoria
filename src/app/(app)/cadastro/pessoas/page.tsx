import { prisma } from "@/lib/prisma";
import { mascararCpf } from "@/lib/cadastro/normalizacao";
import { fmtData, fmtNumero } from "@/lib/controladoria/format";
import { larguraPainel } from "@/lib/ui";
import { exigirPermissao } from "../../_dados";
import { Kpi, Secao, Tabela } from "../../_componentes";

// PESSOAS DO CADASTRO MESTRE — motoristas, monitores, mecânicos e
// administrativo, pela chave do CPF. O CPF aparece mascarado: a tela serve
// para conferir quem está cadastrado, não para copiar documento.

const LIMITE = 400;
const CARGOS = ["motorista", "monitor", "mecanico", "adm", "gestor"];

export default async function PessoasPage({ searchParams }: { searchParams: Promise<{ q?: string; cargo?: string; inativos?: string }> }) {
  const params = await searchParams;
  const session = await exigirPermissao("cadastro-pessoas");
  const companyId = session.companyId;
  const q = (params.q ?? "").trim();
  const cargo = CARGOS.includes(params.cargo ?? "") ? params.cargo : undefined;
  const comInativos = params.inativos === "1";
  const [pessoas, porCargo] = await Promise.all([
    prisma.cadPessoa.findMany({
      where: { companyId, ...(comInativos ? {} : { ativo: true }), ...(cargo ? { cargo } : {}), ...(q ? { nome: { contains: q, mode: "insensitive" as const } } : {}) },
      orderBy: { nome: "asc" },
      take: LIMITE,
    }),
    prisma.cadPessoa.groupBy({ by: ["cargo"], where: { companyId, ativo: true }, _count: true }),
  ]);
  const total = porCargo.reduce((s, c) => s + c._count, 0);

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Pessoas</h1>
        <p className="mt-1 max-w-4xl text-sm text-slate-500">Quem trabalha na operação, pela chave do CPF (mascarado aqui). Hoje vem da gestão de motoristas; o sistema de ponto entra como segunda fonte.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi rotulo="Ativas" valor={fmtNumero(total)} />
        {CARGOS.map((c) => (
          <Kpi key={c} rotulo={c} valor={fmtNumero(porCargo.find((x) => x.cargo === c)?._count ?? 0)} />
        ))}
      </div>
      <Secao
        titulo={`${fmtNumero(pessoas.length)} pessoa(s)${pessoas.length === LIMITE ? ` (as ${LIMITE} primeiras)` : ""}`}
        acao={
          <form className="flex flex-wrap gap-2 text-xs" action="/cadastro/pessoas">
            <input name="q" defaultValue={q} placeholder="Nome…" className="rounded-md border border-slate-300 px-2 py-1" />
            <select name="cargo" defaultValue={cargo ?? ""} className="rounded-md border border-slate-300 px-2 py-1">
              <option value="">todos os cargos</option>
              {CARGOS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <label className="flex items-center gap-1"><input type="checkbox" name="inativos" value="1" defaultChecked={comInativos} /> inativos</label>
            <button className="rounded-md bg-slate-900 px-2 py-1 font-semibold text-white">Filtrar</button>
          </form>
        }
      >
        <Tabela
          colunas={["Nome", "CPF", "Cargo", "Admissão", "Desligamento", "Matrícula do ponto", "Situação"]}
          linhas={pessoas.map((p) => [p.nome, <span key="c" className="font-mono text-xs">{mascararCpf(p.cpf)}</span>, p.cargo, p.dataAdmissao ? fmtData(p.dataAdmissao) : "—", p.dataDesligamento ? fmtData(p.dataDesligamento) : "—", p.matriculaPonto ?? "—", p.ativo ? "ativa" : "inativa"])}
          vazio="Ninguém cadastrado com esses filtros."
        />
      </Secao>
    </div>
  );
}
