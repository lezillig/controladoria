"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { simular } from "@/lib/simulador/motor";
import { montarPainel } from "@/lib/simulador/decisao";
import { lerInicio } from "@/lib/simulador/reforma";
import type { IndicadorReal } from "@/lib/simulador/aplicarReais";
import type { MapaOrigem } from "@/lib/simulador/premissas";
import { lerCaminho } from "@/lib/simulador/premissas";
import type { DaBase } from "@/lib/simulador/voltarABase";
import { ROTULO_UNIDADE, type EntradaSimulacao, type FonteEnergia, type ResultadoSimulacao } from "@/lib/simulador/tipos";
import { salvarVersao } from "../actions";
import type { PracaPedagio } from "@/lib/simulador/pedagio";
import { botao, botaoPrimario, brl, pct, selecao } from "./comum";
import Operacao from "./abas/Operacao";
import Premissas from "./abas/Premissas";
import Veiculos from "./abas/Veiculos";
import Proposta from "./abas/Proposta";
import Reforma from "./abas/Reforma";
import { Cenarios, Custos, Decisao, SeloVeredicto } from "./abas/Resultado";

// O EDITOR DE UM ESTUDO.
//
// Tudo o que se edita aqui é a ENTRADA do motor; o resultado é recalculado no
// navegador a cada mudança, com a mesma função pura que o servidor usa ao
// salvar (simular). Por isso o resumo do topo é sempre a conta de verdade — não
// uma prévia — e salvar só congela o que já está na tela.
//
// As abas seguem a ordem em que um orçamento se constrói: o que se opera
// (itens e rotas), com que veículos, a que custos (premissas), e só então o
// que isso dá (custos, cenários, decisão, proposta). Cada aba mostra no rótulo
// quanto falta ou o que chama atenção, para ninguém precisar abrir todas para
// saber onde está.

type Aba = "operacao" | "veiculos" | "premissas" | "custos" | "cenarios" | "reforma" | "decisao" | "proposta" | "acompanhamento";

export type EstudoTela = {
  id: string;
  nome: string;
  subtitulo: string;
  status: string;
  statusRotulo: string;
  // Início previsto da operação ("2027-01"), para a aba Reforma.
  inicioPrevisto: string | null;
};

const LIMITE_DESFAZER = 60;

