import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { competenciaDoDesconto } from "@/lib/frota/multas";
import { ROTULO_CONFERENCIA } from "@/lib/frota/fechamentoMultas";
import { conferirCompetencia, eventosParaContabilidade } from "@/lib/frota/fechamentoMultasNoBanco";
import { fmtBRL, fmtData, fmtNumero } from "@/lib/controladoria/format";
import { larguraPainel } from "@/lib/ui";
import { exigirPermissao, podeAcao } from "../../../_dados";
import { Kpi, Secao, Tabela } from "../../../_componentes";
import FormAcao from "../../FormAcao";
import { importarFolhaProcessada, marcarEventosEnviados } from "./actions";

// DESCONTO DE MULTA NA FOLHA, por competência — o lado do RH do fechamento:
//   1. os descontos aprovados viram os eventos para a planilha da
//      Contabilidade (até o dia 20, como no fluxograma da folha);
//   2. com a folha processada, o relatório de eventos volta e o sistema
//      confere, por motorista, o aprovado × o que saiu no holerite.

export const maxDuration = 60;
const COR: Record<string, string> = { ok: "text-emerald-700", divergente: "text-red-700 font-semibold", nao_descontado: "text-red-700 font-semibold", sem_multa: "text-orange-700 font-semibold" };

export default async function DescontoEmFolhaPage({ searchParams }: { searchParams: Promise<{ competencia?: string }> }) {
  const sp = await searchParams;
  const session = await exigirPermissao("multas");
  const podeRh = await podeAcao(session, "gerir-motoristas");
  const hoje = new Date();
  const comMulta = await prisma.frotaMulta.groupBy({ by: ["descontoCompetencia"], where: { companyId: session.companyId, descontoCompetencia: { not: null } }, _count: true });
  const comFolha = await prisma.pesFolhaEventoMulta.groupBy({ by: ["competencia"], where: { companyId: session.companyId }, _count: true });
  const chaves = [...new Set([...comMulta.map((c) => c.descontoCompetencia!.toISOString().slice(0, 7)), ...comFolha.map((c) => c.competencia.toISOString().slice(0, 7)), competenciaDoDesconto(hoje).toISOString().slice(0, 7)])].sort().reverse();
  const chave = chaves.includes(sp.competencia ?? "") ? sp.competencia! : competenciaDoDesconto(hoje).toISOString().slice(0, 7);
  const competencia = new Date(`${chave}-01T00:00:00.000Z`);
  const rotulo = `${chave.slice(5, 7)}/${chave.slice(0, 4)}`;
  const [eventos, conferencia, importacao] = await Promise.all([
    eventosParaContabilidade(session.companyId, competencia),
    conferirCompetencia(session.companyId, competencia),
    prisma.pesFolhaEventoMulta.findFirst({ where: { companyId: session.companyId, competencia }, select: { arquivoNome: true, importadoEm: true, importadoPor: true } }),
  ]);
  const total = eventos.reduce((s, e) => s + e.valorCents, 0);
  const ok = conferencia.resultado.filter((r) => r.situacao === "ok");

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div>
        <Link href="/frota/multas" className="text-xs text-slate-500 hover:text-slate-800">← Multas</Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Desconto de multas na folha</h1>
        <p className="mt-1 max-w-4xl text-sm text-slate-500">
          Os descontos que o RH aprovou (com o termo assinado, pelo valor pago) viram os eventos da planilha da Contabilidade; com a folha processada, o relatório de eventos volta e o sistema confere motorista
          por motorista. A multa só fecha com o desconto conferido.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {chaves.map((c) => (
          <Link key={c} href={`/frota/multas/folha?competencia=${c}`} className={`rounded-full px-3 py-1 text-xs font-medium ${c === chave ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            {c.slice(5, 7)}/{c.slice(0, 4)}
          </Link>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Kpi rotulo={`Descontos aprovados ${rotulo}`} valor={fmtBRL(total)} apoio={`${fmtNumero(eventos.length)} motorista(s)`} />
        <Kpi rotulo="Mandados à Contabilidade" valor={`${eventos.filter((e) => e.enviado).length} de ${eventos.length}`} tom={eventos.some((e) => !e.enviado) ? "atencao" : "bom"} />
        <Kpi rotulo="Conferidos na folha" valor={conferencia.temFolha ? `${ok.length} de ${conferencia.resultado.length}` : "—"} apoio={conferencia.temFolha ? "motoristas que batem" : "a folha processada ainda não veio"} tom={!conferencia.temFolha ? "neutro" : ok.length === conferencia.resultado.length ? "bom" : "ruim"} />
        <Kpi rotulo="Divergências" valor={conferencia.temFolha ? fmtNumero(conferencia.resultado.length - ok.length) : "—"} tom={conferencia.temFolha && conferencia.resultado.length > ok.length ? "ruim" : "neutro"} />
      </div>

      <Secao
        titulo={`1. Eventos para a Contabilidade — folha de ${rotulo}`}
        descricao="Uma linha por motorista, com a matrícula da lista de ativos da folha. Baixe, cole na planilha de eventos da Contabilidade e marque como mandados."
        acao={
          podeRh && eventos.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <a href={`/api/exportar/multas-folha?competencia=${chave}`} className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">Baixar planilha</a>
              <FormAcao acao={marcarEventosEnviados} rotulo="Marcar como mandados" botaoClasse="rounded-md bg-slate-900 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-700">
                <input type="hidden" name="competencia" value={chave} />
              </FormAcao>
            </div>
          ) : undefined
        }
      >
        <Tabela
          colunas={["Motorista", "Matrícula", "Valor", "AIT", "Mandado"]}
          alinharDireita={[2]}
          linhas={eventos.map((e) => [e.nome, e.matricula ?? <span key="m" className="text-xs text-amber-700">sem matrícula na lista de ativos</span>, fmtBRL(e.valorCents), <span key="a" className="font-mono text-xs">{e.aits.join(", ")}</span>, e.enviado ? "sim" : <span key="e" className="text-xs font-semibold text-amber-700">não</span>])}
          vazio="Nenhum desconto aprovado para esta competência."
        />
      </Secao>

      <Secao
        titulo={`2. Conferência com a folha processada de ${rotulo}`}
        descricao={`O relatório de eventos da folha (planilha: nome, evento e valor; matrícula ajuda). Só as linhas de evento com "MULTA" são lidas e guardadas.${importacao ? ` Último envio: ${importacao.arquivoNome}, ${fmtData(importacao.importadoEm)} por ${importacao.importadoPor ?? "—"}.` : ""}`}
      >
        {podeRh && (
          <FormAcao acao={importarFolhaProcessada} rotulo="Enviar e conferir" classe="mb-4 flex flex-wrap items-end gap-2 text-xs">
            <input type="hidden" name="competencia" value={chave} />
            <input type="file" name="arquivo" accept=".xlsx,.xlsm" className="text-xs" />
          </FormAcao>
        )}
        <Tabela
          colunas={["Motorista", "Aprovado", "Na folha", "Situação"]}
          alinharDireita={[1, 2]}
          linhas={conferencia.resultado.map((r) => [r.nome, fmtBRL(r.esperadoCents), conferencia.temFolha ? fmtBRL(r.descontadoCents) : "—", conferencia.temFolha ? <span key="s" className={`text-xs ${COR[r.situacao]}`}>{ROTULO_CONFERENCIA[r.situacao]}</span> : <span key="s" className="text-xs text-slate-400">aguardando a folha</span>])}
          vazio="Nada a conferir nesta competência."
        />
      </Secao>
    </div>
  );
}
