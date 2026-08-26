"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/lib/ui";
import { GRUPOS_DE_PERMISSAO, PERFIS_SUGERIDOS, PERMISSOES } from "@/lib/acessos";
import { excluirPerfil, salvarPerfil } from "./actions";

// O PERFIL, COM AS PERMISSÕES À VISTA.
//
// A grade é de caixas marcáveis e não de uma lista de "níveis" (básico, médio,
// total) porque nível esconde o que concede: quem escolhe "médio" não sabe se
// aquilo inclui disparar sincronização, e descobre depois. Aqui, conceder é
// ler o que se está concedendo.
//
// TELAS e AÇÕES ficam em blocos separados pelo motivo que está no catálogo:
// num sistema de auditoria, "ver o achado" e "poder desligar o alerta" não
// podem ser a mesma permissão — senão dar leitura a alguém dá junto o poder de
// apagar o que incomoda.

export type PerfilEmEdicao = {
  id: string;
  nome: string;
  descricao: string;
  permissoes: string[];
  padrao: boolean;
  usuarios: number;
};

export default function PerfilForm({ perfil }: { perfil?: PerfilEmEdicao }) {
  const novo = !perfil;
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState(perfil?.nome ?? "");
  const [descricao, setDescricao] = useState(perfil?.descricao ?? "");
  const [padrao, setPadrao] = useState(perfil?.padrao ?? false);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set(perfil?.permissoes ?? []));
  const [erro, setErro] = useState<string | null>(null);
  const [processando, iniciar] = useTransition();
  const router = useRouter();

  const alternar = (chave: string) =>
    setMarcadas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(chave)) proximo.delete(chave);
      else proximo.add(chave);
      return proximo;
    });

  const aplicarSugestao = (sugestao: (typeof PERFIS_SUGERIDOS)[number]) => {
    if (!nome) setNome(sugestao.nome);
    if (!descricao) setDescricao(sugestao.descricao);
    setMarcadas(new Set<string>(sugestao.permissoes));
  };

  const enviar = () => {
    setErro(null);
    const dados = new FormData();
    if (perfil) dados.set("id", perfil.id);
    dados.set("nome", nome);
    dados.set("descricao", descricao);
    if (padrao) dados.set("padrao", "1");
    for (const p of marcadas) dados.append("permissoes", p);

    iniciar(async () => {
      const resultado = await salvarPerfil(dados);
      if (resultado.erro) {
        setErro(resultado.erro);
        return;
      }
      if (novo) {
        setNome("");
        setDescricao("");
        setPadrao(false);
        setMarcadas(new Set());
      }
      setAberto(false);
      router.refresh();
    });
  };

  const remover = () => {
    if (!perfil) return;
    setErro(null);
    const dados = new FormData();
    dados.set("id", perfil.id);
    iniciar(async () => {
      const resultado = await excluirPerfil(dados);
      if (resultado.erro) {
        setErro(resultado.erro);
        return;
      }
      router.refresh();
    });
  };

  // Fechado, o perfil existente é uma linha de resumo. Cinco perfis abertos ao
  // mesmo tempo seriam cem caixas na tela, e achar o que se quer mudar viraria
  // o trabalho.
  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="flex w-full items-center gap-3 rounded-lg border border-slate-200 px-4 py-3 text-left hover:bg-slate-50"
      >
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
        {novo ? (
          <span className="text-sm font-medium text-blue-700">+ Novo perfil de acesso</span>
        ) : (
          <>
            <span className="min-w-0 flex-1">
              <span className="text-sm font-medium text-slate-800">{perfil.nome}</span>
              {perfil.padrao && (
                <span className="ml-2 inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                  padrão da empresa
                </span>
              )}
              {perfil.descricao && <span className="block text-xs text-slate-500">{perfil.descricao}</span>}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-slate-500">
              {perfil.permissoes.length} de {PERMISSOES.length} · {perfil.usuarios} pessoa(s)
            </span>
          </>
        )}
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-slate-300 bg-slate-50 p-4">
      <button
        type="button"
        onClick={() => setAberto(false)}
        className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-700"
      >
        <ChevronDown className="h-4 w-4 text-slate-400" />
        {novo ? "Novo perfil de acesso" : perfil.nome}
      </button>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass}>Nome do perfil</label>
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Financeiro" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Descrição (opcional)</label>
          <input
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="O que este recorte enxerga e opera"
            className={inputClass}
          />
        </div>
      </div>

      {novo && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">Começar de:</span>
          {PERFIS_SUGERIDOS.map((s) => (
            <button
              key={s.nome}
              type="button"
              onClick={() => aplicarSugestao(s)}
              title={s.descricao}
              className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              {s.nome}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {GRUPOS_DE_PERMISSAO.map((grupo) => {
          const doGrupo = PERMISSOES.filter((p) => p.grupo === grupo);
          const todas = doGrupo.every((p) => marcadas.has(p.chave));
          return (
            <div key={grupo} className="rounded-lg bg-white p-3 ring-1 ring-slate-200">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{grupo}</p>
                <button
                  type="button"
                  onClick={() =>
                    setMarcadas((atual) => {
                      const proximo = new Set(atual);
                      for (const p of doGrupo) {
                        if (todas) proximo.delete(p.chave);
                        else proximo.add(p.chave);
                      }
                      return proximo;
                    })
                  }
                  className="text-xs font-medium text-blue-700 hover:underline"
                >
                  {todas ? "desmarcar todas" : "marcar todas"}
                </button>
              </div>
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                {doGrupo.map((p) => (
                  <label
                    key={p.chave}
                    className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={marcadas.has(p.chave)}
                      onChange={() => alternar(p.chave)}
                      className="h-4 w-4 shrink-0 rounded border-slate-300 text-blue-700 focus:ring-blue-500"
                    />
                    {p.rotulo}
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={padrao}
          onChange={(e) => setPadrao(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-blue-700 focus:ring-blue-500"
        />
        <span>
          Perfil padrão da empresa
          <span className="block text-xs text-slate-500">
            Passa a valer para quem não tiver perfil próprio, no lugar das regras do papel. Só um por empresa — marcar
            este desmarca o anterior.
          </span>
        </span>
      </label>

      {erro && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={enviar} disabled={processando} className={primaryButtonClass}>
          {processando ? "Salvando..." : novo ? "Criar perfil" : "Salvar alterações"}
        </button>
        <button type="button" onClick={() => setAberto(false)} className={secondaryButtonClass}>
          Cancelar
        </button>
        {perfil && (
          <button
            type="button"
            onClick={remover}
            disabled={processando}
            className="rounded-lg px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
          >
            Excluir perfil
          </button>
        )}
      </div>
    </div>
  );
}
