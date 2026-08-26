import Link from "next/link";
import type { AuditSeveridade, ConformidadeArea, ConformidadeNatureza, ConformidadeStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isLeituraDisponivel } from "@/lib/conformidade/analise";
import {
  carregarConformidade,
  estaVencido,
  montarPanoramaConformidade,
  OCORRENCIAS_PARA_REINCIDENCIA,
  type ApontamentoConformidade,
} from "@/lib/conformidade/panorama";
import {
  AREAS,
  competenciaParaTexto,
  NATUREZAS,
  ROTULO_AREA,
  ROTULO_NATUREZA,
  ROTULO_ORIGEM,
  ROTULO_STATUS,
  rotuloCompetencia,
  STATUS_EM_ABERTO,
} from "@/lib/conformidade/tipos";
import { OBRIGACAO_POR_CODIGO, OBRIGACOES, TESES } from "@/lib/conformidade/obrigacoes";
import { fmtBRL, fmtData, fmtNumero } from "@/lib/controladoria/format";
import { inicioDoDia } from "@/lib/controladoria/periodos";
import { AvisoVazio, BadgeSeveridade, Kpi, Secao, SeletorEmpresa, Tabela } from "../_componentes";
import { exigirPermissao, podeAcao, resolverEscopo } from "../_dados";
import NovoApontamentoForm from "./NovoApontamentoForm";
import TratativaApontamento from "./TratativaApontamento";
import UploadForm from "./UploadForm";
import { confirmarVinculo, descartarApontamento, excluirDocumento, removerVinculo, validarApontamento } from "./actions";
import { larguraPainel } from "@/lib/ui";

// CONFORMIDADE — o que a empresa recebe sobre si mesma.
//
// Esta tela responde quatro perguntas que nenhum relatório mensal em PDF
// responde sozinho:
//   1. O que está em aberto, com quem e até quando?
//   2. O que se repete mês após mês (e portanto nunca foi corrigido)?
//   3. Quais apontamentos os nossos próprios dados confirmam?
//   4. O que só a revisão externa enxerga — ou seja, onde este sistema é cego?

type Filtros = { empresa?: string; status?: string; area?: string; natureza?: string; competencia?: string };

const AREAS_VALIDAS = AREAS.map((a) => a.valor);
const NATUREZAS_VALIDAS = NATUREZAS.map((n) => n.valor);

