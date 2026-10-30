"use server";

import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { redigir } from "@/lib/controladoria/falhas";
import { lerPlanilhas, type LeituraMigracao } from "@/lib/frota/migracaoPlanilhas";
import { gravarContratos, gravarFrota, type ResultadoGravacao } from "@/lib/frota/migracaoNoBanco";
import { ROTULO_PRODUTO } from "@/lib/frota/financiamentos";
import { lerPlanilhaMultas, type LeituraMultas } from "@/lib/frota/multas";
import { gravarMultas, type ResultadoMultas } from "@/lib/frota/multasNoBanco";
import { exigirPermissao } from "../../_dados";

// A MIGRAÇÃO ÚNICA DAS PLANILHAS: ler e mostrar a prévia; depois gravar, em
// duas etapas (frota, contratos). Os arquivos vêm em cada chamada e não ficam
// guardados em lugar nenhum.

async function ler(formData: FormData): Promise<LeituraMigracao> {
  const arquivos: { nome: string; livro: ExcelJS.Workbook }[] = [];
  for (const campo of ["controle", "financiamentos"]) {
    const f = formData.get(campo);
    if (!(f instanceof File) || f.size === 0) continue;
    if (f.size > 8 * 1024 * 1024) throw new Error(`${f.name}: arquivo acima de 8 MB.`);
    const livro = new ExcelJS.Workbook();
    try {
      await livro.xlsx.load((await f.arrayBuffer()) as ArrayBuffer);
    } catch {
      throw new Error(`${f.name}: não consegui abrir. Envie o .xlsx ou .xlsm original (o .xls antigo precisa ser salvo de novo como .xlsx).`);
    }
    arquivos.push({ nome: f.name, livro });
  }
  if (arquivos.length === 0) throw new Error("Escolha pelo menos uma das planilhas.");
  return lerPlanilhas(arquivos);
}

export type Previa = {
  veiculos: { total: number; ativos: number; vendidos: number; semPlaca: number; jaCadastrados: number };
  documentos: number;
  consultas: number;
  apolices: string[];
  contratos: { produto: string; instituicao: string; total: number; ativos: number }[];
  problemas: { aba: string; linha: number; problema: string }[];
  abasLidas: string[];
  abasIgnoradas: string[];
  dataReferencia: string | null;
};

export async function previaMigracao(formData: FormData): Promise<{ previa?: Previa; erro?: string }> {
  const session = await exigirPermissao("migrar-planilhas");
  try {
    const r = await ler(formData);
    const existentes = await prisma.cadVeiculo.findMany({ where: { companyId: session.companyId }, select: { placa: true, chassi: true } });
    const placas = new Set(existentes.map((v) => v.placa).filter(Boolean));
    const chassis = new Set(existentes.map((v) => v.chassi).filter(Boolean));
    const contratos = new Map<string, { produto: string; instituicao: string; total: number; ativos: number }>();
    for (const f of r.financiamentos) {
      const k = `${f.produto}|${f.instituicao}`;
      const g = contratos.get(k) ?? { produto: ROTULO_PRODUTO[f.produto] ?? f.produto, instituicao: f.instituicao, total: 0, ativos: 0 };
      g.total++;
      if (!f.quitado) g.ativos++;
      contratos.set(k, g);
    }
    return {
      previa: {
        veiculos: {
          total: r.veiculos.length,
          ativos: r.veiculos.filter((v) => v.status === "ativo").length,
          vendidos: r.veiculos.filter((v) => v.status === "vendido").length,
          semPlaca: r.veiculos.filter((v) => !v.placa).length,
          jaCadastrados: r.veiculos.filter((v) => (v.placa && placas.has(v.placa)) || (v.chassi && chassis.has(v.chassi))).length,
        },
        documentos: r.veiculos.reduce((s, v) => s + v.documentos.length, 0),
        consultas: r.veiculos.reduce((s, v) => s + v.consultas.length, 0),
        apolices: [...new Set(r.veiculos.map((v) => v.apoliceDescricao).filter((x): x is string => !!x))].sort(),
        contratos: [...contratos.values()].sort((a, b) => a.produto.localeCompare(b.produto) || a.instituicao.localeCompare(b.instituicao)),
        problemas: r.problemas.slice(0, 600),
        abasLidas: r.abasLidas,
        abasIgnoradas: r.abasIgnoradas,
        dataReferencia: r.dataReferencia ? r.dataReferencia.toISOString().slice(0, 10) : null,
      },
    };
  } catch (e) {
    return { erro: redigir(e instanceof Error ? e.message : "erro").slice(0, 300) };
  }
}

