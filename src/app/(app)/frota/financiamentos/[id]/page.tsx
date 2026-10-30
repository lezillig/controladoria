import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { contratosComSituacao } from "@/lib/frota/contratosDaGestao";
import { rateioDoContrato, ROTULO_PRODUTO, ROTULO_SITUACAO_CONSORCIO } from "@/lib/frota/financiamentos";
import { linkDaGestao } from "@/lib/gestao/endereco";
import { fmtBRL, fmtData, fmtNumero } from "@/lib/controladoria/format";
import { larguraPainel } from "@/lib/ui";
import { exigirPermissao } from "../../../_dados";
import { Kpi, Secao, Tabela } from "../../../_componentes";

// O CONTRATO (OU A COTA) conferido na Omie: situação, parcelas ligadas e a
// parte de cada veículo. Os dados do contrato são os da gestão — corrigir é
// lá (o link leva ao cadastro).

export const maxDuration = 60;
const ORIGEM: Record<string, string> = { omie: "pagamentos na Omie", informado: "posição informada na gestão", datas: "pelas datas, supondo pagamento em dia", "sem dados": "sem dados" };

export default async function ContratoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await exigirPermissao("financiamentos");
  const hoje = new Date();
  const {
    contratos: [c],
  } = await contratosComSituacao(session.companyId, hoje, { ids: [id] });
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
  const cadastro = linkDaGestao(`/cadastros/veiculos/financiamentos?situacao=todos&banco=${encodeURIComponent(c.instituicao)}`);

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div>
        <Link href="/frota/financiamentos" className="text-xs text-slate-500 hover:text-slate-800">← Financiamentos e consórcios</Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">
          {c.instituicao} · <span className="font-mono">{nome}</span>
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {ROTULO_PRODUTO[c.produto] ?? c.produto}
          {c.situacaoConsorcio ? ` · ${ROTULO_SITUACAO_CONSORCIO[c.situacaoConsorcio]}${c.dataContemplacao ? ` em ${fmtData(c.dataContemplacao)}` : ""}` : ""}
          {c.situacaoBanco ? ` · no banco: ${c.situacaoBanco}` : ""}
          {!c.ativo ? " · quitado na gestão" : ""}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Os dados do contrato vêm da gestão{c.saldoInformadoEm ? ` (posição de ${fmtData(c.saldoInformadoEm)})` : ""}.{" "}
          {cadastro ? (
            <a href={cadastro} className="font-semibold text-blue-800 underline">
              Corrigir no cadastro da gestão
            </a>
          ) : (
            "Para corrigir: gestão › Cadastros › Veículos › Financiamentos."
          )}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        {/* Os cartões abrem nas parcelas da Omie e na parte de cada veículo, logo abaixo. */}
        <Kpi href="#parcelas-omie" rotulo="Parcelas pagas" valor={s.pagas !== null && c.parcelas ? `${s.pagas} de ${c.parcelas}` : "—"} apoio={ORIGEM[s.origemPagas]} />
        <Kpi href="#veiculos" rotulo="Parcela" valor={fmtBRL(Number(c.valorParcelaCents ?? 0))} apoio={c.vencimentoDia ? `todo dia ${c.vencimentoDia}` : ""} />
        <Kpi href="#parcelas-omie" rotulo="Próximo vencimento" valor={s.proximoVencimento ? fmtData(s.proximoVencimento) : s.quitado ? "encerrado" : "—"} />
        <Kpi href="#veiculos" rotulo="Saldo para quitação" valor={fmtBRL(s.saldoCents ?? 0)} apoio={s.saldoInformadoCents !== null ? `informado ${fmtBRL(s.saldoInformadoCents)}${c.saldoInformadoEm ? ` em ${fmtData(c.saldoInformadoEm)}` : ""}` : ""} />
        <Kpi href="#parcelas-omie" rotulo="Em atraso na Omie" valor={fmtBRL(s.atrasadas.valorCents)} tom={s.atrasadas.quantidade ? "ruim" : "bom"} apoio={`${s.atrasadas.quantidade} parcela(s)`} />
        <Kpi href="#parcelas-omie" rotulo="Lançadas a vencer" valor={fmtNumero(s.aVencerNaOmie.quantidade)} apoio={s.naoLancadas ? `${s.naoLancadas} prevista(s) não lançada(s)` : "na Omie"} tom={s.naoLancadas ? "atencao" : "neutro"} />
      </div>

      <Secao id="veiculos" titulo="Veículos" descricao="A parte de cada veículo na parcela e no saldo (pela parcela de cada placa na gestão; sem ela, em partes iguais).">
        <Tabela
          colunas={["Placa", "Modelo", "Parte", "Parcela do veículo", "Saldo do veículo"]}
          alinharDireita={[2, 3, 4]}
          linhas={c.veiculos.map((v) => {
            const f = fatias.get(v.veiculoId) ?? 0;
            return [
              <span key="p" className="font-mono text-xs">{v.veiculo.placa}</span>,
              v.veiculo.modelo ?? "—",
              `${(f * 100).toFixed(1).replace(".", ",")}%`,
              fmtBRL(Math.round(Number(c.valorParcelaCents ?? 0) * f)),
              fmtBRL(Math.round((s.saldoCents ?? 0) * f)),
            ];
          })}
          vazio={c.produto === "consorcio" ? "Cota ainda sem veículo (não contemplada ou contemplada sem o bem)." : "Nenhum veículo ligado na gestão."}
        />
      </Secao>

      <Secao id="parcelas-omie" titulo="Parcelas na Omie" descricao="Os títulos das contas a pagar ligados a este contrato. A ligação é refeita a cada conferência (pelo número do contrato, pela cota ou pelo valor e dia).">
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

      <Secao titulo="Dados do contrato (da gestão)">
        <dl className="grid gap-x-6 gap-y-2 text-sm md:grid-cols-4">
          {[
            ["Valor financiado / crédito", c.valorFinanciadoCents !== null ? fmtBRL(c.valorFinanciadoCents) : null],
            ["Taxa", c.taxaPct !== null ? `${String(c.taxaPct).replace(".", ",")}%${c.produto === "consorcio" ? " (administração)" : " a.m."}` : null],
            ["Parcelas", c.parcelas !== null ? fmtNumero(c.parcelas) : null],
            ["Primeira parcela (estimada)", c.dataInicio ? fmtData(c.dataInicio) : null],
            ["Término", c.dataFinal ? fmtData(c.dataFinal) : null],
            ["Pagas na posição informada", c.parcelasPagas !== null ? fmtNumero(c.parcelasPagas) : null],
          ]
            .filter(([, x]) => x)
            .map(([r, x]) => (
              <div key={String(r)}>
                <dt className="text-xs text-slate-500">{r}</dt>
                <dd className="text-slate-800">{x}</dd>
              </div>
            ))}
        </dl>
      </Secao>
    </div>
  );
}