export default async function ConformidadePage({ searchParams }: { searchParams: Promise<Filtros> }) {
  const session = await exigirPermissao("conformidade");
  const filtros = await searchParams;
  const escopo = await resolverEscopo(session.companyId, filtros.empresa);
  const podeGerir = await podeAcao(session, "gerir-conformidade");

  const hoje = inicioDoDia(new Date());

  const [conexoes, dados] = await Promise.all([
    prisma.omieConexao.findMany({
      where: { companyId: session.companyId, ativa: true },
      orderBy: { ordem: "asc" },
      select: { id: true, apelido: true, nome: true },
    }),
    carregarConformidade(session.companyId, escopo.conexaoId ?? undefined),
  ]);

  const panorama = montarPanoramaConformidade(dados, hoje);

  // Os achados ligados aos apontamentos. Buscados aqui, e não no carregamento
  // dos dados, porque só esta tela precisa do texto deles — o agente e o
  // relatório usam apenas as chaves.
  const achadosVinculados = dados.vinculos.length
    ? await prisma.auditFinding.findMany({
        where: { companyId: session.companyId, id: { in: [...new Set(dados.vinculos.map((v) => v.achadoId))] } },
        select: { id: true, chave: true, titulo: true, severidade: true, status: true, regra: true },
      })
    : [];
  const achadoPorId = new Map(achadosVinculados.map((a) => [a.id, a]));

  const statusFiltro = filtros.status ?? "ABERTOS";
  const areaFiltro = AREAS_VALIDAS.includes(filtros.area as ConformidadeArea) ? (filtros.area as ConformidadeArea) : null;
  const naturezaFiltro = NATUREZAS_VALIDAS.includes(filtros.natureza as ConformidadeNatureza)
    ? (filtros.natureza as ConformidadeNatureza)
    : null;

  const apontamentos = dados.apontamentos.filter((a) => {
    if (statusFiltro === "ABERTOS" && !(STATUS_EM_ABERTO as ConformidadeStatus[]).includes(a.status)) return false;
    if (statusFiltro === "VENCIDOS" && !estaVencido(a, hoje)) return false;
    if (statusFiltro === "REINCIDENTES" && a.ocorrencias < OCORRENCIAS_PARA_REINCIDENCIA) return false;
    if (statusFiltro === "PROPOSTAS" && !(a.propostoPorIa && !a.validado)) return false;
    if (!["ABERTOS", "TODOS", "VENCIDOS", "REINCIDENTES", "PROPOSTAS"].includes(statusFiltro) && a.status !== statusFiltro) {
      return false;
    }
    if (areaFiltro && a.area !== areaFiltro) return false;
    if (naturezaFiltro && a.natureza !== naturezaFiltro) return false;
    if (filtros.competencia && competenciaParaTexto(a.competencia) !== filtros.competencia) return false;
    return true;
  });

  const competencias = [...new Set(dados.apontamentos.map((a) => competenciaParaTexto(a.competencia)))].sort().reverse();
  const competenciaPadrao = competenciaParaTexto(new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1));
  const rota = "/conformidade";
  const comEmpresa = (extra: string) => (escopo.conexaoId ? `${extra}${extra.includes("?") ? "&" : "?"}empresa=${escopo.conexaoId}` : extra);

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Conformidade</h1>
        <p className="mt-1 text-sm text-slate-500">
          O que a consultoria, a contabilidade e a auditoria externa apontam sobre a empresa — com prazo, responsável e o
          cruzamento com o que os agentes veem nos dados todo dia.
        </p>
      </div>

      <SeletorEmpresa conexoes={conexoes} ativa={escopo.conexaoId} rota={rota} />

      <Link
        href="/conformidade/transicao"
        className="block rounded-xl border border-blue-200 bg-blue-50 px-4 py-4 transition-colors hover:border-blue-400"
      >
        <p className="text-sm font-semibold text-blue-900">Transição para o Lucro Real em janeiro de 2027</p>
        <p className="mt-1 text-xs leading-relaxed text-blue-800">
          O que muda com a reforma tributária, o que a operação pode creditar hoje e depois de 2027, por que fretamento
          é tratado de forma diferente do transporte público, e o que precisa estar de pé antes da virada — com cada
          decisão virando apontamento com prazo e responsável.
        </p>
      </Link>

      {!panorama.temModulo ? (
        <>
          <AvisoVazio
            titulo="Nenhum documento recebido ainda"
            descricao="Envie o primeiro relatório da consultoria abaixo. A partir do segundo mês, o sistema passa a mostrar o que se repete — que é onde está o valor."
          />
          {podeGerir && (
            <Secao
              titulo="Enviar documento"
              descricao="O arquivo original fica guardado como evidência; os apontamentos ficam rastreáveis, com prazo e responsável."
            >
              <UploadForm conexoes={conexoes} competenciaPadrao={competenciaPadrao} leituraDisponivel={isLeituraDisponivel()} />
            </Secao>
          )}
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              rotulo="Apontamentos em aberto"
              valor={fmtNumero(panorama.abertos)}
              apoio={panorama.valorEnvolvidoCents > 0 ? `${fmtBRL(panorama.valorEnvolvidoCents)} envolvidos` : undefined}
              tom={panorama.abertos > 0 ? "atencao" : "bom"}
            />
            <Kpi
              rotulo="Graves"
              valor={fmtNumero(panorama.criticos)}
              apoio="Críticos e altos sem tratativa concluída"
              tom={panorama.criticos > 0 ? "ruim" : "bom"}
            />
            <Kpi
              rotulo="Com prazo vencido"
              valor={fmtNumero(panorama.vencidos)}
              apoio="Prazo combinado que passou"
              tom={panorama.vencidos > 0 ? "ruim" : "bom"}
            />
            <Kpi
              rotulo="Reincidentes"
              valor={fmtNumero(panorama.reincidentes)}
              apoio={`Em ${OCORRENCIAS_PARA_REINCIDENCIA}+ competências`}
              tom={panorama.reincidentes > 0 ? "ruim" : "bom"}
            />
          </div>

          {!panorama.documentoEsperadoRecebido && panorama.competenciaEsperada && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-sm font-semibold text-amber-900">
                O documento de {rotuloCompetencia(panorama.competenciaEsperada)} ainda não chegou
              </p>
              <p className="mt-1 text-xs text-amber-800">
                A última competência recebida é{" "}
                {panorama.ultimaCompetencia ? rotuloCompetencia(panorama.ultimaCompetencia) : "desconhecida"}. Mês sem
                revisão externa é mês sem a segunda opinião que este sistema não consegue dar sozinho.
              </p>
            </div>
          )}

          {panorama.naoValidados > 0 && (
            <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3">
              <p className="text-sm font-semibold text-sky-900">
                {panorama.naoValidados} apontamento(s) lidos automaticamente aguardam sua conferência
              </p>
              <p className="mt-1 text-xs text-sky-800">
                Enquanto não são conferidos contra o trecho citado do documento, eles não entram no relatório da diretoria.{" "}
                <Link href={comEmpresa(`${rota}?status=PROPOSTAS`)} className="font-medium underline">
                  Conferir agora
                </Link>
              </p>
            </div>
          )}

          <Secao
            titulo="Cruzamento com a auditoria interna"
            descricao="O que as duas leituras — a revisão externa e os agentes — dizem sobre os mesmos riscos."
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-2xl font-semibold text-emerald-800">{fmtNumero(panorama.confirmadosPeloSistema)}</p>
                <p className="mt-1 text-sm font-medium text-emerald-900">confirmados pelos dados</p>
                <p className="mt-1 text-xs text-emerald-800">
                  Duas fontes independentes apontam o mesmo fato. Deixa de ser opinião de terceiro.
                </p>
              </div>
              <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
                <p className="text-2xl font-semibold text-sky-800">{fmtNumero(panorama.sugestoesPendentes)}</p>
                <p className="mt-1 text-sm font-medium text-sky-900">ligações sugeridas</p>
                <p className="mt-1 text-xs text-sky-800">
                  Semelhança de texto entre apontamento e achado. Vale como confirmação só depois que alguém concorda.
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-2xl font-semibold text-slate-800">{fmtNumero(panorama.semCobertura)}</p>
                <p className="mt-1 text-sm font-medium text-slate-900">só a consultoria vê</p>
                <p className="mt-1 text-xs text-slate-600">
                  Fora do alcance dos dados da Omie (trabalhista, contratual, societário) — ou regra que falta aqui.
                </p>
              </div>
            </div>

            {panorama.porNatureza.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs text-slate-500">Como se resolve:</span>
                {panorama.porNatureza.map((n) => (
                  <Link
                    key={n.natureza}
                    href={comEmpresa(`${rota}?natureza=${n.natureza}`)}
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      naturezaFiltro === n.natureza ? "bg-blue-700 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {n.rotulo} · {n.abertos}
                  </Link>
                ))}
              </div>
            )}

            {panorama.porArea.length > 0 && (
              <div className="mt-4">
                <Tabela
                  colunas={["Área", "Em aberto", "Graves"]}
                  alinharDireita={[1, 2]}
                  linhas={panorama.porArea.map((a) => [
                    <Link key={a.area} href={comEmpresa(`${rota}?area=${a.area}`)} className="text-blue-700 hover:underline">
                      {a.rotulo}
                    </Link>,
                    fmtNumero(a.abertos),
                    a.criticos > 0 ? <span key="c" className="font-medium text-red-700">{fmtNumero(a.criticos)}</span> : "—",
                  ])}
                />
              </div>
            )}
          </Secao>

          <Secao
            titulo={`${apontamentos.length} apontamento(s)`}
            descricao="Cada um traz o trecho do documento que o originou — a leitura pode ser conferida sem reabrir o arquivo."
            acao={
              <div className="flex flex-wrap gap-1 text-xs">
                <FiltroLink rotulo="Em aberto" href={comEmpresa(rota)} ativo={statusFiltro === "ABERTOS" && !areaFiltro && !filtros.competencia} />
                <FiltroLink rotulo="Vencidos" href={comEmpresa(`${rota}?status=VENCIDOS`)} ativo={statusFiltro === "VENCIDOS"} />
                <FiltroLink rotulo="Reincidentes" href={comEmpresa(`${rota}?status=REINCIDENTES`)} ativo={statusFiltro === "REINCIDENTES"} />
                <FiltroLink rotulo="A conferir" href={comEmpresa(`${rota}?status=PROPOSTAS`)} ativo={statusFiltro === "PROPOSTAS"} />
                <FiltroLink rotulo="Encerrados" href={comEmpresa(`${rota}?status=RESOLVIDO`)} ativo={statusFiltro === "RESOLVIDO"} />
                <FiltroLink rotulo="Todos" href={comEmpresa(`${rota}?status=TODOS`)} ativo={statusFiltro === "TODOS"} />
              </div>
            }
          >
            {competencias.length > 1 && (
              <div className="mb-4 flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs text-slate-500">Competência:</span>
                <FiltroLink rotulo="Todas" href={comEmpresa(`${rota}?status=${statusFiltro}`)} ativo={!filtros.competencia} />
                {competencias.slice(0, 12).map((c) => (
                  <FiltroLink
                    key={c}
                    rotulo={c}
                    href={comEmpresa(`${rota}?status=${statusFiltro}&competencia=${c}`)}
                    ativo={filtros.competencia === c}
                  />
                ))}
              </div>
            )}

            {apontamentos.length === 0 ? (
              <AvisoVazio
                titulo="Nenhum apontamento com esses filtros"
                descricao="Troque o filtro acima ou envie o documento da competência."
              />
            ) : (
              <ul className="space-y-4">
                {apontamentos.map((a) => (
                  <CartaoApontamento
                    key={a.id}
                    apontamento={a}
                    hoje={hoje}
                    podeGerir={podeGerir}
                    documento={dados.documentos.find((d) => d.id === a.documentoId) ?? null}
                    vinculos={dados.vinculos
                      .filter((v) => v.apontamentoId === a.id)
                      .map((v) => ({ ...v, achado: achadoPorId.get(v.achadoId) ?? null }))}
                  />
                ))}
              </ul>
            )}
          </Secao>

          <Secao
            titulo="Documentos recebidos"
            descricao="O arquivo original de cada competência, guardado como evidência dos apontamentos."
          >
            <Tabela
              colunas={["Competência", "Documento", "Empresa", "Leitura", "Apontamentos", ...(podeGerir ? [""] : [])]}
              alinharDireita={[4]}
              vazio="Nenhum documento recebido."
              linhas={dados.documentos.map((d) => {
                const quantos = dados.apontamentos.filter((a) => a.documentoId === d.id).length;
                return [
                  <span key="c" className="font-medium text-slate-800">{rotuloCompetencia(d.competencia)}</span>,
                  <span key="d">
                    <a href={`/api/conformidade/documento/${d.id}`} className="font-medium text-blue-700 hover:underline">
                      {d.titulo}
                    </a>
                    <span className="block text-xs text-slate-400">
                      {ROTULO_ORIGEM[d.origem] ?? d.origem}
                      {d.emissor ? ` · ${d.emissor}` : ""} · {(d.tamanhoBytes / 1024).toFixed(0)} KB · enviado em{" "}
                      {fmtData(d.criadoEm)}
                      {d.enviadoPorNome ? ` por ${d.enviadoPorNome}` : ""}
                    </span>
                  </span>,
                  d.conexaoApelido ?? "grupo",
                  <StatusLeitura key="l" extracao={d.extracao} erro={d.extracaoErro} />,
                  fmtNumero(quantos),
                  ...(podeGerir
                    ? [
                        <form key="x" action={excluirDocumento}>
                          <input type="hidden" name="id" value={d.id} />
                          <button type="submit" className="text-xs font-medium text-slate-500 hover:text-red-700 hover:underline">
                            excluir
                          </button>
                        </form>,
                      ]
                    : []),
                ];
              })}
            />
          </Secao>

          {podeGerir && (
            <Secao
              titulo="Enviar documento"
              descricao="O arquivo original fica guardado; a leitura propõe os apontamentos e você confere cada um contra o trecho citado."
            >
              <UploadForm conexoes={conexoes} competenciaPadrao={competenciaPadrao} leituraDisponivel={isLeituraDisponivel()} />
            </Secao>
          )}
        </>
      )}

      {podeGerir && (
        <Secao titulo="Apontamento sem documento" descricao="Reunião com o contador, ligação da consultoria, notificação recebida.">
          <NovoApontamentoForm
            conexoes={conexoes}
            documentos={dados.documentos.map((d) => ({
              id: d.id,
              titulo: d.titulo,
              competencia: rotuloCompetencia(d.competencia),
            }))}
            competenciaPadrao={competenciaPadrao}
          />
        </Secao>
      )}

      <Secao
        titulo="Fundamentação técnica e legal"
        descricao="O catálogo que o sistema usa para classificar o apontamento, preencher a base legal e explicar o risco. É referência versionada em código, não tabela editável — e não substitui a assessoria: prazo de obrigação acessória muda, e a data aqui serve para alertar, nunca para decidir."
      >
        <Tabela
          colunas={["Obrigação", "Base legal", "Prazo", "Prova de cumprimento"]}
          linhas={OBRIGACOES.map((o) => [
            <span key="n">
              <span className="font-medium text-slate-800">{o.nome}</span>
              <span className="block text-xs text-slate-400">
                {ROTULO_AREA[o.area] ?? o.area} · {o.periodicidade.toLowerCase()} · {o.codigo}
              </span>
            </span>,
            <span key="b" className="text-xs text-slate-600">{o.baseLegal}</span>,
            <span key="p" className="text-xs text-slate-600">{o.prazo}</span>,
            <span key="e" className="text-xs text-slate-600">{o.evidencia.join(" · ")}</span>,
          ])}
        />

        <h3 className="mt-6 text-sm font-semibold text-slate-900">Onde este setor costuma errar</h3>
        <p className="mt-1 text-xs text-slate-500">
          Teses e enquadramentos típicos do transporte de passageiros por fretamento. São o que a revisão externa procura
          primeiro — e o que o sistema usa para não classificar um apontamento fiscal como &quot;outro&quot;.
        </p>
        <ul className="mt-3 space-y-3">
          {TESES.map((t) => (
            <li key={t.codigo} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-slate-900">{t.titulo}</span>
                <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">
                  {ROTULO_AREA[t.area] ?? t.area}
                </span>
              </div>
              <p className="mt-1 text-xs font-medium text-slate-500">{t.baseLegal}</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">{t.oQueObservar}</p>
            </li>
          ))}
        </ul>
      </Secao>

      <Secao titulo="Como este módulo trabalha">
        <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-600">
          <li>
            O arquivo é guardado <strong>antes</strong> de qualquer processamento e nunca é apagado por falha de leitura: ele é
            a evidência do apontamento, e apontamento sem fonte verificável não resiste a uma discussão com o fisco.
          </li>
          <li>
            A leitura automática <strong>transcreve</strong>, não julga. Cada proposta traz o trecho literal do documento e só
            vale como apontamento da empresa depois que uma pessoa confere.
          </li>
          <li>
            O mesmo assunto reaparecendo em {OCORRENCIAS_PARA_REINCIDENCIA} competências vira achado de auditoria: repetição
            nessa escala não é problema que voltou, é processo que nunca foi corrigido.
          </li>
          <li>
            Todo dia, depois da auditoria, o sistema procura achados que descrevam o mesmo fato de cada apontamento. A
            ligação nasce como <strong>sugestão</strong> — semelhança de texto não é prova, e confirmar é decisão de gente.
          </li>
        </ul>
      </Secao>
    </div>
  );
}

