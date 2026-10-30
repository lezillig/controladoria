import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { contratosComSituacao, type ContratoComSituacao } from "@/lib/frota/contratosDaGestao";
import { controleGeral, ROTULO_PRODUTO, ROTULO_SITUACAO_CONSORCIO, saldoPorVeiculo } from "@/lib/frota/financiamentos";
import { linkDaGestao } from "@/lib/gestao/endereco";
import { fmtBRL, fmtData, fmtNumero } from "@/lib/controladoria/format";
import { larguraPainel } from "@/lib/ui";
import { exigirPermissao, podeAcao } from "../../_dados";
import { Kpi, Secao, Tabela } from "../../_componentes";
import FormAcao from "../FormAcao";
import ConferirParcelas from "./ConferirParcelas";
import { decidirParceiro } from "./actions";

// FINANCIAMENTOS E CONSÓRCIOS CONFERIDOS NA OMIE — os contratos são os da
// gestão (Cadastros › Veículos › Financiamentos, onde se cadastram e se
// importam); aqui, o lado financeiro: o Controle Geral por banco, as cotas
// (contempladas sem o bem = crédito parado), o saldo devedor por placa
// andando com os pagamentos, e o que pede ação (parcela em atraso na Omie,
// parcela que deveria estar lançada e não está, contrato sem ligação).

export const maxDuration = 60;

const VISOES = [
  { chave: "geral", rotulo: "Controle geral" },
  { chave: "contratos", rotulo: "Contratos e cotas" },
  { chave: "placas", rotulo: "Saldo por placa" },
  { chave: "omie", rotulo: "Ligação com a Omie" },
] as const;

