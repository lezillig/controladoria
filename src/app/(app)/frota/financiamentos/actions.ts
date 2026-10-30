"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { redigir } from "@/lib/controladoria/falhas";
import { lerReaisEmCents } from "@/lib/controladoria/format";
import { normalizarChassi, normalizarPlaca } from "@/lib/cadastro/normalizacao";
import { lerData } from "@/lib/cadastro/fichaVeiculo";
import { diferencas, registrarAlteracao } from "@/lib/auditoria/trilha";
import { lerFinanciamento } from "@/lib/frota/financiamentos";
import { conciliarParcelasOmie } from "@/lib/frota/parcelasOmie";
import { exigirPermissao } from "../../_dados";

// AÇÕES DE FINANCIAMENTOS E CONSÓRCIOS — com trilha em tudo.

type Resposta = { erro?: string; id?: string; ok?: boolean; resumo?: string };
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].map(([k, v]) => [k, typeof v === "string" ? v : ""]));
const falha = (e: unknown): Resposta => ({ erro: redigir(e instanceof Error ? e.message : "erro").slice(0, 300) });
const revalidar = (id?: string) => {
  revalidatePath("/frota/financiamentos");
  if (id) revalidatePath(`/frota/financiamentos/${id}`);
};

export async function conferirParcelas(): Promise<Resposta> {
  const session = await exigirPermissao("gerir-financiamentos");
  try {
    const r = await conciliarParcelasOmie(session.companyId);
    revalidar();
    return { ok: true, resumo: `${r.ligacoes} parcela(s) da Omie ligadas a ${r.grupos.reduce((s, g) => s + g.contratos, 0)} contrato(s).${r.semParceiro.length ? ` Sem o banco na Omie: ${r.semParceiro.join(", ")}.` : ""}` };
  } catch (e) {
    return falha(e);
  }
}

export async function salvarFinanciamento(fd: FormData): Promise<Resposta> {
  const session = await exigirPermissao("gerir-financiamentos");
  try {
    const id = String(fd.get("id") ?? "") || null;
    const lido = lerFinanciamento(form(fd));
    if (!lido.ok) return { erro: lido.erro };
    const d = lido.dados;
    const dados = { ...d, saldoInformadoEm: d.parcelasPagas !== null || d.saldoQuitacaoCents !== null ? new Date() : null };
    if (!id) {
      const novo = await prisma.frotaFinanciamento.create({ data: { companyId: session.companyId, ...dados, origem: `manual:${session.name}` } });
      await registrarAlteracao(prisma, { companyId: session.companyId, usuario: session.name, tabela: "FrotaFinanciamento", registroId: novo.id, operacao: "insert", depois: dados });
      revalidar(novo.id);
      return { id: novo.id };
    }
    const atual = await prisma.frotaFinanciamento.findFirst({ where: { id, companyId: session.companyId } });
    if (!atual) return { erro: "Contrato não encontrado." };
    // Parcelas pagas e saldo só contam como nova informação se mudaram.
    const semInformacao = { ...dados } as Record<string, unknown>;
    if (Number(atual.parcelasPagas) === Number(d.parcelasPagas) && String(atual.saldoQuitacaoCents) === String(d.saldoQuitacaoCents)) delete semInformacao.saldoInformadoEm;
    const mud = diferencas(atual as unknown as Record<string, unknown>, semInformacao);
    if (mud) {
      await prisma.frotaFinanciamento.update({ where: { id }, data: mud.depois as Prisma.FrotaFinanciamentoUpdateInput });
      await registrarAlteracao(prisma, { companyId: session.companyId, usuario: session.name, tabela: "FrotaFinanciamento", registroId: id, operacao: "update", antes: mud.antes, depois: mud.depois });
    }
    revalidar(id);
    return { id };
  } catch (e) {
    return falha(e);
  }
}

export async function encerrarFinanciamento(fd: FormData): Promise<Resposta> {
  const session = await exigirPermissao("gerir-financiamentos");
  try {
    const id = String(fd.get("id") ?? "");
    const motivo = String(fd.get("motivo") ?? "").trim();
    if (!motivo) return { erro: "Diga o motivo (quitado, transferido, cancelado…)." };
    const data = lerData(fd.get("data"));
    if (!data || data === "invalida") return { erro: "Informe a data." };
    const atual = await prisma.frotaFinanciamento.findFirst({ where: { id, companyId: session.companyId }, select: { ativo: true } });
    if (!atual) return { erro: "Contrato não encontrado." };
    await prisma.$transaction([
      prisma.frotaFinanciamento.update({ where: { id }, data: { ativo: false, dataQuitacao: data, motivoEncerramento: motivo.slice(0, 200) } }),
      prisma.frotaFinanciamentoVeiculo.updateMany({ where: { financiamentoId: id }, data: { alienado: false } }),
    ]);
    await registrarAlteracao(prisma, { companyId: session.companyId, usuario: session.name, tabela: "FrotaFinanciamento", registroId: id, operacao: "desativar", antes: { ativo: atual.ativo }, depois: { ativo: false, dataQuitacao: data, motivoEncerramento: motivo } });
    revalidar(id);
    return { ok: true };
  } catch (e) {
    return falha(e);
  }
}

