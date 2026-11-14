import Link from "next/link";
import { fmtBRL, fmtData, fmtDocumento, fmtNumero } from "@/lib/controladoria/format";
import { diasDeAtraso, emAberto, saldoAberto, somar, titulosAtivos } from "@/lib/controladoria/agents/comum";
import { resumoAging } from "@/lib/controladoria/agents/contasReceber";
import { competenciasDisponiveis, contextoDaPagina } from "../_dados";
import { AvisoVazio, Barra, Kpi, Secao, Tabela } from "../_componentes";
import Filtros from "../Filtros";
import { larguraPainel } from "@/lib/ui";
import { fmtCnae } from "@/lib/receita/cliente";
import { janelaDeAuditoria } from "@/lib/controladoria/contexto";
import {
  COLUNAS_DE_ORDEM,
  ORDEM_PADRAO,
  ROTULO_DA_ORDEM,
  encargosDoTitulo,
  filtrarPorBusca,
  lerBusca,
  lerOrdem,
  ordenarTitulos,
  proximaOrdem,
  type ColunaDeOrdem,
  type Ordem,
} from "@/lib/controladoria/ordemDeTitulos";

// CONTAS A PAGAR E A RECEBER numa tela só, alternada por querystring.
//
// As duas listas respondem à mesma pergunta ("o que está em aberto, o que
// venceu, com quem") e usam exatamente as mesmas colunas. Duas telas
// separadas duplicariam o código e, na prática, seriam mantidas em ritmos
// diferentes — foi por isso que os títulos também moram numa tabela só no
// banco (ver OmieTitulo no schema).

type Params = { natureza?: string; filtro?: string; empresa?: string; competencia?: string; ordem?: string; dir?: string; busca?: string };

// Quantas linhas a lista mostra. A ordem escolhida vale ANTES deste corte.
const LIMITE_DA_LISTA = 300;

