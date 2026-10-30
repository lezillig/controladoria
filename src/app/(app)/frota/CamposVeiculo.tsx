import { IPVA_SITUACOES, ROTULO_IPVA, ROTULO_TIPO_VEICULO, ROTULO_USO, TIPOS_VEICULO, USOS_VEICULO } from "@/lib/cadastro/fichaVeiculo";

// Os campos da ficha do veículo, agrupados como se trabalha com eles.
// Servem ao cadastro de um veículo novo e à edição.

export type ValoresVeiculo = Record<string, string | number | boolean | null | undefined>;
const ent = "w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm";
const iso = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : typeof d === "string" ? d.slice(0, 10) : "");

function Campo({ rotulo, children, largo = false }: { rotulo: string; children: React.ReactNode; largo?: boolean }) {
  return (
    <label className={`block text-xs font-medium text-slate-600 ${largo ? "md:col-span-2" : ""}`}>
      {rotulo}
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-lg border border-slate-200 p-4">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{titulo}</legend>
      <div className="grid gap-3 md:grid-cols-4">{children}</div>
    </fieldset>
  );
}

export default function CamposVeiculo({ v, apolices, comValores }: { v: ValoresVeiculo; apolices: { id: string; descricao: string }[]; comValores: boolean }) {
  const t = (k: string) => (v[k] === null || v[k] === undefined ? "" : String(v[k]));
  return (
    <div className="space-y-4">
      <Bloco titulo="Identificação">
        <Campo rotulo="Placa">
          <input name="placa" defaultValue={t("placa")} placeholder="ABC1D23" className={`${ent} font-mono uppercase`} />
        </Campo>
        <Campo rotulo="Chassi">
          <input name="chassi" defaultValue={t("chassi")} className={`${ent} font-mono uppercase`} />
        </Campo>
        <Campo rotulo="RENAVAM">
          <input name="renavam" defaultValue={t("renavam")} inputMode="numeric" className={`${ent} font-mono`} />
        </Campo>
        <Campo rotulo="Prefixo (nº de frota)">
          <input name="prefixo" defaultValue={t("prefixo")} className={ent} />
        </Campo>
        <Campo rotulo="Marca">
          <input name="marca" defaultValue={t("marca")} className={ent} />
        </Campo>
        <Campo rotulo="Modelo">
          <input name="modelo" defaultValue={t("modelo")} className={ent} />
        </Campo>
        <Campo rotulo="Ano fabricação / modelo">
          <div className="flex gap-2">
            <input name="anoFab" defaultValue={t("anoFab")} inputMode="numeric" className={ent} />
            <input name="anoMod" defaultValue={t("anoMod")} inputMode="numeric" className={ent} />
          </div>
        </Campo>
        <Campo rotulo="Cor">
          <input name="cor" defaultValue={t("cor")} className={ent} />
        </Campo>
        <Campo rotulo="Tipo">
          <select name="tipo" defaultValue={t("tipo") || "van"} className={ent}>
            {TIPOS_VEICULO.map((x) => <option key={x} value={x}>{ROTULO_TIPO_VEICULO[x]}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Capacidade (lugares)">
          <input name="capacidade" defaultValue={t("capacidade")} inputMode="numeric" className={ent} />
        </Campo>
        <Campo rotulo="Elétrico">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="eletrico" value="1" defaultChecked={v.eletrico === true} /> sim</label>
        </Campo>
        <Campo rotulo="ID na Ituran">
          <input name="idIturan" defaultValue={t("idIturan")} className={ent} />
        </Campo>
      </Bloco>

      <Bloco titulo="Uso e operação">
        <Campo rotulo="Categoria de uso">
          <select name="categoriaUso" defaultValue={t("categoriaUso")} className={ent}>
            <option value="">—</option>
            {USOS_VEICULO.map((x) => <option key={x} value={x}>{ROTULO_USO[x]}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Contrato / alocação">
          <input name="alocacao" defaultValue={t("alocacao")} placeholder="ESCOLAR - SUL 01" className={ent} />
        </Campo>
        <Campo rotulo="Adaptação">
          <input name="adaptacao" defaultValue={t("adaptacao")} placeholder="LETRA G, UNIDADE MÓVEL…" className={ent} />
        </Campo>
        <Campo rotulo="Empresa proprietária">
          <input name="empresa" defaultValue={t("empresa")} placeholder="AZUL, MCZ…" className={ent} />
        </Campo>
      </Bloco>

      <Bloco titulo="Documento do veículo">
        <Campo rotulo="Categoria do registro">
          <select name="categoriaRegistro" defaultValue={t("categoriaRegistro")} className={ent}>
            <option value="">—</option>
            <option value="aluguel">aluguel</option>
            <option value="particular">particular</option>
          </select>
        </Campo>
        <Campo rotulo="CRLV (exercício)">
          <input name="crlvExercicio" defaultValue={t("crlvExercicio")} inputMode="numeric" className={ent} />
        </Campo>
        <Campo rotulo="CRV / ATPV">
          <input name="crvSituacao" defaultValue={t("crvSituacao")} placeholder="ATPV, recibo eletrônico…" className={ent} />
        </Campo>
        <Campo rotulo="Tag de pedágio">
          <select name="tagPedagio" defaultValue={v.tagPedagio === true ? "sim" : v.tagPedagio === false ? "nao" : ""} className={ent}>
            <option value="">—</option>
            <option value="sim">sim</option>
            <option value="nao">não</option>
          </select>
        </Campo>
        <Campo rotulo="Isenção de IPVA">
          <select name="ipvaSituacao" defaultValue={t("ipvaSituacao")} className={ent}>
            <option value="">—</option>
            {IPVA_SITUACOES.map((x) => <option key={x} value={x}>{ROTULO_IPVA[x]}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Início da isenção">
          <input type="date" name="ipvaIsencaoInicio" defaultValue={iso(v.ipvaIsencaoInicio)} className={ent} />
        </Campo>
        <Campo rotulo="Apólice APP / RCF">
          <select name="apoliceId" defaultValue={t("apoliceId")} className={ent}>
            <option value="">sem apólice</option>
            {apolices.map((a) => <option key={a.id} value={a.id}>{a.descricao}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Vencimento na apólice">
          <input type="date" name="apoliceVencimento" defaultValue={iso(v.apoliceVencimento)} className={ent} />
        </Campo>
      </Bloco>

      <Bloco titulo="Aquisição">
        <Campo rotulo="Data de compra">
          <input type="date" name="dataCompra" defaultValue={iso(v.dataCompra)} className={ent} />
        </Campo>
        <Campo rotulo="Nota fiscal">
          <input name="notaFiscalCompra" defaultValue={t("notaFiscalCompra")} className={ent} />
        </Campo>
        <Campo rotulo="Vendedor">
          <input name="vendedorNome" defaultValue={t("vendedorNome")} className={ent} />
        </Campo>
        {comValores && (
          <Campo rotulo="Valor de compra (R$)">
            <input name="valorCompra" defaultValue={t("valorCompra")} inputMode="decimal" className={ent} />
          </Campo>
        )}
        <Campo rotulo="Vida útil (meses)">
          <input name="vidaUtilMeses" defaultValue={t("vidaUtilMeses") || "60"} inputMode="numeric" className={ent} />
        </Campo>
      </Bloco>

      <Campo rotulo="Observações" largo>
        <textarea name="observacoes" defaultValue={t("observacoes")} rows={2} className={ent} />
      </Campo>
    </div>
  );
}