// O VEÍCULO NO CONTRATO (pela placa ou chassi), com a parte dele.
export async function vincularVeiculo(fd: FormData): Promise<Resposta> {
  const session = await exigirPermissao("gerir-financiamentos");
  try {
    const financiamentoId = String(fd.get("financiamentoId") ?? "");
    const chave = String(fd.get("veiculo") ?? "").trim();
    const placa = normalizarPlaca(chave);
    const chassi = placa ? null : normalizarChassi(chave);
    if (!placa && !chassi) return { erro: "Informe a placa (ou o chassi do veículo ainda sem placa)." };
    const [contrato, veiculo] = await Promise.all([
      prisma.frotaFinanciamento.findFirst({ where: { id: financiamentoId, companyId: session.companyId }, select: { id: true, produto: true } }),
      prisma.cadVeiculo.findFirst({ where: { companyId: session.companyId, ...(placa ? { placa } : { chassi }) }, select: { id: true } }),
    ]);
    if (!contrato) return { erro: "Contrato não encontrado." };
    if (!veiculo) return { erro: "Veículo não está no cadastro da frota — cadastre-o primeiro." };
    const parcela = lerReaisEmCents(String(fd.get("parcela") ?? ""));
    if (parcela === "invalido") return { erro: "Parcela do veículo inválida." };
    const v = await prisma.frotaFinanciamentoVeiculo.upsert({
      where: { financiamentoId_veiculoId: { financiamentoId, veiculoId: veiculo.id } },
      create: { companyId: session.companyId, financiamentoId, veiculoId: veiculo.id, parcelaCents: parcela === null ? null : BigInt(parcela), alienado: fd.get("alienado") === "1" },
      update: { parcelaCents: parcela === null ? null : BigInt(parcela), alienado: fd.get("alienado") === "1" },
    });
    await registrarAlteracao(prisma, { companyId: session.companyId, usuario: session.name, tabela: "FrotaFinanciamentoVeiculo", registroId: v.id, operacao: "insert", depois: { financiamentoId, veiculoId: veiculo.id, parcelaCents: v.parcelaCents, alienado: v.alienado } });
    revalidar(financiamentoId);
    return { ok: true };
  } catch (e) {
    return falha(e);
  }
}

export async function desvincularVeiculo(fd: FormData): Promise<Resposta> {
  const session = await exigirPermissao("gerir-financiamentos");
  try {
    const id = String(fd.get("vinculoId") ?? "");
    const v = await prisma.frotaFinanciamentoVeiculo.findFirst({ where: { id, companyId: session.companyId } });
    if (!v) return { erro: "Vínculo não encontrado." };
    await prisma.frotaFinanciamentoVeiculo.delete({ where: { id } });
    await registrarAlteracao(prisma, { companyId: session.companyId, usuario: session.name, tabela: "FrotaFinanciamentoVeiculo", registroId: id, operacao: "desativar", antes: { financiamentoId: v.financiamentoId, veiculoId: v.veiculoId, parcelaCents: v.parcelaCents, alienado: v.alienado } });
    revalidar(v.financiamentoId);
    return { ok: true };
  } catch (e) {
    return falha(e);
  }
}

// QUEM É O BANCO NA OMIE: confirmar a sugestão, ou tirar.
export async function decidirParceiro(fd: FormData): Promise<Resposta> {
  const session = await exigirPermissao("gerir-financiamentos");
  try {
    const id = String(fd.get("id") ?? "");
    const confirmar = fd.get("decisao") === "confirmar";
    const v = await prisma.frotaInstituicaoParceiro.findFirst({ where: { id, companyId: session.companyId } });
    if (!v) return { erro: "Vínculo não encontrado." };
    await prisma.frotaInstituicaoParceiro.update({ where: { id }, data: confirmar ? { confirmado: true, rejeitado: false } : { confirmado: false, rejeitado: true } });
    await registrarAlteracao(prisma, { companyId: session.companyId, usuario: session.name, tabela: "FrotaInstituicaoParceiro", registroId: id, operacao: confirmar ? "update" : "desativar", antes: { instituicao: v.instituicao, parceiro: v.parceiroNome, confirmado: v.confirmado }, depois: confirmar ? { confirmado: true } : null });
    if (!confirmar) await conciliarParcelasOmie(session.companyId);
    revalidar();
    return { ok: true };
  } catch (e) {
    return falha(e);
  }
}
