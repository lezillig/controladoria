"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inputClass } from "@/lib/ui";
import { atribuirPerfil } from "./actions";

// Troca de perfil direto na linha da pessoa, sem tela intermediária.
//
// A escolha vazia é a primeira da lista e diz o que faz: remover o perfil
// devolve a pessoa às REGRAS DO PAPEL — não a deixa sem acesso. Sem essa opção
// explícita, desfazer uma atribuição errada exigiria criar um perfil que
// imitasse o papel, e alguém acabaria fazendo isso.

export default function AtribuirPerfil({
  userId,
  userNome,
  perfilId,
  perfis,
  herdado,
}: {
  userId: string;
  userNome: string;
  perfilId: string;
  perfis: { id: string; nome: string }[];
  // Nome do perfil padrão da empresa, quando é ele que está valendo por
  // herança. Sem dizer isso, o seletor apareceria vazio para alguém que na
  // prática tem acesso — e a tela estaria mentindo.
  herdado: string | null;
}) {
  const [valor, setValor] = useState(perfilId);
  const [erro, setErro] = useState<string | null>(null);
  const [processando, iniciar] = useTransition();
  const router = useRouter();

  if (perfis.length === 0) {
    return <span className="text-xs text-slate-400">nenhum perfil criado</span>;
  }

  const salvar = (novo: string) => {
    const anterior = valor;
    setValor(novo);
    setErro(null);
    iniciar(async () => {
      const dados = new FormData();
      dados.set("userId", userId);
      dados.set("userNome", userNome);
      dados.set("perfilId", novo);
      const resultado = await atribuirPerfil(dados);
      if (resultado.erro) {
        // Volta ao valor anterior: um seletor que continua mostrando a escolha
        // que não foi gravada é pior que erro nenhum.
        setValor(anterior);
        setErro(resultado.erro);
        return;
      }
      router.refresh();
    });
  };

  return (
    <span className="inline-block">
      <select
        value={valor}
        disabled={processando}
        onChange={(e) => salvar(e.target.value)}
        className={`${inputClass} min-w-[10rem] py-1 text-xs`}
      >
        <option value="">— regras do papel —</option>
        {perfis.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nome}
          </option>
        ))}
      </select>
      {herdado && !valor && (
        <span className="mt-0.5 block text-xs text-slate-500">herda o padrão: {herdado}</span>
      )}
      {erro && <span className="mt-0.5 block text-xs text-red-700">{erro}</span>}
    </span>
  );
}
