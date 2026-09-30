"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cardClass, inputClass, labelClass, primaryButtonClass } from "@/lib/ui";
import { PERFIS_PADRAO } from "@/lib/simulador/premissas";
import { ROTULO_TIPO_VEICULO, TIPOS_VEICULO, VARIANTE_DO_TIPO, type TipoVeiculo, type VarianteVeiculo } from "@/lib/simulador/tipos";
import { criarEstudo } from "../actions";

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

const INDICES = ["IPCA", "INPC", "IGP-M", "Convenção coletiva + diesel (fórmula paramétrica)", "Negociado a cada ano"];

export default function NovoEstudoForm() {
  const [esfera, setEsfera] = useState<"PUBLICO" | "PRIVADO">("PUBLICO");
  const [tipo, setTipo] = useState<string>("LICITACAO");
  const [tipoServico, setTipoServico] = useState("FRETAMENTO");
  const [unidade, setUnidade] = useState("KM");
  // Na ordem em que foram marcados: o primeiro é o tipo das rotas novas.
  const [tipos, setTipos] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [processando, iniciar] = useTransition();
  const router = useRouter();
  const publico = esfera === "PUBLICO";

  const trocarEsfera = (e: "PUBLICO" | "PRIVADO") => {
    setEsfera(e);
    setTipo(TIPOS_POR_ESFERA[e][0][0]);
  };

  return (
    <form
      className={`${cardClass} space-y-6`}
      action={(formData) => {
        setErro(null);
        formData.set("unidadePreco", unidade);
        formData.set("esfera", esfera);
        formData.delete("tiposVeiculo");
        for (const t of tipos) formData.append("tiposVeiculo", t);
        iniciar(async () => {
          const r = await criarEstudo(formData);
          if (r.erro) setErro(r.erro);
          else if (r.id) router.push(`/simulador/${r.id}`);
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
              <input id="novo-nome" name="nome" required maxLength={120} className={inputClass} placeholder={publico ? "Ex.: Transporte de pacientes — PE 036/2026" : "Ex.: Fretamento fábrica Jundiaí — 12 vans"} />
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
              <input id="novo-cliente" name="cliente" maxLength={160} className={inputClass} placeholder={publico ? "Ex.: Prefeitura Municipal de Holambra" : "Ex.: Indústria X Ltda."} />
            </div>
            <div>
              <label htmlFor="novo-municipio" className={labelClass}>Município</label>
              <input id="novo-municipio" name="municipio" maxLength={120} className={inputClass} />
            </div>
            <div>
              <label htmlFor="novo-uf" className={labelClass}>UF</label>
              <input id="novo-uf" name="uf" maxLength={2} className={inputClass} placeholder="SP" />
            </div>
            <div>
              <label htmlFor="novo-vigenciaMeses" className={labelClass}>Vigência (meses)</label>
              <input id="novo-vigenciaMeses" name="vigenciaMeses" inputMode="numeric" className={inputClass} defaultValue={12} />
            </div>
            <div>
              <label htmlFor="novo-prazoPagamentoDias" className={labelClass}>Prazo de pagamento (dias)</label>
              <input id="novo-prazoPagamentoDias" name="prazoPagamentoDias" inputMode="numeric" className={inputClass} placeholder="30" />
            </div>
          </div>

          {publico ? (
            <div className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 sm:col-span-2">Dados da licitação / contratação</p>
              <div>
                <label htmlFor="novo-numeroEdital" className={labelClass}>Número do edital / processo</label>
                <input id="novo-numeroEdital" name="numeroEdital" maxLength={80} className={inputClass} placeholder="PE 036/2026" />
              </div>
              <div>
                <label htmlFor="novo-modalidade" className={labelClass}>Modalidade</label>
                <input id="novo-modalidade" name="modalidade" maxLength={80} className={inputClass} placeholder="Pregão eletrônico" list="modalidades" />
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
                <input id="novo-plataforma" name="plataforma" maxLength={120} className={inputClass} placeholder="Comprasgov, BLL, Licitações-e…" />
              </div>
              <div>
                <label htmlFor="novo-dataSessao" className={labelClass}>Data da sessão</label>
                <input type="date" id="novo-dataSessao" name="dataSessao" className={inputClass} />
              </div>
              <div>
                <label htmlFor="novo-valorTotalMaximo" className={labelClass}>Valor total máximo (R$)</label>
                <input id="novo-valorTotalMaximo" name="valorTotalMaximo" inputMode="decimal" className={inputClass} />
              </div>
              <div>
                <label htmlFor="novo-indiceReajuste-pub" className={labelClass}>Reajuste do edital</label>
                <input id="novo-indiceReajuste-pub" name="indiceReajuste" maxLength={80} className={inputClass} list="indices" placeholder="IPCA, após 12 meses" />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
                <input type="checkbox" name="srp" /> Registro de preços (SRP) — paga só o que for demandado
              </label>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 sm:col-span-2">Dados da proposta comercial</p>
              <div>
                <label htmlFor="novo-clienteDocumento" className={labelClass}>CNPJ do cliente</label>
                <input id="novo-clienteDocumento" name="clienteDocumento" maxLength={20} inputMode="numeric" className={inputClass} placeholder="00.000.000/0000-00" />
              </div>
              <div>
                <label htmlFor="novo-contatoCliente" className={labelClass}>Responsável no cliente</label>
                <input id="novo-contatoCliente" name="contatoCliente" maxLength={160} className={inputClass} placeholder="Nome e área (ex.: Compras, RH)" />
              </div>
              <div>
                <label htmlFor="novo-validadeProposta" className={labelClass}>Proposta válida até</label>
                <input type="date" id="novo-validadeProposta" name="validadeProposta" className={inputClass} />
              </div>
              <div>
                <label htmlFor="novo-inicioPrevisto" className={labelClass}>Início previsto da operação</label>
                <input type="date" id="novo-inicioPrevisto" name="inicioPrevisto" className={inputClass} />
              </div>
              <div>
                <label htmlFor="novo-indiceReajuste" className={labelClass}>Reajuste</label>
                <input id="novo-indiceReajuste" name="indiceReajuste" maxLength={80} className={inputClass} list="indices" placeholder="IPCA anual" />
              </div>
              <div>
                <label htmlFor="novo-formaFaturamento" className={labelClass}>Faturamento</label>
                <select id="novo-formaFaturamento" name="formaFaturamento" className={inputClass} defaultValue="Mensal">
                  <option>Mensal</option>
                  <option>Quinzenal</option>
                  <option>Por viagem / evento</option>
                  <option>Antecipado</option>
                </select>
              </div>
              <div>
                <label htmlFor="novo-avisoRescisaoDias" className={labelClass}>Aviso para rescisão (dias)</label>
                <input id="novo-avisoRescisaoDias" name="avisoRescisaoDias" inputMode="numeric" className={inputClass} placeholder="30" />
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
            <textarea id="novo-descricao" name="descricao" maxLength={2000} className={`${inputClass} min-h-[80px]`} />
          </div>
        </div>

        {/* DIREITA: a operação — veículos e como o contrato paga. */}
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
            <select id="novo-criterio" name="criterio" className={inputClass} defaultValue="ITEM">
              <option value="ITEM">Um preço por item</option>
              <option value="LOTE">Preço único do lote (média ponderada dos itens)</option>
            </select>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 border-t border-slate-100 pt-4">
        <button type="submit" disabled={processando} className={primaryButtonClass}>
          {processando ? "Criando…" : "Criar e montar a operação"}
        </button>
        {erro && <p className="text-sm text-red-700">{erro}</p>}
      </div>
    </form>
  );
}
