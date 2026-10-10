"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { GRUPOS_HABILITACAO, ROTULO_GRUPO_HABILITACAO, ROTULO_SITUACAO_DOCUMENTO, SITUACOES_DOCUMENTO, type GrupoHabilitacao, type SituacaoDocumento } from "@/lib/simulador/editalParaEstudo";
import { excluirDocumentoHabilitacao, salvarDocumentoHabilitacao } from "../../actions";
import { Cartao, botao, selecao } from "../comum";

// HABILITAÇÃO — os documentos que o edital pede, separados por grupo
// (jurídica, fiscal, contábil, técnica, declarações), com a situação da
// empresa em cada um. Nasce da leitura do edital; o que ela não pegou se
// acrescenta aqui. A validade é a da certidão: vencida, ou vencendo antes da
// sessão, fica em vermelho — é o erro que inabilita.

export type DocumentoTela = {
  id: string;
  grupo: string;
  documento: string;
  exigencia: string | null;
  fonte: string | null;
  situacao: string;
  validade: string | null;
  observacao: string | null;
  atualizadoPor: string | null;
};

const COR_SITUACAO: Record<SituacaoDocumento, string> = {
  PENDENTE: "border-amber-300 bg-amber-50 text-amber-900",
  PROVIDENCIANDO: "border-blue-300 bg-blue-50 text-blue-900",
  OK: "border-emerald-300 bg-emerald-50 text-emerald-900",
  NAO_SE_APLICA: "border-slate-300 bg-slate-50 text-slate-500",
};

const hoje = () => new Date().toISOString().slice(0, 10);
const dataBr = (iso: string) => iso.split("-").reverse().join("/");

