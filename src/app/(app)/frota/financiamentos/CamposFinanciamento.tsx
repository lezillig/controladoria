import { PRODUTOS, ROTULO_PRODUTO, ROTULO_SITUACAO_CONSORCIO, SITUACOES_CONSORCIO } from "@/lib/frota/financiamentos";

// Os campos do contrato (financiamento, giro) ou da cota de consórcio.

const ent = "w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm";
type V = Record<string, unknown>;
const iso = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : "");
const reais = (c: unknown) => (c === null || c === undefined ? "" : (Number(c) / 100).toFixed(2).replace(".", ","));

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-slate-600">
      {rotulo}
      <div className="mt-1">{children}</div>
    </label>
  );
}

export default function CamposFinanciamento({ v }: { v: V }) {
  const t = (k: string) => (v[k] === null || v[k] === undefined ? "" : String(v[k]));
  return (
    <div className="space-y-4">
      <fieldset className="grid gap-3 rounded-lg border border-slate-200 p-4 md:grid-cols-4">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Contrato</legend>
        <Campo rotulo="Produto">
          <select name="produto" defaultValue={t("produto") || "financiamento_bens"} className={ent}>
            {PRODUTOS.map((p) => <option key={p} value={p}>{ROTULO_PRODUTO[p]}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Banco / administradora">
          <input name="instituicao" defaultValue={t("instituicao")} className={ent} />
        </Campo>
        <Campo rotulo="CNPJ do banco">
          <input name="instituicaoCnpj" defaultValue={t("instituicaoCnpj")} className={ent} />
        </Campo>
        <Campo rotulo="Modalidade (CDC, Finame…)">
          <input name="modalidade" defaultValue={t("modalidade")} className={ent} />
        </Campo>
        <Campo rotulo="Nº do contrato">
          <input name="contratoNumero" defaultValue={t("contratoNumero")} className={ent} />
        </Campo>
        <Campo rotulo="Célula de crédito">
          <input name="celulaCredito" defaultValue={t("celulaCredito")} className={ent} />
        </Campo>
        <Campo rotulo="Garantia">
          <input name="garantia" defaultValue={t("garantia")} placeholder="alienação fiduciária, aval…" className={ent} />
        </Campo>
        <Campo rotulo="Empresa que paga">
          <input name="empresa" defaultValue={t("empresa")} placeholder="AZUL, MCZ…" className={ent} />
        </Campo>
      </fieldset>
      <fieldset className="grid gap-3 rounded-lg border border-slate-200 p-4 md:grid-cols-4">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Valores e parcelas</legend>
        <Campo rotulo="Valor financiado / crédito (R$)"><input name="valorFinanciado" defaultValue={reais(v.valorFinanciadoCents)} className={ent} /></Campo>
        <Campo rotulo="Valor dos bens (R$)"><input name="valorBens" defaultValue={reais(v.valorBensCents)} className={ent} /></Campo>
        <Campo rotulo="Entrada (R$)"><input name="entrada" defaultValue={reais(v.entradaCents)} className={ent} /></Campo>
        <Campo rotulo="Creditado / líquido (R$)"><input name="valorCreditado" defaultValue={reais(v.valorCreditadoCents)} className={ent} /></Campo>
        <Campo rotulo="Taxa (% a.m.; consórcio: adm. total)"><input name="taxaPct" defaultValue={t("taxaPct").replace(".", ",")} className={ent} /></Campo>
        <Campo rotulo="Nº de parcelas"><input name="parcelas" defaultValue={t("parcelas")} className={ent} /></Campo>
        <Campo rotulo="Valor da parcela (R$)"><input name="valorParcela" defaultValue={reais(v.valorParcelaCents)} className={ent} /></Campo>
        <Campo rotulo="Dia do vencimento"><input name="vencimentoDia" defaultValue={t("vencimentoDia")} className={ent} /></Campo>
        <Campo rotulo="Início"><input type="date" name="dataInicio" defaultValue={iso(v.dataInicio)} className={ent} /></Campo>
        <Campo rotulo="Primeira parcela"><input type="date" name="dataPrimeiraParcela" defaultValue={iso(v.dataPrimeiraParcela)} className={ent} /></Campo>
        <Campo rotulo="Término"><input type="date" name="dataFinal" defaultValue={iso(v.dataFinal)} className={ent} /></Campo>
        <Campo rotulo="Parcelas pagas (informado)"><input name="parcelasPagas" defaultValue={t("parcelasPagas")} className={ent} /></Campo>
        <Campo rotulo="Valor pago (informado, R$)"><input name="valorPago" defaultValue={reais(v.valorPagoCents)} className={ent} /></Campo>
        <Campo rotulo="Saldo para quitação (informado, R$)"><input name="saldoQuitacao" defaultValue={reais(v.saldoQuitacaoCents)} className={ent} /></Campo>
      </fieldset>
      <fieldset className="grid gap-3 rounded-lg border border-slate-200 p-4 md:grid-cols-4">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Consórcio</legend>
        <Campo rotulo="Grupo"><input name="grupo" defaultValue={t("grupo")} className={ent} /></Campo>
        <Campo rotulo="Cota"><input name="cota" defaultValue={t("cota")} className={ent} /></Campo>
        <Campo rotulo="Situação da cota">
          <select name="situacaoConsorcio" defaultValue={t("situacaoConsorcio") || "nao_contemplada"} className={ent}>
            {SITUACOES_CONSORCIO.map((s) => <option key={s} value={s}>{ROTULO_SITUACAO_CONSORCIO[s]}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Data da contemplação"><input type="date" name="dataContemplacao" defaultValue={iso(v.dataContemplacao)} className={ent} /></Campo>
        <Campo rotulo="Lance (R$)"><input name="lance" defaultValue={reais(v.lanceCents)} className={ent} /></Campo>
        <Campo rotulo="Lance planejado (% do crédito)"><input name="lancePlanejadoPct" defaultValue={t("lancePlanejadoPct").replace(".", ",")} className={ent} /></Campo>
      </fieldset>
      <label className="block text-xs font-medium text-slate-600">
        Observações
        <textarea name="observacoes" defaultValue={t("observacoes")} rows={2} className={`${ent} mt-1`} />
      </label>
    </div>
  );
}
