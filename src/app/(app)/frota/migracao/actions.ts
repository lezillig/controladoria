"use server";

import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { redigir } from "@/lib/controladoria/falhas";
import { lerPlanilhas, type LeituraMigracao } from "@/lib/frota/migracaoPlanilhas";
import { gravarContratos, gravarFrota, type ResultadoGravacao } from "@/lib/frota/migracaoNoBanco";
import { ROTULO_PRODUTO } from "@/lib/frota/financiamentos";
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
