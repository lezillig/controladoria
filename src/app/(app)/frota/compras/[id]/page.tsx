import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { notasDoFornecedor, ROTULO_FORMA, situacaoDaCompra } from "@/lib/frota/compras";
import { ROTULO_STATUS_VEICULO, ROTULO_TIPO_VEICULO, ROTULO_USO } from "@/lib/cadastro/fichaVeiculo";
import { fmtBRL, fmtData, fmtNumero } from "@/lib/controladoria/format";
import { larguraPainel } from "@/lib/ui";
import { exigirPermissao, podeAcao } from "../../../_dados";
import { Secao, Tabela } from "../../../_componentes";
import FormAcao from "../../FormAcao";
import { NomeVeiculo, SeloStatus } from "../../_frota";
import { cancelarCompra, receberVeiculo } from "../actions";
import { SeloCompra } from "../_compras";

// O PEDIDO DE COMPRA: a decisão da Diretoria, os veículos que já chegaram e
// o recebimento do próximo (com a nota fiscal puxada da Omie).

export const maxDuration = 60;
const ent = "rounded-md border border-slate-300 px-2 py-1.5 text-sm";

export default async function CompraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await exigirPermissao("frota");
  const [podeEditar, veValores] = await Promise.all([podeAcao(session, "gerir-frota"), podeAcao(session, "frota-valores")]);
  const c = await prisma.frotaCompra.findFirst({ where: { id, companyId: session.companyId }, include: { veiculos: { orderBy: { criadoEm: "asc" } } } });
  if (!c) notFound();
  const pendencia = c.pendenciaId ? await prisma.audPendencia.findUnique({ where: { id: c.pendenciaId }, select: { status: true, decididaPor: true, decididaEm: true, comentario: true } }) : null;
  const s = situacaoDaCompra(c, pendencia);
  const faltam = c.quantidade - c.veiculos.length;
  const notas = podeEditar && s === "aprovada" ? await notasDoFornecedor(session.companyId, c) : [];
  const nome = [ROTULO_TIPO_VEICULO[c.tipo] ?? c.tipo, c.marca, c.modelo, c.anoMod].filter(Boolean).join(" ");

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div>
        <Link href="/frota/compras" className="text-xs text-slate-500 hover:text-slate-800">← Compras de veículos</Link>
        <h1 className="mt-1 flex flex-wrap items-center gap-2 text-xl font-semibold text-slate-900">
          {fmtNumero(c.quantidade)} × {nome} <SeloCompra s={s} />
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {ROTULO_FORMA[c.formaPagamento] ?? c.formaPagamento}
          {c.instituicao ? ` · ${c.instituicao}` : ""}
          {c.fornecedorNome ? ` · fornecedor ${c.fornecedorNome}` : ""}
          {c.capacidade ? ` · ${c.capacidade} lugares` : ""}
          {c.categoriaUso ? ` · ${ROTULO_USO[c.categoriaUso] ?? c.categoriaUso}` : ""}
          {c.destino ? ` · para ${c.destino}` : ""}
          {veValores && c.valorUnitarioCents !== null ? ` · ${fmtBRL(Number(c.valorUnitarioCents))} cada` : ""}
        </p>
      </div>

      <Secao titulo="Decisão">
        <dl className="grid gap-x-6 gap-y-2 text-sm md:grid-cols-3">
          <div><dt className="text-xs text-slate-500">Pedido</dt><dd>{c.solicitadoPor} em {fmtData(c.criadoEm)}</dd></div>
          <div><dt className="text-xs text-slate-500">Por quê</dt><dd>{c.justificativa}</dd></div>
          <div>
            <dt className="text-xs text-slate-500">Diretoria</dt>
            <dd>
              {pendencia?.status === "aguardando_aprovacao" ? (
                <Link href="/pendencias" className="text-blue-800 hover:underline">aguardando decisão em Pendências</Link>
              ) : pendencia?.decididaPor ? (
                `${pendencia.status === "rejeitada" ? "rejeitado" : "aprovado"} por ${pendencia.decididaPor} em ${fmtData(pendencia.decididaEm)}${pendencia.comentario ? ` — ${pendencia.comentario}` : ""}`
              ) : (
                "—"
              )}
            </dd>
          </div>
        </dl>
      </Secao>

      <Secao titulo={`Veículos recebidos (${c.veiculos.length} de ${c.quantidade})`}>
        <Tabela
          colunas={["Placa / chassi", "Situação", "NF", "Data", ...(veValores ? ["Valor"] : []), "Vendedor"]}
          alinharDireita={veValores ? [4] : []}
          linhas={c.veiculos.map((v) => [
            <NomeVeiculo key="p" v={v} />,
            <SeloStatus key="s" status={v.status} rotulo={ROTULO_STATUS_VEICULO[v.status] ?? v.status} />,
            v.notaFiscalCompra ?? "—",
            fmtData(v.dataCompra),
            ...(veValores ? [v.valorCompraCents !== null ? fmtBRL(Number(v.valorCompraCents)) : "—"] : []),
            v.vendedorNome ?? "—",
          ])}
          vazio="Nenhum veículo recebido ainda."
        />
      </Secao>

      {podeEditar && s === "aprovada" && faltam > 0 && (
        <Secao titulo="Receber veículo" descricao="O veículo entra em reserva, com os documentos exigidos pela categoria como pendentes; abre o checklist de inclusão para a Operação e, se financiado ou por consórcio, a ligação ao contrato para o Financeiro.">
          <FormAcao acao={receberVeiculo} rotulo="Receber" irPara="/frota/{id}" classe="grid gap-3 text-xs md:grid-cols-4">
            <input type="hidden" name="compraId" value={c.id} />
            <label className="flex flex-col gap-1">Chassi<input name="chassi" className={ent} /></label>
            <label className="flex flex-col gap-1">Placa (se já emplacado)<input name="placa" className={ent} /></label>
            <label className="flex flex-col gap-1">Cor<input name="cor" className={ent} /></label>
            <label className="flex flex-col gap-1">Ano de fabricação<input name="anoFab" inputMode="numeric" className={ent} /></label>
            <label className="flex flex-col gap-1 md:col-span-4">
              Nota fiscal nas contas a pagar da Omie {notas.length === 0 && <span className="font-normal text-slate-400">(nenhuma do fornecedor desde 60 dias antes do pedido — digite abaixo)</span>}
              <select name="nota" defaultValue="" className={ent}>
                <option value="">— digitar a nota —</option>
                {notas.map((n) => (
                  <option key={n.chave} value={n.chave}>
                    NF {n.numeroDocumento} · {n.parceiroNome ?? "?"} · {n.dataEmissao ? fmtData(n.dataEmissao) : "sem emissão"}
                    {veValores ? ` · ${fmtBRL(n.valorCents)}` : ""}
                    {n.parcelas > 1 ? ` (${n.parcelas} parcelas)` : ""} · {n.conexaoApelido}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">Número da NF (se digitada)<input name="nfNumero" className={ent} /></label>
            <label className="flex flex-col gap-1">Data da NF<input type="date" name="nfData" className={ent} /></label>
            {veValores && <label className="flex flex-col gap-1">Valor da NF (R$)<input name="nfValor" inputMode="decimal" className={ent} /></label>}
          </FormAcao>
        </Secao>
      )}

      {podeEditar && (s === "solicitada" || s === "aprovada") && (
        <Secao titulo={c.veiculos.length ? "Encerrar o pedido" : "Cancelar o pedido"}>
          <FormAcao acao={cancelarCompra} rotulo={c.veiculos.length ? "Encerrar com o que chegou" : "Cancelar o pedido"} confirmar="Confirma?" classe="flex flex-wrap items-end gap-2 text-xs" botaoClasse="rounded-md border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50">
            <input type="hidden" name="id" value={c.id} />
            <input name="motivo" placeholder="Motivo" className={`${ent} min-w-72`} />
          </FormAcao>
        </Secao>
      )}
    </div>
  );
}
