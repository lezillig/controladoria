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
  papelNoGrupo: string;
  endereco: string;
  cidade: string;
  representanteNome: string;
  representanteRg: string;
  representanteCpf: string;
  representanteCargo: string;
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
        {/* O PAPEL NO GRUPO decide em qual das duas linhas de pessoas do DRE
            cai a folha desta empresa: "— operação" ou "— corporativo". É da empresa, não da categoria: a mesma
            categoria "Salários" existe nas duas contas Omie. */}
        <div>
          <label className={labelClass}>Papel no grupo</label>
          <select name="papelNoGrupo" defaultValue={conexao?.papelNoGrupo ?? "OPERACAO"} className={inputClass}>
            <option value="OPERACAO">Operação</option>
            <option value="CORPORATIVO">Corporativo</option>
          </select>
          <p className="mt-1 text-xs text-slate-500">
            No DRE, a folha desta empresa vai para &quot;Despesas com pessoas — operação&quot; ou &quot;— corporativo&quot;.
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

      {/* DADOS PARA PROPOSTAS: vão ao cabeçalho e à assinatura do orçamento
          exportado pelo simulador. */}
      <fieldset className="rounded-lg bg-white p-3 ring-1 ring-slate-200">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Dados para propostas</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={labelClass}>Endereço da sede</label>
            <input name="endereco" defaultValue={conexao?.endereco} placeholder="Rua, número, bairro, CEP, cidade/UF" className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Cidade (local da proposta)</label>
            <input name="cidade" defaultValue={conexao?.cidade} placeholder="São Paulo" className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Representante legal — nome</label>
            <input name="representanteNome" defaultValue={conexao?.representanteNome} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>RG</label>
            <input name="representanteRg" defaultValue={conexao?.representanteRg} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>CPF</label>
            <input name="representanteCpf" defaultValue={conexao?.representanteCpf} placeholder="000.000.000-00" className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Cargo</label>
            <input name="representanteCargo" defaultValue={conexao?.representanteCargo} placeholder="Sócio-administrador" className={inputClass} />
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Saem no orçamento exportado (dados da proponente e assinatura). O local e a data da proposta são esta cidade e o dia em que a planilha é gerada.
        </p>
      </fieldset>

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