function CartaoApontamento({
  apontamento: a,
  hoje,
  podeGerir,
  documento,
  vinculos,
}: {
  apontamento: ApontamentoConformidade;
  hoje: Date;
  podeGerir: boolean;
  documento: { id: string; titulo: string } | null;
  vinculos: {
    id: string;
    automatico: boolean;
    pontuacao: number;
    achado: { id: string; chave: string; titulo: string; severidade: AuditSeveridade; status: string; regra: string } | null;
  }[];
}) {
  const vencido = estaVencido(a, hoje);
  const proposta = a.propostoPorIa && !a.validado;
  const reincidente = a.ocorrencias >= OCORRENCIAS_PARA_REINCIDENCIA;
  const obrigacao = a.obrigacaoCodigo ? OBRIGACAO_POR_CODIGO.get(a.obrigacaoCodigo) : undefined;

  return (
    <li
      id={a.id}
      className={`rounded-xl border p-4 ${
        vencido ? "border-red-300 bg-red-50/40" : proposta ? "border-sky-200 bg-sky-50/30" : "border-slate-200"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <BadgeSeveridade severidade={a.severidade} />
        <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-violet-200">
          {ROTULO_AREA[a.area] ?? a.area}
        </span>
        <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-medium text-white">
          {ROTULO_NATUREZA[a.natureza] ?? a.natureza}
        </span>
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
          {rotuloCompetencia(a.competencia)}
        </span>
        {a.conexaoApelido && (
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">{a.conexaoApelido}</span>
        )}
        {a.status !== "ABERTO" && (
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
            {ROTULO_STATUS[a.status] ?? a.status}
          </span>
        )}
        {reincidente && (
          <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
            {a.ocorrencias}ª competência
          </span>
        )}
        {proposta && (
          <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-medium text-sky-800">a conferir</span>
        )}
      </div>

      <h3 className="mt-2 text-sm font-semibold text-slate-900">{a.titulo}</h3>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">{a.descricao}</p>

      {(a.baseLegal || obrigacao) && (
        <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50/50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">Fundamentação</p>
          {a.baseLegal && <p className="mt-1 text-xs leading-relaxed text-slate-700">{a.baseLegal}</p>}
          {obrigacao && (
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              <strong>{obrigacao.nome}</strong> · {obrigacao.prazo}. {obrigacao.risco}
            </p>
          )}
        </div>
      )}

      {a.trechoOrigem && (
        <blockquote className="mt-3 border-l-2 border-slate-300 pl-3 text-sm italic leading-relaxed text-slate-500">
          &ldquo;{a.trechoOrigem}&rdquo;
          <span className="block not-italic text-xs text-slate-400">
            {documento ? documento.titulo : "documento"}
            {a.paginaOrigem ? ` · ${a.paginaOrigem}` : ""}
          </span>
        </blockquote>
      )}

      {a.recomendacao && (
        <div className="mt-3 rounded-lg bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">O que fazer</p>
          <p className="mt-1 text-sm leading-relaxed text-slate-700">{a.recomendacao}</p>
        </div>
      )}

      {vinculos.length > 0 && (
        <div className="mt-3 rounded-lg border border-slate-200 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Achados da auditoria interna</p>
          <ul className="mt-2 space-y-2">
            {vinculos.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-2 text-xs">
                <span className={v.automatico ? "text-slate-600" : "font-medium text-emerald-700"}>
                  {v.automatico ? `sugestão (${v.pontuacao}%)` : "confirmado"}
                </span>
                {v.achado ? (
                  <Link href={`/auditoria?achado=${v.achado.id}#${v.achado.id}`} className="text-blue-700 hover:underline">
                    {v.achado.titulo}
                  </Link>
                ) : (
                  <span className="text-slate-400">achado encerrado</span>
                )}
                {podeGerir && (
                  <span className="flex gap-2">
                    {v.automatico && (
                      <form action={confirmarVinculo}>
                        <input type="hidden" name="id" value={v.id} />
                        <button type="submit" className="font-medium text-emerald-700 hover:underline">
                          é o mesmo fato
                        </button>
                      </form>
                    )}
                    <form action={removerVinculo}>
                      <input type="hidden" name="id" value={v.id} />
                      <button type="submit" className="text-slate-500 hover:underline">
                        {v.automatico ? "não é" : "desfazer"}
                      </button>
                    </form>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {a.observacaoTratativa && (
        <p className="mt-2 rounded-lg bg-emerald-50 p-2 text-xs text-emerald-900">Tratativa: {a.observacaoTratativa}</p>
      )}

      <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
        {a.valorEnvolvidoCents !== null && <span className="font-medium text-slate-600">{fmtBRL(a.valorEnvolvidoCents)}</span>}
        {a.responsavel && <span>responsável: {a.responsavel}</span>}
        {a.prazo && (
          <span className={vencido ? "font-medium text-red-700" : undefined}>
            prazo {fmtData(a.prazo)}
            {vencido ? " (vencido)" : ""}
          </span>
        )}
        {a.competenciaAlvo && <span>refere-se a {rotuloCompetencia(a.competenciaAlvo)}</span>}
        {reincidente && <span>desde {rotuloCompetencia(a.primeiraCompetencia)}</span>}
        {a.propostoPorIa && <span>{a.validado ? "lido automaticamente, conferido" : "lido automaticamente"}</span>}
      </p>

      {podeGerir && (
        <div className="flex flex-wrap items-center gap-2">
          <TratativaApontamento
            apontamentoId={a.id}
            statusAtual={a.status}
            responsavelAtual={a.responsavel}
            prazoAtual={a.prazo ? a.prazo.toISOString().slice(0, 10) : null}
            observacaoAtual={a.observacaoTratativa}
          />
          {proposta && (
            <>
              <form action={validarApontamento} className="mt-3">
                <input type="hidden" name="id" value={a.id} />
                <button type="submit" className="text-xs font-medium text-emerald-700 hover:underline">
                  conferi, procede
                </button>
              </form>
              <form action={descartarApontamento} className="mt-3">
                <input type="hidden" name="id" value={a.id} />
                <button type="submit" className="text-xs font-medium text-slate-500 hover:underline">
                  descartar proposta
                </button>
              </form>
            </>
          )}
        </div>
      )}
    </li>
  );
}

function StatusLeitura({ extracao, erro }: { extracao: string; erro: string | null }) {
  if (extracao === "EXTRAIDO") return <span className="text-xs font-medium text-emerald-700">lido</span>;
  if (extracao === "MANUAL") return <span className="text-xs text-slate-500">manual</span>;
  if (extracao === "ERRO") {
    return (
      <span className="text-xs font-medium text-amber-700" title={erro ?? undefined}>
        falhou
      </span>
    );
  }
  return <span className="text-xs text-slate-400">pendente</span>;
}

function FiltroLink({ rotulo, href, ativo }: { rotulo: string; href: string; ativo: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1 font-medium ${
        ativo ? "bg-blue-700 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
      }`}
    >
      {rotulo}
    </Link>
  );
}
