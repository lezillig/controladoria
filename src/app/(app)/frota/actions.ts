"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { redigir } from "@/lib/controladoria/falhas";
import { lerData, lerSituacao, lerVeiculo } from "@/lib/cadastro/fichaVeiculo";
import { lerReaisEmCents } from "@/lib/controladoria/format";
import { diferencas, registrarAlteracao } from "@/lib/auditoria/trilha";
import { criarPendencia } from "@/lib/auditoria/pendencias";
import { SITUACOES_DOCUMENTO, TIPO_DOCUMENTO } from "@/lib/frota/documentos";
import { EM_OPERACAO, impedimentosParaRodar } from "@/lib/frota/controles";
import { exigirPermissao, podeAcao } from "../_dados";

// AS AÇÕES DA FICHA DO VEÍCULO. Toda gravação passa pela trilha (antes e
// depois); valores (compra, venda, FIPE, adaptações) só com "frota-valores".

type Resposta = { erro?: string; id?: string; ok?: boolean };
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].map(([k, v]) => [k, typeof v === "string" ? v : ""]));
const falha = (e: unknown): Resposta => ({ erro: redigir(e instanceof Error ? e.message : "erro").slice(0, 300) });

export async function salvarVeiculo(fd: FormData): Promise<Resposta> {
  const session = await exigirPermissao("gerir-frota");
  try {
    const comValores = await podeAcao(session, "frota-valores");
    const id = String(fd.get("id") ?? "") || null;
    const lido = lerVeiculo(form(fd), new Date(), comValores);
    if (!lido.ok) return { erro: lido.erro };
    const dados = lido.dados;
    const companyId = session.companyId;
    if (dados.apoliceId && !(await prisma.frotaApolice.findFirst({ where: { id: dados.apoliceId, companyId }, select: { id: true } }))) return { erro: "Apólice inválida." };
    for (const [campo, valor] of [["placa", dados.placa], ["chassi", dados.chassi]] as const) {
      if (!valor) continue;
      const outro = await prisma.cadVeiculo.findFirst({ where: { companyId, [campo]: valor, ...(id ? { NOT: { id } } : {}) }, select: { id: true } });
      if (outro) return { erro: `Já existe um veículo com ${campo === "placa" ? "a placa" : "o chassi"} ${valor}.` };
    }
    if (!id) {
      const novo = await prisma.cadVeiculo.create({ data: { companyId, ...dados, origens: { manual: session.name } } as Prisma.CadVeiculoUncheckedCreateInput });
      await registrarAlteracao(prisma, { companyId, usuario: session.name, tabela: "CadVeiculo", registroId: novo.id, operacao: "insert", depois: dados });
      if (dados.placa) await prisma.cadCentroCusto.createMany({ data: [{ companyId, codigo: `V-${dados.placa}`, tipo: "veiculo", veiculoId: novo.id }], skipDuplicates: true });
      revalidatePath("/frota");
      return { id: novo.id };
    }
    const atual = await prisma.cadVeiculo.findFirst({ where: { id, companyId } });
    if (!atual) return { erro: "Veículo não encontrado." };
    const mud = diferencas(atual as unknown as Record<string, unknown>, dados as unknown as Record<string, unknown>);
    if (mud) {
      await prisma.cadVeiculo.update({ where: { id }, data: mud.depois as Prisma.CadVeiculoUncheckedUpdateInput });
      await registrarAlteracao(prisma, { companyId, usuario: session.name, tabela: "CadVeiculo", registroId: id, operacao: "update", antes: mud.antes, depois: mud.depois });
      if (dados.placa && !atual.placa) await prisma.cadCentroCusto.createMany({ data: [{ companyId, codigo: `V-${dados.placa}`, tipo: "veiculo", veiculoId: id }], skipDuplicates: true });
      // Alocado num contrato com documento ou apólice faltando: pendência
      // crítica para a Operação (o veículo não deveria rodar assim).
      if ("alocacao" in mud.depois && dados.alocacao) await avisarAlocacaoComImpedimento(companyId, session.name, id);
    }
    revalidatePath(`/frota/${id}`);
    revalidatePath("/frota");
    return { id };
  } catch (e) {
    return falha(e);
  }
}

