import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { fmtBRL, fmtData, fmtPercent } from "@/lib/controladoria/format";
import { ROTULO_STATUS_ESTUDO, ROTULO_TIPO_ESTUDO, ROTULO_TIPO_SERVICO } from "@/lib/simulador/estudos";
import { ROTULO_UNIDADE, type UnidadePreco } from "@/lib/simulador/tipos";
import { exigirPermissao, podeAcao } from "../_dados";
import { AvisoVazio, Kpi, Secao, Tabela } from "../_componentes";
import { larguraPainel, primaryButtonClass, secondaryButtonClass } from "@/lib/ui";

// SIMULADOR DE CUSTOS — a lista de estudos.
//
// Um estudo é qualquer operação que se quer custear antes de existir:
// licitação, contrato privado, renovação, orçamento interno. A lista mostra,
// de cada um, a última versão — preço, margem e em que pé está —, porque é
// isso que se procura ao abrir a tela: "onde paramos naquele edital?".

export default async function SimuladorPage() {
  const session = await exigirPermissao("simulador");
  const podeEditar = await podeAcao(session, "gerir-simulador");

  const [estudos, totalBase] = await Promise.all([
    prisma.simEstudo.findMany({
      where: { companyId: session.companyId },
      orderBy: [{ atualizadoEm: "desc" }],
      include: { simulacoes: { orderBy: { versao: "desc" }, take: 1 }, _count: { select: { simulacoes: true, rotas: true } } },
    }),
    prisma.simParametro.count({ where: { companyId: session.companyId, vigenciaFim: null } }),
  ]);

  const emEstudo = estudos.filter((e) => e.status === "EM_ESTUDO").length;
  const enviados = estudos.filter((e) => e.status === "PROPOSTA_ENVIADA").length;
  const decididos = estudos.filter((e) => e.status === "GANHO" || e.status === "PERDIDO");
  const ganhos = decididos.filter((e) => e.status === "GANHO").length;

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Simulador de custos e preços</h1>
          <p className="mt-1 max-w-[80ch] text-sm text-slate-500">
            Custeia qualquer operação antes de ela existir — licitação, contrato privado, renovação ou orçamento interno — a partir da
            base de custos da Azul Mob, e diz o preço, a margem, o risco e se vale lançar. Cada versão fica guardada com a conta inteira.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/simulador/base" className={secondaryButtonClass}>
            Custos base
          </Link>
          {podeEditar && (
            <Link href="/simulador/novo" className={primaryButtonClass}>
              Novo estudo
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi rotulo="Em estudo" valor={String(emEstudo)} />
        <Kpi rotulo="Propostas enviadas" valor={String(enviados)} />
        <Kpi rotulo="Taxa de sucesso" valor={decididos.length > 0 ? fmtPercent((ganhos / decididos.length) * 100, 0) : "—"} apoio={decididos.length === 0 ? "nenhum estudo decidido ainda" : `${ganhos} de ${decididos.length} ${decididos.length === 1 ? "decidido" : "decididos"}`} />
        <Kpi
          rotulo="Base de custos"
          valor={totalBase > 0 ? `${totalBase} parâmetros` : "vazia"}
          apoio={totalBase > 0 ? "vigentes, do Gabarito" : "as simulações usam estimativas"}
          tom={totalBase > 0 ? "bom" : "atencao"}
        />
      </div>

      {totalBase === 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-900">A base de custos ainda está vazia</p>
          <p className="mt-1 text-xs leading-relaxed text-amber-800">
            Enquanto o Gabarito de dados não for importado, cada premissa de uma simulação nova é uma estimativa de mercado — e a tela marca
            isso em cada número. Importar o Gabarito preenchido troca as estimativas pelos custos da Azul Mob.{" "}
            <Link href="/simulador/base" className="font-semibold underline">
              Ir para a base de custos
            </Link>
          </p>
        </div>
      )}

      <Secao titulo="Estudos" descricao="Do mais recente ao mais antigo. A última versão de cada estudo mostra o preço e a margem.">
        {estudos.length === 0 ? (
          <div className="space-y-4">
            <AvisoVazio
              titulo="Nenhum estudo ainda"
              descricao="Crie o primeiro estudo: dê um nome, escolha o serviço, os tipos de veículo e como o contrato paga. Rotas e custos vêm no passo seguinte."
              {...(podeEditar ? { acaoHref: "/simulador/novo", acaoLabel: "Novo estudo" } : {})}
            />
          </div>
        ) : (
          <>
            <Tabela
              colunas={["Estudo", "Tipo", "Situação", "Versões", "Preço (última versão)", "Margem", "Lucro/apuração", "Atualizado"]}
              alinharDireita={[3, 4, 5, 6]}
              linhas={estudos.map((e) => {
                const v = e.simulacoes[0];
                const unidade = ((v?.entrada as { unidadePreco?: UnidadePreco } | null)?.unidadePreco ?? e.unidadePreco) as UnidadePreco;
                return [
                  <Link key="n" href={`/simulador/${e.id}`} className="font-medium text-blue-800 hover:underline">
                    {e.nome}
                    <span className="block text-xs font-normal text-slate-500">
                      {[e.cliente, e.municipio && `${e.municipio}/${e.uf ?? ""}`, e.numeroEdital].filter(Boolean).join(" · ")}
                    </span>
                  </Link>,
                  <span key="t" className="text-xs text-slate-600">
                    {ROTULO_TIPO_ESTUDO[e.tipo as keyof typeof ROTULO_TIPO_ESTUDO] ?? e.tipo}
                    <span className="block text-slate-500">{ROTULO_TIPO_SERVICO[e.tipoServico as keyof typeof ROTULO_TIPO_SERVICO] ?? e.tipoServico}</span>
                  </span>,
                  <span key="s" className="text-xs font-medium text-slate-700">
                    {ROTULO_STATUS_ESTUDO[e.status as keyof typeof ROTULO_STATUS_ESTUDO] ?? e.status}
                  </span>,
                  String(e._count.simulacoes),
                  v?.precoKm ? `${fmtBRL(Math.round(Number(v.precoKm) * 100))} ${ROTULO_UNIDADE[unidade]?.replace("R$", "").trim() ?? ""}` : "—",
                  v?.margem !== null && v?.margem !== undefined ? fmtPercent(Number(v.margem) * 100) : "—",
                  v ? fmtBRL(Math.round(Number(v.lucro) * 100)) : "—",
                  fmtData(e.atualizadoEm),
                ];
              })}
            />
          </>
        )}
      </Secao>
    </div>
  );
}
