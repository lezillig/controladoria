"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { gravarMigracao, previaMigracao, type Previa } from "./actions";
import type { ResultadoGravacao } from "@/lib/frota/migracaoNoBanco";

// A TELA DA MIGRAÇÃO ÚNICA: escolher as duas planilhas → conferir a prévia
// (o que entra e os problemas) → gravar (frota, depois contratos).

export default function Migracao() {
  const form = useRef<HTMLFormElement>(null);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [passo, setPasso] = useState<string | null>(null);
  const [gravado, setGravado] = useState<ResultadoGravacao[]>([]);

  async function conferir() {
    if (!form.current) return;
    setErro(null);
    setPrevia(null);
    setGravado([]);
    setPasso("Lendo as planilhas…");
    const r = await previaMigracao(new FormData(form.current)).catch((e) => ({ erro: e instanceof Error ? e.message : "falha na chamada", previa: undefined }));
    setPasso(null);
    if (r.erro) setErro(r.erro);
    else setPrevia(r.previa ?? null);
  }

  async function gravar() {
    if (!form.current) return;
    setErro(null);
    setGravado([]);
    for (const [etapa, rotulo] of [["frota", "Gravando a frota (veículos, documentos, apólices, consultas)…"], ["contratos", "Gravando os contratos e as cotas…"]] as const) {
      setPasso(rotulo);
      const r = await gravarMigracao(new FormData(form.current), etapa).catch((e) => ({ erro: e instanceof Error ? e.message : "falha na chamada", resultado: undefined }));
      if (r.erro || !r.resultado) {
        setErro(r.erro ?? "falha");
        setPasso(null);
        return;
      }
      setGravado((x) => [...x, r.resultado!]);
    }
    setPasso(null);
  }

  const ocupado = passo !== null;
  return (
    <div className="space-y-5">
      <form ref={form} className="grid gap-4 md:grid-cols-2" onSubmit={(e) => e.preventDefault()}>
        <label className="block rounded-lg border border-dashed border-slate-300 p-4 text-sm">
          <span className="font-semibold text-slate-800">1. CONTROLE INFORMAÇÕES GERAIS</span>
          <span className="block text-xs text-slate-500">.xlsm ou .xlsx — abas FROTA ATIVA, VENDIDOS e CONSULTA DE PLACA</span>
          <input type="file" name="controle" accept=".xlsx,.xlsm" className="mt-2 block w-full text-xs" onChange={() => setPrevia(null)} />
        </label>
        <label className="block rounded-lg border border-dashed border-slate-300 p-4 text-sm">
          <span className="font-semibold text-slate-800">2. Consórcios e Financiamentos</span>
          <span className="block text-xs text-slate-500">.xlsx — uma aba por banco (CDC, giro, consórcio)</span>
          <input type="file" name="financiamentos" accept=".xlsx,.xlsm" className="mt-2 block w-full text-xs" onChange={() => setPrevia(null)} />
        </label>
      </form>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={conferir} disabled={ocupado} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60">
          Ler e conferir
        </button>
        {previa && gravado.length === 0 && (
          <button type="button" onClick={gravar} disabled={ocupado} className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-60">
            Confirmar e gravar no sistema
          </button>
        )}
        {passo && <span className="text-sm text-slate-600">{passo}</span>}
      </div>
      {erro && <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">{erro}</p>}

      {previa && (
        <div className="space-y-4 rounded-lg border border-slate-200 p-4 text-sm">
          <h2 className="font-semibold text-slate-900">O que vai entrar</h2>
          <ul className="grid gap-1 text-slate-700 md:grid-cols-2">
            <li>
              <strong>{previa.veiculos.total}</strong> veículos: {previa.veiculos.ativos} na frota ativa, {previa.veiculos.vendidos} vendidos
              {previa.veiculos.semPlaca ? `, ${previa.veiculos.semPlaca} ainda sem placa (pelo chassi)` : ""}. {previa.veiculos.jaCadastrados} já estão no cadastro e serão completados.
            </li>
            <li>
              <strong>{previa.documentos}</strong> documentos com validade, <strong>{previa.consultas}</strong> consultas de placa, <strong>{previa.apolices.length}</strong> apólices.
            </li>
            <li className="md:col-span-2">Saldos e parcelas pagas com data de referência {previa.dataReferencia ? previa.dataReferencia.split("-").reverse().join("/") : "de hoje"} — depois disso, quem atualiza é a Omie.</li>
          </ul>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500"><th className="py-1">Produto</th><th>Banco / administradora</th><th className="text-right">Contratos / cotas</th><th className="text-right">Ativos</th></tr>
            </thead>
            <tbody>
              {previa.contratos.map((c) => (
                <tr key={`${c.produto}|${c.instituicao}`} className="border-t border-slate-100"><td className="py-1">{c.produto}</td><td>{c.instituicao}</td><td className="text-right">{c.total}</td><td className="text-right">{c.ativos}</td></tr>
              ))}
            </tbody>
          </table>
          {previa.problemas.length > 0 && (
            <details className="rounded-md border border-amber-200 bg-amber-50 p-3" open={previa.problemas.length <= 20}>
              <summary className="cursor-pointer font-medium text-amber-900">{previa.problemas.length} ponto(s) para conferir depois — não impedem a migração</summary>
              <ul className="mt-2 max-h-80 space-y-0.5 overflow-auto text-xs text-slate-700">
                {previa.problemas.map((p, i) => (
                  <li key={i}>
                    <span className="text-slate-500">{p.aba}{p.linha ? `, linha ${p.linha}` : ""}:</span> {p.problema}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="text-xs text-slate-500">
            Abas lidas: {previa.abasLidas.length}. Não lidas (resumos que o sistema passa a calcular): {previa.abasIgnoradas.join(" · ") || "nenhuma"}.
          </p>
        </div>
      )}

      {gravado.length > 0 && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          {gravado.map((g) => (
            <p key={g.etapa}>
              <strong>{g.etapa === "frota" ? "Frota" : "Contratos"}:</strong> {g.novos} novo(s), {g.atualizados} atualizado(s), {g.iguais} sem mudança. {g.detalhes.join(" · ")}.
            </p>
          ))}
          {gravado.length === 2 && (
            <p className="mt-2">
              Pronto. Veja em <Link className="font-semibold underline" href="/frota">Frota</Link> e em <Link className="font-semibold underline" href="/frota/financiamentos">Financiamentos e consórcios</Link>. A partir de agora o sistema é a fonte — a planilha pode ser aposentada.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