async function avisarAlocacaoComImpedimento(companyId: string, usuario: string, veiculoId: string) {
  const v = await prisma.cadVeiculo.findFirst({ where: { id: veiculoId, companyId }, include: { documentos: true, apolice: true } });
  if (!v || !EM_OPERACAO.includes(v.status)) return;
  const impedimentos = impedimentosParaRodar(v, v.documentos, v.apolice, new Date());
  if (!impedimentos.length) return;
  await criarPendencia({
    companyId,
    agente: `usuario:${usuario}`,
    tipo: "alocacao-com-impedimento",
    titulo: `${v.placa ?? v.chassi ?? v.id} alocado em ${v.alocacao} com impedimento`,
    descricao: `${impedimentos.join("; ")}. Regularizar antes de rodar, ou trocar o veículo. Aprovar = regularizado ou veículo trocado.`,
    severidade: "critica",
    evidencias: { veiculoId, placa: v.placa, alocacao: v.alocacao, impedimentos },
    perfilAprovador: "operacao",
    chaveExcecao: `alocacao-com-impedimento:${veiculoId}`,
  });
}

// RENOVAR / ATUALIZAR UM DOCUMENTO (um por tipo e veículo).
export async function salvarDocumento(fd: FormData): Promise<Resposta> {
  const session = await exigirPermissao("gerir-frota");
  try {
    const veiculoId = String(fd.get("veiculoId") ?? "");
    const tipo = String(fd.get("tipo") ?? "");
    if (!TIPO_DOCUMENTO.has(tipo)) return { erro: "Tipo de documento inválido." };
    const situacao = String(fd.get("situacao") ?? "vigente");
    if (!(SITUACOES_DOCUMENTO as readonly string[]).includes(situacao)) return { erro: "Situação inválida." };
    const validade = lerData(fd.get("validade"));
    if (validade === "invalida") return { erro: "Validade inválida." };
    if (situacao === "vigente" && !validade) return { erro: "Informe a validade (ou escolha outra situação)." };
    const veiculo = await prisma.cadVeiculo.findFirst({ where: { id: veiculoId, companyId: session.companyId }, select: { id: true } });
    if (!veiculo) return { erro: "Veículo não encontrado." };
    const dados = {
      situacao,
      validade: situacao === "nao_se_aplica" ? null : validade,
      numero: String(fd.get("numero") ?? "").trim().slice(0, 60) || null,
      observacao: String(fd.get("observacao") ?? "").trim().slice(0, 300) || null,
    };
    const atual = await prisma.frotaDocumento.findUnique({ where: { veiculoId_tipo: { veiculoId, tipo } } });
    const salvo = await prisma.frotaDocumento.upsert({
      where: { veiculoId_tipo: { veiculoId, tipo } },
      create: { companyId: session.companyId, veiculoId, tipo, ...dados, atualizadoPor: session.name },
      update: { ...dados, atualizadoPor: session.name },
    });
    await registrarAlteracao(prisma, {
      companyId: session.companyId,
      usuario: session.name,
      tabela: "FrotaDocumento",
      registroId: salvo.id,
      operacao: atual ? "update" : "insert",
      antes: atual ? { tipo, situacao: atual.situacao, validade: atual.validade, numero: atual.numero } : null,
      depois: { tipo, ...dados },
    });
    revalidatePath(`/frota/${veiculoId}`);
    revalidatePath("/frota/vencimentos");
    return { ok: true };
  } catch (e) {
    return falha(e);
  }
}

export async function registrarConsulta(fd: FormData): Promise<Resposta> {
  const session = await exigirPermissao("gerir-frota");
  try {
    const veiculoId = String(fd.get("veiculoId") ?? "");
    const fonte = String(fd.get("fonte") ?? "").trim();
    if (!["LW", "Fazenda", "Detran", "outra"].includes(fonte)) return { erro: "Fonte inválida." };
    const data = lerData(fd.get("data"));
    if (!data || data === "invalida" || data > new Date()) return { erro: "Informe a data da consulta (até hoje)." };
    const veiculo = await prisma.cadVeiculo.findFirst({ where: { id: veiculoId, companyId: session.companyId }, select: { id: true } });
    if (!veiculo) return { erro: "Veículo não encontrado." };
    const c = await prisma.frotaConsulta.upsert({
      where: { veiculoId_fonte_consultadoEm: { veiculoId, fonte, consultadoEm: data } },
      create: { companyId: session.companyId, veiculoId, fonte, consultadoEm: data, resultado: String(fd.get("resultado") ?? "").trim().slice(0, 500) || null, registradoPor: session.name },
      update: { resultado: String(fd.get("resultado") ?? "").trim().slice(0, 500) || null, registradoPor: session.name },
    });
    await registrarAlteracao(prisma, { companyId: session.companyId, usuario: session.name, tabela: "FrotaConsulta", registroId: c.id, operacao: "insert", depois: { fonte, consultadoEm: data, resultado: c.resultado } });
    revalidatePath(`/frota/${veiculoId}`);
    return { ok: true };
  } catch (e) {
    return falha(e);
  }
}

