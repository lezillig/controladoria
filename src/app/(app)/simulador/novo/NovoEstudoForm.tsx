"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cardClass, inputClass, labelClass, primaryButtonClass } from "@/lib/ui";
import { criarEstudo } from "../actions";

// O PRIMEIRO PASSO de um estudo. Poucos campos, e os de licitação só
// aparecem quando o estudo é uma licitação — quem orça um contrato privado não
// precisa atravessar "modalidade" e "plataforma" para chegar ao que importa.

const UNIDADES = [
  ["KM", "Por km rodado", "O contratante paga o km útil. Risco de ociosidade é da empresa."],
  ["VEICULO_MES", "Por veículo-mês", "Valor fixo por veículo à disposição. Risco: km acima do previsto."],
  ["BINOMIA", "Fixo + variável", "Parcela fixa por veículo-mês + parcela por km. Divide o risco."],
  ["DIARIA", "Por diária", "Valor por veículo-dia de operação."],
  ["HORA", "Por hora", "Valor por hora de operação (informe as horas/dia nas rotas)."],
] as const;

export default function NovoEstudoForm() {
  const [tipo, setTipo] = useState("LICITACAO");
  const [tipoServico, setTipoServico] = useState("FRETAMENTO");
  const [unidade, setUnidade] = useState("KM");
  const [erro, setErro] = useState<string | null>(null);
  const [processando, iniciar] = useTransition();
  const router = useRouter();
  const licitacao = tipo === "LICITACAO";

  return (
    <form
      className={`${cardClass} space-y-5`}
      action={(formData) => {
        setErro(null);
        formData.set("unidadePreco", unidade);
        iniciar(async () => {
          const r = await criarEstudo(formData);
          if (r.erro) setErro(r.erro);
          else if (r.id) router.push(`/simulador/${r.id}`);
        });
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelClass}>Nome do estudo</label>
          <input name="nome" required maxLength={120} className={inputClass} placeholder="Ex.: Fretamento fábrica Jundiaí — 12 vans" />
        </div>
        <div>
          <label className={labelClass}>Tipo</label>
          <select name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} className={inputClass}>
            <option value="LICITACAO">Licitação</option>
            <option value="CONTRATO_PRIVADO">Contrato privado</option>
            <option value="RENOVACAO">Renovação de contrato</option>
            <option value="ORCAMENTO_INTERNO">Orçamento interno</option>
            <option value="OUTRO">Outro</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>Serviço</label>
          <select name="tipoServico" value={tipoServico} onChange={(e) => setTipoServico(e.target.value)} className={inputClass}>
            <option value="FRETAMENTO">Fretamento contínuo</option>
            <option value="ESCOLAR">Transporte escolar</option>
            <option value="SAUDE">Transporte de pacientes / saúde</option>
            <option value="LOCACAO_CM">Locação com motorista</option>
            <option value="LOCACAO_SM">Locação sem motorista</option>
            <option value="OUTRO">Outro</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>{licitacao ? "Órgão / cliente" : "Cliente"}</label>
          <input name="cliente" maxLength={160} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Município</label>
          <input name="municipio" maxLength={120} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>UF</label>
          <input name="uf" maxLength={2} className={inputClass} placeholder="SP" />
        </div>
        <div>
          <label className={labelClass}>Vigência (meses)</label>
          <input name="vigenciaMeses" inputMode="numeric" className={inputClass} defaultValue={12} />
        </div>
        <div>
          <label className={labelClass}>Prazo de pagamento (dias)</label>
          <input name="prazoPagamentoDias" inputMode="numeric" className={inputClass} placeholder={licitacao ? "30" : "30"} />
        </div>
      </div>

      <fieldset>
        <legend className={labelClass}>Como o contrato paga</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
        <label className={labelClass}>Julgamento / preço</label>
        <select name="criterio" className={inputClass} defaultValue="ITEM">
          <option value="ITEM">Um preço por item</option>
          <option value="LOTE">Preço único do lote (média ponderada dos itens)</option>
        </select>
      </div>

      {licitacao && (
        <div className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 sm:col-span-2">Dados da licitação</p>
          <div>
            <label className={labelClass}>Número do edital</label>
            <input name="numeroEdital" maxLength={80} className={inputClass} placeholder="PE 036/2026" />
          </div>
          <div>
            <label className={labelClass}>Órgão</label>
            <input name="orgao" maxLength={200} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Modalidade</label>
            <input name="modalidade" maxLength={80} className={inputClass} placeholder="Pregão eletrônico" />
          </div>
          <div>
            <label className={labelClass}>Plataforma</label>
            <input name="plataforma" maxLength={120} className={inputClass} placeholder="Comprasgov, BLL, Licitações-e…" />
          </div>
          <div>
            <label className={labelClass}>Data da sessão</label>
            <input type="date" name="dataSessao" className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Valor total máximo (R$)</label>
            <input name="valorTotalMaximo" inputMode="decimal" className={inputClass} />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
            <input type="checkbox" name="srp" /> Registro de preços (SRP) — paga só o que for demandado
          </label>
        </div>
      )}

      <div>
        <label className={labelClass}>Descrição / objeto</label>
        <textarea name="descricao" maxLength={2000} className={`${inputClass} min-h-[70px]`} />
      </div>

      {erro && <p className="text-sm text-red-700">{erro}</p>}
      <button type="submit" disabled={processando} className={primaryButtonClass}>
        {processando ? "Criando…" : "Criar e montar a operação"}
      </button>
    </form>
  );
}
