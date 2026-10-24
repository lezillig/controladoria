import Link from "next/link";
import { conferenciaDeOsNoBanco } from "@/lib/controladoria/conferenciaDeOsNoBanco";
import type { ProjetoConferido } from "@/lib/controladoria/conferenciaDeOs";
import { fmtBRL, fmtData, fmtNumero, fmtPercent } from "@/lib/controladoria/format";
import { larguraPainel } from "@/lib/ui";
import { escopoDaPagina, podeAcao } from "../_dados";
import { Kpi, Secao, SeletorEmpresa, Tabela } from "../_componentes";

// CONFERÊNCIA DE OS — o projeto das contas a pagar contra o das contas a
// receber. Ver src/lib/controladoria/conferenciaDeOs.ts.

// 0 = desde o início da base: a investigação do histórico.
const PERIODOS = [1, 3, 6, 12, 0];
const LISTA = 60;
const lista = (l: string[], n = 3) => (l.length === 0 ? "—" : l.slice(0, n).join(", ") + (l.length > n ? ` +${l.length - n}` : ""));

export default async function ConferenciaOsPage({ searchParams }: { searchParams: Promise<{ empresa?: string; meses?: string }> }) {
  const params = await searchParams;
  const { session, escopo, periodo, conexoes, config } = await escopoDaPagina("titulos", params.empresa);
  const meses = params.meses !== undefined && PERIODOS.includes(Number(params.meses)) ? Number(params.meses) : 3;
  const ate = periodo.dataReferencia;
  const desde = meses === 0 ? config.dataInicioBase : new Date(ate.getFullYear(), ate.getMonth() - (meses - 1), 1);
  const podeInvestigar = await podeAcao(session, "investigar");
  const r = await conferenciaDeOsNoBanco({ companyId: session.companyId, conexaoId: escopo.conexaoId, desde, ate });

  const rota = (m: number) => {
    const q = new URLSearchParams();
    if (params.empresa) q.set("empresa", params.empresa);
    if (m !== 3) q.set("meses", String(m));
    return `/conferencia-os${q.size ? `?${q}` : ""}`;
  };
  const rotaEmpresa = meses !== 3 ? `/conferencia-os?meses=${meses}` : "/conferencia-os";
  const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : null);
  const { pagar, receber } = r.cobertura;
  const recente = (d: Date | null) => !!d && ate.getTime() - d.getTime() < 31 * 86_400_000;

  const investigar = (p: ProjetoConferido, motivo: string) =>
    podeInvestigar ? (
      <Link
        key="ia"
        className="whitespace-nowrap text-xs text-blue-700 hover:underline"
        href={`/auditoria/investigar?pergunta=${encodeURIComponent(
          `Investigue a OS (projeto) ${p.nome} da ${p.empresas.join(" e ")} (código do projeto na Omie: ${p.codigos.join(", ")}). ${motivo} Custo lançado ${fmtBRL(p.custoCents)}, cobrança ${fmtBRL(p.receitaCents)}. Os custos e a cobrança estão coerentes com a OS? Há sinal de erro de lançamento, projeto trocado, duplicidade ou fraude? Compare com o histórico do fornecedor e do cliente.`
        )}`}
      >
        Investigar
      </Link>
    ) : null;
  const pctTexto = (v: number | null) => (v === null ? "—" : fmtPercent(v, 1));

  const linhaProjeto = (p: ProjetoConferido, comReceita = true) => [
    <span key="n" className="font-medium text-slate-800">
      {p.nome}
      {p.empresas.length > 1 && <span className="ml-1 text-xs text-amber-700">({p.empresas.join(" + ")})</span>}
    </span>,
    lista(p.fornecedores),
    comReceita ? lista(p.clientes) : null,
    fmtBRL(p.custoCents),
    comReceita ? fmtBRL(p.receitaCents) : null,
    comReceita ? <span className={p.margemCents < 0 ? "font-semibold text-red-700" : "text-emerald-700"}>{fmtBRL(p.margemCents)}</span> : null,
    <span key="d" className={recente(p.ultimoCusto) ? "text-amber-700" : ""}>{p.ultimoCusto ? fmtData(p.ultimoCusto) : "—"}</span>,
    lista([...p.osDoPagar, ...p.osDoReceber.filter((o) => !p.osDoPagar.includes(o))], 4),
    ...(podeInvestigar ? [investigar(p, comReceita ? "Ela fechou com prejuízo." : "Tem custo e nenhuma cobrança.")] : []),
  ].filter((c) => c !== null);
  const taxas = [...r.taxaImpostos.entries()].map(([cx, t]) => `${r.empresa.get(cx) ?? "?"} ${fmtPercent(t * 100, 2)}`).join(" · ");
  const col = (l: string[]) => (podeInvestigar ? [...l, ""] : l);

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Conferência de OS (projetos)</h1>
        <p className="mt-1 text-sm text-slate-500">
          De {fmtData(desde)} a {fmtData(ate)}, por competência. O projeto da Omie é a OS: o custo (terceiro, combustível, pedágio) e a cobrança da mesma viagem saem nele. Aqui o projeto das contas a pagar é cruzado com o das contas a receber, e a ordem de serviço (aba Diversos) confere se a mesma OS não caiu em projetos diferentes.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <SeletorEmpresa conexoes={conexoes} ativa={escopo.conexaoId} rota={rotaEmpresa} />
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-slate-500">Período:</span>
          {PERIODOS.map((m) => (
            <Link key={m} href={rota(m)} className={`rounded-full px-3 py-1 text-xs font-medium ${m === meses ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
              {m === 1 ? "Mês atual" : m === 0 ? "Desde o início" : `${m} meses`}
            </Link>
          ))}
        </div>
      </div>

      {r.pagarConferidos.total > 0 && r.pagarConferidos.conferidos < r.pagarConferidos.total && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          O projeto das contas a pagar está sendo trazido da Omie pela sincronização diária: {fmtNumero(r.pagarConferidos.conferidos)} de {fmtNumero(r.pagarConferidos.total)} títulos a pagar do período já conferidos (
          {fmtPercent(pct(r.pagarConferidos.conferidos, r.pagarConferidos.total), 0)}). Até completar, &ldquo;custo sem projeto&rdquo; e &ldquo;cobrança sem custo&rdquo; estão maiores do que são.
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi rotulo="A pagar com projeto" valor={fmtPercent(pct(pagar.comProjetoCents, pagar.cents), 0)} apoio={`${fmtNumero(pagar.comProjeto)} de ${fmtNumero(pagar.titulos)} títulos · ${fmtNumero(pagar.comOs)} com OS`} tom={pct(pagar.comProjetoCents, pagar.cents) === null ? "neutro" : (pct(pagar.comProjetoCents, pagar.cents) ?? 0) >= 60 ? "bom" : "atencao"} />
        <Kpi rotulo="A receber com projeto" valor={fmtPercent(pct(receber.comProjetoCents, receber.cents), 0)} apoio={`${fmtNumero(receber.comProjeto)} de ${fmtNumero(receber.titulos)} títulos · ${fmtNumero(receber.comOs)} com OS`} />
        <Kpi rotulo="Custo sem cobrança" valor={fmtBRL(r.custoSemReceita.reduce((s, p) => s + p.custoCents, 0))} apoio={`${r.custoSemReceita.length} projetos`} tom={r.custoSemReceita.length > 0 ? "ruim" : "bom"} />
        <Kpi rotulo="OS com prejuízo" valor={fmtBRL(r.comPrejuizo.reduce((s, p) => s + p.resultadoCents, 0))} apoio={`${r.comPrejuizo.length} OS faturadas`} tom={r.comPrejuizo.length > 0 ? "ruim" : "bom"} />
      </div>

      <Secao
        titulo={`1. OS faturada com prejuízo — ${r.comPrejuizo.length}`}
        descricao={`Receita a receber − tributos sobre a receita − despesas do a pagar, no mesmo projeto. Tributos pela taxa efetiva de deduções do DRE no período (${taxas || "sem receita no período"}).`}
      >
        <Tabela
          colunas={col(["Projeto", "Clientes", "Fornecedores", "Receita", "Tributos", "Custo", "Resultado", "%", "OS"])}
          alinharDireita={[3, 4, 5, 6, 7]}
          linhas={r.comPrejuizo.slice(0, LISTA).map((p) => [
            <span key="n" className="font-medium text-slate-800">
              {p.nome}
              {p.empresas.length > 1 && <span className="ml-1 text-xs text-amber-700">({p.empresas.join(" + ")})</span>}
            </span>,
            lista(p.clientes),
            lista(p.fornecedores),
            fmtBRL(p.receitaCents),
            fmtBRL(p.impostosCents),
            fmtBRL(p.custoCents),
            <span key="r" className="font-semibold text-red-700">{fmtBRL(p.resultadoCents)}</span>,
            pctTexto(p.resultadoPercent),
            lista([...p.osDoPagar, ...p.osDoReceber.filter((o) => !p.osDoPagar.includes(o))], 4),
            ...(podeInvestigar ? [investigar(p, "Ela fechou com prejuízo depois dos tributos.")] : []),
          ])}
          vazio="Nenhuma OS faturada com prejuízo no período."
        />
      </Secao>

      <Secao titulo={`2. OS com despesa e sem cobrança (não faturada) — ${r.custoSemReceita.length}`} descricao="O projeto tem conta a pagar no período e nenhuma conta a receber: serviço prestado e não faturado, ou custo lançado no projeto errado. Data em laranja: custo do último mês, que ainda pode faturar no mês seguinte (a auditoria só aponta depois de 30 dias, regra CR-OS-NAO-FATURADA).">
        <Tabela
          colunas={col(["Projeto", "Fornecedores", "Custo", "Último custo", "OS"])}
          alinharDireita={[2]}
          linhas={r.custoSemReceita.slice(0, LISTA).map((p) => linhaProjeto(p, false))}
          vazio="Nenhuma OS com despesa e sem cobrança."
        />
      </Secao>

      <Secao titulo="3. Inconsistências entre as OS" descricao="Lançamentos que não fecham entre si: a mesma OS em projetos diferentes, o mesmo documento duas vezes, a OS muito abaixo do padrão do cliente, o custo de operação sem OS e a OS cobrada sem custo.">
        <div className="space-y-6">
          <div>
            <h3 className="mb-1 text-sm font-semibold text-slate-800">Mesma OS em projetos diferentes — {r.osEmProjetosDiferentes.length}</h3>
            <p className="mb-2 text-xs text-slate-500">A ordem de serviço (aba Diversos) aparece em mais de um projeto, no a pagar, no a receber ou entre os dois: um dos lançamentos está no projeto errado.</p>
            <Tabela
              colunas={["OS", "Empresa", "Projetos"]}
              linhas={r.osEmProjetosDiferentes.slice(0, LISTA).map((o) => [o.os, o.empresa, o.projetos.map((p) => `${p.nome} (${p.natureza}, ${fmtBRL(p.cents)})`).join(" · ")])}
              vazio={pagar.comOs + receber.comOs === 0 ? "Nenhum título com ordem de serviço no período." : "Nenhuma OS em mais de um projeto."}
            />
          </div>
          <div>
            <h3 className="mb-1 text-sm font-semibold text-slate-800">Documento em duplicidade — {r.duplicidades.length}</h3>
            <p className="mb-2 text-xs text-slate-500">Mesmo fornecedor (ou cliente), mesmo número de documento, mesma parcela e mesmo valor em mais de um título de OS: pagamento ou cobrança em dobro.</p>
            <Tabela
              colunas={["Lado", "Empresa", "Parceiro", "Documento", "Valor", "Vezes", "Projetos"]}
              alinharDireita={[4, 5]}
              linhas={r.duplicidades.slice(0, LISTA).map((d) => [d.natureza, d.empresa, d.parceiro, d.documento, fmtBRL(d.valorCents), d.vezes, lista(d.projetos, 4)])}
              vazio="Nenhum documento repetido."
            />
          </div>
          <div>
            <h3 className="mb-1 text-sm font-semibold text-slate-800">Resultado fora do padrão do cliente — {r.foraDoPadrao.length}</h3>
            <p className="mb-2 text-xs text-slate-500">OS com resultado 30 pontos ou mais abaixo da mediana das OS do mesmo cliente (com pelo menos 4 OS para comparar): custo de outra OS lançado aqui, cobrança a menor ou preço errado.</p>
            <Tabela
              colunas={col(["Projeto", "Cliente", "Resultado", "%", "Mediana do cliente", "OS do cliente"])}
              alinharDireita={[2, 3, 4, 5]}
              linhas={r.foraDoPadrao.slice(0, LISTA).map((f) => [
                f.projeto.nome,
                f.cliente,
                fmtBRL(f.projeto.resultadoCents),
                pctTexto(f.projeto.resultadoPercent),
                pctTexto(f.medianaPercent),
                f.osDoCliente,
                ...(podeInvestigar ? [investigar(f.projeto, `O resultado dela (${pctTexto(f.projeto.resultadoPercent)}) está muito abaixo da mediana das OS do cliente ${f.cliente} (${pctTexto(f.medianaPercent)}).`)] : []),
              ])}
              vazio="Nenhuma OS fora do padrão do cliente."
            />
          </div>
          <div>
            <h3 className="mb-1 text-sm font-semibold text-slate-800">Custo de operação sem projeto — {r.pagarSemProjeto.length} fornecedor(es)</h3>
            <p className="mb-2 text-xs text-slate-500">Contas a pagar das linhas de operação (custo do serviço, veículos, terceiros e despesas gerais) sem projeto: custo que não chega a nenhuma OS.</p>
            <Tabela
              colunas={["Fornecedor", "Categoria", "Empresa", "Títulos", "Valor", "Última competência"]}
              alinharDireita={[3, 4]}
              linhas={r.pagarSemProjeto.slice(0, LISTA).map((x) => [x.parceiro, x.categoria, r.empresa.get(x.conexaoId) ?? "?", fmtNumero(x.titulos), fmtBRL(x.cents), x.ultimaCompetencia ? fmtData(x.ultimaCompetencia) : "—"])}
              vazio="Todo o custo de operação do período tem projeto."
            />
          </div>
          <div>
            <h3 className="mb-1 text-sm font-semibold text-slate-800">Cobrança sem custo lançado — {r.receitaSemCusto.length}</h3>
            <p className="mb-2 text-xs text-slate-500">OS faturada sem nenhuma conta a pagar no projeto. Normal na frota própria quando o custo não é lançado por OS; suspeito quando a OS foi feita por terceiro.</p>
            <Tabela
              colunas={["Projeto", "Clientes", "Cobrança", "Última cobrança", "OS"]}
              alinharDireita={[2]}
              linhas={r.receitaSemCusto.slice(0, LISTA).map((p) => [p.nome, lista(p.clientes), fmtBRL(p.receitaCents), p.ultimaReceita ? fmtData(p.ultimaReceita) : "—", lista(p.osDoReceber, 4)])}
              vazio="Nenhuma."
            />
          </div>
        </div>
      </Secao>

      <Secao titulo="4. Investigação do histórico" descricao="Para procurar erros e fraudes no passado: escolha o período “Desde o início” acima, e use “Investigar” em cada OS — a IA abre os títulos da OS, o histórico do fornecedor e do cliente e diz o que não fecha (cada pergunta tem custo). A auditoria diária também passa a apontar a OS não faturada (CR-OS-NAO-FATURADA) agora que o projeto do a pagar vem da Omie.">
        <div className="flex flex-wrap gap-3 text-sm">
          {meses !== 0 && (
            <Link href={rota(0)} className="rounded-md border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50">
              Ver desde o início da base
            </Link>
          )}
          {podeInvestigar && (
            <Link
              href={`/auditoria/investigar?pergunta=${encodeURIComponent(
                `Investigue o histórico das ordens de serviço (projetos da Omie) desde ${fmtData(desde)}: OS com custo e sem cobrança, OS com prejuízo, a mesma OS em projetos diferentes e documentos pagos em dobro. Concentre nos fornecedores terceirizados (ex.: TRANSCOMIN) e diga quais casos parecem erro de lançamento e quais merecem apuração de fraude, com os títulos que sustentam cada um. Maiores casos de custo sem cobrança: ${r.custoSemReceita
                  .slice(0, 8)
                  .map((p) => `${p.nome} (${fmtBRL(p.custoCents)})`)
                  .join(", ") || "nenhum"}.`
              )}`}
              className="rounded-md border border-blue-200 px-3 py-1.5 font-medium text-blue-800 hover:bg-blue-50"
            >
              Investigar o histórico com a IA
            </Link>
          )}
          <Link href="/auditoria" className="rounded-md border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50">
            Achados da auditoria
          </Link>
        </div>
      </Secao>
    </div>
  );
}
