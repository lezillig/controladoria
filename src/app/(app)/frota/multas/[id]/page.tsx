import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { passosAbertos, prazoDeIndicacao, ROTULO_RESPONSAVEL } from "@/lib/frota/multas";
import { fmtBRL, fmtData } from "@/lib/controladoria/format";
import { larguraPainel } from "@/lib/ui";
import { exigirPermissao, podeAcao } from "../../../_dados";
import { Secao, Tabela } from "../../../_componentes";
import FormAcao from "../../FormAcao";
import { tratarMulta } from "../actions";
import { SeloPasso, SeloPrazo } from "../_multas";
import { checklistDeFechamento, valorDoDesconto } from "@/lib/frota/fechamentoMultas";
import { titulosDeMultaSemMulta } from "@/lib/frota/fechamentoMultasNoBanco";
import { decidirSemDesconto } from "../actions";

// A FICHA DA MULTA: os dados do auto e o processo, passo a passo — cada
// passo mostra o que já foi feito e, para quem trata multas, o formulário.

export const maxDuration = 60;
const ent = "rounded-md border border-slate-300 px-2 py-1 text-xs";
const dataIso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

function Passo({ n, titulo, feito, children, form }: { n: number; titulo: string; feito: ReactNode; children?: ReactNode; form?: ReactNode }) {
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="flex flex-wrap items-baseline gap-2 text-sm">
        <span className="text-xs font-semibold text-slate-400">{n}.</span>
        <span className="font-semibold text-slate-800">{titulo}</span>
        <span className="text-slate-700">{feito}</span>
      </div>
      {children}
      {form && (
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-blue-800">Registrar</summary>
          <div className="mt-2">{form}</div>
        </details>
      )}
    </div>
  );
}

