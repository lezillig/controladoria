import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { LINHAS_DRE } from "@/lib/controladoria/dre";
import { LINHAS_OPERACIONAIS, type Rateio, type ResultadoDoCentro } from "@/lib/controladoria/dreCentroCusto";
import { dreCentroCustoNoBanco } from "@/lib/controladoria/dreCentroCustoNoBanco";
import { fmtBRL, fmtData, fmtNumero, fmtPercent } from "@/lib/controladoria/format";
import { badgeClass, larguraPainel } from "@/lib/ui";
import { competenciasDisponiveis, escopoDaPagina, podeAcao } from "../_dados";
import { Kpi, Secao } from "../_componentes";
import Filtros from "../Filtros";
import { ExcluirQuadro, ImportarQuadro, LigarOrigem, NovoVinculo, RemoverVinculo, TipoDoCentro, type OpcaoCentro, type OpcaoOrigem } from "./Ajustes";

// DRE POR CENTRO DE CUSTO — relatório à parte do DRE, para ir ajustando.
//
// O DRE da tela de Custos é a verdade do mês; aqui ele é aberto por centro de
// custo (os da folha de pagamento), com a regra de cada real à vista: o que
// veio por vínculo (projeto, departamento, cliente, categoria), o que veio
// pela folha (pessoas divididas pelo salário do quadro) e o que ficou sem
// centro. A soma dos centros mais o não alocado fecha com o EBIT do DRE.

const ROTULO_LINHA = new Map(LINHAS_DRE.map((l) => [l.chave as string, l.rotulo.replace(/^\(\W\)\s*/, "")]));
const RATEIOS: { valor: Rateio; rotulo: string }[] = [
  { valor: "NENHUM", rotulo: "Sem rateio" },
  { valor: "RECEITA", rotulo: "Apoio rateado pela receita" },
  { valor: "FOLHA", rotulo: "Apoio rateado pela folha" },
];
const resolverRateio = (p?: string): Rateio => (p === "NENHUM" || p === "FOLHA" ? p : "RECEITA");
const cor = (cents: number) => (cents < 0 ? "text-red-700" : cents > 0 ? "text-emerald-700" : "text-slate-500");
const pct = (parte: number, todo: number) => (todo > 0 ? (parte / todo) * 100 : null);
// Na tabela, reais inteiros e "—" no zero: dez colunas de centavos e de
// "R$ 0,00" escondiam os números que importam.
const reais = (cents: number) => (Math.round(cents / 100) === 0 ? "—" : fmtBRL(Math.round(cents / 100) * 100).replace(/,00$/, ""));
const celula = "whitespace-nowrap px-2 py-2 text-right tabular-nums";

