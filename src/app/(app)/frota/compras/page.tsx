import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { FORMAS_PAGAMENTO, ROTULO_FORMA, situacaoDaCompra, type SituacaoCompra } from "@/lib/frota/compras";
import { ROTULO_TIPO_VEICULO, ROTULO_USO, TIPOS_VEICULO, USOS_VEICULO } from "@/lib/cadastro/fichaVeiculo";
import { fmtBRL, fmtData, fmtNumero } from "@/lib/controladoria/format";
import { larguraPainel } from "@/lib/ui";
import { exigirPermissao, podeAcao } from "../../_dados";
import { Kpi, Secao, Tabela } from "../../_componentes";
import FormAcao from "../FormAcao";
import { pedirCompra } from "./actions";
import { SeloCompra } from "./_compras";

// COMPRAS DE VEÍCULOS — os pedidos, da aprovação da Diretoria ao
// recebimento de cada veículo.

const ent = "rounded-md border border-slate-300 px-2 py-1.5 text-sm";
export default async function ComprasPage({ searchParams }: { searchParams: Promise<{ novo?: string }> }) {
  const sp = await searchParams;
  const session = await exigirPermissao("frota");
  const [podePedir, veValores] = await Promise.all([podeAcao(session, "gerir-frota"), podeAcao(session, "frota-valores")]);
  const compras = await prisma.frotaCompra.findMany({ where: { companyId: session.companyId }, include: { _count: { select: { veiculos: true } } }, orderBy: { criadoEm: "desc" }, take: 200 });
  const pendencias = new Map(
    (await prisma.audPendencia.findMany({ where: { id: { in: compras.map((c) => c.pendenciaId).filter((x): x is string => !!x) } }, select: { id: true, status: true, comentario: true } })).map((p) => [p.id, p])
  );
  const linhas = compras.map((c) => ({ c, s: situacaoDaCompra(c, c.pendenciaId ? (pendencias.get(c.pendenciaId) ?? null) : null) }));
  const conta = (s: SituacaoCompra) => linhas.filter((l) => l.s === s).length;
  const aReceber = linhas.filter((l) => l.s === "aprovada").reduce((s, l) => s + l.c.quantidade - l.c._count.veiculos, 0);

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/frota" className="text-xs text-slate-500 hover:text-slate-800">← Frota</Link>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">Compras de veículos</h1>
          <p className="mt-1 max-w-4xl text-sm text-slate-500">
            Pedido → aprovação da Diretoria (quem pede não aprova) → recebimento: o veículo entra no cadastro com a nota fiscal das contas a pagar da Omie, os documentos exigidos e o checklist de inclusão (apólice, tag, rastreador).
          </p>
        </div>
        {podePedir && !sp.novo && (
          <Link href="/frota/compras?novo=1" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-700">Novo pedido</Link>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Kpi rotulo="Aguardando a Diretoria" valor={fmtNumero(conta("solicitada"))} tom={conta("solicitada") ? "atencao" : "neutro"} />
        <Kpi rotulo="Aprovados, a receber" valor={fmtNumero(aReceber)} apoio="veículos" />
        <Kpi rotulo="Concluídos" valor={fmtNumero(conta("concluida"))} />
        <Kpi rotulo="Rejeitados ou cancelados" valor={fmtNumero(conta("rejeitada") + conta("cancelada"))} />
      </div>

      {podePedir && sp.novo && (
        <Secao titulo="Novo pedido de compra" descricao="Vai para a Diretoria aprovar. Fornecedor com CNPJ ajuda a achar a nota na Omie no recebimento.">
          <FormAcao acao={pedirCompra} rotulo="Enviar para aprovação" irPara="/frota/compras/{id}" classe="grid gap-3 text-xs md:grid-cols-4">
            <label className="flex flex-col gap-1">Tipo
              <select name="tipo" defaultValue="van" className={ent}>{TIPOS_VEICULO.map((t) => <option key={t} value={t}>{ROTULO_TIPO_VEICULO[t]}</option>)}</select>
            </label>
            <label className="flex flex-col gap-1">Marca<input name="marca" placeholder="Renault" className={ent} /></label>
            <label className="flex flex-col gap-1">Modelo<input name="modelo" placeholder="Master Executive" className={ent} /></label>
            <label className="flex flex-col gap-1">Ano-modelo<input name="anoMod" inputMode="numeric" className={ent} /></label>
            <label className="flex flex-col gap-1">Lugares<input name="capacidade" inputMode="numeric" className={ent} /></label>
            <label className="flex flex-col gap-1">Uso
              <select name="categoriaUso" defaultValue="" className={ent}><option value="">—</option>{USOS_VEICULO.map((u) => <option key={u} value={u}>{ROTULO_USO[u]}</option>)}</select>
            </label>
            <label className="flex flex-col gap-1">Quantidade<input name="quantidade" defaultValue="1" inputMode="numeric" className={ent} /></label>
            {veValores ? <label className="flex flex-col gap-1">Valor unitário estimado (R$)<input name="valorUnitario" inputMode="decimal" className={ent} /></label> : <span />}
            <label className="flex flex-col gap-1">Forma de pagamento
              <select name="formaPagamento" defaultValue="financiamento" className={ent}>{FORMAS_PAGAMENTO.map((f) => <option key={f.chave} value={f.chave}>{f.rotulo}</option>)}</select>
            </label>
            <label className="flex flex-col gap-1">Banco / administradora<input name="instituicao" placeholder="se financiado ou consórcio" className={ent} /></label>
            <label className="flex flex-col gap-1">Fornecedor<input name="fornecedorNome" placeholder="concessionária / montadora" className={ent} /></label>
            <label className="flex flex-col gap-1">CNPJ do fornecedor<input name="fornecedorDocumento" className={ent} /></label>
            <label className="flex flex-col gap-1 md:col-span-2">Para onde vão<input name="destino" placeholder="contrato ou linha, ou renovação da frota" className={ent} /></label>
            <label className="flex flex-col gap-1 md:col-span-2">Por que comprar<input name="justificativa" placeholder="contrato novo, substituição de veículo com 7 anos…" className={ent} /></label>
          </FormAcao>
        </Secao>
      )}

      <Secao titulo="Pedidos">
        <Tabela
          colunas={["Pedido em", "Veículo", "Qtd.", "Recebidos", "Pagamento", ...(veValores ? ["Valor estimado"] : []), "Pediu", "Situação"]}
          alinharDireita={veValores ? [2, 3, 5] : [2, 3]}
          linhas={linhas.map(({ c, s }) => [
            fmtData(c.criadoEm),
            <Link key="v" href={`/frota/compras/${c.id}`} className="text-blue-800 hover:underline">
              {[ROTULO_TIPO_VEICULO[c.tipo] ?? c.tipo, c.marca, c.modelo, c.anoMod].filter(Boolean).join(" ")}
            </Link>,
            fmtNumero(c.quantidade),
            fmtNumero(c._count.veiculos),
            `${ROTULO_FORMA[c.formaPagamento] ?? c.formaPagamento}${c.instituicao ? ` · ${c.instituicao}` : ""}`,
            ...(veValores ? [c.valorUnitarioCents !== null ? fmtBRL(Number(c.valorUnitarioCents) * c.quantidade) : "—"] : []),
            c.solicitadoPor,
            <SeloCompra key="s" s={s} />,
          ])}
          vazio="Nenhum pedido de compra ainda."
        />
      </Secao>
    </div>
  );
}
