"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { redigir } from "@/lib/controladoria/falhas";
import { registrarAlteracao } from "@/lib/auditoria/trilha";
import { anoSugerido, consultarPreco, ehTipoFipe, listarAnos, listarMarcas, listarModelos, marcaSugerida, modelosParecidos, type ItemFipe, type PrecoFipe } from "@/lib/frota/fipe";
import { veiculosIguais } from "@/lib/frota/frotaNoBanco";
import { exigirPermissao, podeAcao } from "../../_dados";

// A ESCOLHA DO MODELO NA FIPE: a tela pergunta passo a passo (marca, modelo,
// ano) e grava o código. O preço é sempre relido aqui no servidor na hora de
// gravar — o que veio da tela é só a escolha.

const falha = (e: unknown) => ({ erro: redigir(e instanceof Error ? e.message : "erro").slice(0, 300) });

async function sessaoFipe() {
  const session = await exigirPermissao("frota-valores");
  if (!(await podeAcao(session, "gerir-frota"))) throw new Error("Escolher o modelo na FIPE exige a permissão de gerir a frota.");
  return session;
}

export async function fipeOpcoes(p: { veiculoId: string; tipo: string; marca?: string; modelo?: string }): Promise<{ itens?: ItemFipe[]; sugerido?: string | null; erro?: string }> {
  try {
    const session = await sessaoFipe();
    if (!ehTipoFipe(p.tipo)) return { erro: "Tipo inválido." };
    const v = await prisma.cadVeiculo.findFirst({ where: { id: p.veiculoId, companyId: session.companyId }, select: { marca: true, modelo: true, anoMod: true, tipo: true, capacidade: true, categoriaUso: true } });
    if (!v) return { erro: "Veículo não encontrado." };
    if (!p.marca) {
      const itens = await listarMarcas(p.tipo);
      return { itens, sugerido: marcaSugerida(itens, v.marca)?.codigo ?? null };
    }
    if (!p.modelo) {
      const itens = modelosParecidos(await listarModelos(p.tipo, p.marca), v.modelo, v);
      return { itens: itens.map(({ codigo, nome }) => ({ codigo, nome })), sugerido: itens[0]?.casou ? itens[0].codigo : null };
    }
    const itens = await listarAnos(p.tipo, p.marca, p.modelo);
    return { itens, sugerido: anoSugerido(itens, v.anoMod)?.codigo ?? null };
  } catch (e) {
    return falha(e);
  }
}

export async function fipePrevia(p: { tipo: string; marca: string; modelo: string; ano: string }): Promise<{ preco?: PrecoFipe; erro?: string }> {
  try {
    await sessaoFipe();
    if (!ehTipoFipe(p.tipo)) return { erro: "Tipo inválido." };
    return { preco: await consultarPreco(p.tipo, p.marca, p.modelo, p.ano) };
  } catch (e) {
    return falha(e);
  }
}

export async function gravarFipe(p: { veiculoId: string; tipo: string; marca: string; modelo: string; ano: string; aplicarIguais: boolean }): Promise<{ ok?: boolean; veiculos?: number; erro?: string }> {
  try {
    const session = await sessaoFipe();
    if (!ehTipoFipe(p.tipo)) return { erro: "Tipo inválido." };
    const v = await prisma.cadVeiculo.findFirst({ where: { id: p.veiculoId, companyId: session.companyId } });
    if (!v) return { erro: "Veículo não encontrado." };
    const preco = await consultarPreco(p.tipo, p.marca, p.modelo, p.ano);
    const ids = [v.id, ...(p.aplicarIguais ? (await veiculosIguais(session.companyId, v)).filter((x) => x.fipeCodigo === null).map((x) => x.id) : [])];
    const depois = {
      fipeTipo: p.tipo,
      fipeCodigo: preco.codigoFipe,
      fipeModelo: `${preco.marca} ${preco.modelo} ${preco.anoModelo === 32000 ? "Zero KM" : preco.anoModelo} ${preco.combustivel}`.slice(0, 200),
      fipeAnoModelo: p.ano,
      fipeValorCents: BigInt(preco.valorCents),
      fipeReferencia: preco.referencia,
      fipeConsultadoEm: new Date(),
    };
    const antes = await prisma.cadVeiculo.findMany({ where: { id: { in: ids } }, select: { id: true, fipeCodigo: true, fipeAnoModelo: true, fipeValorCents: true } });
    await prisma.cadVeiculo.updateMany({ where: { id: { in: ids }, companyId: session.companyId }, data: depois });
    for (const a of antes) {
      await registrarAlteracao(prisma, { companyId: session.companyId, usuario: session.name, tabela: "CadVeiculo", registroId: a.id, operacao: "update", antes: { fipeCodigo: a.fipeCodigo, fipeAnoModelo: a.fipeAnoModelo, fipeValorCents: a.fipeValorCents }, depois: { ...depois, origem: a.id === v.id ? "escolha" : `igual a ${v.placa ?? v.id}` } });
    }
    revalidatePath("/frota");
    revalidatePath("/frota/fipe");
    return { ok: true, veiculos: ids.length };
  } catch (e) {
    return falha(e);
  }
}

export async function tirarFipe(veiculoId: string): Promise<{ ok?: boolean; erro?: string }> {
  try {
    const session = await sessaoFipe();
    const v = await prisma.cadVeiculo.findFirst({ where: { id: veiculoId, companyId: session.companyId }, select: { fipeCodigo: true, fipeAnoModelo: true, fipeValorCents: true } });
    if (!v) return { erro: "Veículo não encontrado." };
    const depois = { fipeTipo: null, fipeCodigo: null, fipeModelo: null, fipeAnoModelo: null, fipeValorCents: null, fipeReferencia: null, fipeConsultadoEm: null };
    await prisma.cadVeiculo.update({ where: { id: veiculoId }, data: depois });
    await registrarAlteracao(prisma, { companyId: session.companyId, usuario: session.name, tabela: "CadVeiculo", registroId: veiculoId, operacao: "update", antes: v, depois });
    revalidatePath("/frota/fipe");
    revalidatePath(`/frota/${veiculoId}`);
    return { ok: true };
  } catch (e) {
    return falha(e);
  }
}
