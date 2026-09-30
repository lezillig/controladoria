import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { fmtBRL, fmtData, fmtNumero, fmtPercent } from "@/lib/controladoria/format";
import { LINHAS_DRE } from "@/lib/controladoria/dre";
import {
  LINHAS_DE_GRUPO,
  mesesDoHorizonte,
  orcadoVersusRealizado,
  projetar,
  rotuloDaCompetencia,
  sensibilidade,
} from "@/lib/controladoria/projecao";
import {
  baseHistoricaNoBanco,
  cenarioDoRegistro,
  contratosDoEscopo,
  escopoTexto,
  orcamentoVigente,
  premissasDoJson,
} from "@/lib/controladoria/projecaoNoBanco";
import { escopoDaPagina, podeAcao } from "../_dados";
import { AvisoVazio, Kpi, Secao, Tabela } from "../_componentes";
import Filtros from "../Filtros";
import CenarioForm, { type PremissaForm } from "./CenarioForm";
import TabelaProjecao from "./TabelaProjecao";
import { excluirCenario } from "./actions";
import GravarOrcamentoButton from "./GravarOrcamentoButton";
import { larguraPainel } from "@/lib/ui";

// CENÁRIOS E ORÇAMENTO.
//
// A tela responde "como fecha o ano, e o que muda se…": a projeção base dos
// próximos doze meses na estrutura do DRE, os cenários salvos com as premissas
// de cada um, a sensibilidade das três linhas que mais pesam, e o orçado
// contra o realizado do ano quando há orçamento gravado.
//
// A base termina no último mês fechado e a tela diz qual é. O mês em curso é
// o primeiro projetado — nunca base.

// As duas linhas de pessoas (operação e corporativo / administrativo) no lugar
// da antiga linha única — ver LINHAS_DRE em dre.ts.
const LINHAS_DE_SENSIBILIDADE = ["RECEITA_BRUTA", "DESPESA_VEICULOS", "DESPESA_SALARIOS", "DESPESA_SALARIOS_CORPORATIVO"] as const;

