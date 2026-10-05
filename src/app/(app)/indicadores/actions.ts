"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { lerReaisEmCents } from "@/lib/controladoria/format";
import { registrarEvento } from "@/lib/controladoria/trilha";
import { exigirPermissao } from "../_dados";

// O BALANÇO DOS INDICADORES. Um por data-base e por escopo (grupo ou uma
// empresa). Gravar de novo a mesma data-base substitui — a contabilidade
// republica o balanço depois da auditoria, e a versão que vale é a última.

export type ResultadoBalanco = { erro?: string; ok?: boolean };

const OBRIGATORIOS = [
  ["caixa", "Caixa e equivalentes"],
  ["contasReceber", "Contas a receber"],
  ["ativoCirculante", "Ativo circulante"],
  ["imobilizadoLiquido", "Imobilizado líquido"],
  ["ativoTotal", "Ativo total"],
  ["fornecedores", "Fornecedores"],
  ["passivoCirculante", "Passivo circulante"],
  ["dividaCurtoPrazo", "Dívida de curto prazo"],
  ["dividaLongoPrazo", "Dívida de longo prazo"],
  ["patrimonioLiquido", "Patrimônio líquido"],
] as const;

const OPCIONAIS = [
  ["depreciacaoAno", "Depreciação dos 12 meses"],
  ["lucroLiquidoAno", "Lucro líquido dos 12 meses"],
  ["kmAno", "Km rodados nos 12 meses"],
] as const;

// Aceita "1.234.567,89", "R$ 1234567,89" e o sinal de menos (ou parênteses) (PL e lucro podem ser
// negativos). Devolve reais em Decimal; texto que não é número é erro, nunca
// zero — um campo digitado errado não pode virar "caixa zerado" calado.
function lerValor(texto: string): Prisma.Decimal | null | "invalido" {
  const negativo = /^\s*[-−(]/.test(texto);
  const cents = lerReaisEmCents(texto.replace(/[-−()]/g, ""));
  if (cents === null || cents === "invalido") return cents;
  return new Prisma.Decimal(cents).div(100).mul(negativo ? -1 : 1);
}

export async function salvarBalanco(formData: FormData): Promise<ResultadoBalanco> {
  const session = await exigirPermissao("gerir-indicadores");

  const escopo = String(formData.get("escopo") ?? "GRUPO");
  if (escopo !== "GRUPO") {
    const conexao = await prisma.omieConexao.findFirst({ where: { id: escopo, companyId: session.companyId }, select: { id: true } });
    if (!conexao) return { erro: "Empresa inválida." };
  }

  const dataTexto = String(formData.get("dataBase") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataTexto)) return { erro: "Informe a data-base do balanço." };
  const dataBase = new Date(`${dataTexto}T00:00:00.000Z`);
  if (Number.isNaN(dataBase.getTime())) return { erro: "Data-base inválida." };

  const valores: Record<string, Prisma.Decimal | null> = {};
  for (const [campo, rotulo] of OBRIGATORIOS) {
    const v = lerValor(String(formData.get(campo) ?? ""));
    if (v === "invalido") return { erro: `${rotulo}: valor inválido.` };
    if (v === null) return { erro: `${rotulo}: informe o valor (zero, se não houver).` };
    valores[campo] = v;
  }
  for (const [campo, rotulo] of OPCIONAIS) {
    const v = lerValor(String(formData.get(campo) ?? ""));
    if (v === "invalido") return { erro: `${rotulo}: valor inválido.` };
    valores[campo] = v;
  }
  if (valores.ativoTotal!.lte(0)) return { erro: "Ativo total precisa ser maior que zero." };

  const waccTexto = String(formData.get("custoCapital") ?? "").trim().replace(",", ".");
  const wacc = waccTexto === "" ? 18 : Number(waccTexto);
  if (!Number.isFinite(wacc) || wacc <= 0 || wacc >= 100) return { erro: "Custo do capital: informe um percentual entre 0 e 100." };

  const frotaTexto = String(formData.get("frotaVeiculos") ?? "").trim();
  const frotaVeiculos = frotaTexto === "" ? null : Number(frotaTexto);
  if (frotaVeiculos !== null && (!Number.isInteger(frotaVeiculos) || frotaVeiculos < 0)) return { erro: "Frota: informe o número de veículos." };

  const dados = {
    caixa: valores.caixa!,
    contasReceber: valores.contasReceber!,
    ativoCirculante: valores.ativoCirculante!,
    imobilizadoLiquido: valores.imobilizadoLiquido!,
    ativoTotal: valores.ativoTotal!,
    fornecedores: valores.fornecedores!,
    passivoCirculante: valores.passivoCirculante!,
    dividaCurtoPrazo: valores.dividaCurtoPrazo!,
    dividaLongoPrazo: valores.dividaLongoPrazo!,
    patrimonioLiquido: valores.patrimonioLiquido!,
    depreciacaoAno: valores.depreciacaoAno,
    lucroLiquidoAno: valores.lucroLiquidoAno,
    kmAno: valores.kmAno,
    custoCapitalAa: new Prisma.Decimal(wacc).div(100),
    frotaVeiculos,
    observacao: String(formData.get("observacao") ?? "").trim() || null,
    autorNome: session.name,
  };

  const chave = { companyId_escopo_dataBase: { companyId: session.companyId, escopo, dataBase } };
  const anterior = await prisma.balancoPatrimonial.findUnique({ where: chave });
  const gravado = await prisma.balancoPatrimonial.upsert({
    where: chave,
    create: { companyId: session.companyId, escopo, dataBase, ...dados },
    update: dados,
  });

  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "BALANCO_SALVO",
    entidadeTipo: "BalancoPatrimonial",
    entidadeId: gravado.id,
    descricao: `Balanço de ${dataTexto} (${escopo === "GRUPO" ? "grupo" : "empresa"}) ${anterior ? "atualizado" : "lançado"}.`,
    antes: anterior,
    depois: gravado,
  });

  revalidatePath("/indicadores");
  return { ok: true };
}

export async function excluirBalanco(formData: FormData): Promise<void> {
  const session = await exigirPermissao("gerir-indicadores");
  const id = String(formData.get("id") ?? "");
  const balanco = await prisma.balancoPatrimonial.findFirst({ where: { id, companyId: session.companyId } });
  if (!balanco) return;
  await prisma.balancoPatrimonial.delete({ where: { id: balanco.id } });
  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "BALANCO_EXCLUIDO",
    entidadeTipo: "BalancoPatrimonial",
    entidadeId: balanco.id,
    descricao: `Balanço de ${balanco.dataBase.toISOString().slice(0, 10)} excluído.`,
    antes: balanco,
  });
  revalidatePath("/indicadores");
}
