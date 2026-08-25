"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LINHAS_CLASSIFICAVEIS, ROTULO_LINHA } from "@/lib/controladoria/dre";
import { registrarEvento } from "../auditoria/actions";

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
  const session = await requireRole("ADMIN", "GESTOR", "CONTROLADORIA");

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

  const categoria = await prisma.omieCategoria.findFirst({
    where: { companyId: session.companyId, codigo: categoriaCodigo },
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
      `Categoria "${categoria?.descricao ?? categoriaCodigo}" classificada em ${ROTULO_LINHA[linha]}` +
      `${subgrupo ? `, subgrupo "${subgrupo}"` : ""}.`,
    antes: anterior ?? undefined,
    depois: { linha, subgrupo, origem: "CONFIRMADA" },
  });

  revalidatePath("/custos");
  return { ok: true };
}