export default async function CenariosPage({
  searchParams,
}: {
  searchParams: Promise<{ empresa?: string; cenario?: string }>;
}) {
  const params = await searchParams;
  const { session, escopo, periodo, conexoes } = await escopoDaPagina("cenarios", params.empresa);
  const podeEditar = await podeAcao(session, "gerir-cenarios");
  const dataReferencia = periodo.dataReferencia;
  const projecaoEscopo = { companyId: session.companyId, conexaoId: escopo.conexaoId };
  const texto = escopoTexto(escopo.conexaoId);

  const [base, contratos, cenarios] = await Promise.all([
    baseHistoricaNoBanco(projecaoEscopo, dataReferencia),
    contratosDoEscopo(projecaoEscopo),
    prisma.cenario.findMany({ where: { companyId: session.companyId, escopo: texto }, orderBy: { atualizadoEm: "desc" } }),
  ]);

  const selecionado = cenarios.find((c) => c.id === params.cenario) ?? null;
  const cenario = cenarioDoRegistro(selecionado);
  const meses = mesesDoHorizonte(dataReferencia, 12);
  const projecao = projetar(base, contratos, meses, cenario);
  const baseSemPremissa = selecionado ? projetar(base, contratos, meses) : projecao;
  const sens = sensibilidade(base, contratos, meses, cenario, [...LINHAS_DE_SENSIBILIDADE]);

  const anoCorrente = dataReferencia.getFullYear();
  const anosNoHorizonte = [...new Set(meses.map((m) => Number(m.slice(0, 4))))];
  const orcamentos = await Promise.all(anosNoHorizonte.map((ano) => orcamentoVigente(projecaoEscopo, ano).then((o) => ({ ano, ...o }))));
  const orcamentoDoAno = orcamentos.find((o) => o.ano === anoCorrente);
  const comparacao = orcamentoDoAno && orcamentoDoAno.linhas.length > 0 ? orcadoVersusRealizado(orcamentoDoAno.linhas, base, anoCorrente) : [];

  const contratadaNoHorizonte = projecao.receitaContratada.reduce((a, r) => a + r.cents, 0);
  const receitaHistorica = baseSemPremissa.baselineReceita.reduce((a, b) => a + b.valorCents, 0);
  const mesesSemBase = projecao.baselineReceita.filter((b) => b.metodo === "SEM_BASE").length;
  const baseCurta = base.competencias.length < 12;

  const linhasOpcao = LINHAS_DRE.filter((l) => (LINHAS_DE_GRUPO as string[]).includes(l.chave)).map((l) => ({ chave: l.chave, rotulo: l.rotulo.replace(/^\([-+]\)\s*/, "") }));
  const inicial = {
    id: selecionado?.id ?? null,
    nome: selecionado?.nome ?? "",
    baseReceita: cenario.baseReceita,
    observacao: selecionado?.observacao ?? null,
    premissas: selecionado ? (premissasDoJson(selecionado.premissas) as PremissaForm[]) : [],
  };
  const linkCenario = (id: string | null) => {
    const p = new URLSearchParams();
    if (escopo.conexaoId) p.set("empresa", escopo.conexaoId);
    if (id) p.set("cenario", id);
    const q = p.toString();
    return q ? `/cenarios?${q}` : "/cenarios";
  };
  const ebitBase = baseSemPremissa.ebitCents;

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Cenários e orçamento</h1>
        <p className="mt-1 text-sm text-slate-500">
          Projeção dos próximos doze meses na estrutura do DRE, a partir de {projecao.base.mesesDeBase > 0 ? `${fmtNumero(projecao.base.mesesDeBase)} meses fechados` : "uma base ainda vazia"}
          {projecao.base.primeiraCompetencia ? ` (${rotuloDaCompetencia(projecao.base.primeiraCompetencia)} a ${rotuloDaCompetencia(projecao.base.ultimaCompetenciaFechada)})` : ""}. O mês em curso é o
          primeiro projetado, nunca base. Cada mês parte do mesmo mês do ano anterior, aparado pelo desvio mediano e corrigido pela tendência dos últimos doze meses; as premissas do
          cenário entram por cima, e ficam listadas.
        </p>
      </div>

      <Filtros conexoes={conexoes} empresaAtiva={escopo.conexaoId} competencias={[]} competenciaAtiva={null} rota="/cenarios" extras={{ cenario: params.cenario }} />

      {baseCurta && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-900">Base curta para projetar</p>
          <p className="mt-1 text-xs leading-relaxed text-amber-800">
            Há {fmtNumero(base.competencias.length)} mês(es) fechado(s) na base. Com menos de doze, não há sazonalidade a repetir e a projeção usa a mediana dos meses que existem; com
            menos de três, fica zerada. A carga histórica em Sincronização é o que resolve.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi rotulo="Receita líquida (12 meses)" valor={fmtBRL(projecao.receitaLiquidaCents)} apoio={selecionado ? `cenário "${selecionado.nome}"` : "projeção base"} />
        <Kpi
          rotulo="EBIT (12 meses)"
          valor={fmtBRL(projecao.ebitCents)}
          apoio={selecionado ? `${projecao.ebitCents - ebitBase >= 0 ? "+" : ""}${fmtBRL(projecao.ebitCents - ebitBase)} contra a base` : `${fmtPercent(projecao.receitaLiquidaCents > 0 ? (projecao.ebitCents / projecao.receitaLiquidaCents) * 100 : null)} da receita líquida`}
          tom={projecao.ebitCents < 0 ? "ruim" : "bom"}
        />
        <Kpi rotulo="Resultado líquido (12 meses)" valor={fmtBRL(projecao.resultadoLiquidoCents)} tom={projecao.resultadoLiquidoCents < 0 ? "ruim" : "neutro"} />
        <Kpi
          rotulo="Receita contratada (12 meses)"
          valor={fmtBRL(contratadaNoHorizonte)}
          apoio={
            contratos.length === 0
              ? "nenhum contrato de serviço sincronizado"
              : `${fmtPercent(receitaHistorica > 0 ? (contratadaNoHorizonte / receitaHistorica) * 100 : null, 0)} da receita histórica projetada · ${fmtNumero(projecao.receitaContratada[0]?.contratos ?? 0)} contrato(s) ativo(s) no 1º mês`
          }
        />
      </div>

      <Secao
        titulo={selecionado ? `Projeção — ${selecionado.nome}` : "Projeção base"}
        descricao={
          projecao.baseReceita === "CONTRATADA"
            ? "Receita bruta pelos contratos ativos da Omie onde há contrato; pela série onde não há."
            : "Receita bruta pela série fechada, sazonal e corrigida pela tendência."
        }
        acao={
          selecionado ? (
            <Link href={linkCenario(null)} className="text-xs font-medium text-blue-700 hover:underline">
              ver projeção base
            </Link>
          ) : undefined
        }
      >
        {base.competencias.length < 3 ? (
          <AvisoVazio titulo="Sem base para projetar" descricao="São necessários pelo menos três meses fechados. Faça a carga histórica em Sincronização." acaoHref="/sincronizacao" acaoLabel="Ir para Sincronização" />
        ) : (
          <>
            <TabelaProjecao projecao={projecao} />
            {mesesSemBase > 0 && <p className="mt-2 text-xs text-amber-700">{fmtNumero(mesesSemBase)} mês(es) do horizonte sem base de receita — a série não alcança o mesmo mês do ano anterior.</p>}
            {projecao.premissasAplicadas.length > 0 && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Premissas deste cenário</p>
                <ul className="mt-1 space-y-0.5 text-sm text-slate-700">
                  {projecao.premissasAplicadas.map((p, i) => (
                    <li key={i}>
                      {LINHAS_DRE.find((l) => l.chave === p.linha)?.rotulo.replace(/^\([-+]\)\s*/, "")} {p.percentual > 0 ? "+" : ""}
                      {p.percentual}% de {rotuloDaCompetencia(p.desde)} {p.ate ? `até ${rotuloDaCompetencia(p.ate)}` : "em diante"}
                      {p.descricao ? <span className="text-slate-500"> — {p.descricao}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </Secao>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Secao titulo="Sensibilidade" descricao="O efeito de cada linha variar 10% para cada lado, desde o primeiro mês, mantido o resto do cenário. É onde o resultado é mais frágil.">
          <Tabela
            colunas={["Linha", "Variação", "Efeito no EBIT", "Efeito no resultado"]}
            alinharDireita={[1, 2, 3]}
            linhas={sens.map((s) => [
              s.rotulo.replace(/^\([-+]\)\s*/, ""),
              `${s.percentual > 0 ? "+" : ""}${s.percentual}%`,
              <span key="e" className={s.efeitoEbitCents < 0 ? "text-red-700" : "text-emerald-700"}>
                {s.efeitoEbitCents > 0 ? "+" : ""}
                {fmtBRL(s.efeitoEbitCents)}
              </span>,
              <span key="r" className={s.efeitoResultadoCents < 0 ? "text-red-700" : "text-emerald-700"}>
                {s.efeitoResultadoCents > 0 ? "+" : ""}
                {fmtBRL(s.efeitoResultadoCents)}
              </span>,
            ])}
          />
        </Secao>

        <Secao titulo="Cenários salvos" descricao="Cada um com suas premissas. Escolher um recalcula a projeção acima.">
          <Tabela
            colunas={["Cenário", "Premissas", "Receita", "Atualizado", ...(podeEditar ? [""] : [])]}
            alinharDireita={[1]}
            vazio="Nenhum cenário salvo para este escopo. Monte o primeiro no formulário abaixo."
            linhas={cenarios.map((c) => [
              <span key="n">
                <Link href={linkCenario(c.id)} className={`font-medium hover:underline ${c.id === selecionado?.id ? "text-blue-800" : "text-slate-800"}`}>
                  {c.nome}
                </Link>
                <span className="block text-xs text-slate-400">
                  {c.tipo === "ORCAMENTO" ? "virou orçamento · " : ""}
                  {c.criadoPorNome ?? "—"}
                </span>
              </span>,
              fmtNumero(premissasDoJson(c.premissas).length),
              c.baseReceita === "CONTRATADA" ? "contratos" : "série",
              fmtData(c.atualizadoEm),
              ...(podeEditar
                ? [
                    <form key="f" action={excluirCenario}>
                      <input type="hidden" name="id" value={c.id} />
                      <button type="submit" className="text-xs font-medium text-red-700 hover:underline">
                        excluir
                      </button>
                    </form>,
                  ]
                : []),
            ])}
          />
        </Secao>
      </div>

      {podeEditar && (
        <Secao
          titulo={selecionado ? `Editar "${selecionado.nome}"` : "Novo cenário"}
          descricao="Uma premissa por linha do DRE, com percentual e período. Diesel mexe em veículos; reajuste de contrato, em receita bruta; CCT, em pessoas."
          acao={
            selecionado ? (
              <Link href={linkCenario(null)} className="text-xs font-medium text-blue-700 hover:underline">
                começar um novo
              </Link>
            ) : undefined
          }
        >
          <CenarioForm key={selecionado?.id ?? "novo"} linhas={linhasOpcao} meses={projecao.meses} empresa={escopo.conexaoId} inicial={inicial} />
          {selecionado && (
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
              {anosNoHorizonte.map((ano) => {
                const vigente = orcamentos.find((o) => o.ano === ano);
                return (
                  <GravarOrcamentoButton
                    key={ano}
                    cenarioId={selecionado.id}
                    ano={ano}
                    empresa={escopo.conexaoId}
                    apoio={vigente && vigente.versao > 0 ? `versão ${vigente.versao} gravada em ${fmtData(vigente.criadoEm)}; esta será a ${vigente.versao + 1}` : "sem orçamento gravado"}
                  />
                );
              })}
            </div>
          )}
        </Secao>
      )}

      <Secao
        titulo={`Orçado × realizado ${anoCorrente}`}
        descricao={
          comparacao.length > 0
            ? `Versão ${orcamentoDoAno?.versao} do orçamento, sobre os meses fechados que têm orçamento: ${comparacao[0].meses.map(rotuloDaCompetencia).join(", ")}. Desvio no sentido do resultado: gastar menos que o orçado é favorável.`
            : "Ainda não há orçamento gravado para meses fechados deste ano. Grave um cenário como orçamento e, a partir do primeiro mês que fechar, a comparação aparece aqui."
        }
      >
        {comparacao.length > 0 && (
          <Tabela
            colunas={["Linha", "Orçado", "Realizado", "Desvio", "%"]}
            alinharDireita={[1, 2, 3, 4]}
            linhas={comparacao
              .filter((l) => l.tipo === "SUBTOTAL" || l.orcadoCents !== 0 || l.realizadoCents !== 0)
              .map((l) => [
                <span key="n" className={l.tipo === "SUBTOTAL" ? "font-semibold text-slate-900" : "text-slate-700"}>
                  {l.rotulo}
                </span>,
                fmtBRL(l.orcadoCents),
                fmtBRL(l.realizadoCents),
                <span key="d" className={l.desvioCents < 0 ? "font-semibold text-red-700" : "font-semibold text-emerald-700"}>
                  {l.desvioCents > 0 ? "+" : ""}
                  {fmtBRL(l.desvioCents)}
                </span>,
                fmtPercent(l.desvioPercent),
              ])}
          />
        )}
      </Secao>
    </div>
  );
}