export default async function TitulosPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const { ctx, escopo, periodo } = await contextoDaPagina("titulos", params.empresa, params.competencia);
  const natureza = params.natureza === "RECEBER" ? "RECEBER" : "PAGAR";
  const filtro = params.filtro ?? "ABERTOS";

  const todos = titulosAtivos(ctx, natureza);
  const abertos = todos.filter(emAberto);
  const vencidos = abertos.filter((t) => diasDeAtraso(t, ctx.dataReferencia) > 0);
  const aging = resumoAging(ctx, natureza);
  // Preserva a empresa E a competência ao alternar entre pagar e receber e
  // entre os filtros de situação. Os filtros ("Vencidos", "Todos"...) levavam
  // só a natureza: com a MCZ selecionada, clicar em "Vencidos" mostrava os
  // vencidos do GRUPO sob o seletor ainda marcando MCZ — número de outra
  // empresa com cara de ser desta.
  const recorte = new URLSearchParams();
  if (escopo.conexaoId) recorte.set("empresa", escopo.conexaoId);
  if (periodo.competencia) recorte.set("competencia", periodo.competencia);
  const escopoNaUrl = recorte.size > 0 ? `&${recorte}` : "";

  const pagos = todos.filter((t) => !emAberto(t));
  const lista =
    filtro === "VENCIDOS"
      ? vencidos
      : filtro === "TODOS"
        ? todos
        : filtro === "PAGOS"
          ? pagos
          : filtro === "COM_ENCARGOS"
            ? todos.filter((t) => t.jurosCents + t.multaCents + t.tarifaCents > 0)
            : abertos;

  // STATUS VELHO NO ESPELHO: vencido há mais de 120 dias e a última leitura da
  // Omie ainda dizia "a vencer". A Omie não mostra isso — é o espelho que não
  // relia esses meses (o pagamento lançado depois com a data antiga, o título
  // apagado). A sincronização diária passou a relê-los; até lá, a tela avisa.
  const statusVelho = (t: (typeof todos)[number]) =>
    emAberto(t) && diasDeAtraso(t, ctx.dataReferencia) > 120 && /a vencer|vence hoje/i.test(t.status);
  const comStatusVelho = vencidos.filter(statusVelho);

  // A COMPOSIÇÃO DO QUE ESTÁ NO ESPELHO, por empresa e situação: é o
  // drill-down do cartão do total (e cada linha abre a lista filtrada).
  const desde = janelaDeAuditoria(periodo.dataReferencia);
  const listaDe = (f: string) => `/titulos?natureza=${natureza}&filtro=${f}${escopoNaUrl}#lista`;
  const empresas = [...new Set(todos.map((t) => t.conexaoApelido))].sort();
  const composicao = empresas.map((empresa) => {
    const daEmpresa = (l: typeof todos) => l.filter((t) => t.conexaoApelido === empresa);
    return {
      empresa,
      pagos: daEmpresa(pagos),
      aVencer: daEmpresa(abertos).filter((t) => diasDeAtraso(t, ctx.dataReferencia) <= 0),
      vencidos: daEmpresa(vencidos),
    };
  });

  // A ORDEM E A BUSCA DA LISTA (ordemDeTitulos.ts): quem lê escolhe a coluna e
  // se quer o maior ou o menor primeiro, e acha um cliente pelo nome. As duas
  // valem sobre a lista inteira do filtro, antes do corte das 300 linhas.
  const ordem = lerOrdem(params.ordem, params.dir);
  const busca = lerBusca(params.busca);
  const filtrada = filtrarPorBusca(lista, busca);
  const ordenada = ordenarTitulos(filtrada, ordem).slice(0, LIMITE_DA_LISTA);
  const ordemPadrao = ordem.coluna === ORDEM_PADRAO.coluna && ordem.direcao === ORDEM_PADRAO.direcao;
  // O endereço da lista com a ordem e a busca de agora (ou as que o clique
  // muda). Os cartões e o quadro lá de cima NÃO passam por aqui: eles abrem a
  // lista que soma o número deles, sem busca nenhuma no meio.
  const urlDaLista = (muda: { filtro?: string; ordem?: Ordem; busca?: string } = {}) => {
    const q = new URLSearchParams({ natureza, filtro: muda.filtro ?? filtro });
    if (escopo.conexaoId) q.set("empresa", escopo.conexaoId);
    if (periodo.competencia) q.set("competencia", periodo.competencia);
    const o = muda.ordem ?? ordem;
    if (o.coluna !== ORDEM_PADRAO.coluna || o.direcao !== ORDEM_PADRAO.direcao) {
      q.set("ordem", o.coluna);
      q.set("dir", o.direcao);
    }
    const b = muda.busca ?? busca;
    if (b) q.set("busca", b);
    return `/titulos?${q}#lista`;
  };
  const nomeDoParceiro = natureza === "PAGAR" ? "Fornecedor" : "Cliente";
  const ROTULO_DA_COLUNA: Record<ColunaDeOrdem, string> = {
    parceiro: nomeDoParceiro,
    documento: "Documento",
    vencimento: "Vencimento",
    valor: "Valor",
    saldo: "Saldo",
    encargos: "Encargos",
    situacao: "Situação",
  };
  // A soma do que a lista tem (a lista inteira do filtro, não só as linhas
  // mostradas), para bater com o cartão que a abriu.
  const somaDaLista = [
    `valor ${fmtBRL(somar(filtrada, (t) => t.valorDocumentoCents))}`,
    `saldo em aberto ${fmtBRL(somar(filtrada.filter(emAberto), saldoAberto))}`,
    `encargos ${fmtBRL(somar(filtrada, encargosDoTitulo))}`,
  ].join(" · ");

  const encargos = somar(todos, (t) => t.jurosCents + t.multaCents + t.tarifaCents);
  const rotulo = natureza === "PAGAR" ? "a pagar" : "a receber";

  // SELO DA RECEITA por CNPJ, quando há consulta: "ATIVA (desde 2019, CNAE
  // 4929-9/01)". Uma linha, abaixo do documento — é o suficiente para quem lê
  // a lista notar o BAIXADA sem abrir achado nenhum. Sem consulta, nada:
  // ausência não é informação.
  const receitaPorCnpj = new Map((ctx.receita ?? []).filter((r) => r.situacao).map((r) => [r.cnpj, r]));

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Contas {rotulo}</h1>
        <p className="mt-1 text-sm text-slate-500">
          Espelho dos títulos da Omie, atualizado em D-1 ({fmtData(ctx.dataReferencia)}). A Omie continua sendo a fonte de
          verdade — aqui o dado serve para auditar e comparar.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <Aba href={`/titulos?natureza=PAGAR${escopoNaUrl}`} rotulo="A pagar" ativo={natureza === "PAGAR"} />
          <Aba href={`/titulos?natureza=RECEBER${escopoNaUrl}`} rotulo="A receber" ativo={natureza === "RECEBER"} />
        </div>
        <Filtros
          conexoes={ctx.conexoes}
          empresaAtiva={escopo.conexaoId}
          competencias={competenciasDisponiveis(ctx.config.dataInicioBase)}
          competenciaAtiva={periodo.competencia}
          rota="/titulos"
          extras={{ natureza }}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi rotulo={`Em aberto`} valor={fmtBRL(somar(abertos, saldoAberto))} apoio={`${fmtNumero(abertos.length)} título(s)`} href={listaDe("ABERTOS")} />
        <Kpi
          rotulo="Vencido"
          valor={fmtBRL(somar(vencidos, saldoAberto))}
          apoio={`${fmtNumero(vencidos.length)} título(s)`}
          tom={vencidos.length > 0 ? "ruim" : "bom"}
          href={listaDe("VENCIDOS")}
        />
        <Kpi
          rotulo="Encargos no período"
          valor={fmtBRL(encargos)}
          apoio="Juros, multa e tarifa registrados nas baixas"
          tom={encargos > 0 ? "atencao" : "bom"}
          href={listaDe("COM_ENCARGOS")}
        />
        {/* Era "Total espelhado": a soma de TODOS os títulos que a tela leu da
            Omie — pagos e em aberto —, volume de lançamentos e não saldo. */}
        <Kpi
          rotulo={`Títulos ${rotulo} lidos desde ${fmtData(desde)}`}
          valor={fmtBRL(somar(todos, (t) => t.valorDocumentoCents))}
          apoio={`${fmtNumero(todos.length)} título(s), pagos e em aberto`}
          href="#composicao"
        />
      </div>

      <Secao titulo="Por faixa de atraso">
        <ul className="space-y-3">
          {aging.faixas.map((f) => (
            <li key={f.rotulo}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-medium text-slate-700">
                  {f.rotulo} <span className="text-slate-400">({f.quantidade})</span>
                </span>
                <span className="tabular-nums text-slate-600">{fmtBRL(f.valorCents)}</span>
              </div>
              <Barra
                percentual={aging.totalCents > 0 ? (f.valorCents / aging.totalCents) * 100 : 0}
                tom={f.rotulo === "A vencer" ? "verde" : "vermelho"}
              />
            </li>
          ))}
        </ul>
      </Secao>

      <Secao
        id="composicao"
        titulo={`O que a tela leu da Omie: ${fmtNumero(todos.length)} título(s) ${rotulo}`}
        descricao={`Os títulos com vencimento ou emissão desde ${fmtData(desde)}, mais os em aberto mais antigos (o que ainda deve não sai da tela). Na visão do grupo, inclui o que uma empresa paga à outra. É volume de lançamentos, não saldo: o saldo é o "Em aberto".`}
      >
        <Tabela
          colunas={["Empresa", "Pagos", "Em aberto a vencer", "Vencidos", "Total"]}
          alinharDireita={[1, 2, 3, 4]}
          linhas={[
            ...composicao.map((c) => [
              c.empresa,
              <Link key="p" href={listaDe("PAGOS")} className="hover:underline">
                {fmtBRL(somar(c.pagos, (t) => t.valorDocumentoCents))} <span className="text-xs text-slate-400">({fmtNumero(c.pagos.length)})</span>
              </Link>,
              <Link key="a" href={listaDe("ABERTOS")} className="hover:underline">
                {fmtBRL(somar(c.aVencer, (t) => t.valorDocumentoCents))} <span className="text-xs text-slate-400">({fmtNumero(c.aVencer.length)})</span>
              </Link>,
              <Link key="v" href={listaDe("VENCIDOS")} className="hover:underline">
                {fmtBRL(somar(c.vencidos, (t) => t.valorDocumentoCents))} <span className="text-xs text-slate-400">({fmtNumero(c.vencidos.length)})</span>
              </Link>,
              fmtBRL(somar([...c.pagos, ...c.aVencer, ...c.vencidos], (t) => t.valorDocumentoCents)),
            ]),
          ]}
        />
      </Secao>

      <Secao
        id="lista"
        titulo={`${fmtNumero(filtrada.length)} título(s)${busca ? ` com “${busca}”` : ""}`}
        descricao={`Soma da lista: ${somaDaLista}. Ordem: ${ROTULO_DA_ORDEM[ordem.coluna][ordem.direcao]}.${
          filtrada.length > LIMITE_DA_LISTA ? ` Mostrando os ${LIMITE_DA_LISTA} primeiros nessa ordem.` : ""
        }`}
        acao={
          <div className="flex flex-wrap gap-1 text-xs">
            <Filtro href={urlDaLista({ filtro: "ABERTOS" })} rotulo="Em aberto" ativo={filtro === "ABERTOS"} />
            <Filtro href={urlDaLista({ filtro: "VENCIDOS" })} rotulo="Vencidos" ativo={filtro === "VENCIDOS"} />
            <Filtro href={urlDaLista({ filtro: "COM_ENCARGOS" })} rotulo="Com encargos" ativo={filtro === "COM_ENCARGOS"} />
            <Filtro href={urlDaLista({ filtro: "PAGOS" })} rotulo="Pagos" ativo={filtro === "PAGOS"} />
            <Filtro href={urlDaLista({ filtro: "TODOS" })} rotulo="Todos" ativo={filtro === "TODOS"} />
          </div>
        }
      >
        {/* FILTRAR E ORDENAR. Formulário GET: o que se escolhe vira endereço,
            como os demais filtros da tela. O clique no título de uma coluna
            faz o mesmo que os dois seletores. */}
        {/* A `key` remonta o formulário quando a ordem ou a busca mudam por
            fora dele (clique no título da coluna, "Limpar"): campo com
            `defaultValue` não acompanha a navegação sozinho, e os seletores
            ficavam mostrando a ordem anterior. */}
        <form key={`${filtro}|${ordem.coluna}|${ordem.direcao}|${busca}`} action="/titulos#lista" method="get" className="mb-4 flex flex-wrap items-end gap-2 text-xs">
          <input type="hidden" name="natureza" value={natureza} />
          <input type="hidden" name="filtro" value={filtro} />
          {escopo.conexaoId && <input type="hidden" name="empresa" value={escopo.conexaoId} />}
          {periodo.competencia && <input type="hidden" name="competencia" value={periodo.competencia} />}
          <label className="flex min-w-56 flex-1 flex-col gap-1 text-slate-600">
            Filtrar por {nomeDoParceiro.toLowerCase()}, CNPJ ou documento
            <input
              name="busca"
              defaultValue={busca}
              maxLength={80}
              placeholder="parte do nome, do CNPJ ou do número"
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-slate-600">
            Ordenar por
            <select name="ordem" defaultValue={ordem.coluna} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900">
              {COLUNAS_DE_ORDEM.map((c) => (
                <option key={c} value={c}>
                  {ROTULO_DA_COLUNA[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-slate-600">
            Ordem
            <select name="dir" defaultValue={ordem.direcao} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900">
              <option value="desc">Maior primeiro (ou Z a A)</option>
              <option value="asc">Menor primeiro (ou A a Z)</option>
            </select>
          </label>
          <button className="rounded-md bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-600">Aplicar</button>
          {(busca || !ordemPadrao) && (
            <Link href={urlDaLista({ ordem: ORDEM_PADRAO, busca: "" })} className="px-1 py-1.5 text-blue-700 hover:underline">
              Limpar
            </Link>
          )}
        </form>
        {comStatusVelho.length > 0 && (filtro === "VENCIDOS" || filtro === "ABERTOS") && (
          <p className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {fmtNumero(comStatusVelho.length)} título(s) vencido(s) há mais de 120 dias ({fmtBRL(somar(comStatusVelho, saldoAberto))}) ainda constam como “A VENCER”
            na última leitura da Omie. É o espelho desatualizado, não a Omie: esses meses não eram relidos depois da carga (pagamento lançado depois
            com a data antiga, título apagado). A sincronização diária passou a relê-los, alguns meses por dia; até lá, confira na Omie antes de cobrar.
          </p>
        )}
        {ordenada.length === 0 && busca ? (
          <AvisoVazio
            titulo={`Nenhum título com “${busca}” neste filtro`}
            descricao="A busca olha o nome, o CNPJ e o número do documento, dentro do filtro escolhido acima (Em aberto, Vencidos…)."
            acaoHref={urlDaLista({ busca: "" })}
            acaoLabel="Limpar a busca"
          />
        ) : ordenada.length === 0 ? (
          <AvisoVazio
            titulo="Nenhum título com esse filtro"
            descricao="Se a base ainda está vazia, rode a sincronização com a Omie."
            acaoHref="/sincronizacao"
            acaoLabel="Ir para a sincronização"
          />
        ) : (
          <Tabela
            colunas={COLUNAS_DE_ORDEM.map((c) => (
              <Cabecalho key={c} rotulo={ROTULO_DA_COLUNA[c]} coluna={c} ordem={ordem} href={urlDaLista({ ordem: proximaOrdem(ordem, c) })} />
            ))}
            alinharDireita={[3, 4, 5]}
            linhas={ordenada.map((t) => {
              const atraso = diasDeAtraso(t, ctx.dataReferencia);
              const encargo = encargosDoTitulo(t);
              const receita = t.parceiroDocumento ? receitaPorCnpj.get(t.parceiroDocumento) : undefined;
              return [
                <span key="p">
                  <span className="font-medium text-slate-800">{t.parceiroNome ?? "(não identificado)"}</span>
                  {t.parceiroDocumento && (
                    <span className="block text-xs text-slate-400">{fmtDocumento(t.parceiroDocumento)}</span>
                  )}
                  {receita && (
                    <span className={`block text-xs ${receita.situacao === "ATIVA" ? "text-slate-400" : "font-medium text-red-600"}`}>
                      Receita: {receita.situacao}
                      {receita.inicioAtividade || receita.cnaeCodigo
                        ? ` (${[
                            receita.inicioAtividade ? `desde ${receita.inicioAtividade.getFullYear()}` : null,
                            receita.cnaeCodigo ? `CNAE ${fmtCnae(receita.cnaeCodigo)}` : null,
                          ]
                            .filter(Boolean)
                            .join(", ")})`
                        : ""}
                    </span>
                  )}
                </span>,
                <span key="d" className="text-xs">
                  {t.numeroDocumento ?? `lanç. ${t.codigoLancamento}`}
                  {t.numeroParcela && <span className="block text-slate-400">parcela {t.numeroParcela}</span>}
                </span>,
                <span key="v">
                  {fmtData(t.dataVencimento)}
                  {emAberto(t) && atraso > 0 && (
                    <span className="block text-xs font-medium text-red-600">{atraso} dia(s) de atraso</span>
                  )}
                </span>,
                fmtBRL(t.valorDocumentoCents),
                emAberto(t) ? fmtBRL(saldoAberto(t)) : "—",
                encargo > 0 ? <span key="e" className="font-medium text-red-700">{fmtBRL(encargo)}</span> : "—",
                <span key="s" className="text-xs">
                  {t.status}
                  {statusVelho(t) && <span className="block text-amber-700">lido da Omie em {fmtData(t.sincronizadoEm)} — a reler</span>}
                  {t.categoriaCodigo ? null : <span className="block text-amber-600">sem categoria</span>}
                </span>,
              ];
            })}
          />
        )}
      </Secao>
    </div>
  );
}

function Aba({ href, rotulo, ativo }: { href: string; rotulo: string; ativo: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-lg px-4 py-2 text-sm font-medium ${
        ativo ? "bg-blue-700 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
      }`}
    >
      {rotulo}
    </Link>
  );
}

// O título de uma coluna da lista: o clique ordena por ela (a que já ordena
// inverte). A seta diz a ordem de agora; as demais mostram que dá para clicar.
function Cabecalho({ rotulo, coluna, ordem, href }: { rotulo: string; coluna: ColunaDeOrdem; ordem: Ordem; href: string }) {
  const ativa = ordem.coluna === coluna;
  const proxima = proximaOrdem(ordem, coluna);
  return (
    <Link
      href={href}
      title={`Ordenar por ${ROTULO_DA_ORDEM[coluna][proxima.direcao]}`}
      className={`inline-flex items-center gap-1 whitespace-nowrap hover:text-slate-900 ${ativa ? "text-blue-700" : ""}`}
    >
      {rotulo}
      <span aria-hidden className={ativa ? "" : "text-slate-300"}>
        {ativa ? (ordem.direcao === "asc" ? "▲" : "▼") : "↕"}
      </span>
    </Link>
  );
}

function Filtro({ href, rotulo, ativo }: { href: string; rotulo: string; ativo: boolean }) {
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
