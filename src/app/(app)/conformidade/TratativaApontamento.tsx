"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inputClass, primaryButtonClass, secondaryButtonClass } from "@/lib/ui";
import { STATUS } from "@/lib/conformidade/tipos";
import { tratarApontamento } from "./actions";

// Tratativa do apontamento: quem assume, até quando e o que foi feito.
//
// Fica fechado por padrão — uma lista com trinta formulários abertos é uma
// parede que ninguém lê. E pede as três coisas juntas de propósito: apontamento
// com responsável e sem prazo, ou com prazo e sem responsável, é o formato em
// que um risco fica parado seis meses sem nunca parecer parado.

const EXIGEM_JUSTIFICATIVA = ["RESOLVIDO", "NAO_SE_APLICA", "ACEITO_COM_RISCO"];

export default function TratativaApontamento({
  apontamentoId,
  statusAtual,
  responsavelAtual,
  prazoAtual,
  observacaoAtual,
}: {
  apontamentoId: string;
  statusAtual: string;
  responsavelAtual: string | null;
  prazoAtual: string | null;
  observacaoAtual: string | null;
}) {
  const [aberto, setAberto] = useState(false);
  const [status, setStatus] = useState(statusAtual === "ABERTO" ? "EM_TRATATIVA" : statusAtual);
  const [erro, setErro] = useState<string | null>(null);
  const [processando, iniciar] = useTransition();
  const router = useRouter();

  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)} className={`${secondaryButtonClass} mt-3 text-xs`}>
        Tratar apontamento
      </button>
    );
  }

  const opcao = STATUS.find((o) => o.valor === status);
  const exigeTexto = EXIGEM_JUSTIFICATIVA.includes(status);

  return (
    <form
      className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
      action={(formData) => {
        setErro(null);
        iniciar(async () => {
          const resultado = await tratarApontamento(formData);
          if (resultado.erro) {
            setErro(resultado.erro);
            return;
          }
          setAberto(false);
          router.refresh();
        });
      }}
    >
      <input type="hidden" name="id" value={apontamentoId} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="block text-xs font-medium text-slate-700">Situação</label>
          <select
            name="status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className={`${inputClass} mt-1`}
          >
            {STATUS.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.rotulo}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700">Responsável</label>
          <input
            name="responsavel"
            type="text"
            defaultValue={responsavelAtual ?? ""}
            placeholder="Quem vai tratar"
            className={`${inputClass} mt-1`}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700">Prazo</label>
          <input name="prazo" type="date" defaultValue={prazoAtual ?? ""} className={`${inputClass} mt-1`} />
        </div>
      </div>

      {opcao && <p className="mt-2 text-xs text-slate-500">{opcao.explicacao}</p>}

      <label className="mt-3 block text-xs font-medium text-slate-700">
        O que foi feito ou decidido{exigeTexto && <span className="text-red-600"> *</span>}
      </label>
      <textarea
        name="observacao"
        rows={3}
        defaultValue={observacaoAtual ?? ""}
        placeholder="Ex.: crédito apurado e retificada a EFD de 07/2026; a rotina mensal passou a conferir o CFOP antes do fechamento."
        className={`${inputClass} mt-1`}
      />

      {erro && <p className="mt-2 text-xs font-medium text-red-700">{erro}</p>}

      <div className="mt-3 flex items-center gap-2">
        <button type="submit" disabled={processando} className={`${primaryButtonClass} text-xs`}>
          {processando ? "Salvando..." : "Salvar"}
        </button>
        <button type="button" onClick={() => setAberto(false)} className={`${secondaryButtonClass} text-xs`}>
          Cancelar
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Fica registrado com seu nome, data e origem da requisição. Prazo sem responsável costuma virar prazo de ninguém.
      </p>
    </form>
  );
}
