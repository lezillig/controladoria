import Link from "next/link";
import { baseComIndiretosDoDre, indiretosDaEmpresa, indiretosDoDre, type IndiretoDoDre } from "@/lib/simulador/indiretosDoDre";
import { notFound } from "next/navigation";
import { dataReferenciaPadrao } from "@/lib/controladoria/ciclo";
import { baseVigente, paraNumero } from "@/lib/simulador/baseDeCustos";
import { calibrar, type Calibracao } from "@/lib/simulador/calibracao";
import { analisarCustosReais, carregarDadosReais } from "@/lib/simulador/custosReais";
import type { IndicadorReal } from "@/lib/simulador/aplicarReais";
import {
  carregarEstudo,
  entradaInicial,
  realizadosParaCalibracao,
  regrasDeMargem,
  ROTULO_STATUS_ESTUDO,
  ROTULO_TIPO_ESTUDO,
  ROTULO_TIPO_SERVICO,
  STATUS_ESTUDO,
} from "@/lib/simulador/estudos";
import { simular } from "@/lib/simulador/motor";
import { FONTES_ENERGIA, type EntradaSimulacao, type FonteEnergia } from "@/lib/simulador/tipos";
import { CHAVE_PRECO_ENERGIA, PRECO_ENERGIA_PADRAO } from "@/lib/simulador/energia";
import { larguraPainel } from "@/lib/ui";
import { exigirPermissao, podeAcao } from "../../_dados";
import EditorEstudo from "./EditorEstudo";
import Acompanhamento from "./abas/Acompanhamento";

// UM ESTUDO — o editor e o acompanhamento.
//
// O servidor carrega o que o navegador não pode buscar sozinho: a definição do
// estudo, a base de custos vigente, as regras de margem, os custos reais da
// empresa (medidos na controladoria) e a calibração da última versão lançada
// contra o realizado. Daí em diante a conta roda no navegador, com o mesmo
// motor, e só volta ao servidor para salvar ou exportar.
//
// Custos reais são um extra: se a leitura falhar (Omie fora, gestão fora), o
// estudo abre normalmente e o painel diz o que não pôde ser medido.

