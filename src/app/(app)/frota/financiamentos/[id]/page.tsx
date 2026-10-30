import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { contratosComSituacao } from "@/lib/frota/frotaNoBanco";
import { rateioDoContrato, ROTULO_PRODUTO, ROTULO_SITUACAO_CONSORCIO } from "@/lib/frota/financiamentos";
import { fmtBRL, fmtData, fmtNumero } from "@/lib/controladoria/format";
import { larguraPainel } from "@/lib/ui";
import { exigirPermissao, podeAcao } from "../../../_dados";
import { Kpi, Secao, Tabela } from "../../../_componentes";
import { NomeVeiculo } from "../../_frota";
import FormAcao from "../../FormAcao";
import CamposFinanciamento from "../CamposFinanciamento";
import { desvincularVeiculo, encerrarFinanciamento, salvarFinanciamento, vincularVeiculo } from "../actions";

// O CONTRATO (OU A COTA): situação, parcelas na Omie, veículos com a parte de
// cada um, edição e encerramento.

export const maxDuration = 60;
const ent = "rounded-md border border-slate-300 px-2 py-1 text-xs";
const ORIGEM: Record<string, string> = { omie: "pagamentos na Omie", informado: "informado (planilha ou extrato)", datas: "pelas datas, supondo pagamento em dia", "sem dados": "sem dados" };

