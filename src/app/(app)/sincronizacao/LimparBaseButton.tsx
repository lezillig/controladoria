"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { fmtBRL, fmtData, fmtNumero } from "@/lib/controladoria/format";
import { inputClass, primaryButtonClass, secondaryButtonClass } from "@/lib/ui";
import type { MedidaDaBaseAntiga, ResultadoDaLimpeza } from "@/lib/controladoria/limpezaHistorica";
import { limparBaseAntiga, medirBaseAntiga } from "./actions";

// DOIS CLIQUES, SEPARADOS DE PROPÓSITO: medir, depois limpar.
//
// A medida mostra o que vai sumir e o que vai ficar antes de qualquer DELETE,
// e a lista dos maiores títulos antigos em aberto é a parte que merece um
// olhar — são os que a limpeza preserva, e talvez alguém queira saber por que
// um recebível de 2023 ainda consta como não pago. A confirmação exige
// digitar a palavra, porque não há desfazer barato: trazer de volta é mover a
// data e recarregar horas de API.

const PALAVRA = "LIMPAR";

export default function LimparBaseButton() {
  const [medida, setMedida] = useState<MedidaDaBaseAntiga | null>(null);
  const [resultado, setResultado] = useState<ResultadoDaLimpeza | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmacao, setConfirmacao] = useState("");
  const [processando, iniciar] = useTransition();
  const router = useRouter();

  const medir = () =>
    iniciar(async () => {
      setErro(null);
      setResultado(null);
      try {
        const r = await medirBaseAntiga();
        if (r.erro) setErro(r.erro);
        setMedida(r.medida ?? null);
      } catch (e) {
        setErro("Não consegui medir: " + (e instanceof Error ? e.message.slice(0, 200) : String(e)));
      }
    });

  const limpar = () =>
    iniciar(async () => {
      setErro(null);
      try {
        const r = await limparBaseAntiga(confirmacao);
        if (r.erro) setErro(r.erro);
        if (r.resultado) {
          setResultado(r.resultado);
          setMedida(null);
          setConfirmacao("");
          router.refresh();
        }
      } catch (e) {
        setErro(
          "A limpeza não respondeu a tempo. Ela roda numa transação: ou apagou tudo, ou nada. Clique em Medir de novo para ver em que estado ficou. Detalhe: " +
            (e instanceof Error ? e.message.slice(0, 200) : String(e))
        );
      }
    });

  return (
    <div>
      {!medida && !resultado && (
        <button type="button" disabled={processando} onClick={medir} className={`${secondaryButtonClass} inline-flex items-center gap-2`}>
          <Trash2 className="h-4 w-4" />
          {processando ? "Medindo..." : "Medir o que seria apagado"}
        </button>
      )}

      {erro && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{erro}</p>}

      {medida && (
        <div className="mt-2 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
            <span>Títulos até 2024: <strong className="tabular-nums">{fmtNumero(medida.titulos)}</strong></span>
            <span>Destes, ainda em aberto (ficam): <strong className="tabular-nums">{fmtNumero(medida.titulosEmAberto)}</strong></span>
            <span>Movimentos: <strong className="tabular-nums">{fmtNumero(medida.movimentos)}</strong></span>
            <span>Notas: <strong className="tabular-nums">{fmtNumero(medida.notas)}</strong></span>
            <span>Resumo mensal: <strong className="tabular-nums">{fmtNumero(medida.resumoMensal)}</strong></span>
            <span>Janelas de carga: <strong className="tabular-nums">{fmtNumero(medida.janelasDeCarga)}</strong></span>
          </div>
          <p>
            Data de início da base hoje: <strong>{medida.dataInicioBase ? fmtData(medida.dataInicioBase) : "—"}</strong>
            {medida.dataInicioBase && medida.dataInicioBase < new Date("2025-01-01") && " — será movida para 01/01/2025 antes de apagar."}
          </p>

          {medida.emAbertoMaiores.length > 0 && (
            <div>
              <p className="mb-1 font-medium">Maiores títulos antigos ainda em aberto — estes ficam:</p>
              <ul className="space-y-0.5">
                {medida.emAbertoMaiores.map((t, i) => (
                  <li key={i} className="tabular-nums">
                    {t.conexaoApelido} · {t.natureza === "RECEBER" ? "a receber" : "a pagar"} · {t.parceiroNome ?? "—"} · doc.{" "}
                    {t.numeroDocumento ?? "—"} · venc. {fmtData(t.dataVencimento)} · <strong>{fmtBRL(t.valorCents)}</strong>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {medida.titulos === 0 && medida.movimentos === 0 && medida.notas === 0 ? (
            <p className="text-emerald-700">Não há nada até 2024 para apagar.</p>
          ) : (
            <div className="flex flex-wrap items-end gap-2 border-t border-slate-200 pt-3">
              <div>
                <label className="block text-xs text-slate-600" htmlFor="confirmacao-limpeza">
                  Digite <strong>{PALAVRA}</strong> para confirmar
                </label>
                <input
                  id="confirmacao-limpeza"
                  value={confirmacao}
                  onChange={(e) => setConfirmacao(e.target.value.toUpperCase())}
                  className={`${inputClass} w-40`}
                  autoComplete="off"
                />
              </div>
              <button
                type="button"
                disabled={processando || confirmacao !== PALAVRA}
                onClick={limpar}
                className={primaryButtonClass}
              >
                {processando ? "Limpando... pode levar alguns minutos" : "Limpar até 31/12/2024"}
              </button>
              <button type="button" onClick={() => setMedida(null)} className="text-xs text-slate-500 hover:underline">
                cancelar
              </button>
            </div>
          )}
        </div>
      )}

      {resultado && (
        <div className="mt-2 space-y-1 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
          <p className="font-medium">Limpeza concluída.</p>
          <p>
            {resultado.dataInicioMovida ? "Data de início da base movida para 01/01/2025. " : "Data de início já estava em 2025 ou depois. "}
            {fmtNumero(resultado.titulosApagados)} título(s) apagados, {fmtNumero(resultado.titulosEmAbertoPreservados)} antigo(s) em
            aberto preservado(s); {fmtNumero(resultado.movimentosApagados)} movimento(s), {fmtNumero(resultado.notasApagadas)} nota(s),{" "}
            {fmtNumero(resultado.resumoMensalApagado)} linha(s) de resumo mensal, {fmtNumero(resultado.janelasApagadas)} janela(s) de carga e{" "}
            {fmtNumero(resultado.achadosOrfaosApagados)} achado(s) órfão(s).
            {resultado.vacuum ? " Espaço liberado." : " O encolhimento do arquivo ficou para o autovacuum do banco."}
          </p>
          <p>
            Agora: <strong>Recalcular resumo mensal</strong> até zerar, depois <strong>Rodar a auditoria de novo</strong> →{" "}
            <strong>Sincronizar agora</strong>.
          </p>
        </div>
      )}
    </div>
  );
}
