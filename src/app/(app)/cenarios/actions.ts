"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { ROTULO_LINHA } from "@/lib/controladoria/dre";
import { fmtBRL } from "@/lib/controladoria/format";
import { ehLinhaDeGrupo, mesesDoHorizonte, projetar, type Premissa } from "@/lib/controladoria/projecao";
import {
  baseHistoricaNoBanco,
  cenarioDoRegistro,
  contratosDoEscopo,
  escopoTexto,
  premissasDoJson,
} from "@/lib/controladoria/projecaoNoBanco";
import { registrarEvento } from "@/lib/controladoria/trilha";
import { dataReferenciaPadrao } from "@/lib/controladoria/ciclo";
import { exigirPermissao, resolverEscopo } from "../_dados";

// CENÁRIOS: salvar, apagar e gravar como orçamento.
//
// Um cenário é um conjunto de premissas declaradas. Salvar é barato e deixa
// rastro (quem, quando, o quê); por isso toda simulação passa por aqui em vez
// de viver só na tela — a premissa que decidiu um orçamento precisa poder ser
// reencontrada meses depois.

export type ResultadoCenario = { erro?: string; ok?: boolean; id?: string };

const MAX_NOME = 80;
const MAX_PREMISSAS = 40;

export async function salvarCenario(formData: FormData): Promise<ResultadoCenario> {
  const session = await exigirPermissao("gerir-cenarios");
  const escopo = await resolverEscopo(session.companyId, String(formData.get("empresa") ?? "") || undefined);

  const id = String(formData.get("id") ?? "").trim() || null;
  const nome = String(formData.get("nome") ?? "").trim().slice(0, MAX_NOME);
  if (!nome) return { erro: "Dê um nome ao cenário." };
  const baseReceita = String(formData.get("baseReceita") ?? "") === "CONTRATADA" ? "CONTRATADA" : "HISTORICA";
  const observacao = String(formData.get("observacao") ?? "").trim().slice(0, 500) || null;

  let premissas: Premissa[];
  try {
    premissas = premissasDoJson(JSON.parse(String(formData.get("premissas") ?? "[]")));
  } catch {
    return { erro: "Premissas em formato inválido." };
  }
  if (premissas.length > MAX_PREMISSAS) return { erro: `No máximo ${MAX_PREMISSAS} premissas por cenário.` };
  for (const p of premissas) {
    if (!ehLinhaDeGrupo(p.linha)) return { erro: "Premissa numa linha que não é grupo do DRE." };
    if (Math.abs(p.percentual) > 500) return { erro: "Percentual fora de qualquer faixa razoável (limite ±500%)." };
    if (p.ate && p.ate < p.desde) return { erro: "Premissa com fim antes do início." };
  }

  const texto = escopoTexto(escopo.conexaoId);
  const dados = { nome, baseReceita, observacao, premissas: premissas as unknown as object[] };

  let salvo: { id: string };
  if (id) {
    const existente = await prisma.cenario.findFirst({ where: { id, companyId: session.companyId }, select: { id: true, nome: true, premissas: true, baseReceita: true } });
    if (!existente) return { erro: "Cenário não encontrado." };
    salvo = await prisma.cenario.update({ where: { id }, data: dados, select: { id: true } });
    await registrarEvento({
      companyId: session.companyId,
      userId: session.userId,
      userNome: session.name,
      userEmail: session.email,
      acao: "CENARIO_ALTERADO",
      entidadeTipo: "Cenario",
      entidadeId: salvo.id,
      descricao: `Cenário "${nome}" alterado: ${premissas.length} premissa(s), receita ${baseReceita === "CONTRATADA" ? "contratada" : "histórica"}.`,
      antes: { nome: existente.nome, baseReceita: existente.baseReceita, premissas: existente.premissas },
      depois: dados,
    });
  } else {
    salvo = await prisma.cenario.create({
      data: { companyId: session.companyId, escopo: texto, criadoPorNome: session.name, ...dados },
      select: { id: true },
    });
    await registrarEvento({
      companyId: session.companyId,
      userId: session.userId,
      userNome: session.name,
      userEmail: session.email,
      acao: "CENARIO_CRIADO",
      entidadeTipo: "Cenario",
      entidadeId: salvo.id,
      descricao: `Cenário "${nome}" criado (${texto === "GRUPO" ? "consolidado" : "uma empresa"}): ${premissas.length} premissa(s).`,
      depois: dados,
    });
  }

  revalidatePath("/cenarios");
  return { ok: true, id: salvo.id };
}

