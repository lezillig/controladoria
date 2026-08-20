"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inputClass, primaryButtonClass, secondaryButtonClass } from "@/lib/ui";
import { tratarAchado } from "./actions";

// Formulário de tratativa. É o único ponto interativo da tela de auditoria —
// o resto é renderizado no servidor. Fica fechado por padrão para a lista não
// virar uma parede de formulários.

const OPCOES = [
  { valor: "EM_ANALISE", rotulo: "Em análise", ajuda: "Alguém está verificando. Continua contando como aberto nos indicadores." },
  { valor: "RESOLVIDO", rotulo: "Resolvido", ajuda: "O problema foi corrigido. Descreva o que foi feito." },
  { valor: "IGNORADO", rotulo: "Não se aplica", ajuda: "O achado não procede neste caso. Descreva o porquê — ele volta rebaixado se a condição persistir." },
  { valor: "ABERTO", rotulo: "Reabrir", ajuda: "Volta para a fila de tratativa." },
];

export default function TratativaForm({
  achadoId,
  statusAtual,
  observacaoAtual,
}: {
  achadoId: string;
  statusAtual: string;
  observacaoAtual: string | null;
}) {
  const [aberto, setAberto] = useState(false);
  const [status, setStatus] = useState(statusAtual === "ABERTO" ? "EM_ANALISE" : statusAtual);
  const [observacao, setObservacao] = useState(observacaoAtual ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [processando, iniciar] = useTransition();
  const router = useRouter();

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className={`${secondaryButtonClass} mt-3 text-xs`}
      >
        Registrar tratativa
      </button>
    );
  }

  const opcaoSelecionada = OPCOES.find((o) => o.valor === status);

  return (
    <form
      className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
      action={(formData) => {
        setErro(null);
        iniciar(async () => {
          const resultado = await tratarAchado(formData);
          if (resultado.erro) {
            setErro(resultado.erro);
            return;
          }
          setAberto(false);
          router.refresh();
        });
      }}
    >
      <input type="hidden" name="id" value={achadoId} />

      <label className="block text-xs font-medium text-slate-700">Situação</label>
      <select
        name="status"
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        className={`${inputClass} mt-1`}
      >
        {OPCOES.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.rotulo}
          </option>
        ))}
      </select>
      {opcaoSelecionada && <p className="mt-1 text-xs text-slate-500">{opcaoSelecionada.ajuda}</p>}

      <label className="mt-3 block text-xs font-medium text-slate-700">
        O que foi verificado
        {(status === "RESOLVIDO" || status === "IGNORADO") && <span className="text-red-600"> *</span>}
      </label>
      <textarea
        name="observacao"
        rows={3}
        value={observacao}
        onChange={(e) => setObservacao(e.target.value)}
        placeholder="Ex.: conferido com a nota fiscal do fornecedor; era cobrança de dois serviços distintos no mesmo valor."
        className={`${inputClass} mt-1`}
      />

      {erro && <p className="mt-2 text-xs font-medium text-red-700">{erro}</p>}

      <div className="mt-3 flex items-center gap-2">
        <button type="submit" disabled={processando} className={`${primaryButtonClass} text-xs`}>
          {processando ? "Salvando..." : "Salvar tratativa"}
        </button>
        <button type="button" onClick={() => setAberto(false)} className={`${secondaryButtonClass} text-xs`}>
          Cancelar
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        A tratativa fica registrada com seu nome, data e origem da requisição — é o que dá valor de controle interno ao módulo.
      </p>
    </form>
  );
}
