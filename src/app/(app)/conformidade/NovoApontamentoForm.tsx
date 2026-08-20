"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from "@/lib/ui";
import { AREAS } from "@/lib/conformidade/tipos";
import { registrarApontamento } from "./actions";

// Cadastro manual de apontamento.
//
// Existe para o módulo funcionar inteiro sem leitura automática — e porque nem
// todo risco chega em arquivo: reunião com o contador, ligação da consultoria,
// notificação recebida no balcão. Apontamento que não cabe no sistema é
// apontamento que fica no caderno de alguém.

const SEVERIDADES = [
  { valor: "CRITICA", rotulo: "Crítico" },
  { valor: "ALTA", rotulo: "Alto" },
  { valor: "MEDIA", rotulo: "Médio" },
  { valor: "BAIXA", rotulo: "Baixo" },
  { valor: "INFO", rotulo: "Informativo" },
];

export default function NovoApontamentoForm({
  conexoes,
  documentos,
  competenciaPadrao,
}: {
  conexoes: { id: string; apelido: string; nome: string }[];
  documentos: { id: string; titulo: string; competencia: string }[];
  competenciaPadrao: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [processando, iniciar] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)} className={secondaryButtonClass}>
        Cadastrar apontamento manualmente
      </button>
    );
  }

  return (
    <form
      ref={formRef}
      className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4"
      action={(formData) => {
        setErro(null);
        iniciar(async () => {
          const resultado = await registrarApontamento(formData);
          if (resultado.erro) {
            setErro(resultado.erro);
            return;
          }
          formRef.current?.reset();
          setAberto(false);
          router.refresh();
        });
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelClass}>Título *</label>
          <input name="titulo" type="text" required placeholder="Ex.: Crédito de PIS/COFINS sobre combustível não aproveitado" className={inputClass} />
        </div>

        <div className="sm:col-span-2">
          <label className={labelClass}>O que foi apontado *</label>
          <textarea name="descricao" rows={3} required className={inputClass} />
        </div>

        <div>
          <label className={labelClass}>Área</label>
          <select name="area" defaultValue="FISCAL" className={inputClass}>
            {AREAS.map((a) => (
              <option key={a.valor} value={a.valor}>
                {a.rotulo}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>Gravidade</label>
          <select name="severidade" defaultValue="MEDIA" className={inputClass}>
            {SEVERIDADES.map((s) => (
              <option key={s.valor} value={s.valor}>
                {s.rotulo}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>Competência *</label>
          <input name="competencia" type="month" required defaultValue={competenciaPadrao} className={inputClass} />
        </div>

        <div>
          <label className={labelClass}>Documento de origem</label>
          <select name="documentoId" defaultValue="" className={inputClass}>
            <option value="">Sem documento (reunião, ligação, notificação)</option>
            {documentos.map((d) => (
              <option key={d.id} value={d.id}>
                {d.titulo} — {d.competencia}
              </option>
            ))}
          </select>
        </div>

        {conexoes.length > 0 && (
          <div>
            <label className={labelClass}>Empresa</label>
            <select name="conexaoId" defaultValue="" className={inputClass}>
              <option value="">Grupo (as duas empresas)</option>
              {conexoes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.apelido} — {c.nome}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">Ignorado quando há documento de origem: vale a empresa do documento.</p>
          </div>
        )}

        <div>
          <label className={labelClass}>Valor envolvido (R$)</label>
          <input name="valor" type="text" inputMode="decimal" placeholder="Só se o documento informar" className={inputClass} />
        </div>

        <div>
          <label className={labelClass}>Responsável</label>
          <input name="responsavel" type="text" className={inputClass} />
        </div>

        <div>
          <label className={labelClass}>Prazo</label>
          <input name="prazo" type="date" className={inputClass} />
        </div>

        <div className="sm:col-span-2">
          <label className={labelClass}>O que fazer</label>
          <textarea name="recomendacao" rows={2} placeholder="A providência recomendada pelo documento." className={inputClass} />
        </div>

        <div className="sm:col-span-2">
          <label className={labelClass}>Trecho do documento</label>
          <textarea name="trechoOrigem" rows={2} placeholder="Citação literal, para conferência posterior." className={inputClass} />
        </div>

        <div>
          <label className={labelClass}>Página / seção</label>
          <input name="paginaOrigem" type="text" className={inputClass} />
        </div>

        <div>
          <label className={labelClass}>Assunto (para reincidência)</label>
          <input name="assunto" type="text" placeholder="Em branco, usa o título" className={inputClass} />
          <p className="mt-1 text-xs text-slate-500">
            3 a 6 palavras, sem datas nem valores. É o que reconhece o mesmo ponto no mês seguinte.
          </p>
        </div>
      </div>

      {erro && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p>}

      <div className="flex items-center gap-2">
        <button type="submit" disabled={processando} className={primaryButtonClass}>
          {processando ? "Salvando..." : "Cadastrar apontamento"}
        </button>
        <button type="button" onClick={() => setAberto(false)} className={secondaryButtonClass}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
