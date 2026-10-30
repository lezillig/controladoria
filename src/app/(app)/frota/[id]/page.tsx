import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { contratosComSituacao } from "@/lib/frota/frotaNoBanco";
import { coberturaDeApolice } from "@/lib/frota/controles";
import { alertaDoDocumento, ROTULO_SITUACAO_DOCUMENTO, SITUACOES_DOCUMENTO, TIPOS_DOCUMENTO } from "@/lib/frota/documentos";
import { rateioDoContrato, ROTULO_PRODUTO, ROTULO_SITUACAO_CONSORCIO } from "@/lib/frota/financiamentos";
import { investimentoDoVeiculo, ROTULO_IPVA, ROTULO_STATUS_VEICULO, ROTULO_TIPO_VEICULO, ROTULO_USO } from "@/lib/cadastro/fichaVeiculo";
import { fmtBRL, fmtData } from "@/lib/controladoria/format";
import { larguraPainel } from "@/lib/ui";
import { exigirPermissao, podeAcao } from "../../_dados";
import { Kpi, Secao, Tabela } from "../../_componentes";
import { NomeVeiculo, SeloAlerta, SeloCobertura, SeloStatus } from "../_frota";
import FormAcao from "../FormAcao";
import CamposVeiculo from "../CamposVeiculo";
import { registrarConsulta, salvarAdaptacao, salvarDocumento, salvarValorAjustado, salvarVeiculo, solicitarSaida } from "../actions";

// A FICHA DO VEÍCULO — tudo de um veículo numa página: dados, documentos,
// apólice, financiamentos (com o saldo dele em cada contrato), adaptações e
// valor, consultas de placa e o histórico de mudanças.

export const maxDuration = 60;

const ABAS = [
  { chave: "resumo", rotulo: "Resumo" },
  { chave: "documentos", rotulo: "Documentos" },
  { chave: "financiamentos", rotulo: "Financiamentos" },
  { chave: "valor", rotulo: "Valor e adaptações" },
  { chave: "consultas", rotulo: "Consultas de placa" },
  { chave: "historico", rotulo: "Histórico" },
] as const;
const ent = "rounded-md border border-slate-300 px-2 py-1 text-xs";
const dataIso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

