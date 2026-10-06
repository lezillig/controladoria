import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { larguraPainel } from "@/lib/ui";
import { fmtBRL } from "@/lib/controladoria/format";
import { rotuloDeClassificacao } from "@/lib/controladoria/dre";
import { montarDreNoBanco } from "@/lib/controladoria/dreNoBanco";
import { ultimoMesFechado } from "@/lib/controladoria/periodos";
import { acoesNoOmie, sugestoesDeReclassificacao, type CategoriaParaRevisao } from "@/lib/controladoria/reclassificacoes";
import { escopoDaPagina, podeAcao } from "../../_dados";
import { Kpi, Secao, SeletorEmpresa, Tabela } from "../../_componentes";
import ListaSugestoes from "./ListaSugestoes";

// RECLASSIFICAÇÕES SUGERIDAS.
//
// A revisão de custos de outubro/2026 (reclassificacoes.ts) aplicada às
// categorias com movimento nos 12 meses fechados: cada uma diz de que linha e
// subgrupo sai, para onde vai e por quê, com o valor de 12 meses. Nada muda
// sem confirmação — a pessoa marca o que aceita e grava.

export default async function ReclassificarPage({ searchParams }: { searchParams: Promise<{ empresa?: string }> }) {
  const params = await searchParams;
  const { session, escopo, periodo, conexoes } = await escopoDaPagina("custos", params.empresa);
  const podeClassificar = await podeAcao(session, "classificar-dre");

  const ultimo = ultimoMesFechado(periodo.dataReferencia);
  const inicio = new Date(ultimo.inicio.getFullYear(), ultimo.inicio.getMonth() - 11, 1);
  const doze = { inicio, fim: ultimo.fim, rotulo: "12 meses" };
  const vazio = { inicio: new Date(0), fim: new Date(0), rotulo: "" };

  const guardadas = await prisma.dreClassificacao.findMany({
    where: { companyId: session.companyId },
    select: { categoriaCodigo: true, linha: true, subgrupo: true, origem: true },
  });
  const classificacoes = new Map(
    guardadas.map((c) => [c.categoriaCodigo, { linha: c.linha, subgrupo: c.subgrupo, confirmada: c.origem === "CONFIRMADA" }])
  );
  const dre = await montarDreNoBanco(
    { companyId: session.companyId, conexaoId: escopo.conexaoId, janela: { desde: inicio, ate: null } },
    doze,
    vazio,
    classificacoes,
    { regime: "competencia", incluirTitulos: false }
  );

  // Uma entrada por categoria: as de pessoas aparecem nas duas linhas
  // (operação e corporativo) e são classificadas uma vez só.
  const porCodigo = new Map<string, CategoriaParaRevisao>();
  for (const linha of dre.linhas) {
    for (const item of linha.itens) {
      const atual = porCodigo.get(item.categoriaCodigo);
      if (atual) {
        atual.valorCents += Math.abs(item.valorCents);
        continue;
      }
      porCodigo.set(item.categoriaCodigo, {
        codigo: item.categoriaCodigo,
        descricao: item.descricao,
        linha: item.linhaClassificada ?? linha.chave,
        subgrupo: item.subgrupo,
        confirmada: item.confirmada,
        valorCents: Math.abs(item.valorCents),
      });
    }
  }
  const categorias = [...porCodigo.values()];
  const sugestoes = sugestoesDeReclassificacao(categorias);
  const deLinha = sugestoes.filter((s) => s.tipo === "LINHA");
  const deSubgrupo = sugestoes.filter((s) => s.tipo === "SUBGRUPO");
  const noOmie = acoesNoOmie(categorias);

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div className="space-y-3">
        <div>
          <Link href={`/custos${escopo.conexaoId ? `?empresa=${escopo.conexaoId}` : ""}`} className="text-xs font-medium text-blue-700 hover:underline">
            ← Custos e DRE
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">Reclassificações sugeridas</h1>
          <p className="mt-1 max-w-4xl text-sm text-slate-500">
            A revisão das classificações do DRE com olhar de custos e orçamento, aplicada às categorias com movimento de{" "}
            {doze.inicio.toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" })} a{" "}
            {doze.fim.toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" })}. Cada linha diz de onde a categoria sai, para onde vai e
            por quê. Nada muda até você marcar e gravar; o que você gravar vale como classificação confirmada, com seu nome no histórico.
          </p>
        </div>
        <SeletorEmpresa conexoes={conexoes} ativa={escopo.conexaoId} rota="/custos/reclassificar" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Kpi
          rotulo="Mudam de linha"
          valor={String(deLinha.length)}
          apoio={`${fmtBRL(deLinha.reduce((a, s) => a + s.valorCents, 0))} em 12 meses`}
          tom={deLinha.length ? "atencao" : "bom"}
        />
        <Kpi rotulo="Ganham subgrupo do catálogo" valor={String(deSubgrupo.length)} apoio="mesma linha, subgrupo com natureza de custo" />
        <Kpi rotulo="Pedem ação no Omie" valor={String(noOmie.length)} apoio="categoria que mistura naturezas" />
      </div>

      <Secao
        titulo="De → para"
        descricao="Marque o que aceita e grave. As mudanças de linha vêm primeiro, da maior para a menor; depois os subgrupos."
      >
        <ListaSugestoes sugestoes={sugestoes} podeClassificar={podeClassificar} />
      </Secao>

      {noOmie.length > 0 && (
        <Secao
          titulo="Ação no Omie"
          descricao="Categorias que misturam naturezas: nenhuma linha do DRE está certa para elas inteiras. O conserto é abrir a categoria no Omie."
        >
          <Tabela
            colunas={["Categoria", "Está em", "12 meses", "O que fazer"]}
            alinharDireita={[2]}
            linhas={noOmie.map((c) => [
              c.descricao,
              rotuloDeClassificacao(c.linha).replace(/^\([+-]\)\s*/, "").replace(/ \(operação ou corporativo, pela empresa\)$/, ""),
              fmtBRL(c.valorCents),
              <span key="m" className="text-xs text-slate-600">
                {c.motivo}
              </span>,
            ])}
          />
        </Secao>
      )}
    </div>
  );
}
