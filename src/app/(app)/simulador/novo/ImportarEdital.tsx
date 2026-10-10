"use client";

import { useRef, useState } from "react";
import type { EstudoImportado } from "@/lib/simulador/editalParaEstudo";
import { descartarArquivosDoEdital, enviarArquivoDoEdital, lerEditalEnviado } from "../actions";
import { dividirPdf, LIMITE_PARTE as LIMITE_DA_PARTE } from "@/lib/simulador/dividirPdf";

// IMPORTAR EDITAL — o atalho de Novo estudo. A pessoa escolhe os arquivos do
// processo (edital, termo de referência, planilhas, anexos; PDF, Word, Excel,
// imagem), a leitura automática preenche o formulário e ela confere antes de
// criar. Nada é gravado até o "Criar".
//
// O tamanho manda no desenho: a hospedagem recusa requisição acima de
// ~4,5 MB, então cada arquivo sobe sozinho e o PDF maior que isso é dividido
// AQUI, no navegador, em partes por intervalo de páginas (pdf-lib). Cada parte
// vai para a leitura como um documento do mesmo conjunto.

const ACEITOS = ".pdf,.docx,.xlsx,.txt,.csv,.png,.jpg,.jpeg,.webp,.gif,.msg";
// O mesmo limite de importarEdital.ts (TAMANHO_MAXIMO_PARTE).
const LIMITE_PARTE = LIMITE_DA_PARTE;

type Selecionado = { arquivo: File; usar: boolean };
type Parte = { nome: string; blob: Blob };

