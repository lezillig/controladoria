import { fmtBRL, fmtData, fmtNumero, fmtPercent } from "@/lib/controladoria/format";
import { agrupar, somar } from "@/lib/controladoria/agents/comum";
import { inicioDoMes } from "@/lib/controladoria/periodos";
import { competenciasDisponiveis, contextoDaPagina, podeAcao } from "../_dados";
import { AvisoVazio, Barra, Kpi, Secao, Tabela } from "../_componentes";
import Filtros from "../Filtros";
import { badgeClass, larguraPainel } from "@/lib/ui";
import { conciliadoAte, situacaoDasContas } from "@/lib/controladoria/conciliadoAte";
import { ROTULO_GRUPO, saldosDasContas, totais } from "@/lib/controladoria/saldosDasContas";

import { excluirSaldoInformado, informarSaldo } from "./actions";
import ConferirOfx from "./ConferirOfx";

// CONCILIAÇÃO BANCÁRIA — o controle que fecha o circuito do dinheiro.
// Sem ele, todo número do módulo é uma declaração de intenção.

export default async function ConciliacaoPage({
  searchParams,
}: {
  searchParams: Promise<{ empresa?: string; competencia?: string }>;
}) {
  const params = await searchParams;
  const { session, ctx, escopo, periodo } = await contextoDaPagina("conciliacao", params.empresa, params.competencia);
  const [situacao, saldos, podeInformar] = await Promise.all([
    situacaoDasContas({ companyId: session.companyId, conexaoId: escopo.conexaoId, dataReferencia: ctx.dataReferencia }),
    saldosDasContas({ companyId: session.companyId, conexaoId: escopo.conexaoId, ate: new Date() }),
    podeAcao(session, "informar-saldo"),
  ]);
  const t = totais(saldos);

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

  // Por CONEXÃO e código: o código da conta é único dentro de uma conta Omie,
  // não no grupo (ver saldoPorContaCents). Só pelo código, no consolidado, a
  // conta da Azul e a da MCZ com o mesmo código somariam o extrato uma da
  // outra.
  const porConta = agrupar(movimentos, (m) => `${m.conexaoId}:${m.contaCorrenteCodigo}`);
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
        <Kpi href="#saldo-por-conta" rotulo="Saldo disponível" valor={fmtBRL(t.disponivel)} apoio="Contas correntes e caixa (sem aplicações e cartões)" tom={t.disponivel >= 0 ? "neutro" : "ruim"} />
        <Kpi href="#saldo-por-conta" rotulo="Aplicações" valor={fmtBRL(t.aplicacao)} apoio={`Total com aplicações: ${fmtBRL(t.total)}`} />
        <Kpi
          href="#por-conta"
          rotulo="Conciliação do período"
          valor={movimentos.length > 0 ? fmtPercent((conciliados.length / movimentos.length) * 100) : "—"}
          apoio={`${fmtNumero(conciliados.length)} de ${fmtNumero(movimentos.length)} lançamentos`}
          tom={movimentos.length > 0 && conciliados.length / movimentos.length >= 0.95 ? "bom" : "atencao"}
        />
        <Kpi href="#por-conta" rotulo="Entradas e saídas (2 meses)" valor={fmtBRL(entradas - saidas)} apoio={`entradas ${fmtBRL(entradas)} · saídas ${fmtBRL(saidas)}`} />
      </div>

      <Secao
        id="saldo-por-conta"
        titulo="Saldo por conta"
        descricao="Saldo considerado: o informado do banco quando há (é a verdade do banco na data), senão o que a Omie calcula, senão o somado pelo extrato. Diferença entre Omie e extrato é lançamento que não chegou ao sistema."
      >
        <Tabela
          colunas={["Conta", "Tipo", "Omie", "Pelo extrato", "Banco (informado)", "Considerado"]}
          alinharDireita={[2, 3, 4, 5]}
          linhas={[
            ...saldos.map((l) => [
              <span key="c" className="font-medium text-slate-800">
                {l.descricao}
                <span className="block text-xs font-normal text-slate-400">
                  {l.empresa}
                  {l.banco ? ` · banco ${l.banco}` : ""}
                  {l.foraDaOmie ? " · fora da Omie" : ""}
                  {l.inativa ? " · inativa" : ""}
                </span>
              </span>,
              <span key="t" className="text-xs">
                {ROTULO_GRUPO[l.grupo]}
                {l.tipo && <span className="block text-slate-400">{l.tipo}</span>}
              </span>,
              l.omieCents === null ? (
                <span key="o" className="text-xs text-slate-400">{l.foraDaOmie ? "—" : "na próxima sincronização"}</span>
              ) : (
                <span key="o">
                  {fmtBRL(l.omieCents)}
                  <span className="block text-xs text-slate-400">
                    {l.omieConciliadoCents !== null ? `conciliado ${fmtBRL(l.omieConciliadoCents)}` : ""}
                    {l.omieEm ? ` · ${fmtData(l.omieEm)}` : ""}
                  </span>
                </span>
              ),
              l.extratoCents === null ? (
                "—"
              ) : (
                <span key="e">
                  {fmtBRL(l.extratoCents)}
                  {l.omieCents !== null && Math.abs(l.omieCents - l.extratoCents) >= 100 && (
                    <span className="block text-xs text-amber-700">dif. {fmtBRL(l.extratoCents - l.omieCents)}</span>
                  )}
                </span>
              ),
              l.informado ? (
                <span key="b">
                  {fmtBRL(l.informado.valorCents)}
                  <span className="block text-xs text-slate-400">
                    em {fmtData(l.informado.data)}
                    {l.informado.autor ? ` · ${l.informado.autor}` : ""}
                  </span>
                  {podeInformar && (
                    <form action={excluirSaldoInformado}>
                      <input type="hidden" name="id" value={l.informado.id} />
                      <button type="submit" className="text-xs text-red-700 hover:underline">
                        excluir
                      </button>
                    </form>
                  )}
                </span>
              ) : (
                "—"
              ),
              <span key="k" className="font-semibold text-slate-900">
                {fmtBRL(l.consideradoCents)}
                <span className="block text-xs font-normal text-slate-400">{l.fonte === "banco" ? "banco" : l.fonte === "omie" ? "Omie" : "extrato"}</span>
              </span>,
            ]),
            ...(["disponivel", "aplicacao", "cartao"] as const)
              .filter((g) => saldos.some((l) => l.grupo === g))
              .map((g) => [
                <span key="g" className="font-semibold text-slate-700">
                  Total {ROTULO_GRUPO[g].toLowerCase()}
                </span>,
                "",
                "",
                "",
                "",
                <span key="v" className="font-semibold text-slate-900">
                  {fmtBRL(g === "disponivel" ? t.disponivel : g === "aplicacao" ? t.aplicacao : t.cartao)}
                </span>,
              ]),
            [
              <span key="g" className="font-bold text-slate-900">
                Total geral
              </span>,
              "",
              "",
              "",
              "",
              <span key="v" className="font-bold text-slate-900">
                {fmtBRL(t.total)}
              </span>,
            ],
          ]}
        />
        {podeInformar && (
          <form action={informarSaldo} className="mt-4 flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            <p className="w-full text-xs font-medium text-slate-600">
              Informar o saldo do banco (ex.: investimentos do Bradesco que a Omie não tem). Vale o mais recente de cada conta.
            </p>
            <label className="flex flex-col text-xs text-slate-500">
              Conta
              <select name="conta" className="mt-1 max-w-[16rem] rounded-md border border-slate-300 bg-white px-2 py-1 text-sm">
                {ctx.contasCorrentes.map((c) => (
                  <option key={`${c.conexaoId}:${c.codigo}`} value={`${c.conexaoId}:${c.codigo}`}>
                    {c.conexaoApelido} · {c.descricao}
                  </option>
                ))}
                {ctx.conexoes.map((c) => (
                  <option key={`fora-${c.id}`} value={`${c.id}:fora`}>
                    {c.apelido} · outra conta, fora da Omie…
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-xs text-slate-500">
              Nome (se fora da Omie)
              <input name="descricao" placeholder="Bradesco Investimentos" className="mt-1 w-48 rounded-md border border-slate-300 px-2 py-1 text-sm" />
            </label>
            <label className="flex flex-col text-xs text-slate-500">
              Data
              <input type="date" name="data" required className="mt-1 rounded-md border border-slate-300 px-2 py-1 text-sm" />
            </label>
            <label className="flex flex-col text-xs text-slate-500">
              Saldo (R$)
              <input name="valor" required placeholder="2.700.000,00" className="mt-1 w-36 rounded-md border border-slate-300 px-2 py-1 text-sm" />
            </label>
            <label className="flex items-center gap-1 text-xs text-slate-600">
              <input type="checkbox" name="aplicacao" value="1" /> é aplicação
            </label>
            <button type="submit" className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700">
              Gravar saldo
            </button>
          </form>
        )}
      </Secao>

      <Secao
        titulo="Conferir o extrato do banco (OFX)"
        descricao="Suba o OFX exportado do internet banking. O sistema acha a conta pelo banco e número, cruza cada lançamento com o extrato da Omie (mesmo valor, até 3 dias de diferença) e compara o saldo."
      >
        <ConferirOfx podeGravar={podeInformar} />
      </Secao>

      <Secao
        titulo="Até que dia cada conta está conciliada"
        descricao={`Pelo histórico inteiro do extrato: "conciliado até" é a véspera do primeiro lançamento pendente — tudo antes dele está conciliado. Atraso contado até ${fmtData(ctx.dataReferencia)}. A mais atrasada primeiro.`}
      >
        <Tabela
          colunas={["Conta", "Conciliado até", "Atraso", "Pendentes", "Última conciliação feita"]}
          alinharDireita={[2, 3]}
          linhas={ctx.contasCorrentes
            .filter((c) => !c.inativa)
            .map((c) => {
              const s = situacao.get(`${c.conexaoId}:${c.codigo}`);
              return { c, s, a: s ? conciliadoAte(s, ctx.dataReferencia) : null };
            })
            .sort((x, y) => (y.a?.diasDeAtraso ?? -1) - (x.a?.diasDeAtraso ?? -1))
            .map(({ c, s, a }) => [
              <span key="c" className="font-medium text-slate-800">
                {c.descricao}
                <span className="block text-xs font-normal text-slate-400">
                  {c.conexaoApelido}
                  {c.banco ? ` · ${c.banco}` : ""}
                </span>
              </span>,
              !s || !a?.ate ? (
                <span key="a" className="text-xs text-slate-400">sem extrato importado</span>
              ) : a.nadaConciliado ? (
                <span key="a" className="text-xs text-red-700">nada conciliado (extrato desde {fmtData(s.primeiroMovimento)})</span>
              ) : (
                <span key="a" className="font-medium text-slate-800">{fmtData(a.ate)}</span>
              ),
              a?.diasDeAtraso === null || a?.diasDeAtraso === undefined ? (
                "—"
              ) : (
                <span
                  key="d"
                  className={`${badgeClass} ${a.diasDeAtraso === 0 ? "bg-emerald-100 text-emerald-800" : a.diasDeAtraso <= 7 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"}`}
                >
                  {a.diasDeAtraso === 0 ? "em dia" : `${fmtNumero(a.diasDeAtraso)} dia(s)`}
                </span>
              ),
              s && s.pendentes > 0 ? (
                <span key="p" className="text-xs">
                  {fmtNumero(s.pendentes)} · {fmtBRL(s.pendentesCents)}
                  <span className="block text-slate-400">desde {fmtData(s.primeiroPendente)}</span>
                </span>
              ) : (
                "—"
              ),
              s?.ultimaConciliacao ? fmtData(s.ultimaConciliacao) : "—",
            ])}
        />
      </Secao>

      <Secao id="por-conta" titulo="Por conta corrente" descricao="Últimos dois meses — a composição dos cartões de conciliação e de entradas e saídas.">
        <Tabela
          colunas={["Conta", "Banco", "Entradas", "Saídas", "Lançamentos", "Conciliados", "Situação"]}
          alinharDireita={[2, 3, 4, 5]}
          linhas={ctx.contasCorrentes
            .filter((c) => !c.inativa)
            .map((c) => {
              const lista = porConta.get(`${c.conexaoId}:${c.codigo}`) ?? [];
              const ok = lista.filter((m) => m.conciliado).length;
              const percentual = lista.length > 0 ? (ok / lista.length) * 100 : 0;
              return [
                <span key="c" className="font-medium text-slate-800">
                  {c.descricao}
                  {/* A empresa da conta: no consolidado há contas das duas. */}
                  <span className="block text-xs font-normal text-slate-400">{c.conexaoApelido}</span>
                </span>,
                c.banco ?? "—",
                fmtBRL(somar(lista.filter((m) => m.valorCents > 0), (m) => m.valorCents)),
                fmtBRL(somar(lista.filter((m) => m.valorCents < 0), (m) => Math.abs(m.valorCents))),
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
