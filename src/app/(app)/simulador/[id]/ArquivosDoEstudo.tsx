"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { dividirPdf, LIMITE_PARTE } from "@/lib/simulador/dividirPdf";
import { anexarArquivoAoEstudo, excluirArquivoDoEstudo, preencherPlanilhaDoEdital } from "../actions";

// OS ARQUIVOS DO ESTUDO — o edital e os anexos guardados na importação, e o
// que vier depois (ata da sessão, contrato, recurso). Baixar é pela rota de
// download; enviar, um arquivo por vez (o limite de envio da hospedagem), com
// o PDF grande dividido em partes aqui no navegador.

export type ArquivoTela = { id: string; tipo: string; nome: string; tamanhoBytes: number; enviadoPorNome: string | null; criadoEm: string };

const ROTULO_TIPO: Record<string, string> = { EDITAL: "Edital e anexos", ATA: "Ata da sessão", CONTRATO: "Contrato", PROPOSTA: "Proposta enviada", OUTRO: "Outros" };
const mb = (b: number) => `${(b / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;

export default function ArquivosDoEstudo({ estudoId, arquivos, podeEditar, preencherDisponivel = false }: { estudoId: string; arquivos: ArquivoTela[]; podeEditar: boolean; preencherDisponivel?: boolean }) {
  const router = useRouter();
  const [tipo, setTipo] = useState("ATA");
  const [etapa, setEtapa] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const entrada = useRef<HTMLInputElement>(null);

  const enviar = async (lista: FileList | null) => {
    if (!lista || lista.length === 0) return;
    setErro(null);
    try {
      for (const f of [...lista]) {
        const partes: { nome: string; blob: Blob }[] = [];
        if (f.size > LIMITE_PARTE && /\.pdf$/i.test(f.name)) {
          setEtapa(`Dividindo ${f.name}…`);
          const base = f.name.replace(/\.pdf$/i, "");
          for (const p of await dividirPdf(await f.arrayBuffer(), f.name)) partes.push({ nome: `${base} (páginas ${p.de + 1} a ${p.ate} de ${p.total}).pdf`, blob: new Blob([new Uint8Array(p.bytes)], { type: "application/pdf" }) });
        } else if (f.size > LIMITE_PARTE) throw new Error(`${f.name} tem ${mb(f.size)}: acima de ${mb(LIMITE_PARTE)} só PDF é dividido.`);
        else partes.push({ nome: f.name, blob: f });
        for (const [k, p] of partes.entries()) {
          setEtapa(`Enviando ${f.name}${partes.length > 1 ? ` (parte ${k + 1} de ${partes.length})` : ""}…`);
          const fd = new FormData();
          fd.set("arquivo", new File([p.blob], f.name, { type: p.blob.type || f.type }));
          fd.set("nome", p.nome);
          fd.set("tipo", tipo);
          const r = await anexarArquivoAoEstudo(estudoId, fd);
          if (r.erro) throw new Error(r.erro);
        }
      }
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha no envio.");
    } finally {
      setEtapa(null);
      if (entrada.current) entrada.current.value = "";
    }
  };

  // O modelo de planilha de custos do edital, preenchido com o estudo.
  const [preenchendo, setPreenchendo] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const preencher = async (a: ArquivoTela) => {
    setErro(null);
    setAviso(null);
    setPreenchendo(a.id);
    try {
      const r = await preencherPlanilhaDoEdital(estudoId, a.id);
      if (r.erro) setErro(r.erro);
      else {
        setAviso(`Planilha preenchida: ${r.preenchidas} célula(s)${r.pendentes ? `, ${r.pendentes} para preencher à mão (veja a aba Conferência)` : ""}. Está em "Proposta enviada".`);
        router.refresh();
      }
    } catch {
      setErro("A leitura da planilha demorou demais ou falhou. Tente de novo.");
    } finally {
      setPreenchendo(null);
    }
  };

  const excluir = async (a: ArquivoTela) => {
    if (!window.confirm(`Apagar "${a.nome}" do estudo?`)) return;
    const r = await excluirArquivoDoEstudo(estudoId, a.id);
    if (r.erro) setErro(r.erro);
    else router.refresh();
  };

  const tipos = [...new Set(arquivos.map((a) => a.tipo))];
  const total = arquivos.reduce((s, a) => s + a.tamanhoBytes, 0);
  return (
    <details className="rounded-xl border border-slate-200 bg-white p-4" open={arquivos.length > 0 && arquivos.length <= 12}>
      <summary className="cursor-pointer text-sm font-semibold text-slate-800">
        Arquivos do estudo ({arquivos.length}
        {arquivos.length > 0 ? ` · ${mb(total)}` : ""})
      </summary>
      <div className="mt-3 space-y-3">
        {arquivos.length === 0 && <p className="text-sm text-slate-500">Nenhum arquivo guardado. Estudos criados pelo &ldquo;Importar edital&rdquo; guardam o edital e os anexos aqui.</p>}
        {tipos.map((t) => (
          <div key={t}>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{ROTULO_TIPO[t] ?? t}</p>
            <ul className="space-y-1 text-sm">
              {arquivos
                .filter((a) => a.tipo === t)
                .map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-x-3">
                    <a className="text-blue-700 hover:underline" href={`/api/simulador/${estudoId}/arquivo/${a.id}`}>
                      {a.nome}
                    </a>
                    <span className="text-xs text-slate-400">
                      {mb(a.tamanhoBytes)} · {new Date(a.criadoEm).toLocaleDateString("pt-BR")}
                      {a.enviadoPorNome ? ` · ${a.enviadoPorNome}` : ""}
                    </span>
                    {podeEditar && preencherDisponivel && /\.xlsx$/i.test(a.nome) && a.tipo !== "PROPOSTA" && (
                      <button
                        type="button"
                        className="rounded border border-blue-200 px-2 py-0.5 text-xs font-medium text-blue-800 hover:bg-blue-50 disabled:opacity-50"
                        disabled={preenchendo !== null}
                        title="Preenche o modelo de planilha de custos do edital com os números da última versão salva do estudo, sem mexer nas fórmulas do órgão"
                        onClick={() => preencher(a)}
                      >
                        {preenchendo === a.id ? "Preenchendo… (até 2 min)" : "Preencher com o estudo"}
                      </button>
                    )}
                    {podeEditar && (
                      <button type="button" className="text-xs text-slate-400 hover:text-red-700" aria-label={`Apagar ${a.nome}`} onClick={() => excluir(a)}>
                        ✕
                      </button>
                    )}
                  </li>
                ))}
            </ul>
          </div>
        ))}
        {podeEditar && (
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
            <select className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[13px]" aria-label="Tipo do arquivo" value={tipo} onChange={(e) => setTipo(e.target.value)} disabled={etapa !== null}>
              {Object.entries(ROTULO_TIPO).map(([v, r]) => (
                <option key={v} value={v}>
                  {r}
                </option>
              ))}
            </select>
            <input ref={entrada} id="anexar-ao-estudo" type="file" multiple className="sr-only" onChange={(e) => enviar(e.target.files)} disabled={etapa !== null} />
            <label htmlFor="anexar-ao-estudo" className={`cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-1 text-[13px] font-medium text-slate-700 hover:bg-slate-50 ${etapa ? "pointer-events-none opacity-50" : ""}`}>
              Acrescentar arquivo
            </label>
            {etapa && <span className="text-xs text-blue-800">{etapa}</span>}
            {erro && <span className="text-xs text-red-700">{erro}</span>}
          </div>
        )}
        {aviso && <p className="text-sm text-emerald-700">{aviso}</p>}
        {!podeEditar && erro && <p className="text-sm text-red-700">{erro}</p>}
      </div>
    </details>
  );
}
