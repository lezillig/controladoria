"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inputClass, labelClass, primaryButtonClass } from "@/lib/ui";
import type { EstadoInvestigacao } from "@/lib/controladoria/investigador";
import { Secao } from "../../_componentes";
import { avancar, iniciar } from "./actions";
import { tratarAchado } from "../actions";

const EXEMPLOS = [
  "O que está acontecendo com os títulos vencidos da Cajamar? Quanto é, desde quando, e há tratativa registrada?",
  "Quais fornecedores novos apareceram nos últimos três meses com valor acima do que costumamos pagar?",
  "A OS 14516 teve custo lançado e foi faturada? Se não foi, desde quando o custo está parado?",
  "Os achados de juros deste mês se concentram em algum fornecedor ou em alguma data de pagamento?",
];

const ROTULO_STATUS: Record<string, string> = {
  RESOLVIDO: "Resolvido",
  IGNORADO: "Não se aplica",
  EM_ANALISE: "Em análise",
};

// A proposta da IA vira tratativa só aqui, pela mesma ação que a tela de
// auditoria usa — sessão, permissão e trilha de quem clicou. O texto pode ser
// ajustado antes de aplicar: a IA propôs, a pessoa assina.
function PropostaForm({
  achadoId,
  status,
  justificativa,
  responsavel,
}: {
  achadoId: string;
  status: string;
  justificativa: string;
  responsavel: string;
}) {
  const [texto, setTexto] = useState(justificativa);
  const [resultado, setResultado] = useState<string | null>(null);
  const [processando, iniciarTransicao] = useTransition();
  const router = useRouter();

  if (resultado) return <p className="mt-2 font-medium text-emerald-700">{resultado}</p>;

  return (
    <form
      className="mt-2 space-y-2"
      action={(formData) => {
        iniciarTransicao(async () => {
          const r = await tratarAchado(formData);
          if (r.erro) {
            setResultado(null);
            alert(r.erro);
            return;
          }
          setResultado("Tratativa aplicada com o seu nome.");
          router.refresh();
        });
      }}
    >
      <input type="hidden" name="id" value={achadoId} />
      <input type="hidden" name="status" value={status} />
      <input type="hidden" name="responsavel" value={responsavel} />
      <textarea name="observacao" rows={2} value={texto} onChange={(e) => setTexto(e.target.value)} className={`${inputClass} text-xs`} />
      <button type="submit" disabled={processando} className={`${primaryButtonClass} text-xs`}>
        {processando ? "Aplicando..." : `Aplicar: ${ROTULO_STATUS[status] ?? status}`}
      </button>
    </form>
  );
}

