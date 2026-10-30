"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { redigir } from "@/lib/controladoria/falhas";
import { lerData } from "@/lib/cadastro/fichaVeiculo";
import { registrarAlteracao } from "@/lib/auditoria/trilha";
import { SITUACOES_DOCUMENTO_PESSOA, TIPO_DOCUMENTO_PESSOA } from "@/lib/pessoas/documentos";
import { diasDeFerias } from "@/lib/pessoas/ferias";
import { exigirPermissao } from "../_dados";

// AS AÇÕES DA FICHA DO MOTORISTA — só com "gerir-motoristas" (o RH). Toda
// gravação passa pela trilha. Do documento pessoal não se grava o número.

type Resposta = { erro?: string; id?: string; ok?: boolean };
const falha = (e: unknown): Resposta => ({ erro: redigir(e instanceof Error ? e.message : "erro").slice(0, 300) });
const texto = (fd: FormData, k: string, max: number) => String(fd.get(k) ?? "").trim().slice(0, max) || null;

async function pessoaDaEmpresa(companyId: string, pessoaId: string) {
  return prisma.cadPessoa.findFirst({ where: { id: pessoaId, companyId }, select: { id: true, cargo: true, transportaEscolar: true, dataAdmissao: true } });
}

export async function salvarDocumentoPessoa(fd: FormData): Promise<Resposta> {
  const session = await exigirPermissao("gerir-motoristas");
  try {
    const pessoaId = String(fd.get("pessoaId") ?? "");
    const tipo = String(fd.get("tipo") ?? "");
    if (!TIPO_DOCUMENTO_PESSOA.has(tipo)) return { erro: "Tipo de documento inválido." };
    const situacao = String(fd.get("situacao") ?? "vigente");
    if (!(SITUACOES_DOCUMENTO_PESSOA as readonly string[]).includes(situacao)) return { erro: "Situação inválida." };
    const validade = lerData(fd.get("validade"));
    if (validade === "invalida") return { erro: "Validade inválida." };
    if (situacao === "vigente" && !validade) return { erro: "Informe a validade (ou escolha outra situação)." };
    if (!(await pessoaDaEmpresa(session.companyId, pessoaId))) return { erro: "Pessoa não encontrada." };
    const categoria = tipo === "cnh" ? (texto(fd, "categoria", 4)?.toUpperCase().replace(/[^A-E]/g, "") || null) : null;
    const earTexto = String(fd.get("ear") ?? "");
    const dados = {
      situacao,
      validade: situacao === "nao_se_aplica" ? null : validade,
      categoria,
      ear: tipo === "cnh" ? (earTexto === "sim" ? true : earTexto === "nao" ? false : null) : null,
      observacao: texto(fd, "observacao", 300),
      atualizadoPor: session.name,
    };
    const atual = await prisma.pesDocumento.findUnique({ where: { pessoaId_tipo: { pessoaId, tipo } } });
    const salvo = await prisma.pesDocumento.upsert({ where: { pessoaId_tipo: { pessoaId, tipo } }, create: { companyId: session.companyId, pessoaId, tipo, ...dados }, update: dados });
    await registrarAlteracao(prisma, {
      companyId: session.companyId,
      usuario: session.name,
      tabela: "PesDocumento",
      registroId: salvo.id,
      operacao: atual ? "update" : "insert",
      antes: atual ? { tipo, situacao: atual.situacao, validade: atual.validade, categoria: atual.categoria, ear: atual.ear } : null,
      depois: { tipo, situacao: dados.situacao, validade: dados.validade, categoria: dados.categoria, ear: dados.ear },
    });
    revalidatePath(`/motoristas/${pessoaId}`);
    revalidatePath("/motoristas");
    return { ok: true };
  } catch (e) {
    return falha(e);
  }
}