export default async function EstudoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ versao?: string; salva?: string }> }) {
  const session = await exigirPermissao("simulador");
  const [podeEditar, podeConsultarEspecialista] = await Promise.all([podeAcao(session, "gerir-simulador"), podeAcao(session, "investigar")]);
  const { id } = await params;
  const { versao, salva } = await searchParams;

  const carregado = await carregarEstudo(session.companyId, id);
  if (!carregado) notFound();
  const { estudo, versoes } = carregado;
  const versaoPedida = versao && estudo.simulacoes.some((s) => s.id === versao) ? versao : null;

  let indicadores: IndicadorReal[] = [];
  let lacunas: string[] = [];
  let dados: Awaited<ReturnType<typeof carregarDadosReais>> | null = null;
  try {
    dados = await carregarDadosReais(session.companyId, null, dataReferenciaPadrao());
    const analise = analisarCustosReais(dados);
    indicadores = analise.indicadores;
    lacunas = [...new Set([...dados.avisos, ...analise.lacunas])];
  } catch {
    lacunas = ["Os custos reais não puderam ser lidos agora. O estudo segue com a base e os padrões."];
  }

  // Os indiretos que a base não tem vêm do DRE consolidado (ver
  // indiretosDoDre.ts): é com eles que o estudo novo calcula a administração.
  const baseGravada = await baseVigente(session.companyId);
  let doDre = new Map<string, IndiretoDoDre>();
  if (dados) {
    try {
      doDre = await indiretosDaEmpresa(session.companyId, dataReferenciaPadrao(), baseGravada, dados);
    } catch {
      doDre = indiretosDoDre(dados);
    }
  }
  const base = baseComIndiretosDoDre(baseGravada, doDre);
  const inicial = await entradaInicial(session.companyId, carregado, versaoPedida, base);
  const { margemMinima, margemAlvo } = regrasDeMargem(base);

  // Calibração: a última versão LANÇADA (a que virou preço) contra o realizado.
  const lancada = estudo.simulacoes.find((s) => s.status === "LANCADA");
  let calibracao: Calibracao | null = null;
  if (lancada && estudo.realizados.length > 0) {
    const entradaLancada = lancada.entrada as unknown as EntradaSimulacao;
    try {
      calibracao = calibrar(simular(entradaLancada), entradaLancada.premissas.contrato.mesesCustoFixo, realizadosParaCalibracao(estudo.realizados));
    } catch {
      calibracao = null;
    }
  }

  const subtitulo = [
    ROTULO_TIPO_ESTUDO[estudo.tipo as keyof typeof ROTULO_TIPO_ESTUDO] ?? estudo.tipo,
    ROTULO_TIPO_SERVICO[estudo.tipoServico as keyof typeof ROTULO_TIPO_SERVICO] ?? estudo.tipoServico,
    estudo.orgao ?? estudo.cliente,
    estudo.numeroEdital,
    [estudo.municipio, estudo.uf].filter(Boolean).join("/"),
  ]
    .filter(Boolean)
    .join(" · ");

  const acompanhamento = (
    <Acompanhamento
      estudoId={estudo.id}
      versoes={versoes.map((v) => ({ ...v, criadoEm: v.criadoEm.toISOString() }))}
      versaoAberta={inicial.versaoBase}
      lances={estudo.lances.map((l) => {
        const precos = (l.precos as { item: string; preco: number }[] | null) ?? [];
        return {
          id: l.id,
          fase: l.fase,
          dataHora: l.dataHora.toISOString(),
          preco: precos[0]?.preco ?? null,
          valorTotal: paraNumero(l.valorTotal),
          observacao: l.observacao,
          autor: l.registradoPorNome,
        };
      })}
      resultado={{
        status: estudo.status,
        posicao: estudo.resultadoPosicao,
        vencedor: estudo.resultadoVencedor,
        precoVencedor: paraNumero(estudo.resultadoPrecoKm),
        valorTotal: paraNumero(estudo.resultadoValorTotal),
        data: estudo.resultadoData ? estudo.resultadoData.toISOString().slice(0, 10) : null,
        observacao: estudo.resultadoObservacao,
      }}
      statusOpcoes={STATUS_ESTUDO.map((s) => ({ valor: s, rotulo: ROTULO_STATUS_ESTUDO[s] }))}
      realizados={estudo.realizados.map((r) => ({ competencia: r.competencia, kmRealizado: paraNumero(r.kmRealizado), faturamento: paraNumero(r.faturamento), fonte: r.fonte }))}
      calibracao={calibracao}
      versaoCalibrada={lancada?.versao ?? null}
      podeEditar={podeEditar}
    />
  );

  // Habilitação: só na licitação (estudo público) ou quando o edital lido trouxe
  // a lista.
  const habilitacao =
    estudo.esfera === "PUBLICO" || estudo.habilitacao.length > 0
      ? {
          dataSessao: estudo.dataSessao ? estudo.dataSessao.toISOString().slice(0, 10) : null,
          documentos: estudo.habilitacao.map((d) => ({
            id: d.id,
            grupo: d.grupo,
            documento: d.documento,
            exigencia: d.exigencia,
            fonte: d.fonte,
            situacao: d.situacao,
            validade: d.validade ? d.validade.toISOString().slice(0, 10) : null,
            observacao: d.observacao,
            atualizadoPor: d.atualizadoPor,
          })),
        }
      : null;

  return (
    <div className={`${larguraPainel} space-y-4`}>
      <EditorEstudo
        key={`${estudo.id}:${inicial.versaoBase ?? 0}:${versaoPedida ?? ""}`}
        estudo={{
          id: estudo.id,
          nome: estudo.nome,
          subtitulo,
          status: estudo.status,
          statusRotulo: ROTULO_STATUS_ESTUDO[estudo.status as keyof typeof ROTULO_STATUS_ESTUDO] ?? estudo.status,
          inicioPrevisto: estudo.inicioPrevisto ? estudo.inicioPrevisto.toISOString().slice(0, 7) : null,
        }}
        entradaInicial={inicial.entrada}
        origemInicial={inicial.origem}
        daBase={inicial.daBase ?? null}
        pendente={inicial.pendente === true}
        versaoBase={inicial.versaoBase}
        versaoAntiga={Boolean(versaoPedida) && versaoPedida !== estudo.simulacoes[0]?.id}
        baseEm={inicial.baseEm ? inicial.baseEm.toISOString() : null}
        podeEditar={podeEditar}
        margemMinima={margemMinima}
        margemAlvo={margemAlvo}
        indicadores={indicadores}
        lacunas={lacunas}
        acompanhamento={acompanhamento}
        habilitacao={habilitacao}
        podeConsultarEspecialista={podeConsultarEspecialista}
        pracas={base.pedagios.map((p) => ({
          chave: p.chave,
          praca: String(p.praca ?? p.chave),
          concessionaria: (p.concessionaria as string | null) ?? null,
          tarifaVan: paraNumero(p.tarifaVan),
          tarifaMicro: paraNumero(p.tarifaMicro),
          tarifaOnibus2: paraNumero(p.tarifaOnibus2),
          tarifaOnibus3: paraNumero(p.tarifaOnibus3),
          descontoTagPct: paraNumero(p.descontoTagPct),
        }))}
        precosEnergia={Object.fromEntries(FONTES_ENERGIA.map((f) => [f, base.parametros.get(CHAVE_PRECO_ENERGIA[f])?.valor ?? PRECO_ENERGIA_PADRAO[f]])) as Record<FonteEnergia, number>}
        avisoInicial={salva && /^\d{1,5}$/.test(salva) ? `Versão ${salva} salva.` : null}
      />
      {estudo.regras.length > 0 && <RegrasDoEdital regras={estudo.regras.map((r) => ({ tema: r.tema, texto: r.texto, fonte: r.fonte }))} />}
      <p className="text-xs text-slate-500">
        <Link href="/simulador" className="text-blue-700 hover:underline">
          ← Todos os estudos
        </Link>
      </p>
    </div>
  );
}

