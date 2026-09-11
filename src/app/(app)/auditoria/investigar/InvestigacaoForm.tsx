"use client";

import { useState, useTransition } from "react";
import { inputClass, labelClass, primaryButtonClass } from "@/lib/ui";
import type { ResultadoInvestigacao } from "@/lib/controladoria/investigador";
import { Secao } from "../../_componentes";
import { perguntarAoInvestigador } from "./actions";

const EXEMPLOS = [
  "O que está acontecendo com os títulos vencidos da Cajamar? Quanto é, desde quando, e há tratativa registrada?",
  "Quais fornecedores novos apareceram nos últimos três meses com valor acima do que costumamos pagar?",
  "A OS 14516 teve custo lançado e foi faturada? Se não foi, desde quando o custo está parado?",
  "Os achados de juros deste mês se concentram em algum fornecedor ou em alguma data de pagamento?",
];

export default function InvestigacaoForm({ conexoes }: { conexoes: { id: string; apelido: string; nome: string }[] }) {
  const [resultado, setResultado] = useState<ResultadoInvestigacao | null>(null);
  // Controlado pelo mesmo motivo da conferência de CT-e: o React limpa o
  // formulário depois da action, e a pessoa quer refinar a pergunta, não
  // digitá-la de novo.
  const [pergunta, setPergunta] = useState("");
  const [processando, iniciar] = useTransition();

  return (
    <div className="space-y-6">
      <Secao titulo="Pergunta" descricao="Quanto mais específica (nome, número, OS, mês), mais direta a resposta e menos consultas ela gasta.">
        <form
          className="space-y-4"
          action={(formData) => {
            setResultado(null);
            iniciar(async () => {
              try {
                setResultado(await perguntarAoInvestigador(formData));
              } catch (e) {
                setResultado({
                  ok: false,
                  erro:
                    "Não consegui falar com o servidor. Se a pergunta exigir muitas consultas, o tempo limite da hospedagem pode ter cortado a resposta — tente algo mais específico. Detalhe: " +
                    (e instanceof Error ? e.message : String(e)),
                  consultas: [],
                });
              }
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
              {processando ? "Investigando... pode levar um ou dois minutos" : "Investigar"}
            </button>
            <span className="text-xs text-slate-500">Cada pergunta é uma chamada paga à IA.</span>
          </div>
        </form>
      </Secao>

      {resultado && !resultado.ok && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{resultado.erro}</p>
      )}

      {resultado && resultado.ok && (
        <Secao titulo="Resposta" descricao={`${resultado.iteracoes} consulta(s) à base · modelo ${resultado.modelo}`}>
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{resultado.resposta}</div>
        </Secao>
      )}

      {resultado && resultado.consultas.length > 0 && (
        <Secao
          titulo="O que a IA consultou"
          descricao="Na ordem em que consultou. O que não está aqui, ela não viu — e a resposta não pode se apoiar nisso."
        >
          <ol className="space-y-2 text-xs">
            {resultado.consultas.map((c, i) => (
              <li key={i} className="rounded-lg border border-slate-200 px-3 py-2">
                <span className="font-mono font-semibold text-slate-700">{c.ferramenta}</span>
                <span className="ml-2 font-mono text-slate-500">{JSON.stringify(c.entrada)}</span>
                <div className="mt-1 text-slate-600">{c.resumo}</div>
              </li>
            ))}
          </ol>
        </Secao>
      )}
    </div>
  );
}