const mb = (b: number) => `${(b / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
const ehPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

async function partesDoPdf(arquivo: File): Promise<Parte[]> {
  const partes = await dividirPdf(await arquivo.arrayBuffer(), arquivo.name);
  return partes.map((p) => ({ nome: `${arquivo.name} (páginas ${p.de + 1} a ${p.ate} de ${p.total})`, blob: new Blob([new Uint8Array(p.bytes)], { type: "application/pdf" }) }));
}

export default function ImportarEdital({ disponivel, onImportado }: { disponivel: boolean; onImportado: (e: EstudoImportado) => void }) {
  const [selecionados, setSelecionados] = useState<Selecionado[]>([]);
  const [etapa, setEtapa] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [lendo, setLendo] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  const adicionar = (lista: FileList | null) => {
    if (!lista || lista.length === 0) return;
    const recebidos = [...lista];
    setErro(null);
    setSelecionados((atual) => [...atual, ...recebidos.filter((f) => !atual.some((s) => s.arquivo.name === f.name && s.arquivo.size === f.size)).map((arquivo) => ({ arquivo, usar: true }))]);
    if (entrada.current) entrada.current.value = "";
  };

  const ler = async () => {
    setErro(null);
    const usar = selecionados.filter((s) => s.usar).map((s) => s.arquivo);
    if (usar.length === 0) return setErro("Escolha ao menos um arquivo.");
    const antigos = usar.filter((f) => /\.(doc|xls|ppt)$/i.test(f.name));
    if (antigos.length > 0) return setErro(`Formato antigo do Office (${antigos.map((f) => f.name).join(", ")}): salve como .docx/.xlsx ou PDF.`);
    setLendo(true);
    const enviados: unknown[] = [];
    try {
      // 1. As partes: PDF grande dividido; os demais inteiros (até o limite).
      const partes: Parte[] = [];
      for (const f of usar) {
        if (ehPdf(f) && f.size > LIMITE_PARTE) {
          setEtapa(`Dividindo ${f.name} (${mb(f.size)})…`);
          partes.push(...(await partesDoPdf(f)));
        } else if (f.size > LIMITE_PARTE) {
          throw new Error(`${f.name} tem ${mb(f.size)}: acima de ${mb(LIMITE_PARTE)} só PDF é dividido. Exporte em PDF ou reduza a imagem.`);
        } else partes.push({ nome: f.name, blob: f });
      }
      // 2. Uma a uma para a leitura (a hospedagem limita o tamanho de cada envio).
      for (const [k, p] of partes.entries()) {
        setEtapa(`Enviando ${k + 1} de ${partes.length}: ${p.nome}…`);
        const fd = new FormData();
        fd.set("arquivo", new File([p.blob], p.nome.replace(/ \(páginas .*\)$/, ""), { type: p.blob.type }));
        fd.set("nome", p.nome);
        const r = await enviarArquivoDoEdital(fd);
        if (r.erro || !r.arquivo) throw new Error(r.erro ?? "Falha no envio.");
        enviados.push(r.arquivo);
      }
      // 3. A leitura do conjunto.
      setEtapa(`Lendo ${partes.length} documento(s) — pode levar de 1 a 4 minutos…`);
      const r = await lerEditalEnviado(JSON.stringify(enviados));
      if (r.erro || !r.estudo) throw new Error(r.erro ?? "A leitura não devolveu resultado.");
      setEtapa(null);
      onImportado(r.estudo);
    } catch (e) {
      setEtapa(null);
      setErro(e instanceof Error ? e.message : "Falha na importação.");
      // A leitura apaga os arquivos ao terminar; se parou antes dela, apaga aqui.
      if (enviados.length > 0) await descartarArquivosDoEdital(JSON.stringify(enviados)).catch(() => undefined);
    } finally {
      setLendo(false);
    }
  };

  if (!disponivel)
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
        Importar edital: leitura automática indisponível neste ambiente (falta a chave da IA). Preencha o estudo à mão.
      </div>
    );

  const total = selecionados.filter((s) => s.usar).reduce((a, s) => a + s.arquivo.size, 0);
  return (
    <section className="space-y-3 rounded-lg border border-blue-200 bg-blue-50/50 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-slate-800">Importar edital</p>
        <p className="text-xs text-slate-500">PDF, Word, Excel ou imagem — o edital, o termo de referência e os anexos juntos. A leitura preenche o formulário; você confere e cria.</p>
      </div>
      {/* A área de arquivos: botão visível (o do navegador some com o estilo
          base do sistema) e arrastar e soltar. */}
      <div
        className={`flex flex-wrap items-center gap-3 rounded-lg border-2 border-dashed px-4 py-4 ${arrastando ? "border-blue-500 bg-blue-100/60" : "border-blue-200 bg-white/60"}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!lendo) setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastando(false);
          if (!lendo) adicionar(e.dataTransfer.files);
        }}
      >
        <input ref={entrada} id="arquivos-do-edital" type="file" multiple accept={ACEITOS} onChange={(e) => adicionar(e.target.files)} disabled={lendo} className="sr-only" aria-label="Arquivos do edital" />
        <label
          htmlFor="arquivos-do-edital"
          className={`cursor-pointer rounded-md border border-blue-300 bg-white px-4 py-1.5 text-sm font-medium text-blue-800 shadow-sm hover:bg-blue-50 ${lendo ? "pointer-events-none opacity-50" : ""}`}
        >
          {selecionados.length > 0 ? "Acrescentar arquivos" : "Escolher arquivos"}
        </label>
        <span className="text-sm text-slate-500">ou arraste os arquivos do edital para cá</span>
        {selecionados.length > 0 && (
          <button type="button" onClick={ler} disabled={lendo} className="ml-auto rounded-md bg-blue-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50">
            {lendo ? "Lendo…" : `Ler edital (${selecionados.filter((s) => s.usar).length} arquivo(s), ${mb(total)})`}
          </button>
        )}
      </div>
      {selecionados.length > 0 && (
        <ul className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
          {selecionados.map((s, k) => (
            <li key={`${s.arquivo.name}:${s.arquivo.size}`} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={s.usar}
                disabled={lendo}
                aria-label={`Usar ${s.arquivo.name} na leitura`}
                onChange={(e) => setSelecionados((atual) => atual.map((x, j) => (j === k ? { ...x, usar: e.target.checked } : x)))}
              />
              <span className={`truncate ${s.usar ? "text-slate-800" : "text-slate-400 line-through"}`} title={s.arquivo.name}>
                {s.arquivo.name}
              </span>
              <span className="shrink-0 text-xs text-slate-400">{mb(s.arquivo.size)}</span>
              <button
                type="button"
                disabled={lendo}
                className="shrink-0 text-xs text-slate-500 hover:text-red-700"
                aria-label={`Tirar ${s.arquivo.name}`}
                onClick={() => setSelecionados((atual) => atual.filter((_, j) => j !== k))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {selecionados.length > 0 && !lendo && <p className="text-xs text-slate-500">Desmarque o que não traz custo (logomarca, manual visual, formulários) para a leitura ficar mais rápida.</p>}
      {etapa && <p className="text-sm text-blue-800">{etapa}</p>}
      {erro && <p className="text-sm text-red-700">{erro}</p>}
    </section>
  );
}