export async function gravarMigracao(formData: FormData, etapa: "frota" | "contratos"): Promise<{ resultado?: ResultadoGravacao; erro?: string }> {
  const session = await exigirPermissao("migrar-planilhas");
  try {
    const r = await ler(formData);
    const resultado =
      etapa === "frota"
        ? await gravarFrota(session.companyId, session.name, r)
        : await gravarContratos(session.companyId, session.name, r, r.dataReferencia ?? new Date());
    revalidatePath("/frota");
    revalidatePath("/frota/financiamentos");
    return { resultado };
  } catch (e) {
    return { erro: redigir(e instanceof Error ? e.message : "erro").slice(0, 300) };
  }
}

// A PLANILHA DE MULTAS (CONTROLE MULTAS): prévia e gravação.
async function lerMultas(formData: FormData): Promise<LeituraMultas> {
  const f = formData.get("multas");
  if (!(f instanceof File) || f.size === 0) throw new Error("Escolha a planilha de multas.");
  if (f.size > 8 * 1024 * 1024) throw new Error(`${f.name}: arquivo acima de 8 MB.`);
  const livro = new ExcelJS.Workbook();
  try {
    await livro.xlsx.load((await f.arrayBuffer()) as ArrayBuffer);
  } catch {
    throw new Error(`${f.name}: não consegui abrir. Envie o .xlsx original.`);
  }
  const r = lerPlanilhaMultas(livro);
  if (!r.multas.length) throw new Error("Não achei multas: a planilha precisa ter as colunas PLACA e AIT.");
  return r;
}

export type PreviaMultas = { total: number; abertas: number; finalizadas: number; nic: number; valorCents: number; descontadoCents: number; empresaAssume: number; semVeiculo: number; jaLancadas: number; problemas: { aba: string; linha: number; problema: string }[]; abasLidas: string[] };

export async function previaMultas(formData: FormData): Promise<{ previa?: PreviaMultas; erro?: string }> {
  const session = await exigirPermissao("migrar-planilhas");
  try {
    const r = await lerMultas(formData);
    const placas = new Set((await prisma.cadVeiculo.findMany({ where: { companyId: session.companyId, placa: { not: null } }, select: { placa: true } })).map((v) => v.placa));
    const lancadas = new Set((await prisma.frotaMulta.findMany({ where: { companyId: session.companyId }, select: { ait: true } })).map((m) => m.ait));
    return {
      previa: {
        total: r.multas.length,
        abertas: r.multas.filter((m) => m.situacao === "aberta").length,
        finalizadas: r.multas.filter((m) => m.situacao === "finalizada").length,
        nic: r.multas.filter((m) => m.ehNic).length,
        valorCents: r.multas.reduce((s, m) => s + m.valorCents, 0),
        descontadoCents: r.multas.reduce((s, m) => s + (m.descontoValorCents ?? 0), 0),
        empresaAssume: r.multas.filter((m) => m.responsavel === "empresa").length,
        semVeiculo: r.multas.filter((m) => !placas.has(m.placa)).length,
        jaLancadas: r.multas.filter((m) => lancadas.has(m.ait)).length,
        problemas: r.problemas.slice(0, 200),
        abasLidas: r.abasLidas,
      },
    };
  } catch (e) {
    return { erro: redigir(e instanceof Error ? e.message : "erro").slice(0, 300) };
  }
}

export async function gravarMultasDaPlanilha(formData: FormData): Promise<{ resultado?: ResultadoMultas; erro?: string }> {
  const session = await exigirPermissao("migrar-planilhas");
  try {
    const resultado = await gravarMultas(session.companyId, session.name, await lerMultas(formData));
    await prisma.audLog.create({ data: { companyId: session.companyId, usuario: session.name, tabela: "Migracao", registroId: "multas", operacao: "insert", depois: resultado } });
    revalidatePath("/frota/multas");
    return { resultado };
  } catch (e) {
    return { erro: redigir(e instanceof Error ? e.message : "erro").slice(0, 300) };
  }
}
