"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { desligarOrigem, excluirQuadro, importarQuadro, ligarOrigem, salvarCentro } from "./actions";

// OS AJUSTES DA TELA — pequenos, cada um salva sozinho e a tela se recalcula.

const campo = "rounded-md border border-slate-300 bg-white px-2 py-1 text-[13px]";
const botao = "rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[13px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";

function useAcao() {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [msg, setMsg] = useState<{ erro?: string; ok?: string } | null>(null);
  const rodar = (f: () => Promise<{ erro?: string; ok?: string }>) =>
    iniciar(async () => {
      setMsg(null);
      try {
        const r = await f();
        setMsg(r);
        if (!r.erro) router.refresh();
      } catch {
        setMsg({ erro: "Falhou. Tente de novo." });
      }
    });
  return { pendente, msg, rodar };
}

const Mensagem = ({ msg }: { msg: { erro?: string; ok?: string } | null }) =>
  msg?.erro ? <span className="text-xs text-red-700">{msg.erro}</span> : msg?.ok ? <span className="text-xs text-emerald-700">{msg.ok}</span> : null;

export function ImportarQuadro({ conexoes, competencia }: { conexoes: { id: string; apelido: string }[]; competencia: string }) {
  const { pendente, msg, rodar } = useAcao();
  const entrada = useRef<HTMLInputElement>(null);
  const [mes, setMes] = useState(competencia);
  const [conexaoId, setConexaoId] = useState("");
  const enviar = (lista: FileList | null) => {
    const f = lista?.[0];
    if (!f) return;
    const fd = new FormData();
    fd.set("arquivo", f);
    fd.set("competencia", mes);
    fd.set("conexaoId", conexaoId);
    rodar(async () => {
      const r = await importarQuadro(fd);
      if (entrada.current) entrada.current.value = "";
      return r;
    });
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-[13px] text-slate-600">
        Mês da lista{" "}
        <input type="month" className={campo} value={mes} onChange={(e) => setMes(e.target.value)} disabled={pendente} />
      </label>
      <select className={campo} aria-label="Empresa da lista" value={conexaoId} onChange={(e) => setConexaoId(e.target.value)} disabled={pendente}>
        <option value="">Empresa: descobrir pela lista</option>
        {conexoes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.apelido}
          </option>
        ))}
      </select>
      <input ref={entrada} id="importar-quadro" type="file" accept=".xlsx" className="sr-only" onChange={(e) => enviar(e.target.files)} disabled={pendente} />
      <label htmlFor="importar-quadro" className={`cursor-pointer ${botao} ${pendente ? "pointer-events-none opacity-50" : ""}`}>
        {pendente ? "Importando…" : "Importar lista de empregados (.xlsx)"}
      </label>
      <Mensagem msg={msg} />
    </div>
  );
}

export function ExcluirQuadro({ id, rotulo }: { id: string; rotulo: string }) {
  const { pendente, msg, rodar } = useAcao();
  return (
    <>
      <button type="button" className="text-xs text-slate-400 hover:text-red-700" disabled={pendente} aria-label={`Excluir ${rotulo}`} onClick={() => window.confirm(`Excluir o quadro ${rotulo}?`) && rodar(() => excluirQuadro(id))}>
        ✕
      </button>
      <Mensagem msg={msg?.erro ? msg : null} />
    </>
  );
}

export function TipoDoCentro({ id, tipo }: { id: string; tipo: string }) {
  const { pendente, msg, rodar } = useAcao();
  return (
    <span className="inline-flex items-center gap-1">
      <select className={campo} aria-label="Tipo do centro de custo" defaultValue={tipo} disabled={pendente} onChange={(e) => rodar(() => salvarCentro(id, { tipo: e.target.value }))}>
        <option value="OPERACIONAL">Operacional</option>
        <option value="APOIO">Apoio (rateado)</option>
      </select>
      <Mensagem msg={msg?.erro ? msg : null} />
    </span>
  );
}

export type OpcaoCentro = { id: string; rotulo: string; conexaoId: string };