export default function EditorEstudo({
  estudo,
  entradaInicial,
  origemInicial,
  daBase,
  versaoBase,
  versaoAntiga,
  baseEm,
  podeEditar,
  margemMinima,
  margemAlvo,
  indicadores,
  lacunas,
  acompanhamento,
  avisoInicial,
  podeConsultarEspecialista,
  precosEnergia,
  pracas,
  pendente = false,
}: {
  estudo: EstudoTela;
  entradaInicial: EntradaSimulacao;
  origemInicial: MapaOrigem;
  // O que um estudo novo teria hoje, para o "Voltar à base".
  daBase: DaBase | null;
  versaoBase: number | null;
  versaoAntiga: boolean;
  baseEm: string | null;
  podeEditar: boolean;
  margemMinima: number | null;
  margemAlvo: number | null;
  indicadores: IndicadorReal[];
  lacunas: string[];
  acompanhamento: ReactNode;
  avisoInicial: string | null;
  podeConsultarEspecialista: boolean;
  precosEnergia: Record<FonteEnergia, number>;
  pracas: PracaPedagio[];
  // Os dados do estudo mudaram depois da versão salva (ver entradaInicial).
  pendente?: boolean;
}) {
  const router = useRouter();
  const [entrada, setEntrada] = useState(entradaInicial);
  const [origem, setOrigem] = useState(origemInicial);
  const [sujo, setSujo] = useState(pendente);
  const [aba, setAba] = useState<Aba>("operacao");
  const [statusVersao, setStatusVersao] = useState("RASCUNHO");
  const [observacoes, setObservacoes] = useState("");
  const [mensagem, setMensagem] = useState<{ erro?: string; ok?: string } | null>(avisoInicial ? { ok: avisoInicial } : null);
  const [salvando, iniciarSalvar] = useTransition();
  const [exportando, setExportando] = useState(false);
  const pilha = useRef<{ entrada: EntradaSimulacao; origem: MapaOrigem }[]>([]);
  const [podeDesfazer, setPodeDesfazer] = useState(false);

  // Alterar = clonar, aplicar a mudança, marcar as premissas tocadas como
  // AJUSTE (com o valor anterior no detalhe) e empilhar para o desfazer.
  const alterar = useCallback(
    (mudar: (e: EntradaSimulacao) => void, premissasAjustadas: string[] = [], novaOrigem?: MapaOrigem) => {
      const nova = structuredClone(entrada);
      mudar(nova);
      pilha.current = [...pilha.current.slice(-(LIMITE_DESFAZER - 1)), { entrada, origem }];
      setPodeDesfazer(true);
      setEntrada(nova);
      if (novaOrigem) setOrigem(novaOrigem);
      else if (premissasAjustadas.length > 0) {
        const o = { ...origem };
        for (const c of premissasAjustadas) {
          const antes = lerCaminho(entrada.premissas, c);
          const depois = lerCaminho(nova.premissas, c);
          if (antes === depois) continue;
          const anterior = origem[c];
          o[c] = {
            origem: "AJUSTE",
            fonte: "ajuste no estudo",
            detalhe: `antes: ${String(antes)}${anterior && anterior.origem !== "AJUSTE" ? ` (${anterior.fonte})` : anterior?.detalhe ? ` — ${anterior.detalhe.replace(/^antes: /, "origem ")}` : ""}`,
          };
        }
        setOrigem(o);
      }
      setSujo(true);
      setMensagem(null);
    },
    [entrada, origem]
  );

  const desfazer = () => {
    const anterior = pilha.current.pop();
    if (!anterior) return;
    setEntrada(anterior.entrada);
    setOrigem(anterior.origem);
    setPodeDesfazer(pilha.current.length > 0);
    setSujo(true);
  };

  // Ctrl+Z fora de campo de texto (dentro do campo, o desfazer é o do campo).
  useEffect(() => {
    const tecla = (ev: KeyboardEvent) => {
      const alvo = ev.target as HTMLElement | null;
      if (alvo && /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName)) return;
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z" && !ev.shiftKey) {
        ev.preventDefault();
        desfazer();
      }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  });

  // Sair com alteração não salva pergunta antes.
  useEffect(() => {
    if (!sujo) return;
    const aviso = (ev: BeforeUnloadEvent) => {
      ev.preventDefault();
      ev.returnValue = "";
    };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [sujo]);

  // Links internos (menu, "Todos os estudos") navegam sem recarregar a página,
  // e o `beforeunload` não os vê: com alteração não salva, pergunta antes.
  useEffect(() => {
    if (!sujo) return;
    const clique = (ev: MouseEvent) => {
      if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey) return;
      const a = (ev.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const destino = new URL(a.href, window.location.href);
      if (destino.origin !== window.location.origin || destino.pathname.startsWith("/api/")) return;
      if (destino.pathname === window.location.pathname && destino.search === window.location.search) return;
      if (!window.confirm("Há alterações não salvas neste estudo. Sair e perder as alterações?")) {
        ev.preventDefault();
        ev.stopPropagation();
      }
    };
    document.addEventListener("click", clique, true);
    return () => document.removeEventListener("click", clique, true);
  }, [sujo]);

  const calculo = useMemo((): { resultado: ResultadoSimulacao; erro: null } | { resultado: null; erro: string } => {
    try {
      if (entrada.itens.length === 0) return { resultado: null, erro: "Cadastre ao menos um item na aba Operação." };
      // Sem rota não há km, veículo nem motorista: a conta daria zeros com
      // cara de resultado (e um veredicto). Melhor dizer o que falta.
      if (entrada.rotas.length === 0) return { resultado: null, erro: "Adicione ao menos uma rota na aba Operação: custos, cenários, decisão e orçamento aparecem a partir dela." };
      return { resultado: simular(entrada), erro: null };
    } catch (e) {
      return { resultado: null, erro: e instanceof Error ? e.message : "Não foi possível calcular." };
    }
  }, [entrada]);
  const resultado = calculo.resultado;

  // O painel roda o motor várias vezes (faixa de lance e sensibilidade): fica
  // um passo atrás da digitação para não travar a tela em estudos grandes.
  const entradaAdiada = useDeferredValue(entrada);
  const origemAdiada = useDeferredValue(origem);
  const painel = useMemo(() => {
    try {
      if (entradaAdiada.itens.length === 0 || entradaAdiada.rotas.length === 0) return null;
      const ini = lerInicio(entradaAdiada.reforma?.inicio ?? estudo.inicioPrevisto);
      return montarPainel(entradaAdiada, simular(entradaAdiada), { margemMinima, margemAlvo, origem: origemAdiada, inicioContrato: ini ? new Date(ini.ano, ini.mes - 1, 1) : undefined });
    } catch {
      return null;
    }
  }, [entradaAdiada, origemAdiada, margemMinima, margemAlvo, estudo.inicioPrevisto]);

  const estimadas = Object.values(origem).filter((o) => o.origem === "PADRAO").length;
  const rotasSemVeiculo = entrada.rotas.filter((r) => r.veiculos <= 0).length;
  const semRotas = entrada.itens.filter((i) => !entrada.rotas.some((r) => r.item === i.codigo)).length;

  const abas: { id: Aba; rotulo: string; selo?: ReactNode }[] = [
    { id: "operacao", rotulo: "1. Operação", selo: semRotas + rotasSemVeiculo > 0 ? <Selo cor="amber">{semRotas + rotasSemVeiculo === 1 ? "1 pendência" : `${semRotas + rotasSemVeiculo} pendências`}</Selo> : <Selo cor="slate">{entrada.rotas.length === 1 ? "1 rota" : `${entrada.rotas.length} rotas`}</Selo> },
    { id: "veiculos", rotulo: "2. Veículos", selo: <Selo cor="slate">{(entrada.premissas.perfis ?? []).length === 1 ? "1 tipo" : `${(entrada.premissas.perfis ?? []).length} tipos`}</Selo> },
    { id: "premissas", rotulo: "3. Premissas", selo: estimadas > 0 ? <Selo cor="amber">{estimadas} estimadas</Selo> : undefined },
    { id: "custos", rotulo: "4. Custos" },
    { id: "cenarios", rotulo: "5. Cenários" },
    { id: "reforma", rotulo: "6. Reforma" },
    { id: "decisao", rotulo: "7. Decisão", selo: painel ? <SeloVeredicto veredicto={painel.veredicto} /> : undefined },
    { id: "proposta", rotulo: "8. Orçamento" },
    { id: "acompanhamento", rotulo: "9. Versões" },
  ];

  const salvar = () =>
    iniciarSalvar(async () => {
      const r = await salvarVersao(estudo.id, entrada, origem, statusVersao, observacoes.trim() || null, baseEm);
      if (r.erro) setMensagem({ erro: r.erro });
      else {
        setMensagem({ ok: r.mensagem ?? "Versão salva." });
        setSujo(false);
        setObservacoes("");
        pilha.current = [];
        setPodeDesfazer(false);
        // A página recarrega com a versão nova como base (o editor remonta);
        // o aviso vai pela URL para sobreviver à remontagem.
        router.replace(`/simulador/${estudo.id}?salva=${r.versao ?? ""}`);
        router.refresh();
      }
    });

  const nomeArquivo = `Orcamento_${estudo.nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "_").slice(0, 50)}`;

  const exportarExcel = async () => {
    setExportando(true);
    setMensagem(null);
    try {
      const r = await fetch(`/api/simulador/${estudo.id}/xlsx`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entrada }) });
      if (!r.ok) {
        const corpo = await r.json().catch(() => null);
        setMensagem({ erro: corpo?.erro ?? "Não foi possível gerar a planilha." });
        return;
      }
      const nome = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") ?? "")?.[1] ?? `${nomeArquivo}.xlsx`;
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = nome;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setExportando(false);
    }
  };

  // No lote, o que vale é o preço único da proposta (arredondado): faturamento,
  // lucro e margem são os desse preço, como na versão salva.
  const margem = resultado ? (resultado.lote ? resultado.lote.margemAoPrecoProposta : resultado.totais.margem) : null;
  const faturamento = resultado ? (resultado.lote ? resultado.lote.faturamentoAoPrecoProposta : resultado.totais.faturamento) : null;
  const lucro = resultado ? (resultado.lote ? resultado.lote.lucroAoPrecoProposta : resultado.totais.lucro) : null;
  const precoPrincipal = resultado
    ? resultado.lote
      ? resultado.lote.precoPropostaUnidade
      : (() => {
          const q = resultado.itens.reduce((a, i) => a + i.quantidadeUnidade, 0);
          return q > 0 ? resultado.itens.reduce((a, i) => a + i.precoUnidade * i.quantidadeUnidade, 0) / q : null;
        })()
    : null;
  const mensal = entrada.premissas.contrato.modo === "MENSAL";

  return (
    <div className="space-y-4">
      {/* Resumo fixo: a conta inteira e as etapas, sempre à vista. No
          celular, só preço, margem e veredicto — o resto cabe nas abas. */}
      <div className="sticky top-0 z-20 -mx-4 -mt-4 border-b border-slate-200 bg-white/95 px-4 pt-3 backdrop-blur sm:-mx-6 sm:-mt-6 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0">
            <h1 className="line-clamp-2 text-base font-semibold text-slate-900 sm:truncate sm:text-lg">{estudo.nome}</h1>
            <p className="hidden truncate text-xs text-slate-500 sm:block">
              {estudo.subtitulo} · {estudo.statusRotulo}
              {versaoBase ? ` · a partir da v${versaoBase}` : " · nova simulação"}
              {podeEditar && (
                <>
                  {" · "}
                  <a href={`/simulador/${estudo.id}/editar`} className="font-medium text-blue-700 hover:underline">
                    Editar dados do estudo
                  </a>
                </>
              )}
            </p>
            {sujo && <span className="mt-0.5 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">alterações não salvas</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={botao} disabled={!podeDesfazer} onClick={desfazer} title="Desfazer (Ctrl+Z)">
              Desfazer
            </button>
            <button type="button" className={botao} disabled={exportando || !resultado} onClick={exportarExcel} title={resultado ? "Baixar o estudo em Excel, com a conta em fórmulas (inclui o que ainda não foi salvo)" : "Adicione ao menos uma rota para exportar"}>
              {exportando ? "Gerando…" : "Exportar Excel"}
            </button>
            {podeEditar && (
              <>
                <select className={`${selecao} hidden sm:block`} aria-label="Situação da versão" value={statusVersao} onChange={(e) => setStatusVersao(e.target.value)} title="Como a versão fica marcada">
                  <option value="RASCUNHO">Rascunho</option>
                  <option value="APROVADA">Aprovada</option>
                  <option value="LANCADA">Lançada</option>
                </select>
                <input
                  className="hidden w-44 rounded-md border border-slate-300 px-2 py-1 text-[13px] lg:block"
                  aria-label="Observação da versão"
                  placeholder="Observação da versão"
                  value={observacoes}
                  maxLength={1000}
                  onChange={(e) => setObservacoes(e.target.value)}
                />
                <button type="button" className={resultado ? botaoPrimario : botao} disabled={salvando || !resultado} onClick={salvar} title={resultado ? undefined : "Adicione rotas para salvar"}>
                  {salvando ? "Salvando…" : "Salvar versão"}
                </button>
              </>
            )}
          </div>
        </div>
        <dl className="mt-2 grid grid-cols-3 gap-x-4 gap-y-1 text-sm sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-6">
          <Numero rotulo={`Preço (${ROTULO_UNIDADE[entrada.unidadePreco ?? "KM"]})`} valor={brl(precoPrincipal, entrada.unidadePreco === "KM" || !entrada.unidadePreco ? 4 : 2)} destaque />
          <Numero className="hidden sm:block" rotulo={`Faturamento (${mensal ? "mês" : "período"})`} valor={brl(faturamento, 0)} />
          <Numero className="hidden sm:block" rotulo="Custo total" valor={brl(resultado?.totais.custoTotal ?? null, 0)} />
          <Numero className="hidden sm:block" rotulo="Lucro líquido" valor={brl(lucro, 0)} negativo={(lucro ?? 0) < 0} />
          <Numero rotulo="Margem" valor={pct(margem)} negativo={(margem ?? 0) < 0} />
          <div className="min-w-0">
            <dt className="truncate text-[11px] uppercase tracking-wide text-slate-500">Veredicto</dt>
            <dd className="mt-0.5">{painel ? <SeloVeredicto veredicto={painel.veredicto} /> : <span className="text-slate-500">—</span>}</dd>
          </div>
        </dl>
        {mensagem && <p className={`mt-2 text-sm ${mensagem.erro ? "text-red-700" : "text-emerald-700"}`}>{mensagem.erro ?? mensagem.ok}</p>}
        <nav className="-mx-1 mt-2 flex gap-1 overflow-x-auto pb-2 [mask-image:linear-gradient(to_right,black_92%,transparent)] sm:[mask-image:none] lg:flex-wrap" aria-label="Etapas do orçamento">
          {abas.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setAba(a.id)}
              className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium ${aba === a.id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
              aria-current={aba === a.id ? "page" : undefined}
            >
              {a.rotulo}
              {a.selo}
            </button>
          ))}
        </nav>
      </div>

      {versaoAntiga && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-900">
          Você está vendo a v{versaoBase} exatamente como foi salva. Salvar cria uma versão nova a partir dela; a v{versaoBase} continua guardada.
        </div>
      )}
      {!podeEditar && <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-600">Modo leitura: você pode simular à vontade, mas não salvar versões.</div>}

      {calculo.erro && aba !== "operacao" && aba !== "premissas" && aba !== "veiculos" && aba !== "acompanhamento" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {calculo.erro}{" "}
          <button type="button" className="font-medium text-blue-700 underline" onClick={() => setAba("operacao")}>
            Ir para a Operação
          </button>
        </div>
      )}

      {aba === "operacao" && <Operacao entrada={entrada} alterar={alterar} podeEditar pracas={pracas} />}
      {aba === "veiculos" && <Veiculos entrada={entrada} alterar={alterar} podeEditar precosEnergia={precosEnergia} pracas={pracas} anoInicio={lerInicio(entrada.reforma?.inicio ?? estudo.inicioPrevisto)?.ano ?? new Date().getFullYear()} />}
      {aba === "premissas" && <Premissas entrada={entrada} origem={origem} alterar={alterar} podeEditar daBase={daBase} indicadores={indicadores} lacunas={lacunas} />}
      {aba === "custos" && resultado && <Custos resultado={resultado} entrada={entrada} />}
      {aba === "cenarios" && resultado && <Cenarios resultado={resultado} entrada={entrada} alterar={alterar} />}
      {aba === "reforma" && resultado && <Reforma entrada={entrada} resultado={resultado} alterar={alterar} inicioPrevisto={estudo.inicioPrevisto} />}
      {aba === "decisao" && (painel ? <Decisao painel={painel} /> : !calculo.erro && <p className="text-sm text-slate-500">Calculando…</p>)}
      {aba === "decisao" && podeConsultarEspecialista && <PerguntarAoEspecialista nome={estudo.nome} versao={versaoBase} sujo={sujo} />}
      {aba === "proposta" && resultado && <Proposta entrada={entrada} resultado={resultado} nomeArquivo={nomeArquivo} aoExportarExcel={exportarExcel} exportando={exportando} inicioPrevisto={estudo.inicioPrevisto} />}
      <div hidden={aba !== "acompanhamento"}>{acompanhamento}</div>

      {/* Próxima etapa: o orçamento se lê de cima para baixo e da esquerda
          para a direita; no fim de cada aba, o caminho continua. */}
      {(() => {
        const k = abas.findIndex((a) => a.id === aba);
        const proxima = abas[k + 1];
        if (!proxima) return null;
        return (
          <div className="flex justify-end">
            <button
              type="button"
              className={botao}
              onClick={() => {
                setAba(proxima.id);
                window.scrollTo({ top: 0 });
                document.querySelector("main")?.scrollTo({ top: 0 });
              }}
            >
              Próxima etapa: {proxima.rotulo.replace(/^\d+\. /, "")} →
            </button>
          </div>
        );
      })()}
    </div>
  );
}