export default function InvestigacaoForm({
  conexoes,
  inicial,
  perguntaInicial,
  podeTratar = false,
}: {
  conexoes: { id: string; apelido: string; nome: string }[];
  // Uma investigação já gravada, para reabrir pelo histórico. Se ainda estiver
  // em andamento (a aba foi fechada no meio), a tela retoma as rodadas.
  inicial: EstadoInvestigacao | null;
  // Pergunta pré-preenchida por um link de outra tela (o botão "Investigar
  // este achado" na auditoria). Só preenche; a pessoa ainda clica em Investigar.
  perguntaInicial?: string;
  // Quem pode aplicar a proposta de tratativa da IA. Vem da sessão, na página.
  podeTratar?: boolean;
}) {
  const [estado, setEstado] = useState<EstadoInvestigacao | null>(inicial);
  const [erro, setErro] = useState<string | null>(null);
  // Controlado pelo mesmo motivo da conferência de CT-e: o React limpa o
  // formulário depois da action, e a pessoa quer refinar a pergunta, não
  // digitá-la de novo.
  const [pergunta, setPergunta] = useState(inicial?.pergunta ?? perguntaInicial ?? "");
  const [processando, iniciarTransicao] = useTransition();
  const router = useRouter();

  // Encadeia as rodadas até a investigação terminar. Cada rodada é uma
  // requisição curta; o servidor grava o progresso entre elas, então fechar a
  // aba não perde nada — reabrir pelo histórico retoma.
  const conduzir = (id: string) => {
    iniciarTransicao(async () => {
      while (true) {
        let r: Awaited<ReturnType<typeof avancar>>;
        try {
          r = await avancar(id);
        } catch (e) {
          setErro(
            "Perdi a conexão com o servidor no meio de uma rodada. A investigação continua gravada — recarregue a página e ela retoma. Detalhe: " +
              (e instanceof Error ? e.message : String(e))
          );
          return;
        }
        if (r.erro) {
          setErro(r.erro);
          return;
        }
        if (r.estado) setEstado(r.estado);
        if (!r.estado || r.estado.status !== "EXECUTANDO") {
          router.refresh();
          return;
        }
      }
    });
  };

  const ultimaConsulta = estado?.consultas[estado.consultas.length - 1];

  return (
    <div className="space-y-6">
      <Secao titulo="Pergunta" descricao="Quanto mais específica (nome, número, OS, mês), mais direta a resposta e menos consultas ela gasta.">
        <form
          className="space-y-4"
          action={(formData) => {
            setErro(null);
            setEstado(null);
            iniciarTransicao(async () => {
              let r: Awaited<ReturnType<typeof iniciar>>;
              try {
                r = await iniciar(formData);
              } catch (e) {
                setErro("Não consegui falar com o servidor. Detalhe: " + (e instanceof Error ? e.message : String(e)));
                return;
              }
              if (r.erro || !r.estado) {
                setErro(r.erro ?? "Não consegui registrar a pergunta.");
                return;
              }
              setEstado(r.estado);
              window.history.replaceState(null, "", `/auditoria/investigar?id=${r.estado.id}`);
              conduzir(r.estado.id);
            });
          }}
        >
          <div>
            <label className={labelClass} htmlFor="pergunta">
              O que você quer saber? *
            </label>
            <textarea
              id="pergunta"
              name="pergunta"
              required
              value={pergunta}
              onChange={(e) => setPergunta(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder={EXEMPLOS[0]}
              className={inputClass}
            />
            <div className="mt-2 flex flex-wrap gap-1">
              {EXEMPLOS.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setPergunta(ex)}
                  className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-left text-xs text-slate-600 hover:border-blue-300"
                >
                  {ex.length > 70 ? `${ex.slice(0, 70)}…` : ex}
                </button>
              ))}
            </div>
          </div>

          {conexoes.length > 1 && (
            <div className="max-w-sm">
              <label className={labelClass} htmlFor="empresa">
                Empresa
              </label>
              <select id="empresa" name="empresa" defaultValue="" className={inputClass}>
                <option value="">Grupo (as duas empresas)</option>
                {conexoes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.apelido} — {c.nome}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={processando || pergunta.trim().length < 8} className={primaryButtonClass}>
              {processando ? "Investigando..." : "Investigar"}
            </button>
            <span className="text-xs text-slate-500">Cada pergunta é uma chamada paga à IA.</span>
          </div>
        </form>

        {estado && estado.status === "EXECUTANDO" && !processando && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <span>Esta investigação ficou no meio — {estado.consultas.length} consulta(s) feitas.</span>
            <button type="button" onClick={() => conduzir(estado.id)} className="text-sm font-semibold text-amber-900 underline">
              Retomar
            </button>
          </div>
        )}
      </Secao>

      {erro && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p>}

      {processando && estado && (
        <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900">
          {estado.consultas.length === 0
            ? "Lendo a pergunta e decidindo por onde começar..."
            : `${estado.consultas.length} consulta(s) feitas — última: ${ultimaConsulta?.ferramenta} (${ultimaConsulta?.resumo}). Continuando...`}
        </p>
      )}

      {estado && estado.status === "ERRO" && estado.erro && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{estado.erro}</p>
      )}

      {estado && estado.status === "CONCLUIDA" && estado.resposta && (
        <Secao
          titulo="Resposta"
          descricao={`${estado.consultas.length} consulta(s) à base · ${estado.empresa} · modelo ${estado.modelo ?? "—"}`}
        >
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{estado.resposta}</div>
        </Secao>
      )}

      {estado && estado.consultas.length > 0 && (
        <Secao
          titulo="O que a IA consultou"
          descricao="Na ordem em que consultou. O que não está aqui, ela não viu — e a resposta não pode se apoiar nisso."
        >
          <ol className="space-y-2 text-xs">
            {estado.consultas.map((c, i) =>
              c.ferramenta === "propor_tratativa" && typeof c.entrada.achadoId === "string" && typeof c.entrada.status === "string" ? (
                <li key={i} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <span className="font-semibold text-amber-900">Proposta de tratativa</span>
                  <div className="mt-1 text-slate-700">{c.resumo}</div>
                  <div className="mt-1 text-slate-600">
                    <span className="font-medium">{ROTULO_STATUS[c.entrada.status] ?? c.entrada.status}</span>
                    {typeof c.entrada.responsavel === "string" && c.entrada.responsavel && <span> · responsável: {c.entrada.responsavel}</span>}
                    {typeof c.entrada.justificativa === "string" && <div className="mt-1 italic">“{c.entrada.justificativa}”</div>}
                  </div>
                  {podeTratar ? (
                    <PropostaForm
                      achadoId={c.entrada.achadoId}
                      status={c.entrada.status}
                      justificativa={typeof c.entrada.justificativa === "string" ? c.entrada.justificativa : ""}
                      responsavel={typeof c.entrada.responsavel === "string" ? c.entrada.responsavel : ""}
                    />
                  ) : (
                    <p className="mt-2 text-amber-800">Quem tem a permissão de tratar achado aplica esta proposta pela tela de auditoria.</p>
                  )}
                </li>
              ) : (
                <li key={i} className="rounded-lg border border-slate-200 px-3 py-2">
                  <span className="font-mono font-semibold text-slate-700">{c.ferramenta}</span>
                  <span className="ml-2 font-mono text-slate-500">{JSON.stringify(c.entrada)}</span>
                  <div className="mt-1 text-slate-600">{c.resumo}</div>
                </li>
              )
            )}
          </ol>
        </Secao>
      )}
    </div>
  );
}
