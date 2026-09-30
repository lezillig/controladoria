"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ajustarParametroBase, encerrarRegistroBase, salvarRegistroBase, voltarParametroAoPadrao, type Resultado } from "../actions";
import { CampoNumero, botao } from "../[id]/comum";

// A BASE DE CUSTOS, EDITÁVEL.
//
// Cada linha mostra o valor que vale hoje e de onde ele veio (base, com data e
// quem ajustou; ou o padrão do simulador), o valor anterior e para que ele
// serve na conta. Ajustar grava uma vigência nova — o valor de antes fica no
// histórico — e vale para os estudos criados dali em diante.

export type ParametroTela = {
  chave: string;
  entidade: string;
  rotulo: string;
  tipo: "numero" | "pct" | "texto" | "inteiro" | "simnao";
  essencial: boolean;
  unidade: string | null;
  atual: { valor: number | null; texto: string | null; desde: string; fonte: string; autor: string | null } | null;
  anterior: { valor: number | null; texto: string | null; ate: string } | null;
  padrao: number | null;
  // Quando o padrão está noutra unidade que o campo (ARLA: o campo é
  // "R$ 4,20; 4,5%", o padrão já é R$/km).
  unidadePadrao: string | null;
  uso: string | null;
  // O que a regra significa (Regras da Azul Mob), aberto em "o que é?".
  conceito?: string | null;
  // Indireto medido no DRE consolidado: vale enquanto a base não tem valor.
  doDre?: { valor: number; fonte: string; composicao: { descricao: string; valorMes: number }[]; linhas: string[] } | null;
};

export type CampoTela = { campo: string; rotulo: string; tipo: "texto" | "numero" | "pct" | "inteiro" | "simnao" };
export type RegistroTela = { id: string | null; campos: Record<string, string | number | boolean | null>; desde: string | null; fonte: string | null };
export type TipoTabelaTela = "veiculo" | "funcao" | "pedagio";

const ROTULO_ENTIDADE: Record<string, string> = {
  INSUMO: "Insumos (diesel, ARLA, óleo)",
  TRIBUTO: "Tributos",
  FINANCEIRO: "Financeiro (prazo de recebimento, capital de giro)",
  JORNADA: "Jornada e operação",
  INDIRETO: "Custos indiretos (administração central)",
  REGRA_AZUL: "Regras da Azul Mob (margens e limites)",
};
const ORDEM = ["INSUMO", "TRIBUTO", "FINANCEIRO", "JORNADA", "INDIRETO", "REGRA_AZUL"];

const dataBr = (iso: string) => new Date(iso).toLocaleDateString("pt-BR");
const formatarPadrao = (p: ParametroTela) =>
  p.padrao === null ? "" : p.unidadePadrao ? `${p.padrao.toLocaleString("pt-BR", { maximumFractionDigits: 4 })} ${p.unidadePadrao}` : `${formatar(p, p.padrao, null)}${p.tipo !== "pct" && p.unidade ? ` ${p.unidade}` : ""}`;
const formatar = (p: { tipo: ParametroTela["tipo"] }, valor: number | null, texto: string | null) =>
  texto ?? (valor === null ? "—" : p.tipo === "pct" ? `${(valor * 100).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}%` : valor.toLocaleString("pt-BR", { maximumFractionDigits: 4 }));

function useAcao() {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [msg, setMsg] = useState<{ erro?: string; ok?: string } | null>(null);
  const rodar = (f: () => Promise<Resultado>, depois?: () => void) =>
    iniciar(async () => {
      const r = await f();
      setMsg(r.erro ? { erro: r.erro } : { ok: r.mensagem ?? "Salvo." });
      if (!r.erro) {
        depois?.();
        router.refresh();
      }
    });
  return { pendente, rodar, msg };
}

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