export async function salvarAdaptacao(fd: FormData): Promise<Resposta> {
  const session = await exigirPermissao("gerir-frota");
  try {
    if (!(await podeAcao(session, "frota-valores"))) return { erro: "Registrar custo de adaptação exige a permissão de valores da frota." };
    const veiculoId = String(fd.get("veiculoId") ?? "");
    const tipo = String(fd.get("tipo") ?? "outro");
    if (!["acessibilidade", "unidade_movel", "carroceria", "escolar", "acessorio", "outro"].includes(tipo)) return { erro: "Tipo de adaptação inválido." };
    const descricao = String(fd.get("descricao") ?? "").trim();
    if (!descricao) return { erro: "Descreva a adaptação." };
    const valor = lerReaisEmCents(String(fd.get("valor") ?? ""));
    if (valor === null || valor === "invalido" || valor <= 0) return { erro: "Informe o valor da adaptação." };
    const data = lerData(fd.get("data"));
    if (data === "invalida") return { erro: "Data inválida." };
    const veiculo = await prisma.cadVeiculo.findFirst({ where: { id: veiculoId, companyId: session.companyId }, select: { id: true } });
    if (!veiculo) return { erro: "Veículo não encontrado." };
    const dados = {
      tipo,
      descricao: descricao.slice(0, 200),
      data,
      valorCents: BigInt(valor),
      fornecedorNome: String(fd.get("fornecedorNome") ?? "").trim().slice(0, 120) || null,
      notaFiscal: String(fd.get("notaFiscal") ?? "").trim().slice(0, 40) || null,
    };
    const a = await prisma.frotaAdaptacao.create({ data: { companyId: session.companyId, veiculoId, ...dados, registradoPor: session.name } });
    await registrarAlteracao(prisma, { companyId: session.companyId, usuario: session.name, tabela: "FrotaAdaptacao", registroId: a.id, operacao: "insert", depois: dados });
    revalidatePath(`/frota/${veiculoId}`);
    return { ok: true };
  } catch (e) {
    return falha(e);
  }
}

// O PREÇO AJUSTADO, quando a FIPE não tem o modelo certo.
export async function salvarValorAjustado(fd: FormData): Promise<Resposta> {
  const session = await exigirPermissao("frota-valores");
  try {
    const veiculoId = String(fd.get("veiculoId") ?? "");
    const valor = lerReaisEmCents(String(fd.get("valor") ?? ""));
    if (valor === "invalido" || (typeof valor === "number" && valor <= 0)) return { erro: "Valor inválido." };
    const motivo = String(fd.get("motivo") ?? "").trim();
    if (valor !== null && !motivo) return { erro: "Diga por que o preço ajustado (ex.: a FIPE não tem o Volare com essa carroceria)." };
    const atual = await prisma.cadVeiculo.findFirst({ where: { id: veiculoId, companyId: session.companyId }, select: { valorAjustadoCents: true, valorAjustadoMotivo: true } });
    if (!atual) return { erro: "Veículo não encontrado." };
    const depois = { valorAjustadoCents: valor === null ? null : BigInt(valor), valorAjustadoMotivo: valor === null ? null : motivo.slice(0, 300), valorAjustadoEm: valor === null ? null : new Date() };
    await prisma.cadVeiculo.update({ where: { id: veiculoId }, data: depois });
    await registrarAlteracao(prisma, { companyId: session.companyId, usuario: session.name, tabela: "CadVeiculo", registroId: veiculoId, operacao: "update", antes: atual, depois });
    revalidatePath(`/frota/${veiculoId}`);
    return { ok: true };
  } catch (e) {
    return falha(e);
  }
}

