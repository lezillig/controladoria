"use client";

import { jornadaDoHorario } from "@/lib/simulador/horario";
import { lerNumero } from "@/lib/simulador/numeros";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cardClass, inputClass, labelClass, primaryButtonClass } from "@/lib/ui";
import { PERFIS_PADRAO } from "@/lib/simulador/premissas";
import { ROTULO_TIPO_VEICULO, TIPOS_VEICULO, unidadeDoTeto, VARIANTE_DO_TIPO, type TipoVeiculo, type UnidadePreco, type VarianteVeiculo } from "@/lib/simulador/tipos";
import { atualizarEstudo, criarEstudo } from "../actions";
import { GRUPOS_HABILITACAO, ROTULO_GRUPO_HABILITACAO, type EstudoImportado, type RegraImportada, type RotaImportada } from "@/lib/simulador/editalParaEstudo";
import ImportarEdital from "./ImportarEdital";
import { descreverPremissasDoEdital } from "@/lib/simulador/premissasDoEdital";

// O PRIMEIRO PASSO de um estudo. Primeiro a esfera — público ou privado —,
// porque ela muda o que se pergunta: no público, edital, modalidade, sessão e
// preço máximo; no privado, a proposta comercial (validade, reajuste,
// faturamento, aviso de rescisão). Em tela larga, identificação à esquerda e
// a operação (veículos e como o contrato paga) à direita.

const UNIDADES = [
  ["KM", "Por km rodado", "O contratante paga o km útil. Risco de ociosidade é da empresa."],
  ["VEICULO_MES", "Por veículo-mês", "Valor fixo por veículo à disposição. Risco: km acima do previsto."],
  ["BINOMIA", "Fixo + variável", "Parcela fixa por veículo-mês + parcela por km. Divide o risco."],
  ["DIARIA", "Por diária", "Valor por veículo-dia de operação."],
  ["HORA", "Por hora", "Valor por hora de operação (informe as horas/dia nas rotas)."],
] as const;

const TIPOS_POR_ESFERA = {
  PUBLICO: [
    ["LICITACAO", "Licitação"],
    ["CONTRATACAO_DIRETA", "Contratação direta (dispensa / inexigibilidade)"],
    ["RENOVACAO", "Renovação / prorrogação de contrato"],
    ["OUTRO", "Outro"],
  ],
  PRIVADO: [
    ["CONTRATO_PRIVADO", "Proposta para contrato"],
    ["RENOVACAO", "Renovação / reajuste de contrato"],
    ["ORCAMENTO_INTERNO", "Orçamento interno"],
    ["OUTRO", "Outro"],
  ],
} as const;

// Os tipos de veículo mudam o custo da mão de obra (CNH e faixa salarial da
// convenção, motoristas por veículo), o valor do veículo, a adaptação ou a
// implementação e o consumo.
const GRUPOS: { variante: VarianteVeiculo; titulo: string }[] = [
  { variante: "PADRAO", titulo: "Passageiros" },
  { variante: "ADAPTADO", titulo: "Adaptados (acessibilidade)" },
  { variante: "UNIDADE_MOVEL", titulo: "Unidades móveis" },
];
function ajudaDoTipo(t: TipoVeiculo) {
  const p = PERFIS_PADRAO.find((x) => x.tipo === t);
  if (!p) return "";
  const lugares = p.lotacao ? `${p.lotacao} lugares` : "não leva passageiros";
  return `${lugares} · CNH ${p.categoriaCnh ?? "—"}`;
}

// OS ITENS JÁ CONHECIDOS AO CRIAR — lotes do edital, linhas da proposta.
// Cada linha nova copia a anterior (tipo, veículos, km, preço máximo): em
// orçamentos com itens parecidos só se muda o que difere. Com km informado,
// o item nasce com uma rota; sem km, só o item (as rotas vêm na Operação).
//
// NA PROPOSTA PRIVADA, também como o veículo roda no dia: uso administrativo
// (à disposição), turnos, dias trabalhados no mês e horário de início e fim —
// as horas por dia e o noturno saem do horário (ver horario.ts).
type LinhaItem = {
  descricao: string;
  tipoVeiculo: string;
  veiculos: string;
  km: string;
  precoMaximoKm: string;
  administrativo: boolean;
  turnos: string;
  diasMes: string;
  horarioInicio: string;
  horarioFim: string;
  // Monitores por veículo; de onde o item saiu no edital; as rotas da planilha
  // de itinerários (importação) — com elas, o item nasce com uma rota por linha.
  monitoras: string;
  fonte: string;
  rotas: RotaImportada[];
};
const LINHA_VAZIA: LinhaItem = { descricao: "", tipoVeiculo: "", veiculos: "1", km: "", precoMaximoKm: "", administrativo: false, turnos: "1", diasMes: "22", horarioInicio: "", horarioFim: "", monitoras: "", fonte: "", rotas: [] };