// Ligar uma origem não alocada a um centro — as sugestões pelo nome primeiro.
export function LigarOrigem({
  origem,
  centros,
  sugestoes,
}: {
  origem: { tipo: string; conexaoId: string; valor: string; rotulo: string };
  centros: OpcaoCentro[];
  sugestoes: string[];
}) {
  const { pendente, msg, rodar } = useAcao();
  const [centro, setCentro] = useState(sugestoes[0] ?? "");
  const [pct, setPct] = useState("100");
  const daEmpresa = centros.filter((c) => c.conexaoId === origem.conexaoId);
  const outros = centros.filter((c) => c.conexaoId !== origem.conexaoId);
  const sugeridos = centros.filter((c) => sugestoes.includes(c.id));
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <select className={`${campo} w-[210px]`} aria-label="Centro de custo" value={centro} onChange={(e) => setCentro(e.target.value)} disabled={pendente}>
        <option value="">Ligar a…</option>
        {sugeridos.length > 0 && (
          <optgroup label="Sugeridos pelo nome">
            {sugeridos.map((c) => (
              <option key={`s${c.id}`} value={c.id}>
                {c.rotulo}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="Da mesma empresa">
          {daEmpresa.map((c) => (
            <option key={c.id} value={c.id}>
              {c.rotulo}
            </option>
          ))}
        </optgroup>
        {outros.length > 0 && (
          <optgroup label="Da outra empresa">
            {outros.map((c) => (
              <option key={c.id} value={c.id}>
                {c.rotulo}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <input className={`${campo} w-14 text-right`} aria-label="Percentual" value={pct} onChange={(e) => setPct(e.target.value)} disabled={pendente} />
      <span className="text-xs text-slate-500">%</span>
      <button
        type="button"
        className={botao}
        disabled={pendente || !centro}
        onClick={() => rodar(() => ligarOrigem({ centroCustoId: centro, tipoOrigem: origem.tipo, conexaoId: origem.conexaoId, valorOrigem: origem.valor, rotuloOrigem: origem.rotulo, percentual: Number(pct.replace(",", ".")) }))}
      >
        {pendente ? "…" : "Ligar"}
      </button>
      <Mensagem msg={msg?.erro ? msg : null} />
    </span>
  );
}

export type OpcaoOrigem = { tipo: string; valor: string; rotulo: string; conexaoId: string };

// Ligar uma origem da Omie a um centro escolhido — departamento, projeto,
// categoria ou cliente/fornecedor pelo documento. As origens da lista são as
// da empresa do centro.
export function NovoVinculo({ centros, origens }: { centros: OpcaoCentro[]; origens: OpcaoOrigem[] }) {
  const { pendente, msg, rodar } = useAcao();
  const [centroId, setCentroId] = useState("");
  const [escolha, setEscolha] = useState("");
  const [documento, setDocumento] = useState("");
  const [pct, setPct] = useState("100");
  const conexaoId = centros.find((c) => c.id === centroId)?.conexaoId ?? "";
  const daEmpresa = origens.filter((o) => o.conexaoId === conexaoId);
  const tipos = [...new Set(daEmpresa.map((o) => o.tipo))];
  const ROTULO: Record<string, string> = { PROJETO: "Projetos (OS)", DEPARTAMENTO: "Departamentos", CATEGORIA: "Categorias" };
  const salvar = () => {
    const o = escolha === "PARCEIRO" ? { tipo: "PARCEIRO", valor: documento, rotulo: `Parceiro · ${documento}` } : daEmpresa.find((x) => `${x.tipo}|${x.valor}` === escolha);
    if (!o || !conexaoId) return;
    rodar(() => ligarOrigem({ centroCustoId: centroId, tipoOrigem: o.tipo, conexaoId, valorOrigem: o.valor, rotuloOrigem: o.rotulo, percentual: Number(pct.replace(",", ".")) }));
  };
  return (
    <div className="flex flex-wrap items-center gap-1">
      <select className={`${campo} max-w-[240px]`} aria-label="Centro de custo" value={centroId} onChange={(e) => { setCentroId(e.target.value); setEscolha(""); }} disabled={pendente}>
        <option value="">Centro de custo…</option>
        {centros.map((c) => (
          <option key={c.id} value={c.id}>
            {c.rotulo}
          </option>
        ))}
      </select>
      <select className={`${campo} max-w-[280px]`} aria-label="Origem na Omie" value={escolha} onChange={(e) => setEscolha(e.target.value)} disabled={pendente || !centroId}>
        <option value="">Origem na Omie…</option>
        <option value="PARCEIRO">Cliente/fornecedor pelo CNPJ ou CPF</option>
        {tipos.map((t) => (
          <optgroup key={t} label={ROTULO[t] ?? t}>
            {daEmpresa
              .filter((o) => o.tipo === t)
              .map((o) => (
                <option key={`${o.tipo}|${o.valor}`} value={`${o.tipo}|${o.valor}`}>
                  {o.rotulo}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      {escolha === "PARCEIRO" && <input className={`${campo} w-40`} placeholder="CNPJ ou CPF" aria-label="CNPJ ou CPF" value={documento} onChange={(e) => setDocumento(e.target.value)} disabled={pendente} />}
      <input className={`${campo} w-14 text-right`} aria-label="Percentual" value={pct} onChange={(e) => setPct(e.target.value)} disabled={pendente} />
      <span className="text-xs text-slate-500">%</span>
      <button type="button" className={botao} disabled={pendente || !escolha || (escolha === "PARCEIRO" && !documento.trim())} onClick={salvar}>
        {pendente ? "…" : "Ligar"}
      </button>
      <Mensagem msg={msg} />
    </div>
  );
}

export function RemoverVinculo({ id, rotulo }: { id: string; rotulo: string }) {
  const { pendente, msg, rodar } = useAcao();
  return (
    <>
      <button type="button" className="text-xs text-slate-400 hover:text-red-700" disabled={pendente} aria-label={`Remover ${rotulo}`} onClick={() => rodar(() => desligarOrigem(id))}>
        ✕
      </button>
      <Mensagem msg={msg?.erro ? msg : null} />
    </>
  );
}