export default async function ContratoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ editar?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const session = await exigirPermissao("financiamentos");
  const podeEditar = await podeAcao(session, "gerir-financiamentos");
  const hoje = new Date();
  const [c] = await contratosComSituacao(session.companyId, hoje, { ids: [id] });
  if (!c) notFound();
  const s = c.situacao;
  const fatias = rateioDoContrato(c.veiculos);
  const parcelasOmie = await prisma.frotaParcelaOmie.findMany({ where: { financiamentoId: c.id }, select: { tituloId: true, numeroParcela: true, criterio: true } });
  const titulos = parcelasOmie.length
    ? await prisma.omieTitulo.findMany({
        where: { id: { in: parcelasOmie.map((p) => p.tituloId) } },
        select: { id: true, conexaoApelido: true, numeroDocumento: true, numeroParcela: true, dataVencimento: true, valorDocumentoCents: true, valorPagoCents: true, status: true, baixas: { select: { dataBaixa: true } } },
        orderBy: { dataVencimento: "desc" },
      })
    : [];
  const criterio = new Map(parcelasOmie.map((p) => [p.tituloId, p.criterio]));
  const nome = c.contratoNumero ?? `grupo ${c.grupo ?? "?"} / cota ${c.cota ?? "?"}`;

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div>
        <Link href="/frota/financiamentos" className="text-xs text-slate-500 hover:text-slate-800">← Financiamentos e consórcios</Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">
          {c.instituicao} · <span className="font-mono">{nome}</span>
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {ROTULO_PRODUTO[c.produto] ?? c.produto}
          {c.modalidade ? ` · ${c.modalidade}` : ""}
          {c.situacaoConsorcio ? ` · ${ROTULO_SITUACAO_CONSORCIO[c.situacaoConsorcio]}${c.dataContemplacao ? ` em ${fmtData(c.dataContemplacao)}` : ""}` : ""}
          {c.garantia ? ` · ${c.garantia}` : ""}
          {!c.ativo ? ` · encerrado em ${fmtData(c.dataQuitacao)} (${c.motivoEncerramento ?? ""})` : ""}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Kpi rotulo="Parcelas pagas" valor={s.pagas !== null && c.parcelas ? `${s.pagas} de ${c.parcelas}` : "—"} apoio={ORIGEM[s.origemPagas]} />
        <Kpi rotulo="Parcela" valor={fmtBRL(Number(c.valorParcelaCents ?? 0))} apoio={c.vencimentoDia ? `todo dia ${c.vencimentoDia}` : ""} />
        <Kpi rotulo="Próximo vencimento" valor={s.proximoVencimento ? fmtData(s.proximoVencimento) : s.quitado ? "encerrado" : "—"} />
        <Kpi rotulo="Saldo para quitação" valor={fmtBRL(s.saldoCents ?? 0)} apoio={s.saldoInformadoCents !== null ? `informado ${fmtBRL(s.saldoInformadoCents)}${c.saldoInformadoEm ? ` em ${fmtData(c.saldoInformadoEm)}` : ""}` : ""} />
        <Kpi rotulo="Em atraso na Omie" valor={fmtBRL(s.atrasadas.valorCents)} tom={s.atrasadas.quantidade ? "ruim" : "bom"} apoio={`${s.atrasadas.quantidade} parcela(s)`} />
        <Kpi rotulo="Lançadas a vencer" valor={fmtNumero(s.aVencerNaOmie.quantidade)} apoio={s.naoLancadas ? `${s.naoLancadas} prevista(s) não lançada(s)` : "na Omie"} tom={s.naoLancadas ? "atencao" : "neutro"} />
      </div>

      <Secao titulo="Veículos" descricao="A parte de cada veículo na parcela e no saldo (pela parcela de cada placa; sem ela, em partes iguais).">
        <Tabela
          colunas={["Placa", "Modelo", "Alienado", "Parte", "Parcela do veículo", "Saldo do veículo", ""]}
          alinharDireita={[3, 4, 5]}
          linhas={c.veiculos.map((v) => {
            const f = fatias.get(v.veiculoId) ?? 0;
            return [
              <NomeVeiculo key="p" v={v.veiculo} />,
              v.veiculo.modelo ?? "—",
              v.alienado ? "sim" : "não",
              `${(f * 100).toFixed(1).replace(".", ",")}%`,
              fmtBRL(Math.round(Number(c.valorParcelaCents ?? 0) * f)),
              fmtBRL(Math.round((s.saldoCents ?? 0) * f)),
              podeEditar ? (
                <FormAcao key="x" acao={desvincularVeiculo} rotulo="Tirar" confirmar="Tirar este veículo do contrato?" botaoClasse="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-700">
                  <input type="hidden" name="vinculoId" value={v.id} />
                </FormAcao>
              ) : null,
            ];
          })}
          vazio={c.produto === "consorcio" ? "Cota ainda sem veículo (não contemplada ou contemplada sem o bem)." : "Nenhum veículo ligado."}
        />
        {podeEditar && (
          <FormAcao acao={vincularVeiculo} rotulo="Ligar veículo" limparAoGravar classe="mt-3 flex flex-wrap items-end gap-2 text-xs">
            <input type="hidden" name="financiamentoId" value={c.id} />
            <input name="veiculo" placeholder="Placa (ou chassi)" className={ent} />
            <input name="parcela" placeholder="Parcela deste veículo (R$)" className={ent} />
            <label className="flex items-center gap-1"><input type="checkbox" name="alienado" value="1" defaultChecked={c.produto !== "capital_giro"} /> alienado</label>
          </FormAcao>
        )}
      </Secao>

      <Secao titulo="Parcelas na Omie" descricao="Os títulos das contas a pagar ligados a este contrato. A ligação é refeita a cada conferência (pelo número do contrato, pela cota ou pelo valor e dia).">
        <Tabela
          colunas={["Vencimento", "Empresa", "Documento", "Parcela", "Valor", "Pago", "Pagamento", "Situação", "Ligado por"]}
          alinharDireita={[4, 5]}
          linhas={titulos.map((t) => {
            const pago = t.valorPagoCents >= t.valorDocumentoCents - 100 || /PAGO|LIQUID|QUITAD/i.test(t.status ?? "");
            const baixa = t.baixas.reduce<Date | null>((m, b) => (!m || b.dataBaixa > m ? b.dataBaixa : m), null);
            return [
              fmtData(t.dataVencimento),
              t.conexaoApelido,
              t.numeroDocumento ?? "—",
              t.numeroParcela ?? "—",
              fmtBRL(t.valorDocumentoCents),
              fmtBRL(t.valorPagoCents),
              baixa ? fmtData(baixa) : "—",
              pago ? <span key="s" className="text-xs text-emerald-700">pago</span> : t.dataVencimento < hoje ? <span key="s" className="text-xs font-semibold text-red-700">em atraso</span> : <span key="s" className="text-xs text-slate-600">a vencer</span>,
              criterio.get(t.id) ?? "—",
            ];
          })}
          vazio="Nenhum título da Omie ligado ainda. Confira em Financiamentos › Ligação com a Omie se o banco foi reconhecido."
        />
      </Secao>

      {podeEditar && (
        <Secao titulo={sp.editar ? "Editar o contrato" : "Dados do contrato"} acao={!sp.editar ? <Link href={`/frota/financiamentos/${c.id}?editar=1`} className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">Editar</Link> : <Link href={`/frota/financiamentos/${c.id}`} className="text-xs text-slate-500">Cancelar</Link>}>
          {sp.editar ? (
            <FormAcao acao={salvarFinanciamento} rotulo="Salvar o contrato" irPara={`/frota/financiamentos/${c.id}`}>
              <input type="hidden" name="id" value={c.id} />
              <CamposFinanciamento v={c as unknown as Record<string, unknown>} />
            </FormAcao>
          ) : (
            <dl className="grid gap-x-6 gap-y-2 text-sm md:grid-cols-4">
              {[
                ["Valor financiado / crédito", c.valorFinanciadoCents !== null ? fmtBRL(Number(c.valorFinanciadoCents)) : null],
                ["Valor dos bens", c.valorBensCents !== null ? fmtBRL(Number(c.valorBensCents)) : null],
                ["Entrada", c.entradaCents !== null ? fmtBRL(Number(c.entradaCents)) : null],
                ["Creditado / líquido", c.valorCreditadoCents !== null ? fmtBRL(Number(c.valorCreditadoCents)) : null],
                ["Lance", c.lanceCents !== null ? fmtBRL(Number(c.lanceCents)) : null],
                ["Lance planejado", c.lancePlanejadoPct !== null ? `${String(c.lancePlanejadoPct).replace(".", ",")}%` : null],
                ["Taxa", c.taxaPct !== null ? `${String(c.taxaPct).replace(".", ",")}%${c.produto === "consorcio" ? " (administração)" : " a.m."}` : null],
                ["Início", c.dataInicio ? fmtData(c.dataInicio) : null],
                ["Término", c.dataFinal ? fmtData(c.dataFinal) : null],
                ["Célula de crédito", c.celulaCredito],
                ["Empresa que paga", c.empresa],
                ["Origem", c.origem?.startsWith("planilha:") ? "migração da planilha" : c.origem],
                ["Observações", c.observacoes],
              ]
                .filter(([, x]) => x)
                .map(([r, x]) => (
                  <div key={String(r)}>
                    <dt className="text-xs text-slate-500">{r}</dt>
                    <dd className="text-slate-800">{x}</dd>
                  </div>
                ))}
            </dl>
          )}
          {c.ativo && !sp.editar && (
            <FormAcao acao={encerrarFinanciamento} rotulo="Encerrar contrato" confirmar="Encerrar este contrato? Os veículos deixam de estar alienados a ele." classe="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3 text-xs" botaoClasse="rounded-md border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50">
              <input type="hidden" name="id" value={c.id} />
              <input type="date" name="data" defaultValue={hoje.toISOString().slice(0, 10)} className={ent} />
              <input name="motivo" placeholder="Motivo (quitado, quitação antecipada, transferido…)" className={`${ent} min-w-72`} />
            </FormAcao>
          )}
        </Secao>
      )}
    </div>
  );
}