export async function salvarFeriasPessoa(fd: FormData): Promise<Resposta> {
  const session = await exigirPermissao("gerir-motoristas");
  try {
    const pessoaId = String(fd.get("pessoaId") ?? "");
    const inicio = lerData(fd.get("inicio"));
    const fim = lerData(fd.get("fim"));
    if (!inicio || inicio === "invalida" || !fim || fim === "invalida") return { erro: "Informe o início e o fim das férias." };
    if (fim < inicio) return { erro: "O fim vem antes do início." };
    const abonoDias = Number(String(fd.get("abono") ?? "0").trim() || 0);
    if (!Number.isInteger(abonoDias) || abonoDias < 0 || abonoDias > 10) return { erro: "Abono (dias vendidos) vai de 0 a 10." };
    const dias = diasDeFerias({ inicio, fim, abonoDias });
    if (dias > 30) return { erro: `São ${dias} dias com o abono — o período dá direito a 30. Divida em dois lançamentos se forem de períodos diferentes.` };
    if (fim.getTime() - inicio.getTime() + 86_400_000 < 5 * 86_400_000) return { erro: "Um período de férias tem pelo menos 5 dias (art. 134 da CLT)." };
    if (!(await pessoaDaEmpresa(session.companyId, pessoaId))) return { erro: "Pessoa não encontrada." };
    const cruzam = await prisma.pesFerias.findMany({ where: { pessoaId, inicio: { lte: fim }, fim: { gte: inicio } } });
    const daGestao = cruzam.filter((f) => f.origem === "gestao");
    if (cruzam.length > daGestao.length) return { erro: "Já há férias lançadas nesse intervalo." };
    // O lançamento do RH vale sobre o registro da gestão no mesmo intervalo.
    if (daGestao.length) await prisma.pesFerias.deleteMany({ where: { id: { in: daGestao.map((f) => f.id) } } });
    const nova = await prisma.pesFerias.create({ data: { companyId: session.companyId, pessoaId, inicio, fim, abonoDias, origem: "manual", observacao: texto(fd, "observacao", 300), registradoPor: session.name } });
    await registrarAlteracao(prisma, { companyId: session.companyId, usuario: session.name, tabela: "PesFerias", registroId: nova.id, operacao: "insert", depois: { pessoaId, inicio, fim, abonoDias, substituiuGestao: daGestao.length } });
    revalidatePath(`/motoristas/${pessoaId}`);
    revalidatePath("/motoristas");
    return { ok: true };
  } catch (e) {
    return falha(e);
  }
}

export async function excluirFeriasPessoa(fd: FormData): Promise<Resposta> {
  const session = await exigirPermissao("gerir-motoristas");
  try {
    const id = String(fd.get("id") ?? "");
    const f = await prisma.pesFerias.findFirst({ where: { id, companyId: session.companyId } });
    if (!f) return { erro: "Lançamento não encontrado." };
    if (f.origem !== "manual") return { erro: "Férias vindas do ponto (gestão) se corrigem lá — aqui elas voltariam amanhã." };
    await prisma.pesFerias.delete({ where: { id } });
    await registrarAlteracao(prisma, { companyId: session.companyId, usuario: session.name, tabela: "PesFerias", registroId: id, operacao: "excluir", antes: { pessoaId: f.pessoaId, inicio: f.inicio, fim: f.fim, abonoDias: f.abonoDias } });
    revalidatePath(`/motoristas/${f.pessoaId}`);
    return { ok: true };
  } catch (e) {
    return falha(e);
  }
}

// O que o RH completa na pessoa: se dirige no escolar (exige curso e
// certidão) e a admissão, quando o cadastro não a tem.
export async function salvarPerfilMotorista(fd: FormData): Promise<Resposta> {
  const session = await exigirPermissao("gerir-motoristas");
  try {
    const pessoaId = String(fd.get("pessoaId") ?? "");
    const atual = await pessoaDaEmpresa(session.companyId, pessoaId);
    if (!atual) return { erro: "Pessoa não encontrada." };
    const admissao = lerData(fd.get("admissao"));
    if (admissao === "invalida") return { erro: "Admissão inválida." };
    if (admissao && admissao > new Date()) return { erro: "Admissão no futuro." };
    const depois = { transportaEscolar: fd.get("escolar") === "1", dataAdmissao: admissao ?? atual.dataAdmissao };
    await prisma.cadPessoa.update({ where: { id: pessoaId }, data: depois });
    await registrarAlteracao(prisma, { companyId: session.companyId, usuario: session.name, tabela: "CadPessoa", registroId: pessoaId, operacao: "update", antes: { transportaEscolar: atual.transportaEscolar, dataAdmissao: atual.dataAdmissao }, depois });
    revalidatePath(`/motoristas/${pessoaId}`);
    revalidatePath("/motoristas");
    return { ok: true };
  } catch (e) {
    return falha(e);
  }
}

export async function salvarEmailsPessoas(fd: FormData): Promise<Resposta> {
  const session = await exigirPermissao("gerir-motoristas");
  try {
    const lista = String(fd.get("emails") ?? "").split(/[,;\s]+/).map((e) => e.trim()).filter(Boolean);
    const invalidos = lista.filter((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
    if (invalidos.length) return { erro: `E-mail inválido: ${invalidos.join(", ")}` };
    await prisma.controladoriaConfig.updateMany({ where: { companyId: session.companyId }, data: { emailsPessoas: lista.join(", ") } });
    await registrarAlteracao(prisma, { companyId: session.companyId, usuario: session.name, tabela: "ControladoriaConfig", registroId: "emailsPessoas", operacao: "update", depois: { emailsPessoas: lista.length } });
    revalidatePath("/motoristas");
    return { ok: true };
  } catch (e) {
    return falha(e);
  }
}
