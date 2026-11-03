import { fmtBRL, fmtData, fmtNumero } from "@/lib/controladoria/format";
import { saldoAtualCents, saldosConsideradosDoContexto } from "@/lib/controladoria/agents/conciliacao";
import { fonteDoSaldo } from "@/lib/controladoria/saldosDasContas";
import { HORIZONTES_DIAS, calcularCiclo, horizonteValido, projetarFluxoCaixa } from "@/lib/controladoria/agents/fluxoCaixa";
import { diasDeAtraso, emAberto, saldoAberto, somar, titulosAtivos } from "@/lib/controladoria/agents/comum";
import { somarDias } from "@/lib/controladoria/periodos";
import { preverRecebimentosDoContexto, quemCobrarAntes, semanasDeCaixa } from "@/lib/controladoria/previsaoCaixa";
import { carregarHistoricoDeClientes } from "@/lib/controladoria/previsaoHistorico";
import { competenciasDisponiveis, contextoDaPagina } from "../_dados";
import { Kpi, Secao, Tabela } from "../_componentes";
import Filtros from "../Filtros";
import { larguraPainel } from "@/lib/ui";

// FLUXO DE CAIXA — a única tela do módulo que olha para frente.

export default async function FluxoCaixaPage({
  searchParams,
}: {
  searchParams: Promise<{ empresa?: string; competencia?: string; dias?: string }>;
}) {
  const params = await searchParams;
  const { ctx, escopo, periodo } = await contextoDaPagina("fluxo-caixa", params.empresa, params.competencia);
  const dias = horizonteValido(Number(params.dias));

  const saldo = saldoAtualCents(ctx);
  const projecao = projetarFluxoCaixa(ctx);
  const ciclo = calcularCiclo(ctx);
  // A leitura REALISTA: cada cliente pelo próprio atraso típico, e o vencido
  // além do padrão fora da conta. Ver previsaoCaixa.ts.
  // Com 24 meses de resumo mensal como segunda fonte: em janeiro as baixas do
  // ano não bastam para cliente nenhum, e sem isso todos caíam no padrão geral.
  const previsao = preverRecebimentosDoContexto(ctx, await carregarHistoricoDeClientes(ctx));
  const clientesPeloHistorico = previsao.clientes.filter((c) => c.origem === "historico").length;
  const realistaPorDias = new Map(previsao.porHorizonte.map((p) => [p.dias, p.realistaCents]));
  const pessimistaPorDias = new Map(previsao.porHorizonte.map((p) => [p.dias, p.pessimistaCents]));
  const previsto30 = realistaPorDias.get(30) ?? 0;
  const contratual30 = previsao.porHorizonte.find((p) => p.dias === 30)?.contratualCents ?? 0;

  const pagarAberto = titulosAtivos(ctx, "PAGAR").filter(emAberto);
  const receberAberto = titulosAtivos(ctx, "RECEBER").filter(emAberto);

  // Agenda dia a dia, no horizonte escolhido: é a visão que o financeiro usa
  // para decidir o que pagar hoje e o que empurrar — a projeção por horizonte
  // responde "vai faltar?", esta responde "em que dia".
  // Somas por dia montadas uma vez: filtrar os títulos em aberto a cada um
  // dos 90 dias era o item mais caro da página.
  const saidasPorDia = new Map<string, number>();
  for (const t of pagarAberto) {
    const k = t.dataVencimento.toDateString();
    saidasPorDia.set(k, (saidasPorDia.get(k) ?? 0) + saldoAberto(t));
  }
  const entradasPorDia = new Map<string, number>();
  for (const t of receberAberto) {
    const k = t.dataVencimento.toDateString();
    entradasPorDia.set(k, (entradasPorDia.get(k) ?? 0) + saldoAberto(t));
  }
  const agenda = Array.from({ length: dias }, (_, i) => {
    const dia = somarDias(ctx.dataReferencia, i + 1);
    const k = dia.toDateString();
    return { dia, entradas: entradasPorDia.get(k) ?? 0, saidas: saidasPorDia.get(k) ?? 0 };
  }).filter((d) => d.entradas > 0 || d.saidas > 0);

  const ruptura = projecao.find((p) => p.saldoProjetadoCents < 0);
  // O CENÁRIO PESSIMISTA semana a semana (13 semanas ≈ 90 dias): cada
  // cliente no pior dia dele, as saídas pelo vencimento. A semana de menor
  // saldo é onde o caixa aperta; quem cobrar antes é quem, pagando no dia de
  // costume, tira a semana do aperto.
  const pessimista = semanasDeCaixa({
    saldoCents: saldo,
    referencia: ctx.dataReferencia,
    saidas: pagarAberto.map((t) => ({ data: t.dataVencimento, valorCents: saldoAberto(t) })),
    entradas: previsao.previstos.map((p) => ({ data: p.dataPessimista, valorCents: p.saldoCents })),
  });
  const aperto = pessimista.aperto;
  // A semana que importa primeiro é a PRIMEIRA negativa (é até ela que dá
  // para agir); sem nenhuma negativa, a de menor saldo. A de menor saldo
  // aparece junto quando é outra.
  const primeiraNegativa = pessimista.semanas.find((w) => w.saldoCents < 0) ?? null;
  const alvo = primeiraNegativa ?? aperto;
  const cobrarAntes = alvo ? quemCobrarAntes(previsao.previstos, alvo.fim) : [];
  // O drill-down dos cartões de títulos: a lista de contas a pagar e receber,
  // com a mesma empresa e competência desta tela.
  const recorte = new URLSearchParams();
  if (escopo.conexaoId) recorte.set("empresa", escopo.conexaoId);
  if (periodo.competencia) recorte.set("competencia", periodo.competencia);
  const titulosEmAberto = (natureza: "PAGAR" | "RECEBER") => `/titulos?natureza=${natureza}&filtro=ABERTOS${recorte.size ? `&${recorte}` : ""}#lista`;
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

      {/* HORIZONTE DA AGENDA — e SÓ da agenda.
          A tabela de projeção continua mostrando todos os pontos: é tabela e
          cabe. A agenda lista dia a dia, e noventa dias viram dezenas de linhas
          onde se procurava o que vence amanhã.
          O ALERTA DE RUPTURA fica de fora do recorte de propósito. Ele varre os
          noventa dias sempre, escolha qual escolher: esconder "o saldo fica
          negativo em 60 dias" de quem está olhando os próximos 7 seria remover
          justamente o aviso que dá tempo de negociar. Um seletor de janela não
          pode calar um alerta. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-slate-500">Agenda:</span>
        {HORIZONTES_DIAS.map((d) => {
          const q = new URLSearchParams();
          if (escopo.conexaoId) q.set("empresa", escopo.conexaoId);
          if (periodo.competencia) q.set("competencia", periodo.competencia);
          if (d !== 15) q.set("dias", String(d));
          return (
            <a
              key={d}
              href={`/fluxo-caixa${q.toString() ? `?${q}` : ""}`}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                d === dias ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {d}d
            </a>
          );
        })}
      </div>

      <Filtros
        conexoes={ctx.conexoes}
        empresaAtiva={escopo.conexaoId}
        competencias={competenciasDisponiveis(ctx.config.dataInicioBase)}
        competenciaAtiva={periodo.competencia}
        rota="/fluxo-caixa"
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi href="#saldo-por-conta" rotulo="Saldo atual" valor={fmtBRL(saldo)} apoio="Disponível nas contas correntes (banco, Omie ou extrato)" tom={saldo >= 0 ? "neutro" : "ruim"} />
        <Kpi href={titulosEmAberto("PAGAR")} rotulo="A pagar em aberto" valor={fmtBRL(somar(pagarAberto, saldoAberto))} apoio={`Vencido: ${fmtBRL(vencidoPagar)}`} />
        <Kpi
          href={titulosEmAberto("RECEBER")}
          rotulo="A receber em aberto"
          valor={fmtBRL(somar(receberAberto, saldoAberto))}
          apoio={`${fmtNumero(receberAberto.length)} título(s) · realista 30d ${fmtBRL(previsto30)} (contratual ${fmtBRL(contratual30)})`}
        />
        <Kpi
          semDetalhe="indicador de prazo médio (PMR − PMP, no apoio), não é soma de itens"
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

      <Secao
        titulo="Projeção por horizonte"
        descricao={
          "Contratual: cada recebível entra no vencimento. Realista: cada cliente entra quando costuma pagar, pelo histórico dele, " +
          `e o vencido além do padrão fica de fora (${fmtBRL(previsao.incertoTotalCents)} hoje). A diferença entre as duas colunas é o otimismo embutido na primeira. ` +
          "Pessimista: os mesmos recebíveis da realista, cada cliente no pior dia dele."
        }
      >
        <Tabela
          colunas={["Horizonte", "Data", "Entradas contratuais", "Entradas realistas", "Entradas pessimistas", "Saídas previstas", "Saldo contratual", "Saldo realista", "Saldo pessimista"]}
          alinharDireita={[2, 3, 4, 5, 6, 7, 8]}
          linhas={projecao.map((p) => {
            const realista = realistaPorDias.get(p.dias) ?? 0;
            const saldoRealista = saldo + realista - p.saidasCents;
            const pess = pessimistaPorDias.get(p.dias) ?? 0;
            const saldoPessimista = saldo + pess - p.saidasCents;
            return [
              `${p.dias} dias`,
              fmtData(p.data),
              fmtBRL(p.entradasCents),
              fmtBRL(realista),
              fmtBRL(pess),
              fmtBRL(p.saidasCents),
              <span key="s" className={`font-semibold ${p.saldoProjetadoCents < 0 ? "text-red-700" : "text-emerald-700"}`}>
                {fmtBRL(p.saldoProjetadoCents)}
              </span>,
              <span key="r" className={`font-semibold ${saldoRealista < 0 ? "text-red-700" : "text-emerald-700"}`}>
                {fmtBRL(saldoRealista)}
              </span>,
              <span key="p" className={`font-semibold ${saldoPessimista < 0 ? "text-red-700" : "text-emerald-700"}`}>
                {fmtBRL(saldoPessimista)}
              </span>,
            ];
          })}
        />
      </Secao>

      {aperto && alvo && (
        <Secao
          id="aperto"
          titulo={
            primeiraNegativa
              ? `No pessimista, o caixa fica negativo na semana de ${fmtData(primeiraNegativa.inicio)} a ${fmtData(primeiraNegativa.fim)}`
              : `No pessimista, o caixa aperta na semana de ${fmtData(aperto.inicio)} a ${fmtData(aperto.fim)}`
          }
          descricao={`Pessimista: cada cliente paga no pior dia dele — o atraso que ele só passou em um de cada dez pagamentos (sem histórico próprio, ${fmtNumero(previsao.atrasoPadraoPessimistaDias)} dias, o do conjunto). As saídas são as mesmas das outras colunas. ${primeiraNegativa ? "É a primeira semana com saldo negativo nos próximos 90 dias." : "É a semana de menor saldo dos próximos 90 dias."}`}
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <div className={`rounded-lg border p-4 ${alvo.saldoCents < 0 ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
              <p className="text-xs text-slate-600">Saldo no fim da semana</p>
              <p className={`text-2xl font-semibold ${alvo.saldoCents < 0 ? "text-red-700" : "text-slate-900"}`}>{fmtBRL(alvo.saldoCents)}</p>
              <p className="mt-2 text-xs text-slate-600">
                = saldo de hoje {fmtBRL(saldo)} + entradas pessimistas até {fmtData(alvo.fim)} {fmtBRL(alvo.entradasCents)} − saídas até lá {fmtBRL(alvo.saidasCents)}
              </p>
              {aperto !== alvo && (
                <p className="mt-2 text-xs font-medium text-red-800">
                  O ponto mais baixo vem depois: {fmtBRL(aperto.saldoCents)} na semana de {fmtData(aperto.inicio)} a {fmtData(aperto.fim)}.
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-slate-700">O que fazer antes dessa semana</p>
              {cobrarAntes.length > 0 ? (
                <>
                  <p className="mt-1 text-xs text-slate-600">
                    Cobrar antes, de quem no dia de costume pagaria até lá e no pior dia fica para depois. Se estes pagarem como costumam, entram{" "}
                    {fmtBRL(cobrarAntes.reduce((s2, c2) => s2 + c2.valorCents, 0))} antes dessa semana:
                  </p>
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {cobrarAntes.map((c2) => (
                      <li key={c2.cliente} className="flex justify-between gap-3">
                        <span className="text-slate-700">{c2.cliente}</span>
                        <span className="tabular-nums text-slate-900">{fmtBRL(c2.valorCents)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="mt-1 text-xs text-slate-600">Nenhum recebível muda de semana entre o dia de costume e o pior dia: o aperto vem das saídas.</p>
              )}
              <p className="mt-2 text-xs text-slate-600">
                {alvo.saldoCents < 0
                  ? "Depois: renegociar o vencimento dos maiores pagamentos dessa semana; só então comparar antecipação de recebíveis com capital de giro, pelo custo efetivo."
                  : "Mesmo no pior dia de cada cliente o saldo fica positivo: a folga é esse valor."}
              </p>
            </div>
          </div>
        </Secao>
      )}

      <Secao
        titulo="Projeção semanal"
        descricao="O mesmo cenário pessimista, semana a semana: saldo de hoje mais as entradas pessimistas acumuladas, menos as saídas acumuladas."
      >
        <Tabela
          colunas={["Semana", "Entradas até lá", "Saídas até lá", "Saldo pessimista"]}
          alinharDireita={[1, 2, 3]}
          linhas={pessimista.semanas.map((w) => [
            <span key="w" className={w === aperto || w === primeiraNegativa ? "font-semibold" : ""}>
              {fmtData(w.inicio)} a {fmtData(w.fim)}
              {w === primeiraNegativa ? " · fica negativo" : ""}
              {w === aperto ? " · menor saldo" : ""}
            </span>,
            fmtBRL(w.entradasCents),
            fmtBRL(w.saidasCents),
            <span key="s" className={`font-semibold ${w.saldoCents < 0 ? "text-red-700" : "text-emerald-700"}`}>
              {fmtBRL(w.saldoCents)}
            </span>,
          ])}
        />
      </Secao>

      <Secao
        titulo="Previsão por contrato"
        descricao={
          `Cada cliente pelo próprio padrão: mediana do atraso entre vencimento e recebimento nas baixas do ano, e a frequência com que pagou no prazo. ` +
          `Sem ${3} baixas no ano, vale a média de até 24 meses do resumo mensal` +
          (clientesPeloHistorico > 0 ? ` (${fmtNumero(clientesPeloHistorico)} cliente(s), marcados com †)` : "") +
          `; sem histórico nenhum, o padrão do conjunto (${fmtNumero(previsao.atrasoPadraoDias)} dias)` +
          (previsao.clientesSemPadrao > 0 ? ` — é o caso de ${fmtNumero(previsao.clientesSemPadrao)} cliente(s).` : ".") +
          ` "Incerto" é o vencido além do padrão do cliente: precisa de cobrança, não de espera.`
        }
      >
        <Tabela
          colunas={["Cliente", "Em aberto", "Vencido", "Incerto", "Atraso típico", "Pontual", "Previsto 30d", "60d", "90d"]}
          alinharDireita={[1, 2, 3, 4, 5, 6, 7, 8]}
          vazio="Nenhum título a receber em aberto."
          linhas={previsao.clientes.slice(0, 30).map((c) => [
            <span key="n">
              {c.nome}
              {ctx.conexoes.length > 1 && <span className="block text-xs text-slate-400">{c.empresa}</span>}
            </span>,
            fmtBRL(c.emAbertoCents),
            c.vencidoCents > 0 ? <span key="v" className="text-amber-700">{fmtBRL(c.vencidoCents)}</span> : "—",
            c.incertoCents > 0 ? <span key="i" className="font-medium text-red-700">{fmtBRL(c.incertoCents)}</span> : "—",
            c.atrasoMedianoDias === null ? (
              <span key="a" className="text-slate-400">padrão geral</span>
            ) : (
              `${fmtNumero(c.atrasoMedianoDias)} dia(s)${c.origem === "historico" ? " †" : ""}`
            ),
            c.pontualidadePercent === null ? "—" : `${fmtNumero(c.pontualidadePercent)}%`,
            fmtBRL(c.previstoPorHorizonte[30] ?? 0),
            fmtBRL(c.previstoPorHorizonte[60] ?? 0),
            fmtBRL(c.previstoPorHorizonte[90] ?? 0),
          ])}
        />
        {previsao.clientes.length > 30 && (
          <p className="mt-2 text-xs text-slate-500">Os 30 maiores em aberto, de {fmtNumero(previsao.clientes.length)} clientes.</p>
        )}
      </Secao>

      <Secao
        titulo={`Agenda dos próximos ${dias} dias`}
        descricao="Somente dias com movimento previsto."
      >
        <Tabela
          colunas={["Dia", "Entradas", "Saídas", "Líquido"]}
          alinharDireita={[1, 2, 3]}
          vazio={`Nenhum vencimento previsto nos próximos ${dias} dias.`}
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

      {/* A composição do cartão "Saldo atual": as contas correntes, cada uma
          pelo critério da conciliação; o que fica fora da soma, embaixo. */}
      <Secao
        id="saldo-por-conta"
        titulo="Saldo por conta"
        descricao="O disponível nas contas correntes e no caixa: o saldo do banco informado na conciliação, senão o que a Omie calcula, senão o do extrato espelhado. Aplicações, cartões e contas inativas ficam fora da soma."
      >
        <Tabela
          colunas={["Conta", "Empresa", "De onde vem", "Saldo"]}
          alinharDireita={[3]}
          vazio="Nenhuma conta com saldo."
          linhas={[
            ...saldosConsideradosDoContexto(ctx)
              .filter((c) => c.grupo === "disponivel" && !c.inativa)
              .sort((a, b) => b.consideradoCents - a.consideradoCents)
              .map((c) => [
                c.descricao,
                c.empresa,
                <span key="f" className="text-xs text-slate-500">
                  {fonteDoSaldo(c)}
                </span>,
                <span key="s" className={c.consideradoCents < 0 ? "text-red-700" : ""}>
                  {fmtBRL(c.consideradoCents)}
                </span>,
              ]),
            [<strong key="t">Disponível</strong>, "", "", <strong key="v">{fmtBRL(saldo)}</strong>],
            ...saldosConsideradosDoContexto(ctx)
              .filter((c) => c.grupo !== "disponivel" || c.inativa)
              .map((c) => [
                <span key="c" className="text-slate-500">
                  {c.descricao}
                </span>,
                c.empresa,
                <span key="f" className="text-xs text-slate-400">
                  fora da soma ({c.inativa ? "conta inativa" : c.grupo === "aplicacao" ? "aplicação" : "cartão"})
                </span>,
                <span key="s" className="text-slate-500">
                  {fmtBRL(c.consideradoCents)}
                </span>,
              ]),
          ]}
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
