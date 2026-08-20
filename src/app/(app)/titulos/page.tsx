import Link from "next/link";
import { fmtBRL, fmtData, fmtDocumento, fmtNumero } from "@/lib/controladoria/format";
import { diasDeAtraso, emAberto, saldoAberto, somar, titulosAtivos } from "@/lib/controladoria/agents/comum";
import { resumoAging } from "@/lib/controladoria/agents/contasReceber";
import { contextoDaPagina } from "../_dados";
import { AvisoVazio, Barra, Kpi, Secao, SeletorEmpresa, Tabela } from "../_componentes";

// CONTAS A PAGAR E A RECEBER numa tela só, alternada por querystring.
//
// As duas listas respondem à mesma pergunta ("o que está em aberto, o que
// venceu, com quem") e usam exatamente as mesmas colunas. Duas telas
// separadas duplicariam o código e, na prática, seriam mantidas em ritmos
// diferentes — foi por isso que os títulos também moram numa tabela só no
// banco (ver OmieTitulo no schema).

type Params = { natureza?: string; filtro?: string; empresa?: string };

export default async function TitulosPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const { ctx, escopo } = await contextoDaPagina(params.empresa);
  const natureza = params.natureza === "RECEBER" ? "RECEBER" : "PAGAR";
  const filtro = params.filtro ?? "ABERTOS";

  const todos = titulosAtivos(ctx, natureza);
  const abertos = todos.filter(emAberto);
  const vencidos = abertos.filter((t) => diasDeAtraso(t, ctx.dataReferencia) > 0);
  const aging = resumoAging(ctx, natureza);
  // Preserva a empresa selecionada ao alternar entre pagar e receber: perder o
  // filtro a cada clique de aba faria o usuario refazer a escolha o tempo todo.
  const escopoNaUrl = escopo.conexaoId ? `&empresa=${escopo.conexaoId}` : "";

  const lista =
    filtro === "VENCIDOS"
      ? vencidos
      : filtro === "TODOS"
        ? todos
        : filtro === "COM_ENCARGOS"
          ? todos.filter((t) => t.jurosCents + t.multaCents + t.tarifaCents > 0)
          : abertos;

  const ordenada = [...lista]
    .sort((a, b) => a.dataVencimento.getTime() - b.dataVencimento.getTime())
    .slice(0, 300);

  const encargos = somar(todos, (t) => t.jurosCents + t.multaCents + t.tarifaCents);
  const rotulo = natureza === "PAGAR" ? "a pagar" : "a receber";

  return (
    <div className="max-w-6xl space-y-6">
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
        <SeletorEmpresa conexoes={ctx.conexoes} ativa={escopo.conexaoId} rota={`/titulos?natureza=${natureza}`} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi rotulo={`Em aberto`} valor={fmtBRL(somar(abertos, saldoAberto))} apoio={`${fmtNumero(abertos.length)} título(s)`} />
        <Kpi
          rotulo="Vencido"
          valor={fmtBRL(somar(vencidos, saldoAberto))}
          apoio={`${fmtNumero(vencidos.length)} título(s)`}
          tom={vencidos.length > 0 ? "ruim" : "bom"}
        />
        <Kpi
          rotulo="Encargos no período"
          valor={fmtBRL(encargos)}
          apoio="Juros, multa e tarifa registrados nas baixas"
          tom={encargos > 0 ? "atencao" : "bom"}
        />
        <Kpi rotulo="Total espelhado" valor={fmtBRL(somar(todos, (t) => t.valorDocumentoCents))} apoio={`${fmtNumero(todos.length)} título(s)`} />
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
        titulo={`${ordenada.length} título(s)`}
        descricao={ordenada.length === 300 ? "Mostrando os 300 primeiros por vencimento." : undefined}
        acao={
          <div className="flex flex-wrap gap-1 text-xs">
            <Filtro natureza={natureza} valor="ABERTOS" rotulo="Em aberto" ativo={filtro === "ABERTOS"} />
            <Filtro natureza={natureza} valor="VENCIDOS" rotulo="Vencidos" ativo={filtro === "VENCIDOS"} />
            <Filtro natureza={natureza} valor="COM_ENCARGOS" rotulo="Com encargos" ativo={filtro === "COM_ENCARGOS"} />
            <Filtro natureza={natureza} valor="TODOS" rotulo="Todos" ativo={filtro === "TODOS"} />
          </div>
        }
      >
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
              return [
                <span key="p">
                  <span className="font-medium text-slate-800">{t.parceiroNome ?? "(não identificado)"}</span>
                  {t.parceiroDocumento && (
                    <span className="block text-xs text-slate-400">{fmtDocumento(t.parceiroDocumento)}</span>
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

function Filtro({ natureza, valor, rotulo, ativo }: { natureza: string; valor: string; rotulo: string; ativo: boolean }) {
  return (
    <Link
      href={`/titulos?natureza=${natureza}&filtro=${valor}`}
      className={`rounded-full px-3 py-1 font-medium ${
        ativo ? "bg-blue-700 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
      }`}
    >
      {rotulo}
    </Link>
  );
}