export default async function MultaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await exigirPermissao("multas");
  const [podeEditar, veMotorista, podeRh] = await Promise.all([podeAcao(session, "gerir-multas"), podeAcao(session, "motoristas-documentos"), podeAcao(session, "gerir-motoristas")]);
  const hoje = new Date();
  const m = await prisma.frotaMulta.findFirst({
    where: { id, companyId: session.companyId },
    include: { condutor: { select: { id: true, nome: true } }, veiculo: { select: { id: true, placa: true, modelo: true, alocacao: true } }, nicDe: { select: { id: true, ait: true } }, nics: { select: { id: true, ait: true, valorCents: true } } },
  });
  if (!m) notFound();
  const [sugerido, pessoas, titulo, historico, pendencias] = await Promise.all([
    m.sugeridoPessoaId ? prisma.cadPessoa.findUnique({ where: { id: m.sugeridoPessoaId }, select: { id: true, nome: true } }) : null,
    podeEditar ? prisma.cadPessoa.findMany({ where: { companyId: session.companyId, cargo: { in: ["motorista", "monitor"] } }, select: { id: true, nome: true, ativo: true }, orderBy: [{ ativo: "desc" }, { nome: "asc" }] }) : [],
    m.tituloOmieId ? prisma.omieTitulo.findUnique({ where: { id: m.tituloOmieId }, select: { numeroDocumento: true, conexaoApelido: true, dataVencimento: true, valorPagoCents: true, liquidado: true } }) : null,
    prisma.audLog.findMany({ where: { companyId: session.companyId, registroId: m.id }, orderBy: { dataHora: "desc" }, take: 40 }),
    prisma.audPendencia.findMany({ where: { companyId: session.companyId, chaveExcecao: { in: [`desconto-multa:${m.id}`, `multa-indicacao:${m.id}`, `multa-termo-recusado:${m.id}`] } }, select: { tipo: true, status: true, decididaPor: true, comentario: true } }),
  ]);
  const passos = passosAbertos(m);
  const fechamento = checklistDeFechamento({ ...m, temNic: m.nics.length > 0 });
  // Para ligar o pagamento: os títulos de multa da Omie ainda sem multa.
  const titulosLivres = podeEditar && !m.tituloOmieId ? await titulosDeMultaSemMulta(session.companyId, new Date(m.dataInfracao.getTime() - 30 * 86_400_000)) : [];
  const prazo = prazoDeIndicacao(m, hoje);
  const form = (passo: string, campos: ReactNode, rotulo = "Gravar") =>
    podeEditar ? (
      <FormAcao acao={tratarMulta} rotulo={rotulo} classe="flex flex-wrap items-end gap-2 text-xs">
        <input type="hidden" name="multaId" value={m.id} />
        <input type="hidden" name="passo" value={passo} />
        {campos}
      </FormAcao>
    ) : undefined;
  const condutor = m.condutor ? (veMotorista ? <Link href={`/motoristas/${m.condutor.id}`} className="text-blue-800 hover:underline">{m.condutor.nome}</Link> : m.condutor.nome) : m.condutorNome ? `${m.condutorNome} (sem cadastro — escolha a pessoa)` : m.condutorNaoLocalizado ? "não localizado" : "não identificado";
  const desconto = pendencias.find((p) => p.tipo === "desconto-multa");

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div>
        <Link href="/frota/multas" className="text-xs text-slate-500 hover:text-slate-800">← Multas</Link>
        <h1 className="mt-1 flex flex-wrap items-center gap-2 text-xl font-semibold text-slate-900">
          <span className="font-mono">AIT {m.ait}</span>
          {m.situacao === "aberta" ? <SeloPasso passo={passos[0]} /> : <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">{m.situacao}</span>}
          <SeloPrazo situacao={prazo.situacao} dias={prazo.dias} />
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {m.especificacao} · {m.orgao} · {fmtData(m.dataInfracao)} às {new Date(m.dataInfracao.getTime() - 3 * 3_600_000).toISOString().slice(11, 16)} · {fmtBRL(m.valorCents)}
          {m.pontos !== null ? ` · ${m.pontos} ponto(s)` : " · pontos não lançados"}
        </p>
        <p className="text-sm text-slate-500">
          {m.veiculo ? <Link href={`/frota/${m.veiculo.id}`} className="font-mono text-blue-800 hover:underline">{m.placa}</Link> : <span className="font-mono">{m.placa}</span>}
          {m.veiculo?.modelo ? ` · ${m.veiculo.modelo}` : ""}
          {m.veiculo?.alocacao ? ` · ${m.veiculo.alocacao}` : ""}
          {!m.veiculo ? " · placa fora do cadastro da frota" : ""}
          {m.incluidaEm ? ` · achada em ${fmtData(m.incluidaEm)}` : ""}
          {m.ehNic && m.nicDe ? <> · NIC da multa <Link href={`/frota/multas/${m.nicDe.id}`} className="font-mono text-blue-800 hover:underline">{m.nicDe.ait}</Link></> : ""}
        </p>
        {m.nics.length > 0 && <p className="mt-1 text-sm font-semibold text-red-700">Gerou NIC: {m.nics.map((n) => `${n.ait} (${fmtBRL(n.valorCents)})`).join(", ")}</p>}
        {m.observacao && <p className="mt-1 text-xs text-slate-500">{m.observacao}</p>}
      </div>

      <Secao titulo={`Fechamento: ${fechamento.filter((i) => i.ok !== false).length} de 4`} descricao="A multa só fecha com os quatro resolvidos — pagamento conferido na Omie e desconto conferido na folha. O agente finaliza sozinho.">
        <div className="grid gap-2 sm:grid-cols-4">
          {fechamento.map((i) => (
            <div key={i.chave} className={`rounded-md border p-2 text-xs ${i.ok === false ? "border-red-200 bg-red-50 text-red-800" : i.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
              <p className="font-semibold">{i.ok === false ? "✗" : i.ok ? "✓" : "—"} {i.rotulo}</p>
              <p>{i.detalhe}</p>
            </div>
          ))}
        </div>
      </Secao>

      <Secao titulo="O processo">
        <div className="space-y-2">
          <Passo
            n={1}
            titulo="Quem dirigia"
            feito={<>{condutor}{m.condutorFonte ? <span className="text-xs text-slate-500"> · pela {m.condutorFonte}</span> : null}</>}
            form={form(
              "condutor",
              <>
                <select name="pessoaId" defaultValue={m.condutorPessoaId ?? m.sugeridoPessoaId ?? ""} className={`${ent} min-w-64`}>
                  <option value="">— escolha —</option>
                  {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}{p.ativo ? "" : " (inativo)"}</option>)}
                </select>
                <select name="fonte" defaultValue={m.sugeridoPessoaId && !m.condutorPessoaId ? (m.sugeridoFonte ?? "manual") : "manual"} className={ent}>
                  <option value="escala">pela escala</option>
                  <option value="uso">pelo uso do veículo</option>
                  <option value="diario">pelo diário de bordo</option>
                  <option value="manual">informado</option>
                </select>
                <label className="flex items-center gap-1"><input type="checkbox" name="naoLocalizado" value="1" /> não localizado</label>
              </>
            )}
          >
            {sugerido && !m.condutorPessoaId && <p className="mt-1 text-xs text-slate-600">Sugestão do sistema: <strong>{sugerido.nome}</strong>, pela {m.sugeridoFonte === "uso" ? "retirada do veículo registrada na gestão" : "escala do dia"}. Confira e confirme.</p>}
          </Passo>

          {!m.condutorPessoaId && !m.condutorNome && !m.ehNic && (
            <Passo
              n={2}
              titulo="Diário de bordo"
              feito={m.diarioRecebidoEm ? `recebido em ${fmtData(m.diarioRecebidoEm)}` : m.diarioSolicitadoEm ? `pedido em ${fmtData(m.diarioSolicitadoEm)}, aguardando` : "não pedido (só quando a escala e o uso não dizem quem dirigia)"}
              form={form(
                "diario",
                <>
                  <label className="flex flex-col gap-0.5">Pedido em<input type="date" name="solicitadoEm" defaultValue={dataIso(m.diarioSolicitadoEm ?? hoje)} className={ent} /></label>
                  <label className="flex flex-col gap-0.5">Recebido em<input type="date" name="recebidoEm" defaultValue={dataIso(m.diarioRecebidoEm)} className={ent} /></label>
                </>
              )}
            />
          )}

          <Passo
            n={3}
            titulo="Quem paga"
            feito={ROTULO_RESPONSAVEL[m.responsavel] ?? m.responsavel}
            form={form(
              "responsavel",
              <select name="responsavel" defaultValue={m.responsavel} className={ent}>
                <option value="a_definir">a definir</option>
                <option value="motorista">o motorista (com termo)</option>
                <option value="empresa">a empresa assume</option>
              </select>
            )}
          >
            {m.responsavel === "empresa" && !m.ehNic && (m.pontos ?? 1) > 0 && !m.indicadoEm && <p className="mt-1 text-xs text-amber-700">A empresa assumir não dispensa indicar o condutor: sem a indicação, o órgão cobra a NIC.</p>}
          </Passo>

          {m.responsavel === "motorista" && (
            <Passo
              n={4}
              titulo="Termo do motorista"
              feito={m.termoAssinadoEm ? `assinado em ${fmtData(m.termoAssinadoEm)}` : m.termoRecusado ? "recusou assinar" : "a colher"}
              form={form(
                "termo",
                <>
                  <label className="flex flex-col gap-0.5">Assinado em<input type="date" name="assinadoEm" defaultValue={dataIso(m.termoAssinadoEm)} className={ent} /></label>
                  <label className="flex items-center gap-1"><input type="checkbox" name="recusou" value="1" /> recusou assinar</label>
                </>
              )}
            />
          )}

          {!m.ehNic && (
            <Passo
              n={5}
              titulo="Indicação do condutor ao órgão"
              feito={<>{m.indicadoEm ? `enviada em ${fmtData(m.indicadoEm)}` : "não enviada"}{m.prazoIndicacao ? <span className="text-xs text-slate-500"> · prazo {fmtData(m.prazoIndicacao)}</span> : null}</>}
              form={form(
                "indicacao",
                <>
                  <label className="flex flex-col gap-0.5">Enviada em<input type="date" name="indicadoEm" defaultValue={dataIso(m.indicadoEm)} className={ent} /></label>
                  <label className="flex flex-col gap-0.5">Prazo<input type="date" name="prazoIndicacao" defaultValue={dataIso(m.prazoIndicacao)} className={ent} /></label>
                </>
              )}
            />
          )}

          <Passo
            n={6}
            titulo="Pagamento"
            feito={
              <>
                {m.pagoEm ? `pago em ${fmtData(m.pagoEm)}${m.valorPagoCents !== null ? ` · ${fmtBRL(m.valorPagoCents)}${m.valorPagoCents < m.valorCents ? ` (desconto de ${fmtBRL(m.valorCents - m.valorPagoCents)})` : m.valorPagoCents > m.valorCents ? ` (${fmtBRL(m.valorPagoCents - m.valorCents)} de juros/atraso)` : ""}` : ""}` : "não pago"}
                {m.vencimentoBoleto ? <span className="text-xs text-slate-500"> · boleto vence {fmtData(m.vencimentoBoleto)}</span> : null}
                {titulo ? <span className="text-xs text-slate-500"> · Omie {titulo.conexaoApelido} doc. {titulo.numeroDocumento}{titulo.liquidado ? " (liquidado)" : " (em aberto)"}</span> : null}
              </>
            }
            form={form(
              "pagamento",
              <>
                <label className="flex flex-col gap-0.5">Boleto vence<input type="date" name="vencimentoBoleto" defaultValue={dataIso(m.vencimentoBoleto)} className={ent} /></label>
                <label className="flex flex-col gap-0.5">Pago em<input type="date" name="pagoEm" defaultValue={dataIso(m.pagoEm)} className={ent} /></label>
                <label className="flex flex-col gap-0.5">Valor pago (R$)<input name="valorPago" defaultValue={m.valorPagoCents !== null ? (m.valorPagoCents / 100).toFixed(2).replace(".", ",") : ""} inputMode="decimal" className={`${ent} w-28`} /></label>
              </>
            )}
          >
            {!m.tituloOmieId && <p className="mt-1 text-xs text-slate-500">O agente procura o pagamento nas contas a pagar da Omie pelo número do AIT (no documento ou na observação do título). Sem o AIT no título, ligue abaixo. Pagando sem recorrer, o SNE dá 40% de desconto (20% pagando até o vencimento).</p>}
            {podeEditar && (
              <div className="mt-2">
                {form(
                  "titulo",
                  <select name="tituloId" defaultValue={m.tituloOmieId ?? ""} className={`${ent} min-w-96`}>
                    <option value="">{m.tituloOmieId ? "— desligar o título —" : "— ligar a um título de multa da Omie —"}</option>
                    {titulosLivres.map((t) => (
                      <option key={t.id} value={t.id}>
                        {fmtData(t.dataVencimento)} · {t.conexaoApelido} · doc. {t.numeroDocumento ?? "—"} · {t.parceiroNome ?? ""} · {fmtBRL(t.valorDocumentoCents)}
                      </option>
                    ))}
                  </select>,
                  m.tituloOmieId ? "Desligar" : "Ligar"
                )}
              </div>
            )}
          </Passo>

          {m.responsavel === "motorista" && (
            <Passo
              n={7}
              titulo="Desconto em folha"
              feito={
                m.semDesconto
                  ? `sem desconto — ${m.semDescontoMotivo ?? ""}`
                  : m.descontoCompetencia
                    ? `${fmtBRL(valorDoDesconto(m))} na folha de ${m.descontoCompetencia.toISOString().slice(5, 7)}/${m.descontoCompetencia.getUTCFullYear()}${m.descontoEnviadoEm ? ` · mandado à Contabilidade em ${fmtData(m.descontoEnviadoEm)}` : " · ainda não mandado à Contabilidade"}${m.descontoConferidoEm ? ` · conferido na folha (${fmtBRL(m.descontoConferidoValorCents ?? 0)})` : " · não conferido na folha"}`
                    : desconto
                      ? `pendência do RH: ${desconto.status === "aguardando_aprovacao" ? "aguardando" : desconto.status}${desconto.comentario ? ` — ${desconto.comentario}` : ""}`
                      : m.termoAssinadoEm
                        ? "o agente abre a pendência para o RH"
                        : "depende do termo assinado (CLT, art. 462, §1º)"
              }
            >
              {m.descontoCompetencia && <Link href={`/frota/multas/folha?competencia=${m.descontoCompetencia.toISOString().slice(0, 7)}`} className="mt-1 inline-block text-xs text-blue-800 hover:underline">Ver a competência em Desconto em folha</Link>}
              {podeRh && (
                <FormAcao acao={decidirSemDesconto} rotulo={m.semDesconto ? "Voltar a descontar" : "Não descontar"} classe="mt-2 flex flex-wrap items-end gap-2 text-xs" botaoClasse="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                  <input type="hidden" name="multaId" value={m.id} />
                  <input type="hidden" name="semDesconto" value={m.semDesconto ? "0" : "1"} />
                  {!m.semDesconto && <input name="motivo" placeholder="Motivo (desligado sem saldo, recurso, acordo…)" className={`${ent} min-w-72`} />}
                </FormAcao>
              )}
            </Passo>
          )}

          <Passo
            n={8}
            titulo="Situação"
            feito={m.situacao}
            form={form(
              "situacao",
              <>
                <select name="situacao" defaultValue={m.situacao} className={ent}>
                  <option value="aberta">aberta</option>
                  <option value="finalizada">finalizada</option>
                  <option value="cancelada">cancelada (recurso deferido, AIT anulado)</option>
                </select>
                <input name="motivo" placeholder="Motivo / observação" className={`${ent} min-w-64`} />
              </>
            )}
          />

          <Passo
            n={9}
            titulo="De quem é a infração"
            feito={m.responsabilidadeInfracao === "proprietario" ? "do proprietário (documentação, equipamento, peso): não se indica nem se desconta" : "do condutor"}
            form={form(
              "responsabilidade",
              <select name="responsabilidadeInfracao" defaultValue={m.responsabilidadeInfracao} className={ent}>
                <option value="condutor">do condutor</option>
                <option value="proprietario">do proprietário (CTB, art. 257, §2º)</option>
              </select>
            )}
          />

          <Passo
            n={10}
            titulo="Recurso"
            feito={m.recursoFase ? `${{ defesa_previa: "defesa prévia", jari: "JARI", cetran: "CETRAN" }[m.recursoFase] ?? m.recursoFase}${m.recursoProtocoladoEm ? ` protocolado em ${fmtData(m.recursoProtocoladoEm)}` : ""} · ${m.recursoResultado ?? "pendente"}` : "sem recurso"}
            form={form(
              "recurso",
              <>
                <select name="recursoFase" defaultValue={m.recursoFase ?? ""} className={ent}>
                  <option value="">sem recurso</option>
                  <option value="defesa_previa">defesa prévia (da autuação)</option>
                  <option value="jari">JARI (1ª instância)</option>
                  <option value="cetran">CETRAN (2ª instância)</option>
                </select>
                <label className="flex flex-col gap-0.5">Protocolado em<input type="date" name="recursoProtocoladoEm" defaultValue={dataIso(m.recursoProtocoladoEm)} className={ent} /></label>
                <select name="recursoResultado" defaultValue={m.recursoResultado ?? "pendente"} className={ent}>
                  <option value="pendente">pendente</option>
                  <option value="deferido">deferido (anula a multa)</option>
                  <option value="indeferido">indeferido</option>
                </select>
              </>
            )}
          />

          <Passo
            n={11}
            titulo="Pontos"
            feito={m.pontos !== null ? `${m.pontos}` : "não lançados"}
            form={form("pontos", <input name="pontos" defaultValue={m.pontos ?? ""} inputMode="numeric" placeholder="Pontos" className={`${ent} w-24`} />)}
          />
        </div>
      </Secao>

      <Secao titulo="Histórico">
        <Tabela
          colunas={["Quando", "Quem", "Mudança"]}
          linhas={historico.map((h) => [fmtData(h.dataHora), h.usuario ?? h.agente ?? "—", <span key="m" className="font-mono text-[11px] text-slate-600">{JSON.stringify(h.depois ?? h.antes ?? {}).slice(0, 200)}</span>])}
          vazio="Nenhuma alteração registrada."
        />
      </Secao>
    </div>
  );
}
