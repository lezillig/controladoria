"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inputClass, labelClass, larguraFormulario, primaryButtonClass, secondaryButtonClass } from "@/lib/ui";
import { salvarConexao } from "./actions";

export type ConexaoEmEdicao = {
  id: string;
  nome: string;
  apelido: string;
  cnpj: string;
  credencialRef: string;
};

export default function ConexaoForm({ conexao }: { conexao?: ConexaoEmEdicao }) {
  const [aberto, setAberto] = useState(!conexao);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [apelido, setApelido] = useState(conexao?.apelido ?? "");
  const [credencialRef, setCredencialRef] = useState(conexao?.credencialRef ?? "");
  const [processando, iniciar] = useTransition();
  const router = useRouter();

  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)} className={`${secondaryButtonClass} text-xs`}>
        Editar
      </button>
    );
  }

  const refEfetiva = (credencialRef || apelido).toUpperCase().replace(/[^A-Z0-9]/g, "");

  return (
    <form
      className={`${larguraFormulario} space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4`}
      action={(formData) => {
        setErro(null);
        setAviso(null);
        if (!formData.get("credencialRef")) formData.set("credencialRef", apelido);
        iniciar(async () => {
          const resultado = await salvarConexao(formData);
          if (resultado.erro) {
            setErro(resultado.erro);
            return;
          }
          setAviso(resultado.aviso ?? null);
          if (!resultado.aviso && conexao) setAberto(false);
          router.refresh();
        });
      }}
    >
      {conexao && <input type="hidden" name="id" value={conexao.id} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass}>Razão social</label>
          <input name="nome" defaultValue={conexao?.nome} placeholder="Azul Transportes e Turismo LTDA" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>CNPJ (opcional)</label>
          <input name="cnpj" defaultValue={conexao?.cnpj} placeholder="00.000.000/0001-00" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Apelido</label>
          <input
            name="apelido"
            value={apelido}
            onChange={(e) => setApelido(e.target.value.toUpperCase())}
            placeholder="AZUL"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-slate-500">
            Rótulo curto que identifica a empresa nas listas, nos filtros e nos alertas.
          </p>
        </div>
        <div>
          <label className={labelClass}>Referência de credencial</label>
          <input
            name="credencialRef"
            value={credencialRef}
            onChange={(e) => setCredencialRef(e.target.value.toUpperCase())}
            placeholder={apelido || "AZUL"}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-slate-500">Em branco, usa o apelido.</p>
        </div>
      </div>

      <div className="rounded-lg bg-white p-3 ring-1 ring-slate-200">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Variáveis de ambiente que esta conexão vai procurar
        </p>
        <p className="mt-1 font-mono text-xs text-slate-700">
          OMIE_APP_KEY_{refEfetiva || "…"}
          <br />
          OMIE_APP_SECRET_{refEfetiva || "…"}
        </p>
        <p className="mt-2 text-xs text-slate-500">
          A chave e o segredo <strong>não</strong> são digitados aqui e nunca ficam no banco — só nas variáveis de
          ambiente da hospedagem. O cadastro guarda apenas o nome delas.
        </p>
      </div>

      {erro && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p>}
      {aviso && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{aviso}</p>}

      <div className="flex gap-2">
        <button type="submit" disabled={processando} className={primaryButtonClass}>
          {processando ? "Salvando..." : conexao ? "Salvar alterações" : "Cadastrar conexão"}
        </button>
        {conexao && (
          <button type="button" onClick={() => setAberto(false)} className={secondaryButtonClass}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}