export default async function FichaVeiculoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ aba?: string; editar?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const session = await exigirPermissao("frota");
  const [podeEditar, veValores, podeVender, veFinanciamentos] = await Promise.all([
    podeAcao(session, "gerir-frota"),
    podeAcao(session, "frota-valores"),
    podeAcao(session, "vender-veiculo"),
    podeAcao(session, "financiamentos"),
  ]);
  const hoje = new Date();
  const v = await prisma.cadVeiculo.findFirst({
    where: { id, companyId: session.companyId },
    include: { documentos: true, apolice: true, adaptacoes: { orderBy: { data: "desc" } }, consultas: { orderBy: { consultadoEm: "desc" }, take: 50 }, centrosCusto: { select: { codigo: true } } },
  });
  if (!v) notFound();
  const aba = ABAS.find((a) => a.chave === sp.aba)?.chave ?? "resumo";
  const [contratos, apolices, historico, saidaPendente] = await Promise.all([
    contratosComSituacao(session.companyId, hoje, { veiculoId: v.id }),
    prisma.frotaApolice.findMany({ where: { companyId: session.companyId, ativo: true }, select: { id: true, descricao: true }, orderBy: { descricao: "asc" } }),
    aba === "historico" ? prisma.audLog.findMany({ where: { companyId: session.companyId, registroId: { in: [v.id, ...v.documentos.map((d) => d.id)] } }, orderBy: { dataHora: "desc" }, take: 100 }) : Promise.resolve([]),
    prisma.audPendencia.findFirst({ where: { companyId: session.companyId, chaveExcecao: `saida-veiculo:${v.id}`, status: "aguardando_aprovacao" }, select: { titulo: true } }),
  ]);
  const cobertura = coberturaDeApolice(v, v.apolice, hoje);
  const docs = v.documentos.map((d) => ({ ...d, alerta: alertaDoDocumento(d, hoje) }));
  const vencidos = docs.filter((d) => d.alerta === "vencido");
  const ativos = contratos.filter((c) => !c.situacao.quitado);
  const minhaParte = (c: (typeof contratos)[number]) => rateioDoContrato(c.veiculos).get(v.id) ?? 0;
  const saldo = ativos.reduce((s, c) => s + Math.round((c.situacao.saldoCents ?? 0) * minhaParte(c)), 0);
  const parcelaMensal = ativos.reduce((s, c) => s + Math.round(Number(c.valorParcelaCents ?? 0) * minhaParte(c)), 0);
  const alienado = ativos.some((c) => c.veiculos.find((x) => x.veiculoId === v.id)?.alienado);
  const adaptacoesCents = v.adaptacoes.reduce((s, a) => s + Number(a.valorCents), 0);
  const inv = investimentoDoVeiculo(v, adaptacoesCents, hoje);
  const forado = v.status === "vendido" || v.status === "baixado";
  const href = (a: string) => `/frota/${v.id}?aba=${a}`;

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/frota" className="text-xs text-slate-500 hover:text-slate-800">← Frota</Link>
          <h1 className="mt-1 flex flex-wrap items-baseline gap-3 text-xl font-semibold text-slate-900">
            <NomeVeiculo v={v} link={false} />
            <span className="text-base font-normal text-slate-600">{[v.marca, v.modelo].filter(Boolean).join(" ")}{v.anoFab ? ` · ${v.anoFab}${v.anoMod && v.anoMod !== v.anoFab ? `/${v.anoMod}` : ""}` : ""}</span>
            <SeloStatus status={v.status} rotulo={ROTULO_STATUS_VEICULO[v.status] ?? v.status} />
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {ROTULO_TIPO_VEICULO[v.tipo] ?? v.tipo}{v.capacidade ? ` · ${v.capacidade} lugares` : ""}{v.categoriaUso ? ` · ${ROTULO_USO[v.categoriaUso] ?? v.categoriaUso}` : ""}{v.alocacao ? ` · ${v.alocacao}` : ""}{v.prefixo ? ` · prefixo ${v.prefixo}` : ""}
          </p>
          {saidaPendente && <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900">{saidaPendente.titulo} aguardando aprovação da Diretoria em <Link href="/pendencias" className="underline">Pendências</Link>.</p>}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi rotulo="Documentos" valor={vencidos.length ? `${vencidos.length} vencido(s)` : docs.some((d) => d.alerta === "7" || d.alerta === "30") ? "vencendo" : "em dia"} tom={vencidos.length ? "ruim" : docs.some((d) => d.alerta === "7" || d.alerta === "30") ? "atencao" : "bom"} apoio={`${docs.filter((d) => d.situacao !== "nao_se_aplica").length} controlado(s)`} />
        <Kpi rotulo="Apólice" valor={v.apolice ? v.apolice.descricao.split(" - ")[0] : "sem apólice"} tom={["coberto"].includes(cobertura) ? "bom" : cobertura === "nao_se_aplica" ? "neutro" : "ruim"} apoio={`vence ${fmtData(v.apoliceVencimento ?? v.apolice?.vigenciaFim ?? null)}`} />
        <Kpi rotulo="Financiamento" valor={ativos.length ? `${ativos.length} contrato(s)` : "livre"} apoio={alienado ? "alienado" : ativos.length ? "não alienado" : "sem contrato ativo"} tom={alienado ? "atencao" : "neutro"} />
        {veValores && <Kpi rotulo="Saldo devedor" valor={fmtBRL(saldo)} apoio={parcelaMensal ? `${fmtBRL(parcelaMensal)}/mês` : "—"} />}
        {veValores && <Kpi rotulo="Valor de mercado" valor={inv.mercadoCents !== null ? fmtBRL(inv.mercadoCents) : "—"} apoio={inv.fonteMercado ? `${inv.fonteMercado}${inv.mercadoCents !== null ? ` · líquido ${fmtBRL(inv.mercadoCents - saldo)}` : ""}` : "sem FIPE nem ajustado"} tom={inv.mercadoCents !== null && inv.mercadoCents < saldo ? "ruim" : "neutro"} />}
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-slate-200 pb-2">
        {ABAS.filter((a) => (a.chave === "valor" ? veValores : a.chave === "financiamentos" ? veFinanciamentos || veValores : true)).map((a) => (
          <Link key={a.chave} href={href(a.chave)} className={`rounded-full px-3 py-1 text-xs font-medium ${a.chave === aba ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            {a.rotulo}
            {a.chave === "documentos" && vencidos.length ? <span className="ml-1 rounded bg-red-600 px-1 text-white">{vencidos.length}</span> : null}
          </Link>
        ))}
      </div>

      {aba === "resumo" && (
        <>
          {sp.editar && podeEditar ? (
            <Secao titulo="Editar a ficha" acao={<Link href={href("resumo")} className="text-xs text-slate-500">Cancelar</Link>}>
              <FormAcao acao={salvarVeiculo} rotulo="Salvar a ficha" irPara={`/frota/${v.id}`}>
                <input type="hidden" name="id" value={v.id} />
                <CamposVeiculo v={{ ...v, valorCompra: v.valorCompraCents !== null ? (Number(v.valorCompraCents) / 100).toFixed(2).replace(".", ",") : "" } as never} apolices={apolices} comValores={veValores} />
              </FormAcao>
            </Secao>
          ) : (
            <Secao titulo="Dados do veículo" acao={podeEditar ? <Link href={`${href("resumo")}&editar=1`} className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">Editar</Link> : undefined}>
              <dl className="grid gap-x-6 gap-y-2 text-sm md:grid-cols-3">
                {[
                  ["Chassi", v.chassi],
                  ["RENAVAM", v.renavam],
                  ["Cor", v.cor],
                  ["Adaptação", v.adaptacao],
                  ["Categoria do registro", v.categoriaRegistro],
                  ["Empresa", v.empresa],
                  ["CRLV (exercício)", v.crlvExercicio],
                  ["CRV / ATPV", v.crvSituacao],
                  ["Isenção de IPVA", v.ipvaSituacao ? `${ROTULO_IPVA[v.ipvaSituacao]}${v.ipvaIsencaoInicio ? ` desde ${fmtData(v.ipvaIsencaoInicio)}` : ""}` : null],
                  ["Tag de pedágio", v.tagPedagio === null ? null : v.tagPedagio ? "sim" : "não"],
                  ["Apólice", v.apolice ? <span key="a" className="flex items-center gap-2">{v.apolice.descricao} <SeloCobertura cobertura={cobertura} /></span> : <SeloCobertura key="a" cobertura={cobertura} />],
                  ["Compra", v.dataCompra ? `${fmtData(v.dataCompra)}${v.notaFiscalCompra ? ` · NF ${v.notaFiscalCompra}` : ""}${v.vendedorNome ? ` · ${v.vendedorNome}` : ""}` : null],
                  ["Centro de custo", v.centrosCusto.map((c) => c.codigo).join(", ")],
                  ["Venda", v.dataVenda ? `${fmtData(v.dataVenda)}${v.compradorNome ? ` · ${v.compradorNome}` : ""}${v.transferenciaSituacao ? ` · transferência: ${v.transferenciaSituacao}` : ""}` : null],
                  ["Baixa", v.dataBaixa ? `${fmtData(v.dataBaixa)} · ${v.motivoBaixa ?? ""}` : null],
                  ["Observações", v.observacoes],
                ]
                  .filter(([, x]) => x !== null && x !== undefined && x !== "")
                  .map(([r, x]) => (
                    <div key={String(r)}>
                      <dt className="text-xs text-slate-500">{r}</dt>
                      <dd className="text-slate-800">{x as React.ReactNode}</dd>
                    </div>
                  ))}
              </dl>
            </Secao>
          )}
          {podeVender && !forado && !saidaPendente && (
            <Secao titulo="Venda ou baixa" descricao="Registrar aqui manda para a Diretoria aprovar. Aprovado, o veículo sai da frota (sem ser apagado), os contratos são resolvidos e abre o checklist de saída: apólice, tag, rastreador e comunicação de venda.">
              <FormAcao acao={solicitarSaida} rotulo="Enviar para aprovação" confirmar="Enviar a saída deste veículo para aprovação da Diretoria?" classe="grid gap-2 text-xs md:grid-cols-6">
                <input type="hidden" name="veiculoId" value={v.id} />
                <select name="acao" className={ent} defaultValue="vender">
                  <option value="vender">venda</option>
                  <option value="baixar">baixa (perda total, sucata, roubo)</option>
                </select>
                <input type="date" name="data" className={ent} required />
                <input name="comprador" placeholder="Comprador (venda)" className={ent} />
                {veValores && <input name="valor" placeholder="Valor de venda (R$)" inputMode="decimal" className={ent} />}
                <input name="transferencia" placeholder="Transferência (ex.: ATPV assinada)" className={ent} />
                <input name="motivo" placeholder="Motivo (baixa)" className={ent} />
                {alienado && (
                  <select name="contratos" className={`${ent} md:col-span-2`} defaultValue="">
                    <option value="">Veículo alienado: o que acontece com o contrato?</option>
                    <option value="quitar">o contrato será quitado na venda</option>
                    <option value="transferir">o contrato será transferido / o veículo trocado na garantia</option>
                  </select>
                )}
              </FormAcao>
            </Secao>
          )}
        </>
      )}

      {aba === "documentos" && (
        <Secao titulo="Documentos e licenças" descricao="Um por tipo. Para renovar, troque a validade e grave — a anterior fica no histórico.">
          <div className="space-y-2">
            {TIPOS_DOCUMENTO.map((t) => {
              const d = docs.find((x) => x.tipo === t.chave);
              return (
                <div key={t.chave} className="rounded-md border border-slate-200 p-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="w-48 font-medium text-slate-800">{t.rotulo}</span>
                    {d ? <SeloAlerta alerta={d.alerta} /> : <span className="text-xs text-slate-400">não informado</span>}
                    {d?.validade && <span className="text-xs text-slate-600">validade {fmtData(d.validade)}</span>}
                    {d?.numero && <span className="text-xs text-slate-600">nº {d.numero}</span>}
                    {d?.observacao && <span className="text-xs text-slate-500">· {d.observacao}</span>}
                    {d?.atualizadoPor && <span className="text-[11px] text-slate-400">· {d.atualizadoPor} em {fmtData(d.atualizadoEm)}</span>}
                  </div>
                  {podeEditar && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-blue-800">Atualizar / renovar</summary>
                      <FormAcao acao={salvarDocumento} rotulo="Gravar" classe="mt-2 flex flex-wrap items-end gap-2 text-xs">
                        <input type="hidden" name="veiculoId" value={v.id} />
                        <input type="hidden" name="tipo" value={t.chave} />
                        <select name="situacao" defaultValue={d?.situacao ?? "vigente"} className={ent}>
                          {SITUACOES_DOCUMENTO.map((s) => <option key={s} value={s}>{ROTULO_SITUACAO_DOCUMENTO[s]}</option>)}
                        </select>
                        <input type="date" name="validade" defaultValue={dataIso(d?.validade ?? null)} className={ent} />
                        {t.temNumero && <input name="numero" defaultValue={d?.numero ?? ""} placeholder="Número" className={ent} />}
                        <input name="observacao" defaultValue={d?.observacao ?? ""} placeholder="Observação" className={`${ent} min-w-56`} />
                      </FormAcao>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        </Secao>
      )}

      {aba === "financiamentos" && (
        <Secao titulo="Contratos e cotas deste veículo" descricao="A parte do veículo em cada contrato (pela parcela de cada placa). Parcelas pagas e saldo atualizados pelos pagamentos na Omie.">
          <Tabela
            colunas={["Banco / administradora", "Produto", "Contrato / cota", "Pagas", "Próxima", "Parcela (parte do veículo)", "Saldo (parte do veículo)", "Situação"]}
            alinharDireita={[5, 6]}
            linhas={contratos.map((c) => {
              const f = minhaParte(c);
              return [
                <Link key="i" href={`/frota/financiamentos/${c.id}`} className="text-blue-800 hover:underline">{c.instituicao}</Link>,
                `${ROTULO_PRODUTO[c.produto] ?? c.produto}${c.situacaoConsorcio ? ` · ${ROTULO_SITUACAO_CONSORCIO[c.situacaoConsorcio]}` : ""}`,
                c.contratoNumero ?? `${c.grupo ?? "?"}/${c.cota ?? "?"}`,
                c.situacao.pagas !== null && c.parcelas ? `${c.situacao.pagas}/${c.parcelas} (${c.situacao.origemPagas})` : "—",
                c.situacao.proximoVencimento ? fmtData(c.situacao.proximoVencimento) : "—",
                veValores ? fmtBRL(Math.round(Number(c.valorParcelaCents ?? 0) * f)) : "—",
                veValores ? fmtBRL(Math.round((c.situacao.saldoCents ?? 0) * f)) : "—",
                c.situacao.quitado ? <span key="s" className="text-xs text-slate-400">encerrado</span> : c.situacao.atrasadas.quantidade ? <span key="s" className="text-xs font-semibold text-red-700">{c.situacao.atrasadas.quantidade} em atraso</span> : <span key="s" className="text-xs text-emerald-700">em dia</span>,
              ];
            })}
            vazio="Nenhum contrato ligado a este veículo."
          />
        </Secao>
      )}

      {aba === "valor" && veValores && (
        <>
          <Secao titulo="Investimento e valor de mercado" descricao="Investimento = compra + adaptações; a depreciação é linear pela vida útil. O valor de mercado é o preço ajustado, quando informado, ou a Tabela FIPE.">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Kpi rotulo="Compra" valor={v.valorCompraCents !== null ? fmtBRL(Number(v.valorCompraCents)) : "—"} apoio={v.dataCompra ? fmtData(v.dataCompra) : ""} />
              <Kpi rotulo="Adaptações" valor={fmtBRL(adaptacoesCents)} apoio={`${v.adaptacoes.length} lançamento(s)`} />
              <Kpi rotulo="Residual contábil" valor={inv.residualContabilCents !== null ? fmtBRL(inv.residualContabilCents) : "—"} apoio={inv.depreciacaoMensalCents ? `depreciação ${fmtBRL(inv.depreciacaoMensalCents)}/mês · ${v.vidaUtilMeses} meses` : ""} />
              <Kpi rotulo="FIPE" valor={v.fipeValorCents !== null ? fmtBRL(Number(v.fipeValorCents)) : "—"} apoio={v.fipeModelo ? `${v.fipeModelo} · ${v.fipeReferencia ?? ""}` : "ainda não consultada"} />
              <Kpi rotulo="Preço ajustado" valor={v.valorAjustadoCents !== null ? fmtBRL(Number(v.valorAjustadoCents)) : "—"} apoio={v.valorAjustadoMotivo ?? ""} />
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <FormAcao acao={salvarValorAjustado} rotulo="Gravar preço ajustado" classe="space-y-2 rounded-md border border-slate-200 p-3 text-xs">
                <p className="font-semibold text-slate-700">Preço ajustado (quando a FIPE não tem o modelo certo)</p>
                <input type="hidden" name="veiculoId" value={v.id} />
                <input name="valor" placeholder="Valor (R$) — vazio apaga" inputMode="decimal" className={`${ent} w-full`} />
                <input name="motivo" placeholder="Motivo (ex.: Volare com carroceria escolar)" className={`${ent} w-full`} />
              </FormAcao>
              <div className="rounded-md border border-slate-200 p-3 text-xs text-slate-600">
                <p className="font-semibold text-slate-700">Tabela FIPE</p>
                <p className="mt-1">
                  <Link href={`/frota/${v.id}/fipe`} className="font-semibold text-blue-800 underline">Escolher o modelo na FIPE</Link> — uma vez; depois o valor atualiza todo mês.
                </p>
              </div>
            </div>
          </Secao>
          <Secao titulo="Adaptações" descricao="Acessibilidade, unidade móvel, carroceria, acessórios — o que se gastou depois da compra.">
            <Tabela
              colunas={["Data", "Tipo", "Descrição", "Fornecedor", "NF", "Valor"]}
              alinharDireita={[5]}
              linhas={v.adaptacoes.map((a) => [a.data ? fmtData(a.data) : "—", a.tipo, a.descricao, a.fornecedorNome ?? "—", a.notaFiscal ?? "—", fmtBRL(Number(a.valorCents))])}
              vazio="Nenhuma adaptação lançada."
            />
            {podeEditar && (
              <FormAcao acao={salvarAdaptacao} rotulo="Lançar adaptação" limparAoGravar classe="mt-3 grid gap-2 text-xs md:grid-cols-7">
                <input type="hidden" name="veiculoId" value={v.id} />
                <select name="tipo" className={ent}>
                  <option value="acessibilidade">acessibilidade</option>
                  <option value="unidade_movel">unidade móvel</option>
                  <option value="carroceria">carroceria</option>
                  <option value="escolar">escolar</option>
                  <option value="acessorio">acessório</option>
                  <option value="outro">outro</option>
                </select>
                <input name="descricao" placeholder="Descrição" className={`${ent} md:col-span-2`} />
                <input type="date" name="data" className={ent} />
                <input name="fornecedorNome" placeholder="Fornecedor" className={ent} />
                <input name="notaFiscal" placeholder="NF" className={ent} />
                <input name="valor" placeholder="Valor (R$)" inputMode="decimal" className={ent} />
              </FormAcao>
            )}
          </Secao>
        </>
      )}

      {aba === "consultas" && (
        <Secao titulo="Consultas de placa" descricao="Débitos e multas no LW, na Fazenda, no Detran. Multa encontrada vai para o controle de multas.">
          <Tabela colunas={["Data", "Fonte", "Resultado", "Registrado por"]} linhas={v.consultas.map((c) => [fmtData(c.consultadoEm), c.fonte, c.resultado ?? "—", c.registradoPor ?? "—"])} vazio="Nenhuma consulta registrada." />
          {podeEditar && (
            <FormAcao acao={registrarConsulta} rotulo="Registrar consulta" limparAoGravar classe="mt-3 grid gap-2 text-xs md:grid-cols-5">
              <input type="hidden" name="veiculoId" value={v.id} />
              <select name="fonte" className={ent}>
                <option value="LW">LW</option>
                <option value="Fazenda">Fazenda</option>
                <option value="Detran">Detran</option>
                <option value="outra">outra</option>
              </select>
              <input type="date" name="data" defaultValue={dataIso(hoje)} className={ent} />
              <input name="resultado" placeholder="Resultado (ex.: nada consta; 1 multa)" className={`${ent} md:col-span-3`} />
            </FormAcao>
          )}
        </Secao>
      )}

      {aba === "historico" && (
        <Secao titulo="Histórico de mudanças" descricao="A trilha de auditoria: quem mudou o quê, quando, com o antes e o depois.">
          <Tabela
            colunas={["Quando", "Quem", "O quê", "Antes", "Depois"]}
            linhas={historico.map((h) => [
              fmtData(h.dataHora),
              h.usuario ?? h.agente ?? "—",
              `${h.tabela} · ${h.operacao}`,
              <code key="a" className="text-[11px] text-slate-500">{h.antes ? JSON.stringify(h.antes).slice(0, 160) : "—"}</code>,
              <code key="d" className="text-[11px] text-slate-700">{h.depois ? JSON.stringify(h.depois).slice(0, 220) : "—"}</code>,
            ])}
            vazio="Sem mudanças registradas."
          />
        </Secao>
      )}
    </div>
  );
}
