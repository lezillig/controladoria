import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { alertaDoDocumentoPessoa, documentosExigidos, ROTULO_SITUACAO_DOCUMENTO_PESSOA, SITUACOES_DOCUMENTO_PESSOA, TIPOS_DOCUMENTO_PESSOA } from "@/lib/pessoas/documentos";
import { diasDeFerias, periodosDeFerias } from "@/lib/pessoas/ferias";
import { listarMotoristas } from "@/lib/pessoas/pessoasNoBanco";
import { fmtData } from "@/lib/controladoria/format";
import { larguraPainel } from "@/lib/ui";
import { exigirPermissao, podeAcao } from "../../_dados";
import { Secao, Tabela } from "../../_componentes";
import { SeloAlerta } from "../../frota/_frota";
import FormAcao from "../../frota/FormAcao";
import { excluirFeriasPessoa, salvarDocumentoPessoa, salvarFeriasPessoa, salvarPerfilMotorista } from "../actions";
import { SeloAptidao, SeloPeriodo } from "../_motoristas";

// A FICHA DO MOTORISTA — documentos com validade, férias (períodos e
// lançamentos) e o histórico. Só para quem vê os documentos (RH, Diretoria);
// lança quem tem "gerir-motoristas".

export const maxDuration = 60;
const ent = "rounded-md border border-slate-300 px-2 py-1 text-xs";
const dataIso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

