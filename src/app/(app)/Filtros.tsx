"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Loader2 } from "lucide-react";

// FILTROS DO PAINEL — empresa e competência, no cliente e não em <Link>.
//
// A versão anterior era um punhado de links de servidor, e o resultado prático
// era um relato de defeito: "não está funcionando, selecionar azul, mcz". Não
// estava quebrado — estava lento. Esta tela remonta o contexto de auditoria
// inteiro a cada abertura, e enquanto isso a página anterior fica na frente,
// intacta, com o chip antigo ainda aceso. Quem clica não tem como distinguir
// "está carregando" de "o botão não faz nada", e conclui a segunda coisa.
//
// `useTransition` resolve isso mostrando a espera: o chip escolhido acende na
// hora, o conjunto inteiro desbota e um indicador aparece. A troca não fica
// mais rápida — fica HONESTA, que é o que faltava.
//
// A lentidão em si é outro problema, e é de consulta, não de interface.

export type OpcaoCompetencia = { valor: string; rotulo: string };

export default function Filtros({
  conexoes,
  empresaAtiva,
  competencias,
  competenciaAtiva,
  rota,
  extras,
}: {
  conexoes: { id: string; apelido: string; nome: string }[];
  empresaAtiva: string | null;
  competencias: OpcaoCompetencia[];
  competenciaAtiva: string | null;
  rota: string;
  // Parâmetros da própria tela que precisam sobreviver à troca de filtro —
  // a aba "a pagar / a receber" dos títulos, por exemplo. Sem isso, escolher
  // uma competência em "a receber" devolveria a pessoa para "a pagar".
  extras?: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const [navegando, iniciar] = useTransition();

  // Monta o destino preservando o OUTRO filtro. Trocar de empresa não pode
  // jogar a competência escolhida fora, e vice-versa: quem está comparando
  // março de AZUL com março de MCZ perderia o mês a cada clique.
  const ir = (empresa: string | null, competencia: string | null) => {
    const q = new URLSearchParams();
    for (const [chave, valor] of Object.entries(extras ?? {})) {
      if (valor) q.set(chave, valor);
    }
    if (empresa) q.set("empresa", empresa);
    if (competencia) q.set("competencia", competencia);
    const busca = q.toString();
    iniciar(() => router.push(busca ? `${rota}?${busca}` : rota));
  };

  const chip = (rotulo: string, selecionado: boolean, aoClicar: () => void, titulo?: string) => (
    <button
      key={rotulo}
      type="button"
      title={titulo}
      onClick={aoClicar}
      disabled={navegando}
      className={`rounded-full px-3 py-1 text-xs font-medium transition disabled:cursor-wait ${
        selecionado ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
      }`}
    >
      {rotulo}
    </button>
  );

  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 ${navegando ? "opacity-60" : ""}`}>
      {conexoes.length >= 2 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-slate-500">Empresa:</span>
          {chip("Grupo (todas)", empresaAtiva === null, () => ir(null, competenciaAtiva), "Consolidado do grupo")}
          {conexoes.map((c) => chip(c.apelido, empresaAtiva === c.id, () => ir(c.id, competenciaAtiva), c.nome))}
        </div>
      )}

      {competencias.length > 0 && (
        <div className="flex items-center gap-1.5">
          <label htmlFor="competencia" className="text-xs text-slate-500">
            Competência:
          </label>
          <select
            id="competencia"
            value={competenciaAtiva ?? ""}
            disabled={navegando}
            onChange={(e) => ir(empresaAtiva, e.target.value || null)}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 disabled:cursor-wait"
          >
            {/* O mês corrente não aparece na lista: ele É esta opção. */}
            <option value="">Leitura corrente (D-1)</option>
            {competencias.map((c) => (
              <option key={c.valor} value={c.valor}>
                {c.rotulo}
              </option>
            ))}
          </select>
        </div>
      )}

      {navegando && (
        <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
          <Loader2 className="h-3 w-3 animate-spin" />
          Recalculando o painel…
        </span>
      )}
    </div>
  );
}
