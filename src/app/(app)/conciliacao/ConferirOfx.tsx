"use client";

import { useActionState } from "react";
import { conferirOfx, type ResultadoOfx } from "./actions";

// O FORMULÁRIO DA CONFERÊNCIA DE OFX e o resultado: o que casou, o que só o
// banco tem (falta na Omie), o que só a Omie tem (não passou no banco), os
// débitos já agendados no banco e os pagamentos cujo beneficiário, pelo nome
// que o banco escreveu, não é o fornecedor da Omie.

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (s: string | null) => (s ? s.split("-").reverse().join("/") : "—");

export default function ConferirOfx({ podeGravar }: { podeGravar: boolean }) {
  const [r, enviar, enviando] = useActionState<ResultadoOfx | null, FormData>(conferirOfx, null);
  return (
    <div className="space-y-4">
      <form action={enviar} className="flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col text-xs text-slate-500">
          Arquivo OFX do banco
          <input type="file" name="arquivo" accept=".ofx,.OFX" required className="mt-1 text-sm" />
        </label>
        {r?.contas && (
          <label className="flex flex-col text-xs text-slate-500">
            Conta na Omie
            <select name="conta" defaultValue={r.conta?.chave ?? ""} className="mt-1 max-w-[20rem] rounded-md border border-slate-300 bg-white px-2 py-1 text-sm">
              <option value="">identificar pelo arquivo</option>
              {r.contas.map((c) => (
                <option key={c.chave} value={c.chave}>
                  {c.rotulo}
                </option>
              ))}
            </select>
          </label>
        )}
        {podeGravar && (
          <label className="flex items-center gap-1 text-xs text-slate-600">
            <input type="checkbox" name="gravarSaldo" value="1" /> gravar o saldo do arquivo como saldo do banco
          </label>
        )}
        <button type="submit" disabled={enviando} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50">
          {enviando ? "Conferindo…" : "Conferir"}
        </button>
      </form>

      {r?.erro && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{r.erro}</p>}
      {r?.arquivo && (
        <div className="space-y-3 text-sm">
          <p className="text-slate-600">
            Arquivo: banco {r.arquivo.banco ?? "?"}, conta {r.arquivo.conta ?? "?"}, {r.arquivo.lancamentos} lançamento(s) de {dia(r.arquivo.de)} a {dia(r.arquivo.ate)}
            {r.conta ? (
              <>
                {" "}
                → <strong>{r.conta.empresa} · {r.conta.descricao}</strong>
              </>
            ) : null}
            .
          </p>
          {r.casados !== undefined && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              {/* Casados e saldo ficam sem lista: o casado é o que confere, e o saldo é um número só. */}
              <Caixa titulo="Casados" valor={`${r.casados}`} apoio={`${brl(r.casadosCents ?? 0)} · ${r.comDiferencaDeData ?? 0} com data diferente`} tom="verde" />
              <Caixa titulo="Só no banco (falta na Omie)" valor={`${r.soNoBanco?.length ?? 0}`} apoio={brl((r.soNoBanco ?? []).reduce((s, l) => s + l.valorCents, 0))} tom={(r.soNoBanco?.length ?? 0) ? "vermelho" : "verde"} href={(r.soNoBanco?.length ?? 0) ? "#so-no-banco" : undefined} />
              <Caixa titulo="Só na Omie (não está no banco)" valor={`${r.soNaOmie?.length ?? 0}`} apoio={brl((r.soNaOmie ?? []).reduce((s, l) => s + l.valorCents, 0))} tom={(r.soNaOmie?.length ?? 0) ? "vermelho" : "verde"} href={(r.soNaOmie?.length ?? 0) ? "#so-na-omie" : undefined} />
              <Caixa
                titulo="Saldo do banco × Omie"
                valor={r.arquivo.saldoCents === null ? "—" : brl(r.arquivo.saldoCents)}
                apoio={
                  r.conta?.saldoOmieCents === null || r.conta?.saldoOmieCents === undefined
                    ? "saldo da Omie chega na próxima sincronização"
                    : `Omie ${brl(r.conta.saldoOmieCents)} (${dia(r.conta.saldoOmieEm)}) · dif. ${brl((r.arquivo.saldoCents ?? 0) - r.conta.saldoOmieCents)}`
                }
                tom={r.arquivo.saldoCents !== null && r.conta?.saldoOmieCents !== null && r.conta?.saldoOmieCents !== undefined && Math.abs(r.arquivo.saldoCents - r.conta.saldoOmieCents) < 100 ? "verde" : "ambar"}
              />
              {r.beneficiarios && (
                <Caixa
                  titulo="Pago a outro beneficiário"
                  valor={`${r.beneficiarios.divergentes.length}`}
                  apoio={`${brl(r.beneficiarios.divergentes.reduce((s, l) => s + l.valorCents, 0))} · ${r.beneficiarios.conferidos} pagamento(s) com nome conferido, ${r.beneficiarios.semNome} sem nome no extrato`}
                  tom={r.beneficiarios.divergentes.length ? "vermelho" : "verde"}
                  href={r.beneficiarios.divergentes.length ? "#beneficiario-diferente" : undefined}
                />
              )}
            </div>
          )}
          {r.beneficiarios && r.beneficiarios.divergentes.length > 0 && (
            <div id="beneficiario-diferente" className="scroll-mt-4 space-y-2 rounded-lg border border-red-200 bg-red-50/50 p-3">
              <p className="text-sm font-medium text-red-900">
                Pago a outro beneficiário: o nome que o banco escreveu não é o do fornecedor do lançamento na Omie ({r.beneficiarios.divergentes.length} ·{" "}
                {brl(r.beneficiarios.divergentes.reduce((s, l) => s + l.valorCents, 0))})
              </p>
              <p className="text-xs text-slate-600">
                É o rastro do boleto frio: na Omie está tudo certo (fornecedor, nota, valor) e o dinheiro foi para outra pessoa. Nem todo caso é golpe — nome fantasia, banco
                que cobra em nome de outro (factoring, cessão do boleto), grupo com outra razão social. Confira o comprovante: o beneficiário tem de ser o fornecedor ou alguém
                que ele indicou por escrito.
              </p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="py-1 pr-3 font-medium">Data</th>
                    <th className="py-1 pr-3 text-right font-medium">Valor</th>
                    <th className="py-1 pr-3 font-medium">No banco</th>
                    <th className="py-1 font-medium">Fornecedor na Omie</th>
                  </tr>
                </thead>
                <tbody>
                  {r.beneficiarios.divergentes.map((l, i) => (
                    <tr key={i} className="border-t border-red-100 align-top">
                      <td className="whitespace-nowrap py-1 pr-3">{dia(l.data)}</td>
                      <td className="whitespace-nowrap py-1 pr-3 text-right tabular-nums text-red-700">{brl(l.valorCents)}</td>
                      <td className="py-1 pr-3 text-slate-700">
                        <span className="font-medium">{l.nomeNoBanco ?? "—"}</span>
                        <span className="block text-[11px] text-slate-500">{l.memo}</span>
                      </td>
                      <td className="py-1 text-slate-700">
                        {l.fornecedor}
                        <span className="block text-[11px] text-slate-500">{l.documento}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {r.saldoGravado && <p className="text-xs text-emerald-700">Saldo do arquivo gravado como saldo do banco desta conta.</p>}
          <Lista id="so-no-banco" titulo="Só no banco — lançar na Omie" linhas={(r.soNoBanco ?? []).map((l) => [dia(l.data), brl(l.valorCents), l.memo])} />
          <Lista id="so-na-omie" titulo="Só na Omie — conferir (não passou no banco)" linhas={(r.soNaOmie ?? []).map((l) => [dia(l.data), brl(l.valorCents), `${l.descricao}${l.conciliado ? " · marcado conciliado na Omie" : ""}`])} />
          <Lista titulo="Agendados no banco (depois da data do arquivo)" linhas={(r.agendados ?? []).map((l) => [dia(l.data), brl(l.valorCents), l.memo])} />
        </div>
      )}
    </div>
  );
}

// `href`: o cartão leva à lista que soma o número (padrão de drill-down).
function Caixa({ titulo, valor, apoio, tom, href }: { titulo: string; valor: string; apoio: string; tom: "verde" | "vermelho" | "ambar"; href?: string }) {
  const cor = tom === "verde" ? "border-emerald-200 bg-emerald-50" : tom === "vermelho" ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50";
  const conteudo = (
    <>
      <p className="text-xs text-slate-600">{titulo}</p>
      <p className="text-lg font-semibold text-slate-900">{valor}</p>
      <p className="text-xs text-slate-500">{apoio}</p>
    </>
  );
  return href ? (
    <a href={href} className={`block rounded-lg border p-3 hover:ring-2 hover:ring-slate-300 ${cor}`}>
      {conteudo}
    </a>
  ) : (
    <div className={`rounded-lg border p-3 ${cor}`}>{conteudo}</div>
  );
}

function Lista({ id, titulo, linhas }: { id?: string; titulo: string; linhas: string[][] }) {
  if (linhas.length === 0) return null;
  return (
    <details id={id} className="scroll-mt-4" open={linhas.length <= 20}>
      <summary className="cursor-pointer text-sm font-medium text-slate-700">
        {titulo} ({linhas.length})
      </summary>
      <table className="mt-2 w-full text-xs">
        <tbody>
          {linhas.map((l, i) => (
            <tr key={i} className="border-b border-slate-100">
              <td className="whitespace-nowrap py-1 pr-3">{l[0]}</td>
              <td className={`whitespace-nowrap py-1 pr-3 text-right tabular-nums ${l[1].startsWith("-") ? "text-red-700" : "text-emerald-700"}`}>{l[1]}</td>
              <td className="py-1 text-slate-600">{l[2]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