export default function Habilitacao({
  estudoId,
  documentos: iniciais,
  podeEditar,
  dataSessao,
  aoMudar,
}: {
  estudoId: string;
  documentos: DocumentoTela[];
  podeEditar: boolean;
  dataSessao: string | null;
  // Para o selo da aba (prontos de quantos) acompanhar sem recarregar a página.
  aoMudar?: (documentos: DocumentoTela[]) => void;
}) {
  const [documentos, setDocumentos] = useState(iniciais);
  const avisar = useRef(aoMudar);
  useEffect(() => {
    avisar.current = aoMudar;
  });
  useEffect(() => avisar.current?.(documentos), [documentos]);
  const [soPendentes, setSoPendentes] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();
  const [novo, setNovo] = useState<{ grupo: GrupoHabilitacao; documento: string; exigencia: string }>({ grupo: "FISCAL", documento: "", exigencia: "" });

  const alterar = (id: string, mudanca: Partial<Pick<DocumentoTela, "situacao" | "validade" | "observacao">>) => {
    const antes = documentos;
    setDocumentos((l) => l.map((d) => (d.id === id ? { ...d, ...mudanca } : d)));
    setErro(null);
    iniciar(async () => {
      const r = await salvarDocumentoHabilitacao(estudoId, id, mudanca);
      if (r.erro) {
        setErro(r.erro);
        setDocumentos(antes);
      }
    });
  };

  const excluir = (d: DocumentoTela) => {
    if (!window.confirm(`Tirar "${d.documento}" da lista?`)) return;
    const antes = documentos;
    setDocumentos((l) => l.filter((x) => x.id !== d.id));
    iniciar(async () => {
      const r = await excluirDocumentoHabilitacao(estudoId, d.id);
      if (r.erro) {
        setErro(r.erro);
        setDocumentos(antes);
      }
    });
  };

  const acrescentar = () => {
    if (!novo.documento.trim()) return setErro("Diga qual é o documento.");
    setErro(null);
    iniciar(async () => {
      const r = await salvarDocumentoHabilitacao(estudoId, null, { grupo: novo.grupo, documento: novo.documento, exigencia: novo.exigencia || null });
      if (r.erro || !r.id) return setErro(r.erro ?? "Não foi possível acrescentar.");
      setDocumentos((l) => [...l, { id: r.id as string, grupo: novo.grupo, documento: novo.documento.trim(), exigencia: novo.exigencia.trim() || null, fonte: null, situacao: "PENDENTE", validade: null, observacao: null, atualizadoPor: null }]);
      setNovo((n) => ({ ...n, documento: "", exigencia: "" }));
    });
  };

  // Vencida hoje, ou vencendo antes da sessão: inabilita.
  const problemaDeValidade = (d: DocumentoTela) => {
    if (!d.validade || d.situacao === "NAO_SE_APLICA") return null;
    if (d.validade < hoje()) return "vencida";
    if (dataSessao && d.validade < dataSessao) return "vence antes da sessão";
    return null;
  };

  const validos = documentos.filter((d) => d.situacao !== "NAO_SE_APLICA");
  const prontos = validos.filter((d) => d.situacao === "OK").length;
  const vencendo = documentos.filter((d) => problemaDeValidade(d)).length;
  const grupos = [...GRUPOS_HABILITACAO.filter((g) => documentos.some((d) => d.grupo === g)), ...[...new Set(documentos.map((d) => d.grupo))].filter((g) => !(GRUPOS_HABILITACAO as readonly string[]).includes(g))];

  // A lista em texto, para mandar ao contador ou ao jurídico.
  const copiar = async () => {
    const linhas = grupos.flatMap((g) => [
      `${ROTULO_GRUPO_HABILITACAO[g as GrupoHabilitacao] ?? g}`,
      ...documentos
        .filter((d) => d.grupo === g)
        .map((d) => `[${d.situacao === "OK" ? "x" : d.situacao === "NAO_SE_APLICA" ? "-" : " "}] ${d.documento}${d.exigencia ? ` — ${d.exigencia}` : ""}${d.validade ? ` (validade ${dataBr(d.validade)})` : ""}${d.fonte ? ` [${d.fonte}]` : ""}`),
      "",
    ]);
    try {
      await navigator.clipboard.writeText(linhas.join("\n").trim());
      setAviso("Lista copiada.");
    } catch {
      setAviso("O navegador não deixou copiar.");
    }
    setTimeout(() => setAviso(null), 3000);
  };

  return (
    <div className="space-y-4">
      <Cartao
        titulo="Documentos de habilitação"
        ajuda={
          <>
            O que o edital pede para habilitar, por grupo. Marque cada documento à medida que fica pronto e anote a validade das certidões
            {dataSessao ? ` — a sessão é em ${dataBr(dataSessao)}` : ""}.
          </>
        }
        acao={
          documentos.length > 0 && (
            <button type="button" className={botao} onClick={copiar}>
              Copiar lista
            </button>
          )
        }
      >
        {documentos.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhum documento ainda. Estudos criados pelo &ldquo;Importar edital&rdquo; já chegam com a lista; aqui dá para acrescentar à mão.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span>
              <strong className="tabular-nums">{prontos}</strong> de <span className="tabular-nums">{validos.length}</span> prontos
            </span>
            {vencendo > 0 && <span className="font-medium text-red-700">{vencendo === 1 ? "1 certidão vencida ou vencendo" : `${vencendo} certidões vencidas ou vencendo`}</span>}
            <label className="flex items-center gap-2 text-slate-600">
              <input type="checkbox" checked={soPendentes} onChange={(e) => setSoPendentes(e.target.checked)} />
              Só o que falta
            </label>
            {salvando && <span className="text-xs text-slate-400">Salvando…</span>}
            {aviso && <span className="text-xs text-emerald-700">{aviso}</span>}
          </div>
        )}
        {erro && <p className="mt-2 text-sm text-red-700">{erro}</p>}
      </Cartao>

      {grupos.map((g) => {
        const doGrupo = documentos.filter((d) => d.grupo === g);
        const visiveis = soPendentes ? doGrupo.filter((d) => d.situacao !== "OK" && d.situacao !== "NAO_SE_APLICA") : doGrupo;
        const okGrupo = doGrupo.filter((d) => d.situacao === "OK").length;
        const validosGrupo = doGrupo.filter((d) => d.situacao !== "NAO_SE_APLICA").length;
        return (
          <Cartao key={g} titulo={`${ROTULO_GRUPO_HABILITACAO[g as GrupoHabilitacao] ?? g} — ${okGrupo} de ${validosGrupo}`}>
            {visiveis.length === 0 ? (
              <p className="text-sm text-slate-500">Tudo pronto neste grupo.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {visiveis.map((d) => {
                  const problema = problemaDeValidade(d);
                  return (
                    <li key={d.id} className="grid grid-cols-1 gap-2 py-2.5 md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:gap-4">
                      <div className="min-w-0">
                        <p className={`text-sm ${d.situacao === "NAO_SE_APLICA" ? "text-slate-400 line-through" : "text-slate-800"}`}>{d.documento}</p>
                        {d.exigencia && <p className="mt-0.5 text-xs text-slate-600">{d.exigencia}</p>}
                        {d.fonte && <p className="mt-0.5 text-[11px] text-slate-400">{d.fonte}</p>}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          className={`${selecao} ${COR_SITUACAO[d.situacao as SituacaoDocumento] ?? ""}`}
                          aria-label={`Situação de ${d.documento}`}
                          value={d.situacao}
                          disabled={!podeEditar}
                          onChange={(e) => alterar(d.id, { situacao: e.target.value })}
                        >
                          {SITUACOES_DOCUMENTO.map((s) => (
                            <option key={s} value={s}>
                              {ROTULO_SITUACAO_DOCUMENTO[s]}
                            </option>
                          ))}
                        </select>
                        <label className="flex items-center gap-1 text-xs text-slate-500">
                          Validade
                          <input
                            type="date"
                            className={`rounded-md border px-1.5 py-1 text-[13px] ${problema ? "border-red-400 text-red-700" : "border-slate-300"}`}
                            value={d.validade ?? ""}
                            disabled={!podeEditar}
                            onChange={(e) => alterar(d.id, { validade: e.target.value || null })}
                          />
                        </label>
                        {problema && <span className="text-xs font-medium text-red-700">{problema}</span>}
                        <input
                          className="w-full rounded-md border border-slate-300 px-2 py-1 text-[13px] md:w-56"
                          aria-label={`Observação de ${d.documento}`}
                          placeholder="Observação (quem, onde)"
                          defaultValue={d.observacao ?? ""}
                          maxLength={1000}
                          disabled={!podeEditar}
                          onBlur={(e) => e.target.value.trim() !== (d.observacao ?? "") && alterar(d.id, { observacao: e.target.value.trim() || null })}
                        />
                        {podeEditar && (
                          <button type="button" className="text-xs text-slate-400 hover:text-red-700" aria-label={`Tirar ${d.documento}`} onClick={() => excluir(d)}>
                            ✕
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Cartao>
        );
      })}

      {podeEditar && (
        <Cartao titulo="Acrescentar documento">
          <div className="flex flex-wrap items-end gap-2">
            <select className={selecao} aria-label="Grupo" value={novo.grupo} onChange={(e) => setNovo((n) => ({ ...n, grupo: e.target.value as GrupoHabilitacao }))}>
              {GRUPOS_HABILITACAO.map((g) => (
                <option key={g} value={g}>
                  {ROTULO_GRUPO_HABILITACAO[g]}
                </option>
              ))}
            </select>
            <input className="min-w-56 flex-1 rounded-md border border-slate-300 px-2 py-1 text-[13px]" placeholder="Documento" maxLength={500} value={novo.documento} onChange={(e) => setNovo((n) => ({ ...n, documento: e.target.value }))} />
            <input className="min-w-56 flex-1 rounded-md border border-slate-300 px-2 py-1 text-[13px]" placeholder="Exigência (opcional)" maxLength={1000} value={novo.exigencia} onChange={(e) => setNovo((n) => ({ ...n, exigencia: e.target.value }))} />
            <button type="button" className={botao} disabled={salvando} onClick={acrescentar}>
              Acrescentar
            </button>
          </div>
        </Cartao>
      )}
    </div>
  );
}
