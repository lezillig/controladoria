"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inputClass, labelClass, larguraFormulario, primaryButtonClass, secondaryButtonClass } from "@/lib/ui";
import { ROLE_LABELS } from "@/lib/permissions";
import { criarUsuario } from "./actions";

// CRIAR PESSOA — e a tela diz, antes de qualquer campo, onde isso vai parar.
//
// O cadastro é o do sistema de GESTÃO, o mesmo do login da frota. Quem preenche
// este formulário precisa saber disso na hora de preencher, não depois: o papel
// escolhido aqui vale para as duas aplicações, e a senha definida aqui é a
// senha da frota.

const PAPEIS = ["ADMIN", "GESTOR", "CONTROLADORIA", "FOLHA", "MOTORISTA"] as const;

// O que cada papel significa para o FINANCEIRO — que é a pergunta de quem está
// nesta tela. Sem isso, escolher entre GESTOR e CONTROLADORIA é adivinhação.
const EFEITO_NO_FINANCEIRO: Record<string, string> = {
  ADMIN: "entra e opera tudo",
  GESTOR: "entra e lê tudo, não altera",
  CONTROLADORIA: "entra e opera tudo",
  FOLHA: "não entra na Controladoria",
  MOTORISTA: "não entra na Controladoria",
};

export default function NovoUsuario({
  perfis,
  conexaoSeparada,
}: {
  perfis: { id: string; nome: string }[];
  // Com bancos separados, a conexão com a gestão é (e deve ser) somente
  // leitura — então a criação daqui provavelmente vai falhar. Dizer isso ANTES
  // vale mais que uma mensagem de erro depois de digitar tudo.
  conexaoSeparada: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [role, setRole] = useState<string>("CONTROLADORIA");
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [processando, iniciar] = useTransition();
  const router = useRouter();

  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)} className={primaryButtonClass}>
        Cadastrar pessoa
      </button>
    );
  }

  return (
    <form
      className={`${larguraFormulario} space-y-4`}
      action={(formData) => {
        setErro(null);
        setAviso(null);
        iniciar(async () => {
          const resultado = await criarUsuario(formData);
          if (resultado.erro) {
            setErro(resultado.erro);
            return;
          }
          setAviso(resultado.aviso ?? null);
          router.refresh();
        });
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass}>Nome</label>
          <input name="nome" placeholder="Maria Silva" className={inputClass} autoComplete="off" />
        </div>
        <div>
          <label className={labelClass}>E-mail</label>
          <input name="email" type="email" placeholder="maria@empresa.com.br" className={inputClass} autoComplete="off" />
        </div>
        <div>
          <label className={labelClass}>Senha provisória</label>
          {/* new-password impede o navegador de oferecer a senha de QUEM ESTÁ
              cadastrando — é o preenchimento automático mais perigoso que
              existe numa tela como esta. */}
          <input name="senha" type="password" className={inputClass} autoComplete="new-password" />
          <p className="mt-1 text-xs text-slate-500">
            Ao menos 8 caracteres. Combine com a pessoa por um canal seguro e peça que ela troque no primeiro acesso.
          </p>
        </div>
        <div>
          <label className={labelClass}>Papel na gestão</label>
          <select name="role" value={role} onChange={(e) => setRole(e.target.value)} className={inputClass}>
            {PAPEIS.map((p) => (
              <option key={p} value={p}>
                {ROLE_LABELS[p] ?? p}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            Vale para as duas aplicações. Na Controladoria: <strong>{EFEITO_NO_FINANCEIRO[role]}</strong>.
          </p>
        </div>
      </div>

      {perfis.length > 0 && (
        <div>
          <label className={labelClass}>Perfil de acesso (opcional)</label>
          <select name="perfilId" className={`${inputClass} sm:max-w-xs`} defaultValue="">
            <option value="">— regras do papel —</option>
            {perfis.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
        <p className="text-xs text-slate-600">
          A pessoa é criada no cadastro do <strong>sistema de gestão</strong> — é o mesmo login da frota, com uma senha
          só. Desligar essa pessoa lá tira o acesso ao financeiro no mesmo ato, inclusive de sessão já aberta.
        </p>
        {conexaoSeparada && (
          <p className="mt-2 text-xs text-amber-800">
            A conexão com o banco da gestão é separada e, pelo desenho recomendado, somente leitura. Se a criação for
            recusada por permissão, é isso: cadastre a pessoa no próprio sistema de gestão (ela aparece aqui na hora) ou
            conceda escrita conforme <code className="font-mono">docs/papel-leitura-gestao.sql</code>.
          </p>
        )}
      </div>

      {erro && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p>}
      {aviso && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{aviso}</p>}

      <div className="flex gap-2">
        <button type="submit" disabled={processando} className={primaryButtonClass}>
          {processando ? "Criando..." : "Criar usuário"}
        </button>
        <button type="button" onClick={() => setAberto(false)} className={secondaryButtonClass}>
          Fechar
        </button>
      </div>
    </form>
  );
}