function Numero({ rotulo, valor, destaque, negativo, className = "" }: { rotulo: string; valor: string; destaque?: boolean; negativo?: boolean; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <dt className="truncate text-[11px] uppercase tracking-wide text-slate-500">{rotulo}</dt>
      <dd className={`mt-0.5 truncate font-mono tabular-nums ${destaque ? "text-base font-semibold text-blue-800" : "text-slate-900"} ${negativo ? "text-red-700" : ""}`}>{valor}</dd>
    </div>
  );
}

function Selo({ cor, children }: { cor: "amber" | "slate"; children: ReactNode }) {
  return <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${cor === "amber" ? "bg-amber-100 text-amber-800" : "bg-slate-200/70 text-slate-600"}`}>{children}</span>;
}

// O ESPECIALISTA DE PRECIFICAÇÃO lê as versões SALVAS do estudo (é o que ele
// consegue abrir pelo servidor); com alteração não salva, a tela avisa.
function PerguntarAoEspecialista({ nome, versao, sujo }: { nome: string; versao: number | null; sujo: boolean }) {
  const alvo = `o estudo "${nome}"${versao ? ` (versão ${versao})` : ""}`;
  const perguntas = [
    { rotulo: "Posso lançar?", texto: `Leia ${alvo} e diga se vale lançar: veredicto, margem, faixa de lance, as premissas que mais mexem no resultado (medidas ou estimadas?) e o que conferir antes de enviar a proposta.` },
    { rotulo: "Escada de lances", texto: `Para ${alvo}, monte a escada de lances: preço de abertura, os degraus até a margem mínima e o piso de lucro zero, com a margem de cada degrau, simulando cada um pelo motor.` },
    { rotulo: "Premissas × custo real", texto: `Compare as premissas de ${alvo} com os custos reais medidos da empresa: onde a simulação está otimista ou pessimista, quanto isso muda o preço (simule) e quais premissas trocar pelo número real.` },
  ];
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-sm font-semibold text-slate-900">Pedir parecer ao especialista de precificação (IA)</p>
      <p className="mt-0.5 text-xs text-slate-500">
        Ele lê o estudo pelo mesmo motor, testa variações sem gravar nada e compara com o custo real e com as disputas passadas.
        {sujo && <span className="font-medium text-amber-700"> Salve a versão antes: o especialista só enxerga o que está salvo.</span>}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {perguntas.map((p) => (
          <a key={p.rotulo} className={botao} href={`/auditoria/investigar?especialista=precificacao&pergunta=${encodeURIComponent(p.texto)}`}>
            {p.rotulo}
          </a>
        ))}
      </div>
    </div>
  );
}