export default async function FinanciamentosPage({ searchParams }: { searchParams: Promise<{ ver?: string; produto?: string; inst?: string; q?: string; encerrados?: string }> }) {
  const params = await searchParams;
  const session = await exigirPermissao("financiamentos");
  const podeEditar = await podeAcao(session, "gerir-financiamentos");
  const hoje = new Date();
  const { contratos, gestaoDisponivel } = await contratosComSituacao(session.companyId, hoje);
  const cadastro = linkDaGestao("/cadastros/veiculos/financiamentos");
  const ver = VISOES.find((v) => v.chave === params.ver)?.chave ?? "geral";
  const ativos = contratos.filter((c) => !c.situacao.quitado);
  const cg = controleGeral(contratos.map((c) => ({ ...c, valorCreditadoCents: null, lanceCents: null })));
  const atrasados = ativos.filter((c) => c.situacao.atrasadas.quantidade > 0);
  const naoLancados = ativos.filter((c) => c.situacao.naoLancadas > 0);
  const semOmie = ativos.filter((c) => c.pagamentosOmie.length === 0);
  const prazoVencido = ativos.filter((c) => c.dataFinal && c.dataFinal < hoje);
  const instituicoes = [...new Set(contratos.map((c) => c.instituicao))].sort();
  const href = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ver, produto: params.produto, inst: params.inst, q: params.q, encerrados: params.encerrados, ...extra })) if (v) p.set(k, v);
    return `/frota/financiamentos?${p}`;
  };
  // O drill-down dos cartões: a visão que lista o número, sem os filtros da
  // lista (o cartão é do total, não do recorte).
  const geral = (ancora: string) => `${href({ ver: "geral", produto: "", inst: "", q: "", encerrados: "" })}#${ancora}`;
  const todosOsAtivos = `${href({ ver: "contratos", produto: "", inst: "", q: "", encerrados: "" })}#contratos`;

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Financiamentos e consórcios</h1>
          <p className="mt-1 max-w-4xl text-sm text-slate-500">
            Os contratos e cotas da gestão com as parcelas conferidas nas contas a pagar da Omie: pagas, em atraso, a vencer e as que deveriam estar lançadas. O saldo de cada contrato — e de
            cada veículo — anda com cada pagamento, e volta para a gestão pela integração.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {cadastro && (
            <a href={cadastro} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              Cadastro dos contratos (gestão)
            </a>
          )}
          {podeEditar && gestaoDisponivel && <ConferirParcelas />}
        </div>
      </div>

      {!gestaoDisponivel ? (
        <Secao titulo="A gestão não respondeu">
          <p className="text-sm text-slate-600">
            Os contratos são lidos do sistema de gestão, que não respondeu agora (ou o papel de leitura ainda não tem acesso às tabelas Financiamento e FinanciamentoVeiculo — ver
            docs/papel-leitura-gestao.sql). As ligações com a Omie continuam gravadas; tente de novo em instantes.
          </p>
        </Secao>
      ) : contratos.length === 0 ? (
        <Secao titulo="Nenhum contrato ainda">
          <p className="text-sm text-slate-600">
            Os contratos são cadastrados na gestão, em Cadastros › Veículos › Financiamentos (ali também se importa a planilha “Consórcios e Financiamentos”). Assim que estiverem lá, aparecem aqui
            conferidos com a Omie.
          </p>
        </Secao>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi href={todosOsAtivos} rotulo="Contratos e cotas ativos" valor={fmtNumero(ativos.length)} apoio={`${fmtNumero(contratos.length - ativos.length)} encerrado(s)`} />
            <Kpi href={geral("controle-geral")} rotulo="Parcelas por mês" valor={fmtBRL(cg.total.parcelaMensalCents)} />
            <Kpi href={todosOsAtivos} rotulo="Saldo devedor" valor={fmtBRL(cg.total.saldoCents)} apoio="quitação hoje" />
            <Kpi href={geral("pede-acao")} rotulo="Em atraso na Omie" valor={fmtBRL(cg.total.atrasadoCents)} tom={atrasados.length ? "ruim" : "bom"} apoio={`${atrasados.length} contrato(s)`} />
            <Kpi href={geral("pede-acao")} rotulo="Parcelas não lançadas" valor={fmtNumero(naoLancados.reduce((s, c) => s + c.situacao.naoLancadas, 0))} tom={naoLancados.length ? "atencao" : "bom"} apoio="vencem em 60 dias e não estão na Omie" />
            <Kpi href={geral("cotas-sem-bem")} rotulo="Crédito parado em cotas" valor={fmtBRL(cg.consorcio.semBem.liquidoCents)} apoio={`${cg.consorcio.semBem.cotas} cota(s) contemplada(s) sem o bem`} tom={cg.consorcio.semBem.cotas ? "atencao" : "neutro"} />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {VISOES.map((v) => (
              <Link key={v.chave} href={href({ ver: v.chave })} className={`rounded-full px-3 py-1 text-xs font-medium ${v.chave === ver ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                {v.rotulo}
              </Link>
            ))}
          </div>

          {ver === "geral" && (
            <>
              {(atrasados.length > 0 || naoLancados.length > 0 || prazoVencido.length > 0) && (
                <Secao id="pede-acao" titulo="Pede ação" descricao="Parcela vencida e não paga na Omie; parcela que vence nos próximos 60 dias e não foi lançada nas contas a pagar; contrato com prazo final já passado e ainda aberto.">
                  <Tabela
                    colunas={["Banco / administradora", "Contrato / cota", "O quê"]}
                    linhas={[
                      ...atrasados.map((c) => [c.instituicao, <LinkContrato key="c" c={c} />, <span key="o" className="text-red-700">{c.situacao.atrasadas.quantidade} parcela(s) em atraso · {fmtBRL(c.situacao.atrasadas.valorCents)}</span>]),
                      ...naoLancados.map((c) => [c.instituicao, <LinkContrato key="c" c={c} />, <span key="o" className="text-amber-700">{c.situacao.naoLancadas} parcela(s) a vencer não lançada(s) na Omie</span>]),
                      ...prazoVencido.map((c) => [c.instituicao, <LinkContrato key="c" c={c} />, <span key="o" className="text-amber-700">prazo final {fmtData(c.dataFinal)} já passou — conferir se quitado</span>]),
                    ]}
                  />
                </Secao>
              )}
              <Secao id="controle-geral" titulo="Controle geral" descricao="Por banco e produto, só o que está ativo. Principal = valor financiado (no consórcio, o crédito).">
                <Tabela
                  colunas={["Banco / administradora", "Produto", "Contratos", "Principal", "Parcelas / mês", "Saldo devedor", "Em atraso"]}
                  alinharDireita={[2, 3, 4, 5, 6]}
                  linhas={[
                    ...cg.linhas.map((l) => [
                      <Link key="i" href={href({ ver: "contratos", inst: l.instituicao, produto: l.produto })} className="text-blue-800 hover:underline">{l.instituicao}</Link>,
                      ROTULO_PRODUTO[l.produto] ?? l.produto,
                      fmtNumero(l.contratos),
                      fmtBRL(l.principalCents),
                      fmtBRL(l.parcelaMensalCents),
                      fmtBRL(l.saldoCents),
                      l.atrasadoCents ? <span key="a" className="text-red-700">{fmtBRL(l.atrasadoCents)}</span> : "—",
                    ]),
                    [<strong key="t">Total</strong>, "", <strong key="n">{fmtNumero(cg.total.contratos)}</strong>, <strong key="p">{fmtBRL(cg.total.principalCents)}</strong>, <strong key="m">{fmtBRL(cg.total.parcelaMensalCents)}</strong>, <strong key="s">{fmtBRL(cg.total.saldoCents)}</strong>, <strong key="a">{fmtBRL(cg.total.atrasadoCents)}</strong>],
                  ]}
                />
              </Secao>
              <Secao titulo="Cotas de consórcio" descricao="Não contempladas: crédito ainda por sortear ou lançar. Contempladas sem o bem: crédito liberado e ainda não usado para comprar veículo.">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Kpi href="#cotas-nao-contempladas" rotulo="Não contempladas" valor={fmtNumero(cg.consorcio.naoContempladas.cotas)} apoio={`crédito ${fmtBRL(cg.consorcio.naoContempladas.creditoCents)}`} />
                  <Kpi href="#cotas-sem-bem" rotulo="Contempladas sem o bem" valor={fmtNumero(cg.consorcio.semBem.cotas)} apoio={`crédito ${fmtBRL(cg.consorcio.semBem.creditoCents)}`} />
                  <Kpi href="#cotas-sem-bem" rotulo="Líquido disponível" valor={fmtBRL(cg.consorcio.semBem.liquidoCents)} apoio="crédito − lance, para comprar veículo" />
                  <Kpi href="#cotas-com-bem" rotulo="Contempladas com o bem" valor={fmtNumero(ativos.filter((c) => c.situacaoConsorcio === "contemplada_com_bem").length)} apoio="cotas pagando o veículo já comprado" />
                </div>
                <ListaDeCotas id="cotas-nao-contempladas" titulo="Não contempladas" cotas={ativos.filter((c) => c.produto === "consorcio" && c.situacaoConsorcio === "nao_contemplada")} />
                <ListaDeCotas id="cotas-sem-bem" titulo="Contempladas sem o bem" cotas={ativos.filter((c) => c.produto === "consorcio" && c.situacaoConsorcio === "contemplada_sem_bem")} />
                <ListaDeCotas id="cotas-com-bem" titulo="Contempladas com o bem" cotas={ativos.filter((c) => c.produto === "consorcio" && c.situacaoConsorcio === "contemplada_com_bem")} />
              </Secao>
            </>
          )}

          {ver === "contratos" && (
            <ListaDeContratos contratos={params.encerrados ? contratos : ativos} params={params} instituicoes={instituicoes} href={href} />
          )}

          {ver === "placas" && <SaldoPorPlaca contratos={contratos} />}

          {ver === "omie" && <LigacaoOmie companyId={session.companyId} podeEditar={podeEditar} semOmie={semOmie.length} />}
        </>
      )}
    </div>
  );
}

function LinkContrato({ c }: { c: { id: string; contratoNumero: string | null; grupo: string | null; cota: string | null } }) {
  return (
    <Link href={`/frota/financiamentos/${c.id}`} className="font-mono text-xs text-blue-800 hover:underline">
      {c.contratoNumero ?? `grupo ${c.grupo ?? "?"} / cota ${c.cota ?? "?"}`}
    </Link>
  );
}

type Contratos = ContratoComSituacao[];

// As cotas de uma situação, abertas uma a uma (o drill-down dos cartões de
// consórcio). Crédito = o valor da carta cadastrado na gestão.
function ListaDeCotas({ id, titulo, cotas }: { id: string; titulo: string; cotas: Contratos }) {
  if (cotas.length === 0) return null;
  return (
    <details id={id} className="mt-4 scroll-mt-4">
      <summary className="cursor-pointer text-sm font-medium text-slate-700">
        {titulo} — {fmtNumero(cotas.length)} cota(s), crédito {fmtBRL(cotas.reduce((s, c) => s + Number(c.valorFinanciadoCents ?? 0), 0))}
      </summary>
      <div className="mt-2">
        <Tabela
          colunas={["Administradora", "Grupo / cota", "Veículos", "Crédito", "Parcela", "Saldo"]}
          alinharDireita={[3, 4, 5]}
          linhas={cotas.map((c) => [
            c.instituicao,
            <LinkContrato key="c" c={c} />,
            c.veiculos.length ? c.veiculos.map((v) => v.veiculo.placa ?? "s/ placa").join(", ") : "—",
            fmtBRL(Number(c.valorFinanciadoCents ?? 0)),
            fmtBRL(Number(c.valorParcelaCents ?? 0)),
            fmtBRL(c.situacao.saldoCents ?? 0),
          ])}
        />
      </div>
    </details>
  );
}

function ListaDeContratos({ contratos, params, instituicoes, href }: { contratos: Contratos; params: { produto?: string; inst?: string; q?: string; encerrados?: string }; instituicoes: string[]; href: (e: Record<string, string | undefined>) => string }) {
  const q = (params.q ?? "").trim().toUpperCase();
  const lista = contratos
    .filter((c) => !params.produto || c.produto === params.produto)
    .filter((c) => !params.inst || c.instituicao === params.inst)
    .filter((c) => !q || [c.contratoNumero, c.grupo, c.cota, ...c.veiculos.map((v) => v.veiculo.placa)].some((x) => (x ?? "").toUpperCase().includes(q)));
  return (
    <Secao
      id="contratos"
      titulo={`${fmtNumero(lista.length)} contrato(s) e cota(s)`}
      acao={
        <form action="/frota/financiamentos" className="flex flex-wrap gap-2 text-xs">
          <input type="hidden" name="ver" value="contratos" />
          <select name="produto" defaultValue={params.produto ?? ""} className="rounded-md border border-slate-300 px-2 py-1">
            <option value="">todos os produtos</option>
            {Object.entries(ROTULO_PRODUTO).map(([k, r]) => <option key={k} value={k}>{r}</option>)}
          </select>
          <select name="inst" defaultValue={params.inst ?? ""} className="rounded-md border border-slate-300 px-2 py-1">
            <option value="">todas as instituições</option>
            {instituicoes.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
          <input name="q" defaultValue={params.q ?? ""} placeholder="Contrato, cota, placa…" className="rounded-md border border-slate-300 px-2 py-1" />
          <label className="flex items-center gap-1"><input type="checkbox" name="encerrados" value="1" defaultChecked={!!params.encerrados} /> encerrados</label>
          <button className="rounded-md bg-slate-900 px-2 py-1 font-semibold text-white">Filtrar</button>
        </form>
      }
    >
      <Tabela
        colunas={["Banco / administradora", "Produto", "Contrato / cota", "Veículos", "Pagas", "Próxima", "Parcela", "Saldo", "Omie"]}
        alinharDireita={[6, 7]}
        linhas={lista.slice(0, 500).map((c) => [
          c.instituicao,
          `${ROTULO_PRODUTO[c.produto] ?? c.produto}${c.situacaoConsorcio ? ` · ${ROTULO_SITUACAO_CONSORCIO[c.situacaoConsorcio]}` : ""}`,
          <LinkContrato key="c" c={c} />,
          c.veiculos.length ? c.veiculos.map((v) => v.veiculo.placa ?? "s/ placa").join(", ") : "—",
          c.situacao.pagas !== null && c.parcelas ? `${c.situacao.pagas}/${c.parcelas}` : "—",
          c.situacao.quitado ? "encerrado" : c.situacao.proximoVencimento ? fmtData(c.situacao.proximoVencimento) : "—",
          fmtBRL(Number(c.valorParcelaCents ?? 0)),
          fmtBRL(c.situacao.saldoCents ?? 0),
          c.situacao.atrasadas.quantidade ? <span key="o" className="text-xs font-semibold text-red-700">{c.situacao.atrasadas.quantidade} em atraso</span> : c.pagamentosOmie.length ? <span key="o" className="text-xs text-emerald-700">{c.pagamentosOmie.filter((p) => p.pago).length} paga(s)</span> : <span key="o" className="text-xs text-slate-400">sem ligação</span>,
        ])}
        vazio="Nenhum contrato com esses filtros."
      />
      {lista.length > 500 && <p className="mt-2 text-xs text-slate-500">Mostrando os 500 primeiros; use os filtros.</p>}
      <p className="mt-2 text-xs"><Link href={href({ ver: "geral" })} className="text-slate-500 hover:underline">← controle geral</Link></p>
    </Secao>
  );
}

function SaldoPorPlaca({ contratos }: { contratos: Contratos }) {
  const saldos = saldoPorVeiculo(contratos.map((c) => ({ instituicao: c.instituicao, valorParcelaCents: c.valorParcelaCents, situacao: c.situacao, veiculos: c.veiculos })));
  const veiculos = new Map(contratos.flatMap((c) => c.veiculos.map((v) => [v.veiculoId, v.veiculo] as const)));
  const linhas = [...saldos.entries()].sort((a, b) => b[1].saldoCents - a[1].saldoCents);
  return (
    <Secao titulo="Saldo devedor por placa" descricao="A parte de cada veículo em cada contrato ativo (pela parcela de cada placa, como está na gestão), somada. Atualiza com os pagamentos na Omie.">
      <Tabela
        colunas={["Placa", "Modelo", "Contratos", "Bancos / administradoras", "Parcelas / mês", "Saldo devedor"]}
        alinharDireita={[2, 4, 5]}
        linhas={linhas.map(([id, s]) => {
          const v = veiculos.get(id)!;
          return [<span key="p" className="font-mono text-xs">{v.placa}</span>, v.modelo ?? "—", fmtNumero(s.contratos), s.instituicoes.join(", "), fmtBRL(s.parcelaMensalCents), fmtBRL(s.saldoCents)];
        })}
        vazio="Nenhum veículo com contrato ativo."
      />
    </Secao>
  );
}

async function LigacaoOmie({ companyId, podeEditar, semOmie }: { companyId: string; podeEditar: boolean; semOmie: number }) {
  const vinculos = await prisma.frotaInstituicaoParceiro.findMany({ where: { companyId }, orderBy: [{ instituicao: "asc" }, { produto: "asc" }] });
  const porCriterio = await prisma.frotaParcelaOmie.groupBy({ by: ["criterio"], where: { companyId }, _count: true });
  return (
    <Secao
      titulo="Quem é cada banco na Omie"
      descricao={`O fornecedor das contas a pagar de cada banco ou administradora, sugerido pelo nome. Confirme o certo e recuse o errado — a conferência das parcelas usa só os não recusados. Parcelas ligadas: ${porCriterio.map((p) => `${p._count} por ${p.criterio}`).join(", ") || "nenhuma ainda"}. Contratos ativos sem nenhuma parcela ligada: ${semOmie}.`}
    >
      <Tabela
        colunas={["Instituição", "Produto", "Fornecedor na Omie", "Situação", ""]}
        linhas={vinculos.map((v) => [
          v.instituicao,
          ROTULO_PRODUTO[v.produto] ?? v.produto,
          v.parceiroNome ?? v.parceiroCodigo,
          v.rejeitado ? <span key="s" className="text-xs text-slate-400">recusado</span> : v.confirmado ? <span key="s" className="text-xs text-emerald-700">confirmado</span> : <span key="s" className="text-xs text-amber-700">sugerido</span>,
          podeEditar ? (
            <div key="a" className="flex gap-2">
              {!v.confirmado && (
                <FormAcao acao={decidirParceiro} rotulo="Confirmar" botaoClasse="rounded bg-emerald-700 px-2 py-0.5 text-[11px] font-semibold text-white">
                  <input type="hidden" name="id" value={v.id} />
                  <input type="hidden" name="decisao" value="confirmar" />
                </FormAcao>
              )}
              {!v.rejeitado && (
                <FormAcao acao={decidirParceiro} rotulo="Não é este" botaoClasse="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-700">
                  <input type="hidden" name="id" value={v.id} />
                  <input type="hidden" name="decisao" value="recusar" />
                </FormAcao>
              )}
            </div>
          ) : null,
        ])}
        vazio="Ainda não conferido. Use “Conferir parcelas com a Omie”."
      />
    </Secao>
  );
}