export default async function DreCentroCustoPage({ searchParams }: { searchParams: Promise<{ empresa?: string; competencia?: string; rateio?: string }> }) {
  const params = await searchParams;
  const { session, escopo, periodo, config, conexoes } = await escopoDaPagina("custos", params.empresa, params.competencia);
  const podeEditar = await podeAcao(session, "classificar-dre");
  const rateio = resolverRateio(params.rateio);

  const { resultado: r, periodo: mes, competencia, quadros, vinculos, apelido } = await dreCentroCustoNoBanco({
    companyId: session.companyId,
    conexaoId: escopo.conexaoId,
    dataReferencia: periodo.dataReferencia,
    rateio,
    somarRetencoes: config.retencoesNasDeducoes,
  });

  // As pessoas do quadro usado: por cargo para todos; nome e salário só para
  // quem ajusta (é informação de folha, individual).
  const pessoas = quadros.length
    ? await prisma.folhaPessoa.findMany({
        where: { quadroId: { in: quadros.map((q) => q.id) } },
        select: { quadroId: true, nome: true, cargo: true, salarioCents: true, admissao: true, centroCustoCodigo: true, servico: true },
        orderBy: [{ cargo: "asc" }, { nome: "asc" }],
      })
    : [];
  const conexaoDoQuadro = new Map(quadros.map((q) => [q.id, q.conexaoId]));
  const pessoasDoCentro = (c: ResultadoDoCentro) => pessoas.filter((p) => conexaoDoQuadro.get(p.quadroId) === c.conexaoId && p.centroCustoCodigo === c.codigo);
  const historico = await prisma.folhaQuadro.findMany({
    where: { companyId: session.companyId },
    orderBy: [{ competencia: "desc" }, { conexaoId: "asc" }],
    take: 24,
    select: { id: true, conexaoId: true, competencia: true, pessoas: true, salarioCents: true, arquivoNome: true, importadoPorNome: true, importadoEm: true },
  });

  const opcoesCentro: OpcaoCentro[] = r.centros
    .slice()
    .sort((a, b) => a.empresa.localeCompare(b.empresa) || a.descricao.localeCompare(b.descricao))
    .map((c) => ({ id: c.id, conexaoId: c.conexaoId, rotulo: `${c.descricao} (${c.codigo}${conexoes.length > 1 ? ` · ${c.empresa}` : ""})` }));
  const nomeDoCentro = new Map(r.centros.map((c) => [c.id, `${c.descricao} (${c.empresa})`]));

  let origens: OpcaoOrigem[] = [];
  if (podeEditar) {
    const [departamentos, projetos, categorias] = await Promise.all([
      prisma.omieDepartamento.findMany({ where: { companyId: session.companyId, inativo: false }, select: { conexaoId: true, codigo: true, descricao: true }, orderBy: { descricao: "asc" } }),
      prisma.omieProjeto.findMany({ where: { companyId: session.companyId, inativo: false }, select: { conexaoId: true, codigo: true, nome: true }, orderBy: { nome: "asc" }, take: 600 }),
      prisma.omieCategoria.findMany({ where: { companyId: session.companyId, inativa: false, totalizadora: false }, select: { conexaoId: true, codigo: true, descricao: true }, orderBy: { descricao: "asc" } }),
    ]);
    origens = [
      ...departamentos.map((d) => ({ tipo: "DEPARTAMENTO", valor: d.codigo, rotulo: `Departamento · ${d.descricao}`, conexaoId: d.conexaoId })),
      ...projetos.map((p) => ({ tipo: "PROJETO", valor: p.codigo, rotulo: `Projeto · ${p.nome}`, conexaoId: p.conexaoId })),
      ...categorias.map((c) => ({ tipo: "CATEGORIA", valor: c.codigo, rotulo: `Categoria · ${c.descricao}`, conexaoId: c.conexaoId })),
    ];
  }

  const operacionais = r.centros.filter((c) => c.tipo !== "APOIO");
  const apoio = r.centros.filter((c) => c.tipo === "APOIO");
  const receitaTotal = r.centros.reduce((s, c) => s + c.receitaCents, 0) + (r.naoAlocado.porLinha.RECEITA_BRUTA ?? 0) + (r.naoAlocado.porLinha.OUTRAS_RECEITAS ?? 0);
  const pessoasNoQuadro = quadros.reduce((s, q) => s + q.pessoas, 0);
  const competenciaTexto = `${competencia.getUTCFullYear()}-${String(competencia.getUTCMonth() + 1).padStart(2, "0")}`;
  const linkRateio = (v: Rateio) => {
    const q = new URLSearchParams();
    if (params.empresa) q.set("empresa", params.empresa);
    if (params.competencia) q.set("competencia", params.competencia);
    if (v !== "RECEITA") q.set("rateio", v);
    return `/dre-centro-custo${q.size ? `?${q}` : ""}`;
  };

  const linhaDaTabela = (c: ResultadoDoCentro) => (
    <tr key={c.id} className="border-b border-slate-100 hover:bg-slate-50">
      <td className="px-2 py-2">
        <a href={`#cc-${c.id}`} className="font-medium text-slate-800 hover:text-blue-700">
          {c.descricao}
        </a>
        <span className="ml-1 text-xs text-slate-400">
          {c.codigo}
          {conexoes.length > 1 && !escopo.conexaoId ? ` · ${c.empresa}` : ""}
        </span>
      </td>
      <td className={celula}>{c.pessoas || "—"}</td>
      <td className={celula}>{reais(c.receitaCents)}</td>
      <td className={celula}>{reais(c.deducoesCents)}</td>
      <td className={celula}>{reais(c.pessoasCents)}</td>
      <td className={celula}>{reais(c.demaisCents)}</td>
      <td className={`${celula} font-semibold ${cor(c.margemCents)}`}>{reais(c.margemCents)}</td>
      <td className={`${celula} text-slate-500`}>{fmtPercent(pct(c.margemCents, c.receitaCents))}</td>
      {rateio !== "NENHUM" && <td className={celula}>{reais(c.rateioCents)}</td>}
      {rateio !== "NENHUM" && <td className={`${celula} font-semibold ${cor(c.resultadoCents)}`}>{reais(c.resultadoCents)}</td>}
    </tr>
  );
  const soma = (lista: ResultadoDoCentro[], campo: "receitaCents" | "deducoesCents" | "pessoasCents" | "demaisCents" | "margemCents" | "rateioCents" | "resultadoCents") => lista.reduce((s, c) => s + c[campo], 0);
  const linhaDeTotal = (rotulo: string, lista: ResultadoDoCentro[]) => (
    <tr className="border-b border-slate-200 bg-slate-50 font-semibold">
      <td className="px-2 py-2 text-slate-800">{rotulo}</td>
      <td className={celula}>{lista.reduce((s, c) => s + c.pessoas, 0) || "—"}</td>
      <td className={celula}>{reais(soma(lista, "receitaCents"))}</td>
      <td className={celula}>{reais(soma(lista, "deducoesCents"))}</td>
      <td className={celula}>{reais(soma(lista, "pessoasCents"))}</td>
      <td className={celula}>{reais(soma(lista, "demaisCents"))}</td>
      <td className={`${celula} ${cor(soma(lista, "margemCents"))}`}>{reais(soma(lista, "margemCents"))}</td>
      <td className={`${celula} text-slate-500`}>{fmtPercent(pct(soma(lista, "margemCents"), soma(lista, "receitaCents")))}</td>
      {rateio !== "NENHUM" && <td className={celula}>{reais(soma(lista, "rateioCents"))}</td>}
      {rateio !== "NENHUM" && <td className={`${celula} ${cor(soma(lista, "resultadoCents"))}`}>{reais(soma(lista, "resultadoCents"))}</td>}
    </tr>
  );

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">DRE por centro de custo</h1>
        <p className="mt-1 text-sm text-slate-500">
          {competencia.toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" })}
          {periodo.competencia ? "" : ` até ${fmtData(mes.fim)}`}, por competência — o mesmo DRE da tela{" "}
          <Link href="/custos" className="text-blue-700 hover:underline">
            Custos e DRE
          </Link>
          , aberto pelos centros de custo da folha. Cada valor chega a um centro por um vínculo (projeto, departamento, cliente ou categoria da Omie) ou, nas despesas com pessoas, pela folha: o custo de pessoal do mês dividido pelo salário de quem está em cada centro no quadro importado. O resto fica em &ldquo;não alocado&rdquo;, para ser ligado.
        </p>
      </div>

      <Filtros
        conexoes={conexoes}
        empresaAtiva={escopo.conexaoId}
        competencias={competenciasDisponiveis(config.dataInicioBase)}
        competenciaAtiva={periodo.competencia}
        rotuloPeriodoPadrao="Mês em curso"
        extras={{ rateio: params.rateio }}
        rota="/dre-centro-custo"
      />

      <div className="flex flex-wrap gap-2">
        {RATEIOS.map((o) => (
          <Link key={o.valor} href={linkRateio(o.valor)} className={`rounded-full border px-3 py-1 text-xs font-medium ${o.valor === rateio ? "border-blue-700 bg-blue-700 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>
            {o.rotulo}
          </Link>
        ))}
      </div>

      {r.avisos.length > 0 && (
        <ul className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {r.avisos.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Kpi rotulo="EBIT do mês (DRE)" valor={fmtBRL(r.ebitCents)} tom={r.ebitCents < 0 ? "ruim" : "neutro"} apoio={`receita ${fmtBRL(receitaTotal)}`} />
        <Kpi rotulo="Nos centros de custo" valor={fmtBRL(r.alocadoCents)} apoio={`${r.centros.length} centros · ${operacionais.length} operacionais`} />
        <Kpi rotulo="Não alocado" valor={fmtBRL(r.naoAlocado.totalCents)} tom={r.naoAlocado.origens.length > 0 ? "atencao" : "bom"} apoio={`${r.naoAlocado.origens.length} origens para ligar`} />
        <Kpi rotulo="Cobertura" valor={fmtPercent(r.cobertura * 100, 0)} tom={r.cobertura >= 0.8 ? "bom" : r.cobertura >= 0.5 ? "atencao" : "ruim"} apoio="do volume operacional do mês" />
        <Kpi rotulo="Quadro de pessoal" valor={fmtNumero(pessoasNoQuadro)} apoio={quadros.length ? `salários ${fmtBRL(r.centros.reduce((s, c) => s + c.salarioQuadroCents, 0))}` : "nenhuma lista importada"} />
      </div>

      {r.centros.length === 0 ? (
        <Secao titulo="Comece pelo quadro de pessoal" descricao="Os centros de custo nascem da lista de empregados ativos do sistema de folha.">
          {podeEditar ? <ImportarQuadro conexoes={conexoes.map((c) => ({ id: c.id, apelido: c.apelido }))} competencia={competenciaTexto} /> : <p className="text-sm text-slate-500">Peça a quem classifica o DRE para importar a lista de empregados.</p>}
        </Secao>
      ) : (
        <Secao
          titulo="Resultado por centro de custo"
          descricao={`Valores com o sinal do resultado: receita positiva, custo negativo. Margem direta = o que o centro recebe e gasta. ${rateio === "NENHUM" ? "Sem rateio do apoio." : `O resultado dos centros de apoio é rateado entre os operacionais pela ${rateio === "RECEITA" ? "receita" : "folha"}.`}`}
        >
          <div className="-mx-6 overflow-x-auto px-6">
            <table className="w-full min-w-[900px] text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <th className="px-2 py-2">Centro de custo</th>
                  <th className="px-2 py-2 text-right">Pessoas</th>
                  <th className="px-2 py-2 text-right">Receita</th>
                  <th className="px-2 py-2 text-right">Deduções</th>
                  <th className="px-2 py-2 text-right">Pessoal</th>
                  <th className="px-2 py-2 text-right">Demais custos</th>
                  <th className="px-2 py-2 text-right">Margem direta</th>
                  <th className="px-2 py-2 text-right">%</th>
                  {rateio !== "NENHUM" && <th className="px-2 py-2 text-right">Rateio do apoio</th>}
                  {rateio !== "NENHUM" && <th className="px-2 py-2 text-right">Resultado</th>}
                </tr>
              </thead>
              <tbody>
                {operacionais.map(linhaDaTabela)}
                {linhaDeTotal("Operacionais", operacionais)}
                {apoio.map(linhaDaTabela)}
                {apoio.length > 0 && linhaDeTotal("Apoio", apoio)}
                <tr className="border-b border-slate-200">
                  <td className="px-2 py-2 font-medium text-amber-800">
                    <a href="#nao-alocado" className="hover:underline">
                      Não alocado
                    </a>
                  </td>
                  <td />
                  <td className={celula}>{reais((r.naoAlocado.porLinha.RECEITA_BRUTA ?? 0) + (r.naoAlocado.porLinha.OUTRAS_RECEITAS ?? 0))}</td>
                  <td className={celula}>{reais(r.naoAlocado.porLinha.DEDUCOES ?? 0)}</td>
                  <td className={celula}>{reais((r.naoAlocado.porLinha.DESPESA_SALARIOS ?? 0) + (r.naoAlocado.porLinha.DESPESA_SALARIOS_CORPORATIVO ?? 0))}</td>
                  <td className={celula}>
                    {reais(
                      r.naoAlocado.totalCents -
                        (r.naoAlocado.porLinha.RECEITA_BRUTA ?? 0) -
                        (r.naoAlocado.porLinha.OUTRAS_RECEITAS ?? 0) -
                        (r.naoAlocado.porLinha.DEDUCOES ?? 0) -
                        (r.naoAlocado.porLinha.DESPESA_SALARIOS ?? 0) -
                        (r.naoAlocado.porLinha.DESPESA_SALARIOS_CORPORATIVO ?? 0)
                    )}
                  </td>
                  <td className={`${celula} font-semibold ${cor(r.naoAlocado.totalCents)}`}>{reais(r.naoAlocado.totalCents)}</td>
                  <td />
                  {rateio !== "NENHUM" && <td />}
                  {rateio !== "NENHUM" && <td className={`${celula} font-semibold ${cor(r.naoAlocado.totalCents)}`}>{reais(r.naoAlocado.totalCents)}</td>}
                </tr>
                <tr className="bg-slate-100 font-semibold">
                  <td className="px-2 py-2 text-slate-900">= EBIT do mês</td>
                  <td colSpan={5} />
                  <td className={`${celula} ${cor(r.ebitCents)}`}>{reais(r.ebitCents)}</td>
                  <td className={`${celula} text-slate-500`}>{fmtPercent(pct(r.ebitCents, receitaTotal))}</td>
                  {rateio !== "NENHUM" && <td />}
                  {rateio !== "NENHUM" && <td className={`${celula} ${cor(r.ebitCents)}`}>{reais(r.ebitCents)}</td>}
                </tr>
              </tbody>
            </table>
          </div>
          {r.foraDoCentro.totalCents !== 0 && (
            <p className="mt-3 text-xs text-slate-500">
              Abaixo do EBIT, fora dos centros (são da empresa, não de um contrato):{" "}
              {Object.entries(r.foraDoCentro.porLinha)
                .filter(([, v]) => v !== 0)
                .map(([k, v]) => `${ROTULO_LINHA.get(k) ?? k} ${fmtBRL(v)}`)
                .join(" · ")}
              .{r.semCategoriaCents !== 0 && ` Títulos sem categoria (fora do DRE): ${fmtBRL(r.semCategoriaCents)}.`}
            </p>
          )}
        </Secao>
      )}

      {r.naoAlocado.origens.length > 0 && (
        <section id="nao-alocado">
          <Secao
            titulo={`Não alocado — ${fmtBRL(r.naoAlocado.totalCents)}`}
            descricao="Cada linha é uma origem da Omie sem centro de custo (a mais específica que o título tem: projeto, departamento ou cliente/fornecedor). Ligar vale para os meses seguintes também. A mesma origem ligada a vários centros com 100% em cada se divide pela folha deles; com percentuais, pelo percentual."
          >
            <div className="-mx-6 overflow-x-auto px-6">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2">Origem</th>
                    <th className="px-3 py-2">Linha do DRE</th>
                    <th className="px-3 py-2 text-right">Títulos</th>
                    <th className="px-3 py-2 text-right">Valor</th>
                    {podeEditar && <th className="px-3 py-2">Centro de custo</th>}
                  </tr>
                </thead>
                <tbody>
                  {r.naoAlocado.origens.slice(0, 150).map((o) => {
                    const linhas = Object.entries(o.linhas).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
                    return (
                      <tr key={`${o.tipo}|${o.conexaoId}|${o.valor}`} className="border-b border-slate-100 align-top hover:bg-slate-50">
                        <td className="px-3 py-2">
                          {o.rotulo}
                          {conexoes.length > 1 && !escopo.conexaoId && <span className="ml-1 text-xs text-slate-400">{apelido.get(o.conexaoId)}</span>}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-600">
                          {linhas
                            .slice(0, 2)
                            .map(([k]) => ROTULO_LINHA.get(k) ?? k)
                            .join(" · ")}
                          {linhas.length > 2 ? ` +${linhas.length - 2}` : ""}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtNumero(o.titulos)}</td>
                        <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${cor(o.efeitoCents)}`}>{fmtBRL(o.efeitoCents)}</td>
                        {podeEditar && (
                          <td className="px-3 py-2">
                            <LigarOrigem origem={{ tipo: o.tipo, conexaoId: o.conexaoId, valor: o.valor, rotulo: o.rotulo }} centros={opcoesCentro} sugestoes={o.sugestoes} />
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {r.naoAlocado.origens.length > 150 && <p className="mt-2 text-xs text-slate-500">Mostrando as 150 maiores de {r.naoAlocado.origens.length} origens.</p>}
          </Secao>
        </section>
      )}

      {r.centros.length > 0 && (
        <Secao titulo="Cada centro de custo" descricao="De onde veio cada valor (vínculo ou folha), quem está no quadro e as origens ligadas.">
          <div className="space-y-2">
            {r.centros.map((c) => {
              const daPessoa = pessoasDoCentro(c);
              const porCargo = new Map<string, { n: number; salario: number }>();
              for (const p of daPessoa) {
                const k = p.cargo ?? "Sem cargo";
                const x = porCargo.get(k) ?? { n: 0, salario: 0 };
                x.n++;
                x.salario += p.salarioCents;
                porCargo.set(k, x);
              }
              const doCentro = vinculos.filter((v) => v.centroCustoId === c.id);
              const clientes = [...new Set(daPessoa.map((p) => p.servico).filter((s): s is string => !!s))];
              return (
                <details key={c.id} id={`cc-${c.id}`} className="rounded-xl border border-slate-200 p-3">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium text-slate-800">{c.descricao}</span>
                    <span className="text-xs text-slate-400">
                      {c.codigo} · {c.empresa}
                    </span>
                    <span className={`${badgeClass} ${c.tipo === "APOIO" ? "bg-slate-100 text-slate-600" : "bg-blue-50 text-blue-800"}`}>{c.tipo === "APOIO" ? "Apoio" : "Operacional"}</span>
                    <span className={`ml-auto font-semibold tabular-nums ${cor(c.margemCents)}`}>{fmtBRL(c.margemCents)}</span>
                  </summary>
                  <div className="mt-3 grid gap-4 lg:grid-cols-2">
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Linhas do DRE</p>
                      {c.detalhes.length === 0 ? (
                        <p className="text-sm text-slate-500">Nada chegou a este centro no mês.</p>
                      ) : (
                        <table className="w-full text-sm">
                          <tbody>
                            {LINHAS_OPERACIONAIS.filter((l) => (c.porLinha[l] ?? 0) !== 0).map((l) => (
                              <tr key={l} className="border-b border-slate-100 align-top">
                                <td className="py-1 pr-2">
                                  <span className="text-slate-800">{ROTULO_LINHA.get(l) ?? l}</span>
                                  <ul className="text-xs text-slate-500">
                                    {c.detalhes
                                      .filter((d) => d.linha === l)
                                      .slice(0, 8)
                                      .map((d) => (
                                        <li key={`${d.categoria}|${d.via}`}>
                                          {d.descricao} · {d.via === "FOLHA" ? "pela folha" : "por vínculo"} · {fmtBRL(d.efeitoCents)}
                                        </li>
                                      ))}
                                  </ul>
                                </td>
                                <td className={`py-1 text-right tabular-nums ${cor(c.porLinha[l])}`}>{fmtBRL(c.porLinha[l])}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                    <div className="space-y-3">
                      <div>
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Quadro: {c.pessoas} pessoa(s) · salários {fmtBRL(c.salarioQuadroCents)}
                        </p>
                        {clientes.length > 0 && <p className="mb-1 text-xs text-slate-500">Serviço na folha: {clientes.join(" · ")}</p>}
                        {porCargo.size > 0 && (
                          <ul className="text-sm text-slate-700">
                            {[...porCargo.entries()]
                              .sort((a, b) => b[1].n - a[1].n)
                              .map(([cargo, x]) => (
                                <li key={cargo}>
                                  {x.n} × {cargo} <span className="text-xs text-slate-400">· {fmtBRL(x.salario)}</span>
                                </li>
                              ))}
                          </ul>
                        )}
                        {podeEditar && daPessoa.length > 0 && (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-xs text-blue-700">Ver as pessoas</summary>
                            <table className="mt-1 w-full text-xs">
                              <tbody>
                                {daPessoa.map((p, i) => (
                                  <tr key={i} className="border-b border-slate-100">
                                    <td className="py-0.5 pr-2">{p.nome}</td>
                                    <td className="py-0.5 pr-2 text-slate-500">{p.cargo}</td>
                                    <td className="py-0.5 pr-2 text-slate-500">{p.admissao ? fmtData(p.admissao) : ""}</td>
                                    <td className="py-0.5 text-right tabular-nums">{fmtBRL(p.salarioCents)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </details>
                        )}
                      </div>
                      <div>
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Origens ligadas</p>
                        {doCentro.length === 0 ? (
                          <p className="text-xs text-slate-500">Nenhuma — só a folha chega aqui.</p>
                        ) : (
                          <ul className="text-sm text-slate-700">
                            {doCentro.map((v) => (
                              <li key={v.id} className="flex items-center gap-2">
                                <span>
                                  {v.rotuloOrigem ?? `${v.tipoOrigem} ${v.valorOrigem}`}
                                  {v.percentual < 100 ? ` · ${fmtNumero(v.percentual, 0)}%` : ""}
                                </span>
                                {podeEditar && <RemoverVinculo id={v.id} rotulo={v.rotuloOrigem ?? v.valorOrigem} />}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      {podeEditar && (
                        <p className="flex items-center gap-2 text-xs text-slate-500">
                          Tipo: <TipoDoCentro id={c.id} tipo={c.tipo} />
                        </p>
                      )}
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        </Secao>
      )}

      {podeEditar && r.centros.length > 0 && (
        <Secao titulo="Ligar uma origem a um centro" descricao="Para o que não aparece no não alocado deste mês: um projeto (OS), departamento, categoria ou cliente/fornecedor da Omie.">
          <NovoVinculo centros={opcoesCentro} origens={origens} />
        </Secao>
      )}

      <Secao titulo="Quadro de pessoal" descricao="A lista de empregados ativos do sistema de folha, uma por empresa e por mês. Guardamos nome, cargo, centro de custo, serviço, departamento, salário e admissão — CPF, RG e PIS não são gravados.">
        <div className="space-y-3">
          {podeEditar && r.centros.length > 0 && <ImportarQuadro conexoes={conexoes.map((c) => ({ id: c.id, apelido: c.apelido }))} competencia={competenciaTexto} />}
          {historico.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhuma lista importada.</p>
          ) : (
            <ul className="text-sm text-slate-700">
              {historico.map((q) => {
                const rotulo = `${apelido.get(q.conexaoId) ?? "?"} · ${q.competencia.toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" })}`;
                return (
                  <li key={q.id} className="flex flex-wrap items-center gap-x-3">
                    <span className="font-medium">{rotulo}</span>
                    <span className="text-xs text-slate-500">
                      {q.pessoas} pessoas · salários {fmtBRL(q.salarioCents)} · {q.arquivoNome}
                      {q.importadoPorNome ? ` · ${q.importadoPorNome}` : ""} · {q.importadoEm.toLocaleDateString("pt-BR")}
                    </span>
                    {quadros.some((x) => x.id === q.id) && <span className={`${badgeClass} bg-emerald-50 text-emerald-700`}>usado neste relatório</span>}
                    {podeEditar && <ExcluirQuadro id={q.id} rotulo={rotulo} />}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Secao>
    </div>
  );
}
