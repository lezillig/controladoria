"use server";

import { partesDaChave } from "@/lib/controladoria/chaveCategoria";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { LINHAS_CLASSIFICAVEIS, rotuloDeClassificacao } from "@/lib/controladoria/dre";
import { registrarEvento } from "@/lib/controladoria/trilha";
import { exigirPermissao } from "../_dados";

// CLASSIFICAR UMA CATEGORIA NUMA LINHA DO DRE.
//
// A estrutura do DRE é fixa; isto é a ligação entre ela e o plano de
// categorias real. Classificar é ato de gente, e por isso passa por aqui em
// vez de ser uma tabela no código: a pessoa que diz "combustível é custo do
// serviço" está decidindo o lucro bruto da empresa, e essa decisão precisa de
// dono e de data.

export type ResultadoClassificacao = { erro?: string; ok?: boolean };

// Subgrupo é texto livre — é o eixo de análise que a empresa monta por cima da
// estrutura legal. Livre não quer dizer sem limite: um nome de trezentos
// caracteres quebra o alinhamento da coluna de subtotais e ninguém desfaz.
const MAX_SUBGRUPO = 40;

export async function classificarCategoria(formData: FormData): Promise<ResultadoClassificacao> {
  const session = await exigirPermissao("classificar-dre");

  const categoriaCodigo = String(formData.get("categoriaCodigo") ?? "").trim();
  const linha = String(formData.get("linha") ?? "").trim();
  const subgrupoBruto = String(formData.get("subgrupo") ?? "").trim();

  if (!categoriaCodigo) return { erro: "Categoria não informada." };
  if (!(LINHAS_CLASSIFICAVEIS as readonly string[]).includes(linha)) {
    // Só as linhas de GRUPO. Um subtotal ("Lucro bruto") aceitando categoria
    // faria o valor entrar duas vezes — uma no grupo, outra no cálculo — e a
    // demonstração deixaria de fechar sem nada apontando onde.
    return { erro: "Linha do DRE inválida." };
  }

  // Na chave "código@EMPRESA" (código repetido entre as contas com nomes
  // diferentes), a categoria é a daquela empresa — ver chaveCategoria.ts.
  const partes = partesDaChave(categoriaCodigo);
  const categoria = await prisma.omieCategoria.findFirst({
    where: { companyId: session.companyId, codigo: partes.codigo, ...(partes.empresa ? { conexaoApelido: partes.empresa } : {}) },
    select: { descricao: true },
  });

  const subgrupo = subgrupoBruto === "" ? null : subgrupoBruto.slice(0, MAX_SUBGRUPO);
  const anterior = await prisma.dreClassificacao.findUnique({
    where: { companyId_categoriaCodigo: { companyId: session.companyId, categoriaCodigo } },
    select: { linha: true, subgrupo: true, origem: true },
  });

  await prisma.dreClassificacao.upsert({
    where: { companyId_categoriaCodigo: { companyId: session.companyId, categoriaCodigo } },
    create: {
      companyId: session.companyId,
      categoriaCodigo,
      linha,
      subgrupo,
      origem: "CONFIRMADA",
      userNome: session.name,
    },
    update: { linha, subgrupo, origem: "CONFIRMADA", userNome: session.name },
  });

  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "DRE_CATEGORIA_CLASSIFICADA",
    entidadeTipo: "OmieCategoria",
    entidadeId: categoriaCodigo,
    descricao:
      `Categoria "${categoria?.descricao ?? categoriaCodigo}" classificada em ${rotuloDeClassificacao(linha)}` +
      `${subgrupo ? `, subgrupo "${subgrupo}"` : ""}.`,
    antes: anterior ?? undefined,
    depois: { linha, subgrupo, origem: "CONFIRMADA" },
  });

  revalidatePath("/custos");
  return { ok: true };
}

// RECLASSIFICAÇÕES EM LOTE — as sugestões marcadas na tela de reclassificações
// (reclassificacoes.ts). Cada uma é a mesma decisão de classificarCategoria,
// gravada como CONFIRMADA em nome de quem marcou; a trilha guarda o lote
// inteiro, com o antes e o depois de cada categoria.
const MAX_LOTE = 1000;

export async function aplicarReclassificacoes(json: string): Promise<{ erro?: string; aplicadas?: number }> {
  const session = await exigirPermissao("classificar-dre");

  let itens: { codigo: string; linha: string; subgrupo: string | null }[];
  try {
    const bruto = JSON.parse(json) as unknown;
    if (!Array.isArray(bruto)) return { erro: "Lista inválida." };
    itens = bruto.map((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      return {
        codigo: String(o.codigo ?? "").trim(),
        linha: String(o.linha ?? "").trim(),
        subgrupo: typeof o.subgrupo === "string" && o.subgrupo.trim() ? o.subgrupo.trim().slice(0, MAX_SUBGRUPO) : null,
      };
    });
  } catch {
    return { erro: "Lista inválida." };
  }
  if (itens.length === 0) return { erro: "Nenhuma sugestão marcada." };
  if (itens.length > MAX_LOTE) return { erro: `No máximo ${MAX_LOTE} por vez.` };
  const invalida = itens.find((i) => !i.codigo || !(LINHAS_CLASSIFICAVEIS as readonly string[]).includes(i.linha));
  if (invalida) return { erro: `Classificação inválida para ${invalida.codigo || "categoria sem código"}.` };

  const anteriores = await prisma.dreClassificacao.findMany({
    where: { companyId: session.companyId, categoriaCodigo: { in: itens.map((i) => i.codigo) } },
    select: { categoriaCodigo: true, linha: true, subgrupo: true, origem: true },
  });
  const antes = new Map(anteriores.map((a) => [a.categoriaCodigo, a]));

  await prisma.$transaction(
    itens.map((i) =>
      prisma.dreClassificacao.upsert({
        where: { companyId_categoriaCodigo: { companyId: session.companyId, categoriaCodigo: i.codigo } },
        create: { companyId: session.companyId, categoriaCodigo: i.codigo, linha: i.linha, subgrupo: i.subgrupo, origem: "CONFIRMADA", userNome: session.name },
        update: { linha: i.linha, subgrupo: i.subgrupo, origem: "CONFIRMADA", userNome: session.name },
      })
    )
  );

  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "DRE_RECLASSIFICACAO_EM_LOTE",
    entidadeTipo: "DreClassificacao",
    entidadeId: "lote",
    descricao: `${itens.length} categoria(s) reclassificada(s) pelas sugestões da revisão de custos.`,
    antes: itens.map((i) => ({ codigo: i.codigo, ...(antes.get(i.codigo) ?? { linha: null, subgrupo: null, origem: "PROPOSTA" }) })),
    depois: itens,
  });

  revalidatePath("/custos");
  revalidatePath("/custos/reclassificar");
  return { aplicadas: itens.length };
}
