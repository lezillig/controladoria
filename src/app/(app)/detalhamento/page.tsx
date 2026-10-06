import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { montarJanelas } from "@/lib/controladoria/periodos";
import { fmtBRL, fmtData, fmtNumero } from "@/lib/controladoria/format";
import {
  detalharConta,
  detalharJurosEMulta,
  detalharPerdas,
  detalharTitulos,
  ehComponenteDePerda,
  periodoLivre,
  type Detalhamento,
} from "@/lib/controladoria/detalhamento";
import { exigirPermissao, resolverEscopo, resolverPeriodo } from "../_dados";
import { AvisoVazio, Secao, Tabela } from "../_componentes";
import { inputClass, larguraPainel, secondaryButtonClass } from "@/lib/ui";

// DETALHAMENTO — o último degrau do painel.
//
// Uma tela só, três fontes, porque a pergunta é sempre a mesma: "quais linhas
// somam este número?". Fazer três telas faria três layouts divergirem com o
// tempo e triplicaria o lugar onde o filtro pode deixar de bater com o total.
//
// O TOTAL DA CONSULTA APARECE SEMPRE, no topo, ao lado do critério que trouxe
// as linhas. É a peça que torna a tela auditável: quem chegou aqui clicando em
// "R$ 38.912,52" consegue conferir, sem sair do lugar, que a lista soma isso —
// e, quando não somar, vê o desencontro em vez de descobri-lo semanas depois
// numa reunião.

export const dynamic = "force-dynamic";

type Params = {
  fonte?: string;
  natureza?: string;
  dimensao?: string;
  valor?: string;
  parte?: string;
  conta?: string;
  empresa?: string;
  competencia?: string;
  volta?: string;
  // Período livre (AAAA-MM-DD), só para as perdas: juros, multa, tarifa,
  // desconto e juros + multa juntos.
  de?: string;
  ate?: string;
};

