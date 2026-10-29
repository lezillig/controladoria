import Link from "next/link";
import { auditoriaDoMes, contagemNaOmie } from "@/lib/controladoria/auditoriaDoMes";
import ConferenciaOmie from "./ConferenciaOmie";
import { fmtBRL, fmtData, fmtNumero, fmtPercent } from "@/lib/controladoria/format";
import { larguraPainel } from "@/lib/ui";
import { escopoDaPagina } from "../../_dados";
import { Kpi, Secao, Tabela } from "../../_componentes";

// AUDITORIA DO DRE DO MÊS — por que o mês parece vazio. Ver auditoriaDoMes.ts.
export const maxDuration = 60;

const NOME_MES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const rotulo = (k: string) => `${NOME_MES[Number(k.slice(5)) - 1]}/${k.slice(0, 4)}`;
const reais = (c: number) => (Math.round(c / 100) === 0 ? "—" : fmtBRL(Math.round(c / 100) * 100).replace(/,00$/, ""));

export default async function AuditoriaDoMesPage({ searchParams }: { searchParams: Promise<{ empresa?: string; mes?: string; omie?: string }> }) {
  const params = await searchParams;
  const { session, escopo, conexoes } = await escopoDaPagina("custos", params.empresa);
  const hoje = new Date();
  const m = /^(\d{4})-(\d{2})$/.exec(params.mes ?? "");
  const ano = m ? Number(m[1]) : hoje.getUTCFullYear();
  const mes = m ? Number(m[2]) : hoje.getUTCMonth() + 1;
  const chave = `${ano}-${String(mes).padStart(2, "0")}`;
  const mesCorrente = ano === hoje.getUTCFullYear() && mes === hoje.getUTCMonth() + 1;
  const dia = mesCorrente ? hoje.getUTCDate() : 31;

  const [a, contagem] = await Promise.all([
    auditoriaDoMes({ companyId: session.companyId, conexaoId: escopo.conexaoId, ano, mes, diaDeCorte: dia }),
    params.omie === "1" ? contagemNaOmie({ companyId: session.companyId, ano, mes }) : null,
  ]);

  const despesas = a.linhas.filter((l) => l.natureza === "PAGAR");
  const soma = (f: (l: (typeof despesas)[number]) => number) => despesas.reduce((s, l) => s + f(l), 0);
  const comp = soma((l) => l.competenciaCents);
  const pago = soma((l) => l.pagoCents);
  const fora = soma((l) => l.pagoForaCents);
  const venc = soma((l) => l.vencimentoCents);
  const q = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    if (escopo.conexaoId) p.set("empresa", escopo.conexaoId);
    p.set("mes", chave);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `/custos/auditoria?${p}`;
  };
  const opcoesMes = [0, 1, 2, 3, 4, 5].map((k) => {
    const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - k, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
  const atual = a.maturidade[0];
  const anteriores = a.maturidade.slice(1).filter((x) => x.percentual !== null);
  const mediaAnterior = anteriores.length ? anteriores.reduce((s, x) => s + (x.percentual ?? 0), 0) / anteriores.length : null;
  const esperado = mediaAnterior && mediaAnterior > 0 ? atual.ateODiaCents / mediaAnterior : null;

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div>
        <Link href="/custos" className="text-xs text-blue-700 hover:underline">
          ← Custos e DRE
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Auditoria do DRE — {rotulo(chave)}</h1>
        <p className="mt-1 max-w-4xl text-sm text-slate-500">
          O DRE é por competência: despesa no mês do VENCIMENTO, receita no da EMISSÃO da nota. Esta tela mostra, linha a linha, o que entrou por
          competência, o que venceu e o que foi pago no mês — e o que foi pago no mês mas está contado em outro mês (pagamento atrasado ou antecipado). {escopo.apelido ?? "Grupo (todas as empresas)"}
          {mesCorrente ? `, até o dia ${dia}` : ""}.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {opcoesMes.map((k) => (
          <Link key={k} href={`/custos/auditoria?${new URLSearchParams({ ...(escopo.conexaoId ? { empresa: escopo.conexaoId } : {}), mes: k })}`} className={`rounded-full px-3 py-1 font-medium ${k === chave ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            {rotulo(k)}
          </Link>
        ))}
        <span className="mx-2 text-slate-300">|</span>
        {[{ id: "", apelido: "Grupo" }, ...conexoes].map((c) => (
          <Link key={c.id || "g"} href={`/custos/auditoria?${new URLSearchParams({ ...(c.id ? { empresa: c.id } : {}), mes: chave })}`} className={`rounded-full px-3 py-1 font-medium ${(escopo.conexaoId ?? "") === c.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            {c.apelido}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi rotulo="Despesas por competência" valor={reais(comp)} apoio="o que está no DRE" />
        <Kpi rotulo="Despesas que vencem no mês" valor={reais(venc)} apoio="títulos a pagar com vencimento no mês" />
        <Kpi rotulo="Pago no mês" valor={reais(pago)} apoio="baixas de títulos a pagar no mês" />
        <Kpi rotulo="Pago no mês, contado em outro mês" valor={reais(fora)} apoio={pago > 0 ? `${fmtPercent((fora / pago) * 100, 0)} do pago — fica fora do DRE deste mês` : undefined} tom={pago > 0 && fora / pago > 0.3 ? "atencao" : "neutro"} />
      </div>

      <Secao
        titulo="Já lançado até este dia, comparado aos meses anteriores"
        descricao={`Despesas de competência de cada mês que já estavam registradas na Omie até o dia ${dia}, contra o total que o mês acabou tendo. Mostra se o mês atual está só incompleto como de costume ou abaixo do normal.`}
      >
        <Tabela
          colunas={["Mês", `Registrado até o dia ${dia}`, "Total do mês (hoje)", "% já lançado no dia"]}
          alinharDireita={[1, 2, 3]}
          linhas={a.maturidade.map((x, i) => [
            rotulo(x.mes),
            reais(x.ateODiaCents),
            i === 0 && mesCorrente ? <span key="t" className="text-slate-400">em formação</span> : reais(x.totalCents),
            i === 0 && mesCorrente ? "—" : x.percentual === null ? "—" : fmtPercent(x.percentual * 100, 0),
          ])}
        />
        {mesCorrente && esperado !== null && (
          <p className="mt-3 text-sm text-slate-700">
            Pelo ritmo dos meses anteriores (em média {fmtPercent((mediaAnterior ?? 0) * 100, 0)} das despesas já lançadas no dia {dia}), {rotulo(chave)} deve fechar perto de{" "}
            <strong>{reais(esperado)}</strong> em despesas por competência — hoje tem {reais(atual.ateODiaCents)}.
          </p>
        )}
      </Secao>

      <Secao titulo="Linha a linha do DRE" descricao="Competência é o que o DRE mostra (despesa = vence no mês, menos as a vencer ainda em aberto). Pago muito diferente do que vence aponta pagamento atrasado ou adiantado. Clique para ver as categorias.">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-500">
                <th className="py-2 pr-3 text-left font-medium">Linha</th>
                <th className="px-2 py-2 text-right font-medium">Competência (DRE)</th>
                <th className="px-2 py-2 text-right font-medium">Vence no mês</th>
                <th className="px-2 py-2 text-right font-medium">Pago no mês</th>
                <th className="px-2 py-2 text-right font-medium">Pago, contado em outro mês</th>
              </tr>
            </thead>
            <tbody>
              {a.linhas.map((l) => {
                const alerta = l.pagoForaCents > 0.3 * Math.max(l.pagoCents, 1) && l.pagoForaCents > 1_000_000;
                return (
                  <tr key={`${l.chave}|${l.natureza}`} className="border-b border-slate-100 align-top">
                    <td className="py-2 pr-3">
                      <details>
                        <summary className="cursor-pointer font-medium text-slate-800">
                          {l.rotulo}
                          {l.natureza === "RECEBER" && <span className="ml-1 text-xs font-normal text-slate-400">(a receber)</span>}
                        </summary>
                        <table className="mt-2 text-xs">
                          <tbody>
                            {l.categorias.slice(0, 25).map((c) => (
                              <tr key={c.categoria}>
                                <td className="py-0.5 pr-3 text-slate-600">{c.categoria}</td>
                                <td className="px-2 text-right tabular-nums">{reais(c.competenciaCents)}</td>
                                <td className="px-2 text-right tabular-nums text-slate-500">{reais(c.vencimentoCents)}</td>
                                <td className="px-2 text-right tabular-nums text-slate-500">{reais(c.pagoCents)}</td>
                                <td className="px-2 text-right tabular-nums text-amber-700">{reais(c.pagoForaCents)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </details>
                    </td>
                    <td className="px-2 py-2 text-right font-semibold tabular-nums">{reais(l.competenciaCents)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{reais(l.vencimentoCents)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{reais(l.pagoCents)}</td>
                    <td className={`px-2 py-2 text-right tabular-nums ${alerta ? "font-semibold text-amber-700" : ""}`}>{reais(l.pagoForaCents)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Secao>

      <Secao
        titulo={`Pago em ${rotulo(chave)}, contado em outro mês (${fmtNumero(a.pagosForaDoMes.length)}${a.pagosForaDoMes.length === 300 ? "+" : ""})`}
        descricao="Títulos a pagar baixados no mês que vencem em outro mês — pagamento atrasado de um mês anterior ou adiantado do seguinte. Os maiores primeiro."
      >
        <Tabela
          colunas={["Fornecedor", "Categoria / linha", "Documento", "Emissão", "Vencimento", "Pago em", "Valor pago", "Contado em"]}
          alinharDireita={[6]}
          linhas={a.pagosForaDoMes.slice(0, 120).map((x) => [
            x.parceiro ?? "—",
            <span key="c" className="text-xs">
              {x.categoria ?? "—"}
              <span className="block text-slate-400">{x.linha}</span>
            </span>,
            `${x.documento ?? "—"}${x.parcela ? ` · ${x.parcela}` : ""}`,
            fmtData(x.emissao),
            fmtData(x.vencimento),
            fmtData(x.pagoEm),
            fmtBRL(x.pagoCents),
            rotulo(x.competencia),
          ])}
          vazio="Nada pago no mês com competência em outro mês."
        />
      </Secao>

      <Secao
        titulo="Conferência título a título com a Omie"
        descricao="Busca na Omie, agora, todos os títulos do mês pelo mesmo critério do DRE — a pagar pelo vencimento, a receber pela emissão; caixa pelas baixas no mês — e compara um a um com o sistema: o que falta, o que sobra, valor, data e cancelamento diferentes."
      >
        <ConferenciaOmie empresas={(escopo.conexaoId ? conexoes.filter((c) => c.id === escopo.conexaoId) : conexoes).map((c) => ({ id: c.id, apelido: c.apelido }))} ano={ano} mes={mes} />
      </Secao>

      <Secao
        titulo="O sistema tem tudo o que está na Omie?"
        descricao="Conta, na hora, quantos títulos a Omie tem com emissão e com vencimento no mês, em cada empresa, e compara com o sistema. Diferença é título que a sincronização não trouxe."
        acao={
          !contagem ? (
            <Link href={q({ omie: "1" })} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700">
              Contar na Omie agora
            </Link>
          ) : undefined
        }
      >
        {contagem ? (
          <Tabela
            colunas={["Empresa", "Natureza", "Critério", "Na Omie", "No sistema", "Diferença"]}
            alinharDireita={[3, 4, 5]}
            linhas={contagem.map((c) => [
              c.empresa,
              c.natureza === "PAGAR" ? "A pagar" : "A receber",
              c.criterio,
              c.omie === null ? <span key="o" className="text-xs text-red-700">{c.erro ?? "erro"}</span> : fmtNumero(c.omie),
              fmtNumero(c.sistema),
              c.omie === null ? "—" : c.omie === c.sistema ? <span key="d" className="text-emerald-700">igual</span> : <span key="d" className="font-semibold text-red-700">{fmtNumero(c.omie - c.sistema)}</span>,
            ])}
          />
        ) : (
          <p className="text-sm text-slate-500">Leva alguns segundos (8 consultas à Omie).</p>
        )}
      </Secao>
    </div>
  );
}