// O que vai ao servidor. O preço máximo só no público.
function itensParaEnviar(itens: LinhaItem[], publico: boolean) {
  return itens.map(({ fonte: _fonte, ...x }) => ({ ...x, precoMaximoKm: publico ? x.precoMaximoKm : "" }));
}

// A segunda linha do item na proposta privada: como o veículo roda no dia.
function OperacaoDoItem({ x, k, mudar }: { x: LinhaItem; k: number; mudar: (k: number, campo: keyof LinhaItem, valor: string | boolean) => void }) {
  const pequeno = "rounded-md border border-slate-300 px-2 py-1 text-sm";
  const jornada = jornadaDoHorario(x.horarioInicio, x.horarioFim);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-600">
      <label className="flex items-center gap-1.5" title="Veículo à disposição do contratante (uso administrativo), sem rota fixa de passageiros">
        <input type="checkbox" checked={x.administrativo} onChange={(e) => mudar(k, "administrativo", e.target.checked)} />
        ADM (à disposição)
      </label>
      <label className="flex items-center gap-1.5">
        Turnos
        <select aria-label={`Turnos do item ${k + 1}`} className={pequeno} value={x.turnos} onChange={(e) => mudar(k, "turnos", e.target.value)}>
          {["1", "2", "3"].map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5">
        Dias no mês
        <input aria-label={`Dias trabalhados no mês do item ${k + 1}`} inputMode="numeric" className={`${pequeno} w-14 text-right`} value={x.diasMes} onChange={(e) => mudar(k, "diasMes", e.target.value)} />
      </label>
      <label className="flex items-center gap-1.5" title="Monitores (acompanhantes) por veículo e turno — escolar, saúde">
        Monitores/veículo
        <input aria-label={`Monitores por veículo do item ${k + 1}`} inputMode="decimal" className={`${pequeno} w-14 text-right`} placeholder="0" value={x.monitoras} onChange={(e) => mudar(k, "monitoras", e.target.value)} />
      </label>
      <label className="flex items-center gap-1.5">
        Início
        <input type="time" aria-label={`Horário de início do item ${k + 1}`} className={pequeno} value={x.horarioInicio} onChange={(e) => mudar(k, "horarioInicio", e.target.value)} />
      </label>
      <label className="flex items-center gap-1.5">
        Fim
        <input type="time" aria-label={`Horário de fim do item ${k + 1}`} className={pequeno} value={x.horarioFim} onChange={(e) => mudar(k, "horarioFim", e.target.value)} />
      </label>
      {jornada && (
        <span className="text-slate-500">
          {jornada.horas.toLocaleString("pt-BR")} h/dia{jornada.noturno ? " · com horário noturno" : ""}
          {(lerNumero(x.turnos) ?? 1) > 1 ? ` · ${x.turnos} equipes de motoristas` : ""}
        </span>
      )}
    </div>
  );
}