export default async function FichaMotoristaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await exigirPermissao("motoristas-documentos");
  const [podeEditar, veMultas] = await Promise.all([podeAcao(session, "gerir-motoristas"), podeAcao(session, "multas")]);
  const hoje = new Date();
  const { linhas, controleDesde } = await listarMotoristas(session.companyId, hoje, { ids: [id], comInativos: true });
  const p = linhas[0];
  if (!p) notFound();
  const exigidos = documentosExigidos(p);
  const periodos = periodosDeFerias(p.dataAdmissao, p.ferias, hoje, controleDesde).reverse();
  const historico = await prisma.audLog.findMany({ where: { companyId: session.companyId, registroId: { in: [p.id, ...p.documentos.map((d) => d.id), ...p.ferias.map((f) => f.id)] } }, orderBy: { dataHora: "desc" }, take: 60 });

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div>
        <Link href="/motoristas" className="text-xs text-slate-500 hover:text-slate-800">← Motoristas</Link>
        <h1 className="mt-1 flex flex-wrap items-center gap-2 text-xl font-semibold text-slate-900">
          {p.nome} <SeloAptidao situacao={p.aptidao.situacao} />
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {p.cargo === "monitor" ? "Monitor(a)" : "Motorista"}
          {p.transportaEscolar ? " · transporte escolar" : ""} · admissão {p.dataAdmissao ? fmtData(p.dataAdmissao) : "não cadastrada"}
          {!p.ativo ? " · inativo" : ""}
        </p>
        {(p.aptidao.bloqueios.length > 0 || p.aptidao.faltando.length > 0 || p.aptidao.avisos.length > 0) && (
          <ul className="mt-2 space-y-0.5 text-sm">
            {p.aptidao.bloqueios.map((b) => <li key={b} className="text-red-700">• {b}</li>)}
            {p.aptidao.faltando.length > 0 && <li className="text-amber-700">• lançar: {p.aptidao.faltando.join(", ")}</li>}
            {p.aptidao.avisos.map((a) => <li key={a} className="text-amber-700">• {a}</li>)}
          </ul>
        )}
      </div>

      {podeEditar && (
        <Secao titulo="Dados do RH">
          <FormAcao acao={salvarPerfilMotorista} rotulo="Gravar" classe="flex flex-wrap items-end gap-3 text-xs">
            <input type="hidden" name="pessoaId" value={p.id} />
            <label className="flex items-center gap-1.5">
              <input type="checkbox" name="escolar" value="1" defaultChecked={p.transportaEscolar} /> Dirige no transporte escolar (exige curso escolar e certidão de antecedentes)
            </label>
            <label className="flex flex-col gap-0.5">
              Admissão
              <input type="date" name="admissao" defaultValue={dataIso(p.dataAdmissao)} className={ent} />
            </label>
          </FormAcao>
        </Secao>
      )}

      <Secao titulo="Documentos" descricao="Um por tipo; para renovar, troque a validade e grave (a anterior fica no histórico). O número do documento não é guardado — só o que o controle usa.">
        <div className="space-y-2">
          {TIPOS_DOCUMENTO_PESSOA.map((t) => {
            const d = p.documentos.find((x) => x.tipo === t.chave);
            const exigido = exigidos.includes(t.chave);
            return (
              <div key={t.chave} className="rounded-md border border-slate-200 p-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="w-80 font-medium text-slate-800">
                    {t.rotulo} {exigido && <span className="text-[11px] font-normal text-slate-500">· exigido</span>}
                  </span>
                  {d ? <SeloAlerta alerta={alertaDoDocumentoPessoa(d, hoje)} texto={d.situacao === "pendente" ? "pendente" : undefined} /> : <span className={`text-xs ${exigido ? "font-semibold text-amber-700" : "text-slate-400"}`}>não lançado</span>}
                  {d?.validade && <span className="text-xs text-slate-600">validade {fmtData(d.validade)}</span>}
                  {t.chave === "cnh" && d && <span className="text-xs text-slate-600">categoria {d.categoria ?? "—"} · EAR {d.ear === true ? "sim" : d.ear === false ? "não" : "—"}</span>}
                  {d?.observacao && <span className="text-xs text-slate-500">· {d.observacao}</span>}
                  {d?.atualizadoPor && <span className="text-[11px] text-slate-400">· {d.atualizadoPor} em {fmtData(d.atualizadoEm)}</span>}
                </div>
                {podeEditar && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-blue-800">{d ? "Atualizar / renovar" : "Lançar"}</summary>
                    <FormAcao acao={salvarDocumentoPessoa} rotulo="Gravar" classe="mt-2 flex flex-wrap items-end gap-2 text-xs">
                      <input type="hidden" name="pessoaId" value={p.id} />
                      <input type="hidden" name="tipo" value={t.chave} />
                      <select name="situacao" defaultValue={d?.situacao ?? "vigente"} className={ent}>
                        {SITUACOES_DOCUMENTO_PESSOA.map((s) => <option key={s} value={s}>{ROTULO_SITUACAO_DOCUMENTO_PESSOA[s]}</option>)}
                      </select>
                      <input type="date" name="validade" defaultValue={dataIso(d?.validade ?? null)} className={ent} />
                      {t.chave === "cnh" && (
                        <>
                          <input name="categoria" defaultValue={d?.categoria ?? ""} placeholder="Categoria (D, AE…)" className={`${ent} w-32`} />
                          <select name="ear" defaultValue={d?.ear === true ? "sim" : d?.ear === false ? "nao" : ""} className={ent}>
                            <option value="">EAR?</option>
                            <option value="sim">com EAR</option>
                            <option value="nao">sem EAR</option>
                          </select>
                        </>
                      )}
                      <input name="observacao" defaultValue={d?.observacao ?? ""} placeholder="Observação" className={`${ent} min-w-56`} />
                    </FormAcao>
                    {t.ajuda && <p className="mt-1 text-[11px] text-slate-400">{t.ajuda}</p>}
                  </details>
                )}
              </div>
            );
          })}
        </div>
      </Secao>

      <Secao
        titulo="Férias — períodos"
        descricao={`Cada 12 meses desde a admissão dão 30 dias, a gozar nos 12 meses seguintes; o que passar do fim do concessivo é pago em dobro (art. 137 da CLT). ${controleDesde ? `Controle a partir de ${fmtData(controleDesde)}.` : ""}`}
      >
        <Tabela
          colunas={["Período", "Aquisitivo", "Concessivo até", "Gozados", "Saldo", "Em dobro", "Começar até", "Situação"]}
          alinharDireita={[3, 4, 5]}
          linhas={periodos.map((x) => [
            `${x.numero}º`,
            `${fmtData(x.aquisitivoInicio)} a ${fmtData(x.aquisitivoFim)}`,
            fmtData(x.concessivoFim),
            String(x.usados),
            String(x.saldo),
            x.emDobroDias ? <span key="d" className="font-semibold text-red-700">{x.emDobroDias}</span> : "—",
            x.inicioAte && x.saldo ? fmtData(x.inicioAte) : "—",
            <SeloPeriodo key="s" situacao={x.situacao} />,
          ])}
          vazio={p.dataAdmissao ? "Ainda no primeiro período." : "Sem admissão no cadastro — lance em Dados do RH."}
        />
      </Secao>

      <Secao titulo="Férias — lançamentos" descricao="As do ponto chegam sozinhas pela gestão (e se corrigem lá). O RH lança as programadas e as que o ponto não registrou; o lançamento vale sobre o do ponto no mesmo intervalo.">
        <Tabela
          colunas={["Início", "Fim", "Dias", "Abono", "Origem", "Observação", ""]}
          alinharDireita={[2, 3]}
          linhas={[...p.ferias]
            .sort((a, b) => b.inicio.getTime() - a.inicio.getTime())
            .map((f) => [
              fmtData(f.inicio),
              fmtData(f.fim),
              String(diasDeFerias({ inicio: f.inicio, fim: f.fim })),
              f.abonoDias ? String(f.abonoDias) : "—",
              f.origem === "gestao" ? "ponto (gestão)" : `RH${f.registradoPor ? ` · ${f.registradoPor}` : ""}`,
              f.observacao ?? "—",
              podeEditar && f.origem === "manual" ? (
                <FormAcao key="x" acao={excluirFeriasPessoa} rotulo="Excluir" confirmar="Excluir este lançamento de férias?" botaoClasse="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-700">
                  <input type="hidden" name="id" value={f.id} />
                </FormAcao>
              ) : null,
            ])}
          vazio="Nenhuma férias registrada."
        />
        {podeEditar && (
          <FormAcao acao={salvarFeriasPessoa} rotulo="Lançar férias" limparAoGravar classe="mt-3 flex flex-wrap items-end gap-2 text-xs">
            <input type="hidden" name="pessoaId" value={p.id} />
            <label className="flex flex-col gap-0.5">Início<input type="date" name="inicio" className={ent} /></label>
            <label className="flex flex-col gap-0.5">Fim<input type="date" name="fim" className={ent} /></label>
            <label className="flex flex-col gap-0.5">Dias vendidos<input name="abono" defaultValue="0" inputMode="numeric" className={`${ent} w-24`} /></label>
            <input name="observacao" placeholder="Observação (ex.: programadas, 1ª parcela)" className={`${ent} min-w-64`} />
          </FormAcao>
        )}
      </Secao>

      <Secao titulo={`Multas nos últimos 12 meses (${p.pontos.pontos} pontos)`} descricao="As multas em que ele(a) foi o condutor. Pontos só das não assumidas pela empresa.">
        <Tabela
          colunas={["Infração", "AIT", "Placa", "O quê", "Pontos", "Situação"]}
          alinharDireita={[4]}
          linhas={p.multas.map((m) => [
            fmtData(m.dataInfracao),
            veMultas ? <Link key="a" href={`/frota/multas/${m.id}`} className="font-mono text-blue-800 hover:underline">{m.ait}</Link> : <span key="a" className="font-mono">{m.ait}</span>,
            <span key="p" className="font-mono">{m.placa}</span>,
            m.especificacao,
            m.pontos !== null ? String(m.pontos) : "—",
            m.situacao + (m.responsavel === "empresa" ? " · a empresa assumiu" : ""),
          ])}
          vazio="Nenhuma multa nos últimos 12 meses."
        />
      </Secao>

      <Secao titulo="Histórico">
        <Tabela
          colunas={["Quando", "Quem", "O quê", "Mudança"]}
          linhas={historico.map((h) => [
            fmtData(h.dataHora),
            h.usuario ?? h.agente ?? "—",
            `${h.tabela === "PesDocumento" ? "documento" : h.tabela === "PesFerias" ? "férias" : "cadastro"} · ${h.operacao}`,
            <span key="m" className="font-mono text-[11px] text-slate-600">{JSON.stringify(h.depois ?? h.antes ?? {}).slice(0, 160)}</span>,
          ])}
          vazio="Nenhuma alteração registrada."
        />
      </Secao>
    </div>
  );
}
