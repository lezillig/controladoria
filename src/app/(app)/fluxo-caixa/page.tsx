import { fmtBRL, fmtData, fmtNumero } from "@/lib/controladoria/format";
import { saldoAtualCents } from "@/lib/controladoria/agents/conciliacao";
import { calcularCiclo, projetarFluxoCaixa } from "@/lib/controladoria/agents/fluxoCaixa";
import { diasDeAtraso, emAberto, saldoAberto, somar, titulosAtivos } from "@/lib/controladoria/agents/comum";
import { somarDias } from "@/lib/controladoria/periodos";
import { competenciasDisponiveis, contextoDaPagina } from "../_dados";
import { Kpi, Secao, Tabela } from "../_componentes";
import Filtros from "../Filtros";
import { larguraPainel } from "@/lib/ui";

// FLUXO DE CAIXA — a única tela do módulo que olha para frente.

export default async function FluxoCaixaPage({
  searchParams,
}: {
  searchParams: Promise<{ empresa?: string; competencia?: string }>;
}) {
  const params = await searchParams;
  const { ctx, escopo, periodo } = await contextoDaPagina(params.empresa, params.competencia);

  const saldo = saldoAtualCents(ctx);
  const projecao = projetarFluxoCaixa(ctx);
  const ciclo = calcularCiclo(ctx);

  const pagarAberto = titulosAtivos(ctx, "PAGAR").filter(emAberto);
  const receberAberto = titulosAtivos(ctx, "RECEBER").filter(emAberto);

  // Agenda dos próximos 15 dias, dia a dia: é a visão que o financeiro usa
  // para decidir o que pagar hoje e o que empurrar — a projeção por horizonte
  // (7/15/30) responde "vai faltar?", esta responde "em que dia".
  const agenda = Array.from({ length: 15 }, (_, i) => {
    const dia = somarDias(ctx.dataReferencia, i + 1);
    const saidas = somar(
      pagarAberto.filter((t) => t.dataVencimento.toDateString() === dia.toDateString()),
      saldoAberto
    );
    const entradas = somar(
      receberAberto.filter((t) => t.dataVencimento.toDateString() === dia.toDateString()),
      saldoAberto
    );
    return { dia, entradas, saidas };
  }).filter((d) => d.entradas > 0 || d.saidas > 0);

  const ruptura = projecao.find((p) => p.saldoProjetadoCents < 0);
  const vencidoPagar = somar(
    pagarAberto.filter((t) => diasDeAtraso(t, ctx.dataReferencia) > 0),
    saldoAberto
  );

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Fluxo de caixa</h1>
        <p className="mt-1 text-sm text-slate-500">
          Projeção conservadora: recebível já vencido não conta como entrada, e título vencido em aberto conta como saída
          imediata. Otimismo em projeção de caixa é o que produz surpresa no dia 20.
        </p>
      </div>

      <Filtros
        conexoes={ctx.conexoes}
        empresaAtiva={escopo.conexaoId}
        competencias={competenciasDisponiveis(ctx.config.dataInicioBase)}
        competenciaAtiva={periodo.competencia}
        rota="/fluxo-caixa"
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi rotulo="Saldo atual" valor={fmtBRL(saldo)} apoio="Soma das contas correntes ativas" tom={saldo >= 0 ? "neutro" : "ruim"} />
        <Kpi rotulo="A pagar em aberto" valor={fmtBRL(somar(pagarAberto, saldoAberto))} apoio={`Vencido: ${fmtBRL(vencidoPagar)}`} />
        <Kpi rotulo="A receber em aberto" valor={fmtBRL(somar(receberAberto, saldoAberto))} apoio={`${fmtNumero(receberAberto.length)} título(s)`} />
        <Kpi
          rotulo="Ciclo financeiro"
          valor={`${fmtNumero(ciclo.cicloFinanceiroDias)} dias`}
          apoio={`PMR ${fmtNumero(ciclo.pmrDias)} · PMP ${fmtNumero(ciclo.pmpDias)}`}
          tom={ciclo.cicloFinanceiroDias !== null && ciclo.cicloFinanceiroDias > 30 ? "atencao" : "neutro"}
        />
      </div>

      {ruptura && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm font-semibold text-red-900">
            Ponto de ruptura em {ruptura.dias} dias — saldo projetado {fmtBRL(ruptura.saldoProjetadoCents)}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-red-800">
            Ordem sugerida, do mais barato ao mais caro: cobrar os recebíveis vencidos de maior valor; renegociar vencimento
            com os fornecedores de maior volume (o histórico de pagamento da empresa é o argumento); só então comparar
            antecipação de recebíveis com capital de giro, pelo custo efetivo dos dois.
          </p>
        </div>
      )}

      <Secao titulo="Projeção por horizonte">
        <Tabela
          colunas={["Horizonte", "Data", "Entradas previstas", "Saídas previstas", "Saldo projetado"]}
          alinharDireita={[2, 3, 4]}
          linhas={projecao.map((p) => [
            `${p.dias} dias`,
            fmtData(p.data),
            fmtBRL(p.entradasCents),
            fmtBRL(p.saidasCents),
            <span key="s" className={`font-semibold ${p.saldoProjetadoCents < 0 ? "text-red-700" : "text-emerald-700"}`}>
              {fmtBRL(p.saldoProjetadoCents)}
            </span>,
          ])}
        />
      </Secao>

      <Secao titulo="Agenda dos próximos 15 dias" descricao="Somente dias com movimento previsto.">
        <Tabela
          colunas={["Dia", "Entradas", "Saídas", "Líquido"]}
          alinharDireita={[1, 2, 3]}
          vazio="Nenhum vencimento previsto nos próximos 15 dias."
          linhas={agenda.map((d) => [
            fmtData(d.dia),
            d.entradas > 0 ? fmtBRL(d.entradas) : "—",
            d.saidas > 0 ? fmtBRL(d.saidas) : "—",
            <span key="l" className={d.entradas - d.saidas < 0 ? "font-medium text-red-700" : "text-emerald-700"}>
              {fmtBRL(d.entradas - d.saidas)}
            </span>,
          ])}
        />
      </Secao>

      <Secao titulo="Maiores compromissos em aberto" descricao="Os 15 títulos a pagar de maior saldo, por vencimento.">
        <Tabela
          colunas={["Fornecedor", "Vencimento", "Saldo"]}
          alinharDireita={[2]}
          linhas={[...pagarAberto]
            .sort((a, b) => saldoAberto(b) - saldoAberto(a))
            .slice(0, 15)
            .map((t) => [
              t.parceiroNome ?? "(não identificado)",
              <span key="v">
                {fmtData(t.dataVencimento)}
                {diasDeAtraso(t, ctx.dataReferencia) > 0 && (
                  <span className="block text-xs font-medium text-red-600">
                    vencido há {diasDeAtraso(t, ctx.dataReferencia)} dia(s)
                  </span>
                )}
              </span>,
              fmtBRL(saldoAberto(t)),
            ])}
        />
      </Secao>
    </div>
  );
}
