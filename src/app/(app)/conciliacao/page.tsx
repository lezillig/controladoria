import { fmtBRL, fmtData, fmtNumero, fmtPercent } from "@/lib/controladoria/format";
import { saldoAtualCents } from "@/lib/controladoria/agents/conciliacao";
import { agrupar, somar } from "@/lib/controladoria/agents/comum";
import { inicioDoMes } from "@/lib/controladoria/periodos";
import { competenciasDisponiveis, contextoDaPagina } from "../_dados";
import { AvisoVazio, Barra, Kpi, Secao, Tabela } from "../_componentes";
import Filtros from "../Filtros";
import { larguraPainel } from "@/lib/ui";

// CONCILIAÇÃO BANCÁRIA — o controle que fecha o circuito do dinheiro.
// Sem ele, todo número do módulo é uma declaração de intenção.

export default async function ConciliacaoPage({
  searchParams,
}: {
  searchParams: Promise<{ empresa?: string; competencia?: string }>;
}) {
  const params = await searchParams;
  const { ctx, escopo, periodo } = await contextoDaPagina("conciliacao", params.empresa, params.competencia);

  const inicio = inicioDoMes(new Date(ctx.dataReferencia.getFullYear(), ctx.dataReferencia.getMonth() - 1, 1));
  const movimentos = ctx.movimentos.filter((m) => m.data >= inicio && m.data <= ctx.dataReferencia);
  const conciliados = movimentos.filter((m) => m.conciliado);
  const pendentes = movimentos.filter((m) => !m.conciliado);

  if (ctx.contasCorrentes.length === 0) {
    return (
      <div className={`${larguraPainel} space-y-6`}>
        <Cabecalho />

      <Filtros
        conexoes={ctx.conexoes}
        empresaAtiva={escopo.conexaoId}
        competencias={competenciasDisponiveis(ctx.config.dataInicioBase)}
        competenciaAtiva={periodo.competencia}
        rota="/conciliacao"
      />
        <AvisoVazio
          titulo="Nenhuma conta corrente espelhada"
          descricao="As contas correntes vêm da Omie na primeira sincronização. Sem elas, não há extrato para conciliar."
          acaoHref="/sincronizacao"
          acaoLabel="Ir para a sincronização"
        />
      </div>
    );
  }

  const porConta = agrupar(movimentos, (m) => m.contaCorrenteCodigo);
  const entradas = somar(
    movimentos.filter((m) => m.valorCents > 0),
    (m) => m.valorCents
  );
  const saidas = somar(
    movimentos.filter((m) => m.valorCents < 0),
    (m) => Math.abs(m.valorCents)
  );

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <Cabecalho />

      <Filtros
        conexoes={ctx.conexoes}
        empresaAtiva={escopo.conexaoId}
        competencias={competenciasDisponiveis(ctx.config.dataInicioBase)}
        competenciaAtiva={periodo.competencia}
        rota="/conciliacao"
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi rotulo="Saldo consolidado" valor={fmtBRL(saldoAtualCents(ctx))} apoio="Saldo inicial + movimentos espelhados" />
        <Kpi
          rotulo="Conciliação do período"
          valor={movimentos.length > 0 ? fmtPercent((conciliados.length / movimentos.length) * 100) : "—"}
          apoio={`${fmtNumero(conciliados.length)} de ${fmtNumero(movimentos.length)} lançamentos`}
          tom={movimentos.length > 0 && conciliados.length / movimentos.length >= 0.95 ? "bom" : "atencao"}
        />
        <Kpi rotulo="Entradas (2 meses)" valor={fmtBRL(entradas)} apoio={`${fmtNumero(movimentos.filter((m) => m.valorCents > 0).length)} lançamentos`} />
        <Kpi rotulo="Saídas (2 meses)" valor={fmtBRL(saidas)} apoio={`${fmtNumero(movimentos.filter((m) => m.valorCents < 0).length)} lançamentos`} />
      </div>

      <Secao titulo="Por conta corrente" descricao="Últimos dois meses.">
        <Tabela
          colunas={["Conta", "Banco", "Lançamentos", "Conciliados", "Situação"]}
          alinharDireita={[2, 3]}
          linhas={ctx.contasCorrentes
            .filter((c) => !c.inativa)
            .map((c) => {
              const lista = porConta.get(c.codigo) ?? [];
              const ok = lista.filter((m) => m.conciliado).length;
              const percentual = lista.length > 0 ? (ok / lista.length) * 100 : 0;
              return [
                <span key="c" className="font-medium text-slate-800">
                  {c.descricao}
                </span>,
                c.banco ?? "—",
                fmtNumero(lista.length),
                fmtNumero(ok),
                <div key="b" className="w-32">
                  <Barra percentual={percentual} tom={percentual >= 95 ? "verde" : percentual >= 70 ? "ambar" : "vermelho"} />
                  <span className="mt-1 block text-xs text-slate-500">
                    {lista.length === 0 ? "sem extrato importado" : fmtPercent(percentual)}
                  </span>
                </div>,
              ];
            })}
        />
      </Secao>

      <Secao
        titulo={`Pendentes de conciliação (${fmtNumero(pendentes.length)})`}
        descricao="Ordenados pelo maior valor absoluto — é por onde vale começar."
      >
        <Tabela
          colunas={["Data", "Histórico", "Contraparte", "Valor"]}
          alinharDireita={[3]}
          vazio="Tudo conciliado no período. É o estado que se quer manter."
          linhas={[...pendentes]
            .sort((a, b) => Math.abs(b.valorCents) - Math.abs(a.valorCents))
            .slice(0, 60)
            .map((m) => [
              fmtData(m.data),
              <span key="h" className="text-xs">
                {m.observacao ?? m.documento ?? "—"}
                {!m.categoriaCodigo && <span className="block text-amber-600">sem categoria</span>}
              </span>,
              m.parceiroNome ?? "—",
              <span key="v" className={m.valorCents < 0 ? "font-medium text-red-700" : "font-medium text-emerald-700"}>
                {fmtBRL(m.valorCents)}
              </span>,
            ])}
        />
      </Secao>
    </div>
  );
}

function Cabecalho() {
  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Conciliação bancária</h1>
      <p className="mt-1 text-sm text-slate-500">
        Confronto entre o extrato das contas e os títulos baixados. Movimento sem título e baixa sem movimento são os dois
        lados do mesmo furo — os dois viram achado de auditoria.
      </p>
    </div>
  );
}
