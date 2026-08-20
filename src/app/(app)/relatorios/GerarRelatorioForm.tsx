"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from "@/lib/ui";
import { gerarRelatorioAgora } from "./actions";

export default function GerarRelatorioForm({ dataPadrao, envioConfigurado }: { dataPadrao: string; envioConfigurado: boolean }) {
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [processando, iniciar] = useTransition();
  const router = useRouter();

  function executar(formData: FormData, enviar: boolean) {
    formData.set("enviar", enviar ? "1" : "0");
    setErro(null);
    setMensagem(null);
    iniciar(async () => {
      const resultado = await gerarRelatorioAgora(formData);
      if (resultado.erro && !resultado.relatorioId) {
        setErro(resultado.erro);
        return;
      }
      setMensagem(
        [
          resultado.enviado
            ? `Relatório enviado para ${resultado.destinatarios?.join(", ")}.`
            : "Relatório gerado (sem envio).",
          resultado.achados !== undefined ? `${resultado.achados} achado(s) em aberto.` : null,
          resultado.narrativa ? "Leitura executiva incluída." : "Sem leitura executiva (IA indisponível).",
          resultado.erro ?? null,
        ]
          .filter(Boolean)
          .join(" ")
      );
      router.refresh();
    });
  }

  return (
    <form className="flex flex-wrap items-end gap-3">
      <div>
        <label className={labelClass}>Data de referência</label>
        <input name="data" type="date" defaultValue={dataPadrao} className={inputClass} />
      </div>

      <button
        type="submit"
        disabled={processando}
        className={secondaryButtonClass}
        formAction={(formData) => executar(formData, false)}
      >
        {processando ? "Processando..." : "Gerar sem enviar"}
      </button>

      <button
        type="submit"
        disabled={processando || !envioConfigurado}
        className={primaryButtonClass}
        formAction={(formData) => executar(formData, true)}
        title={envioConfigurado ? undefined : "Configure RESEND_API_KEY para habilitar o envio"}
      >
        {processando ? "Processando..." : "Gerar e enviar por e-mail"}
      </button>

      <p className="w-full text-xs text-slate-500">
        A geração roda a auditoria do dia antes de montar o relatório — o documento e os achados sempre correspondem ao
        mesmo momento.
      </p>

      {erro && <p className="w-full rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p>}
      {mensagem && <p className="w-full rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{mensagem}</p>}
    </form>
  );
}