export default async function DetalhamentoPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const session = await exigirPermissao("painel");
  const escopo = await resolverEscopo(session.companyId, params.empresa);
  const periodo = resolverPeriodo(params.competencia);
  // A MESMA JANELA DO PAINEL, e não o mês inteiro: `montarJanelas` corta o mês
  // corrente no dia de referência. Usar `mesCompleto` aqui faria a lista somar
  // mais que o cartão que a abriu, no único mês em que alguém repara.
  const mes = montarJanelas(periodo.dataReferencia).mesAtual;

  const base = { companyId: session.companyId, conexaoId: escopo.conexaoId, periodo: mes };
  let dados: Detalhamento | null = null;
  let saldoInicialCents = 0;

  const livre = periodoLivre(params.de, params.ate);
  const periodoDasPerdas = livre ?? mes;
  const ehPerda = params.fonte === "perda" && (params.parte === "juros_multa" || ehComponenteDePerda(params.parte));

  if (params.fonte === "perda" && params.parte === "juros_multa") {
    dados = await detalharJurosEMulta({ ...base, periodo: periodoDasPerdas });
  } else if (params.fonte === "titulos") {
    const natureza = params.natureza === "RECEBER" ? "RECEBER" : "PAGAR";
    const dimensao = params.dimensao === "tipo" ? "tipo" : params.dimensao === "categoria" ? "categoria" : null;
    dados = await detalharTitulos({ ...base, natureza, dimensao, valor: params.valor ?? null });
  } else if (params.fonte === "perda" && ehComponenteDePerda(params.parte)) {
    dados = await detalharPerdas({ ...base, periodo: periodoDasPerdas, componente: params.parte });
  } else if (params.fonte === "caixa" && params.conta) {
    // `conexaoId:codigo` — o código da conta é único por conexão, não no grupo.
    const corte = params.conta.indexOf(":");
    if (corte > 0) {
      const detalhe = await detalharConta({
        companyId: session.companyId,
        conexaoId: params.conta.slice(0, corte),
        contaCorrenteCodigo: params.conta.slice(corte + 1),
        ate: periodo.dataReferencia,
      });
      dados = detalhe;
      saldoInicialCents = detalhe.saldoInicialCents;
    }
  }

  const volta = params.volta && params.volta.startsWith("/") ? params.volta : "/";

  if (!dados) {
    return (
      <div className={`${larguraPainel} space-y-6`}>
        <Voltar href={volta} />
        <AvisoVazio
          titulo="Nada para detalhar"
          descricao="Este endereço não diz o que abrir. Volte ao painel e clique numa das linhas de um cartão."
          acaoHref="/"
          acaoLabel="Voltar ao painel"
        />
      </div>
    );
  }

  const cortou = dados.quantidade > dados.linhas.length;
  const extras = dados.extras ?? [];
  const dataIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const consulta = new URLSearchParams({
    parte: params.parte ?? "",
    de: dataIso(periodoDasPerdas.inicio),
    ate: dataIso(periodoDasPerdas.fim),
    ...(params.empresa ? { empresa: params.empresa } : {}),
  });

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <Voltar href={volta} />

      <div>
        <h1 className="text-xl font-semibold text-slate-900">{dados.titulo}</h1>
        <p className="mt-1 text-sm text-slate-600">{dados.criterio}</p>
      </div>

      {ehPerda && (
        // O PERÍODO DAS PERDAS É LIVRE: "quanto pagamos de juros e multa no
        // ano?" não cabe num mês. GET simples — o endereço vira o filtro, e
        // dá para mandar o link.
        <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
          <input type="hidden" name="fonte" value="perda" />
          {params.empresa && <input type="hidden" name="empresa" value={params.empresa} />}
          <div>
            <label className="block text-xs font-medium text-slate-600">O quê</label>
            <select name="parte" defaultValue={params.parte} className={`${inputClass} w-56`}>
              <option value="juros_multa">Juros e multa por atraso</option>
              <option value="juros">Só juros por atraso</option>
              <option value="multa">Só multa por atraso</option>
              <option value="tarifa">Tarifa bancária</option>
              <option value="desconto">Desconto concedido a cliente</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">De</label>
            <input type="date" name="de" defaultValue={dataIso(periodoDasPerdas.inicio)} className={`${inputClass} w-40`} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Até</label>
            <input type="date" name="ate" defaultValue={dataIso(periodoDasPerdas.fim)} className={`${inputClass} w-40`} />
          </div>
          <button type="submit" className={secondaryButtonClass}>
            Aplicar
          </button>
          <a href={`/api/exportar/perdas?${consulta}`} className="text-sm font-medium text-blue-700 hover:underline">
            Baixar planilha (todas as linhas)
          </a>
        </form>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs font-medium text-slate-500">Soma das linhas</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{fmtBRL(dados.totalCents)}</p>
          {extras.length > 0 && (
            <p className="mt-0.5 text-xs text-slate-500">
              {extras.map((r, i) => `${r} ${fmtBRL(dados.totaisExtrasCents?.[i] ?? 0)}`).join(" · ")}
            </p>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs font-medium text-slate-500">Registros</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{fmtNumero(dados.quantidade)}</p>
        </div>
        {saldoInicialCents !== 0 && (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-xs font-medium text-slate-500">Saldo inicial cadastrado</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">{fmtBRL(saldoInicialCents)}</p>
            <p className="mt-0.5 text-[11px] text-slate-400">Saldo da conta = este valor + a soma das linhas</p>
          </div>
        )}
      </div>

      {cortou && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          A tela mostra as {fmtNumero(dados.limite)} maiores de {fmtNumero(dados.quantidade)} linhas. A soma acima é de
          TODAS elas, não só das exibidas — por isso o total pode ser maior que o que se soma na tabela.
        </p>
      )}

      <Secao titulo="Linha a linha" descricao="Da maior para a menor. Cada linha é um registro do espelho da Omie.">
        <Tabela
          colunas={[dados.rotuloData, "Empresa", "Documento", "Parceiro", "Classificação", ...extras, dados.rotuloValor]}
          alinharDireita={Array.from({ length: extras.length + 1 }, (_, i) => 5 + i)}
          vazio="Nenhum registro com este filtro."
          linhas={dados.linhas.map((l) => [
            <span key="d" className="whitespace-nowrap text-slate-600">
              {fmtData(l.data)}
            </span>,
            <span key="e" className="text-slate-600">
              {l.empresa}
            </span>,
            <span key="n" className="font-medium text-slate-800">
              {l.documento ?? "—"}
            </span>,
            <span key="p" className="text-slate-700">
              {l.parceiro ?? "—"}
            </span>,
            <span key="c" className="text-slate-500">
              {l.descricao ?? "—"}
            </span>,
            ...(l.extrasCents ?? []).map((v, i) => (
              <span key={`x${i}`} className="tabular-nums text-slate-600">
                {fmtBRL(v)}
              </span>
            )),
            <span key="v" className={`tabular-nums ${l.valorCents < 0 ? "text-red-700" : "text-slate-900"}`}>
              {fmtBRL(l.valorCents)}
            </span>,
          ])}
        />
      </Secao>
    </div>
  );
}

function Voltar({ href }: { href: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-700 hover:underline">
      <ArrowLeft className="h-4 w-4" />
      Voltar
    </Link>
  );
}