export async function excluirCenario(formData: FormData): Promise<void> {
  const session = await exigirPermissao("gerir-cenarios");
  const id = String(formData.get("id") ?? "");
  const existente = await prisma.cenario.findFirst({ where: { id, companyId: session.companyId }, select: { id: true, nome: true, tipo: true } });
  if (!existente) return;
  // As linhas de orçamento gravadas a partir dele ficam (cenarioId vira nulo):
  // apagar o rascunho não apaga o orçamento que já foi aprovado.
  await prisma.cenario.delete({ where: { id } });
  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "CENARIO_EXCLUIDO",
    entidadeTipo: "Cenario",
    entidadeId: id,
    descricao: `Cenário "${existente.nome}" excluído.`,
  });
  revalidatePath("/cenarios");
}

// GRAVAR O CENÁRIO COMO ORÇAMENTO DE UM ANO. Uma versão nova por gravação —
// a anterior fica, e é ela que responde "o que estava orçado quando o mês
// fechou" se alguém regravar depois. Só os meses do ano que estão no horizonte
// projetado recebem valor; mês já fechado não vira orçamento retroativo.
export async function gravarOrcamento(formData: FormData): Promise<ResultadoCenario> {
  const session = await exigirPermissao("gerir-cenarios");
  const escopo = await resolverEscopo(session.companyId, String(formData.get("empresa") ?? "") || undefined);
  const id = String(formData.get("id") ?? "");
  const ano = Number(formData.get("ano"));
  if (!Number.isInteger(ano) || ano < 2015 || ano > 2100) return { erro: "Ano inválido." };

  const registro = await prisma.cenario.findFirst({ where: { id, companyId: session.companyId } });
  if (!registro) return { erro: "Cenário não encontrado." };

  const dataReferencia = dataReferenciaPadrao();
  const projecaoEscopo = { companyId: session.companyId, conexaoId: escopo.conexaoId };
  const [base, contratos] = await Promise.all([baseHistoricaNoBanco(projecaoEscopo, dataReferencia), contratosDoEscopo(projecaoEscopo)]);
  const meses = mesesDoHorizonte(dataReferencia, 12).filter((m) => m.startsWith(`${ano}-`));
  if (meses.length === 0) return { erro: `Nenhum mês de ${ano} está no horizonte de doze meses a partir de hoje.` };
  const projecao = projetar(base, contratos, mesesDoHorizonte(dataReferencia, 12), cenarioDoRegistro(registro));

  const texto = escopoTexto(escopo.conexaoId);
  const ultima = await prisma.orcamentoLinha.findFirst({ where: { companyId: session.companyId, escopo: texto, ano }, orderBy: { versao: "desc" }, select: { versao: true } });
  const versao = (ultima?.versao ?? 0) + 1;

  const linhas = projecao.linhas
    .filter((l) => l.tipo === "GRUPO")
    .flatMap((l) =>
      projecao.meses
        .map((m, i) => ({ competencia: m.competencia, valorCents: l.porMes[i] }))
        .filter((x) => meses.includes(x.competencia))
        .map((x) => ({
          companyId: session.companyId,
          escopo: texto,
          ano,
          versao,
          linha: l.chave,
          competencia: x.competencia,
          valorCents: x.valorCents,
          origem: "CENARIO",
          cenarioId: registro.id,
          criadoPorNome: session.name,
        }))
    );

  const receitaNoPeriodo = linhas.filter((l) => l.linha === "RECEITA_BRUTA").reduce((a, l) => a + l.valorCents, 0);

  await prisma.$transaction([
    prisma.orcamentoLinha.createMany({ data: linhas }),
    prisma.cenario.update({ where: { id: registro.id }, data: { tipo: "ORCAMENTO" } }),
  ]);

  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "ORCAMENTO_GRAVADO",
    entidadeTipo: "Cenario",
    entidadeId: registro.id,
    descricao:
      `Orçamento de ${ano} (versão ${versao}, ${texto === "GRUPO" ? "consolidado" : "uma empresa"}) gravado a partir do cenário "${registro.nome}": ` +
      `${meses.length} mês(es), ${linhas.length} linha(s). ${ROTULO_LINHA.RECEITA_BRUTA} no período: ${fmtBRL(receitaNoPeriodo)}.`,
    depois: { ano, versao, meses, premissas: registro.premissas, linhas: linhas.length },
  });

  revalidatePath("/cenarios");
  revalidatePath("/custos");
  return { ok: true, id: registro.id };
}
