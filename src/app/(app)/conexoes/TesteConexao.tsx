"use client";

import { useState, useTransition } from "react";
import { secondaryButtonClass } from "@/lib/ui";
import type { ResultadoDiagnostico, ResultadoEndpoint } from "@/lib/omie/diagnostico";
import { testarConexao } from "./actions";

// Resultado do teste de integração, renderizado abaixo da conexão.
//
// A tela mostra três coisas por endpoint, e as três importam por motivos
// diferentes:
//
//   ESTADO — separa "não conectou" de "conectou e não há registro no período".
//   Confundir os dois é o erro mais comum ao ligar uma integração com a Omie,
//   porque a API responde HTTP 500 nos dois casos.
//
//   CAMPOS QUE O MAPEAMENTO NÃO PREENCHEU — é aqui que aparece um nome de
//   campo divergente. Campo vazio não quebra o sync: ele grava nulo em
//   silêncio, e o problema só aparece semanas depois como uma coluna vazia no
//   relatório.
//
//   CAMPOS CRUS — o que a conta de fato devolveu. É a informação que permite
//   corrigir o mapeamento sem precisar de acesso à conta Omie.

const CORES: Record<ResultadoEndpoint["estado"], string> = {
  OK: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  VAZIO: "bg-slate-100 text-slate-600 ring-slate-200",
  ERRO: "bg-red-50 text-red-700 ring-red-200",
  PULADO: "bg-amber-50 text-amber-800 ring-amber-200",
};

const ROTULOS: Record<ResultadoEndpoint["estado"], string> = {
  OK: "respondeu com dados",
  VAZIO: "sem registro no período",
  ERRO: "erro",
  PULADO: "não testado",
};

// Registro que o normalizador recusou por inteiro. É uma falha de outra ordem
// que campo vazio: campo vazio grava a linha sem uma coluna, registro
// descartado não grava linha nenhuma — o endpoint aparece "com dados" e a
// tabela termina vazia.
const descartado = (e: ResultadoEndpoint) => e.camposVazios.includes("registro descartado pelo mapeamento");

// Diagnóstico inteiro em texto puro, INCLUINDO os nomes crus de campo.
//
// Existe porque a informação que resolve o problema — a lista de campos que a
// conta devolveu — mora dentro de um <details>, e conteúdo de <details>
// fechado não vai junto quando se copia a página. Na prática isso significava
// que o relatório chegava até quem pode corrigir o mapeamento sempre sem a
// única parte que permite corrigi-lo.
//
// Sem credencial e sem valor de registro: só nomes de campo, contagens e
// estado. É seguro colar em qualquer lugar.
function relatorioEmTexto(r: ResultadoDiagnostico): string {
  const linhas: string[] = [
    `DIAGNÓSTICO OMIE — ${r.conexao.apelido} (${r.conexao.nome})`,
    `${r.ok} com dados · ${r.vazios} sem registro · ${r.erros} com erro`,
    "",
  ];

  for (const p of r.problemasDeCredencial) linhas.push(`[CREDENCIAL] ${p.variavel} ${p.problema}`);
  if (r.problemasDeCredencial.length > 0) linhas.push("");

  for (const e of r.endpoints) {
    linhas.push(`## ${e.rotulo} — ${e.call} — ${ROTULOS[e.estado]}`);
    if (e.estado === "OK") {
      linhas.push(`   ${e.registros} de amostra, ${e.totalNaConta} no período, lista em "${e.listaEncontradaEm}"`);
      if (e.filtroAceito) linhas.push(`   filtro aceito: ${e.filtroAceito}`);
    }
    if (e.erro) linhas.push(`   ERRO: ${e.erro}`);
    if (e.camposVazios.length > 0) linhas.push(`   NÃO PREENCHIDOS: ${e.camposVazios.join(", ")}`);
    if (e.camposRecebidos.length > 0) {
      linhas.push(`   CAMPOS CRUS (${e.camposRecebidos.length}): ${e.camposRecebidos.join(" · ")}`);
    }
    linhas.push("");
  }

  return linhas.join("\n");
}