// VENDA OU BAIXA: vira pendência para a Diretoria aprovar (quem registra não
// aprova). Veículo alienado em contrato ativo não sai sem dizer o que acontece
// com o contrato.
export async function solicitarSaida(fd: FormData): Promise<Resposta> {
  const session = await exigirPermissao("vender-veiculo");
  try {
    const veiculoId = String(fd.get("veiculoId") ?? "");
    const lido = lerSituacao(form(fd));
    if (!lido.ok) return { erro: lido.erro };
    const veiculo = await prisma.cadVeiculo.findFirst({ where: { id: veiculoId, companyId: session.companyId }, select: { id: true, placa: true, chassi: true, modelo: true, status: true } });
    if (!veiculo) return { erro: "Veículo não encontrado." };
    if (veiculo.status === "vendido" || veiculo.status === "baixado") return { erro: "O veículo já está fora da frota." };
    const alienados = await prisma.frotaFinanciamentoVeiculo.findMany({ where: { veiculoId, alienado: true, financiamento: { ativo: true } }, include: { financiamento: { select: { id: true, instituicao: true, contratoNumero: true, grupo: true, cota: true } } } });
    const destino = String(fd.get("contratos") ?? "");
    if (alienados.length > 0 && !["quitar", "transferir"].includes(destino)) {
      return { erro: `Veículo alienado em ${alienados.length} contrato(s) ativo(s) (${alienados.map((a) => a.financiamento.instituicao).join(", ")}): diga se o contrato será quitado ou transferido na venda.` };
    }
    const nome = veiculo.placa ?? veiculo.chassi ?? veiculo.id;
    const dados = lido.dados;
    const p = await criarPendencia({
      companyId: session.companyId,
      agente: `usuario:${session.name}`,
      tipo: "saida-veiculo",
      titulo: dados.status === "vendido" ? `Venda do veículo ${nome}` : `Baixa do veículo ${nome}`,
      descricao:
        dados.status === "vendido"
          ? `Venda para ${dados.compradorNome} em ${dados.dataVenda.toISOString().slice(0, 10).split("-").reverse().join("/")}${alienados.length ? `; contrato(s) alienado(s) serão ${destino === "quitar" ? "quitados" : "transferidos"}` : ""}. Ao aprovar, o veículo sai da frota e abre o checklist de saída (apólice, tag, rastreador, comunicação de venda).`
          : `Baixa por: ${dados.motivoBaixa}. Ao aprovar, o veículo sai da frota e abre o checklist de saída.`,
      severidade: "alta",
      evidencias: { veiculoId, placa: veiculo.placa, modelo: veiculo.modelo, contratos: alienados.map((a) => ({ id: a.financiamento.id, instituicao: a.financiamento.instituicao, contrato: a.financiamento.contratoNumero ?? `${a.financiamento.grupo}/${a.financiamento.cota}` })), solicitadoPor: session.name },
      acaoProposta: JSON.parse(JSON.stringify({ veiculoId, ...dados, valorVendaCents: "valorVendaCents" in dados && dados.valorVendaCents !== null ? dados.valorVendaCents.toString() : null, contratos: destino || null })),
      perfilAprovador: "admin",
      chaveExcecao: `saida-veiculo:${veiculoId}`,
    });
    revalidatePath(`/frota/${veiculoId}`);
    revalidatePath("/pendencias");
    return { ok: p.nova, erro: p.nova ? undefined : "Já há uma saída deste veículo aguardando aprovação." };
  } catch (e) {
    return falha(e);
  }
}

// QUEM RECEBE OS AVISOS DIÁRIOS DA FROTA.
export async function salvarEmailsFrota(fd: FormData): Promise<Resposta> {
  const session = await exigirPermissao("gerir-frota");
  try {
    const lista = String(fd.get("emails") ?? "").split(/[,;\s]+/).map((e) => e.trim()).filter(Boolean);
    const invalidos = lista.filter((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
    if (invalidos.length) return { erro: `E-mail inválido: ${invalidos.join(", ")}` };
    await prisma.controladoriaConfig.updateMany({ where: { companyId: session.companyId }, data: { emailsFrota: lista.join(", ") } });
    await registrarAlteracao(prisma, { companyId: session.companyId, usuario: session.name, tabela: "ControladoriaConfig", registroId: "emailsFrota", operacao: "update", depois: { emailsFrota: lista.length } });
    revalidatePath("/frota/vencimentos");
    return { ok: true };
  } catch (e) {
    return falha(e);
  }
}