// AS REGRAS DO EDITAL — o que a leitura do edital (ou o histórico importado)
// registrou: exigências que pesam no custo e o que precisou ser suposto. É a
// lista de conferência antes de lançar preço.
const ROTULO_TEMA: Record<string, string> = {
  SUPOSICAO: "Suposições da leitura — conferir",
  VEICULO: "Veículos",
  PESSOAL: "Pessoal",
  OPERACAO: "Operação",
  CONTRATUAL: "Contrato e pagamento",
  TRIBUTARIO: "Tributos",
  PENALIDADE: "Penalidades",
  OUTRO: "Outras",
};
function RegrasDoEdital({ regras }: { regras: { tema: string; texto: string; fonte: string | null }[] }) {
  const temas = [...new Set(regras.map((r) => r.tema))].sort((a, b) => (a === "SUPOSICAO" ? -1 : b === "SUPOSICAO" ? 1 : 0));
  return (
    <details className="rounded-xl border border-slate-200 bg-white p-4" open={regras.some((r) => r.tema === "SUPOSICAO")}>
      <summary className="cursor-pointer text-sm font-semibold text-slate-800">Regras do edital ({regras.length})</summary>
      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {temas.map((t) => (
          <div key={t}>
            <p className={`mb-1 text-xs font-semibold uppercase tracking-wide ${t === "SUPOSICAO" ? "text-amber-700" : "text-slate-500"}`}>{ROTULO_TEMA[t] ?? t}</p>
            <ul className="space-y-1 text-sm text-slate-700">
              {regras
                .filter((r) => r.tema === t)
                .map((r, k) => (
                  <li key={k}>
                    {r.texto}
                    {r.fonte && <span className="ml-1 text-xs text-slate-400">({r.fonte})</span>}
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}