// O VALOR QUE VEM DO DRE e do que ele é feito: a linha do DRE e as categorias
// da Omie classificadas nela, com a média mensal de cada uma.
function DoDre({ d }: { d: NonNullable<ParametroTela["doDre"]> }) {
  return (
    <>
      <span className="rounded bg-blue-50 px-1.5 py-0.5 font-medium text-blue-800">DRE consolidado</span> <strong>{reais(d.valor)}/mês</strong>
      <span className="block text-slate-500">
        {d.linhas.join(" + ")} · {d.fonte.replace(/^DRE consolidado — /, "")}
      </span>
      {d.composicao.length > 0 && (
        <details className="mt-0.5">
          <summary className="cursor-pointer text-slate-500 hover:text-slate-700">
            {d.composicao.length} {d.composicao.length === 1 ? "categoria" : "categorias"}
          </summary>
          <ul className="mt-1 space-y-0.5">
            {d.composicao.map((c) => (
              <li key={c.descricao} className="flex justify-between gap-3">
                <span>{c.descricao}</span>
                <span className="tabular-nums">{reais(c.valorMes)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function LinhaParametro({ p, podeEditar }: { p: ParametroTela; podeEditar: boolean }) {
  const valorAtual = p.atual ? (p.tipo === "texto" ? p.atual.texto : p.atual.valor) : null;
  const [rascunho, setRascunhoEstado] = useState<number | string | null>(valorAtual);
  // Grava ao sair do campo (ver LinhaRegistro): o ref tem o valor já
  // confirmado pelo campo numérico no próprio blur.
  const rascunhoRef = useRef<number | string | null>(valorAtual);
  const setRascunho = (v: number | string | null) => {
    rascunhoRef.current = v;
    setRascunhoEstado(v);
  };
  const { pendente, rodar, msg } = useAcao();
  const salvarSeMudou = () => {
    const r = rascunhoRef.current;
    const texto = typeof r === "string" ? r.trim() : r;
    if (!podeEditar || pendente || texto === valorAtual || texto === null || texto === "") return;
    rodar(() => ajustarParametroBase(p.chave, typeof texto === "number" ? texto : null, typeof texto === "string" ? texto : null));
  };
  return (
    <tr className="border-b border-slate-100 align-top">
      <td className="px-2 py-2">
        <span className="font-medium text-slate-800">{p.rotulo}</span>
        {p.essencial && <span className="ml-1 text-amber-600" title="Item essencial do Gabarito">★</span>}
        {p.uso ? <span className="block text-xs text-slate-500">Entra na conta: {p.uso}</span> : <span className="block text-xs text-slate-500">Informativo (não entra na conta)</span>}
        {p.conceito && (
          <details className="mt-0.5 max-w-xl">
            <summary className="cursor-pointer text-xs text-blue-700 hover:text-blue-900">o que é?</summary>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">{p.conceito}</p>
          </details>
        )}
      </td>
      <td
        className="w-56 px-2 py-2"
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) salvarSeMudou();
        }}
      >
        {p.tipo === "texto" ? (
          <input
            className="w-full rounded-md border border-slate-300 px-2 py-1 text-[13px]"
            disabled={!podeEditar}
            aria-label={p.rotulo}
            value={(rascunho as string | null) ?? ""}
            placeholder={p.chave === "arla" ? "ex.: R$ 4,20; 4,5%" : p.chave === "reserva_tecnica" ? "ex.: 10%; 10%; 12%" : p.chave === "contabilidade_fornecedor" ? "padrão: JL Business; Joel" : ""}
            onChange={(e) => setRascunho(e.target.value)}
          />
        ) : (
          <div className="flex items-center gap-1">
            <CampoNumero
              rotulo={p.rotulo}
              valor={(rascunho as number | null) ?? null}
              percentual={p.tipo === "pct"}
              casas={4}
              vazioPermitido
              desativado={!podeEditar}
              aoMudar={(v) => setRascunho(v)}
              placeholder={
                p.doDre
                  ? `DRE ${formatar(p, p.doDre.valor, null)}`
                  : p.padrao !== null && !p.unidadePadrao
                    ? `padrão ${formatar(p, p.padrao, null)}`
                    : undefined
              }
            />
            <span className="w-14 shrink-0 text-[11px] text-slate-500">{p.tipo === "pct" ? "%" : (p.unidade ?? "")}</span>
          </div>
        )}
        {pendente && <p className="mt-1 text-xs text-slate-500">salvando…</p>}
        {msg && <p className={`mt-1 text-xs ${msg.erro ? "text-red-700" : "text-emerald-700"}`}>{msg.erro ?? msg.ok}</p>}
      </td>
      <td className="px-2 py-2 text-xs text-slate-600">
        {p.atual ? (
          <>
            <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-800">base Azul Mob</span> desde {dataBr(p.atual.desde)}
            <span className="block text-slate-500">
              {p.atual.fonte}
              {p.atual.autor ? ` · ${p.atual.autor}` : ""}
            </span>
            {p.doDre ? (
              <span className="block text-slate-500">no DRE consolidado: {reais(p.doDre.valor)}/mês</span>
            ) : (
              p.padrao !== null && <span className="block text-slate-500">padrão do simulador: {formatarPadrao(p)}</span>
            )}
          </>
        ) : p.doDre ? (
          <DoDre d={p.doDre} />
        ) : p.padrao !== null ? (
          <>
            <span className="rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-800">estimativa</span> padrão do simulador: <strong>{formatarPadrao(p)}</strong>
          </>
        ) : p.chave === "contabilidade_fornecedor" ? (
          <span className="text-slate-500">
            padrão: <strong>JL Business; Joel</strong> (contabilidade e jurídico)
          </span>
        ) : (
          <span className="text-slate-500">não preenchido</span>
        )}
        {p.anterior && (
          <span className="block text-slate-500">
            antes: {formatar(p, p.anterior.valor, p.anterior.texto)} (até {dataBr(p.anterior.ate)})
          </span>
        )}
      </td>
      <td className="w-32 px-2 py-2 text-right">
        {podeEditar && p.atual && (
          <button type="button" className={`${botao} px-2 py-1 text-xs`} disabled={pendente} title="Encerra o valor da base; os estudos novos voltam a usar o padrão do simulador" onClick={() => rodar(() => voltarParametroAoPadrao(p.chave))}>
            Voltar ao padrão
          </button>
        )}
      </td>
    </tr>
  );
}

export function ParametrosBase({ parametros, podeEditar }: { parametros: ParametroTela[]; podeEditar: boolean }) {
  const [soDaConta, setSoDaConta] = useState(true);
  const visiveis = parametros.filter((p) => !soDaConta || p.uso || p.atual);
  const grupos = ORDEM.map((e) => [e, visiveis.filter((p) => p.entidade === e)] as const).filter(([, l]) => l.length > 0);
  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={soDaConta} onChange={(e) => setSoDaConta(e.target.checked)} />
        Mostrar só o que entra na conta (e o que já está preenchido)
      </label>
      {grupos.map(([entidade, linhas]) => (
        <section key={entidade} className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">{ROTULO_ENTIDADE[entidade] ?? entidade}</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-2 py-1.5">Custo</th>
                  <th className="px-2 py-1.5">Valor atual</th>
                  <th className="px-2 py-1.5">De onde vem</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {linhas.map((p) => (
                  <LinhaParametro key={`${p.chave}:${p.atual?.desde ?? "padrao"}`} p={p} podeEditar={podeEditar} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

function LinhaRegistro({
  tipo,
  campos,
  registro,
  podeEditar,
  aoDescartar,
}: {
  tipo: TipoTabelaTela;
  campos: CampoTela[];
  registro: RegistroTela;
  podeEditar: boolean;
  aoDescartar?: () => void;
}) {
  const [valores, setValores] = useState(registro.campos);
  // GRAVA SOZINHO AO SAIR DA LINHA, não a cada tecla: cada gravação abre uma
  // vigência nova no histórico. O ref acompanha o que foi digitado de forma
  // síncrona — o campo numérico confirma o valor no próprio blur, antes do
  // blur da linha, e o estado ainda não teria sido atualizado.
  const valoresRef = useRef(registro.campos);
  const { pendente, rodar, msg } = useAcao();
  const mudar = (campo: string, v: string | number | boolean | null) => {
    valoresRef.current = { ...valoresRef.current, [campo]: v };
    setValores(valoresRef.current);
  };
  const salvarSeMudou = () => {
    if (!podeEditar || pendente) return;
    const atuais = valoresRef.current;
    if (JSON.stringify(atuais) === JSON.stringify(registro.campos) && registro.id !== null) return;
    // Linha nova só grava com o campo que a identifica (modelo, função, praça).
    const identificacao = atuais[campos[0]?.campo ?? ""];
    if (registro.id === null && (identificacao === null || identificacao === undefined || String(identificacao).trim() === "")) return;
    rodar(() => salvarRegistroBase(tipo, atuais, registro.id), registro.id === null ? aoDescartar : undefined);
  };
  return (
    <tr
      className={`border-b border-slate-100 align-top ${registro.id === null ? "bg-blue-50/40" : ""}`}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) salvarSeMudou();
      }}
    >
      {campos.map((c, i) => (
        <td key={c.campo} className={`px-1.5 py-1.5 ${i === 0 ? "sticky left-0 z-10 bg-white" : ""}`}>
          {c.tipo === "texto" ? (
            <input
              aria-label={c.rotulo}
              className="w-full min-w-[130px] rounded-md border border-slate-300 px-2 py-1 text-[13px]"
              disabled={!podeEditar}
              value={(valores[c.campo] as string | null) ?? ""}
              onChange={(e) => mudar(c.campo, e.target.value)}
            />
          ) : c.tipo === "simnao" ? (
            <input type="checkbox" aria-label={c.rotulo} disabled={!podeEditar} checked={valores[c.campo] === true} onChange={(e) => mudar(c.campo, e.target.checked)} />
          ) : (
            <div className="min-w-[100px]">
              <CampoNumero
                rotulo={c.rotulo}
                valor={(valores[c.campo] as number | null) ?? null}
                percentual={c.tipo === "pct"}
                casas={c.tipo === "inteiro" ? 0 : 4}
                vazioPermitido
                desativado={!podeEditar}
                aoMudar={(v) => mudar(c.campo, v)}
              />
            </div>
          )}
        </td>
      ))}
      {/* Presa à direita: a situação da linha e o "Retirar" ficam à vista mesmo
          com a tabela rolada. */}
      <td className="sticky right-0 z-10 whitespace-nowrap bg-white px-1.5 py-1.5 text-xs shadow-[-6px_0_6px_-6px_rgba(15,23,42,0.15)]">
        {podeEditar && (
          <div className="flex items-center gap-1">
            {pendente && <span className="text-slate-500">salvando…</span>}
            {registro.id === null ? (
              <button type="button" className={`${botao} px-2 py-1 text-xs`} onClick={aoDescartar}>
                Descartar
              </button>
            ) : (
              <button type="button" className={`${botao} px-2 py-1 text-xs`} disabled={pendente} title="Tira da base (fica no histórico)" aria-label="Retirar da base" onClick={() => rodar(() => encerrarRegistroBase(tipo, registro.id!))}>
                Retirar
              </button>
            )}
          </div>
        )}
        {registro.desde && <span className="mt-1 block text-slate-500">desde {dataBr(registro.desde)}</span>}
        {msg && <span className={`mt-1 block ${msg.erro ? "text-red-700" : "text-emerald-700"}`}>{msg.erro ?? msg.ok}</span>}
      </td>
    </tr>
  );
}

export function TabelaRegistrosBase({
  tipo,
  campos,
  registros,
  sugestoes,
  podeEditar,
  vazio,
}: {
  tipo: TipoTabelaTela;
  campos: CampoTela[];
  registros: RegistroTela[];
  // Linhas prontas para trazer à base (os padrões do simulador), quando a
  // tabela está vazia.
  sugestoes?: { rotulo: string; campos: RegistroTela["campos"] }[];
  podeEditar: boolean;
  vazio: string;
}) {
  const [novos, setNovos] = useState<{ chave: number; campos: RegistroTela["campos"] }[]>([]);
  const [seq, setSeq] = useState(0);
  const incluir = (c: RegistroTela["campos"]) => {
    setNovos((a) => [...a, { chave: seq, campos: c }]);
    setSeq((n) => n + 1);
  };
  return (
    <div className="space-y-2">
      {registros.length === 0 && novos.length === 0 && <p className="text-sm text-slate-500">{vazio}</p>}
      {(registros.length > 0 || novos.length > 0) && (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                {campos.map((c, i) => (
                  <th key={c.campo} className={`whitespace-nowrap px-1.5 py-1.5 ${i === 0 ? "sticky left-0 z-10 bg-slate-50" : ""}`}>
                    {c.rotulo}
                  </th>
                ))}
                <th className="px-1.5 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {registros.map((r) => (
                <LinhaRegistro key={`${r.id}:${r.desde}`} tipo={tipo} campos={campos} registro={r} podeEditar={podeEditar} />
              ))}
              {novos.map((n) => (
                <LinhaRegistro
                  key={`novo-${n.chave}`}
                  tipo={tipo}
                  campos={campos}
                  registro={{ id: null, campos: n.campos, desde: null, fonte: null }}
                  podeEditar={podeEditar}
                  aoDescartar={() => setNovos((a) => a.filter((x) => x.chave !== n.chave))}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {podeEditar && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={botao} onClick={() => incluir({})}>
            Adicionar linha
          </button>
          {sugestoes && sugestoes.length > 0 && (
            <>
              <span className="text-xs text-slate-500">ou trazer o padrão do simulador para ajustar:</span>
              {sugestoes.map((s) => (
                <button key={s.rotulo} type="button" className={`${botao} px-2 py-1 text-xs`} onClick={() => incluir(s.campos)}>
                  {s.rotulo}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
