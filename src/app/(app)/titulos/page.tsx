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

// CONTAS A PAGAR E A RECEBER numa tela só, alternada por querystring.
//
// As duas listas respondem à mesma pergunta ("o que está em aberto, o que
// venceu, com quem") e usam exatamente as mesmas colunas. Duas telas
// separadas duplicariam o código e, na prática, seriam mantidas em ritmos
// diferentes — foi por isso que os títulos também moram numa tabela só no
// banco (ver OmieTitulo no schema).

type Params = { natureza?: string; filtro?: string; empresa?: string; competencia?: string };

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

  const ordenada = [...lista]
    .sort((a, b) => a.dataVencimento.getTime() - b.dataVencimento.getTime())
    .slice(0, 300);

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
        titulo={`${ordenada.length} título(s)`}
        descricao={ordenada.length === 300 ? "Mostrando os 300 primeiros por vencimento." : undefined}
        acao={
          <div className="flex flex-wrap gap-1 text-xs">
            <Filtro natureza={natureza} recorte={escopoNaUrl} valor="ABERTOS" rotulo="Em aberto" ativo={filtro === "ABERTOS"} />
            <Filtro natureza={natureza} recorte={escopoNaUrl} valor="VENCIDOS" rotulo="Vencidos" ativo={filtro === "VENCIDOS"} />
            <Filtro natureza={natureza} recorte={escopoNaUrl} valor="COM_ENCARGOS" rotulo="Com encargos" ativo={filtro === "COM_ENCARGOS"} />
            <Filtro natureza={natureza} recorte={escopoNaUrl} valor="PAGOS" rotulo="Pagos" ativo={filtro === "PAGOS"} />
            <Filtro natureza={natureza} recorte={escopoNaUrl} valor="TODOS" rotulo="Todos" ativo={filtro === "TODOS"} />
          </div>
        }
      >
        {comStatusVelho.length > 0 && (filtro === "VENCIDOS" || filtro === "ABERTOS") && (
          <p className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {fmtNumero(comStatusVelho.length)} título(s) vencido(s) há mais de 120 dias ({fmtBRL(somar(comStatusVelho, saldoAberto))}) ainda constam como “A VENCER”
            na última leitura da Omie. É o espelho desatualizado, não a Omie: esses meses não eram relidos depois da carga (pagamento lançado depois
            com a data antiga, título apagado). A sincronização diária passou a relê-los, alguns meses por dia; até lá, confira na Omie antes de cobrar.
          </p>
        )}
        {ordenada.length === 0 ? (
          <AvisoVazio
            titulo="Nenhum título com esse filtro"
            descricao="Se a base ainda está vazia, rode a sincronização com a Omie."
            acaoHref="/sincronizacao"
            acaoLabel="Ir para a sincronização"
          />
        ) : (
          <Tabela
            colunas={[natureza === "PAGAR" ? "Fornecedor" : "Cliente", "Documento", "Vencimento", "Valor", "Saldo", "Encargos", "Situação"]}
            alinharDireita={[3, 4, 5]}
            linhas={ordenada.map((t) => {
              const atraso = diasDeAtraso(t, ctx.dataReferencia);
              const encargo = t.jurosCents + t.multaCents + t.tarifaCents;
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

function Filtro({
  natureza,
  recorte,
  valor,
  rotulo,
  ativo,
}: {
  natureza: string;
  recorte: string;
  valor: string;
  rotulo: string;
  ativo: boolean;
}) {
  return (
    <Link
      href={`/titulos?natureza=${natureza}&filtro=${valor}${recorte}`}
      className={`rounded-full px-3 py-1 font-medium ${
        ativo ? "bg-blue-700 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
      }`}
    >
      {rotulo}
    </Link>
  );
}
