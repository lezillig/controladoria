import { ALIQUOTAS, ROTULO_TRATAMENTO, type Tratamento } from "@/lib/lucroReal/catalogo";
import { apurarLucroReal, ROTULO_NATUREZA, type Natureza } from "@/lib/lucroReal/apuracao";
import { dozeMesesFechados, insumosDoLucroReal } from "@/lib/lucroReal/noBanco";
import { fmtBRL, fmtData, fmtPercent } from "@/lib/controladoria/format";
import { badgeClass, larguraPainel } from "@/lib/ui";
import { escopoDaPagina } from "../_dados";
import { Kpi, Secao, Tabela } from "../_componentes";

// AUDITORIA DE LUCRO REAL — a Azul em 2027.
//
// A Azul entra no Lucro Real em janeiro de 2027 (Conformidade › Transição), e a
// folha da MCZ passa para ela no mesmo movimento. Esta tela apura, sobre os
// lançamentos da Omie dos últimos doze meses, o lucro real que esse arranjo
// teria dado: o que a lei aceita como despesa, o que precisa ser adicionado, o
// que está sem o documento que sustenta a dedução — e as formas lícitas de
// pagar menos, cada uma com a norma e o que precisa existir para valer.
//
// Fica em Controle e auditoria, com a permissão de Conformidade: é a mesma
// gente que cuida da transição de regime.

export const maxDuration = 60;

const reais = (cents: number) => fmtBRL(Math.round(cents / 100) * 100).replace(/,00$/, "");
const corTratamento: Record<Tratamento, string> = {
  DEDUTIVEL: "bg-emerald-100 text-emerald-800",
  ADICAO: "bg-red-100 text-red-800",
  LIMITE: "bg-amber-100 text-amber-800",
  NAO_E_DESPESA: "bg-slate-200 text-slate-700",
  VERIFICAR: "bg-amber-100 text-amber-800",
};
const corNatureza: Record<Natureza, string> = {
  PERMANENTE: "bg-emerald-100 text-emerald-800",
  ANTECIPA: "bg-sky-100 text-sky-800",
  DIRECIONA: "bg-violet-100 text-violet-800",
  PROTEGE: "bg-amber-100 text-amber-800",
  REDUZ_CUSTO: "bg-emerald-100 text-emerald-800",
  CUSTO_NOVO: "bg-red-100 text-red-800",
};