export default function TesteConexao({ conexaoId }: { conexaoId: string }) {
  const [resultado, setResultado] = useState<ResultadoDiagnostico | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [processando, iniciar] = useTransition();

  return (
    <div>
      <form
        action={(formData) => {
          setErro(null);
          setResultado(null);
          iniciar(async () => {
            const r = await testarConexao(formData);
            if (r.erro) setErro(r.erro);
            if (r.diagnostico) setResultado(r.diagnostico);
          });
        }}
      >
        <input type="hidden" name="id" value={conexaoId} />
        <button type="submit" disabled={processando} className={`${secondaryButtonClass} text-xs`}>
          {processando ? "Consultando a Omie..." : "Testar integração"}
        </button>
      </form>

      {erro && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{erro}</p>}

      {resultado && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <p className="text-sm font-semibold text-slate-900">
              {resultado.conexao.apelido} · {resultado.ok} com dados, {resultado.vazios} sem registro,{" "}
              <span className={resultado.erros > 0 ? "text-red-700" : undefined}>{resultado.erros} com erro</span>
            </p>
            <p className="text-xs text-slate-400">
              nada foi gravado — consulta de amostra dos últimos 90 dias
            </p>
          </div>

          {resultado.problemasDeCredencial.length > 0 && (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5">
              <p className="text-xs font-semibold text-amber-900">
                Olhe isto antes dos endpoints: a credencial deste ambiente não tem o formato que a Omie usa.
              </p>
              <ul className="mt-1.5 space-y-1">
                {resultado.problemasDeCredencial.map((p) => (
                  <li key={`${p.variavel}-${p.problema}`} className="text-xs leading-relaxed text-amber-900">
                    <span className="font-mono font-medium">{p.variavel}</span> {p.problema}
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-xs leading-relaxed text-amber-800">
                Corrija na hospedagem e faça um novo deploy — variável alterada só passa a valer no deploy seguinte. A
                checagem é local e não expõe o valor: olha apenas quantidade e tipo de caractere.
              </p>
            </div>
          )}

          <ul className="mt-3 space-y-3">
            {resultado.endpoints.map((e) => (
              <li key={e.chave} className="border-t border-slate-100 pt-3 first:border-t-0 first:pt-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${CORES[e.estado]}`}>
                    {ROTULOS[e.estado]}
                  </span>
                  <span className="text-sm font-medium text-slate-800">{e.rotulo}</span>
                  <span className="font-mono text-xs text-slate-400">{e.call}</span>
                  {e.estado === "OK" && (
                    <span className="text-xs text-slate-500">
                      {e.registros} de amostra
                      {e.totalNaConta > 0 && ` · ${e.totalNaConta.toLocaleString("pt-BR")} no período`}
                      {e.listaEncontradaEm && ` · lista em "${e.listaEncontradaEm}"`}
                      {e.filtroAceito && ` · filtro aceito: ${e.filtroAceito}`}
                    </span>
                  )}
                  <span className="text-xs text-slate-400">{e.duracaoMs} ms</span>
                </div>

                {e.erro && <p className="mt-1.5 text-xs leading-relaxed text-red-800">{e.erro}</p>}

                {descartado(e) ? (
                  <p className="mt-1.5 text-xs leading-relaxed text-red-800">
                    <strong>Nenhum registro seria importado.</strong> O mapeamento não achou os campos obrigatórios
                    (número, data de emissão e valor) e descartaria a nota inteira — não é coluna vazia, é ausência de
                    linha. Os nomes que a conta devolveu estão abaixo.
                  </p>
                ) : (
                  e.camposVazios.length > 0 && (
                    <p className="mt-1.5 text-xs leading-relaxed text-amber-800">
                      <strong>Não preenchidos pelo mapeamento:</strong> {e.camposVazios.join(", ")}
                    </p>
                  )
                )}

                {e.camposRecebidos.length > 0 && (
                  // Aberto de saída quando o registro foi descartado: nesse caso a
                  // lista crua não é detalhe de apoio, é a única informação que
                  // permite corrigir — esconder atrás de um clique seria esconder
                  // a resposta.
                  <details className="mt-1.5" open={descartado(e)}>
                    <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700">
                      campos que a conta devolveu ({e.camposRecebidos.length})
                    </summary>
                    <p className="mt-1 font-mono text-xs leading-relaxed text-slate-500">
                      {e.camposRecebidos.join(" · ")}
                    </p>
                  </details>
                )}
              </li>
            ))}
          </ul>

          <div className="mt-4 border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={async () => {
                const texto = relatorioEmTexto(resultado);
                try {
                  await navigator.clipboard.writeText(texto);
                  setCopiado(true);
                  setTimeout(() => setCopiado(false), 3000);
                } catch {
                  // Área de transferência bloqueada (contexto inseguro, permissão
                  // negada): o <details> abaixo mostra o mesmo texto para seleção
                  // manual, então não há beco sem saída.
                  setCopiado(false);
                }
              }}
              className={`${secondaryButtonClass} text-xs`}
            >
              {copiado ? "Copiado" : "Copiar diagnóstico completo"}
            </button>
            <span className="ml-2 text-xs text-slate-400">
              inclui os nomes de campo — é o que permite corrigir o mapeamento
            </span>

            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700">
                ou selecione o texto aqui
              </summary>
              <pre className="mt-1 max-h-64 overflow-auto rounded-lg bg-slate-50 p-2 font-mono text-[11px] leading-relaxed text-slate-600">
                {relatorioEmTexto(resultado)}
              </pre>
            </details>
          </div>

          <p className="mt-4 text-xs leading-relaxed text-slate-500">
            <strong>Sem registro no período</strong> é sucesso de integração, não falha: a Omie responde com erro
            quando a consulta não encontra nada, e o sistema já trata isso. O que exige ação é a linha em vermelho — e
            a lista de campos não preenchidos, que é onde aparece um nome de campo diferente do que o mapeamento
            espera.
          </p>
        </div>
      )}
    </div>
  );
}
