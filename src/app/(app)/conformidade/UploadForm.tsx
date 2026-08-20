"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inputClass, labelClass, primaryButtonClass } from "@/lib/ui";
import { ORIGENS } from "@/lib/conformidade/tipos";
import { enviarDocumento } from "./actions";

// Envio do documento recebido da consultoria.
//
// A competência é campo obrigatório e separado da data de envio de propósito:
// o relatório de julho costuma chegar em agosto, e é a competência — não a data
// do upload — que responde "o relatório do mês passado chegou?" e liga o
// apontamento de agosto ao mesmo assunto de julho.

export default function UploadForm({
  conexoes,
  competenciaPadrao,
  leituraDisponivel,
}: {
  conexoes: { id: string; apelido: string; nome: string }[];
  competenciaPadrao: string;
  leituraDisponivel: boolean;
}) {
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [processando, iniciar] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  return (
    <form
      ref={formRef}
      className="space-y-4"
      action={(formData) => {
        setErro(null);
        setMensagem(null);
        setAviso(null);
        iniciar(async () => {
          const resultado = await enviarDocumento(formData);
          if (resultado.erro) {
            setErro(resultado.erro);
            return;
          }
          const criados = resultado.apontamentosCriados ?? 0;
          setMensagem(
            criados > 0
              ? `Documento guardado. ${criados} apontamento(s) propostos para conferência` +
                  (resultado.apontamentosIgnorados ? ` (${resultado.apontamentosIgnorados} já existiam nesta competência).` : ".")
              : "Documento guardado."
          );
          if (resultado.avisoLeitura) setAviso(resultado.avisoLeitura);
          formRef.current?.reset();
          router.refresh();
        });
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelClass}>Arquivo *</label>
          <input
            name="arquivo"
            type="file"
            required
            accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.docx,.csv,.txt,.md"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700"
          />
          <p className="mt-1 text-xs text-slate-500">
            PDF, imagem, planilha, Word ou texto — até 8 MB. O arquivo original fica guardado como evidência do apontamento.
          </p>
        </div>

        <div>
          <label className={labelClass}>Competência *</label>
          <input name="competencia" type="month" required defaultValue={competenciaPadrao} className={inputClass} />
          <p className="mt-1 text-xs text-slate-500">O mês que o documento analisa, não o mês em que ele chegou.</p>
        </div>

        <div>
          <label className={labelClass}>Data do documento</label>
          <input name="dataDocumento" type="date" className={inputClass} />
        </div>

        <div>
          <label className={labelClass}>Título</label>
          <input name="titulo" type="text" placeholder="Ex.: Revisão fiscal mensal" className={inputClass} />
          <p className="mt-1 text-xs text-slate-500">Em branco, usa o nome do arquivo.</p>
        </div>

        <div>
          <label className={labelClass}>Emissor</label>
          <input name="emissor" type="text" placeholder="Nome da consultoria ou escritório" className={inputClass} />
        </div>

        <div>
          <label className={labelClass}>Origem</label>
          <select name="origem" defaultValue="CONSULTORIA" className={inputClass}>
            {ORIGENS.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.rotulo}
              </option>
            ))}
          </select>
        </div>

        {conexoes.length > 0 && (
          <div>
            <label className={labelClass}>Empresa</label>
            <select name="conexaoId" defaultValue="" className={inputClass}>
              <option value="">Grupo (as duas empresas)</option>
              {conexoes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.apelido} — {c.nome}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              Deixe em &quot;grupo&quot; quando o documento analisa os dois CNPJs juntos.
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={processando} className={primaryButtonClass}>
          {processando ? "Enviando e lendo..." : "Enviar documento"}
        </button>
        <span className="text-xs text-slate-500">
          {leituraDisponivel
            ? "Ao enviar, o documento é lido e os apontamentos são propostos para sua conferência."
            : "Leitura automática desligada — o arquivo é guardado e os apontamentos são cadastrados à mão."}
        </span>
      </div>

      {erro && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p>}
      {mensagem && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{mensagem}</p>}
      {aviso && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          O arquivo foi guardado, mas a leitura automática não concluiu: {aviso}
        </p>
      )}
    </form>
  );
}