const numero = (v: string | undefined) => {
  const n = Number(String(v ?? "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
};

export default async function LucroRealPage({ searchParams }: { searchParams: Promise<{ pl?: string; tjlp?: string }> }) {
  const params = await searchParams;
  const { session, conexoes } = await escopoDaPagina("conformidade");
  // Só a Azul; a MCZ entra com o custo de pessoas (a folha passa para a Azul em 2027).
  const empresa = conexoes.find((c) => /azul/i.test(`${c.apelido} ${c.nome}`)) ?? conexoes.find((c) => c.papelNoGrupo !== "CORPORATIVO") ?? null;
  const corporativa = conexoes.find((c) => c.papelNoGrupo === "CORPORATIVO" && c.id !== empresa?.id) ?? null;
  if (!empresa) {
    return <p className="text-sm text-slate-500">Nenhuma empresa operacional cadastrada nas conexões Omie.</p>;
  }

  const hoje = new Date();
  const periodo = dozeMesesFechados(hoje);
  const plReais = numero(params.pl);
  const tjlpPct = numero(params.tjlp);
  const insumos = await insumosDoLucroReal({
    companyId: session.companyId,
    empresa: { id: empresa.id, apelido: empresa.apelido },
    corporativa: corporativa ? { id: corporativa.id, apelido: corporativa.apelido } : null,
    periodo,
    hoje,
    jcp: { plCents: plReais ? Math.round(plReais * 100) : null, tjlp: tjlpPct ? tjlpPct / 100 : null },
  });
  const r = apurarLucroReal(insumos);
  const economia = r.oportunidades.reduce((a, o) => a + Math.max(0, o.economiaCents ?? 0), 0);
  const pendente = r.pendencias.reduce((a, p) => a + p.cents, 0);
  const nomeCorp = insumos.corporativa ?? "corporativa";

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Auditoria de lucro real — {insumos.empresa}</h1>
        <p className="mt-1 text-sm text-slate-500">
          Os lançamentos da Omie de {periodo.rotulo}, por competência, como a {insumos.empresa} apuraria no Lucro Real: a {insumos.empresa} com o
          custo de pessoas da {nomeCorp} (a folha passa para a {insumos.empresa} em 2027), sem o que uma empresa paga à outra. O que a lei aceita
          como despesa, o que precisa ser adicionado, o que está sem documento, e as formas lícitas de pagar menos.
        </p>
      </div>

      {!r.presumido.disponivel && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Receita de {reais(r.receitaBrutaCents + Math.max(0, r.outrasReceitasCents))} em doze meses: acima de R$ 78 milhões no ano, o Lucro Real é
          obrigatório no ano seguinte (Lei 9.718/1998, art. 14, I). O Presumido aparece abaixo só como referência.
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Kpi rotulo="Lucro real estimado" valor={reais(r.lucroRealCents)} apoio="12 meses" tom={r.lucroRealCents >= 0 ? "neutro" : "atencao"} />
        <Kpi rotulo="IRPJ + CSLL no Real" valor={reais(r.real.totalCents)} apoio={`${fmtPercent(r.receitaBrutaCents > 0 ? (r.real.totalCents / r.receitaBrutaCents) * 100 : 0, 1)} da receita`} />
        <Kpi
          rotulo="No Presumido"
          valor={reais(r.presumido.totalCents)}
          apoio={r.presumido.disponivel ? "mesma receita, com a LC 224/2025" : "referência — não é opção"}
          tom={r.presumido.totalCents < r.real.totalCents ? "atencao" : "neutro"}
        />
        <Kpi rotulo="Economia identificada" valor={reais(economia)} apoio="por ano, se os requisitos forem cumpridos" tom="bom" />
        <Kpi rotulo="Despesa sem documento" valor={reais(pendente)} apoio="glosável numa fiscalização" tom={pendente > 0 ? "ruim" : "bom"} />
      </div>

      <Secao
        titulo="Do resultado ao lucro real"
        descricao="O resultado da tela de Custos e DRE (até o resultado antes dos investimentos), corrigido para o que a contabilidade de competência apuraria, e as adições do e-Lalur."
      >
        <table className="min-w-full text-sm">
          <tbody>
            <LinhaQuadro rotulo="Resultado gerencial" valor={r.lucroGerencialCents} forte />
            {r.ajustesDaBase.map((a) => (
              <LinhaQuadro key={a.codigo} rotulo={a.rotulo} valor={a.cents} explicacao={a.explicacao} />
            ))}
            <LinhaQuadro rotulo="= Lucro contábil estimado" valor={r.lucroContabilCents} forte />
            {r.adicoes.map((a) => (
              <LinhaQuadro key={a.codigo} rotulo={a.rotulo} valor={a.cents} explicacao={a.explicacao} />
            ))}
            <LinhaQuadro rotulo="= Lucro real estimado" valor={r.lucroRealCents} forte />
            <LinhaQuadro rotulo="IRPJ (15%)" valor={r.real.irpjCents} />
            <LinhaQuadro rotulo="Adicional de IRPJ (10% acima de R$ 240 mil no ano)" valor={r.real.adicionalCents} />
            <LinhaQuadro rotulo="CSLL (9%)" valor={r.real.csllCents} />
            <LinhaQuadro rotulo="= IRPJ + CSLL no Lucro Real" valor={r.real.totalCents} forte />
          </tbody>
        </table>
        <div className="mt-4 grid gap-4 text-sm lg:grid-cols-2">
          <div className="rounded-lg border border-slate-200 p-4">
            <p className="font-semibold text-slate-800">Lucro Presumido, mesma receita</p>
            <p className="mt-1 text-slate-600">
              Base do IRPJ {reais(r.presumido.baseCents)} (16% da receita, 17,6% sobre o que passa de R$ 5 milhões no ano, mais as receitas
              financeiras e outras); base da CSLL {reais(r.presumido.baseCsllCents)}. IRPJ + adicional + CSLL: <strong>{reais(r.presumido.totalCents)}</strong>.
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Acréscimo de 10% nos percentuais de presunção pela LC 224/2025 (IN RFB 2.305/2025) — conferir a regra de cálculo com a contabilidade.
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 p-4 text-slate-600">
            <p className="font-semibold text-slate-800">O que está nesta base</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>Receita bruta de {reais(r.receitaBrutaCents)}; outras receitas e financeiras, {reais(r.outrasReceitasCents)}.</li>
              <li>
                Eliminado entre as empresas: {reais(insumos.intercompanyEliminado.receitaCents)} de receita e{" "}
                {reais(insumos.intercompanyEliminado.despesaCents)} de despesa.
              </li>
              <li>
                Da {nomeCorp}, só pessoas: {reais(insumos.itens.filter((i) => i.origem === "PESSOAS_CORPORATIVA").reduce((a, i) => a + Math.abs(i.valorCents), 0))}. Ficou
                fora o resto dela (Simples, estrutura): {reais(insumos.corporativaForaCents)}.
              </li>
              <li>Sem as provisões, a depreciação de outros bens e os ajustes que só a contabilidade lança. É estimativa para decidir; o número que vale é o do e-Lalur.</li>
            </ul>
          </div>
        </div>
      </Secao>

      <Secao
        titulo="Oportunidades lícitas"
        descricao="Do que reduz o imposto de forma permanente ao que só antecipa a dedução. Cada uma com o que precisa existir para valer numa fiscalização. As marcadas “conferir” dependem de confirmação da assessoria antes de virar procedimento."
      >
        <form method="get" action="/lucro-real" className="mb-4 flex flex-wrap items-end gap-2 text-sm">
          <label className="flex flex-col text-xs text-slate-500">
            Patrimônio líquido (R$)
            <input name="pl" defaultValue={params.pl ?? ""} placeholder="do último balanço" className="mt-1 w-44 rounded-md border border-slate-300 px-2 py-1 text-sm" />
          </label>
          <label className="flex flex-col text-xs text-slate-500">
            TJLP do período (% a.a.)
            <input name="tjlp" defaultValue={params.tjlp ?? ""} placeholder="ex.: 7,5" className="mt-1 w-32 rounded-md border border-slate-300 px-2 py-1 text-sm" />
          </label>
          <button type="submit" className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700">
            Calcular o JCP
          </button>
        </form>
        <div className="space-y-3">
          {r.oportunidades.map((o) => (
            <div key={o.codigo} className="rounded-lg border border-slate-200 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-900">{o.titulo}</span>
                <span className={`${badgeClass} ${corNatureza[o.natureza]}`}>{ROTULO_NATUREZA[o.natureza]}</span>
                {o.conferir && <span className={`${badgeClass} bg-amber-50 text-amber-800`}>conferir</span>}
                {o.economiaCents !== null && o.economiaCents !== 0 && (
                  <span className={`ml-auto text-sm font-semibold ${o.economiaCents > 0 ? "text-emerald-700" : "text-red-700"}`}>
                    {o.economiaCents > 0 ? `${reais(o.economiaCents)} a menos por ano` : `${reais(-o.economiaCents)} a mais por ano`}
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm text-slate-700">{o.como}</p>
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-slate-600">
                {o.requisitos.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-slate-500">{o.baseLegal}</p>
            </div>
          ))}
        </div>
      </Secao>

      <Secao
        titulo="Despesa sem o documento que sustenta a dedução"
        descricao={`Títulos a pagar da ${insumos.empresa} no período (sem os pagos à ${nomeCorp}). No Lucro Real cada um destes é base glosável; corrigir na Omie agora custa menos que defender depois.`}
      >
        {r.coberturaDocumental && (
          <p className="mb-3 text-sm text-slate-600">
            Das despesas com pessoa jurídica que exigem nota, {fmtPercent((r.coberturaDocumental.comNotaCents / r.coberturaDocumental.exigeNotaCents) * 100, 0)} têm o
            número do documento fiscal no título ({reais(r.coberturaDocumental.comNotaCents)} de {reais(r.coberturaDocumental.exigeNotaCents)}).
          </p>
        )}
        {r.pendencias.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhuma pendência de documentação encontrada.</p>
        ) : (
          <div className="space-y-5">
            {r.pendencias.map((p) => (
              <div key={p.codigo}>
                <p className="text-sm font-semibold text-slate-900">
                  {p.titulo}: {reais(p.cents)} em {p.quantidade} lançamento(s)
                </p>
                <p className="mt-0.5 text-xs text-slate-600">
                  {p.risco} <span className="text-slate-400">({p.baseLegal})</span>
                </p>
                <div className="mt-2">
                  <Tabela
                    colunas={["Data", "Beneficiário", "Categoria", "Valor", "O que falta"]}
                    alinharDireita={[3]}
                    linhas={p.maiores.map((t) => [fmtData(t.data), t.parceiro ?? "—", t.categoria, reais(t.valorCents), t.detalhe])}
                  />
                  {p.quantidade > p.maiores.length && <p className="mt-1 text-xs text-slate-400">Os {p.maiores.length} maiores.</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Secao>

      <Secao
        titulo="Cada despesa no Lucro Real"
        descricao="Pelo nome da categoria da Omie (e, sem nome reconhecido, pela linha do DRE). Abra a linha para ver as categorias."
      >
        <div className="divide-y divide-slate-100">
          {r.porTipo.map((g) => (
            <details key={g.tipo.codigo} className="py-2">
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-slate-800">{g.tipo.nome}</span>
                <span className={`${badgeClass} ${corTratamento[g.tipo.tratamento]}`}>{ROTULO_TRATAMENTO[g.tipo.tratamento]}</span>
                {g.tipo.conferir && <span className={`${badgeClass} bg-amber-50 text-amber-800`}>conferir</span>}
                <span className="ml-auto tabular-nums text-slate-700">{reais(g.cents)}</span>
              </summary>
              <div className="mt-2 space-y-2 pl-4 text-xs text-slate-600">
                <p>{g.tipo.observacao}</p>
                {g.tipo.documentos.length > 0 && <p>Documentos: {g.tipo.documentos.join("; ")}.</p>}
                <p className="text-slate-500">{g.tipo.baseLegal}</p>
                <ul className="space-y-0.5">
                  {g.categorias.slice(0, 12).map((c, i) => (
                    <li key={`${c.descricao}-${i}`} className="flex gap-2">
                      <span>{c.descricao}</span>
                      {c.origem === "PESSOAS_CORPORATIVA" && <span className="text-slate-400">({nomeCorp})</span>}
                      <span className="ml-auto tabular-nums">{reais(c.cents)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          ))}
        </div>
      </Secao>

      <Secao titulo="Os limites do planejamento" descricao="O que separa economia lícita de autuação — e o argumento que a fiscalização usa primeiro.">
        <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700">
          <li>
            <strong>Forma sem substância não se sustenta.</strong> A Receita pode desconsiderar ato praticado para dissimular o fato gerador (CTN, art. 116,
            parágrafo único), e o CARF exige propósito negocial. Toda operação acima precisa existir de fato, com documento e com razão de negócio.
          </li>
          <li>
            <strong>Nota fria ou despesa inexistente é crime</strong>, não planejamento (Lei 8.137/1990, art. 1º), com multa qualificada sobre o imposto
            (Lei 9.430/1996, art. 44, na redação da Lei 14.689/2023).
          </li>
          <li>
            <strong>Despesa do sócio na empresa</strong> é adicionada e pode ser tratada como distribuição disfarçada de lucro. O caminho para levar
            dinheiro ao sócio é pró-labore, JCP ou dividendo — cada um com o seu custo.
          </li>
          <li>
            <strong>Empresa do Simples só para a folha</strong> é o arranjo que a fiscalização desconsidera. A transferência da folha da {nomeCorp} para a{" "}
            {insumos.empresa} encerra esse risco.
          </li>
          <li>
            <strong>Antecipar dedução não é economizar</strong>: depreciação acelerada e provisões mudam o ano em que o imposto é pago, não o total. Vale
            pelo caixa e pelo custo do dinheiro, e precisa ser controlada no e-Lalur (parte B) para não deduzir duas vezes.
          </li>
          <li>
            Dividendos: desde 2026, acima de R$ 50 mil por mês a uma mesma pessoa física há retenção de 10% (Lei 9.250/1995, art. 6º-A, pela Lei
            15.270/2025), antecipação do imposto mínimo da pessoa física. Conferir com a assessoria o efeito no planejamento da remuneração dos sócios.
          </li>
        </ul>
        <p className="mt-4 text-xs text-slate-500">
          Estimativa sobre o espelho da Omie, para orientar decisões. Quem apura e assina é a contabilidade; o enquadramento de cada item é da assessoria
          tributária. Alíquotas: IRPJ {ALIQUOTAS.irpj * 100}% + {ALIQUOTAS.adicionalIrpj * 100}% acima de R$ 240 mil no ano; CSLL {ALIQUOTAS.csll * 100}%.
        </p>
      </Secao>
    </div>
  );
}

function LinhaQuadro({ rotulo, valor, forte, explicacao }: { rotulo: string; valor: number; forte?: boolean; explicacao?: string }) {
  return (
    <tr className={`border-b border-slate-100 align-top ${forte ? "font-semibold text-slate-900" : "text-slate-700"}`}>
      <td className={`py-1.5 pr-4 ${forte ? "" : "pl-4"}`}>
        {rotulo}
        {explicacao && <p className="mt-0.5 text-xs font-normal text-slate-500">{explicacao}</p>}
      </td>
      <td className={`whitespace-nowrap py-1.5 text-right tabular-nums ${valor < 0 ? "text-red-700" : ""}`}>{reais(valor)}</td>
    </tr>
  );
}