// As rotas que vieram da planilha de itinerários do edital: só para conferir
// aqui; o ajuste é rota a rota na aba Operação, depois de criado.
function RotasDoItem({ x, escolar }: { x: LinhaItem; escolar: boolean }) {
  const n = (v: string) => (v ? (lerNumero(v)?.toLocaleString("pt-BR") ?? v) : "—");
  return (
    <details className="text-xs text-slate-600">
      <summary className="cursor-pointer">
        {x.rotas.length} rota(s) do edital · {n(x.veiculos)} veículo(s) · {n(x.km)} km {escolar ? "no período letivo" : "por mês"}
      </summary>
      <div className="mt-1 max-h-64 overflow-auto">
        <table className="w-full min-w-[560px]">
          <thead>
            <tr className="text-left text-[11px] uppercase text-slate-400">
              <th className="py-1 pr-2">Rota</th>
              <th className="py-1 pr-2">Veículo</th>
              <th className="py-1 pr-2 text-right">Veíc.</th>
              <th className="py-1 pr-2 text-right">Km/dia</th>
              <th className="py-1 pr-2">Horário</th>
              <th className="py-1 pr-2 text-right">Turnos</th>
              <th className="py-1 text-right">Monitores/veíc.</th>
            </tr>
          </thead>
          <tbody>
            {x.rotas.map((r, j) => (
              <tr key={j} className="border-t border-slate-100">
                <td className="py-1 pr-2">{r.nome}</td>
                <td className="py-1 pr-2">{r.tipoVeiculo ? ROTULO_TIPO_VEICULO[r.tipoVeiculo as TipoVeiculo] ?? r.tipoVeiculo : "—"}</td>
                <td className="py-1 pr-2 text-right">{n(r.veiculos)}</td>
                <td className="py-1 pr-2 text-right">{n(r.kmDia)}</td>
                <td className="py-1 pr-2">{r.horarioInicio && r.horarioFim ? `${r.horarioInicio}–${r.horarioFim}` : "—"}</td>
                <td className="py-1 pr-2 text-right">{r.turnos}</td>
                <td className="py-1 text-right">{n(r.monitoras)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// O que a leitura do edital achou que precisa de conferência.
function ResumoDoImportado({ importado }: { importado: EstudoImportado }) {
  const suposicoes = importado.regras.filter((r) => r.tema === "SUPOSICAO");
  const exigencias = importado.regras.filter((r) => r.tema !== "SUPOSICAO");
  const item = (r: RegraImportada, k: number) => (
    <li key={k}>
      {r.texto}
      {r.fonte && <span className="ml-1 text-xs text-slate-400">({r.fonte})</span>}
    </li>
  );
  return (
    <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/60 p-4 text-sm">
      <p className="font-semibold text-slate-800">Lido do edital — confira antes de criar</p>
      <p className="text-slate-700">{importado.resumo}</p>
      {importado.leitura && (
        <p className="text-xs text-slate-500">
          Lido pelo {importado.leitura.modelo}
          {importado.leitura.refeitaPorque ? ` — refeito no modelo mais forte porque a primeira leitura veio com: ${importado.leitura.refeitaPorque}.` : "."}
        </p>
      )}
      {suposicoes.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">O que a leitura supôs ({suposicoes.length})</p>
          <ul className="list-disc space-y-0.5 pl-5 text-slate-700">{suposicoes.map(item)}</ul>
        </div>
      )}
      {exigencias.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-600">Exigências que pesam no custo ({exigencias.length})</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-slate-700">{exigencias.map(item)}</ul>
        </details>
      )}
      {importado.premissas && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-800">Premissas que o edital fixa — o estudo já abre com elas</p>
          <ul className="list-disc space-y-0.5 pl-5 text-slate-700">
            {descreverPremissasDoEdital(importado.premissas).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      )}
      {importado.habilitacao.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-600">Documentos de habilitação ({importado.habilitacao.length})</summary>
          <div className="mt-1 space-y-2">
            {GRUPOS_HABILITACAO.filter((g) => importado.habilitacao.some((d) => d.grupo === g)).map((g) => (
              <div key={g}>
                <p className="text-xs font-medium text-slate-600">{ROTULO_GRUPO_HABILITACAO[g]}</p>
                <ul className="list-disc space-y-0.5 pl-5 text-slate-700">
                  {importado.habilitacao
                    .filter((d) => d.grupo === g)
                    .map((d, k) => (
                      <li key={k}>
                        {d.documento}
                        {d.exigencia && <span className="text-slate-500"> — {d.exigencia}</span>}
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      )}
      <p className="text-xs text-slate-500">Ao criar, as suposições e exigências ficam no estudo, em “Regras do edital”, e os documentos na aba Habilitação.</p>
    </div>
  );
}

function ItensDoEstudo({
  itens,
  setItens,
  tipos,
  publico,
  escolar,
  unidade,
}: {
  itens: LinhaItem[];
  setItens: (f: (atual: LinhaItem[]) => LinhaItem[]) => void;
  tipos: string[];
  publico: boolean;
  escolar: boolean;
  unidade: string;
}) {
  // Só os tipos marcados (ou todos, sem nenhum marcado); tipo desmarcado
  // depois volta a "principal".
  const opcoes = (tipos.length > 0 ? tipos : [...TIPOS_VEICULO]) as TipoVeiculo[];
  const mudar = (k: number, campo: keyof LinhaItem, valor: string | boolean) => setItens((atual) => atual.map((x, j) => (j === k ? { ...x, [campo]: valor } : x)));
  const pequeno = "w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm";
  const colunas = publico ? "sm:grid-cols-[1fr_150px_80px_110px_110px_32px]" : "sm:grid-cols-[1fr_150px_80px_110px_32px]";
  return (
    <fieldset>
      <legend className={labelClass}>Itens do estudo</legend>
      <p className="mb-2 text-xs text-slate-500">
        Os itens ou lotes do edital, as linhas da proposta — cada um com o seu preço. Cada item novo copia o anterior; mude só o que difere. Com o
        km informado{publico ? "" : ", o horário ou a marca ADM"}, o item já nasce com uma rota; o resto (pedágio, monitores) se ajusta na aba
        Operação, onde também dá para duplicar itens com as rotas.
      </p>
      <div className="space-y-2">
        <div className={`hidden gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:grid ${colunas}`}>
          <span>Descrição</span>
          <span>Tipo de veículo</span>
          <span>Veículos</span>
          <span>{escolar ? "Km no período" : "Km por mês"}</span>
          {publico && <span>Preço máx. {unidadeDoTeto(unidade as UnidadePreco)}</span>}
          <span />
        </div>
        {itens.map((x, k) => (
          <div key={k} className={publico && x.rotas.length === 0 && !escolar && !x.horarioInicio && !x.monitoras ? "" : "space-y-1.5 rounded-lg border border-slate-200 p-2"}>
          <div className={`grid grid-cols-2 gap-2 ${publico ? "rounded-lg border border-slate-200 p-2 sm:border-0 sm:p-0" : ""} ${colunas}`}>
            <input
              aria-label={`Descrição do item ${k + 1}`}
              className={`${pequeno} col-span-2 sm:col-span-1`}
              placeholder={`Item ${k + 1} — ex.: Lote ${k + 1}, van executiva`}
              maxLength={200}
              value={x.descricao}
              onChange={(e) => mudar(k, "descricao", e.target.value)}
            />
            <select aria-label={`Tipo de veículo do item ${k + 1}`} className={pequeno} value={opcoes.includes(x.tipoVeiculo as TipoVeiculo) ? x.tipoVeiculo : ""} onChange={(e) => mudar(k, "tipoVeiculo", e.target.value)}>
              <option value="">{tipos.length > 0 ? `Principal (${ROTULO_TIPO_VEICULO[tipos[0] as TipoVeiculo]})` : "Veículo padrão"}</option>
              {opcoes.map((t) => (
                <option key={t} value={t}>
                  {ROTULO_TIPO_VEICULO[t]}
                </option>
              ))}
            </select>
            <input aria-label={`Veículos do item ${k + 1}`} inputMode="decimal" className={`${pequeno} text-right ${x.rotas.length > 0 ? "bg-slate-50 text-slate-500" : ""}`} readOnly={x.rotas.length > 0} title={x.rotas.length > 0 ? "Soma das rotas do edital — ajuste rota a rota na aba Operação" : undefined} value={x.veiculos} onChange={(e) => mudar(k, "veiculos", e.target.value)} />
            <input aria-label={`Km do item ${k + 1}`} inputMode="decimal" className={`${pequeno} text-right ${x.rotas.length > 0 ? "bg-slate-50 text-slate-500" : ""}`} readOnly={x.rotas.length > 0} title={x.rotas.length > 0 ? "Soma das rotas do edital — ajuste rota a rota na aba Operação" : undefined} placeholder="opcional" value={x.km} onChange={(e) => mudar(k, "km", e.target.value)} />
            {publico && (
              <input aria-label={`Preço máximo do item ${k + 1}`} inputMode="decimal" className={`${pequeno} text-right`} placeholder="sem teto" value={x.precoMaximoKm} onChange={(e) => mudar(k, "precoMaximoKm", e.target.value)} />
            )}
            <button
              type="button"
              aria-label={`Remover item ${k + 1}`}
              title="Remover item"
              disabled={itens.length === 1}
              className="rounded-md border border-slate-300 px-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              onClick={() => setItens((atual) => atual.filter((_, j) => j !== k))}
            >
              ✕
            </button>
          </div>
          {x.rotas.length > 0 ? (
            <RotasDoItem x={x} escolar={escolar} />
          ) : (
            (!publico || escolar || x.horarioInicio || x.monitoras) && <OperacaoDoItem x={x} k={k} mudar={mudar} />
          )}
          {x.fonte && <p className="text-[11px] text-slate-400">Do edital: {x.fonte}</p>}
          </div>
        ))}
        <button
          type="button"
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          onClick={() => setItens((atual) => [...atual, { ...(atual.at(-1) ?? LINHA_VAZIA), descricao: "" }])}
        >
          + Adicionar item
        </button>
      </div>
    </fieldset>
  );
}

const INDICES = ["IPCA", "INPC", "IGP-M", "Convenção coletiva + diesel (fórmula paramétrica)", "Negociado a cada ano"];

// Os dados de um estudo já criado, para o formulário abrir em modo de edição.
export type EstudoParaEditar = {
  id: string;
  esfera: "PUBLICO" | "PRIVADO";
  abrangencia: "MUNICIPAL" | "INTERMUNICIPAL" | "MISTO";
  campos: Record<string, string>;
  srp: boolean;
};

export default function NovoEstudoForm({ estudo, leituraDisponivel = false }: { estudo?: EstudoParaEditar; leituraDisponivel?: boolean } = {}) {
  const editando = Boolean(estudo);
  // O edital lido preenche o formulário; a chave remonta os campos para eles
  // pegarem os valores lidos.
  const [importado, setImportado] = useState<EstudoImportado | null>(null);
  // Os arquivos do edital guardados na importação: presos ao estudo no "Criar".
  const [arquivosGuardados, setArquivosGuardados] = useState<string[]>([]);
  const [versaoDoFormulario, setVersaoDoFormulario] = useState(0);
  const v = (campo: string) => estudo?.campos[campo] ?? importado?.campos[campo] ?? "";
  const [esfera, setEsfera] = useState<"PUBLICO" | "PRIVADO">(estudo?.esfera ?? "PUBLICO");
  const [tipo, setTipo] = useState<string>(estudo?.campos.tipo ?? "LICITACAO");
  const [tipoServico, setTipoServico] = useState(estudo?.campos.tipoServico ?? "FRETAMENTO");
  const [abrangencia, setAbrangencia] = useState<string>(estudo?.abrangencia ?? "MUNICIPAL");
  const [unidade, setUnidade] = useState("KM");
  // Na ordem em que foram marcados: o primeiro é o tipo das rotas novas.
  const [tipos, setTipos] = useState<string[]>([]);
  const [itens, setItens] = useState<LinhaItem[]>([LINHA_VAZIA]);
  const [erro, setErro] = useState<string | null>(null);
  const [processando, iniciar] = useTransition();
  const router = useRouter();
  const publico = esfera === "PUBLICO";

  const trocarEsfera = (e: "PUBLICO" | "PRIVADO") => {
    setEsfera(e);
    setTipo(TIPOS_POR_ESFERA[e][0][0]);
  };

  const aplicarImportado = (e: EstudoImportado, guardados: string[]) => {
    setImportado(e);
    setArquivosGuardados(guardados);
    setEsfera(e.esfera);
    setTipo(TIPOS_POR_ESFERA[e.esfera].some(([t]) => t === e.tipo) ? e.tipo : TIPOS_POR_ESFERA[e.esfera][0][0]);
    setTipoServico(e.tipoServico);
    setAbrangencia(e.abrangencia);
    setUnidade(e.unidade);
    setTipos(e.tipos);
    setItens(e.itens.length > 0 ? e.itens : [LINHA_VAZIA]);
    setVersaoDoFormulario((n) => n + 1);
  };

  return (
    <div className="space-y-4">
    {!editando && <ImportarEdital disponivel={leituraDisponivel} onImportado={aplicarImportado} />}
    {importado && <ResumoDoImportado importado={importado} />}
    <form
      key={versaoDoFormulario}
      className={`${cardClass} space-y-6`}
      action={(formData) => {
        setErro(null);
        formData.set("unidadePreco", unidade);
        formData.set("esfera", esfera);
        formData.delete("tiposVeiculo");
        for (const t of tipos) formData.append("tiposVeiculo", t);
        formData.set("abrangencia", abrangencia);
        if (!estudo) formData.set("itens", JSON.stringify(itensParaEnviar(itens, publico)));
        if (!estudo && importado) {
          formData.set("regrasDoEdital", JSON.stringify(importado.regras));
          formData.set("habilitacaoDoEdital", JSON.stringify(importado.habilitacao));
          formData.set("arquivosGuardados", JSON.stringify(arquivosGuardados));
          if (importado.premissas) formData.set("premissasDoEdital", JSON.stringify(importado.premissas));
        }
        iniciar(async () => {
          const r = estudo ? await atualizarEstudo(estudo.id, formData) : await criarEstudo(formData);
          if (r.erro) setErro(r.erro);
          else if (r.id) {
            router.push(`/simulador/${r.id}`);
            router.refresh();
          }
        });
      }}
    >
      <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
        {/* ESQUERDA: quem é o cliente e o que se está orçando. */}
        <div className="space-y-5">
          <fieldset>
            <legend className={labelClass}>Cliente</legend>
            <div className="inline-flex rounded-lg border border-slate-300 p-0.5" role="radiogroup">
              {(
                [
                  ["PUBLICO", "Público", "Prefeitura, estado, autarquia"],
                  ["PRIVADO", "Privado", "Empresa, escola, clube, evento"],
                ] as const
              ).map(([valor, rotulo, ajuda]) => (
                <button
                  key={valor}
                  type="button"
                  role="radio"
                  aria-checked={esfera === valor}
                  title={ajuda}
                  onClick={() => trocarEsfera(valor)}
                  className={`rounded-md px-5 py-1.5 text-sm font-medium ${esfera === valor ? "bg-blue-700 text-white" : "text-slate-600 hover:bg-slate-100"}`}
                >
                  {rotulo}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="novo-nome" className={labelClass}>Nome do estudo</label>
              <input id="novo-nome" name="nome" required maxLength={120} defaultValue={v("nome")} className={inputClass} placeholder={publico ? "Ex.: Transporte de pacientes — PE 036/2026" : "Ex.: Fretamento fábrica Jundiaí — 12 vans"} />
            </div>
            <div>
              <label htmlFor="novo-tipo" className={labelClass}>Tipo</label>
              <select id="novo-tipo" name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} className={inputClass}>
                {TIPOS_POR_ESFERA[esfera].map(([v, r]) => (
                  <option key={v} value={v}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="novo-tipoServico" className={labelClass}>Serviço</label>
              <select
                id="novo-tipoServico"
                name="tipoServico"
                value={tipoServico}
                onChange={(e) => {
                  setTipoServico(e.target.value);
                  // Eventual se vende por diária (ou por viagem, em km); sugere a
                  // diária se a pessoa ainda não escolheu outra unidade.
                  if (e.target.value === "FRETAMENTO_EVENTUAL" && unidade === "KM") setUnidade("DIARIA");
                }}
                className={inputClass}
              >
                <option value="FRETAMENTO">Fretamento contínuo</option>
                <option value="FRETAMENTO_EVENTUAL">Fretamento eventual (viagens, eventos, turismo)</option>
                <option value="ESCOLAR">Transporte escolar</option>
                <option value="SAUDE">Transporte de pacientes / saúde</option>
                <option value="LOCACAO_CM">Locação com motorista</option>
                <option value="LOCACAO_SM">Locação sem motorista</option>
                <option value="OUTRO">Outro</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="novo-cliente" className={labelClass}>{publico ? "Órgão contratante" : "Empresa cliente"}</label>
              <input id="novo-cliente" name="cliente" maxLength={160} defaultValue={v("cliente")} className={inputClass} placeholder={publico ? "Ex.: Prefeitura Municipal de Holambra" : "Ex.: Indústria X Ltda."} />
            </div>
            <div>
              <label htmlFor="novo-municipio" className={labelClass}>Município</label>
              <input id="novo-municipio" name="municipio" maxLength={120} defaultValue={v("municipio")} className={inputClass} />
            </div>
            <div>
              <label htmlFor="novo-uf" className={labelClass}>UF</label>
              <input id="novo-uf" name="uf" maxLength={2} defaultValue={v("uf")} className={inputClass} placeholder="SP" />
            </div>
            <div>
              <label htmlFor="novo-vigenciaMeses" className={labelClass}>Vigência (meses)</label>
              <input id="novo-vigenciaMeses" name="vigenciaMeses" inputMode="numeric" className={inputClass} defaultValue={estudo || importado ? v("vigenciaMeses") : 12} />
            </div>
            <div>
              <label htmlFor="novo-prazoPagamentoDias" className={labelClass}>Prazo de pagamento (dias)</label>
              <input id="novo-prazoPagamentoDias" name="prazoPagamentoDias" inputMode="numeric" defaultValue={v("prazoPagamentoDias")} className={inputClass} placeholder="30" />
            </div>
            {/* ABRANGÊNCIA: municipal paga ISS; intermunicipal, ICMS (e registro
                na ARTESP em SP). Misto: o % intermunicipal fica por item. */}
            <div className="sm:col-span-2">
              <label htmlFor="novo-abrangencia" className={labelClass}>Abrangência do transporte</label>
              <select id="novo-abrangencia" className={inputClass} value={abrangencia} onChange={(e) => setAbrangencia(e.target.value)}>
                <option value="MUNICIPAL">Municipal — dentro do município (ISS)</option>
                <option value="INTERMUNICIPAL">Intermunicipal — entre municípios (ICMS)</option>
                <option value="MISTO">Misto — parte municipal, parte intermunicipal (% por item na aba Operação)</option>
              </select>
              {abrangencia === "INTERMUNICIPAL" && (
                <p className="mt-1 text-xs text-slate-500">Tributo sobre o preço pelo ICMS; em São Paulo, fretamento intermunicipal pede registro na ARTESP.</p>
              )}
            </div>
          </div>

          {publico ? (
            <div className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 sm:col-span-2">Dados da licitação / contratação</p>
              <div>
                <label htmlFor="novo-numeroEdital" className={labelClass}>Número do edital / processo</label>
                <input id="novo-numeroEdital" name="numeroEdital" maxLength={80} defaultValue={v("numeroEdital")} className={inputClass} placeholder="PE 036/2026" />
              </div>
              <div>
                <label htmlFor="novo-modalidade" className={labelClass}>Modalidade</label>
                <input id="novo-modalidade" name="modalidade" maxLength={80} defaultValue={v("modalidade")} className={inputClass} placeholder="Pregão eletrônico" list="modalidades" />
                <datalist id="modalidades">
                  <option value="Pregão eletrônico" />
                  <option value="Concorrência" />
                  <option value="Dispensa eletrônica" />
                  <option value="Inexigibilidade" />
                  <option value="Credenciamento" />
                </datalist>
              </div>
              <div>
                <label htmlFor="novo-plataforma" className={labelClass}>Plataforma</label>
                <input id="novo-plataforma" name="plataforma" maxLength={120} defaultValue={v("plataforma")} className={inputClass} placeholder="Comprasgov, BLL, Licitações-e…" />
              </div>
              <div>
                <label htmlFor="novo-dataSessao" className={labelClass}>Data da sessão</label>
                <input type="date" id="novo-dataSessao" name="dataSessao" defaultValue={v("dataSessao")} className={inputClass} />
              </div>
              <div>
                <label htmlFor="novo-valorTotalMaximo" className={labelClass}>Valor total máximo (R$)</label>
                <input id="novo-valorTotalMaximo" name="valorTotalMaximo" inputMode="decimal" defaultValue={v("valorTotalMaximo")} className={inputClass} />
              </div>
              <div>
                <label htmlFor="novo-indiceReajuste-pub" className={labelClass}>Reajuste do edital</label>
                <input id="novo-indiceReajuste-pub" name="indiceReajuste" maxLength={80} defaultValue={v("indiceReajuste")} className={inputClass} list="indices" placeholder="IPCA, após 12 meses" />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
                <input type="checkbox" name="srp" defaultChecked={estudo?.srp ?? importado?.srp ?? false} /> Registro de preços (SRP) — paga só o que for demandado
              </label>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 sm:col-span-2">Dados da proposta comercial</p>
              <div>
                <label htmlFor="novo-clienteDocumento" className={labelClass}>CNPJ do cliente</label>
                <input id="novo-clienteDocumento" name="clienteDocumento" maxLength={20} inputMode="numeric" defaultValue={v("clienteDocumento")} className={inputClass} placeholder="00.000.000/0000-00" />
              </div>
              <div>
                <label htmlFor="novo-contatoCliente" className={labelClass}>Responsável no cliente</label>
                <input id="novo-contatoCliente" name="contatoCliente" maxLength={160} defaultValue={v("contatoCliente")} className={inputClass} placeholder="Nome e área (ex.: Compras, RH)" />
              </div>
              <div>
                <label htmlFor="novo-validadeProposta" className={labelClass}>Proposta válida até</label>
                <input type="date" id="novo-validadeProposta" name="validadeProposta" defaultValue={v("validadeProposta")} className={inputClass} />
              </div>
              <div>
                <label htmlFor="novo-inicioPrevisto" className={labelClass}>Início previsto da operação</label>
                <input type="date" id="novo-inicioPrevisto" name="inicioPrevisto" defaultValue={v("inicioPrevisto")} className={inputClass} />
              </div>
              <div>
                <label htmlFor="novo-indiceReajuste" className={labelClass}>Reajuste</label>
                <input id="novo-indiceReajuste" name="indiceReajuste" maxLength={80} defaultValue={v("indiceReajuste")} className={inputClass} list="indices" placeholder="IPCA anual" />
              </div>
              <div>
                <label htmlFor="novo-formaFaturamento" className={labelClass}>Faturamento</label>
                <select id="novo-formaFaturamento" name="formaFaturamento" className={inputClass} defaultValue={v("formaFaturamento") || "Mensal"}>
                  <option>Mensal</option>
                  <option>Quinzenal</option>
                  <option>Por viagem / evento</option>
                  <option>Antecipado</option>
                </select>
              </div>
              <div>
                <label htmlFor="novo-avisoRescisaoDias" className={labelClass}>Aviso para rescisão (dias)</label>
                <input id="novo-avisoRescisaoDias" name="avisoRescisaoDias" inputMode="numeric" defaultValue={v("avisoRescisaoDias")} className={inputClass} placeholder="30" />
              </div>
            </div>
          )}
          <datalist id="indices">
            {INDICES.map((i) => (
              <option key={i} value={i} />
            ))}
          </datalist>

          <div>
            <label htmlFor="novo-descricao" className={labelClass}>{publico ? "Objeto" : "Descrição do serviço"}</label>
            <textarea id="novo-descricao" name="descricao" maxLength={2000} defaultValue={v("descricao")} className={`${inputClass} min-h-[80px]`} />
          </div>
        </div>

        {/* DIREITA: a operação — veículos e como o contrato paga. Na edição,
            fica nas abas do estudo, que é onde a versão guarda. */}
        {editando ? (
          <div className="space-y-2 self-start rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            <p className="font-medium text-slate-800">Operação, veículos e preço</p>
            <p>Itens, rotas e horários: aba Operação. Tipos de veículo e custos deles: aba Veículos. Unidade de preço e julgamento: aba Operação.</p>
            <p>Vigência e prazo de pagamento alterados aqui entram no estudo como ajuste; salve uma nova versão para gravá-los.</p>
          </div>
        ) : (
        <div className="space-y-5">
          <fieldset>
            <legend className={labelClass}>Tipos de veículo</legend>
            <p className="mb-2 text-xs text-slate-500">
              Marque os que o contrato usa. O primeiro marcado é o principal (o das rotas novas); dá para trocar rota a rota e ajustar salário,
              motoristas e custos na aba Veículos. Sem nenhum marcado, o estudo abre com todos.
            </p>
            <div className="space-y-3">
              {GRUPOS.map((g) => (
                <div key={g.variante}>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{g.titulo}</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-4">
                    {TIPOS_VEICULO.filter((t) => VARIANTE_DO_TIPO[t] === g.variante).map((valor) => {
                      const ordem = tipos.indexOf(valor);
                      return (
                        <label key={valor} className={`cursor-pointer rounded-lg border px-3 py-2 text-sm ${ordem >= 0 ? "border-blue-600 bg-blue-50" : "border-slate-200 hover:bg-slate-50"}`}>
                          <input
                            type="checkbox"
                            value={valor}
                            checked={ordem >= 0}
                            onChange={(e) => setTipos((atual) => (e.target.checked ? [...atual, valor] : atual.filter((t) => t !== valor)))}
                            className="mr-2"
                          />
                          <span className="font-medium text-slate-800">{ROTULO_TIPO_VEICULO[valor]}</span>
                          {ordem === 0 && <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-[11px] font-medium text-blue-800">principal</span>}
                          <span className="mt-0.5 block text-xs text-slate-500">{ajudaDoTipo(valor)}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className={labelClass}>Como o contrato paga</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-3">
              {UNIDADES.map(([valor, rotulo, ajuda]) => (
                <label key={valor} className={`cursor-pointer rounded-lg border px-3 py-2 text-sm ${unidade === valor ? "border-blue-600 bg-blue-50" : "border-slate-200 hover:bg-slate-50"}`}>
                  <input type="radio" name="unidade" value={valor} checked={unidade === valor} onChange={() => setUnidade(valor)} className="mr-2" />
                  <span className="font-medium text-slate-800">{rotulo}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">{ajuda}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor="novo-criterio" className={labelClass}>{publico ? "Julgamento" : "Preço"}</label>
            <select id="novo-criterio" name="criterio" className={inputClass} defaultValue={importado?.criterio ?? "ITEM"}>
              <option value="ITEM">Um preço por item</option>
              <option value="LOTE">Preço único do lote (média ponderada dos itens)</option>
            </select>
          </div>

          <ItensDoEstudo itens={itens} setItens={setItens} tipos={tipos} publico={publico} escolar={tipoServico === "ESCOLAR"} unidade={unidade} />
        </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4 border-t border-slate-100 pt-4">
        <button type="submit" disabled={processando} className={primaryButtonClass}>
          {processando ? (editando ? "Salvando…" : "Criando…") : editando ? "Salvar os dados do estudo" : "Criar e montar a operação"}
        </button>
        {erro && <p className="text-sm text-red-700">{erro}</p>}
      </div>
    </form>
    </div>
  );
}
